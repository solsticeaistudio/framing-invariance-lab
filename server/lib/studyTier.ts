import type {
  RunFindingSummary,
  Study,
  StudyEvidenceTier,
  StudyRunEffect,
  StudyRunLink,
  StudyRunRole,
  StudySynthesis,
  StudyTierAssessment,
} from "../v2/types.js";
import { canonicalSha256 } from "./canonicalJson.js";
import { targetSnapshotsCompatible } from "./methodology.js";
import { verifySignedArtifact } from "./signatures.js";
import {
  verifyHoldoutPackAttestation,
  verifySignedReplicationPack,
} from "./signedPacks.js";
import { descriptiveFixedEffect } from "./studyStatistics.js";
import { TrustStore } from "./trustStore.js";
import {
  executionLedgerHash,
  reconcileExecutionLedger,
} from "./executionLedger.js";
import { assessEvidenceVersionPolicy } from "./evidenceVersionPolicy.js";

type Candidate = {
  link: StudyRunLink;
  finding: RunFindingSummary;
  effects: StudyRunEffect;
};

function roleCertificate(role: StudyRunRole) {
  return role === "sealed_holdout"
    ? ("holdout_custodian" as const)
    : role === "independent_replication"
      ? ("independent_evaluator" as const)
      : ("lab_operator" as const);
}

function effect(
  link: StudyRunLink,
  finding: RunFindingSummary,
): StudyRunEffect {
  return {
    runId: link.artifact.payload.runId,
    artifactHash: link.artifactHash,
    role: link.role,
    organization: link.organization,
    datasetIdentity: link.datasetIdentity,
    targetSnapshot: structuredClone(link.artifact.payload.targetSnapshot),
    methodologyCompatibilityHash:
      link.artifact.payload.methodologyDescriptor.compatibilityHash,
    events: finding.events,
    total: finding.total,
    baselineEvents: finding.baselineEvents,
    baselineTotal: finding.baselineTotal,
    riskDifference: finding.riskDifference,
    interval: { ...finding.interval },
    runTier: finding.runTier,
    independenceStatus: link.independenceStatus,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function eligibilityErrors(link: StudyRunLink): string[] {
  const payload = link.artifact.payload;
  const versionPolicy = assessEvidenceVersionPolicy(payload.harnessVersion);
  if (!versionPolicy.modernPromotionEligibleByVersion)
    return [...versionPolicy.blockers];
  const errors: string[] = [];
  if (payload.purpose !== "promotable_evidence")
    errors.push("exploratory_run_not_promotable");
  if (payload.harnessVersion !== "2.2.3" && payload.runMode !== "preregistered")
    errors.push("preregistered_mode_required");
  if (payload.replicationMode !== "fixed")
    errors.push("adaptive_mode_not_promotable");
  if (payload.design !== "pairwise")
    errors.push("cartesian_design_not_promotable");
  if (payload.harnessVersion !== "2.2.3" && payload.judgeMode !== "ensemble")
    errors.push("ensemble_judge_required");
  if (payload.replicationIdentityCount !== 1)
    errors.push("multiple_replication_families_not_promotable");
  if (payload.claimKeyCount !== 1)
    errors.push("multiple_claims_not_promotable");
  if (!payload.signedEvidenceEligibility?.promotable)
    errors.push("signed_eligibility_invalid");
  const plan = payload.preExecutionPlanArtifact?.payload;
  if (!plan) return errors;
  if (plan.purpose !== payload.purpose)
    errors.push("purpose_changed_after_signing");
  if (payload.harnessVersion !== "2.2.3" && plan.runMode !== payload.runMode)
    errors.push("run_mode_changed_after_signing");
  if (plan.replicationMode !== payload.replicationMode)
    errors.push("replication_mode_changed_after_signing");
  if (plan.design !== payload.design)
    errors.push("design_changed_after_signing");
  if (
    payload.harnessVersion !== "2.2.3" &&
    plan.judgeMode !== payload.judgeMode
  )
    errors.push("judge_mode_changed_after_signing");
  if (plan.replicationIdentityCount !== 1)
    errors.push("multiple_replication_families_not_promotable");
  if (plan.claimKeyCount !== 1) errors.push("multiple_claims_not_promotable");
  return errors;
}

export function revocationPromotionPolicy(verification: {
  status: string;
  revocationReason?: string;
}): { blockers: string[]; warnings: string[] } {
  if (verification.status === "revoked_before_signing")
    return { blockers: ["revoked_certificate_before_signing"], warnings: [] };
  if (verification.status === "expired_at_signing")
    return { blockers: ["signer_expired_at_signing"], warnings: [] };
  if (verification.status === "expired_after_signing")
    return { blockers: [], warnings: ["signer_expired_after_signing"] };
  if (verification.status !== "revoked_after_signing")
    return { blockers: [], warnings: [] };
  if (verification.revocationReason === "key_compromise")
    return { blockers: ["revoked_certificate_key_compromise"], warnings: [] };
  if (
    verification.revocationReason === "privilege_withdrawn" ||
    verification.revocationReason === "unspecified"
  )
    return { blockers: ["revocation_review_required"], warnings: [] };
  if (
    verification.revocationReason === "superseded" ||
    verification.revocationReason === "cessation_of_operation"
  )
    return {
      blockers: [],
      warnings: [
        `certificate_revoked_after_signing:${verification.revocationReason}`,
      ],
    };
  return { blockers: ["revocation_review_required"], warnings: [] };
}

function candidateErrors(
  study: Study,
  original: Candidate,
  candidate: Candidate,
  trustStore: TrustStore,
  now: string,
): string[] {
  const errors: string[] = [];
  const runVerification = verifySignedArtifact({
    artifact: candidate.link.artifact,
    trustStore,
    expectedType: "completed_run",
    expectedPurpose: "immutable-completed-run-evidence",
    requiredRole: roleCertificate(candidate.link.role),
    now,
  });
  if (!runVerification.validAtSigning) errors.push("signature_failure");
  if (
    study.targetCompatibilityPolicy === "exact_snapshot" &&
    candidate.link.artifact.payload.judgeSnapshot?.identityResolutions?.includes(
      "requested_only",
    )
  )
    errors.push("judge_identity_requested_only");
  errors.push(...eligibilityErrors(candidate.link));
  if (
    assessEvidenceVersionPolicy(candidate.link.artifact.payload.harnessVersion)
      .requiresModernEligibilityContract
  ) {
    if (!candidate.link.artifact.payload.replicationIdentity)
      errors.push("canonical_replication_identity_missing");
    if (!candidate.link.artifact.payload.claimKey)
      errors.push("canonical_claim_identity_missing");
    if (
      candidate.link.artifact.payload.researchIdentityVersion !==
      "replication-identity-v1"
    )
      errors.push("canonical_replication_identity_missing");
    if (
      candidate.link.artifact.payload.claimIdentityVersion !==
      "claim-identity-v1"
    )
      errors.push("canonical_claim_identity_missing");
    if (
      candidate.finding.replicationIdentity !==
        candidate.link.artifact.payload.replicationIdentity ||
      candidate.link.replicationIdentity !==
        candidate.link.artifact.payload.replicationIdentity
    )
      errors.push("replication_identity_mismatch");
    if (
      candidate.finding.claimKey !== candidate.link.artifact.payload.claimKey ||
      candidate.link.claimKey !== candidate.link.artifact.payload.claimKey
    )
      errors.push("claim_identity_mismatch");
    if (!candidate.link.artifact.payload.executionLedgerHash)
      errors.push("execution_ledger_missing");
    if (!candidate.link.artifact.payload.executionLedger)
      errors.push("execution_ledger_missing");
    if (!candidate.link.artifact.payload.preExecutionPlanArtifact)
      errors.push("signed_pre_execution_plan_missing");
    else {
      const planVerification = verifySignedArtifact({
        artifact: candidate.link.artifact.payload.preExecutionPlanArtifact,
        trustStore,
        expectedType: "pre_execution_plan",
        expectedPurpose: "pre-execution-plan",
        requiredRole: roleCertificate(candidate.link.role),
        now,
      });
      if (!planVerification.validAtSigning)
        errors.push("pre_execution_plan_invalid");
      if (
        !candidate.link.artifact.signature.parentArtifactHashes.includes(
          candidate.link.artifact.payload.preExecutionPlanArtifact.signature
            .artifactHash,
        )
      )
        errors.push("pre_execution_plan_parent_missing");
    }
    if (
      candidate.link.artifact.payload.executionLedger &&
      candidate.link.artifact.payload.preExecutionPlanArtifact
    ) {
      const ledger = candidate.link.artifact.payload.executionLedger;
      const plan = candidate.link.artifact.payload.preExecutionPlanArtifact;
      const reconciliation = reconcileExecutionLedger(
        plan.payload.plannedTrials,
        ledger,
        { failurePolicy: plan.payload.failurePolicy },
      );
      if (!reconciliation.valid) errors.push(...reconciliation.blockers);
      if (
        candidate.link.artifact.payload.executionLedgerHash !==
        executionLedgerHash(ledger)
      )
        errors.push("execution_ledger_hash_mismatch");
    }
    if (!candidate.link.artifact.payload.judgeSnapshot)
      errors.push("judge_identity_missing");
    else {
      if (!candidate.link.artifact.payload.judgeSnapshot.resolvedModels.length)
        errors.push("judge_identity_missing");
      if (
        candidate.link.artifact.payload.judgeSnapshot.resolvedModels.includes(
          "unknown",
        )
      )
        errors.push("judge_resolved_model_unknown");
      if (
        !candidate.link.artifact.payload.judgeSnapshot.identityResolutions
          ?.length
      )
        errors.push("judge_identity_resolution_missing");
    }
    const counts = [
      candidate.link.artifact.payload.plannedTrialCount,
      candidate.link.artifact.payload.completedTrialCount,
      candidate.link.artifact.payload.failedTrialCount,
      candidate.link.artifact.payload.skippedTrialCount,
    ];
    if (counts.some((count) => count === undefined))
      errors.push("execution_counts_inconsistent");
    else if (
      counts[1]! + counts[2]! + counts[3]! !== counts[0] ||
      counts[1]! + counts[2]! > counts[0]!
    )
      errors.push("execution_counts_inconsistent");
    if (
      candidate.link.artifact.payload.status !== "completed" ||
      candidate.link.artifact.payload.failedTrialCount > 0
    )
      errors.push("execution_incomplete");
  }
  errors.push(...revocationPromotionPolicy(runVerification).blockers);
  const manifestSignerRole = roleCertificate(candidate.link.role);
  const preregistrationVerification = verifySignedArtifact({
    artifact: candidate.link.artifact.payload.preregistrationManifestArtifact,
    trustStore,
    expectedType: "preregistration_manifest",
    expectedPurpose: "frozen-preregistration-manifest",
    requiredRole: manifestSignerRole,
    now,
  });
  const executionVerification = verifySignedArtifact({
    artifact: candidate.link.artifact.payload.executionManifestArtifact,
    trustStore,
    expectedType: "execution_manifest",
    expectedPurpose: "sealed-execution-manifest",
    requiredRole: manifestSignerRole,
    now,
  });
  if (
    !preregistrationVerification.validAtSigning ||
    candidate.link.artifact.payload.preregistrationManifestArtifact.payload
      .manifestHash !== candidate.link.artifact.payload.manifestHash
  )
    errors.push("signed_preregistration_manifest_invalid");
  if (
    !executionVerification.validAtSigning ||
    candidate.link.artifact.payload.executionManifestArtifact.payload
      .executionManifestHash !==
      candidate.link.artifact.payload.executionManifestHash
  )
    errors.push("signed_execution_manifest_invalid");
  if (!candidate.link.packArtifact && !candidate.link.packAttestation) {
    errors.push("missing_dataset_evidence_source");
  } else if (
    candidate.link.packAttestation &&
    candidate.link.role === "sealed_holdout"
  ) {
    const attestationErrors = verifyHoldoutPackAttestation({
      attestation: candidate.link.packAttestation,
      trustStore,
      expectedMethodologyHash:
        candidate.link.artifact.payload.methodologyDescriptor.compatibilityHash,
      now,
    });
    if (attestationErrors.length)
      errors.push(
        ...attestationErrors.map(
          (error) => `sealed_attestation_invalid:${error}`,
        ),
      );
    if (candidate.link.packAttestation.payload.purpose !== "sealed_holdout")
      errors.push("sealed_attestation_invalid:purpose");
    if (
      candidate.link.packAttestation.signature.artifactHash !==
      candidate.link.packIdentity
    )
      errors.push("sealed_result_binding_invalid");
    if (
      candidate.link.artifact.payload.holdoutAttestationHash !==
      candidate.link.packAttestation.signature.artifactHash
    )
      errors.push("sealed_result_binding_invalid");
  } else if (candidate.link.packArtifact) {
    const purpose =
      candidate.link.role === "sealed_holdout"
        ? "sealed_holdout"
        : candidate.link.role;
    const pack = verifySignedReplicationPack({
      pack: candidate.link.packArtifact,
      trustStore,
      expectedPurpose: purpose,
      studyOwnerOrganization: study.ownerOrganization,
      manifestLockedAt: candidate.link.artifact.payload.manifestLockedAt,
      executionStartedAt: candidate.link.artifact.payload.startedAt,
    });
    if (!pack.trusted) errors.push(...pack.blockers);
  }
  if (candidate.link.artifactHash === original.link.artifactHash)
    errors.push("duplicate_artifact");
  if (candidate.link.datasetIdentity === original.link.datasetIdentity)
    errors.push("duplicate_dataset");
  if (candidate.link.packIdentity === original.link.packIdentity)
    errors.push("duplicate_pack");
  if (
    candidate.link.artifact.payload.trialLedgerHash ===
    original.link.artifact.payload.trialLedgerHash
  )
    errors.push("evidence_overlap");
  if (candidate.finding.replicationKey !== original.finding.replicationKey)
    errors.push("replication_identity_mismatch");
  if (
    candidate.finding.replicationIdentity &&
    original.finding.replicationIdentity &&
    candidate.finding.replicationIdentity !==
      original.finding.replicationIdentity
  )
    errors.push("replication_identity_mismatch");
  if (
    candidate.finding.claimKey !== original.finding.claimKey &&
    candidate.finding.claimIdentityVersion === "claim-identity-v1" &&
    original.finding.claimIdentityVersion === "claim-identity-v1"
  )
    errors.push("claim_identity_mismatch");
  if (candidate.finding.outcomeType !== original.finding.outcomeType)
    errors.push("incompatible_outcome_definition");
  if (
    !targetSnapshotsCompatible(
      original.link.artifact.payload.targetSnapshot,
      candidate.link.artifact.payload.targetSnapshot,
      study.targetCompatibilityPolicy,
    )
  )
    errors.push("target_mismatch");
  if (
    study.methodologyCompatibilityPolicy === "exact_hash" &&
    original.link.artifact.payload.methodologyDescriptor.compatibilityHash !==
      candidate.link.artifact.payload.methodologyDescriptor.compatibilityHash
  )
    errors.push("methodology_mismatch");
  if (
    !candidate.finding.conservativeEffectPositive ||
    candidate.finding.interval.low <= 0
  )
    errors.push("negative_or_inconclusive_replication");
  if (!candidate.finding.confirmationDepthMet)
    errors.push("missing_confirmation_depth");
  if (
    !candidate.link.artifact.payload.preregistered ||
    !candidate.link.artifact.payload.manifestVerified
  )
    errors.push("manifest_or_preregistration_failure");
  if (!candidate.link.replicationPlan) errors.push("missing_replication_plan");
  else {
    const planVerification = verifySignedArtifact({
      artifact: candidate.link.replicationPlan,
      trustStore,
      expectedType: "replication_plan",
      expectedPurpose: "frozen-prior-claim-replication-plan",
      requiredRole: "lab_operator",
      now,
    });
    if (!planVerification.validAtSigning)
      errors.push("replication_plan_signature_failure");
    const plan = candidate.link.replicationPlan;
    const parentReport = original.link.reportArtifact;
    if (!parentReport) errors.push("missing_parent_signed_report");
    else {
      const reportVerification = verifySignedArtifact({
        artifact: parentReport,
        trustStore,
        expectedType: "run_report",
        expectedPurpose: "immutable-report-artifact",
        requiredRole: "report_publisher",
        now,
      });
      if (!reportVerification.validAtSigning)
        errors.push("parent_report_signature_failure");
      if (
        plan.payload.parentReportArtifactHash !==
        parentReport.signature.artifactHash
      )
        errors.push("parent_report_hash_mismatch");
      if (
        Date.parse(parentReport.signature.signedAt) >
        Date.parse(plan.signature.signedAt)
      )
        errors.push("invalid_chronology");
    }
    if (
      plan.payload.studyId !== study.id ||
      plan.payload.datasetRole !== candidate.link.role
    )
      errors.push("replication_plan_scope_mismatch");
    if (candidate.finding.total < plan.payload.requiredSampleDepth)
      errors.push("missing_required_sample_depth");
    if (
      plan.payload.parentFindingId !== original.finding.findingId ||
      plan.payload.parentFindingDigest !== canonicalSha256(original.finding)
    )
      errors.push("parent_finding_mismatch");
    if (
      plan.payload.claimKey !== candidate.finding.claimKey ||
      plan.payload.replicationKey !== candidate.finding.replicationKey ||
      plan.payload.outcomeType !== candidate.finding.outcomeType
    )
      errors.push("replication_plan_hypothesis_mismatch");
    if (
      candidate.finding.replicationIdentity !== plan.payload.replicationIdentity
    )
      errors.push("replication_identity_mismatch");
    if (candidate.finding.derivedClaimKey !== plan.payload.derivedClaimKey)
      errors.push("claim_identity_mismatch");
    if (
      plan.payload.packCommitment !==
      (candidate.link.plaintextPackCommitment ?? candidate.link.packIdentity)
    )
      errors.push("pack_commitment_mismatch");
    if (
      candidate.link.role === "sealed_holdout" &&
      candidate.link.packAttestation &&
      candidate.link.attestationArtifactHash !==
        candidate.link.packAttestation.signature.artifactHash
    )
      errors.push("sealed_result_binding_invalid");
    if (
      plan.payload.methodologyCompatibilityHash !==
      candidate.link.artifact.payload.methodologyDescriptor.compatibilityHash
    )
      errors.push("methodology_plan_mismatch");
    if (
      candidate.link.artifact.payload.replicationPlanHash !==
      plan.signature.artifactHash
    )
      errors.push("manifest_replication_plan_mismatch");
    const timeline = [
      plan.signature.signedAt,
      candidate.link.artifact.payload.manifestLockedAt,
      candidate.link.artifact.payload.preregistrationManifestArtifact.signature
        .signedAt,
      candidate.link.artifact.payload.executionManifestArtifact.signature
        .signedAt,
      candidate.link.artifact.payload.startedAt,
      candidate.link.artifact.payload.finishedAt,
      candidate.link.artifact.signature.signedAt,
    ].map(Date.parse);
    if (
      timeline.some((value, index) => index > 0 && timeline[index - 1] > value)
    )
      errors.push("invalid_chronology");
    if (
      candidate.link.artifact.payload.executionManifestArtifact.payload
        .sealedAt !==
      candidate.link.artifact.payload.executionManifestArtifact.signature
        .signedAt
    )
      errors.push("execution_seal_timestamp_mismatch");
  }
  if (
    candidate.link.role === "sealed_holdout" &&
    !candidate.link.artifact.payload.confirmatoryExecution
  )
    errors.push("confirmatory_execution_missing");
  if (
    (candidate.link.role === "sealed_holdout" ||
      candidate.link.role === "independent_replication") &&
    !candidate.finding.publicationDepthMet
  )
    errors.push("missing_publication_depth");
  if (candidate.link.role === "independent_replication") {
    if (
      !candidate.link.independenceDeclaration ||
      candidate.link.independenceStatus !== "attributed"
    )
      errors.push("unresolved_independence_declaration");
    if (candidate.link.organization === study.ownerOrganization)
      errors.push("same_organization_independent_claim");
  }
  return unique(errors);
}

function stagePass(
  candidates: Candidate[],
  errors: Map<string, string[]>,
): boolean {
  return (
    candidates.length > 0 &&
    candidates.every(
      (candidate) => (errors.get(candidate.link.id) ?? []).length === 0,
    )
  );
}

export function assessStudyClaim(
  study: Study,
  claimKey: string,
  trustStore: TrustStore,
  now: string,
): { assessment: StudyTierAssessment; effects: StudyRunEffect[] } {
  const registrationVerification = study.registrationArtifact
    ? verifySignedArtifact({
        artifact: study.registrationArtifact,
        trustStore,
        expectedType: "study_registration",
        expectedPurpose: "frozen-study-registration",
        requiredRole: "lab_operator",
        now,
      })
    : undefined;
  const candidates = study.runLinks.flatMap((link) =>
    link.artifact.payload.findingSummaries
      .filter((finding) => finding.claimKey === claimKey)
      .map((finding) => ({ link, finding, effects: effect(link, finding) })),
  );
  const originals = candidates.filter(
    (candidate) => candidate.link.role === "development",
  );
  const original = originals[0];
  const errors = new Map<string, string[]>();
  const originalVerification = original
    ? verifySignedArtifact({
        artifact: original.link.artifact,
        trustStore,
        expectedType: "completed_run",
        expectedPurpose: "immutable-completed-run-evidence",
        requiredRole: "lab_operator",
        now,
      })
    : undefined;
  const originalSupported = Boolean(
    original &&
      originalVerification?.validAtSigning &&
      registrationVerification?.validAtSigning === true &&
      originalVerification.validAtSigning &&
      original.link.artifact.payload.preregistered &&
      original.link.artifact.payload.manifestVerified &&
      original.finding.conservativeEffectPositive &&
      original.finding.interval.low > 0 &&
      original.finding.confirmationDepthMet,
  );
  if (original) {
    const originalIntegrity: string[] = [];
    if (!originalVerification?.validAtSigning)
      originalIntegrity.push("signature_failure");
    const originalPayload = original.link.artifact.payload;
    originalIntegrity.push(...eligibilityErrors(original.link));
    if (
      assessEvidenceVersionPolicy(originalPayload.harnessVersion)
        .requiresModernEligibilityContract
    ) {
      if (!originalPayload.replicationIdentity)
        originalIntegrity.push("canonical_replication_identity_missing");
      if (!originalPayload.claimKey)
        originalIntegrity.push("canonical_claim_identity_missing");
      if (!originalPayload.executionLedgerHash)
        originalIntegrity.push("execution_ledger_missing");
      if (!originalPayload.executionLedger)
        originalIntegrity.push("execution_ledger_missing");
      if (!originalPayload.preExecutionPlanArtifact)
        originalIntegrity.push("signed_pre_execution_plan_missing");
      else {
        const planVerification = verifySignedArtifact({
          artifact: originalPayload.preExecutionPlanArtifact,
          trustStore,
          expectedType: "pre_execution_plan",
          expectedPurpose: "pre-execution-plan",
          requiredRole: "lab_operator",
          now,
        });
        if (!planVerification.validAtSigning)
          originalIntegrity.push("pre_execution_plan_invalid");
        if (
          !original.link.artifact.signature.parentArtifactHashes.includes(
            originalPayload.preExecutionPlanArtifact.signature.artifactHash,
          )
        )
          originalIntegrity.push("pre_execution_plan_parent_missing");
        if (originalPayload.executionLedger) {
          const reconciliation = reconcileExecutionLedger(
            originalPayload.preExecutionPlanArtifact.payload.plannedTrials,
            originalPayload.executionLedger,
            {
              failurePolicy:
                originalPayload.preExecutionPlanArtifact.payload.failurePolicy,
            },
          );
          if (!reconciliation.valid)
            originalIntegrity.push(...reconciliation.blockers);
          if (
            originalPayload.executionLedgerHash !==
            executionLedgerHash(originalPayload.executionLedger)
          )
            originalIntegrity.push("execution_ledger_hash_mismatch");
        }
      }
      if (
        original.finding.replicationIdentity !==
          originalPayload.replicationIdentity ||
        original.link.replicationIdentity !==
          originalPayload.replicationIdentity
      )
        originalIntegrity.push("replication_identity_mismatch");
      if (
        original.finding.claimKey !== originalPayload.claimKey ||
        original.link.claimKey !== originalPayload.claimKey
      )
        originalIntegrity.push("claim_identity_mismatch");
      if (!originalPayload.judgeSnapshot)
        originalIntegrity.push("judge_identity_missing");
      else if (
        !originalPayload.judgeSnapshot.resolvedModels.length ||
        originalPayload.judgeSnapshot.resolvedModels.includes("unknown") ||
        !originalPayload.judgeSnapshot.identityResolutions?.length
      )
        originalIntegrity.push("judge_identity_invalid");
      if (
        originalPayload.plannedTrialCount === undefined ||
        originalPayload.completedTrialCount === undefined ||
        originalPayload.failedTrialCount === undefined ||
        originalPayload.skippedTrialCount === undefined ||
        originalPayload.completedTrialCount +
          originalPayload.failedTrialCount +
          originalPayload.skippedTrialCount !==
          originalPayload.plannedTrialCount
      )
        originalIntegrity.push("execution_counts_inconsistent");
      if (
        originalPayload.status !== "completed" ||
        originalPayload.failedTrialCount > 0
      )
        originalIntegrity.push("execution_incomplete");
    }
    if (!original.link.packArtifact)
      originalIntegrity.push("missing_dataset_evidence_source");
    else {
      const packVerification = verifySignedReplicationPack({
        pack: original.link.packArtifact,
        trustStore,
        expectedPurpose: "development",
        studyOwnerOrganization: study.ownerOrganization,
        manifestLockedAt: originalPayload.manifestLockedAt,
        executionStartedAt: originalPayload.startedAt,
      });
      if (!packVerification.trusted)
        originalIntegrity.push(...packVerification.blockers);
      if (
        original.link.packArtifact.payload.replicationIdentity !==
          originalPayload.replicationIdentity ||
        original.link.packArtifact.payload.claimKey !== originalPayload.claimKey
      )
        originalIntegrity.push("research_identity_mismatch");
    }
    if (originalIntegrity.length)
      errors.set(original.link.id, [
        "original_evidence_unverified",
        ...originalIntegrity,
      ]);
  }
  if (original)
    for (const candidate of candidates.filter((item) => item !== original))
      errors.set(
        candidate.link.id,
        candidateErrors(study, original, candidate, trustStore, now),
      );
  const validation = candidates.filter(
    (candidate) => candidate.link.role === "validation",
  );
  const holdout = candidates.filter(
    (candidate) => candidate.link.role === "sealed_holdout",
  );
  const independent = candidates.filter(
    (candidate) => candidate.link.role === "independent_replication",
  );
  const originalIntegrityValid =
    original !== undefined && (errors.get(original.link.id) ?? []).length === 0;
  const validated =
    originalSupported &&
    originalIntegrityValid &&
    stagePass(validation, errors);
  const confirmed = validated && stagePass(holdout, errors);
  const independentlyConfirmed = confirmed && stagePass(independent, errors);
  const assignedTier: StudyEvidenceTier = independentlyConfirmed
    ? "independently_confirmed"
    : confirmed
      ? "confirmed"
      : validated
        ? "validated"
        : originalSupported && originalIntegrityValid
          ? "supported"
          : "exploratory";
  const blockers = unique([
    ...(!study.registrationArtifact
      ? ["missing_signed_study_registration"]
      : registrationVerification?.status === "invalid_chain" ||
          registrationVerification?.status === "unauthorized_role" ||
          registrationVerification?.status === "unknown_issuer"
        ? ["invalid_study_registration"]
        : registrationVerification?.validAtSigning !== true
          ? ["study_registration_purpose_mismatch"]
          : []),
    ...(!original ? ["missing_original_evidence"] : []),
    ...(original && (!originalSupported || !originalIntegrityValid)
      ? ["original_evidence_not_supported"]
      : []),
    ...(!validated ? ["qualifying_validation_replication_missing"] : []),
    ...(!confirmed ? ["qualifying_sealed_holdout_missing"] : []),
    ...(!independentlyConfirmed
      ? ["qualifying_independent_replication_missing"]
      : []),
    ...[...errors.values()].flat(),
  ]);
  const warnings = unique([
    ...(study.targetCompatibilityPolicy === "cross_version_generalization"
      ? [
          "Cross-version generalization is reported separately from exact-model replication.",
        ]
      : []),
    ...candidates.flatMap(
      (candidate) =>
        revocationPromotionPolicy(candidate.link.verification).warnings,
    ),
  ]);
  return {
    assessment: {
      assignedTier,
      claimKey,
      contributingArtifacts: unique(
        candidates.map((candidate) => candidate.link.artifactHash),
      ),
      contributingRuns: unique(
        candidates.map((candidate) => candidate.link.artifact.payload.runId),
      ),
      contributingDatasets: unique(
        candidates.map((candidate) => candidate.link.datasetIdentity),
      ),
      organizations: unique(
        candidates.map((candidate) => candidate.link.organization),
      ),
      requirements: {
        supportedOriginal: originalSupported,
        signedValidationReplication: stagePass(validation, errors),
        distinctValidationDataset: validation.some(
          (item) =>
            item.link.datasetIdentity !== original?.link.datasetIdentity,
        ),
        validReplicationPlan:
          validation.length > 0 &&
          validation.every(
            (item) =>
              !(errors.get(item.link.id) ?? []).some(
                (error) =>
                  error.includes("plan") || error.includes("chronology"),
              ),
          ),
        compatibleTarget: candidates.every(
          (item) =>
            item === original ||
            !(errors.get(item.link.id) ?? []).includes("target_mismatch"),
        ),
        compatibleMethodology: candidates.every(
          (item) =>
            item === original ||
            !(errors.get(item.link.id) ?? []).includes("methodology_mismatch"),
        ),
        trustedSealedHoldout: stagePass(holdout, errors),
        attributableIndependentReplication: stagePass(independent, errors),
        publicationDepthMet:
          holdout.length > 0 &&
          holdout.every((item) => item.finding.publicationDepthMet),
        noEvidenceOverlap: candidates.every(
          (item) =>
            item === original ||
            !(errors.get(item.link.id) ?? []).some(
              (error) =>
                error.includes("duplicate") || error === "evidence_overlap",
            ),
        ),
        everyStagePositive: candidates.every(
          (item) =>
            item.finding.conservativeEffectPositive &&
            item.finding.interval.low > 0,
        ),
      },
      blockers,
      warnings,
    },
    effects: candidates.map((candidate) => candidate.effects),
  };
}

export function synthesizeStudy(
  study: Study,
  trustStore: TrustStore,
  generatedAt: string,
): StudySynthesis {
  const claimKeys = unique(
    study.runLinks.flatMap((link) =>
      link.artifact.payload.findingSummaries.map((finding) => finding.claimKey),
    ),
  );
  const studyRegistrationHash = study.registrationArtifact
    ? study.registrationArtifact.signature.artifactHash
    : canonicalSha256({
        schemaVersion: study.schemaVersion,
        id: study.id,
        title: study.title,
        researchQuestion: study.researchQuestion,
        hypothesisKey: study.hypothesisKey,
        ownerOrganization: study.ownerOrganization,
        createdBy: study.createdBy,
        createdAt: study.createdAt,
        targetCompatibilityPolicy: study.targetCompatibilityPolicy,
        methodologyCompatibilityPolicy: study.methodologyCompatibilityPolicy,
      });
  return {
    schemaVersion: "1.0",
    studyId: study.id,
    generatedAt,
    studyRegistrationHash,
    findings: claimKeys.map((claimKey) => {
      const result = assessStudyClaim(study, claimKey, trustStore, generatedAt);
      return {
        claimKey,
        assessment: result.assessment,
        effects: result.effects,
        descriptiveSynthesis: descriptiveFixedEffect(result.effects),
      };
    }),
  };
}

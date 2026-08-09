import { randomUUID } from "node:crypto";
import type { Scenario } from "../types.js";
import type {
  CompletedRunArtifact,
  ReportArtifact,
  ReplicationPlan,
  SignedArtifact,
  SignedIndependenceDeclaration,
  SignedReplicationPack,
  SignedHoldoutPackAttestation,
  Study,
  StudyRunLink,
  StudyRunRole,
} from "../v2/types.js";
import { verifySignedArtifact } from "./signatures.js";
import {
  executionLedgerHash,
  reconcileExecutionLedger,
} from "./executionLedger.js";
import { verifySignedReplicationPack } from "./signedPacks.js";
import { TrustStore } from "./trustStore.js";
import { verifyHoldoutPackAttestation } from "./signedPacks.js";
import { assessEvidenceVersionPolicy } from "./evidenceVersionPolicy.js";

export function createStudy(
  args: Omit<
    Study,
    "schemaVersion" | "id" | "createdAt" | "status" | "runLinks"
  > & { id?: string; createdAt: string },
): Study {
  return {
    schemaVersion: "1.0",
    id: args.id ?? randomUUID(),
    title: args.title,
    researchQuestion: args.researchQuestion,
    hypothesisKey: args.hypothesisKey,
    ownerOrganization: args.ownerOrganization,
    createdBy: args.createdBy,
    createdAt: args.createdAt,
    status: "draft",
    targetCompatibilityPolicy: args.targetCompatibilityPolicy,
    methodologyCompatibilityPolicy: args.methodologyCompatibilityPolicy,
    runLinks: [],
  };
}

function runSignerRole(role: StudyRunRole) {
  return role === "sealed_holdout"
    ? ("holdout_custodian" as const)
    : role === "independent_replication"
      ? ("independent_evaluator" as const)
      : ("lab_operator" as const);
}

export function importStudyRun(args: {
  study: Study;
  artifact: SignedArtifact<CompletedRunArtifact>;
  role: StudyRunRole;
  datasetIdentity: string;
  pack?: SignedReplicationPack<Scenario>;
  packAttestation?: SignedHoldoutPackAttestation;
  replicationKey: string;
  trustStore: TrustStore;
  importedAt: string;
  plan?: SignedArtifact<ReplicationPlan>;
  reportArtifact?: SignedArtifact<ReportArtifact>;
  independenceDeclaration?: SignedIndependenceDeclaration;
}): StudyRunLink {
  const verification = verifySignedArtifact({
    artifact: args.artifact,
    trustStore: args.trustStore,
    expectedType: "completed_run",
    expectedPurpose: "immutable-completed-run-evidence",
    requiredRole: runSignerRole(args.role),
    now: args.importedAt,
  });
  if (!verification.validAtSigning)
    throw new Error(
      `completed_run_verification_failed:${verification.errors.join("|")}`,
    );
  const manifestSignerRole = runSignerRole(args.role);
  const preregistration = verifySignedArtifact({
    artifact: args.artifact.payload.preregistrationManifestArtifact,
    trustStore: args.trustStore,
    expectedType: "preregistration_manifest",
    expectedPurpose: "frozen-preregistration-manifest",
    requiredRole: manifestSignerRole,
    now: args.importedAt,
  });
  const execution = verifySignedArtifact({
    artifact: args.artifact.payload.executionManifestArtifact,
    trustStore: args.trustStore,
    expectedType: "execution_manifest",
    expectedPurpose: "sealed-execution-manifest",
    requiredRole: manifestSignerRole,
    now: args.importedAt,
  });
  if (
    !preregistration.validAtSigning ||
    args.artifact.payload.preregistrationManifestArtifact.payload
      .manifestHash !== args.artifact.payload.manifestHash
  )
    throw new Error("preregistration_manifest_artifact_invalid");
  if (
    !execution.validAtSigning ||
    args.artifact.payload.executionManifestArtifact.payload
      .executionManifestHash !== args.artifact.payload.executionManifestHash
  )
    throw new Error("execution_manifest_artifact_invalid");
  if (
    !args.artifact.signature.parentArtifactHashes.includes(
      args.artifact.payload.preregistrationManifestArtifact.signature
        .artifactHash,
    ) ||
    !args.artifact.signature.parentArtifactHashes.includes(
      args.artifact.payload.executionManifestArtifact.signature.artifactHash,
    )
  )
    throw new Error("completed_run_manifest_parent_missing");
  if (!args.artifact.payload.datasetIdentities.includes(args.datasetIdentity))
    throw new Error("dataset_identity_not_committed_by_run");
  const versionPolicy = assessEvidenceVersionPolicy(
    args.artifact.payload.harnessVersion,
  );
  if (versionPolicy.requiresModernEligibilityContract) {
    if (
      !args.artifact.payload.replicationIdentity ||
      args.artifact.payload.researchIdentityVersion !==
        "replication-identity-v1"
    )
      throw new Error("canonical_replication_identity_missing");
    if (
      !args.artifact.payload.claimKey ||
      args.artifact.payload.claimIdentityVersion !== "claim-identity-v1"
    )
      throw new Error("canonical_claim_identity_missing");
    if (/^(declared|derived):/.test(args.artifact.payload.replicationIdentity))
      throw new Error("legacy_identity_not_promotable");
    if (versionPolicy.modernPromotionEligibleByVersion) {
      if (args.artifact.payload.purpose !== "promotable_evidence")
        throw new Error("exploratory_run_not_promotable");
      if (
        args.artifact.payload.harnessVersion !== "2.2.3" &&
        args.artifact.payload.runMode !== "preregistered"
      )
        throw new Error("preregistered_mode_required");
      if (args.artifact.payload.replicationMode !== "fixed")
        throw new Error("adaptive_mode_not_promotable");
      if (args.artifact.payload.design !== "pairwise")
        throw new Error("cartesian_design_not_promotable");
      if (
        args.artifact.payload.harnessVersion !== "2.2.3" &&
        args.artifact.payload.judgeMode !== "ensemble"
      )
        throw new Error("ensemble_judge_required");
      if (args.artifact.payload.replicationIdentityCount !== 1)
        throw new Error("multiple_replication_families_not_promotable");
      if (args.artifact.payload.claimKeyCount !== 1)
        throw new Error("multiple_claims_not_promotable");
      if (!args.artifact.payload.signedEvidenceEligibility?.promotable)
        throw new Error("signed_eligibility_invalid");
    }
    if (
      !args.artifact.payload.findingSummaries.some(
        (finding) =>
          finding.replicationIdentity ===
            args.artifact.payload.replicationIdentity &&
          finding.claimKey === args.artifact.payload.claimKey &&
          finding.researchIdentityVersion === "replication-identity-v1" &&
          finding.claimIdentityVersion === "claim-identity-v1",
      )
    )
      throw new Error("research_identity_mismatch");
    if (!args.artifact.payload.preExecutionPlanArtifact)
      throw new Error("signed_pre_execution_plan_missing");
    if (!args.artifact.payload.executionLedgerHash)
      throw new Error("execution_ledger_missing");
    if (!args.artifact.payload.executionLedger)
      throw new Error("execution_ledger_missing");
    if (!args.artifact.payload.judgeSnapshot)
      throw new Error("judge_identity_missing");
    if (
      !args.artifact.payload.judgeSnapshot.resolvedModels.length ||
      args.artifact.payload.judgeSnapshot.resolvedModels.includes("unknown") ||
      !args.artifact.payload.judgeSnapshot.identityResolutions?.length
    )
      throw new Error("judge_identity_missing");
    const planVerification = verifySignedArtifact({
      artifact: args.artifact.payload.preExecutionPlanArtifact,
      trustStore: args.trustStore,
      expectedType: "pre_execution_plan",
      expectedPurpose: "pre-execution-plan",
      requiredRole: manifestSignerRole,
      now: args.importedAt,
    });
    if (!planVerification.validAtSigning)
      throw new Error("pre_execution_plan_invalid");
    if (
      args.artifact.payload.preExecutionPlanArtifact.payload
        .replicationIdentity !== args.artifact.payload.replicationIdentity ||
      args.artifact.payload.preExecutionPlanArtifact.payload.claimKey !==
        args.artifact.payload.claimKey
    )
      throw new Error("research_identity_mismatch");
    if (versionPolicy.modernPromotionEligibleByVersion) {
      const plan = args.artifact.payload.preExecutionPlanArtifact.payload;
      if (plan.purpose !== args.artifact.payload.purpose)
        throw new Error("purpose_changed_after_signing");
      if (
        args.artifact.payload.harnessVersion !== "2.2.3" &&
        plan.runMode !== args.artifact.payload.runMode
      )
        throw new Error("run_mode_changed_after_signing");
      if (plan.replicationMode !== args.artifact.payload.replicationMode)
        throw new Error("replication_mode_changed_after_signing");
      if (plan.design !== args.artifact.payload.design)
        throw new Error("design_changed_after_signing");
      if (
        args.artifact.payload.harnessVersion !== "2.2.3" &&
        plan.judgeMode !== args.artifact.payload.judgeMode
      )
        throw new Error("judge_mode_changed_after_signing");
      if (plan.replicationIdentityCount !== 1)
        throw new Error("multiple_replication_families_not_promotable");
      if (plan.claimKeyCount !== 1)
        throw new Error("multiple_claims_not_promotable");
    }
    if (
      Date.parse(
        args.artifact.payload.preExecutionPlanArtifact.signature.signedAt,
      ) > Date.parse(args.artifact.payload.startedAt)
    )
      throw new Error("pre_execution_plan_signed_after_execution_started");
    if (
      args.artifact.payload.preExecutionPlanArtifact.payload
        .plannedTrialCount !== args.artifact.payload.plannedTrialCount
    )
      throw new Error("execution_counts_inconsistent");
    const reconciliation = reconcileExecutionLedger(
      args.artifact.payload.preExecutionPlanArtifact.payload.plannedTrials,
      args.artifact.payload.executionLedger,
      {
        failurePolicy:
          args.artifact.payload.preExecutionPlanArtifact.payload.failurePolicy,
      },
    );
    if (!reconciliation.valid)
      throw new Error(
        `execution_ledger_invalid:${reconciliation.blockers.join("|")}`,
      );
    if (
      args.artifact.payload.executionLedgerHash !==
      executionLedgerHash(args.artifact.payload.executionLedger)
    )
      throw new Error("execution_ledger_hash_mismatch");
  }
  const expectedPurpose =
    args.role === "sealed_holdout"
      ? "sealed_holdout"
      : args.role === "independent_replication"
        ? "independent_replication"
        : args.role;
  let packIdentity: string;
  let packArtifact: SignedReplicationPack<Scenario> | undefined;
  let plaintextPackCommitment: string | undefined;
  let encryptedPackHash: string | undefined;
  let attestationArtifactHash: string | undefined;
  if (args.role === "sealed_holdout" && !args.pack) {
    if (!args.packAttestation) throw new Error("holdout_attestation_required");
    const attestationErrors = verifyHoldoutPackAttestation({
      attestation: args.packAttestation,
      trustStore: args.trustStore,
      expectedMethodologyHash:
        args.artifact.payload.methodologyDescriptor.compatibilityHash,
      now: args.importedAt,
    });
    if (attestationErrors.length)
      throw new Error(
        `holdout_attestation_invalid:${attestationErrors.join("|")}`,
      );
    if (args.packAttestation.payload.datasetIdentity !== args.datasetIdentity)
      throw new Error("attestation_dataset_identity_mismatch");
    if (
      args.packAttestation.payload.replicationIdentity !==
        args.artifact.payload.replicationIdentity ||
      args.packAttestation.payload.claimKey !== args.artifact.payload.claimKey
    )
      throw new Error("research_identity_mismatch");
    if (
      args.artifact.payload.holdoutAttestationHash !==
      args.packAttestation.signature.artifactHash
    )
      throw new Error("run_holdout_attestation_mismatch");
    const preExecutionPlan = args.artifact.payload.preExecutionPlanArtifact;
    if (
      !preExecutionPlan ||
      preExecutionPlan.payload.holdoutAttestationHash !==
        args.packAttestation.signature.artifactHash
    )
      throw new Error("pre_execution_plan_attestation_hash_mismatch");
    if (
      !args.artifact.payload.scenarioPackCommitments.includes(
        args.packAttestation.payload.plaintextCommitmentHash,
      )
    )
      throw new Error("run_pack_commitment_missing");
    packIdentity = args.packAttestation.signature.artifactHash;
    plaintextPackCommitment =
      args.packAttestation.payload.plaintextCommitmentHash;
    encryptedPackHash = args.packAttestation.payload.encryptedPackHash;
    attestationArtifactHash = args.packAttestation.signature.artifactHash;
  } else {
    if (!args.pack) throw new Error("signed_pack_required");
    const packVerification = verifySignedReplicationPack({
      pack: args.pack,
      trustStore: args.trustStore,
      expectedPurpose,
      studyOwnerOrganization: args.study.ownerOrganization,
      manifestLockedAt: args.artifact.payload.manifestLockedAt,
      executionStartedAt: args.artifact.payload.startedAt,
    });
    if (!packVerification.trusted)
      throw new Error(
        `replication_pack_verification_failed:${packVerification.blockers.join("|")}`,
      );
    if (args.pack.payload.datasetIdentity !== args.datasetIdentity)
      throw new Error("pack_dataset_identity_mismatch");
    if (
      args.pack.payload.replicationIdentity !==
        args.artifact.payload.replicationIdentity ||
      args.pack.payload.claimKey !== args.artifact.payload.claimKey
    )
      throw new Error("research_identity_mismatch");
    if (args.pack.payload.purpose !== expectedPurpose)
      throw new Error("pack_role_purpose_mismatch");
    packIdentity = args.pack.signature.artifactHash;
    plaintextPackCommitment = args.pack.signature.artifactHash;
    packArtifact = structuredClone(args.pack);
  }
  const artifactHash = args.artifact.signature.artifactHash;
  const conflicts = args.study.runLinks.flatMap((link) => {
    if (link.artifactHash === artifactHash) return ["duplicate_artifact"];
    if (link.artifact.payload.runId === args.artifact.payload.runId)
      return ["run_id_content_conflict"];
    if (link.datasetIdentity === args.datasetIdentity)
      return ["duplicate_dataset"];
    if (link.packIdentity === packIdentity) return ["duplicate_pack"];
    if (
      link.artifact.payload.trialLedgerHash ===
      args.artifact.payload.trialLedgerHash
    )
      return ["duplicate_trial_ledger"];
    return [];
  });
  if (conflicts.length)
    throw new Error(
      `study_evidence_overlap:${[...new Set(conflicts)].join("|")}`,
    );
  const leaf = args.artifact.certificateChain[0];
  if (!leaf) throw new Error("completed_run_signer_missing");
  const independenceStatus =
    args.role !== "independent_replication"
      ? "not_applicable"
      : !args.independenceDeclaration
        ? "unverified"
        : args.independenceDeclaration.payload.conflictsOfInterest.length ||
            args.independenceDeclaration.payload.evaluatorOrganization ===
              args.study.ownerOrganization
          ? "conflicted"
          : "attributed";
  const link: StudyRunLink = {
    id: randomUUID(),
    artifactHash,
    artifact: structuredClone(args.artifact),
    role: args.role,
    datasetIdentity: args.datasetIdentity,
    packIdentity,
    plaintextPackCommitment,
    encryptedPackHash,
    attestationArtifactHash,
    replicationKey: args.replicationKey,
    replicationIdentity: args.artifact.payload.replicationIdentity,
    claimKey: args.artifact.payload.claimKey,
    researchIdentityVersion: args.artifact.payload.researchIdentityVersion,
    claimIdentityVersion: args.artifact.payload.claimIdentityVersion,
    signerKeyId: leaf.keyId,
    organization: leaf.organization,
    independenceStatus,
    independenceDeclaration: args.independenceDeclaration
      ? structuredClone(args.independenceDeclaration)
      : undefined,
    replicationPlan: args.plan ? structuredClone(args.plan) : undefined,
    packArtifact,
    packAttestation: args.packAttestation
      ? structuredClone(args.packAttestation)
      : undefined,
    reportArtifact: args.reportArtifact
      ? structuredClone(args.reportArtifact)
      : undefined,
    importedAt: args.importedAt,
    verification,
  };
  args.study.runLinks.push(link);
  return link;
}

export function registerStudy(study: Study): void {
  if (study.status !== "draft") throw new Error("study_already_registered");
  study.status = "preregistered";
}

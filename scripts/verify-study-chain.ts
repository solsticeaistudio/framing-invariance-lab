import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { verifyArchive } from "../server/lib/archive.js";
import { trustStoreFromEnvironment } from "../server/lib/trustStoreLoader.js";
import {
  executionLedgerHash,
  reconcileExecutionLedger,
} from "../server/lib/executionLedger.js";
import type {
  PlannedTrialCommitment,
  TrialFailurePolicy,
  TrialExecutionRecord,
} from "../server/v2/types.js";
import { PAIRWISE_FRAMING_PROTOCOL } from "../server/lib/framingProtocol.js";
import { assessEvidenceVersionPolicy } from "../server/lib/evidenceVersionPolicy.js";
import { verifyHoldoutPackAttestation } from "../server/lib/signedPacks.js";

const file = process.argv[2];
if (!file)
  throw new Error("Usage: npm run study:verify-chain -- <archive.zip>");
const bytes = await readFile(file);
const trustStore = await trustStoreFromEnvironment(process.env);
const result = verifyArchive(bytes, trustStore);
const files = unzipSync(bytes);
const json = (path: string): unknown => {
  const value = files[path];
  return value ? JSON.parse(strFromU8(value)) : undefined;
};
const completed = json("completed-run-artifact.json") as
  | {
      payload: {
        preExecutionPlanArtifact?: {
          payload: {
            plannedTrials: PlannedTrialCommitment[];
            replicationIdentity: string;
            claimKey: string;
            variantProtocolId: string;
            variantProtocolVersion: string;
            variantProtocolHash: string;
            failurePolicy: TrialFailurePolicy;
            purpose?: string;
            replicationMode?: string;
            design?: string;
            replicationIdentityCount?: number;
            claimKeyCount?: number;
            signedEvidenceEligibility?: { promotable: boolean };
            runMode?: string;
            judgeMode?: string;
          };
          signature: { artifactHash: string; signedAt: string };
        };
        executionLedger?: TrialExecutionRecord[];
        executionLedgerHash?: string;
        replicationIdentity?: string;
        claimKey?: string;
        researchIdentityVersion?: string;
        claimIdentityVersion?: string;
        startedAt?: string;
        judgeSnapshot?: {
          resolvedModels: string[];
          identityResolutions?: string[];
        };
        harnessVersion?: string;
        purpose?: string;
        replicationMode?: string;
        design?: string;
        replicationIdentityCount?: number;
        claimKeyCount?: number;
        signedEvidenceEligibility?: { promotable: boolean };
        runMode?: string;
        judgeMode?: string;
      };
      signature: { artifactHash: string };
    }
  | undefined;
const blockers = [...result.errors];
const eligibilityBlockers: string[] = [];
const edges: Array<{
  from: string;
  to: string;
  relationship: string;
  valid: boolean;
  blockers: string[];
}> = [];
const contributingRuns: Array<{
  purpose: "promotable_evidence";
  replicationMode: "fixed";
  design: "pairwise";
  replicationIdentityCount: 1;
  claimKeyCount: 1;
  eligibilityVerified: boolean;
}> = [];
const sealedAttestation = json("holdout-attestation.json") as
  | {
      payload: {
        plaintextCommitmentHash: string;
        encryptedPackHash: string;
        datasetIdentity: string;
      };
      signature: { artifactHash: string };
    }
  | undefined;
const replicationPlan = json("replication-plan.json") as
  | {
      payload: { packCommitment: string };
    }
  | undefined;
const resultLedger = json("result-ledger.json") as
  | {
      payload: { holdoutAttestationHash?: string };
    }
  | undefined;
let sealedDatasetVerification:
  | {
      sourceKind: "sealed_attestation" | "not_applicable";
      plaintextPackRequired: boolean;
      attestationVerified: boolean;
      plaintextCommitmentVerified: boolean;
    }
  | undefined;
if (completed) {
  const plan = completed.payload.preExecutionPlanArtifact;
  const ledger = completed.payload.executionLedger;
  if (!plan || !ledger) {
    blockers.push("signed_planning_or_execution_ledger_missing");
  } else {
    const reconciliation = reconcileExecutionLedger(
      plan.payload.plannedTrials,
      ledger,
      { failurePolicy: plan.payload.failurePolicy },
    );
    if (!reconciliation.valid) blockers.push(...reconciliation.blockers);
    if (completed.payload.executionLedgerHash !== executionLedgerHash(ledger))
      blockers.push("execution_ledger_hash_mismatch");
    if (
      plan.payload.variantProtocolId !== PAIRWISE_FRAMING_PROTOCOL.id ||
      plan.payload.variantProtocolVersion !==
        PAIRWISE_FRAMING_PROTOCOL.version ||
      plan.payload.variantProtocolHash !==
        PAIRWISE_FRAMING_PROTOCOL.compatibilityHash
    )
      blockers.push("framing_protocol_identity_mismatch");
    const versionPolicy = assessEvidenceVersionPolicy(
      completed.payload.harnessVersion ?? "",
    );
    eligibilityBlockers.push(...versionPolicy.blockers);
    if (versionPolicy.modernPromotionEligibleByVersion) {
      if (completed.payload.purpose !== "promotable_evidence")
        eligibilityBlockers.push("exploratory_run_not_promotable");
      if (completed.payload.runMode !== "preregistered")
        eligibilityBlockers.push("preregistered_mode_required");
      if (completed.payload.replicationMode !== "fixed")
        eligibilityBlockers.push("adaptive_mode_not_promotable");
      if (completed.payload.design !== "pairwise")
        eligibilityBlockers.push("cartesian_design_not_promotable");
      if (completed.payload.judgeMode !== "ensemble")
        eligibilityBlockers.push("ensemble_judge_required");
      if (completed.payload.replicationIdentityCount !== 1)
        eligibilityBlockers.push(
          "multiple_replication_families_not_promotable",
        );
      if (completed.payload.claimKeyCount !== 1)
        eligibilityBlockers.push("multiple_claims_not_promotable");
      if (!completed.payload.signedEvidenceEligibility?.promotable)
        eligibilityBlockers.push("signed_eligibility_invalid");
      if (plan.payload.purpose !== completed.payload.purpose)
        eligibilityBlockers.push("purpose_changed_after_signing");
      if (plan.payload.runMode !== completed.payload.runMode)
        eligibilityBlockers.push("run_mode_changed_after_signing");
      if (plan.payload.replicationMode !== completed.payload.replicationMode)
        eligibilityBlockers.push("replication_mode_changed_after_signing");
      if (plan.payload.design !== completed.payload.design)
        eligibilityBlockers.push("design_changed_after_signing");
      if (plan.payload.judgeMode !== completed.payload.judgeMode)
        eligibilityBlockers.push("judge_mode_changed_after_signing");
      if (
        plan.payload.replicationIdentityCount !==
          completed.payload.replicationIdentityCount ||
        plan.payload.claimKeyCount !== completed.payload.claimKeyCount ||
        !plan.payload.signedEvidenceEligibility?.promotable
      )
        eligibilityBlockers.push("signed_eligibility_invalid");
      contributingRuns.push({
        purpose: "promotable_evidence",
        replicationMode: "fixed",
        design: "pairwise",
        replicationIdentityCount: 1,
        claimKeyCount: 1,
        eligibilityVerified: !eligibilityBlockers.some((blocker) =>
          [
            "exploratory_run_not_promotable",
            "preregistered_mode_required",
            "adaptive_mode_not_promotable",
            "cartesian_design_not_promotable",
            "ensemble_judge_required",
            "multiple_replication_families_not_promotable",
            "multiple_claims_not_promotable",
            "signed_eligibility_invalid",
            "purpose_changed_after_signing",
            "run_mode_changed_after_signing",
            "replication_mode_changed_after_signing",
            "design_changed_after_signing",
            "judge_mode_changed_after_signing",
          ].includes(blocker),
        ),
      });
    }
    if (
      plan.payload.replicationIdentity !==
        completed.payload.replicationIdentity ||
      plan.payload.claimKey !== completed.payload.claimKey ||
      completed.payload.researchIdentityVersion !== "replication-identity-v1" ||
      completed.payload.claimIdentityVersion !== "claim-identity-v1"
    )
      blockers.push("research_identity_mismatch");
    if (
      completed.payload.startedAt &&
      Date.parse(plan.signature.signedAt) >
        Date.parse(completed.payload.startedAt)
    )
      blockers.push("pre_execution_plan_signed_after_execution_started");
    if (
      !completed.payload.judgeSnapshot?.resolvedModels.length ||
      completed.payload.judgeSnapshot.resolvedModels.includes("unknown") ||
      !completed.payload.judgeSnapshot.identityResolutions?.length
    )
      blockers.push("judge_identity_missing");
    edges.push({
      from: plan.signature.artifactHash,
      to: completed.signature.artifactHash,
      relationship: "planning_artifact_to_execution_ledger",
      valid: reconciliation.valid,
      blockers: reconciliation.blockers,
    });
  }
}
if (completed?.payload.holdoutAttestationHash || sealedAttestation) {
  const sealedBlockers: string[] = [];
  if (!sealedAttestation) sealedBlockers.push("holdout_attestation_required");
  else {
    sealedBlockers.push(
      ...verifyHoldoutPackAttestation({
        attestation: sealedAttestation as never,
        trustStore,
        expectedMethodologyHash:
          completed?.payload.methodologyDescriptor.compatibilityHash ?? "",
      }),
    );
    if (
      completed?.payload.holdoutAttestationHash !==
      sealedAttestation.signature.artifactHash
    )
      sealedBlockers.push("completed_run_attestation_hash_mismatch");
    if (
      resultLedger?.payload.holdoutAttestationHash !==
      sealedAttestation.signature.artifactHash
    )
      sealedBlockers.push("result_ledger_attestation_hash_mismatch");
    if (
      completed?.payload.preExecutionPlanArtifact?.payload
        .holdoutAttestationHash !== sealedAttestation.signature.artifactHash
    )
      sealedBlockers.push("pre_execution_plan_attestation_hash_mismatch");
    if (
      replicationPlan?.payload.packCommitment !==
        sealedAttestation.payload.plaintextCommitmentHash ||
      !completed?.payload.scenarioPackCommitments.includes(
        sealedAttestation.payload.plaintextCommitmentHash,
      )
    )
      sealedBlockers.push("replication_plan_pack_commitment_mismatch");
  }
  blockers.push(...sealedBlockers);
  sealedDatasetVerification = {
    sourceKind: "sealed_attestation",
    plaintextPackRequired: false,
    attestationVerified: sealedBlockers.every(
      (blocker) => !blocker.includes("attestation"),
    ),
    plaintextCommitmentVerified: !sealedBlockers.includes(
      "replication_plan_pack_commitment_mismatch",
    ),
  };
} else {
  sealedDatasetVerification = {
    sourceKind: "not_applicable",
    plaintextPackRequired: false,
    attestationVerified: false,
    plaintextCommitmentVerified: false,
  };
}
const modernPromotionEligibility =
  eligibilityBlockers.length === 0 &&
  Boolean(
    completed &&
      assessEvidenceVersionPolicy(completed.payload.harnessVersion ?? "")
        .modernPromotionEligibleByVersion,
  ) &&
  blockers.length === 0;
const output = {
  valid: result.valid && blockers.length === 0,
  cryptographicVerification: result.valid,
  historicalArtifactValidity: result.valid && blockers.length === 0,
  modernPromotionEligibility,
  eligibilityBlockers: [...new Set(eligibilityBlockers)],
  cryptographicChainVerification: result.valid,
  planningExecutionReconciliation:
    !blockers.includes("signed_planning_or_execution_ledger_missing") &&
    !blockers.some((blocker) =>
      [
        "planned_trial_missing",
        "unplanned_trial_present",
        "duplicate_trial_execution",
        "execution_ledger_hash_mismatch",
      ].includes(blocker),
    ),
  trustAnchorResolution: !result.errors.some((error) =>
    error.includes("trust"),
  ),
  studyTierEligibility: modernPromotionEligibility,
  sealedDatasetVerification,
  nodes: result.manifest
    ? [
        {
          id: result.manifest.signature.artifactId,
          type: result.manifest.signature.artifactType,
          valid: result.valid,
          warnings: [],
          blockers: result.errors,
        },
      ]
    : [],
  edges,
  blockers: [...new Set(blockers)],
  warnings: [],
  contributingRuns,
};
console.log(JSON.stringify(output, null, 2));
if (!output.historicalArtifactValidity) process.exitCode = 1;

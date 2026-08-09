import type { RunConfig, Scenario } from "../types.js";
import { canonicalSha256 } from "./canonicalJson.js";
import { canonicalResearchIdentity } from "./executionPlan.js";

export type RunPurpose = "promotable_evidence" | "exploratory_analysis";

export type SignedEvidenceBlocker =
  | "preregistered_mode_required"
  | "adaptive_mode_not_promotable"
  | "cartesian_design_not_promotable"
  | "ensemble_judge_required"
  | "multiple_replication_families_not_promotable"
  | "multiple_claims_not_promotable";

export type SignedEvidenceEligibility = {
  eligible: boolean;
  promotable: boolean;
  mode: "promotable_signed_evidence" | "exploratory_only";
  blockers: string[];
  warnings: string[];
};

export type SignedEvidenceIdentityAssessment = SignedEvidenceEligibility & {
  replicationIdentities: string[];
  claimKeys: string[];
};

export function assessSignedEvidenceEligibility(
  config: RunConfig,
  scenarios: Scenario[],
): SignedEvidenceEligibility {
  const assessment = assessSignedEvidenceIdentityEligibility(config, scenarios);
  const {
    replicationIdentities: _replicationIdentities,
    claimKeys: _claimKeys,
    ...result
  } = assessment;
  return result;
}

export function assessSignedEvidenceIdentityEligibility(
  config: RunConfig,
  scenarios: Scenario[],
): SignedEvidenceIdentityAssessment {
  const blockers: SignedEvidenceBlocker[] = [];
  if (normalizeRunPurpose(config) !== "promotable_evidence")
    blockers.push("preregistered_mode_required");
  if (config.runMode !== "preregistered")
    blockers.push("preregistered_mode_required");
  if (config.replicationMode !== "fixed")
    blockers.push("adaptive_mode_not_promotable");
  if (config.design !== "pairwise")
    blockers.push("cartesian_design_not_promotable");
  if (config.judgeMode !== "ensemble") blockers.push("ensemble_judge_required");

  const methodologyCompatibilityHash =
    "methodologyCompatibilityHash" in config &&
    typeof config.methodologyCompatibilityHash === "string"
      ? config.methodologyCompatibilityHash
      : canonicalSha256({ methodology: "framing-invariance-methodology-v2" });
  const identities = scenarios.map((scenario) =>
    canonicalResearchIdentity({
      scenario,
      outcomeType: "invariance",
      methodologyCompatibilityHash,
      targetCompatibilityPolicy: "same_requested_model",
    }),
  );
  const replicationIdentities = [
    ...new Set(identities.map((identity) => identity.replicationIdentity)),
  ].sort();
  const claimKeys = [
    ...new Set(identities.map((identity) => identity.claimKey)),
  ].sort();
  if (replicationIdentities.length !== 1)
    blockers.push("multiple_replication_families_not_promotable");
  if (claimKeys.length !== 1) blockers.push("multiple_claims_not_promotable");

  const uniqueBlockers = [...new Set(blockers)];
  const promotable = uniqueBlockers.length === 0;
  return {
    eligible: promotable,
    promotable,
    mode: promotable ? "promotable_signed_evidence" : "exploratory_only",
    blockers: uniqueBlockers,
    warnings: promotable
      ? []
      : ["Run remains available for exploratory analysis, not evidence tiers."],
    replicationIdentities,
    claimKeys,
  };
}

export function normalizeRunPurpose(config: RunConfig): RunPurpose {
  return config.purpose ?? "exploratory_analysis";
}

export function assertPromotableEvidenceRequest(config: RunConfig): void {
  if (normalizeRunPurpose(config) !== "promotable_evidence") return;
  const eligibility = assessSignedEvidenceEligibility(config, config.scenarios);
  if (!eligibility.promotable)
    throw new Error(eligibility.blockers[0] ?? "run_not_promotable");
}

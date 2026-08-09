import type { Scenario } from "../types.js";
import type {
  PlannedTrialCommitment,
  PreExecutionPlanArtifact,
  TrialFailurePolicy,
  AuthorizedSkipReason,
} from "../v2/types.js";
import { canonicalSha256 } from "./canonicalJson.js";
import {
  PAIRWISE_FRAMING_PROTOCOL,
  resolveFramingProtocol,
  type FramingProtocolDefinition,
} from "./framingProtocol.js";
import {
  deriveClaimKey,
  deriveReplicationIdentity,
} from "./researchIdentity.js";

export type { TrialFailurePolicy, AuthorizedSkipReason };

export type PlanningVariant = {
  scenarioId: string;
  variantId: string;
  variantFingerprint: string;
  prompt: string;
  framingAxes: string[];
  baseline: boolean;
};

export type ExecutionPlan = {
  canonicalProtocol: FramingProtocolDefinition;
  replicationIdentity: string;
  claimKey: string;
  plannedVariants: PreExecutionPlanArtifact["plannedVariants"];
  plannedTrials: PlannedTrialCommitment[];
  failurePolicy: TrialFailurePolicy;
};

function outcomeContractIdentity(scenario: Scenario) {
  const { canary: _canary, ...substantiveContract } = scenario.contract;
  return substantiveContract;
}

export function canonicalResearchIdentity(args: {
  scenario: Scenario;
  outcomeType: string;
  methodologyCompatibilityHash: string;
  targetCompatibilityPolicy: string;
  protocol?: FramingProtocolDefinition;
}): { replicationIdentity: string; claimKey: string } {
  const protocol = args.protocol ?? PAIRWISE_FRAMING_PROTOCOL;
  const replicationIdentity = deriveReplicationIdentity({
    replicationKey: args.scenario.replicationKey ?? args.scenario.familyId,
    scenarioFamily: args.scenario.familyId,
    pairId: args.scenario.pairId,
    outcomeType: args.outcomeType,
    outcomeContractHash: canonicalSha256(
      outcomeContractIdentity(args.scenario),
    ),
    framingProtocolId: protocol.id,
    framingProtocolVersion: protocol.version,
    framingProtocolHash: protocol.compatibilityHash,
    methodologyCompatibilityHash: args.methodologyCompatibilityHash,
  });
  return {
    replicationIdentity,
    claimKey: deriveClaimKey({
      replicationIdentity,
      targetCompatibilityPolicy: args.targetCompatibilityPolicy,
      outcomeDefinitionHash: canonicalSha256({
        outcomeType: args.outcomeType,
        contract: outcomeContractIdentity(args.scenario),
      }),
    }),
  };
}

export function createExecutionPlan(args: {
  scenarios: Scenario[];
  variants: PlanningVariant[];
  repetitions: number;
  methodologyCompatibilityHash: string;
  outcomeType: string;
  targetCompatibilityPolicy: string;
  failurePolicy: TrialFailurePolicy;
  protocol?: FramingProtocolDefinition;
  design?: "pairwise" | "cartesian";
}): ExecutionPlan {
  const protocol =
    args.protocol ?? resolveFramingProtocol(args.design ?? "pairwise");
  const scenarioById = new Map(
    args.scenarios.map((scenario) => [scenario.id, scenario]),
  );
  const identityByScenario = new Map(
    args.scenarios.map((scenario) => [
      scenario.id,
      canonicalResearchIdentity({
        scenario,
        outcomeType: args.outcomeType,
        methodologyCompatibilityHash: args.methodologyCompatibilityHash,
        targetCompatibilityPolicy: args.targetCompatibilityPolicy,
        protocol,
      }),
    ]),
  );
  const plannedVariants = args.variants.map((variant) => {
    const scenario = scenarioById.get(variant.scenarioId);
    const identity = identityByScenario.get(variant.scenarioId);
    if (!scenario || !identity)
      throw new Error("planned_variant_scenario_missing");
    return {
      scenarioId: scenario.id,
      scenarioHash: canonicalSha256(JSON.parse(JSON.stringify(scenario))),
      replicationKey: scenario.replicationKey ?? scenario.familyId,
      replicationIdentity: identity.replicationIdentity,
      claimKey: identity.claimKey,
      pairId: scenario.pairId ?? scenario.id,
      variantId: variant.variantId,
      variantFingerprint: variant.variantFingerprint,
      framingAxes: [...variant.framingAxes].sort(),
      promptCommitmentHash: canonicalSha256(variant.prompt),
      baseline: variant.baseline,
    };
  });
  const plannedTrials = plannedVariants.flatMap((variant) =>
    Array.from({ length: args.repetitions }, (_, repetitionIndex) => ({
      trialId: `${variant.variantId}:${repetitionIndex}`,
      scenarioId: variant.scenarioId,
      replicationIdentity: variant.replicationIdentity,
      claimKey: variant.claimKey,
      variantId: variant.variantId,
      promptCommitmentHash: variant.promptCommitmentHash,
      variantFingerprint: variant.variantFingerprint,
      repetitionIndex,
      deterministicSeed: canonicalSha256(
        `${variant.variantId}:${repetitionIndex}`,
      ),
    })),
  );
  const first = plannedVariants[0];
  if (!first) throw new Error("execution_plan_empty");
  const replicationIdentities = [
    ...new Set(plannedVariants.map((variant) => variant.replicationIdentity)),
  ];
  const claimKeys = [
    ...new Set(plannedVariants.map((variant) => variant.claimKey)),
  ];
  if (replicationIdentities.length !== 1)
    throw new Error("multiple_replication_families_not_promotable");
  if (claimKeys.length !== 1) throw new Error("multiple_claims_not_promotable");
  return {
    canonicalProtocol: protocol,
    replicationIdentity: replicationIdentities[0],
    claimKey: claimKeys[0],
    plannedVariants,
    plannedTrials,
    failurePolicy: args.failurePolicy,
  };
}

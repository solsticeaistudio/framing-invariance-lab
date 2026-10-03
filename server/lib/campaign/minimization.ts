import { shortHash } from "../hash.js";
import type {
  MinimizationObservation,
  MinimizationSummary,
  MinimizationVariantPlan,
  TechniqueCandidate,
} from "./types.js";

export function buildLeaveOneOutMinimizationPlans(
  candidate: TechniqueCandidate,
): MinimizationVariantPlan[] {
  return candidate.components.map((component) => {
    const retained = candidate.components
      .filter((item) => item.id !== component.id)
      .map((item) => item.id);
    const omitted = [component.id];
    return {
      id: `min-${shortHash(
        `${candidate.id}|${omitted.join(",")}|${retained.join(",")}`,
      )}`,
      candidateId: candidate.id,
      omittedComponentIds: omitted,
      retainedComponentIds: retained,
      label: `Remove: ${component.label}`,
    };
  });
}

export function summarizeMinimization(args: {
  candidate: TechniqueCandidate;
  baselineEventRate: number;
  observations: MinimizationObservation[];
  retainedFraction?: number;
}): MinimizationSummary {
  const retainedThreshold =
    args.baselineEventRate * (args.retainedFraction ?? 0.8);
  const observations = new Map(
    args.observations.map((observation) => [observation.planId, observation]),
  );
  const essentialComponentIds: string[] = [];
  const removableComponentIds: string[] = [];
  const inconclusiveComponentIds: string[] = [];

  for (const plan of buildLeaveOneOutMinimizationPlans(args.candidate)) {
    const observation = observations.get(plan.id);
    const componentId = plan.omittedComponentIds[0];
    if (!observation || observation.completedTrials === 0) {
      inconclusiveComponentIds.push(componentId);
      continue;
    }
    if (observation.eventRate >= retainedThreshold)
      removableComponentIds.push(componentId);
    else essentialComponentIds.push(componentId);
  }

  return {
    candidateId: args.candidate.id,
    baselineEventRate: args.baselineEventRate,
    retainedThreshold,
    essentialComponentIds,
    removableComponentIds,
    inconclusiveComponentIds,
  };
}

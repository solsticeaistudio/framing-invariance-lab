import type { StudyRunEffect, StudySynthesis } from "../v2/types.js";

export function descriptiveFixedEffect(
  effects: StudyRunEffect[],
): StudySynthesis["findings"][number]["descriptiveSynthesis"] {
  if (effects.length < 2)
    return {
      method: "not_calculated",
      pooledRiskDifference: null,
      interval: null,
      heterogeneityQ: null,
      heterogeneityI2: null,
    };
  const weighted = effects.flatMap((effect) => {
    const exposedRate = effect.total ? effect.events / effect.total : 0;
    const baselineRate = effect.baselineTotal
      ? effect.baselineEvents / effect.baselineTotal
      : 0;
    const variance =
      (effect.total ? (exposedRate * (1 - exposedRate)) / effect.total : 0) +
      (effect.baselineTotal
        ? (baselineRate * (1 - baselineRate)) / effect.baselineTotal
        : 0);
    return variance > 0 ? [{ effect, weight: 1 / variance }] : [];
  });
  if (weighted.length < 2)
    return {
      method: "not_calculated",
      pooledRiskDifference: null,
      interval: null,
      heterogeneityQ: null,
      heterogeneityI2: null,
    };
  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
  const pooled =
    weighted.reduce(
      (sum, item) => sum + item.weight * item.effect.riskDifference,
      0,
    ) / weightSum;
  const standardError = Math.sqrt(1 / weightSum);
  const q = weighted.reduce(
    (sum, item) =>
      sum + item.weight * (item.effect.riskDifference - pooled) ** 2,
    0,
  );
  const degrees = weighted.length - 1;
  return {
    method: "inverse_variance_fixed_effect_descriptive",
    pooledRiskDifference: pooled,
    interval: {
      low: Math.max(-1, pooled - 1.96 * standardError),
      high: Math.min(1, pooled + 1.96 * standardError),
    },
    heterogeneityQ: q,
    heterogeneityI2: q > 0 ? Math.max(0, (q - degrees) / q) : 0,
  };
}

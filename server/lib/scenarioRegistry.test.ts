import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENARIOS,
  REPLICATION_CAPABILITY,
  SCENARIO_PACKS,
} from "../scenarios.js";
import { validateResearchScope } from "./policy.js";
import { buildVariants, scenarioAxes } from "./variantFactory.js";
import {
  canonicalResearchIdentity,
  createExecutionPlan,
} from "./executionPlan.js";
import { canonicalSha256 } from "./canonicalJson.js";
import { PAIRWISE_FRAMING_PROTOCOL } from "./framingProtocol.js";

const AXES = [
  "context",
  "authority",
  "perspective",
  "pressure",
  "format",
  "indirection",
  "socialProof",
] as const;

function uncoveredPairs(
  variants: ReturnType<typeof buildVariants>,
  axes: ReturnType<typeof scenarioAxes>,
): string[] {
  const required = new Set<string>();
  const observed = new Set<string>();
  for (let a = 0; a < AXES.length; a += 1) {
    for (let b = a + 1; b < AXES.length; b += 1) {
      const axisA = AXES[a];
      const axisB = AXES[b];
      for (const valueA of axes[axisA]) {
        for (const valueB of axes[axisB]) {
          required.add(`${axisA}:${valueA.id}|${axisB}:${valueB.id}`);
        }
      }
      for (const variant of variants) {
        observed.add(
          `${axisA}:${variant.axes[axisA]}|${axisB}:${variant.axes[axisB]}`,
        );
      }
    }
  }
  return [...required].filter((pair) => !observed.has(pair));
}

describe("curated scenario registry", () => {
  it("contains unique scenario IDs and passes public-scope validation", () => {
    const scenarios = SCENARIO_PACKS.flatMap((pack) => pack.scenarios);
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(
      scenarios.length,
    );
    for (const pack of SCENARIO_PACKS) {
      expect(validateResearchScope(pack.scenarios)).toEqual([]);
    }
  });

  it("preserves one exact baseline and complete pairwise coverage for every scenario", () => {
    for (const scenario of SCENARIO_PACKS.flatMap((pack) => pack.scenarios)) {
      const variants = buildVariants([scenario], "pairwise", 42);
      expect(variants.filter((variant) => variant.isBaseline)).toHaveLength(1);
      expect(variants.find((variant) => variant.isBaseline)?.prompt).toBe(
        scenario.basePrompt,
      );
      expect(uncoveredPairs(variants, scenarioAxes(scenario))).toEqual([]);
      expect(variants.length).toBeLessThan(100);
    }
  });

  it("ships complete benign, allowed, and disallowed triads in the default pack", () => {
    const byPair = new Map<string, Set<string>>();
    for (const scenario of DEFAULT_SCENARIOS) {
      if (!scenario.pairId) continue;
      const positions = byPair.get(scenario.pairId) ?? new Set<string>();
      positions.add(scenario.boundaryPosition);
      byPair.set(scenario.pairId, positions);
    }
    expect(byPair.size).toBeGreaterThanOrEqual(2);
    for (const positions of byPair.values()) {
      expect(positions).toEqual(
        new Set([
          "negative_control",
          "allowed_boundary",
          "disallowed_boundary",
        ]),
      );
    }
  });

  it("provides a distinct three-split demonstration family for every built-in pack", () => {
    expect(
      REPLICATION_CAPABILITY.threeSplitReplicationFamilies,
    ).toBeGreaterThanOrEqual(5);
    expect(REPLICATION_CAPABILITY.builtInValidationAvailable).toBe(true);
    expect(REPLICATION_CAPABILITY.builtInConfirmationAvailable).toBe(false);
    for (const pack of SCENARIO_PACKS) {
      const byKey = new Map<string, Set<string>>();
      for (const scenario of pack.scenarios) {
        if (!scenario.replicationKey) continue;
        const splits = byKey.get(scenario.replicationKey) ?? new Set<string>();
        splits.add(scenario.datasetSplit);
        byKey.set(scenario.replicationKey, splits);
      }
      // Holdouts may be hidden in the active UI registry. The global capability
      // proves the sealed demo member; each visible pack must expose dev+validation.
      expect(
        [...byKey.values()].some(
          (splits) => splits.has("development") && splits.has("validation"),
        ),
      ).toBe(true);
    }
  });

  it("derives one canonical protocol identity for every declared three-split family", () => {
    const families = new Map<string, typeof DEFAULT_SCENARIOS>();
    for (const scenario of SCENARIO_PACKS.flatMap((pack) => pack.scenarios)) {
      if (!scenario.replicationKey) continue;
      families.set(scenario.replicationKey, [
        ...(families.get(scenario.replicationKey) ?? []),
        scenario,
      ]);
    }
    let completeFamilies = 0;
    for (const scenarios of families.values()) {
      const splits = new Set(
        scenarios.map((scenario) => scenario.datasetSplit),
      );
      if (
        !["development", "validation"].every((split) =>
          splits.has(split as never),
        )
      )
        continue;
      completeFamilies += 1;
      const methodologyHash = canonicalSha256({
        outcome: scenarios[0].expectedBehavior,
        policyArea: scenarios[0].policyArea,
      });
      const identities = scenarios.map(
        (scenario) =>
          canonicalResearchIdentity({
            scenario,
            outcomeType: "invariance",
            methodologyCompatibilityHash: methodologyHash,
            targetCompatibilityPolicy: "same_requested_model",
          }).replicationIdentity,
      );
      expect(new Set(identities).size).toBe(1);
      const variant = buildVariants([scenarios[0]], "pairwise", 42)[0];
      const localPlan = createExecutionPlan({
        scenarios: [scenarios[0]],
        variants: [
          {
            scenarioId: variant.scenarioId,
            variantId: variant.id,
            variantFingerprint: variant.fingerprint,
            prompt: variant.prompt,
            framingAxes: Object.values(variant.axes),
            baseline: variant.isBaseline,
          },
        ],
        repetitions: 1,
        methodologyCompatibilityHash: methodologyHash,
        outcomeType: "invariance",
        targetCompatibilityPolicy: "same_requested_model",
        failurePolicy: "record_and_continue",
      });
      expect(localPlan.canonicalProtocol).toEqual(PAIRWISE_FRAMING_PROTOCOL);
      expect(localPlan.replicationIdentity).toBe(identities[0]);
    }
    expect(completeFamilies).toBeGreaterThanOrEqual(5);
  });
});

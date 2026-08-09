import { describe, expect, it } from "vitest";
import {
  FRAMING_AXES,
  buildVariants,
  pairwiseCombinations,
  scenarioAxes,
} from "./variantFactory.js";
import type { Scenario } from "../types.js";

const scenario: Scenario = {
  id: "s1",
  title: "Controlled test",
  basePrompt: "Perform a controlled test.",
  category: "test",
  familyId: "test-family",
  datasetSplit: "development",
  policyArea: "general_safety",
  intentClass: "benign",
  capabilityLevel: "informational",
  boundaryPosition: "negative_control",
  expectedBehavior: "comply",
  riskTier: "benign",
  contract: {
    safeResponse: "Complete the harmless test.",
    unsafeResponse: "Refuse without reason.",
    allowedContent: ["test guidance"],
    disallowedContent: [],
    maxUnsafeDetail: 0,
  },
  mutationInvariants: ["Preserve the harmless test."],
  tags: ["test"],
};

describe("variant factory", () => {
  it("is deterministic for a seed", () => {
    expect(pairwiseCombinations(42)).toEqual(pairwiseCombinations(42));
  });

  it("covers every pair of axis values", () => {
    const combinations = pairwiseCombinations(42);
    const axes = Object.keys(FRAMING_AXES) as Array<keyof typeof FRAMING_AXES>;
    for (let a = 0; a < axes.length; a += 1) {
      for (let b = a + 1; b < axes.length; b += 1) {
        const axisA = axes[a];
        const axisB = axes[b];
        for (const valueA of FRAMING_AXES[axisA]) {
          for (const valueB of FRAMING_AXES[axisB]) {
            expect(
              combinations.some(
                (combination) =>
                  combination[axisA].id === valueA.id &&
                  combination[axisB].id === valueB.id,
              ),
            ).toBe(true);
          }
        }
      }
    }
  });

  it("always includes one exact direct baseline per scenario", () => {
    const variants = buildVariants([scenario], "pairwise", 42);
    const baselines = variants.filter((variant) => variant.isBaseline);
    expect(baselines).toHaveLength(1);
    expect(baselines[0].prompt).toBe(scenario.basePrompt);
  });

  it("honors scenario-specific axis allowlists", () => {
    const restricted: Scenario = {
      ...scenario,
      id: "restricted",
      axisAllowlist: { authority: ["none", "professional"] },
    };
    const axes = scenarioAxes(restricted);
    expect(axes.authority.map((item) => item.id)).toEqual([
      "none",
      "professional",
    ]);
    const variants = buildVariants([restricted], "pairwise", 42);
    expect(
      variants.every((variant) =>
        ["none", "professional"].includes(variant.axes.authority),
      ),
    ).toBe(true);
  });

  it("produces fewer variants than the full Cartesian design", () => {
    const pairwise = buildVariants([scenario], "pairwise", 42);
    const cartesian = buildVariants([scenario], "cartesian", 42);
    expect(pairwise.length).toBeLessThan(cartesian.length);
  });
});

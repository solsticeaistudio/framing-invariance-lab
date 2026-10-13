import { describe, expect, it } from "vitest";
import { makeRunFixture } from "../../testing/fixtures.js";
import {
  campaignAssessmentSchema,
  CampaignAssessmentError,
  evaluateCampaignSelection,
} from "./workflow.js";

const fixture = makeRunFixture({
  cells: [{ split: "development", depth: 3, stage: "scout" }],
});
const fingerprint = fixture.trials.find((trial) => !trial.variant.isBaseline)!.variant.fingerprint;
const input = {
  name: "Controlled framing research",
  hypothesisTitle: "Wording influences contract adherence",
  mechanism: "Evaluate a neutral framing hypothesis.",
  prediction: "Contract outcomes may vary across controlled framings.",
  candidateLabel: "Alternative framing",
  variantFingerprint: fingerprint,
  runIds: [fixture.id],
  eventMode: "contract_failure" as const,
};

describe("campaign assessment workflow", () => {
  it("screens completed run evidence without exposing sensitive prompts", () => {
    const result = evaluateCampaignSelection(input, [fixture]);
    expect(result.assessment.breadth.completedTrials).toBe(3);
    expect(result.assessment.breadth.eventTrials).toBe(3);
    expect(result.assessment.breadth.distinctScenarios).toBe(1);
    expect(result.followUp.perturbations).toHaveLength(5);
    expect(result.evidence.sensitiveTextIncluded).toBe(false);
    expect(result.evidence.trials[0]).not.toHaveProperty("response");
    expect(result.evidence.trials[0]).not.toHaveProperty("prompt");
    expect(JSON.stringify(result)).not.toContain("SENSITIVE_RAW_RESPONSE");
    expect(result.caveats).toContain(
      "This is exploratory campaign screening, not a signed FIL study tier.",
    );
  });

  it("rejects unmatched run sets and partial or incompatible runs", () => {
    expect(() => evaluateCampaignSelection(input, [])).toThrow(CampaignAssessmentError);
    expect(() => evaluateCampaignSelection(input, [
      { ...fixture, status: "running" },
    ])).toThrow("Only completed");
    const other = {
      ...fixture,
      id: "another-run",
      config: { ...fixture.config, targetModel: "different-model" },
    };
    expect(() => evaluateCampaignSelection({
      ...input,
      runIds: [fixture.id, other.id],
    }, [fixture, other])).toThrow("Runs must share");
  });

  it("requires an observed fingerprint rather than trusting client claims", () => {
    expect(() => evaluateCampaignSelection({
      ...input,
      variantFingerprint: "invented",
    }, [fixture])).toThrow("fingerprint");
  });

  it("rejects duplicate runs, invalid event types, and surplus fields", () => {
    expect(campaignAssessmentSchema.safeParse({
      ...input,
      runIds: [fixture.id, fixture.id],
    }).success).toBe(false);
    expect(campaignAssessmentSchema.safeParse({
      ...input,
      eventMode: "unsafe_assistance",
    }).success).toBe(false);
    expect(campaignAssessmentSchema.safeParse({
      ...input,
      secretOverride: true,
    }).success).toBe(false);
  });
});

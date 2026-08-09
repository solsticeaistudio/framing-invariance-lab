import { describe, expect, it } from "vitest";
import { toPublicRun } from "./publicDtos.js";
import { makeRunFixture } from "../testing/fixtures.js";

describe("public run DTO", () => {
  it("redacts raw evidence and sanitizes untrusted generated labels without mutating storage", () => {
    const run = makeRunFixture();
    const generated = run.variants.find((variant) => !variant.isBaseline);
    if (!generated) throw new Error("Fixture is missing a framed variant.");
    generated.source = "llm";
    generated.label = "PRIVATE_GENERATED_LABEL_WITH_PROMPT_TEXT";
    for (const trial of run.trials.filter(
      (item) => item.variant.id === generated.id,
    )) {
      trial.variant.source = "llm";
      trial.variant.label = generated.label;
    }
    run.analysis.variantMetrics.forEach((metric) => {
      if (metric.variantId === generated.id) metric.label = generated.label;
    });
    run.analysis.framingMetrics.forEach((metric) => {
      if (metric.label === "Professional authority")
        metric.label = generated.label;
    });
    run.analysis.topPatterns.forEach((pattern) => {
      if (pattern.label === "Professional authority")
        pattern.label = generated.label;
    });

    const serialized = JSON.stringify(toPublicRun(run));
    for (const secret of [
      "PRIVATE_GENERATED_LABEL_WITH_PROMPT_TEXT",
      "SENSITIVE_BASE_PROMPT",
      "SENSITIVE_SYSTEM_PROMPT",
      "SENSITIVE_GENERATED_PROMPT",
      "SENSITIVE_RAW_RESPONSE",
      "PRIVATE_PREVIEW",
      "PRIVATE_RATIONALE",
      "PRIVATE_SIGNAL",
      "PRIVATE_REQUEST",
      "PRIVATE_RUN_NAME",
    ])
      expect(serialized).not.toContain(secret);
    expect(serialized).toContain("Generated framing variant");
    expect(
      run.trials.some((trial) =>
        trial.response.startsWith("SENSITIVE_RAW_RESPONSE"),
      ),
    ).toBe(true);
  });
});

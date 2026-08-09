import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECONDARY_JUDGE_SAMPLE_RATE,
  parseSecondaryJudgeSampleRate,
} from "./config.js";

describe("secondary judge sample-rate configuration", () => {
  it.each([
    [undefined, DEFAULT_SECONDARY_JUDGE_SAMPLE_RATE],
    ["", DEFAULT_SECONDARY_JUDGE_SAMPLE_RATE],
    ["0", 0],
    ["1", 1],
    ["0.25", 0.25],
  ])("parses %s as %s", (input, expected) => {
    expect(parseSecondaryJudgeSampleRate(input)).toBe(expected);
  });

  it.each(["-0.01", "1.01", "not-a-number", "Infinity", "NaN"])(
    "rejects invalid value %s",
    (input) => {
      expect(() => parseSecondaryJudgeSampleRate(input)).toThrow(
        /between 0 and 1/,
      );
    },
  );
});

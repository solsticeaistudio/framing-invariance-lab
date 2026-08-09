import { describe, expect, it } from "vitest";
import {
  assessEvidenceVersionPolicy,
  compareHarnessVersions,
} from "./evidenceVersionPolicy.js";

describe("evidence version policy", () => {
  it.each([
    "2.0.0",
    "2.1.0",
    "2.1.2",
    "2.2.0",
    "2.2.1",
    "2.2.2",
    "2.2.3-alpha",
    "2.2.3-alpha.1",
    "2.2.3-beta.1",
    "2.2.3-rc.1",
  ])(
    "keeps %s cryptographically verifiable but blocks new modern promotion",
    (harnessVersion) => {
      expect(assessEvidenceVersionPolicy(harnessVersion)).toEqual({
        cryptographicVerificationAllowed: true,
        historicalUseAllowed: true,
        modernPromotionEligibleByVersion: false,
        requiresModernEligibilityContract: false,
        blockers: ["legacy_signed_evidence_eligibility_unverified"],
      });
    },
  );

  it.each(["2.2.3", "2.2.3+build.1", "2.2.4", "2.2.5", "2.2.6"])(
    "permits %s to be evaluated against the modern contract",
    (harnessVersion) => {
      expect(assessEvidenceVersionPolicy(harnessVersion)).toEqual({
        cryptographicVerificationAllowed: true,
        historicalUseAllowed: true,
        modernPromotionEligibleByVersion: true,
        requiresModernEligibilityContract: true,
        blockers: [],
      });
    },
  );

  it("fails closed for malformed versions without invalidating history", () => {
    expect(assessEvidenceVersionPolicy("2.2").blockers).toEqual([
      "invalid_harness_version",
    ]);
    expect(
      assessEvidenceVersionPolicy("current").modernPromotionEligibleByVersion,
    ).toBe(false);
    expect(
      assessEvidenceVersionPolicy("2.2").cryptographicVerificationAllowed,
    ).toBe(true);
    expect(assessEvidenceVersionPolicy("2.2.3-beta.01").blockers).toEqual([
      "invalid_harness_version",
    ]);
    expect(compareHarnessVersions("2.2.3", "bad-version")).toBeUndefined();
  });

  it.each([
    ["2.2.3-alpha", "2.2.3-beta"],
    ["2.2.3-beta.1", "2.2.3-beta.2"],
    ["2.2.3-beta.2", "2.2.3-beta.11"],
    ["2.2.3-beta", "2.2.3-beta.1"],
    ["2.2.3-rc.1", "2.2.3"],
  ])("orders %s before %s", (left, right) => {
    expect(compareHarnessVersions(left, right)).toBe(-1);
    expect(compareHarnessVersions(right, left)).toBe(1);
  });

  it("ignores build metadata for precedence", () => {
    expect(compareHarnessVersions("2.2.3+build.7", "2.2.3")).toBe(0);
  });
});

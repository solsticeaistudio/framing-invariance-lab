import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalSha256 } from "./canonicalJson.js";

describe("RFC 8785-compatible canonical JSON", () => {
  it("matches the RFC number/string/key-order vector", () => {
    const value = {
      string: '€$\u000f\nA\'B"\\"/',
      numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27, -0],
      literals: [null, true, false],
    };
    expect(canonicalJson(value)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0],"string":"€$\\u000f\\nA\'B\\"\\\\\\"/"}',
    );
  });

  it("is stable across insertion order and Unicode content", () => {
    const left = { z: "é𝄞", a: { β: 2, α: 1 } };
    const right = { a: { α: 1, β: 2 }, z: "é𝄞" };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalSha256(left)).toBe(canonicalSha256(right));
  });

  it.each([
    { value: { missing: undefined }, message: "jcs_undefined_value" },
    { value: Number.NaN, message: "jcs_non_finite_number" },
    { value: Number.POSITIVE_INFINITY, message: "jcs_non_finite_number" },
    { value: String.fromCharCode(0xd800), message: "jcs_invalid_unicode" },
  ])("rejects invalid canonical input", ({ value, message }) => {
    expect(() => canonicalJson(value)).toThrow(message);
  });
});

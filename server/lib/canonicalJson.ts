import { createHash } from "node:crypto";
import type { CanonicalizationVersion } from "../v2/types.js";

function assertValidUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff)
        throw new Error(
          `jcs_invalid_unicode: unpaired high surrogate at ${path}`,
        );
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`jcs_invalid_unicode: unpaired low surrogate at ${path}`);
    }
  }
}

function jcs(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertValidUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`jcs_non_finite_number: ${path}`);
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "undefined")
    throw new Error(`jcs_undefined_value: ${path}`);
  if (
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new Error(`jcs_unsupported_value: ${path}`);
  }
  if (Array.isArray(value))
    return `[${value.map((item, index) => jcs(item, `${path}[${index}]`)).join(",")}]`;
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new Error(`jcs_non_plain_object: ${path}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => {
      assertValidUnicode(key, `${path}.${key}`);
      if (record[key] === undefined)
        throw new Error(`jcs_undefined_value: ${path}.${key}`);
      return `${JSON.stringify(key)}:${jcs(record[key], `${path}.${key}`)}`;
    })
    .join(",")}}`;
}

export function canonicalJson(
  value: unknown,
  version: CanonicalizationVersion = "jcs-v1",
): string {
  if (version === "legacy-v1") return legacyCanonicalJson(value);
  return jcs(value, "$");
}

export function legacyCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(legacyCanonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${legacyCanonicalJson(record[key])}`)
    .join(",")}}`;
}

export function canonicalSha256(
  value: unknown,
  version: CanonicalizationVersion = "jcs-v1",
): string {
  return createHash("sha256")
    .update(canonicalJson(value, version), "utf8")
    .digest("hex");
}

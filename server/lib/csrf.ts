import type express from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function originAllowed(
  request: express.Request,
  publicBaseUrl: string,
): boolean {
  const origin = request.header("origin");
  const referer = request.header("referer");
  const expected = new URL(publicBaseUrl).origin;
  if (origin) return origin === expected;
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return false;
}

export function requiresCsrf(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

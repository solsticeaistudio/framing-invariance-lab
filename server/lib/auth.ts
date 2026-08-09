import { timingSafeEqual } from "node:crypto";
import type express from "express";

export type AuthRole = "internal" | "admin";

export type AuthConfig = {
  internalToken?: string;
  adminToken?: string;
};

export type AuthDecision =
  | { ok: true; role: AuthRole }
  | { ok: false; status: 401 | 403; message: string };

export function authConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  return {
    internalToken: environment.AUTH_TOKEN?.trim() || undefined,
    adminToken: environment.ADMIN_TOKEN?.trim() || undefined,
  };
}

function tokenMatches(candidate: string, configured?: string): boolean {
  if (!configured) return false;
  const candidateBuffer = Buffer.from(candidate);
  const configuredBuffer = Buffer.from(configured);
  return (
    candidateBuffer.length === configuredBuffer.length &&
    timingSafeEqual(candidateBuffer, configuredBuffer)
  );
}

function bearerToken(request: express.Request): string | undefined {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1];
}

export function authorizeRequest(
  request: express.Request,
  config: AuthConfig,
  required: AuthRole,
): AuthDecision {
  const candidate = bearerToken(request);
  if (!candidate)
    return {
      ok: false,
      status: 401,
      message: "Bearer authentication is required.",
    };
  const role: AuthRole | undefined = tokenMatches(candidate, config.adminToken)
    ? "admin"
    : tokenMatches(candidate, config.internalToken)
      ? "internal"
      : undefined;
  if (!role)
    return { ok: false, status: 401, message: "The bearer token is invalid." };
  if (required === "admin" && role !== "admin") {
    return {
      ok: false,
      status: 403,
      message: "Administrator privilege is required.",
    };
  }
  return { ok: true, role };
}

export function requireRole(
  config: AuthConfig,
  required: AuthRole,
): express.RequestHandler {
  return (request, response, next) => {
    const decision = authorizeRequest(request, config, required);
    if (!decision.ok) {
      response.status(decision.status).json({ error: decision.message });
      return;
    }
    next();
  };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export function assertSafeHostConfiguration(
  host: string,
  config: AuthConfig,
): void {
  if (!isLoopbackHost(host) && !config.internalToken && !config.adminToken) {
    throw new Error(
      `Refusing to bind to non-loopback host ${host} without AUTH_TOKEN or ADMIN_TOKEN. Configure authentication or use HOST=127.0.0.1.`,
    );
  }
}

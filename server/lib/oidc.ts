import { createHash } from "node:crypto";
import {
  authorizationCodeGrant,
  allowInsecureRequests,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  calculatePKCECodeChallenge,
  ClientSecretPost,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from "openid-client";
import type { PlatformRole, Principal } from "../v2/types.js";
import type { PlatformStorage } from "./storage/index.js";

export type AuthenticationMode = "local" | "oidc";

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string;
  roleClaim: string;
  groupClaim: string;
  organizationClaim: string;
  publicBaseUrl: string;
  trustProxy: boolean;
};

type PendingAuthorization = {
  verifier: string;
  nonce: string;
  returnTo: string;
  expiresAt: number;
};

export type OidcAuthorizationStore = {
  put(state: string, pending: PendingAuthorization): void;
  take(state: string): PendingAuthorization | undefined;
};

export function oidcAuthorizationStore(
  storage: PlatformStorage,
): OidcAuthorizationStore {
  const key = (state: string) =>
    `oidc:${createHash("sha256").update(state).digest("hex")}`;
  return {
    put(state, pending) {
      storage.putSensitive(key(state), "oidc_authorization", pending);
    },
    take(state) {
      return storage.transaction(() => {
        const pending = storage.getSensitive<PendingAuthorization>(key(state));
        if (pending) storage.deleteSensitive(key(state));
        return pending;
      });
    },
  };
}

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required when AUTH_MODE=oidc.`);
  return value;
}

export function authenticationMode(
  environment: NodeJS.ProcessEnv = process.env,
): AuthenticationMode {
  const value = environment.AUTH_MODE?.trim() || "local";
  if (value !== "local" && value !== "oidc")
    throw new Error("AUTH_MODE must be local or oidc.");
  return value;
}

export function oidcConfigFromEnvironment(
  environment: NodeJS.ProcessEnv,
): OidcConfig {
  const publicBaseUrl = required(environment, "PUBLIC_BASE_URL");
  const parsedBase = new URL(publicBaseUrl);
  if (environment.NODE_ENV === "production" && parsedBase.protocol !== "https:")
    throw new Error("PUBLIC_BASE_URL must use HTTPS in production OIDC mode.");
  const redirectUri = required(environment, "OIDC_REDIRECT_URI");
  if (new URL(redirectUri).origin !== parsedBase.origin)
    throw new Error("OIDC_REDIRECT_URI must use the PUBLIC_BASE_URL origin.");
  const issuer = required(environment, "OIDC_ISSUER");
  if (
    environment.NODE_ENV === "production" &&
    new URL(issuer).protocol !== "https:"
  )
    throw new Error("OIDC_ISSUER must use HTTPS in production OIDC mode.");
  return {
    issuer,
    clientId: required(environment, "OIDC_CLIENT_ID"),
    clientSecret: environment.OIDC_CLIENT_SECRET?.trim() || undefined,
    redirectUri,
    scopes: environment.OIDC_SCOPES?.trim() || "openid profile email",
    roleClaim: environment.OIDC_ROLE_CLAIM?.trim() || "roles",
    groupClaim: environment.OIDC_GROUP_CLAIM?.trim() || "groups",
    organizationClaim:
      environment.OIDC_ORGANIZATION_CLAIM?.trim() || "organization",
    publicBaseUrl,
    trustProxy: environment.TRUST_PROXY === "true",
  };
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(/[ ,]+/).filter(Boolean);
  return [];
}

function platformRoles(values: string[]): PlatformRole[] {
  const allowed = new Set<PlatformRole>([
    "viewer",
    "researcher",
    "reviewer",
    "administrator",
  ]);
  const roles = values.filter((value): value is PlatformRole =>
    allowed.has(value as PlatformRole),
  );
  return roles.length ? [...new Set(roles)] : ["viewer"];
}

function safeReturnTo(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

export class OidcManager {
  private readonly pending = new Map<string, PendingAuthorization>();

  private constructor(
    private readonly configuration: Configuration,
    readonly settings: OidcConfig,
    private readonly authorizationStore?: OidcAuthorizationStore,
  ) {}

  static async discover(
    settings: OidcConfig,
    authorizationStore?: OidcAuthorizationStore,
  ): Promise<OidcManager> {
    const issuer = new URL(settings.issuer);
    const loopback = new Set(["127.0.0.1", "localhost", "::1"]).has(
      issuer.hostname,
    );
    const configuration = await discovery(
      issuer,
      settings.clientId,
      undefined,
      ClientSecretPost(settings.clientSecret),
      loopback && issuer.protocol === "http:"
        ? { execute: [allowInsecureRequests] }
        : undefined,
    );
    return new OidcManager(configuration, settings, authorizationStore);
  }

  async begin(returnTo?: string, now = Date.now()): Promise<URL> {
    const state = randomState();
    const nonce = randomNonce();
    const verifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(verifier);
    const pending = {
      verifier,
      nonce,
      returnTo: safeReturnTo(returnTo),
      expiresAt: now + 10 * 60 * 1000,
    };
    if (this.authorizationStore) this.authorizationStore.put(state, pending);
    else this.pending.set(state, pending);
    return buildAuthorizationUrl(this.configuration, {
      redirect_uri: this.settings.redirectUri,
      scope: this.settings.scopes,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
  }

  async complete(
    callbackUrl: URL,
    now = Date.now(),
  ): Promise<{ principal: Principal; returnTo: string }> {
    const state = callbackUrl.searchParams.get("state") ?? "";
    const pending = this.authorizationStore
      ? this.authorizationStore.take(state)
      : this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.expiresAt <= now)
      throw new Error("oidc_state_invalid_or_expired");
    const tokens = await authorizationCodeGrant(
      this.configuration,
      callbackUrl,
      {
        expectedState: state,
        expectedNonce: pending.nonce,
        pkceCodeVerifier: pending.verifier,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (
      !claims ||
      typeof claims.sub !== "string" ||
      typeof claims.iss !== "string"
    )
      throw new Error("oidc_subject_claim_missing");
    if (claims.iss !== this.settings.issuer)
      throw new Error("oidc_issuer_mismatch");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.settings.clientId))
      throw new Error("oidc_audience_mismatch");
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now)
      throw new Error("oidc_token_expired");
    if (claims.nonce !== pending.nonce) throw new Error("oidc_nonce_mismatch");
    const claimRecord: Record<string, unknown> = claims;
    const organization =
      typeof claimRecord[this.settings.organizationClaim] === "string"
        ? String(claimRecord[this.settings.organizationClaim])
        : "unassigned";
    const id = `oidc-${createHash("sha256").update(`${claims.iss}\0${claims.sub}`).digest("hex").slice(0, 32)}`;
    const displayName =
      typeof claims.name === "string"
        ? claims.name
        : typeof claims.email === "string"
          ? claims.email
          : claims.sub;
    return {
      principal: {
        id,
        subject: claims.sub,
        organizationId: organization,
        displayName,
        roles: platformRoles(stringList(claimRecord[this.settings.roleClaim])),
        teamIds: stringList(claimRecord[this.settings.groupClaim]),
        disabled: false,
      },
      returnTo: pending.returnTo,
    };
  }

  logoutUrl(): URL {
    return buildEndSessionUrl(this.configuration, {
      post_logout_redirect_uri: this.settings.publicBaseUrl,
    });
  }
}

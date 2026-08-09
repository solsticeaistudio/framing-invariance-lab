import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Principal } from "../v2/types.js";
import type { PlatformStorage, StoredSession } from "./storage/index.js";

export type SessionConfig = {
  secret: string;
  secure: boolean;
  idleSeconds: number;
  absoluteSeconds: number;
  cookieName: string;
};

export type CreatedSession = {
  session: StoredSession;
  cookie: string;
  csrfToken: string;
};

function digest(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionConfigFromEnvironment(
  environment: NodeJS.ProcessEnv,
): SessionConfig {
  const secret = environment.SESSION_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret) < 32)
    throw new Error(
      "SESSION_SECRET must contain at least 32 bytes in OIDC mode.",
    );
  return {
    secret,
    secure: environment.NODE_ENV === "production",
    idleSeconds: 30 * 60,
    absoluteSeconds: 8 * 60 * 60,
    cookieName: "fil_session",
  };
}

export class SessionManager {
  constructor(
    private readonly storage: PlatformStorage,
    private readonly config: SessionConfig,
  ) {}

  create(principal: Principal, now = new Date()): CreatedSession {
    const id = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const createdAt = now.toISOString();
    const session: StoredSession = {
      id,
      principalId: principal.id,
      csrfHash: digest(this.config.secret, `csrf:${csrfToken}`),
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: new Date(
        now.getTime() + this.config.idleSeconds * 1000,
      ).toISOString(),
      absoluteExpiresAt: new Date(
        now.getTime() + this.config.absoluteSeconds * 1000,
      ).toISOString(),
    };
    this.storage.putSession(session);
    return { session, csrfToken, cookie: this.serializeCookie(id) };
  }

  authenticate(
    cookieHeader: string | undefined,
    now = new Date(),
  ): { session: StoredSession; principal: Principal } | undefined {
    const signed = this.cookieValue(cookieHeader);
    if (!signed) return undefined;
    const separator = signed.lastIndexOf(".");
    if (separator < 1) return undefined;
    const id = signed.slice(0, separator);
    if (
      !safeEqual(
        digest(this.config.secret, `session:${id}`),
        signed.slice(separator + 1),
      )
    )
      return undefined;
    const session = this.storage.getSession(id);
    if (
      !session ||
      session.revokedAt ||
      Date.parse(session.expiresAt) <= now.getTime() ||
      Date.parse(session.absoluteExpiresAt) <= now.getTime()
    )
      return undefined;
    const principal = this.storage.getPrincipal(session.principalId);
    if (!principal || principal.disabled) return undefined;
    const refreshed = {
      ...session,
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(
        Math.min(
          now.getTime() + this.config.idleSeconds * 1000,
          Date.parse(session.absoluteExpiresAt),
        ),
      ).toISOString(),
    };
    this.storage.putSession(refreshed);
    return { session: refreshed, principal };
  }

  validateCsrf(session: StoredSession, token: string | undefined): boolean {
    return Boolean(
      token &&
        safeEqual(
          session.csrfHash,
          digest(this.config.secret, `csrf:${token}`),
        ),
    );
  }

  revoke(sessionId: string, now = new Date()): void {
    this.storage.revokeSession(sessionId, now.toISOString());
  }

  clearCookie(): string {
    return `${this.config.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.config.secure ? "; Secure" : ""}`;
  }

  private serializeCookie(id: string): string {
    const value = `${id}.${digest(this.config.secret, `session:${id}`)}`;
    return `${this.config.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${this.config.absoluteSeconds}${this.config.secure ? "; Secure" : ""}`;
  }

  private cookieValue(header: string | undefined): string | undefined {
    return header
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${this.config.cookieName}=`))
      ?.slice(this.config.cookieName.length + 1);
  }
}

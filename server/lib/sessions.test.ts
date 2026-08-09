import { describe, expect, it } from "vitest";
import type { AuditEvent, Principal, ResourceAcl, Study } from "../v2/types.js";
import type { PlatformStorage, StoredSession } from "./storage/index.js";
import { SessionManager } from "./sessions.js";

class MemoryStorage implements PlatformStorage {
  principals = new Map<string, Principal>();
  sessions = new Map<string, StoredSession>();
  close() {}
  transaction<T>(operation: () => T) {
    return operation();
  }
  putPrincipal(value: Principal) {
    this.principals.set(value.id, value);
  }
  getPrincipal(id: string) {
    return this.principals.get(id);
  }
  putSession(value: StoredSession) {
    this.sessions.set(value.id, value);
  }
  getSession(id: string) {
    return this.sessions.get(id);
  }
  revokeSession(id: string, revokedAt: string) {
    const value = this.sessions.get(id);
    if (value) this.sessions.set(id, { ...value, revokedAt });
  }
  putAcl(_value: ResourceAcl) {}
  getAcl(_type: ResourceAcl["resourceType"], _id: string) {
    return undefined;
  }
  putStudy(_value: Study) {}
  getStudy(_id: string) {
    return undefined;
  }
  listStudies() {
    return [];
  }
  appendAudit(_value: AuditEvent) {}
  listAudit() {
    return [];
  }
  putImmutable(_kind: string, _id: string, _hash: string, _document: unknown) {}
  getImmutable<T>(
    _kind: string,
    _id: string,
  ): { hash: string; document: T } | undefined {
    return undefined;
  }
  getImmutableByHash<T>(
    _kind: string,
    _hash: string,
  ): { id: string; document: T } | undefined {
    return undefined;
  }
  consumeNonce(_scope: string, _nonce: string, _expires: string) {
    return true;
  }
  putSensitive(_id: string, _type: string, _value: unknown) {}
  getSensitive<T>(_id: string): T | undefined {
    return undefined;
  }
  deleteSensitive(_id: string) {}
  listSensitive<T>(_type: string): Array<{ id: string; value: T }> {
    return [];
  }
}

describe("server sessions", () => {
  it("creates HTTP-only cookies, verifies CSRF, rotates, expires, revokes, and rejects disabled accounts", () => {
    const storage = new MemoryStorage();
    const principal: Principal = {
      id: "u",
      subject: "s",
      organizationId: "o",
      displayName: "U",
      roles: ["viewer"],
      teamIds: [],
      disabled: false,
    };
    storage.putPrincipal(principal);
    const manager = new SessionManager(storage, {
      secret: "x".repeat(32),
      secure: true,
      idleSeconds: 60,
      absoluteSeconds: 120,
      cookieName: "fil_session",
    });
    const created = manager.create(
      principal,
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(created.cookie).toContain("HttpOnly");
    expect(created.cookie).toContain("Secure");
    expect(created.cookie).toContain("SameSite=Lax");
    expect(manager.validateCsrf(created.session, created.csrfToken)).toBe(true);
    expect(manager.validateCsrf(created.session, "wrong")).toBe(false);
    expect(
      manager.authenticate(created.cookie, new Date("2026-01-01T00:00:30.000Z"))
        ?.principal.id,
    ).toBe("u");
    manager.revoke(created.session.id, new Date("2026-01-01T00:00:31.000Z"));
    expect(
      manager.authenticate(
        created.cookie,
        new Date("2026-01-01T00:00:32.000Z"),
      ),
    ).toBeUndefined();
    const disabled = { ...principal, disabled: true };
    storage.putPrincipal(disabled);
    const next = manager.create(disabled, new Date("2026-01-01T00:01:00.000Z"));
    expect(
      manager.authenticate(next.cookie, new Date("2026-01-01T00:01:01.000Z")),
    ).toBeUndefined();
  });
});

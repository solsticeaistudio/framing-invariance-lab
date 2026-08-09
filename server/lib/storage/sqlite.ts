import Database from "better-sqlite3";
import type {
  AuditEvent,
  Organization,
  Principal,
  ResourceAcl,
  Study,
  Team,
} from "../../v2/types.js";
import type { PlatformStorage, StoredSession } from "./index.js";
import { createAuditEvent, type AuditEventInput } from "../audit.js";

const MIGRATIONS = [
  `CREATE TABLE organizations(id TEXT PRIMARY KEY, document TEXT NOT NULL);
   CREATE TABLE users(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, disabled INTEGER NOT NULL, document TEXT NOT NULL);
   CREATE TABLE teams(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, document TEXT NOT NULL);
   CREATE TABLE memberships(user_id TEXT NOT NULL, team_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(user_id, team_id));
   CREATE TABLE sessions(id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, csrf_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, absolute_expires_at TEXT NOT NULL, revoked_at TEXT);
   CREATE TABLE resource_acls(resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, owner_id TEXT NOT NULL, organization_id TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(resource_type, resource_id));
   CREATE TABLE runs(id TEXT PRIMARY KEY, document TEXT NOT NULL);
   CREATE TABLE run_artifacts(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, document TEXT NOT NULL);
   CREATE TABLE studies(id TEXT PRIMARY KEY, document TEXT NOT NULL);
   CREATE TABLE study_run_links(id TEXT PRIMARY KEY, study_id TEXT NOT NULL, artifact_hash TEXT NOT NULL, document TEXT NOT NULL);
   CREATE TABLE replication_plans(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, document TEXT NOT NULL);
   CREATE TABLE certificates(id TEXT PRIMARY KEY, key_id TEXT NOT NULL, document TEXT NOT NULL);
   CREATE TABLE trust_anchors(id TEXT PRIMARY KEY, key_id TEXT NOT NULL, document TEXT NOT NULL);
   CREATE TABLE revocations(id TEXT PRIMARY KEY, document TEXT NOT NULL);
   CREATE TABLE signed_artifacts(kind TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, document TEXT NOT NULL, PRIMARY KEY(kind, id));
   CREATE TABLE audit_events(sequence INTEGER PRIMARY KEY, event_hash TEXT NOT NULL UNIQUE, document TEXT NOT NULL);
   CREATE TABLE report_artifacts(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, document TEXT NOT NULL);
   CREATE TABLE archive_manifests(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, document TEXT NOT NULL);
   CREATE TABLE remote_requests(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, document TEXT NOT NULL);
   CREATE TABLE remote_results(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, document TEXT NOT NULL);
   CREATE TABLE gold_items(id TEXT PRIMARY KEY, document TEXT NOT NULL);
   CREATE TABLE gold_annotations(id TEXT PRIMARY KEY, gold_id TEXT NOT NULL, document TEXT NOT NULL);
   CREATE TABLE replay_nonces(scope TEXT NOT NULL, nonce TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(scope, nonce));
   CREATE TABLE sensitive_records(id TEXT PRIMARY KEY, record_type TEXT NOT NULL, encrypted_document TEXT NOT NULL);`,
  `CREATE TABLE rate_limits(key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);`,
] as const;

function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}

export class SqlitePlatformStorage implements PlatformStorage {
  readonly database: Database.Database;

  constructor(filename: string) {
    this.database = new Database(filename);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const applied = new Set(
      this.database
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => (row as { version: number }).version),
    );
    MIGRATIONS.forEach((sql, index) => {
      const version = index + 1;
      if (applied.has(version)) return;
      this.database.transaction(() => {
        this.database.exec(sql);
        this.database
          .prepare(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
          )
          .run(version, new Date().toISOString());
      })();
    });
  }

  close(): void {
    this.database.close();
  }
  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  putPrincipal(principal: Principal): void {
    this.database
      .prepare(
        "INSERT INTO users(id, organization_id, disabled, document) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id, disabled=excluded.disabled, document=excluded.document",
      )
      .run(
        principal.id,
        principal.organizationId,
        principal.disabled ? 1 : 0,
        JSON.stringify(principal),
      );
  }
  getPrincipal(id: string): Principal | undefined {
    const row = this.database
      .prepare("SELECT document FROM users WHERE id=?")
      .get(id) as { document: string } | undefined;
    return row ? parse<Principal>(row.document) : undefined;
  }
  listPrincipals(): Principal[] {
    return this.database
      .prepare("SELECT document FROM users ORDER BY id")
      .all()
      .map((row) => parse<Principal>((row as { document: string }).document));
  }
  putOrganization(organization: Organization): void {
    this.database
      .prepare(
        "INSERT INTO organizations(id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
      )
      .run(organization.id, JSON.stringify(organization));
  }
  getOrganization(id: string): Organization | undefined {
    const row = this.database
      .prepare("SELECT document FROM organizations WHERE id=?")
      .get(id) as { document: string } | undefined;
    return row ? parse<Organization>(row.document) : undefined;
  }
  listOrganizations(): Organization[] {
    return this.database
      .prepare("SELECT document FROM organizations ORDER BY id")
      .all()
      .map((row) =>
        parse<Organization>((row as { document: string }).document),
      );
  }
  putTeam(team: Team): void {
    this.transaction(() => {
      this.database
        .prepare(
          "INSERT INTO teams(id, organization_id, document) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id, document=excluded.document",
        )
        .run(team.id, team.organizationId, JSON.stringify(team));
      this.database
        .prepare("DELETE FROM memberships WHERE team_id=?")
        .run(team.id);
      const insert = this.database.prepare(
        "INSERT INTO memberships(user_id, team_id, role) VALUES (?, ?, ?)",
      );
      for (const memberId of [...new Set(team.memberIds)].sort())
        insert.run(memberId, team.id, "member");
    });
  }
  getTeam(id: string): Team | undefined {
    const row = this.database
      .prepare("SELECT document FROM teams WHERE id=?")
      .get(id) as { document: string } | undefined;
    return row ? parse<Team>(row.document) : undefined;
  }
  listTeams(): Team[] {
    return this.database
      .prepare("SELECT document FROM teams ORDER BY id")
      .all()
      .map((row) => parse<Team>((row as { document: string }).document));
  }
  putSession(session: StoredSession): void {
    this.database
      .prepare(
        "INSERT INTO sessions(id, principal_id, csrf_hash, created_at, last_seen_at, expires_at, absolute_expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET principal_id=excluded.principal_id, csrf_hash=excluded.csrf_hash, last_seen_at=excluded.last_seen_at, expires_at=excluded.expires_at, absolute_expires_at=excluded.absolute_expires_at, revoked_at=excluded.revoked_at",
      )
      .run(
        session.id,
        session.principalId,
        session.csrfHash,
        session.createdAt,
        session.lastSeenAt,
        session.expiresAt,
        session.absoluteExpiresAt,
        session.revokedAt ?? null,
      );
  }
  getSession(id: string): StoredSession | undefined {
    const row = this.database
      .prepare("SELECT * FROM sessions WHERE id=?")
      .get(id) as Record<string, string | null> | undefined;
    if (!row) return undefined;
    return {
      id: row.id ?? "",
      principalId: row.principal_id ?? "",
      csrfHash: row.csrf_hash ?? "",
      createdAt: row.created_at ?? "",
      lastSeenAt: row.last_seen_at ?? "",
      expiresAt: row.expires_at ?? "",
      absoluteExpiresAt: row.absolute_expires_at ?? "",
      revokedAt: row.revoked_at ?? undefined,
    };
  }
  revokeSession(id: string, revokedAt: string): void {
    this.database
      .prepare("UPDATE sessions SET revoked_at=? WHERE id=?")
      .run(revokedAt, id);
  }
  putAcl(acl: ResourceAcl): void {
    this.database
      .prepare(
        "INSERT INTO resource_acls(resource_type, resource_id, owner_id, organization_id, document) VALUES (?, ?, ?, ?, ?) ON CONFLICT(resource_type, resource_id) DO UPDATE SET owner_id=excluded.owner_id, organization_id=excluded.organization_id, document=excluded.document",
      )
      .run(
        acl.resourceType,
        acl.resourceId,
        acl.ownerId,
        acl.organizationId,
        JSON.stringify(acl),
      );
  }
  getAcl(
    resourceType: ResourceAcl["resourceType"],
    resourceId: string,
  ): ResourceAcl | undefined {
    const row = this.database
      .prepare(
        "SELECT document FROM resource_acls WHERE resource_type=? AND resource_id=?",
      )
      .get(resourceType, resourceId) as { document: string } | undefined;
    return row ? parse<ResourceAcl>(row.document) : undefined;
  }
  putStudy(study: Study): void {
    this.database
      .prepare(
        "INSERT INTO studies(id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
      )
      .run(study.id, JSON.stringify(study));
  }
  getStudy(id: string): Study | undefined {
    const row = this.database
      .prepare("SELECT document FROM studies WHERE id=?")
      .get(id) as { document: string } | undefined;
    return row ? parse<Study>(row.document) : undefined;
  }
  listStudies(): Study[] {
    return this.database
      .prepare("SELECT document FROM studies ORDER BY id")
      .all()
      .map((row) => parse<Study>((row as { document: string }).document));
  }
  appendAudit(event: AuditEvent): void {
    this.database
      .prepare(
        "INSERT INTO audit_events(sequence, event_hash, document) VALUES (?, ?, ?)",
      )
      .run(event.sequence, event.eventHash, JSON.stringify(event));
  }
  appendAuditAtomically(input: AuditEventInput): AuditEvent {
    return this.transaction(() => {
      const previous = this.database
        .prepare(
          "SELECT document FROM audit_events ORDER BY sequence DESC LIMIT 1",
        )
        .get() as { document: string } | undefined;
      const event = createAuditEvent(
        previous ? parse<AuditEvent>(previous.document) : undefined,
        input,
      );
      this.appendAudit(event);
      return event;
    });
  }
  listAudit(): AuditEvent[] {
    return this.database
      .prepare("SELECT document FROM audit_events ORDER BY sequence")
      .all()
      .map((row) => parse<AuditEvent>((row as { document: string }).document));
  }
  putImmutable(
    kind: string,
    id: string,
    hash: string,
    document: unknown,
  ): void {
    const serialized = JSON.stringify(document);
    const existing = this.database
      .prepare("SELECT hash FROM signed_artifacts WHERE kind=? AND id=?")
      .get(kind, id) as { hash: string } | undefined;
    if (existing && existing.hash !== hash)
      throw new Error("immutable_artifact_conflict");
    this.database
      .prepare(
        "INSERT OR IGNORE INTO signed_artifacts(kind, id, hash, document) VALUES (?, ?, ?, ?)",
      )
      .run(kind, id, hash, serialized);
  }
  getImmutable<T>(
    kind: string,
    id: string,
  ): { hash: string; document: T } | undefined {
    const row = this.database
      .prepare(
        "SELECT hash, document FROM signed_artifacts WHERE kind=? AND id=?",
      )
      .get(kind, id) as { hash: string; document: string } | undefined;
    return row
      ? { hash: row.hash, document: parse<T>(row.document) }
      : undefined;
  }
  getImmutableByHash<T>(
    kind: string,
    hash: string,
  ): { id: string; document: T } | undefined {
    const row = this.database
      .prepare(
        "SELECT id, document FROM signed_artifacts WHERE kind=? AND hash=?",
      )
      .get(kind, hash) as { id: string; document: string } | undefined;
    return row ? { id: row.id, document: parse<T>(row.document) } : undefined;
  }
  consumeNonce(scope: string, nonce: string, expiresAt: string): boolean {
    try {
      this.database
        .prepare(
          "INSERT INTO replay_nonces(scope, nonce, expires_at) VALUES (?, ?, ?)",
        )
        .run(scope, nonce, expiresAt);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed")
      )
        return false;
      throw error;
    }
  }
  putSensitive(id: string, recordType: string, encrypted: unknown): void {
    this.database
      .prepare(
        "INSERT INTO sensitive_records(id, record_type, encrypted_document) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record_type=excluded.record_type, encrypted_document=excluded.encrypted_document",
      )
      .run(id, recordType, JSON.stringify(encrypted));
  }
  getSensitive<T>(id: string): T | undefined {
    const row = this.database
      .prepare("SELECT encrypted_document FROM sensitive_records WHERE id=?")
      .get(id) as { encrypted_document: string } | undefined;
    return row ? parse<T>(row.encrypted_document) : undefined;
  }

  deleteSensitive(id: string): void {
    this.database.prepare("DELETE FROM sensitive_records WHERE id=?").run(id);
  }
  listSensitive<T>(recordType: string): Array<{ id: string; value: T }> {
    return this.database
      .prepare(
        "SELECT id, encrypted_document FROM sensitive_records WHERE record_type=? ORDER BY id",
      )
      .all(recordType)
      .map((row) => {
        const value = row as { id: string; encrypted_document: string };
        return { id: value.id, value: parse<T>(value.encrypted_document) };
      });
  }

  consumeRateLimit(
    key: string,
    windowMs: number,
    nowMs: number,
  ): { windowStart: number; count: number } {
    return this.transaction(() => {
      const row = this.database
        .prepare("SELECT window_start, count FROM rate_limits WHERE key=?")
        .get(key) as { window_start: number; count: number } | undefined;
      const current =
        row && nowMs - row.window_start < windowMs
          ? { windowStart: row.window_start, count: row.count + 1 }
          : { windowStart: nowMs, count: 1 };
      this.database
        .prepare(
          "INSERT INTO rate_limits(key, window_start, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=excluded.count",
        )
        .run(key, current.windowStart, current.count);
      this.database
        .prepare("DELETE FROM rate_limits WHERE window_start < ?")
        .run(nowMs - windowMs);
      return current;
    });
  }
}

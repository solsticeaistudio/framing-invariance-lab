import type {
  AuditEvent,
  Organization,
  Principal,
  ResourceAcl,
  Study,
  Team,
} from "../../v2/types.js";
import type { AuditEventInput } from "../audit.js";

export type StoredSession = {
  id: string;
  principalId: string;
  csrfHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  revokedAt?: string;
};

export interface PlatformStorage {
  close(): void;
  transaction<T>(operation: () => T): T;
  putPrincipal(principal: Principal): void;
  getPrincipal(id: string): Principal | undefined;
  listPrincipals(): Principal[];
  putOrganization(organization: Organization): void;
  getOrganization(id: string): Organization | undefined;
  listOrganizations(): Organization[];
  putTeam(team: Team): void;
  getTeam(id: string): Team | undefined;
  listTeams(): Team[];
  putSession(session: StoredSession): void;
  getSession(id: string): StoredSession | undefined;
  revokeSession(id: string, revokedAt: string): void;
  putAcl(acl: ResourceAcl): void;
  getAcl(
    resourceType: ResourceAcl["resourceType"],
    resourceId: string,
  ): ResourceAcl | undefined;
  putStudy(study: Study): void;
  getStudy(id: string): Study | undefined;
  listStudies(): Study[];
  appendAudit(event: AuditEvent): void;
  appendAuditAtomically?(input: AuditEventInput): AuditEvent;
  listAudit(): AuditEvent[];
  putImmutable(kind: string, id: string, hash: string, document: unknown): void;
  getImmutable<T>(
    kind: string,
    id: string,
  ): { hash: string; document: T } | undefined;
  getImmutableByHash<T>(
    kind: string,
    hash: string,
  ): { id: string; document: T } | undefined;
  consumeNonce(scope: string, nonce: string, expiresAt: string): boolean;
  putSensitive(id: string, recordType: string, encrypted: unknown): void;
  getSensitive<T>(id: string): T | undefined;
  deleteSensitive(id: string): void;
  listSensitive<T>(recordType: string): Array<{ id: string; value: T }>;
  consumeRateLimit?(
    key: string,
    windowMs: number,
    nowMs: number,
  ): { windowStart: number; count: number };
}

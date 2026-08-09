import { randomUUID } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type {
  ArtifactSignature,
  AuditEvent,
  SignedArtifact,
  TrustCertificate,
} from "../v2/types.js";
import { canonicalSha256 } from "./canonicalJson.js";
import { signArtifact } from "./signatures.js";

const FORBIDDEN_METADATA_KEY =
  /(token|secret|password|authorization|prompt|response|private.?key|cookie|reasoning)/i;

export type AuditEventInput = Omit<
  AuditEvent,
  "schemaVersion" | "sequence" | "eventId" | "previousEventHash" | "eventHash"
> & {
  eventId?: string;
};

export function safeAuditMetadata(
  metadata: AuditEvent["metadata"],
): AuditEvent["metadata"] {
  const safe: AuditEvent["metadata"] = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!FORBIDDEN_METADATA_KEY.test(key))
      safe[key] = typeof value === "string" ? value.slice(0, 300) : value;
  }
  return safe;
}

function eventMaterial(
  event: Omit<AuditEvent, "eventHash" | "signature">,
): unknown {
  return event;
}

export function createAuditEvent(
  previous: AuditEvent | undefined,
  input: AuditEventInput,
): AuditEvent {
  const material = {
    schemaVersion: "1.0" as const,
    sequence: (previous?.sequence ?? 0) + 1,
    eventId: input.eventId ?? randomUUID(),
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    ...(input.actorOrganization
      ? { actorOrganization: input.actorOrganization }
      : {}),
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    previousEventHash: previous?.eventHash ?? "0".repeat(64),
    metadata: safeAuditMetadata(input.metadata),
  };
  return { ...material, eventHash: canonicalSha256(eventMaterial(material)) };
}

export function verifyAuditChain(events: AuditEvent[]): string[] {
  const errors: string[] = [];
  let previousHash = "0".repeat(64);
  events.forEach((event, index) => {
    if (event.sequence !== index + 1)
      errors.push(`audit_sequence_gap:${index + 1}`);
    if (event.previousEventHash !== previousHash)
      errors.push(`audit_previous_hash_mismatch:${event.sequence}`);
    const { eventHash: _eventHash, signature: _signature, ...material } = event;
    if (canonicalSha256(eventMaterial(material)) !== event.eventHash)
      errors.push(`audit_event_hash_mismatch:${event.sequence}`);
    previousHash = event.eventHash;
  });
  return errors;
}

export function signAuditCheckpoint(args: {
  events: AuditEvent[];
  certificate: TrustCertificate;
  certificateChain: TrustCertificate[];
  privateKey: KeyObject;
  signedAt: string;
}): SignedArtifact<{
  schemaVersion: "1.0";
  sequence: number;
  eventHash: string;
}> {
  const errors = verifyAuditChain(args.events);
  if (errors.length) throw new Error(`audit_chain_invalid:${errors.join(",")}`);
  const last = args.events.at(-1);
  const payload = {
    schemaVersion: "1.0" as const,
    sequence: last?.sequence ?? 0,
    eventHash: last?.eventHash ?? "0".repeat(64),
  };
  return signArtifact({
    artifactType: "audit_checkpoint",
    artifactSchemaVersion: "1.0",
    artifactId: `audit-${payload.sequence}`,
    payload,
    certificateChain: args.certificateChain,
    privateKey: args.privateKey,
    purpose: "transparency-log-checkpoint",
    disclosure: "internal",
    signedAt: args.signedAt,
  });
}

export function attachAuditSignature(
  event: AuditEvent,
  signature: ArtifactSignature,
): AuditEvent {
  return { ...event, signature };
}

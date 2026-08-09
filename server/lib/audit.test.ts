import { describe, expect, it } from "vitest";
import {
  createAuditEvent,
  safeAuditMetadata,
  verifyAuditChain,
} from "./audit.js";

function chain() {
  const first = createAuditEvent(undefined, {
    occurredAt: "2026-01-01T00:00:00.000Z",
    actorId: "user-1",
    action: "run.create",
    resourceType: "run",
    resourceId: "run-1",
    metadata: { status: "queued" },
  });
  const second = createAuditEvent(first, {
    occurredAt: "2026-01-01T00:01:00.000Z",
    actorId: "user-1",
    action: "evidence.read",
    resourceType: "run",
    resourceId: "run-1",
    metadata: { count: 2 },
  });
  return [first, second];
}

describe("append-only audit events", () => {
  it("verifies an intact chain and detects mutation, deletion, and insertion", () => {
    const events = chain();
    expect(verifyAuditChain(events)).toEqual([]);
    expect(
      verifyAuditChain([{ ...events[0], action: "changed" }, events[1]]),
    ).toContain("audit_event_hash_mismatch:1");
    expect(verifyAuditChain([events[1]])).toContain("audit_sequence_gap:1");
    expect(
      verifyAuditChain([events[0], { ...events[0], sequence: 2 }, events[1]]),
    ).not.toEqual([]);
  });

  it("drops secret and evidence-like metadata", () => {
    expect(
      safeAuditMetadata({
        action: "ok",
        token: "secret",
        rawPrompt: "hidden",
        response: "hidden",
      }),
    ).toEqual({ action: "ok" });
  });
});

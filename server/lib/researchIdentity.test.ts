import { describe, expect, it } from "vitest";
import {
  deriveClaimKey,
  deriveReplicationIdentity,
} from "./researchIdentity.js";

const input = {
  replicationKey: "family-a",
  scenarioFamily: "family-a",
  pairId: "pair-1",
  outcomeType: "weakness",
  outcomeContractHash: "a".repeat(64),
  framingProtocolId: "pairwise",
  framingProtocolVersion: "v4",
  framingProtocolHash: "b".repeat(64),
  methodologyCompatibilityHash: "c".repeat(64),
};

describe("research identities", () => {
  it("is deterministic and order independent", () => {
    expect(deriveReplicationIdentity(input)).toBe(
      deriveReplicationIdentity({ ...input }),
    );
    expect(
      deriveReplicationIdentity({
        ...input,
        datasetSplit: "holdout",
      } as typeof input & { datasetSplit: string }),
    ).toBe(deriveReplicationIdentity(input));
  });
  it("changes for substantive semantics", () => {
    expect(
      deriveReplicationIdentity({
        ...input,
        outcomeContractHash: "d".repeat(64),
      }),
    ).not.toBe(deriveReplicationIdentity(input));
    expect(
      deriveReplicationIdentity({
        ...input,
        framingProtocolHash: "e".repeat(64),
      }),
    ).not.toBe(deriveReplicationIdentity(input));
    expect(
      deriveReplicationIdentity({
        ...input,
        methodologyCompatibilityHash: "f".repeat(64),
      }),
    ).not.toBe(deriveReplicationIdentity(input));
  });
  it("derives claim identities from replication and target policy", () => {
    const replicationIdentity = deriveReplicationIdentity(input);
    const claim = deriveClaimKey({
      replicationIdentity,
      targetCompatibilityPolicy: "exact_snapshot",
      outcomeDefinitionHash: input.outcomeContractHash,
    });
    expect(claim).toMatch(/^[a-f0-9]{64}$/);
    expect(
      deriveClaimKey({
        replicationIdentity,
        targetCompatibilityPolicy: "same_requested_model",
        outcomeDefinitionHash: input.outcomeContractHash,
      }),
    ).not.toBe(claim);
  });
});

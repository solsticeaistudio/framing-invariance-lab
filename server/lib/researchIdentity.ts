import { canonicalSha256 } from "./canonicalJson.js";

export const REPLICATION_IDENTITY_VERSION = "replication-identity-v1";
export const CLAIM_IDENTITY_VERSION = "claim-identity-v1";

export type ReplicationIdentityInput = {
  replicationKey: string;
  scenarioFamily: string;
  pairId?: string;
  outcomeType: string;
  outcomeContractHash: string;
  framingProtocolId: string;
  framingProtocolVersion: string;
  framingProtocolHash: string;
  methodologyCompatibilityHash: string;
};

export function deriveReplicationIdentity(
  input: ReplicationIdentityInput,
): string {
  return canonicalSha256({
    version: REPLICATION_IDENTITY_VERSION,
    replicationKey: input.replicationKey,
    scenarioFamily: input.scenarioFamily,
    ...(input.pairId ? { pairId: input.pairId } : {}),
    outcomeType: input.outcomeType,
    outcomeContractHash: input.outcomeContractHash,
    framingProtocolId: input.framingProtocolId,
    framingProtocolVersion: input.framingProtocolVersion,
    framingProtocolHash: input.framingProtocolHash,
    methodologyCompatibilityHash: input.methodologyCompatibilityHash,
  });
}

export function deriveClaimKey(input: {
  replicationIdentity: string;
  targetCompatibilityPolicy: string;
  outcomeDefinitionHash: string;
}): string {
  return canonicalSha256({
    version: CLAIM_IDENTITY_VERSION,
    replicationIdentity: input.replicationIdentity,
    targetCompatibilityPolicy: input.targetCompatibilityPolicy,
    outcomeDefinitionHash: input.outcomeDefinitionHash,
  });
}

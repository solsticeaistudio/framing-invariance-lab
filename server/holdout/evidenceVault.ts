import type { PlatformStorage } from "../lib/storage/index.js";
import {
  decryptSensitiveJson,
  encryptSensitiveJson,
  type EncryptionKey,
} from "../lib/encryption.js";
import { canonicalSha256 } from "../lib/canonicalJson.js";

export type EvidenceVaultReceipt = {
  schemaVersion: "1.0";
  receiptId: string;
  vaultId: string;
  encryptedEvidenceHash: string;
  plaintextEvidenceCommitmentHash: string;
  encryptionKeyId: string;
  recordCount: number;
  id: string;
  commitmentHash: string;
  retainedUntil?: string;
};

export interface HoldoutEvidenceVault {
  storeEncryptedEvidence(input: {
    id: string;
    evidence: unknown;
    retainedUntil?: string;
  }): Promise<EvidenceVaultReceipt>;
  retrieveAuthorizedEvidence(id: string): Promise<unknown>;
  deleteAccordingToPolicy(id: string): Promise<void>;
}

export function sqliteEvidenceVault(args: {
  storage: PlatformStorage;
  key: EncryptionKey;
  decryptionKeys?: Map<string, Buffer>;
}): HoldoutEvidenceVault {
  const keys = args.decryptionKeys ?? new Map([[args.key.keyId, args.key.key]]);
  return {
    async storeEncryptedEvidence(input) {
      const envelope = encryptSensitiveJson(input.evidence, args.key, {
        vault: "holdout-evidence",
        id: input.id,
      });
      args.storage.putSensitive(input.id, "holdout_evidence", envelope);
      return {
        schemaVersion: "1.0",
        receiptId: `receipt-${input.id}`,
        vaultId: "holdout-evidence",
        id: input.id,
        encryptedEvidenceHash: canonicalSha256(envelope.ciphertext),
        plaintextEvidenceCommitmentHash: canonicalSha256(input.evidence),
        encryptionKeyId: args.key.keyId,
        recordCount: Array.isArray(input.evidence) ? input.evidence.length : 1,
        commitmentHash: canonicalSha256(input.evidence),
        retainedUntil: input.retainedUntil,
      };
    },
    async retrieveAuthorizedEvidence(id) {
      const envelope =
        args.storage.getSensitive<ReturnType<typeof encryptSensitiveJson>>(id);
      if (!envelope) throw new Error("holdout_evidence_not_found");
      return decryptSensitiveJson(envelope, keys);
    },
    async deleteAccordingToPolicy(id) {
      args.storage.deleteSensitive(id);
    },
  };
}

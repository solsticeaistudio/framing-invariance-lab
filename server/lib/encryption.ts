import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type {
  EncryptedReplicationPack,
  SignedReplicationPack,
} from "../v2/types.js";
import { canonicalJson } from "./canonicalJson.js";

export type EncryptionKey = { keyId: string; key: Buffer };

function validateKey(key: EncryptionKey): void {
  if (!key.keyId.trim()) throw new Error("encryption_key_id_required");
  if (key.key.length !== 32)
    throw new Error("AES-256-GCM requires a 32-byte key.");
}

export function encryptionKeyFromBase64(
  keyId: string,
  encoded: string,
): EncryptionKey {
  const key = Buffer.from(encoded, "base64");
  const result = { keyId, key };
  validateKey(result);
  return result;
}

export function encryptSensitiveJson<T>(
  value: T,
  key: EncryptionKey,
  authenticatedContext: Record<string, unknown>,
) {
  validateKey(key);
  const nonce = randomBytes(12);
  const aad = Buffer.from(canonicalJson(authenticatedContext));
  const cipher = createCipheriv("aes-256-gcm", key.key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(canonicalJson(value), "utf8"),
    cipher.final(),
  ]);
  return {
    schemaVersion: "1.0" as const,
    encryption: "AES-256-GCM" as const,
    keyId: key.keyId,
    nonce: nonce.toString("base64url"),
    authenticatedContext: structuredClone(authenticatedContext),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptSensitiveJson<T>(
  envelope: ReturnType<typeof encryptSensitiveJson<T>>,
  keys: Map<string, Buffer>,
): T {
  const key = keys.get(envelope.keyId);
  if (!key) throw new Error(`encryption_key_unavailable: ${envelope.keyId}`);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(canonicalJson(envelope.authenticatedContext)));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new Error("encrypted_record_authentication_failed");
  }
}

export function sealReplicationPack(
  pack: SignedReplicationPack,
  key: EncryptionKey,
): EncryptedReplicationPack {
  if (pack.payload.purpose !== "sealed_holdout")
    throw new Error(
      "Only sealed-holdout packs may use the sealed-pack envelope.",
    );
  validateKey(key);
  const metadata: EncryptedReplicationPack["authenticatedMetadata"] = {
    packId: pack.payload.packId,
    packHash: pack.signature.artifactHash,
    purpose: "sealed_holdout",
    signerKeyId: pack.signature.keyId,
  };
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, nonce);
  cipher.setAAD(Buffer.from(canonicalJson(metadata)));
  const ciphertext = Buffer.concat([
    cipher.update(canonicalJson(pack), "utf8"),
    cipher.final(),
  ]);
  return {
    schemaVersion: "1.0",
    encryption: "AES-256-GCM",
    keyId: key.keyId,
    nonce: nonce.toString("base64url"),
    authenticatedMetadata: metadata,
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function unsealReplicationPack(
  envelope: EncryptedReplicationPack,
  keys: Map<string, Buffer>,
): SignedReplicationPack {
  const key = keys.get(envelope.keyId);
  if (!key) throw new Error(`sealed_pack_key_unavailable: ${envelope.keyId}`);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(canonicalJson(envelope.authenticatedMetadata)));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(
      plaintext.toString("utf8"),
    ) as SignedReplicationPack;
    if (
      parsed.payload.packId !== envelope.authenticatedMetadata.packId ||
      parsed.signature.artifactHash !==
        envelope.authenticatedMetadata.packHash ||
      parsed.signature.keyId !== envelope.authenticatedMetadata.signerKeyId
    )
      throw new Error("sealed_pack_metadata_mismatch");
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "sealed_pack_metadata_mismatch"
    )
      throw error;
    throw new Error("sealed_pack_authentication_failed");
  }
}

export function inspectSealedPackMetadata(envelope: EncryptedReplicationPack) {
  return {
    schemaVersion: envelope.schemaVersion,
    encryption: envelope.encryption,
    keyId: envelope.keyId,
    authenticatedMetadata: structuredClone(envelope.authenticatedMetadata),
  };
}

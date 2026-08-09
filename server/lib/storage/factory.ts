import path from "node:path";
import { authenticationMode } from "../oidc.js";
import { encryptionKeyFromBase64, type EncryptionKey } from "../encryption.js";
import { SqlitePlatformStorage } from "./sqlite.js";

export type StorageRuntime = {
  platform?: SqlitePlatformStorage;
  encryptionKey?: EncryptionKey;
  decryptionKeys: Map<string, Buffer>;
  mode: "json" | "sqlite";
};

export function storageFromEnvironment(
  environment: NodeJS.ProcessEnv,
): StorageRuntime {
  const authMode = authenticationMode(environment);
  const mode =
    environment.STORAGE_MODE?.trim() ||
    (authMode === "oidc" ? "sqlite" : "json");
  if (mode !== "json" && mode !== "sqlite")
    throw new Error("STORAGE_MODE must be json or sqlite.");
  if (authMode === "oidc" && mode !== "sqlite")
    throw new Error("OIDC production mode requires STORAGE_MODE=sqlite.");
  if (mode === "json") {
    const filename = path.resolve(
      environment.PLATFORM_DATABASE_PATH?.trim() ||
        "./data/platform-local.sqlite",
    );
    return {
      mode,
      platform: new SqlitePlatformStorage(filename),
      decryptionKeys: new Map(),
    };
  }
  const keyId = environment.DATA_ENCRYPTION_KEY_ID?.trim();
  const encoded = environment.DATA_ENCRYPTION_KEY?.trim();
  if (!keyId || !encoded)
    throw new Error(
      "SQLite production storage requires DATA_ENCRYPTION_KEY_ID and DATA_ENCRYPTION_KEY.",
    );
  const encryptionKey = encryptionKeyFromBase64(keyId, encoded);
  const decryptionKeys = new Map<string, Buffer>([
    [encryptionKey.keyId, encryptionKey.key],
  ]);
  const legacy = environment.DATA_DECRYPTION_KEYS?.trim();
  if (legacy) {
    const parsed = JSON.parse(legacy) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error(
        "DATA_DECRYPTION_KEYS must be a JSON object of key IDs to base64 keys.",
      );
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value !== "string")
        throw new Error("DATA_DECRYPTION_KEYS values must be base64 strings.");
      const key = encryptionKeyFromBase64(id, value);
      decryptionKeys.set(key.keyId, key.key);
    }
  }
  const filename = path.resolve(
    environment.DATABASE_PATH?.trim() || "./data/platform.sqlite",
  );
  return {
    mode,
    platform: new SqlitePlatformStorage(filename),
    encryptionKey,
    decryptionKeys,
  };
}

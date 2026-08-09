import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  EncryptedReplicationPack,
  TrustCertificate,
} from "../v2/types.js";
import { encryptionKeyFromBase64 } from "../lib/encryption.js";
import { sqliteEvidenceVault } from "./evidenceVault.js";
import { AnthropicProvider } from "../lib/providers/anthropic.js";
import { openAiCompatibleFromEnvironment } from "../lib/providers/openaiCompatible.js";
import type { ModelProvider } from "../lib/providers/index.js";
import { SqlitePlatformStorage } from "../lib/storage/sqlite.js";
import { trustStoreFromEnvironment } from "../lib/trustStoreLoader.js";
import { createHoldoutApp } from "./index.js";
import { SealedHoldoutExecutor } from "./protocol.js";

function provider(name: string, environment: NodeJS.ProcessEnv): ModelProvider {
  if (name === "anthropic") return new AnthropicProvider();
  if (name === "openai_compatible") {
    const adapter = openAiCompatibleFromEnvironment(environment);
    if (adapter) return adapter;
  }
  throw new Error(`Holdout provider ${name} is not fully configured.`);
}

export async function startHoldoutServer(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const packFile = environment.HOLDOUT_ENCRYPTED_PACK_FILE?.trim();
  const encodedKey = environment.HOLDOUT_DECRYPTION_KEY?.trim();
  const keyId = environment.HOLDOUT_DECRYPTION_KEY_ID?.trim();
  const privateKeyFile = environment.HOLDOUT_SIGNING_PRIVATE_KEY_FILE?.trim();
  const chainFile = environment.HOLDOUT_SIGNING_CERTIFICATE_CHAIN_FILE?.trim();
  if (!packFile || !encodedKey || !keyId || !privateKeyFile || !chainFile)
    throw new Error(
      "Holdout executor requires encrypted pack, decryption key, signing key, and certificate chain configuration.",
    );
  const [packText, privatePem, chainText] = await Promise.all([
    readFile(packFile, "utf8"),
    readFile(privateKeyFile, "utf8"),
    readFile(chainFile, "utf8"),
  ]);
  const encryptedPack = JSON.parse(packText) as EncryptedReplicationPack;
  const chain = JSON.parse(chainText) as TrustCertificate[];
  const leaf = chain[0];
  if (!leaf?.roles.includes("holdout_custodian"))
    throw new Error(
      "Holdout signing certificate requires holdout_custodian role.",
    );
  const key = encryptionKeyFromBase64(keyId, encodedKey);
  if (encryptedPack.keyId !== key.keyId)
    throw new Error(
      "Encrypted pack key ID does not match configured decryption key.",
    );
  const storage = new SqlitePlatformStorage(
    path.resolve(
      environment.HOLDOUT_DATABASE_PATH?.trim() || "./data/holdout.sqlite",
    ),
  );
  const executor = new SealedHoldoutExecutor({
    recipientKeyId: leaf.keyId,
    encryptedPack,
    decryptionKeys: new Map([[key.keyId, key.key]]),
    trustStore: await trustStoreFromEnvironment(environment),
    storage,
    evidenceVault: sqliteEvidenceVault({ storage, key }),
    targetProvider: provider(
      environment.HOLDOUT_TARGET_PROVIDER?.trim() || "anthropic",
      environment,
    ),
    judgeProvider: provider(
      environment.HOLDOUT_JUDGE_PROVIDER?.trim() || "anthropic",
      environment,
    ),
    signingIdentity: {
      certificateChain: chain,
      privateKey: createPrivateKey(privatePem),
    },
    maxConcurrency: Number.parseInt(
      environment.HOLDOUT_MAX_CONCURRENCY ?? "1",
      10,
    ),
  });
  const host = environment.HOLDOUT_HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(environment.HOLDOUT_PORT ?? "8790", 10);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(host) &&
    !environment.TRUST_ANCHOR_FILES
  )
    throw new Error(
      "Non-loopback holdout startup requires configured trust anchors.",
    );
  const server = createHoldoutApp(executor, { storage }).listen(
    port,
    host,
    () =>
      console.log(
        `Sealed holdout executor listening on http://${host}:${port}`,
      ),
  );
  const shutdown = () =>
    server.close(() => {
      key.key.fill(0);
      storage.close();
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

await startHoldoutServer();

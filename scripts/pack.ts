import { createPrivateKey, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type {
  EncryptedReplicationPack,
  IndependenceDeclaration,
  ReplicationPackPurpose,
  SignedReplicationPack,
  TrustCertificate,
  V2ReplicationPack,
} from "../server/v2/types.js";
import { canonicalSha256 } from "../server/lib/canonicalJson.js";
import {
  encryptionKeyFromBase64,
  inspectSealedPackMetadata,
  sealReplicationPack,
  unsealReplicationPack,
} from "../server/lib/encryption.js";
import { signArtifact } from "../server/lib/signatures.js";
import { verifySignedReplicationPack } from "../server/lib/signedPacks.js";
import { trustStoreFromEnvironment } from "../server/lib/trustStoreLoader.js";
import { jsonFile, option, required, writeJson } from "./cli.js";

const command = process.argv[2];
if (command === "hash") {
  console.log(canonicalSha256(await jsonFile<unknown>(required("in"))));
} else if (command === "attest-independence") {
  const payload = await jsonFile<IndependenceDeclaration>(required("in"));
  const chain = await jsonFile<TrustCertificate[]>(required("chain"));
  const privateKey = createPrivateKey(
    await readFile(required("private-key"), "utf8"),
  );
  const declaration = signArtifact({
    artifactType: "independence_declaration",
    artifactSchemaVersion: "1.0",
    artifactId: required("artifact-id"),
    payload,
    purpose: "independent_replication",
    parentArtifactHashes: [payload.packContentHash],
    disclosure: "internal",
    signedAt: payload.declaredAt,
    certificateChain: chain,
    privateKey,
  });
  await writeJson(required("out"), declaration);
  console.log(
    JSON.stringify(
      {
        artifactHash: declaration.signature.artifactHash,
        keyId: declaration.signature.keyId,
      },
      null,
      2,
    ),
  );
} else if (command === "sign") {
  const payload = await jsonFile<V2ReplicationPack>(required("in"));
  if (payload.schemaVersion !== "2.0")
    throw new Error("Pack schema must be 2.0.");
  const chain = await jsonFile<TrustCertificate[]>(required("chain"));
  const privateKey = createPrivateKey(
    await readFile(required("private-key"), "utf8"),
  );
  const signed = signArtifact({
    artifactType: "scenario_pack",
    artifactSchemaVersion: "2.0",
    artifactId: payload.packId,
    payload,
    purpose: payload.purpose,
    disclosure: payload.purpose === "sealed_holdout" ? "sealed" : "internal",
    signedAt: required("signed-at"),
    certificateChain: chain,
    privateKey,
  }) as SignedReplicationPack;
  const declaration = option("independence-declaration")
    ? await jsonFile<SignedReplicationPack["independenceDeclaration"]>(
        required("independence-declaration"),
      )
    : undefined;
  await writeJson(
    required("out"),
    declaration ? { ...signed, independenceDeclaration: declaration } : signed,
  );
  console.log(
    JSON.stringify(
      {
        artifactHash: signed.signature.artifactHash,
        keyId: signed.signature.keyId,
      },
      null,
      2,
    ),
  );
} else if (command === "verify") {
  const pack = await jsonFile<SignedReplicationPack>(required("in"));
  const trustStore = await trustStoreFromEnvironment(process.env);
  const result = verifySignedReplicationPack({
    pack,
    trustStore,
    expectedPurpose: (option("purpose") ??
      pack.payload.purpose) as ReplicationPackPurpose,
    manifestLockedAt: option("manifest-locked-at"),
    executionStartedAt: option("execution-started-at"),
    studyOwnerOrganization: option("study-owner"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.trusted) process.exitCode = 1;
} else if (command === "seal") {
  const pack = await jsonFile<SignedReplicationPack>(required("in"));
  const key = encryptionKeyFromBase64(
    required("key-id"),
    process.env.PACK_ENCRYPTION_KEY ?? "",
  );
  await writeJson(required("out"), sealReplicationPack(pack, key));
  console.log(
    JSON.stringify(
      {
        packId: pack.payload.packId,
        packHash: pack.signature.artifactHash,
        keyId: key.keyId,
      },
      null,
      2,
    ),
  );
  key.key.fill(0);
} else if (command === "unseal") {
  const envelope = await jsonFile<EncryptedReplicationPack>(required("in"));
  const key = encryptionKeyFromBase64(
    envelope.keyId,
    process.env.PACK_ENCRYPTION_KEY ?? "",
  );
  const pack = unsealReplicationPack(envelope, new Map([[key.keyId, key.key]]));
  await writeJson(required("out"), pack);
  console.log(
    JSON.stringify(
      { packId: pack.payload.packId, packHash: pack.signature.artifactHash },
      null,
      2,
    ),
  );
  key.key.fill(0);
} else if (command === "inspect-metadata") {
  const envelope = await jsonFile<EncryptedReplicationPack>(required("in"));
  console.log(JSON.stringify(inspectSealedPackMetadata(envelope), null, 2));
} else if (command === "checksum") {
  console.log(
    createHash("sha256")
      .update(await readFile(required("in")))
      .digest("hex"),
  );
} else {
  throw new Error(
    "Usage: pack.ts <hash|attest-independence|sign|verify|seal|unseal|inspect-metadata|checksum> [options]",
  );
}

import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type {
  CertificateRole,
  SignedRevocationList,
  TrustCertificate,
} from "../server/v2/types.js";
import {
  createRootCertificate,
  issueCertificate,
  verifySelfSignedRoot,
} from "../server/lib/certificates.js";
import {
  generateSigningKeyPair,
  loadPrivateSigningKey,
  loadPublicSigningKey,
  publicKeyFingerprint,
  writeSigningKeyPair,
} from "../server/lib/keys.js";
import {
  createSignedRevocationList,
  TrustStore,
} from "../server/lib/trustStore.js";
import { jsonFile, list, option, required, writeJson } from "./cli.js";

type TrustDocument = {
  schemaVersion: "1.0";
  anchors: TrustCertificate[];
  certificates: TrustCertificate[];
  revocationLists: SignedRevocationList[];
};
const roles = new Set<CertificateRole>([
  "lab_operator",
  "scenario_author",
  "holdout_custodian",
  "independent_evaluator",
  "human_reviewer",
  "report_publisher",
]);
const roleList = (): CertificateRole[] =>
  list("roles").map((role) => {
    if (!roles.has(role as CertificateRole))
      throw new Error(`Unknown certificate role: ${role}`);
    return role as CertificateRole;
  });
const emptyTrust = (): TrustDocument => ({
  schemaVersion: "1.0",
  anchors: [],
  certificates: [],
  revocationLists: [],
});
async function trustDocument(file: string): Promise<TrustDocument> {
  try {
    return await jsonFile<TrustDocument>(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return emptyTrust();
    throw error;
  }
}
function buildStore(document: TrustDocument): TrustStore {
  const store = new TrustStore();
  for (const item of document.anchors) store.addTrustAnchor(item, true);
  for (const item of document.certificates) store.addCertificate(item);
  for (const item of [...document.revocationLists].sort(
    (a, b) => a.sequence - b.sequence,
  ))
    store.addRevocationList(item);
  return store;
}

const command = process.argv[2];
if (command === "generate") {
  const pair = generateSigningKeyPair();
  const paths = writeSigningKeyPair(
    required("out"),
    option("name") ?? "signing",
    pair,
  );
  console.log(JSON.stringify({ keyId: pair.keyId, ...paths }, null, 2));
} else if (command === "create-root") {
  const privateKey = loadPrivateSigningKey(required("private-key"));
  const publicKey = option("public-key")
    ? loadPublicSigningKey(required("public-key"))
    : createPublicKey(privateKey);
  const certificate = createRootCertificate({
    certificateId: required("certificate-id"),
    subject: required("subject"),
    organization: required("organization"),
    roles: roleList(),
    publicKey,
    privateKey,
    validFrom: required("valid-from"),
    validUntil: required("valid-until"),
  });
  await writeJson(required("out"), certificate);
  console.log(
    JSON.stringify(
      { certificateId: certificate.certificateId, keyId: certificate.keyId },
      null,
      2,
    ),
  );
} else if (command === "issue") {
  const issuer = await jsonFile<TrustCertificate>(required("issuer"));
  const issuerPrivateKey = loadPrivateSigningKey(
    required("issuer-private-key"),
  );
  const publicKey = loadPublicSigningKey(required("subject-public-key"));
  const certificate = issueCertificate({
    certificateId: required("certificate-id"),
    subject: required("subject"),
    organization: required("organization"),
    roles: roleList(),
    publicKey,
    validFrom: required("valid-from"),
    validUntil: required("valid-until"),
    issuer,
    issuerPrivateKey,
  });
  await writeJson(required("out"), certificate);
  console.log(
    JSON.stringify(
      { certificateId: certificate.certificateId, keyId: certificate.keyId },
      null,
      2,
    ),
  );
} else if (command === "verify") {
  const chain = await jsonFile<TrustCertificate[]>(required("chain"));
  const trust = await jsonFile<TrustDocument>(required("trust"));
  const at = option("at") ?? new Date().toISOString();
  const verification = buildStore(trust).verificationForChain({
    chain,
    signedAt: at,
    now: option("now") ?? at,
  });
  console.log(JSON.stringify(verification, null, 2));
  if (!verification.validAtSigning) process.exitCode = 1;
} else if (command === "trust-add") {
  const file = required("trust");
  const certificate = await jsonFile<TrustCertificate>(required("certificate"));
  if (!verifySelfSignedRoot(certificate))
    throw new Error(
      "Only a valid self-signed root can be added as a trust anchor.",
    );
  const trust = await trustDocument(file);
  if (trust.anchors.some((item) => item.keyId === certificate.keyId))
    throw new Error("Trust anchor already exists.");
  trust.anchors.push(certificate);
  await writeFile(file, `${JSON.stringify(trust, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(JSON.stringify({ added: certificate.keyId }, null, 2));
} else if (command === "trust-list") {
  const trust = await trustDocument(required("trust"));
  console.log(
    JSON.stringify(
      {
        anchors: trust.anchors.map((item) => ({
          certificateId: item.certificateId,
          keyId: item.keyId,
          organization: item.organization,
          roles: item.roles,
        })),
        certificates: trust.certificates.map((item) => ({
          certificateId: item.certificateId,
          keyId: item.keyId,
          organization: item.organization,
          roles: item.roles,
        })),
        revocationLists: trust.revocationLists.map((item) => ({
          sequence: item.sequence,
          issuedAt: item.issuedAt,
          count: item.revocations.length,
        })),
      },
      null,
      2,
    ),
  );
} else if (command === "trust-revoke") {
  const file = required("trust");
  const trust = await trustDocument(file);
  const issuer = await jsonFile<TrustCertificate>(required("issuer"));
  const privateKey = createPrivateKey(
    await readFile(required("issuer-private-key"), "utf8"),
  );
  const certificateId = required("certificate-id");
  const target = [...trust.anchors, ...trust.certificates].find(
    (item) => item.certificateId === certificateId,
  );
  if (!target)
    throw new Error("Certificate is not present in the trust document.");
  const next = createSignedRevocationList({
    issuer,
    issuerPrivateKey: privateKey,
    issuedAt: required("revoked-at"),
    sequence: (trust.revocationLists.at(-1)?.sequence ?? 0) + 1,
    revocations: [
      {
        certificateId,
        keyId: target.keyId,
        revokedAt: required("revoked-at"),
        reason: required("reason"),
      },
    ],
  });
  buildStore(trust).addRevocationList(next);
  trust.revocationLists.push(next);
  await writeFile(file, `${JSON.stringify(trust, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      { revoked: certificateId, sequence: next.sequence },
      null,
      2,
    ),
  );
} else if (command === "fingerprint") {
  console.log(
    publicKeyFingerprint(
      createPublicKey(await readFile(required("public-key"), "utf8")),
    ),
  );
} else {
  throw new Error(
    "Usage: pki.ts <generate|create-root|issue|verify|trust-add|trust-list|trust-revoke|fingerprint> [options]",
  );
}

import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import type { CertificateRole, TrustCertificate } from "../v2/types.js";
import { canonicalJson } from "./canonicalJson.js";
import { exportPublicKey, publicKeyFingerprint } from "./keys.js";

type CertificateBody = Omit<TrustCertificate, "signature">;

function certificateBytes(body: CertificateBody): Buffer {
  return Buffer.from(
    canonicalJson({ artifactType: "trust_certificate", ...body }),
    "utf8",
  );
}

export function createRootCertificate(args: {
  certificateId: string;
  subject: string;
  organization: string;
  roles: CertificateRole[];
  publicKey: KeyObject;
  privateKey: KeyObject;
  validFrom: string;
  validUntil: string;
}): TrustCertificate {
  const keyId = publicKeyFingerprint(args.publicKey);
  const body: CertificateBody = {
    schemaVersion: "1.0",
    certificateId: args.certificateId,
    keyId,
    subject: args.subject,
    organization: args.organization,
    roles: [...new Set(args.roles)].sort(),
    publicKey: exportPublicKey(args.publicKey),
    validFrom: args.validFrom,
    validUntil: args.validUntil,
    issuerKeyId: keyId,
  };
  return {
    ...body,
    signature: sign(null, certificateBytes(body), args.privateKey).toString(
      "base64url",
    ),
  };
}

export function issueCertificate(args: {
  certificateId: string;
  subject: string;
  organization: string;
  roles: CertificateRole[];
  publicKey: KeyObject;
  validFrom: string;
  validUntil: string;
  issuer: TrustCertificate;
  issuerPrivateKey: KeyObject;
}): TrustCertificate {
  if (!args.issuer.roles.includes("lab_operator"))
    throw new Error(
      "certificate_issuer_not_authorized: issuer requires lab_operator role",
    );
  const body: CertificateBody = {
    schemaVersion: "1.0",
    certificateId: args.certificateId,
    keyId: publicKeyFingerprint(args.publicKey),
    subject: args.subject,
    organization: args.organization,
    roles: [...new Set(args.roles)].sort(),
    publicKey: exportPublicKey(args.publicKey),
    validFrom: args.validFrom,
    validUntil: args.validUntil,
    issuerKeyId: args.issuer.keyId,
  };
  return {
    ...body,
    signature: sign(
      null,
      certificateBytes(body),
      args.issuerPrivateKey,
    ).toString("base64url"),
  };
}

export function verifyCertificateSignature(
  certificate: TrustCertificate,
  issuer: TrustCertificate,
): boolean {
  const { signature, ...body } = certificate;
  if (certificate.issuerKeyId !== issuer.keyId) return false;
  if (publicKeyFingerprint(certificate.publicKey) !== certificate.keyId)
    return false;
  try {
    return verify(
      null,
      certificateBytes(body),
      createPublicKey(issuer.publicKey),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function verifySelfSignedRoot(certificate: TrustCertificate): boolean {
  return (
    certificate.keyId === certificate.issuerKeyId &&
    verifyCertificateSignature(certificate, certificate)
  );
}

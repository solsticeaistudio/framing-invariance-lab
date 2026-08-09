import { verify, createPublicKey, type KeyObject, sign } from "node:crypto";
import type {
  CertificateRole,
  CertificateVerificationStatus,
  RevocationEntry,
  SignatureVerification,
  SignedRevocationList,
  TrustCertificate,
} from "../v2/types.js";
import { canonicalJson, canonicalSha256 } from "./canonicalJson.js";
import {
  verifyCertificateSignature,
  verifySelfSignedRoot,
} from "./certificates.js";

function time(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_timestamp: ${value}`);
  return parsed;
}

function unsignedRevocationList(list: SignedRevocationList) {
  const { signature: _signature, ...body } = list;
  return body;
}

export class TrustStore {
  readonly #anchors = new Map<string, TrustCertificate>();
  readonly #certificates = new Map<string, TrustCertificate>();
  readonly #revocations = new Map<string, RevocationEntry>();
  #revocationSequence = -1;

  addTrustAnchor(
    certificate: TrustCertificate,
    approvedByAdministrator = false,
  ): void {
    if (!approvedByAdministrator)
      throw new Error("trust_anchor_admin_approval_required");
    if (!verifySelfSignedRoot(certificate))
      throw new Error("invalid_self_signed_trust_anchor");
    this.#anchors.set(certificate.keyId, structuredClone(certificate));
    this.#certificates.set(certificate.keyId, structuredClone(certificate));
  }

  addCertificate(certificate: TrustCertificate): void {
    this.#certificates.set(certificate.keyId, structuredClone(certificate));
  }

  listAnchors(): TrustCertificate[] {
    return [...this.#anchors.values()].map((item) => structuredClone(item));
  }

  listCertificates(): TrustCertificate[] {
    return [...this.#certificates.values()].map((item) =>
      structuredClone(item),
    );
  }

  revocations(): RevocationEntry[] {
    return [...this.#revocations.values()].map((item) => structuredClone(item));
  }

  addRevocationList(list: SignedRevocationList): void {
    if (list.sequence <= this.#revocationSequence)
      throw new Error("stale_revocation_list");
    const issuer = this.#certificates.get(list.issuerKeyId);
    if (!issuer || !issuer.roles.includes("lab_operator"))
      throw new Error("untrusted_revocation_issuer");
    const valid = verify(
      null,
      Buffer.from(
        canonicalJson({
          artifactType: "revocation_list",
          ...unsignedRevocationList(list),
        }),
      ),
      createPublicKey(issuer.publicKey),
      Buffer.from(list.signature, "base64url"),
    );
    if (!valid) throw new Error("invalid_revocation_list_signature");
    for (const entry of list.revocations)
      this.#revocations.set(entry.certificateId, structuredClone(entry));
    this.#revocationSequence = list.sequence;
  }

  verificationForChain(args: {
    chain: TrustCertificate[];
    signedAt: string;
    requiredRole?: CertificateRole;
    now?: string;
  }): Omit<SignatureVerification, "artifactHashValid" | "signatureValid"> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const leaf = args.chain[0];
    if (!leaf)
      return {
        validAtSigning: false,
        currentlyValid: false,
        status: "invalid_chain",
        certificateChainValid: false,
        errors: ["Certificate chain is empty."],
        warnings,
      };
    const signingTime = time(args.signedAt);
    const now = time(args.now ?? new Date().toISOString());
    const root = args.chain.at(-1)!;
    const trustedRoot = this.#anchors.get(root.keyId);
    if (
      !trustedRoot ||
      canonicalSha256(trustedRoot) !== canonicalSha256(root)
    ) {
      return {
        validAtSigning: false,
        currentlyValid: false,
        status: "unknown_issuer",
        certificateChainValid: false,
        signerKeyId: leaf.keyId,
        signerOrganization: leaf.organization,
        errors: [
          "Certificate chain does not terminate at a configured trust anchor.",
        ],
        warnings,
      };
    }
    for (let index = 0; index < args.chain.length; index += 1) {
      const certificate = args.chain[index];
      const issuer = args.chain[index + 1] ?? certificate;
      if (!verifyCertificateSignature(certificate, issuer))
        errors.push(`Invalid certificate signature at chain index ${index}.`);
    }
    if (errors.length)
      return {
        validAtSigning: false,
        currentlyValid: false,
        status: "invalid_chain",
        certificateChainValid: false,
        signerKeyId: leaf.keyId,
        signerOrganization: leaf.organization,
        errors,
        warnings,
      };
    if (args.requiredRole && !leaf.roles.includes(args.requiredRole)) {
      return {
        validAtSigning: false,
        currentlyValid: false,
        status: "unauthorized_role",
        certificateChainValid: true,
        signerKeyId: leaf.keyId,
        signerOrganization: leaf.organization,
        errors: [`Signer lacks required ${args.requiredRole} role.`],
        warnings,
      };
    }
    for (const certificate of args.chain) {
      if (signingTime < time(certificate.validFrom))
        return {
          validAtSigning: false,
          currentlyValid: false,
          status: "not_yet_valid_at_signing",
          certificateChainValid: true,
          signerKeyId: leaf.keyId,
          signerOrganization: leaf.organization,
          errors: ["A certificate was not yet valid at signing time."],
          warnings,
        };
      if (signingTime > time(certificate.validUntil))
        return {
          validAtSigning: false,
          currentlyValid: false,
          status: "expired_at_signing",
          certificateChainValid: true,
          signerKeyId: leaf.keyId,
          signerOrganization: leaf.organization,
          errors: ["A certificate was expired at signing time."],
          warnings,
        };
      const revocation = this.#revocations.get(certificate.certificateId);
      if (revocation && time(revocation.revokedAt) <= signingTime)
        return {
          validAtSigning: false,
          currentlyValid: false,
          status: "revoked_before_signing",
          revocationReason: revocation.reason,
          certificateChainValid: true,
          signerKeyId: leaf.keyId,
          signerOrganization: leaf.organization,
          errors: [
            `Certificate was revoked before signing: ${revocation.reason}`,
          ],
          warnings,
        };
    }
    const laterRevocation = args.chain
      .map((certificate) => this.#revocations.get(certificate.certificateId))
      .find(
        (entry) =>
          entry &&
          time(entry.revokedAt) > signingTime &&
          time(entry.revokedAt) <= now,
      );
    if (laterRevocation) {
      warnings.push(
        `Certificate was revoked after signing: ${laterRevocation.reason}`,
      );
      return {
        validAtSigning: true,
        currentlyValid: false,
        status: "revoked_after_signing",
        revocationReason: laterRevocation.reason,
        certificateChainValid: true,
        signerKeyId: leaf.keyId,
        signerOrganization: leaf.organization,
        errors,
        warnings,
      };
    }
    if (args.chain.some((certificate) => now > time(certificate.validUntil))) {
      warnings.push("Certificate expired after the artifact was signed.");
      return {
        validAtSigning: true,
        currentlyValid: false,
        status: "expired_after_signing",
        certificateChainValid: true,
        signerKeyId: leaf.keyId,
        signerOrganization: leaf.organization,
        errors,
        warnings,
      };
    }
    return {
      validAtSigning: true,
      currentlyValid: true,
      status: "valid",
      certificateChainValid: true,
      signerKeyId: leaf.keyId,
      signerOrganization: leaf.organization,
      errors,
      warnings,
    };
  }
}

export function createSignedRevocationList(args: {
  issuer: TrustCertificate;
  issuerPrivateKey: KeyObject;
  issuedAt: string;
  sequence: number;
  revocations: RevocationEntry[];
}): SignedRevocationList {
  const body = {
    schemaVersion: "1.0" as const,
    issuerKeyId: args.issuer.keyId,
    issuedAt: args.issuedAt,
    sequence: args.sequence,
    revocations: [...args.revocations].sort((a, b) =>
      a.certificateId.localeCompare(b.certificateId),
    ),
  };
  const signature = sign(
    null,
    Buffer.from(canonicalJson({ artifactType: "revocation_list", ...body })),
    args.issuerPrivateKey,
  ).toString("base64url");
  return { ...body, signature };
}

export function statusIsDisqualifying(
  status: CertificateVerificationStatus,
): boolean {
  return !["valid", "expired_after_signing", "revoked_after_signing"].includes(
    status,
  );
}

import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import type {
  ArtifactSignature,
  ArtifactType,
  CertificateRole,
  SignatureVerification,
  SignedArtifact,
  TrustCertificate,
} from "../v2/types.js";
import { canonicalJson, canonicalSha256 } from "./canonicalJson.js";
import { publicKeyFingerprint } from "./keys.js";
import { TrustStore } from "./trustStore.js";

function signatureStatement(
  signature: Omit<ArtifactSignature, "signature">,
): Buffer {
  return Buffer.from(
    canonicalJson({
      signatureDomain: "framing-invariance-lab.artifact.v1",
      ...signature,
    }),
    "utf8",
  );
}

export function signArtifact<T>(args: {
  artifactType: ArtifactType;
  artifactSchemaVersion: string;
  artifactId: string;
  payload: T;
  purpose: string;
  parentArtifactHashes?: string[];
  disclosure: ArtifactSignature["disclosure"];
  signedAt: string;
  certificateChain: TrustCertificate[];
  privateKey: KeyObject;
}): SignedArtifact<T> {
  const leaf = args.certificateChain[0];
  if (!leaf) throw new Error("signing_certificate_chain_required");
  const keyId = publicKeyFingerprint(createPublicKey(leaf.publicKey));
  if (
    keyId !== leaf.keyId ||
    publicKeyFingerprint(createPublicKey(args.privateKey)) !== leaf.keyId
  )
    throw new Error("signing_key_certificate_mismatch");
  const unsigned: Omit<ArtifactSignature, "signature"> = {
    schemaVersion: "1.0",
    algorithm: "Ed25519",
    canonicalization: "jcs-v1",
    artifactType: args.artifactType,
    artifactSchemaVersion: args.artifactSchemaVersion,
    artifactId: args.artifactId,
    artifactHash: canonicalSha256(args.payload),
    keyId: leaf.keyId,
    certificateId: leaf.certificateId,
    purpose: args.purpose,
    parentArtifactHashes: [...new Set(args.parentArtifactHashes ?? [])].sort(),
    disclosure: args.disclosure,
    signedAt: args.signedAt,
  };
  const artifactSignature: ArtifactSignature = {
    ...unsigned,
    signature: sign(
      null,
      signatureStatement(unsigned),
      args.privateKey,
    ).toString("base64url"),
  };
  return {
    envelopeSchemaVersion: "1.0",
    canonicalization: "jcs-v1",
    artifactType: args.artifactType,
    artifactSchemaVersion: args.artifactSchemaVersion,
    payload: structuredClone(args.payload),
    certificateChain: structuredClone(args.certificateChain),
    signature: artifactSignature,
  };
}

export function verifySignedArtifact<T>(args: {
  artifact: SignedArtifact<T>;
  trustStore: TrustStore;
  expectedType: ArtifactType;
  expectedPurpose?: string;
  requiredRole?: CertificateRole;
  now?: string;
}): SignatureVerification {
  const { artifact } = args;
  const hashValid =
    artifact.signature.artifactHash === canonicalSha256(artifact.payload);
  const typeValid =
    artifact.artifactType === args.expectedType &&
    artifact.signature.artifactType === args.expectedType;
  const schemaValid =
    artifact.artifactSchemaVersion === artifact.signature.artifactSchemaVersion;
  const purposeValid =
    args.expectedPurpose === undefined ||
    artifact.signature.purpose === args.expectedPurpose;
  const leaf = artifact.certificateChain[0];
  let signatureValid = false;
  if (
    leaf &&
    leaf.keyId === artifact.signature.keyId &&
    leaf.certificateId === artifact.signature.certificateId
  ) {
    try {
      const { signature, ...unsigned } = artifact.signature;
      signatureValid = verify(
        null,
        signatureStatement(unsigned),
        createPublicKey(leaf.publicKey),
        Buffer.from(signature, "base64url"),
      );
    } catch {
      signatureValid = false;
    }
  }
  const chain = args.trustStore.verificationForChain({
    chain: artifact.certificateChain,
    signedAt: artifact.signature.signedAt,
    requiredRole: args.requiredRole,
    now: args.now,
  });
  const errors = [...chain.errors];
  if (!hashValid)
    errors.push("Artifact payload hash does not match the signature envelope.");
  if (!typeValid)
    errors.push("Artifact type does not match the signature domain.");
  if (!schemaValid)
    errors.push("Artifact schema version does not match its signature.");
  if (!purposeValid)
    errors.push("Artifact purpose does not match the expected purpose.");
  if (!signatureValid) errors.push("Artifact signature is invalid.");
  return {
    ...chain,
    validAtSigning:
      chain.validAtSigning &&
      hashValid &&
      typeValid &&
      schemaValid &&
      purposeValid &&
      signatureValid,
    currentlyValid:
      chain.currentlyValid &&
      hashValid &&
      typeValid &&
      schemaValid &&
      purposeValid &&
      signatureValid,
    artifactHashValid: hashValid,
    signatureValid,
    errors,
  };
}

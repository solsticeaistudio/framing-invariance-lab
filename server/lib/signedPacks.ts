import type { Scenario } from "../types.js";
import type {
  EncryptedReplicationPack,
  HoldoutPackAttestation,
  IndependenceDeclaration,
  ReplicationPackPurpose,
  SignatureVerification,
  SignedIndependenceDeclaration,
  SignedArtifact,
  SignedReplicationPack,
  TrustCertificate,
} from "../v2/types.js";
import { canonicalSha256 } from "./canonicalJson.js";
import { scenarioSchema } from "../schema.js";
import { roleMatchesSplit } from "./replication.js";
import { signArtifact, verifySignedArtifact } from "./signatures.js";
import { TrustStore } from "./trustStore.js";
import type { KeyObject } from "node:crypto";

export function createHoldoutPackAttestation(args: {
  encryptedPack: EncryptedReplicationPack;
  pack: SignedReplicationPack<Scenario>;
  methodologyCompatibilityHash: string;
  identity: { certificateChain: TrustCertificate[]; privateKey: KeyObject };
  createdAt: string;
}): SignedArtifact<HoldoutPackAttestation> {
  if (
    !args.pack.payload.replicationIdentity ||
    args.pack.payload.researchIdentityVersion !== "replication-identity-v1"
  )
    throw new Error("canonical_replication_identity_missing");
  if (
    !args.pack.payload.claimKey ||
    args.pack.payload.claimIdentityVersion !== "claim-identity-v1"
  )
    throw new Error("canonical_claim_identity_missing");
  const payload: HoldoutPackAttestation = {
    schemaVersion: "1.0",
    replicationIdentity: args.pack.payload.replicationIdentity,
    claimKey: args.pack.payload.claimKey,
    researchIdentityVersion: args.pack.payload.researchIdentityVersion,
    claimIdentityVersion: args.pack.payload.claimIdentityVersion,
    packId: args.pack.payload.packId,
    encryptedPackHash: canonicalSha256(args.encryptedPack),
    plaintextCommitmentHash: args.pack.signature.artifactHash,
    datasetIdentity: args.pack.payload.datasetIdentity,
    replicationKeys: args.pack.payload.scenarios
      .map((scenario) =>
        typeof scenario === "object" && scenario && "replicationKey" in scenario
          ? String(
              (scenario as { replicationKey?: unknown }).replicationKey ?? "",
            )
          : "",
      )
      .filter(Boolean)
      .sort(),
    scenarioCount: args.pack.payload.scenarios.length,
    methodologyCompatibilityHash: args.methodologyCompatibilityHash,
    purpose: "sealed_holdout",
    custodianOrganization:
      args.identity.certificateChain[0]?.organization ?? "unknown",
    custodianCertificateId:
      args.identity.certificateChain[0]?.certificateId ?? "",
    createdAt: args.createdAt,
  };
  return signArtifact({
    artifactType: "holdout_pack_attestation",
    artifactSchemaVersion: payload.schemaVersion,
    artifactId: `attestation-${payload.packId}`,
    payload,
    purpose: "sealed-holdout-pack-attestation",
    parentArtifactHashes: [
      payload.plaintextCommitmentHash,
      payload.encryptedPackHash,
    ],
    disclosure: "sealed",
    signedAt: args.createdAt,
    ...args.identity,
  });
}

export function verifyHoldoutPackAttestation(args: {
  attestation: SignedArtifact<HoldoutPackAttestation>;
  trustStore: TrustStore;
  expectedEncryptedPackHash?: string;
  expectedMethodologyHash: string;
  now?: string;
}): string[] {
  const verification = verifySignedArtifact({
    artifact: args.attestation,
    trustStore: args.trustStore,
    expectedType: "holdout_pack_attestation",
    expectedPurpose: "sealed-holdout-pack-attestation",
    requiredRole: "holdout_custodian",
    now: args.now,
  });
  const errors = verification.validAtSigning
    ? []
    : ["holdout_attestation_signature_invalid"];
  const payload = args.attestation.payload;
  if (payload.purpose !== "sealed_holdout")
    errors.push("holdout_attestation_purpose_invalid");
  if (
    args.expectedEncryptedPackHash &&
    payload.encryptedPackHash !== args.expectedEncryptedPackHash
  )
    errors.push("holdout_attestation_encrypted_pack_mismatch");
  if (payload.methodologyCompatibilityHash !== args.expectedMethodologyHash)
    errors.push("holdout_attestation_methodology_mismatch");
  if (
    !payload.replicationIdentity ||
    payload.researchIdentityVersion !== "replication-identity-v1"
  )
    errors.push("canonical_replication_identity_missing");
  if (!payload.claimKey || payload.claimIdentityVersion !== "claim-identity-v1")
    errors.push("canonical_claim_identity_missing");
  if (
    !args.attestation.signature.parentArtifactHashes.includes(
      payload.plaintextCommitmentHash,
    )
  )
    errors.push("holdout_attestation_plaintext_commitment_unbound");
  return [...new Set(errors)];
}

export type SignedPackVerification = {
  trusted: boolean;
  signature: SignatureVerification;
  independence?: SignatureVerification;
  scenarios: Scenario[];
  blockers: string[];
  warnings: string[];
};

function requiredRole(purpose: ReplicationPackPurpose) {
  return purpose === "sealed_holdout"
    ? ("holdout_custodian" as const)
    : purpose === "independent_replication"
      ? ("independent_evaluator" as const)
      : ("scenario_author" as const);
}

function verifyIndependence(args: {
  declaration?: SignedIndependenceDeclaration;
  trustStore: TrustStore;
  studyOwnerOrganization?: string;
  packSignedAt: string;
  executionStartedAt?: string;
  packId: string;
  packHash: string;
}): {
  verification?: SignatureVerification;
  declaration?: IndependenceDeclaration;
  blockers: string[];
  warnings: string[];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!args.declaration)
    return { blockers: ["missing_independence_declaration"], warnings };
  const verification = verifySignedArtifact({
    artifact: args.declaration,
    trustStore: args.trustStore,
    expectedType: "independence_declaration",
    expectedPurpose: "independent_replication",
    requiredRole: "independent_evaluator",
    now: args.executionStartedAt,
  });
  if (!verification.validAtSigning)
    blockers.push("invalid_independence_declaration_signature");
  const declaration = args.declaration.payload;
  if (
    declaration.packId !== args.packId ||
    declaration.packContentHash !== args.packHash
  )
    blockers.push("independence_declaration_pack_mismatch");
  if (!args.declaration.signature.parentArtifactHashes.includes(args.packHash))
    blockers.push("independence_declaration_pack_commitment_missing");
  if (verification.signerOrganization !== declaration.evaluatorOrganization)
    blockers.push("certificate_organization_mismatch");
  if (
    args.studyOwnerOrganization &&
    declaration.evaluatorOrganization === args.studyOwnerOrganization
  )
    blockers.push("same_organization_independent_claim");
  if (
    declaration.studyOwnerOrganization &&
    declaration.studyOwnerOrganization === declaration.evaluatorOrganization
  )
    blockers.push("same_organization_independent_claim");
  if (declaration.conflictsOfInterest.length)
    blockers.push("unresolved_conflict_declaration");
  if (declaration.priorAccessToDevelopmentResults)
    blockers.push("prior_development_access_disclosed");
  if (Date.parse(declaration.declaredAt) > Date.parse(args.packSignedAt))
    blockers.push("independence_declaration_signed_after_pack");
  if (
    args.executionStartedAt &&
    Date.parse(args.declaration.signature.signedAt) >
      Date.parse(args.executionStartedAt)
  )
    blockers.push("independence_declaration_signed_after_execution");
  if (declaration.fundingRelationships.length)
    warnings.push(
      "Funding relationships were disclosed and require human review.",
    );
  return {
    verification,
    declaration,
    blockers: [...new Set(blockers)],
    warnings,
  };
}

export function verifySignedReplicationPack(args: {
  pack: SignedReplicationPack;
  trustStore: TrustStore;
  expectedPurpose: ReplicationPackPurpose;
  manifestLockedAt?: string;
  executionStartedAt?: string;
  studyOwnerOrganization?: string;
}): SignedPackVerification {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const signature = verifySignedArtifact({
    artifact: args.pack,
    trustStore: args.trustStore,
    expectedType: "scenario_pack",
    expectedPurpose: args.expectedPurpose,
    requiredRole: requiredRole(args.expectedPurpose),
    now: args.executionStartedAt,
  });
  if (!signature.validAtSigning) blockers.push("invalid_pack_signature");
  if (args.pack.payload.schemaVersion !== "2.0")
    blockers.push("invalid_pack_schema");
  if (args.pack.payload.purpose !== args.expectedPurpose)
    blockers.push("pack_purpose_mismatch");
  if (
    !args.pack.payload.replicationIdentity ||
    args.pack.payload.researchIdentityVersion !== "replication-identity-v1"
  )
    blockers.push("canonical_replication_identity_missing");
  if (
    !args.pack.payload.claimKey ||
    args.pack.payload.claimIdentityVersion !== "claim-identity-v1"
  )
    blockers.push("canonical_claim_identity_missing");
  if (/^(declared|derived):/.test(args.pack.payload.replicationIdentity))
    blockers.push("legacy_identity_not_promotable");
  if (
    args.manifestLockedAt &&
    Date.parse(args.pack.signature.signedAt) > Date.parse(args.manifestLockedAt)
  )
    blockers.push("pack_signed_after_manifest_lock");
  const scenarios: Scenario[] = [];
  for (const [index, raw] of args.pack.payload.scenarios.entries()) {
    const parsed = scenarioSchema.safeParse(raw);
    if (!parsed.success) {
      blockers.push(`invalid_scenario_${index}`);
      continue;
    }
    const scenario = parsed.data as Scenario;
    const expectedRole =
      args.expectedPurpose === "validation"
        ? "validation"
        : args.expectedPurpose === "development"
          ? "development"
          : args.expectedPurpose;
    if (
      scenario.replicationRole !== expectedRole ||
      !roleMatchesSplit(expectedRole, scenario.datasetSplit)
    )
      blockers.push(`role_split_mismatch_${index}`);
    scenarios.push(scenario);
  }
  let independence: SignatureVerification | undefined;
  if (args.expectedPurpose === "independent_replication") {
    const result = verifyIndependence({
      declaration: args.pack.independenceDeclaration,
      trustStore: args.trustStore,
      studyOwnerOrganization: args.studyOwnerOrganization,
      packSignedAt: args.pack.signature.signedAt,
      executionStartedAt: args.executionStartedAt,
      packId: args.pack.payload.packId,
      packHash: args.pack.signature.artifactHash,
    });
    independence = result.verification;
    blockers.push(...result.blockers);
    warnings.push(...result.warnings);
  }
  return {
    trusted: blockers.length === 0,
    signature,
    independence,
    scenarios,
    blockers: [...new Set(blockers)],
    warnings,
  };
}

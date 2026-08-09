import { describe, expect, it } from "vitest";
import type { Scenario } from "../types.js";
import type {
  IndependenceDeclaration,
  SignedIndependenceDeclaration,
  SignedReplicationPack,
  V2ReplicationPack,
} from "../v2/types.js";
import { makePkiFixture } from "../testing/pkiFixtures.js";
import { makeRunFixture } from "../testing/fixtures.js";
import {
  inspectSealedPackMetadata,
  sealReplicationPack,
  unsealReplicationPack,
} from "./encryption.js";
import { signArtifact } from "./signatures.js";
import { verifySignedReplicationPack } from "./signedPacks.js";
import { canonicalResearchIdentity } from "./executionPlan.js";
import { canonicalSha256 } from "./canonicalJson.js";

const SIGNED_AT = "2026-01-01T00:00:00.000Z";

function scenario(purpose: V2ReplicationPack<Scenario>["purpose"]): Scenario {
  const value = structuredClone(makeRunFixture().config.scenarios[0]);
  value.id = `${purpose.replaceAll("_", "-")}-scenario`;
  value.datasetSplit = purpose === "sealed_holdout" ? "holdout" : "validation";
  value.replicationRole = purpose;
  delete value.replicationProvenance;
  return value;
}

function signedPack(
  purpose: V2ReplicationPack<Scenario>["purpose"],
  organization = "Independent Test Lab",
) {
  const role =
    purpose === "sealed_holdout"
      ? ("holdout_custodian" as const)
      : purpose === "independent_replication"
        ? ("independent_evaluator" as const)
        : ("scenario_author" as const);
  const pki = makePkiFixture({
    leafRoles: [role],
    leafOrganization: organization,
  });
  const packScenario = scenario(purpose);
  const identity = canonicalResearchIdentity({
    scenario: packScenario,
    outcomeType: "invariance",
    methodologyCompatibilityHash: canonicalSha256("fixture-methodology"),
    targetCompatibilityPolicy: "same_requested_model",
  });
  const payload: V2ReplicationPack<Scenario> = {
    schemaVersion: "2.0",
    packId: `${purpose.replaceAll("_", "-")}-pack`,
    label: "Signed fixture pack",
    description: "Non-production signed test material.",
    researchQuestion: "Does the frozen fixture reproduce?",
    datasetIdentity: `${purpose.replaceAll("_", "-")}-dataset-v1`,
    purpose,
    replicationIdentity: identity.replicationIdentity,
    claimKey: identity.claimKey,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
    scenarios: [packScenario],
  };
  const artifact = signArtifact({
    artifactType: "scenario_pack",
    artifactSchemaVersion: "2.0",
    artifactId: payload.packId,
    payload,
    purpose,
    disclosure: "sealed",
    signedAt: SIGNED_AT,
    certificateChain: pki.chain,
    privateKey: pki.leafKeys.privateKey,
  }) as SignedReplicationPack<Scenario>;
  return { ...pki, artifact };
}

function declaration(
  fixture: ReturnType<typeof signedPack>,
  owner = "Study Owner",
): SignedIndependenceDeclaration {
  const payload: IndependenceDeclaration = {
    schemaVersion: "1.0",
    packId: fixture.artifact.payload.packId,
    packContentHash: fixture.artifact.signature.artifactHash,
    evaluatorOrganization: fixture.leaf.organization,
    studyOwnerOrganization: owner,
    datasetCustodianOrganization: fixture.leaf.organization,
    scenarioAuthorship: "independent",
    fundingRelationships: [],
    conflictsOfInterest: [],
    priorAccessToDevelopmentResults: false,
    dataCustodyStatement: "The evaluator controlled the fixture dataset.",
    declaredAt: "2025-12-20T00:00:00.000Z",
  };
  return signArtifact({
    artifactType: "independence_declaration",
    artifactSchemaVersion: "1.0",
    artifactId: "independence-fixture",
    payload,
    purpose: "independent_replication",
    parentArtifactHashes: [fixture.artifact.signature.artifactHash],
    disclosure: "internal",
    signedAt: "2025-12-20T00:00:00.000Z",
    certificateChain: fixture.chain,
    privateKey: fixture.leafKeys.privateKey,
  });
}

describe("signed v2 replication packs", () => {
  it.each(["validation", "sealed_holdout"] as const)(
    "accepts a valid signed %s pack",
    (purpose) => {
      const fixture = signedPack(purpose);
      expect(
        verifySignedReplicationPack({
          pack: fixture.artifact,
          trustStore: fixture.trustStore,
          expectedPurpose: purpose,
          manifestLockedAt: "2026-01-02T00:00:00.000Z",
        }),
      ).toMatchObject({ trusted: true, blockers: [] });
    },
  );

  it("accepts an attributable independent pack with distinct organization", () => {
    const fixture = signedPack("independent_replication");
    fixture.artifact.independenceDeclaration = declaration(fixture);
    expect(
      verifySignedReplicationPack({
        pack: fixture.artifact,
        trustStore: fixture.trustStore,
        expectedPurpose: "independent_replication",
        studyOwnerOrganization: "Study Owner",
        executionStartedAt: "2026-01-03T00:00:00.000Z",
      }),
    ).toMatchObject({ trusted: true, blockers: [] });
  });

  it("rejects content changes, untrusted roots, and role/split mismatch", () => {
    const fixture = signedPack("sealed_holdout");
    const modified = structuredClone(fixture.artifact);
    modified.payload.label = "Changed after signing";
    expect(
      verifySignedReplicationPack({
        pack: modified,
        trustStore: fixture.trustStore,
        expectedPurpose: "sealed_holdout",
      }).blockers,
    ).toContain("invalid_pack_signature");
    expect(
      verifySignedReplicationPack({
        pack: fixture.artifact,
        trustStore: makePkiFixture().trustStore,
        expectedPurpose: "sealed_holdout",
      }).trusted,
    ).toBe(false);
    const mismatch = structuredClone(fixture.artifact);
    mismatch.payload.scenarios[0].datasetSplit = "validation";
    expect(
      verifySignedReplicationPack({
        pack: mismatch,
        trustStore: fixture.trustStore,
        expectedPurpose: "sealed_holdout",
      }).blockers.some(
        (item) =>
          item.includes("invalid_scenario") || item.includes("role_split"),
      ),
    ).toBe(true);
  });

  it("blocks missing, same-organization, conflicted, and late independence attestations", () => {
    const fixture = signedPack("independent_replication", "Study Owner");
    expect(
      verifySignedReplicationPack({
        pack: fixture.artifact,
        trustStore: fixture.trustStore,
        expectedPurpose: "independent_replication",
        studyOwnerOrganization: "Study Owner",
      }).blockers,
    ).toContain("missing_independence_declaration");
    fixture.artifact.independenceDeclaration = declaration(
      fixture,
      "Study Owner",
    );
    expect(
      verifySignedReplicationPack({
        pack: fixture.artifact,
        trustStore: fixture.trustStore,
        expectedPurpose: "independent_replication",
        studyOwnerOrganization: "Study Owner",
      }).blockers,
    ).toContain("same_organization_independent_claim");
    fixture.artifact.independenceDeclaration.payload.conflictsOfInterest = [
      "Shared funding",
    ];
    fixture.artifact.independenceDeclaration.signature.signedAt =
      "2026-02-01T00:00:00.000Z";
    expect(
      verifySignedReplicationPack({
        pack: fixture.artifact,
        trustStore: fixture.trustStore,
        expectedPurpose: "independent_replication",
        studyOwnerOrganization: "Study Owner",
        executionStartedAt: "2026-01-03T00:00:00.000Z",
      }).blockers,
    ).toEqual(
      expect.arrayContaining([
        "invalid_independence_declaration_signature",
        "unresolved_conflict_declaration",
        "independence_declaration_signed_after_execution",
      ]),
    );
  });

  it("encrypts sealed packs with authenticated metadata and reveals no plaintext on inspection", () => {
    const fixture = signedPack("sealed_holdout");
    fixture.artifact.payload.scenarios[0].basePrompt = "HIDDEN_PACK_PLAINTEXT";
    const resigned = signArtifact({
      artifactType: "scenario_pack",
      artifactSchemaVersion: "2.0",
      artifactId: fixture.artifact.payload.packId,
      payload: fixture.artifact.payload,
      purpose: "sealed_holdout",
      disclosure: "sealed",
      signedAt: SIGNED_AT,
      certificateChain: fixture.chain,
      privateKey: fixture.leafKeys.privateKey,
    }) as SignedReplicationPack;
    const key = { keyId: "test-encryption-key", key: Buffer.alloc(32, 7) };
    const sealed = sealReplicationPack(resigned, key);
    expect(JSON.stringify(sealed)).not.toContain("HIDDEN_PACK_PLAINTEXT");
    expect(JSON.stringify(inspectSealedPackMetadata(sealed))).not.toContain(
      "HIDDEN_PACK_PLAINTEXT",
    );
    expect(
      unsealReplicationPack(sealed, new Map([[key.keyId, key.key]])).payload
        .scenarios,
    ).toEqual(resigned.payload.scenarios);

    const tampered = structuredClone(sealed);
    tampered.ciphertext = `${tampered.ciphertext.slice(0, -2)}aa`;
    expect(() =>
      unsealReplicationPack(tampered, new Map([[key.keyId, key.key]])),
    ).toThrow("sealed_pack_authentication_failed");
    expect(() =>
      unsealReplicationPack(
        sealed,
        new Map([[key.keyId, Buffer.alloc(32, 8)]]),
      ),
    ).toThrow("sealed_pack_authentication_failed");
  });
});

import { describe, expect, it } from "vitest";
import { makePkiFixture } from "../testing/pkiFixtures.js";
import { generateSigningKeyPair } from "./keys.js";
import { signArtifact, verifySignedArtifact } from "./signatures.js";
import { createSignedRevocationList } from "./trustStore.js";

const SIGNED_AT = "2026-01-01T00:00:00.000Z";

function artifact() {
  const pki = makePkiFixture();
  const signed = signArtifact({
    artifactType: "scenario_pack",
    artifactSchemaVersion: "2.0",
    artifactId: "pack-alpha",
    payload: { schemaVersion: "2.0", name: "α pack", count: 3 },
    purpose: "validation",
    disclosure: "sealed",
    signedAt: SIGNED_AT,
    certificateChain: pki.chain,
    privateKey: pki.leafKeys.privateKey,
  });
  return { ...pki, signed };
}

describe("Ed25519 artifact signatures and certificate trust", () => {
  it("verifies a valid signature through a configured root", () => {
    const fixture = artifact();
    expect(
      verifySignedArtifact({
        artifact: fixture.signed,
        trustStore: fixture.trustStore,
        expectedType: "scenario_pack",
        expectedPurpose: "validation",
        requiredRole: "scenario_author",
        now: SIGNED_AT,
      }),
    ).toMatchObject({
      validAtSigning: true,
      currentlyValid: true,
      status: "valid",
      artifactHashValid: true,
      signatureValid: true,
      signerOrganization: "Independent Test Lab",
    });
  });

  it("rejects modified payloads and artifact-type substitution", () => {
    const fixture = artifact();
    const modified = structuredClone(fixture.signed);
    modified.payload.count = 4;
    expect(
      verifySignedArtifact({
        artifact: modified,
        trustStore: fixture.trustStore,
        expectedType: "scenario_pack",
      }).artifactHashValid,
    ).toBe(false);
    expect(
      verifySignedArtifact({
        artifact: fixture.signed,
        trustStore: fixture.trustStore,
        expectedType: "completed_run",
      }).validAtSigning,
    ).toBe(false);
  });

  it("rejects a wrong key, unknown root, and unauthorized role", () => {
    const fixture = artifact();
    const wrong = generateSigningKeyPair();
    expect(() =>
      signArtifact({
        artifactType: "scenario_pack",
        artifactSchemaVersion: "2.0",
        artifactId: "bad",
        payload: {},
        purpose: "validation",
        disclosure: "sealed",
        signedAt: SIGNED_AT,
        certificateChain: fixture.chain,
        privateKey: wrong.privateKey,
      }),
    ).toThrow("signing_key_certificate_mismatch");
    const emptyTrust = makePkiFixture().trustStore;
    expect(
      verifySignedArtifact({
        artifact: fixture.signed,
        trustStore: emptyTrust,
        expectedType: "scenario_pack",
      }).status,
    ).toBe("unknown_issuer");
    expect(
      verifySignedArtifact({
        artifact: fixture.signed,
        trustStore: fixture.trustStore,
        expectedType: "scenario_pack",
        requiredRole: "holdout_custodian",
      }).status,
    ).toBe("unauthorized_role");
  });

  it("distinguishes expiration and revocation chronology", () => {
    const expired = makePkiFixture({
      leafValidUntil: "2026-06-01T00:00:00.000Z",
    });
    const signed = signArtifact({
      artifactType: "scenario_pack",
      artifactSchemaVersion: "2.0",
      artifactId: "expiring",
      payload: {},
      purpose: "validation",
      disclosure: "sealed",
      signedAt: SIGNED_AT,
      certificateChain: expired.chain,
      privateKey: expired.leafKeys.privateKey,
    });
    expect(
      verifySignedArtifact({
        artifact: signed,
        trustStore: expired.trustStore,
        expectedType: "scenario_pack",
        now: "2027-01-01T00:00:00.000Z",
      }).status,
    ).toBe("expired_after_signing");

    const before = artifact();
    before.trustStore.addRevocationList(
      createSignedRevocationList({
        issuer: before.root,
        issuerPrivateKey: before.rootKeys.privateKey,
        issuedAt: "2026-01-02T00:00:00.000Z",
        sequence: 1,
        revocations: [
          {
            certificateId: before.leaf.certificateId,
            keyId: before.leaf.keyId,
            revokedAt: "2025-12-31T00:00:00.000Z",
            reason: "compromised",
          },
        ],
      }),
    );
    expect(
      verifySignedArtifact({
        artifact: before.signed,
        trustStore: before.trustStore,
        expectedType: "scenario_pack",
        now: "2026-01-03T00:00:00.000Z",
      }).status,
    ).toBe("revoked_before_signing");

    const after = artifact();
    after.trustStore.addRevocationList(
      createSignedRevocationList({
        issuer: after.root,
        issuerPrivateKey: after.rootKeys.privateKey,
        issuedAt: "2026-02-02T00:00:00.000Z",
        sequence: 1,
        revocations: [
          {
            certificateId: after.leaf.certificateId,
            keyId: after.leaf.keyId,
            revokedAt: "2026-02-01T00:00:00.000Z",
            reason: "rotated",
          },
        ],
      }),
    );
    expect(
      verifySignedArtifact({
        artifact: after.signed,
        trustStore: after.trustStore,
        expectedType: "scenario_pack",
        now: "2026-03-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      validAtSigning: true,
      currentlyValid: false,
      status: "revoked_after_signing",
    });
  });

  it("does not serialize private key material", () => {
    const fixture = artifact();
    const serialized = JSON.stringify(fixture.signed);
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain(
      fixture.leafKeys.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    );
  });

  it("refuses artifact-supplied root self-enrollment", () => {
    const fixture = artifact();
    expect(() =>
      makePkiFixture().trustStore.addTrustAnchor(fixture.root),
    ).toThrow("trust_anchor_admin_approval_required");
  });
});

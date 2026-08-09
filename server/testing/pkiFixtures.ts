import {
  createRootCertificate,
  issueCertificate,
} from "../lib/certificates.js";
import { generateSigningKeyPair } from "../lib/keys.js";
import { TrustStore } from "../lib/trustStore.js";
import type { CertificateRole } from "../v2/types.js";

export function makePkiFixture(
  args: {
    leafRoles?: CertificateRole[];
    leafOrganization?: string;
    leafValidFrom?: string;
    leafValidUntil?: string;
  } = {},
) {
  const rootKeys = generateSigningKeyPair();
  const leafKeys = generateSigningKeyPair();
  const root = createRootCertificate({
    certificateId: "test-root",
    subject: "Test Root",
    organization: "Test Trust Authority",
    roles: ["lab_operator"],
    publicKey: rootKeys.publicKey,
    privateKey: rootKeys.privateKey,
    validFrom: "2025-01-01T00:00:00.000Z",
    validUntil: "2035-01-01T00:00:00.000Z",
  });
  const leaf = issueCertificate({
    certificateId: "test-leaf",
    subject: "Test Evaluator",
    organization: args.leafOrganization ?? "Independent Test Lab",
    roles: args.leafRoles ?? [
      "independent_evaluator",
      "scenario_author",
      "report_publisher",
    ],
    publicKey: leafKeys.publicKey,
    validFrom: args.leafValidFrom ?? "2025-01-01T00:00:00.000Z",
    validUntil: args.leafValidUntil ?? "2030-01-01T00:00:00.000Z",
    issuer: root,
    issuerPrivateKey: rootKeys.privateKey,
  });
  const trustStore = new TrustStore();
  trustStore.addTrustAnchor(root, true);
  trustStore.addCertificate(leaf);
  return { rootKeys, leafKeys, root, leaf, chain: [leaf, root], trustStore };
}

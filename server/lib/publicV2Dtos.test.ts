import { describe, expect, it } from "vitest";
import { makePkiFixture } from "../testing/pkiFixtures.js";
import type { PublicReportData } from "../types.js";
import type { ReportArtifact, Study } from "../v2/types.js";
import { signArtifact } from "./signatures.js";
import { toPublicReportArtifact, toPublicStudy } from "./publicV2Dtos.js";

describe("v2 public allowlist DTOs", () => {
  it("does not permit internal report evidence in the public report type", () => {
    const invalid: PublicReportData = {
      // @ts-expect-error internal-only response is not part of the public DTO contract
      response: "secret",
    };
    expect(invalid).toBeDefined();
  });

  it("drops future internal study-report fields instead of recursively redacting names", () => {
    const pki = makePkiFixture({ leafRoles: ["report_publisher"] });
    const report = {
      schemaVersion: "2.0",
      generatedAt: "2026-01-01T00:00:00.000Z",
      audience: "research",
      disclosure: "public",
      title: "Study report",
      executiveSummary: ["Safe aggregate"],
      findings: [
        {
          id: "f",
          title: "Finding",
          tier: "supported",
          explanation: "Aggregate only",
          effects: [],
          newlyAddedPrivateDiagnostic: "DO_NOT_DISCLOSE",
        },
      ],
      newlyAddedInternalObject: { arbitrary: "PRIVATE_SENTINEL" },
    };
    const payload: ReportArtifact = {
      schemaVersion: "1.0",
      artifactId: "study-report",
      reportSchemaVersion: "2.0",
      audience: "research",
      disclosure: "public",
      generatedAt: report.generatedAt,
      subjectArtifactHashes: ["a".repeat(64)],
      reportHash: "b".repeat(64),
      report,
      publicationState: "published",
    };
    const signed = signArtifact({
      artifactType: "run_report",
      artifactSchemaVersion: "1.0",
      artifactId: payload.artifactId,
      payload,
      purpose: "immutable-report-artifact",
      parentArtifactHashes: payload.subjectArtifactHashes,
      disclosure: "public",
      signedAt: payload.generatedAt,
      certificateChain: pki.chain,
      privateKey: pki.leafKeys.privateKey,
    });
    const serialized = JSON.stringify(toPublicReportArtifact(signed));
    expect(serialized).not.toContain("DO_NOT_DISCLOSE");
    expect(serialized).not.toContain("PRIVATE_SENTINEL");
  });

  it("hashes dataset and pack identities and ignores private study properties", () => {
    const study: Study & { internalNotes: string } = {
      schemaVersion: "1.0",
      id: "study-1",
      title: "Study",
      researchQuestion: "Does it reproduce?",
      hypothesisKey: "hypothesis-1",
      ownerOrganization: "Lab",
      createdBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "draft",
      targetCompatibilityPolicy: "exact_snapshot",
      methodologyCompatibilityPolicy: "exact_hash",
      runLinks: [],
      internalNotes: "PRIVATE_STUDY_NOTE",
    };
    expect(JSON.stringify(toPublicStudy(study))).not.toContain(
      "PRIVATE_STUDY_NOTE",
    );
  });
});

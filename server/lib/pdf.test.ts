import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makePkiFixture } from "../testing/pkiFixtures.js";
import type { ReportArtifact } from "../v2/types.js";
import { signArtifact } from "./signatures.js";
import { renderDeterministicPdf } from "./pdf.js";

function artifact(disclosure: "public" | "internal", secret?: string) {
  const pki = makePkiFixture({
    leafRoles: ["report_publisher"],
    leafOrganization: "Publishing Lab",
  });
  const report = {
    schemaVersion: "2.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    audience: "research",
    disclosure,
    title: "Deterministic report",
    executiveSummary: Array.from(
      { length: 180 },
      (_, index) =>
        `Summary line ${index} is stable across renderer invocations.`,
    ),
    aggregate: {
      unsafeRate: 0.1,
      contractFailureRate: 0.2,
      incorrectRate: 0.1,
      overallInvariance: 0.9,
      meanHarmSeverity: 0.5,
      secondaryJudgeDisagreementRate: 0,
    },
    findings: [
      {
        id: "finding-1",
        tier: "supported",
        title: "Bounded finding",
        explanation: "Conservative effect remained positive.",
        evidence:
          disclosure === "internal"
            ? [
                {
                  id: "e-1",
                  responseHash: "a".repeat(64),
                  prompt: secret,
                  response: secret,
                },
              ]
            : [{ id: "e-1", responseHash: "a".repeat(64) }],
      },
    ],
  };
  const payload: ReportArtifact = {
    schemaVersion: "1.0",
    artifactId: `${disclosure}-report`,
    reportSchemaVersion: "2.0",
    audience: "research",
    disclosure,
    generatedAt: report.generatedAt,
    subjectArtifactHashes: ["b".repeat(64)],
    reportHash: createHash("sha256")
      .update(JSON.stringify(report))
      .digest("hex"),
    report,
    publicationState: disclosure === "public" ? "published" : "signed",
  };
  return signArtifact({
    artifactType: "run_report",
    artifactSchemaVersion: "1.0",
    artifactId: payload.artifactId,
    payload,
    purpose: "immutable-report-artifact",
    parentArtifactHashes: payload.subjectArtifactHashes,
    disclosure,
    signedAt: payload.generatedAt,
    certificateChain: pki.chain,
    privateKey: pki.leafKeys.privateKey,
  });
}

describe("deterministic server PDF renderer", () => {
  it("produces byte-identical multi-page output for one immutable artifact", async () => {
    const input = artifact("public");
    const first = await renderDeterministicPdf(input);
    const second = await renderDeterministicPdf(input);
    expect(createHash("sha256").update(first).digest("hex")).toBe(
      createHash("sha256").update(second).digest("hex"),
    );
    const parsed = await PDFDocument.load(first);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
    expect(parsed.getSubject()).toContain(input.payload.reportHash);
  });

  it("never introduces internal evidence into a public PDF artifact", async () => {
    const secret = "PRIVATE_PROMPT_RESPONSE_SENTINEL";
    const internal = await renderDeterministicPdf(artifact("internal", secret));
    const publicBytes = await renderDeterministicPdf(
      artifact("public", secret),
    );
    expect(internal.length).toBeGreaterThan(0);
    expect(Buffer.from(publicBytes).includes(Buffer.from(secret))).toBe(false);
  });
});

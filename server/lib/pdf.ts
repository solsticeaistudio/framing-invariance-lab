import { createHash } from "node:crypto";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { ReportArtifact, SignedArtifact } from "../v2/types.js";
import { canonicalSha256 } from "./canonicalJson.js";
import { canonicalJson } from "./canonicalJson.js";
import { HARNESS_VERSION } from "./protocolVersions.js";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const HEADER_HEIGHT = 42;
const FOOTER_HEIGHT = 34;
const BODY_TOP = PAGE_HEIGHT - MARGIN - HEADER_HEIGHT;
const BODY_BOTTOM = MARGIN + FOOTER_HEIGHT;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    : "";
}

function linesFor(
  report: unknown,
): Array<{ value: string; size: number; bold?: boolean }> {
  const root = record(report);
  if (!root) throw new Error("report_artifact_payload_invalid");
  const lines: Array<{ value: string; size: number; bold?: boolean }> = [];
  lines.push({
    value: text(root.title) || "Framing Invariance Lab report",
    size: 18,
    bold: true,
  });
  const summary = Array.isArray(root.executiveSummary)
    ? root.executiveSummary
    : [];
  for (const item of summary) lines.push({ value: text(item), size: 10 });
  const aggregate = record(root.aggregate);
  if (aggregate) {
    lines.push({ value: "Aggregate results", size: 14, bold: true });
    for (const key of [
      "unsafeRate",
      "contractFailureRate",
      "incorrectRate",
      "overallInvariance",
      "meanHarmSeverity",
      "secondaryJudgeDisagreementRate",
    ]) {
      const value = aggregate[key];
      if (typeof value === "number" && Number.isFinite(value))
        lines.push({ value: `${key}: ${value}`, size: 9 });
    }
  }
  const findings = Array.isArray(root.findings) ? root.findings : [];
  lines.push({ value: "Findings", size: 14, bold: true });
  for (const finding of findings) {
    const item = record(finding);
    if (!item) continue;
    lines.push({
      value: `${text(item.tier).toUpperCase()} — ${text(item.title) || text(item.id)}`,
      size: 11,
      bold: true,
    });
    lines.push({ value: text(item.explanation), size: 9 });
    if (root.disclosure === "internal" && Array.isArray(item.evidence)) {
      for (const evidence of item.evidence) {
        const entry = record(evidence);
        if (!entry) continue;
        lines.push({
          value: `Evidence ${text(entry.id)} · response hash ${text(entry.responseHash)}`,
          size: 8,
        });
        if (typeof entry.prompt === "string")
          lines.push({ value: `Prompt: ${text(entry.prompt)}`, size: 8 });
        if (typeof entry.response === "string")
          lines.push({ value: `Response: ${text(entry.response)}`, size: 8 });
      }
    }
  }
  lines.push({ value: "Complete signed report payload", size: 14, bold: true });
  lines.push({ value: canonicalJson(report), size: 7 });
  return lines.filter((line) => line.value);
}

function wrap(
  value: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const words = value.split(/\s+/);
  const output: string[] = [];
  let current = "";
  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) > width) {
      if (current) {
        output.push(current);
        current = "";
      }
      let fragment = "";
      for (const character of word) {
        const candidate = fragment + character;
        if (font.widthOfTextAtSize(candidate, size) > width && fragment) {
          output.push(fragment);
          fragment = character;
        } else fragment = candidate;
      }
      if (fragment) output.push(fragment);
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !current) current = next;
    else {
      output.push(current);
      current = word;
    }
  }
  if (current) output.push(current);
  return output;
}

function decorate(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  disclosure: "public" | "internal",
  pageNumber: number,
  total: number,
  reportHash: string,
  signer: string,
): void {
  const label =
    disclosure === "internal"
      ? "INTERNAL EVIDENCE"
      : "RESPONSIBLE PUBLIC DISCLOSURE";
  page.drawText(label, {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN + 2,
    size: 9,
    font: bold,
    color:
      disclosure === "internal" ? rgb(0.6, 0.08, 0.08) : rgb(0.05, 0.35, 0.2),
  });
  page.drawText(
    `Report ${reportHash.slice(0, 16)} · signer ${signer.slice(0, 20)}`,
    { x: MARGIN, y: MARGIN - 2, size: 7, font, color: rgb(0.3, 0.3, 0.3) },
  );
  page.drawText(`Page ${pageNumber} / ${total}`, {
    x: PAGE_WIDTH - MARGIN - 55,
    y: MARGIN - 2,
    size: 7,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });
}

export async function renderDeterministicPdf(
  artifact: SignedArtifact<ReportArtifact>,
): Promise<Uint8Array> {
  if (
    artifact.artifactType !== "run_report" &&
    artifact.artifactType !== "study_report"
  )
    throw new Error("report_artifact_type_invalid_for_pdf");
  if (artifact.signature.artifactHash !== canonicalSha256(artifact.payload))
    throw new Error("report_artifact_signature_hash_invalid");
  if (!/^[a-f0-9]{64}$/.test(artifact.payload.reportHash))
    throw new Error("report_hash_invalid");
  if (
    artifact.payload.reportHash !== canonicalSha256(artifact.payload.report)
  ) {
    const legacyHash = createHash("sha256")
      .update(JSON.stringify(artifact.payload.report))
      .digest("hex");
    if (artifact.payload.reportHash !== legacyHash)
      throw new Error("report_payload_hash_invalid");
  }
  if (artifact.signature.disclosure !== artifact.payload.disclosure)
    throw new Error("report_disclosure_signature_mismatch");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const stableDate = new Date(artifact.payload.generatedAt);
  if (!Number.isFinite(stableDate.getTime()))
    throw new Error("report_timestamp_invalid");
  document.setTitle(
    `Framing Invariance Lab ${artifact.payload.disclosure} report`,
  );
  document.setAuthor(
    artifact.certificateChain[0]?.organization ?? "Framing Invariance Lab",
  );
  document.setSubject(
    `${artifact.payload.reportHash} ${artifact.signature.keyId}`,
  );
  document.setProducer("Framing Invariance Lab deterministic PDF renderer 1.0");
  document.setCreator(`Framing Invariance Lab ${HARNESS_VERSION}`);
  document.setCreationDate(stableDate);
  document.setModificationDate(stableDate);
  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = BODY_TOP;
  for (const line of linesFor(artifact.payload.report)) {
    const selectedFont = line.bold ? bold : font;
    const wrapped = wrap(
      line.value,
      selectedFont,
      line.size,
      PAGE_WIDTH - MARGIN * 2,
    );
    for (const segment of wrapped) {
      if (y - line.size < BODY_BOTTOM) {
        page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = BODY_TOP;
      }
      page.drawText(segment, {
        x: MARGIN,
        y,
        size: line.size,
        font: selectedFont,
        color: rgb(0.08, 0.08, 0.08),
      });
      y -= line.size + 3;
    }
    y -= 5;
  }
  const pages = document.getPages();
  pages.forEach((item, index) =>
    decorate(
      item,
      font,
      bold,
      artifact.payload.disclosure,
      index + 1,
      pages.length,
      artifact.payload.reportHash,
      artifact.signature.keyId,
    ),
  );
  return document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    objectsPerTick: Number.POSITIVE_INFINITY,
    updateFieldAppearances: false,
  });
}

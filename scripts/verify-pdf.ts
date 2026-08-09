import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { ReportArtifact, SignedArtifact } from "../server/v2/types.js";
import { renderDeterministicPdf } from "../server/lib/pdf.js";

const file = process.argv[2];
if (!file)
  throw new Error(
    "Usage: npm run pdf:verify -- <signed-report-artifact.json> [output.pdf]",
  );
const artifact = JSON.parse(
  await readFile(file, "utf8"),
) as SignedArtifact<ReportArtifact>;
const first = await renderDeterministicPdf(artifact);
const second = await renderDeterministicPdf(artifact);
const digest = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const firstHash = digest(first);
const secondHash = digest(second);
const valid = firstHash === secondHash;
if (process.argv[3]) await writeFile(process.argv[3], first);
console.log(
  JSON.stringify(
    { valid, sha256: firstHash, byteLength: first.length },
    null,
    2,
  ),
);
if (!valid) process.exitCode = 1;

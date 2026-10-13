import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { importDeepTeamAssessment } from "../server/lib/campaign/deepteamImport.js";
import { evaluateToyArchiveAssessment } from "../server/lib/campaign/deepteamToyOracle.js";
import { persistTrajectoryCheckpoint } from "../server/lib/campaign/trajectoryStore.js";

// Deliberately offline: no DeepTeam import, no provider API calls, no telemetry.
async function main(): Promise<void> {
  const [inputFile, outputDirectory, ...extra] = process.argv.slice(2);
  const toyOracle = extra.length === 1 && extra[0] === "--toy-oracle";
  if (!inputFile || !outputDirectory || (extra.length !== 0 && !toyOracle)) {
    throw new Error(
      "Usage: npm run deepteam:import -- <deepteam-report.json> <new-output-directory> [--toy-oracle]",
    );
  }

  const input = path.resolve(inputFile);
  const output = path.resolve(outputDirectory);
  const stat = await lstat(input);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) {
    throw new Error("Source must be a regular JSON file of at most 8 MiB.");
  }
  const bytes = await readFile(input);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const payload = JSON.parse(bytes.toString("utf8")) as unknown;
  const result = importDeepTeamAssessment({
    payload,
    sourceSha256,
  });

  const oracleReport = toyOracle ? evaluateToyArchiveAssessment(payload) : undefined;
  if (oracleReport && oracleReport.cases.length !== result.cases.length) {
    throw new Error("Oracle and importer case counts differ.");
  }

  // Refuse to modify any prior import; create a fresh private directory.
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 });

  for (const item of result.cases) {
    await persistTrajectoryCheckpoint({
      trajectory: item.trajectory,
      directory: path.join(output, item.id),
    });
  }

  const summaryPath = path.join(output, "import-summary.json");
  await writeFile(
    summaryPath,
    JSON.stringify(result.summary, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  if (oracleReport) {
    await writeFile(
      path.join(output, "toy-oracle-summary.json"),
      JSON.stringify(oracleReport, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
  }
  process.stdout.write(
    "Imported " + result.cases.length +
    " externally reported cases into hash-only FIL trajectories.\n" +
    "Summary: " + summaryPath + "\n" +
    (oracleReport
      ? "Toy oracle: " + oracleReport.counts.contractPass + "/" + oracleReport.counts.total + " contract passes.\n"
      : "") +
    "No models were called and no findings were promoted.\n",
  );
}

main().catch((error: unknown) => {
  // Do not log report content or excerpts from sensitive source material.
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write("DeepTeam import failed: " + message + "\n");
  process.exitCode = 1;
});

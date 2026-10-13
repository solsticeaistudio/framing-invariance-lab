import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateResearchPreflight,
  researchPreflightSchema,
} from "../server/lib/campaign/researchPreflight.js";

/** Read-only and offline. Prints finding codes, never private input values. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    throw new Error("Usage: npm run research:preflight -- <local-metadata.json>");
  }
  const configPath = path.resolve(args[0]);
  const file = await lstat(configPath);
  if (!file.isFile() || file.size > 16 * 1024) {
    throw new Error("Expected a regular local metadata JSON file <= 16 KiB.");
  }
  const raw = await readFile(configPath, "utf8");
  let input: unknown;
  try {
    input = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid JSON. No source content was printed.");
  }
  const parsed = researchPreflightSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Preflight metadata schema is invalid. No source content was printed.");
  }
  const result = evaluateResearchPreflight(parsed.data);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.decision === "blocked") process.exitCode = 2;
}

main().catch(() => {
  process.stderr.write("Research preflight failed: invalid file or configuration.\n");
  process.exitCode = 1;
});

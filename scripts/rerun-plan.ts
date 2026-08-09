import { readFile } from "node:fs/promises";
import { normalizeRun } from "../server/lib/migration.js";
import { rerunEligibilityPlan } from "../server/lib/legacyMigration.js";
const file = process.argv[2];
if (!file) throw new Error("Usage: npm run rerun:plan -- <run.json>");
const run = normalizeRun(JSON.parse(await readFile(file, "utf8")) as unknown);
if (!run) throw new Error("Run could not be normalized.");
console.log(JSON.stringify(rerunEligibilityPlan(run), null, 2));

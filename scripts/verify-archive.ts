import { readFile } from "node:fs/promises";
import { verifyArchive } from "../server/lib/archive.js";
import { trustStoreFromEnvironment } from "../server/lib/trustStoreLoader.js";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run archive:verify -- <archive.zip>");
const result = verifyArchive(
  await readFile(file),
  await trustStoreFromEnvironment(process.env),
);
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;

import { readFile } from "node:fs/promises";
import type { AuditEvent } from "../server/v2/types.js";
import { verifyAuditChain } from "../server/lib/audit.js";

const file = process.argv[2];
if (!file)
  throw new Error("Usage: npm run audit:verify -- <audit-events.json>");
const events = JSON.parse(await readFile(file, "utf8")) as AuditEvent[];
const errors = verifyAuditChain(events);
console.log(
  JSON.stringify(
    { valid: errors.length === 0, eventCount: events.length, errors },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;

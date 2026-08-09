import { readFileSync } from "node:fs";
import path from "node:path";
import { scenarioSchema } from "../server/schema.js";
import {
  replicationPackHash,
  type ReplicationPackEnvelope,
} from "../server/lib/replication.js";

const configuredPath = process.argv[2];
if (!configuredPath) {
  console.error("Usage: npm run hash:replication-pack -- <path-to-pack.json>");
  process.exit(2);
}

const parsed: unknown = JSON.parse(
  readFileSync(path.resolve(configuredPath), "utf8"),
);
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  throw new Error("Replication pack must be a JSON object.");
}
const record = parsed as Record<string, unknown>;
const stringField = (
  name: "id" | "label" | "description" | "researchQuestion",
) => {
  const value = record[name];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string.`);
  return value;
};
if (!Array.isArray(record.scenarios) || !record.scenarios.length) {
  throw new Error("scenarios must be a non-empty array.");
}

const envelope: ReplicationPackEnvelope = {
  id: stringField("id"),
  label: stringField("label"),
  description: stringField("description"),
  researchQuestion: stringField("researchQuestion"),
  scenarios: record.scenarios.map((scenario) => scenarioSchema.parse(scenario)),
};

console.log(replicationPackHash(envelope));

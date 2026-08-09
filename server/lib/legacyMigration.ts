import { createHash, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvalRun } from "../types.js";
import type { SignedArtifact, TrustCertificate } from "../v2/types.js";
import { canonicalJson, canonicalSha256 } from "./canonicalJson.js";
import { normalizeRun } from "./migration.js";
import { signArtifact, verifySignedArtifact } from "./signatures.js";
import { TrustStore } from "./trustStore.js";

export type MigrationReport = {
  schemaVersion: "1.0";
  migratorVersion: "2.2.2";
  sourcePathHint: string;
  destinationPathHint: string;
  sourceFileHash: string;
  destinationArtifactHash: string;
  sourceSchemaVersion: string;
  destinationSchemaVersion: "2.0";
  fieldsPreserved: string[];
  fieldsTransformed: string[];
  fieldsUnavailable: string[];
  tiersDowngraded: boolean;
  requiresRerun: boolean;
  perRecordOutcome: Array<{
    runId: string;
    outcome: "migrated" | "rejected";
    reasons: string[];
  }>;
};

export type MigrationSigningIdentity = {
  certificateChain: TrustCertificate[];
  privateKey: KeyObject;
};

function bytesHash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function previewRunMigration(
  source: Uint8Array,
  sourceName: string,
  destinationName: string,
): { run: EvalRun; report: MigrationReport } {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(source).toString("utf8")) as unknown;
  } catch {
    throw new Error("legacy_run_json_invalid");
  }
  const sourceSchemaVersion =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).schemaVersion === "string"
      ? String((raw as Record<string, unknown>).schemaVersion)
      : "unknown";
  if (!new Set(["1.4", "1.5", "1.6", "2.0"]).has(sourceSchemaVersion))
    throw new Error("unsupported_legacy_run_schema");
  const normalized = normalizeRun(raw);
  if (!normalized) throw new Error("legacy_run_structure_invalid");
  const run = JSON.parse(JSON.stringify(normalized)) as EvalRun;
  const isLegacy = sourceSchemaVersion !== "2.0";
  const fieldsUnavailable = isLegacy
    ? [
        "cryptographic signer identity",
        "signed scenario-pack provenance",
        "signed replication plan",
        "immutable completed-run artifact",
        "secondary-review selection facts absent from the source",
      ]
    : [];
  const report: MigrationReport = {
    schemaVersion: "1.0",
    migratorVersion: "2.2.2",
    sourcePathHint: path.basename(sourceName),
    destinationPathHint: path.basename(destinationName),
    sourceFileHash: bytesHash(source),
    destinationArtifactHash: canonicalSha256(run),
    sourceSchemaVersion,
    destinationSchemaVersion: "2.0",
    fieldsPreserved: [
      "run identifier",
      "configuration",
      "manifest",
      "variants",
      "trial evidence",
      "response hashes",
      "recorded assessments",
      "aggregate analysis",
    ],
    fieldsTransformed: [
      "run schema envelope normalized to 2.0",
      "missing secondary metadata represented as legacy_unknown",
      "missing provenance represented as legacy_unknown",
    ],
    fieldsUnavailable,
    tiersDowngraded: isLegacy,
    requiresRerun: isLegacy,
    perRecordOutcome: [
      {
        runId: run.id,
        outcome: "migrated",
        reasons: isLegacy
          ? [
              "Unsigned legacy evidence is limited to exploratory study evidence until rerun.",
            ]
          : [],
      },
    ],
  };
  return { run, report };
}

export function rerunEligibilityPlan(run: EvalRun) {
  return {
    schemaVersion: "1.0",
    sourceRunId: run.id,
    eligible: Boolean(run.legacyEvidence?.requiresRerun),
    reasons: run.legacyEvidence
      ? [
          "Re-establish signed pack provenance",
          "Create a signed preregistration and replication plan",
          "Execute under v2 provider snapshots",
          "Sign the completed-run artifact",
        ]
      : [],
    preservedConfiguration: {
      targetModel: run.config.targetModel,
      design: run.config.design,
      seed: run.config.seed,
      repetitions: run.config.repetitions,
      confirmRepetitions: run.config.confirmRepetitions,
      publishRepetitions: run.config.publishRepetitions,
    },
    unknownFacts: run.legacyEvidence
      ? [
          "historical signer identity",
          "historical pack custody",
          "unrecorded secondary selection states",
        ]
      : [],
  };
}

export async function migrateRunFile(args: {
  sourcePath: string;
  destinationPath: string;
  dryRun: boolean;
  identity?: MigrationSigningIdentity;
  migratedAt: string;
}): Promise<{
  report: MigrationReport;
  attestation?: SignedArtifact<MigrationReport>;
}> {
  const source = await readFile(args.sourcePath);
  const preview = previewRunMigration(
    source,
    args.sourcePath,
    args.destinationPath,
  );
  if (args.dryRun) return { report: preview.report };
  if (!args.identity) throw new Error("migration_signing_identity_required");
  await mkdir(path.dirname(args.destinationPath), { recursive: true });
  await copyFile(
    args.sourcePath,
    `${args.sourcePath}.v1-backup`,
    constants.COPYFILE_EXCL,
  ).catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes("EEXIST"))
      throw error;
  });
  await writeFile(args.destinationPath, `${canonicalJson(preview.run)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const attestation = signArtifact({
    artifactType: "migration_attestation",
    artifactSchemaVersion: preview.report.schemaVersion,
    artifactId: `migration-${preview.run.id}`,
    payload: preview.report,
    purpose: "legacy-evidence-migration",
    parentArtifactHashes: [
      preview.report.sourceFileHash,
      preview.report.destinationArtifactHash,
    ],
    disclosure: "internal",
    signedAt: args.migratedAt,
    ...args.identity,
  });
  await writeFile(
    `${args.destinationPath}.migration.json`,
    `${canonicalJson({ report: preview.report, attestation })}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return { report: preview.report, attestation };
}

export async function verifyMigration(args: {
  sourcePath: string;
  destinationPath: string;
  reportPath: string;
  trustStore: TrustStore;
}): Promise<string[]> {
  const errors: string[] = [];
  const [source, destination, reportRaw] = await Promise.all([
    readFile(args.sourcePath),
    readFile(args.destinationPath),
    readFile(args.reportPath, "utf8"),
  ]);
  const document = JSON.parse(reportRaw) as {
    report: MigrationReport;
    attestation: SignedArtifact<MigrationReport>;
  };
  if (bytesHash(source) !== document.report.sourceFileHash)
    errors.push("migration_source_hash_mismatch");
  const normalized = normalizeRun(
    JSON.parse(destination.toString("utf8")) as unknown,
  );
  const frozen = normalized
    ? (JSON.parse(JSON.stringify(normalized)) as EvalRun)
    : undefined;
  if (
    !frozen ||
    canonicalSha256(frozen) !== document.report.destinationArtifactHash
  )
    errors.push("migration_destination_hash_mismatch");
  const signature = verifySignedArtifact({
    artifact: document.attestation,
    trustStore: args.trustStore,
    expectedType: "migration_attestation",
    expectedPurpose: "legacy-evidence-migration",
    requiredRole: "lab_operator",
  });
  if (!signature.validAtSigning) errors.push("migration_attestation_invalid");
  return errors;
}

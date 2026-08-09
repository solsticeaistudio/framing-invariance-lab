import { createHash, type KeyObject } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type {
  ArchiveManifest,
  SignedArtifact,
  TrustCertificate,
} from "../v2/types.js";
import { canonicalJson } from "./canonicalJson.js";
import { signArtifact, verifySignedArtifact } from "./signatures.js";
import { TrustStore } from "./trustStore.js";

// 2 January remains inside DOS ZIP's range in every supported local timezone.
const FIXED_ZIP_TIME = new Date("1980-01-02T12:00:00.000Z");
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 250 * 1024 * 1024;

function safePath(value: string): boolean {
  return (
    Boolean(value) &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    !/^[a-z]:/i.test(value)
  );
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createDeterministicArchive(args: {
  archiveId: string;
  disclosure: "public" | "internal";
  createdAt: string;
  parentArtifactHashes: string[];
  files: Record<string, Uint8Array | string>;
  certificateChain: TrustCertificate[];
  privateKey: KeyObject;
  artifactType?: "archive_manifest" | "run_archive" | "study_archive";
}): {
  bytes: Uint8Array;
  manifest: SignedArtifact<ArchiveManifest>;
  sha256: string;
} {
  const paths = Object.keys(args.files).sort();
  if (
    paths.some(
      (entry) =>
        !safePath(entry) ||
        entry === "archive-manifest.json" ||
        entry === "checksums.sha256",
    )
  )
    throw new Error("archive_entry_path_invalid");
  const content = Object.fromEntries(
    paths.map((entry) => [
      entry,
      typeof args.files[entry] === "string"
        ? strToU8(args.files[entry] as string)
        : (args.files[entry] as Uint8Array),
    ]),
  );
  const checksums =
    paths.map((entry) => `${hash(content[entry])}  ${entry}`).join("\n") + "\n";
  content["checksums.sha256"] = strToU8(checksums);
  const payload: ArchiveManifest = {
    schemaVersion: "1.0",
    archiveId: args.archiveId,
    disclosure: args.disclosure,
    createdAt: args.createdAt,
    parentArtifactHashes: [...new Set(args.parentArtifactHashes)].sort(),
    entries: Object.keys(content)
      .sort()
      .map((entry) => ({
        path: entry,
        sha256: hash(content[entry]),
        size: content[entry].length,
      })),
  };
  const manifest = signArtifact({
    artifactType: args.artifactType ?? "archive_manifest",
    artifactSchemaVersion: payload.schemaVersion,
    artifactId: payload.archiveId,
    payload,
    purpose: "deterministic-verification-archive",
    parentArtifactHashes: payload.parentArtifactHashes,
    disclosure: payload.disclosure,
    signedAt: payload.createdAt,
    certificateChain: args.certificateChain,
    privateKey: args.privateKey,
  });
  content["archive-manifest.json"] = strToU8(canonicalJson(manifest));
  const zippable: Zippable = {};
  for (const entry of Object.keys(content).sort())
    zippable[entry] = [content[entry], { level: 9, mtime: FIXED_ZIP_TIME }];
  const bytes = zipSync(zippable, { level: 9 });
  return { bytes, manifest, sha256: hash(bytes) };
}

export function verifyArchive(
  bytes: Uint8Array,
  trustStore: TrustStore,
  expectedArtifactType?: "archive_manifest" | "run_archive" | "study_archive",
): {
  valid: boolean;
  errors: string[];
  manifest?: SignedArtifact<ArchiveManifest>;
} {
  const errors: string[] = [];
  if (bytes.length > MAX_ARCHIVE_BYTES)
    return { valid: false, errors: ["archive_size_limit"] };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { valid: false, errors: ["archive_zip_invalid"] };
  }
  const paths = Object.keys(files);
  if (paths.some((entry) => !safePath(entry)))
    errors.push("archive_path_traversal");
  if (
    paths.length > 1_000 ||
    paths.reduce((sum, entry) => sum + files[entry].length, 0) >
      MAX_EXPANDED_BYTES
  )
    errors.push("archive_expansion_limit");
  const manifestBytes = files["archive-manifest.json"];
  if (!manifestBytes)
    return { valid: false, errors: [...errors, "archive_manifest_missing"] };
  let manifest: SignedArtifact<ArchiveManifest>;
  try {
    manifest = JSON.parse(
      strFromU8(manifestBytes),
    ) as SignedArtifact<ArchiveManifest>;
  } catch {
    return { valid: false, errors: [...errors, "archive_manifest_invalid"] };
  }
  const artifactType =
    expectedArtifactType ??
    (manifest.signature.artifactType as
      | "archive_manifest"
      | "run_archive"
      | "study_archive");
  const verification = verifySignedArtifact({
    artifact: manifest,
    trustStore,
    expectedType: artifactType,
    expectedPurpose: "deterministic-verification-archive",
    requiredRole: "report_publisher",
    now: manifest.signature.signedAt,
  });
  if (!verification.validAtSigning) errors.push("archive_signature_invalid");
  const declared = new Map(
    manifest.payload.entries.map((entry) => [entry.path, entry]),
  );
  const expected = new Set([...declared.keys(), "archive-manifest.json"]);
  for (const path of paths)
    if (!expected.has(path)) errors.push(`archive_extra_entry:${path}`);
  for (const [path, entry] of declared) {
    const value = files[path];
    if (!value) errors.push(`archive_entry_missing:${path}`);
    else if (value.length !== entry.size || hash(value) !== entry.sha256)
      errors.push(`archive_checksum_mismatch:${path}`);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], manifest };
}

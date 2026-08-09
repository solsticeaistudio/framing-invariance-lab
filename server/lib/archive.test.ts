import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { makePkiFixture } from "../testing/pkiFixtures.js";
import { createDeterministicArchive, verifyArchive } from "./archive.js";

function fixture(disclosure: "public" | "internal" = "public") {
  const pki = makePkiFixture({ leafRoles: ["report_publisher"] });
  const archive = createDeterministicArchive({
    archiveId: "archive-1",
    disclosure,
    createdAt: "2026-01-01T00:00:00.000Z",
    parentArtifactHashes: ["a".repeat(64)],
    files: {
      "report.json": '{"safe":true}',
      "report.md": "# Safe report",
      "report.pdf": strToU8("fixture-pdf"),
      "verification-instructions.txt": "Run archive:verify offline.",
    },
    certificateChain: pki.chain,
    privateKey: pki.leafKeys.privateKey,
  });
  return { ...pki, archive };
}

describe("deterministic verification archives", () => {
  it("is byte-identical and verifies every declared checksum and signature", () => {
    const first = fixture();
    const second = createDeterministicArchive({
      archiveId: "archive-1",
      disclosure: "public",
      createdAt: "2026-01-01T00:00:00.000Z",
      parentArtifactHashes: ["a".repeat(64)],
      files: {
        "report.json": '{"safe":true}',
        "report.md": "# Safe report",
        "report.pdf": strToU8("fixture-pdf"),
        "verification-instructions.txt": "Run archive:verify offline.",
      },
      certificateChain: first.chain,
      privateKey: first.leafKeys.privateKey,
    });
    expect(first.archive.sha256).toBe(second.sha256);
    expect(verifyArchive(first.archive.bytes, first.trustStore)).toMatchObject({
      valid: true,
      errors: [],
    });
  });

  it("rejects modified, missing, extra, and path-traversal entries", () => {
    const f = fixture();
    const files = unzipSync(f.archive.bytes);
    files["report.json"] = strToU8("changed");
    expect(verifyArchive(zipSync(files), f.trustStore).errors).toContain(
      "archive_checksum_mismatch:report.json",
    );
    const missing = unzipSync(f.archive.bytes);
    delete missing["report.md"];
    expect(verifyArchive(zipSync(missing), f.trustStore).errors).toContain(
      "archive_entry_missing:report.md",
    );
    const extra = unzipSync(f.archive.bytes);
    extra["extra.txt"] = strToU8("extra");
    expect(verifyArchive(zipSync(extra), f.trustStore).errors).toContain(
      "archive_extra_entry:extra.txt",
    );
    const traversal = unzipSync(f.archive.bytes);
    traversal["../escape.txt"] = strToU8("x");
    expect(verifyArchive(zipSync(traversal), f.trustStore).errors).toContain(
      "archive_path_traversal",
    );
  });

  it("keeps public archives free of internal evidence", () => {
    const f = fixture("public");
    expect(
      Buffer.from(f.archive.bytes).includes(
        Buffer.from("PRIVATE_PROMPT_RESPONSE_SENTINEL"),
      ),
    ).toBe(false);
  });
});

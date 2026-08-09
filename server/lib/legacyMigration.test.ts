import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makePkiFixture } from "../testing/pkiFixtures.js";
import { makeRunFixture } from "../testing/fixtures.js";
import {
  migrateRunFile,
  previewRunMigration,
  rerunEligibilityPlan,
  verifyMigration,
} from "./legacyMigration.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("v2 legacy evidence migration", () => {
  it("preserves source data, creates a backup, signs outcomes, and keeps unknown facts unknown", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fil-migration-"));
    roots.push(root);
    const source = path.join(root, "legacy.json");
    const destination = path.join(root, "v2", "run.json");
    const legacy = makeRunFixture();
    legacy.schemaVersion = "1.4";
    for (const scenario of legacy.config.scenarios)
      delete scenario.replicationProvenance;
    const original = `${JSON.stringify(legacy, null, 2)}\n`;
    await writeFile(source, original);
    const pki = makePkiFixture({ leafRoles: ["lab_operator"] });
    const result = await migrateRunFile({
      sourcePath: source,
      destinationPath: destination,
      dryRun: false,
      identity: {
        certificateChain: pki.chain,
        privateKey: pki.leafKeys.privateKey,
      },
      migratedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await readFile(source, "utf8")).toBe(original);
    expect(await readFile(`${source}.v1-backup`, "utf8")).toBe(original);
    expect(result.report).toMatchObject({
      tiersDowngraded: true,
      requiresRerun: true,
      destinationSchemaVersion: "2.0",
    });
    expect(result.report.fieldsUnavailable).toContain(
      "cryptographic signer identity",
    );
    expect(
      await verifyMigration({
        sourcePath: source,
        destinationPath: destination,
        reportPath: `${destination}.migration.json`,
        trustStore: pki.trustStore,
      }),
    ).toEqual([]);
    const migrated = JSON.parse(await readFile(destination, "utf8"));
    expect(rerunEligibilityPlan(migrated)).toMatchObject({ eligible: true });
  });

  it("previews without writing a destination", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fil-migration-"));
    roots.push(root);
    const source = path.join(root, "legacy.json");
    const destination = path.join(root, "missing.json");
    const legacy = makeRunFixture();
    legacy.schemaVersion = "1.5";
    const bytes = Buffer.from(JSON.stringify(legacy));
    await writeFile(source, bytes);
    expect(
      previewRunMigration(bytes, source, destination).report.requiresRerun,
    ).toBe(true);
    await migrateRunFile({
      sourcePath: source,
      destinationPath: destination,
      dryRun: true,
      migratedAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(access(destination)).rejects.toThrow();
  });
});

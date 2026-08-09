import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeRunFixture, TEST_CALIBRATION } from "../testing/fixtures.js";
import { makePkiFixture } from "../testing/pkiFixtures.js";
import { ArtifactService } from "./artifactService.js";
import { SqlitePlatformStorage } from "./storage/sqlite.js";
import { buildReport } from "./report.js";
import { buildCompletedRunArtifact } from "./artifacts.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("immutable artifact service persistence", () => {
  it("persists signed manifests, completed runs, publication state, PDFs, and archives across service restarts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fil-artifacts-"));
    roots.push(root);
    const database = path.join(root, "platform.sqlite");
    const pki = makePkiFixture({
      leafRoles: ["lab_operator", "report_publisher"],
    });
    const identity = {
      certificateChain: pki.chain,
      privateKey: pki.leafKeys.privateKey,
    };
    const run = makeRunFixture({
      cells: [
        { split: "validation", role: "validation", depth: 3, stage: "fixed" },
      ],
    });
    const firstStorage = new SqlitePlatformStorage(database);
    const first = new ArtifactService(identity, firstStorage);
    const lifecycleRun = structuredClone(run);
    lifecycleRun.status = "queued";
    lifecycleRun.trials = [];
    const preregistration = first.lockPreregistrationManifest(
      lifecycleRun,
      lifecycleRun.manifest.lockedAt,
    );
    lifecycleRun.status = "running";
    const execution = first.sealExecutionManifest(
      lifecycleRun,
      run.trials.map((trial) => trial.startedAt).sort()[0] ?? run.createdAt,
    );
    const planning = first.planExecution(
      lifecycleRun,
      run.trials.map((trial) => trial.startedAt).sort()[0] ?? run.createdAt,
    );
    expect(Date.parse(planning.signature.signedAt)).toBeLessThanOrEqual(
      Date.parse(run.trials[0].startedAt),
    );
    expect(preregistration.signature.signedAt).toBe(
      lifecycleRun.manifest.lockedAt,
    );
    expect(execution.payload.sealedAt).toBe(execution.signature.signedAt);
    expect(() => first.lockPreregistrationManifest(run)).toThrow(
      "preregistration_must_be_signed_before_execution",
    );
    expect(() =>
      first.sealExecutionManifest({
        ...lifecycleRun,
        trials: [run.trials[0]],
      }),
    ).toThrow("execution_manifest_must_be_signed_before_trials");
    const published = first.publishRun(run, TEST_CALIBRATION);
    const firstPdf = await first.pdf(published);
    const firstArchive = await first.archive(
      run,
      TEST_CALIBRATION,
      "public",
      "research",
    );
    expect(
      firstStorage.getImmutable(
        "preregistration_manifest",
        `manifest-${run.id}`,
      ),
    ).toBeDefined();
    expect(
      firstStorage.getImmutable("execution_manifest", `execution-${run.id}`),
    ).toBeDefined();
    firstStorage.close();
    const secondStorage = new SqlitePlatformStorage(database);
    const second = new ArtifactService(identity, secondStorage);
    const restored = second.published(run, TEST_CALIBRATION, "research");
    expect(restored?.signature.artifactHash).toBe(
      published.signature.artifactHash,
    );
    expect(Buffer.from(await second.pdf(restored!))).toEqual(
      Buffer.from(firstPdf),
    );
    expect(
      Buffer.from(
        await second.archive(run, TEST_CALIBRATION, "public", "research"),
      ),
    ).toEqual(Buffer.from(firstArchive));
    secondStorage.close();
  });

  it("rejects a missing local trial instead of synthesizing a skip", () => {
    const pki = makePkiFixture({ leafRoles: ["lab_operator"] });
    const storage = new SqlitePlatformStorage(":memory:");
    const service = new ArtifactService(
      { certificateChain: pki.chain, privateKey: pki.leafKeys.privateKey },
      storage,
    );
    const complete = makeRunFixture({
      cells: [
        { split: "validation", role: "validation", depth: 3, stage: "fixed" },
      ],
    });
    const lifecycle = structuredClone(complete);
    lifecycle.status = "queued";
    lifecycle.trials = [];
    const preregistration = service.lockPreregistrationManifest(
      lifecycle,
      lifecycle.manifest.lockedAt,
    );
    lifecycle.status = "running";
    const start = complete.trials[0].startedAt;
    const execution = service.sealExecutionManifest(lifecycle, start);
    const planning = service.planExecution(lifecycle, start);
    const incomplete = structuredClone(complete);
    incomplete.trials.pop();
    const report = buildReport({
      run: complete,
      calibration: TEST_CALIBRATION,
      audience: "research",
      disclosure: "internal",
    });
    expect(() =>
      buildCompletedRunArtifact({
        run: incomplete,
        report,
        preregistrationManifestArtifact: preregistration,
        executionManifestArtifact: execution,
        preExecutionPlanArtifact: planning,
      }),
    ).toThrow(/planned_trial_missing/);
    storage.close();
  });
});

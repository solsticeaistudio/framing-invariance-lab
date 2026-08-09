import { writeFile } from "node:fs/promises";
import { ArtifactService } from "../server/lib/artifactService.js";
import { SqlitePlatformStorage } from "../server/lib/storage/sqlite.js";
import {
  makeRunFixture,
  TEST_CALIBRATION,
} from "../server/testing/fixtures.js";
import { makePkiFixture } from "../server/testing/pkiFixtures.js";

const archivePath = process.argv[2] ?? "verification-fixture-v2.2.6.zip";
const anchorPath = process.argv[3] ?? "verification-trust-anchor-v2.2.6.json";
const pki = makePkiFixture({
  leafRoles: ["lab_operator", "report_publisher"],
});
const storage = new SqlitePlatformStorage(":memory:");
try {
  const service = new ArtifactService(
    { certificateChain: pki.chain, privateKey: pki.leafKeys.privateKey },
    storage,
  );
  const run = makeRunFixture({
    cells: [
      { split: "validation", role: "validation", depth: 3, stage: "fixed" },
    ],
  });
  const lifecycle = structuredClone(run);
  lifecycle.status = "queued";
  lifecycle.trials = [];
  service.lockPreregistrationManifest(lifecycle, lifecycle.manifest.lockedAt);
  lifecycle.status = "running";
  const startedAt = run.trials[0].startedAt;
  service.sealExecutionManifest(lifecycle, startedAt);
  service.planExecution(lifecycle, startedAt);
  const archive = await service.archive(
    run,
    TEST_CALIBRATION,
    "internal",
    "research",
  );
  await writeFile(archivePath, archive);
  await writeFile(anchorPath, `${JSON.stringify(pki.root, null, 2)}\n`);
  console.log(
    JSON.stringify({ archivePath, anchorPath, bytes: archive.length }),
  );
} finally {
  storage.close();
}

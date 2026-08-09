import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvalRun } from "../types.js";
import { normalizeRun } from "./migration.js";
import {
  decryptSensitiveJson,
  encryptSensitiveJson,
  type EncryptionKey,
} from "./encryption.js";
import type { PlatformStorage } from "./storage/index.js";

const dataRoot = path.resolve(process.env.DATA_DIR ?? "./data");
const runsDir = path.join(dataRoot, "runs");
const runs = new Map<string, EvalRun>();
const emitters = new Map<string, EventEmitter>();
const saveQueues = new Map<string, Promise<void>>();
let productionStore:
  | {
      storage: PlatformStorage;
      encryptionKey: EncryptionKey;
      decryptionKeys: Map<string, Buffer>;
      onDecryptionFailure?: (runId: string) => void;
    }
  | undefined;

export function configureProductionRunStore(
  config: NonNullable<typeof productionStore>,
): void {
  productionStore = config;
}

function filePath(runId: string): string {
  return path.join(runsDir, `${runId}.json`);
}

export async function initializeStore(): Promise<void> {
  if (productionStore) {
    for (const record of productionStore.storage.listSensitive<
      ReturnType<typeof encryptSensitiveJson>
    >("eval_run")) {
      try {
        const parsed = normalizeRun(
          decryptSensitiveJson(record.value, productionStore.decryptionKeys),
        );
        if (!parsed) continue;
        if (parsed.status === "running" || parsed.status === "queued") {
          parsed.status = "failed";
          parsed.error = "Server restarted before this run completed.";
        }
        runs.set(parsed.id, parsed);
      } catch {
        productionStore.onDecryptionFailure?.(record.id);
        throw new Error(`encrypted_run_decryption_failed:${record.id}`);
      }
    }
    return;
  }
  await mkdir(runsDir, { recursive: true });
  const files = (await readdir(runsDir)).filter((name) =>
    name.endsWith(".json"),
  );
  for (const file of files) {
    try {
      const parsed = normalizeRun(
        JSON.parse(await readFile(path.join(runsDir, file), "utf8")),
      );
      if (!parsed) continue;
      if (parsed.status === "running" || parsed.status === "queued") {
        parsed.status = "failed";
        parsed.error = "Server restarted before this run completed.";
      }
      runs.set(parsed.id, parsed);
    } catch {
      // Ignore corrupt files; they remain on disk for manual inspection.
    }
  }
}

export function getRun(runId: string): EvalRun | undefined {
  return runs.get(runId);
}

export function listRuns(): EvalRun[] {
  return [...runs.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function saveRun(run: EvalRun): Promise<void> {
  run.updatedAt = new Date().toISOString();
  runs.set(run.id, run);
  const snapshot = JSON.stringify(run, null, 2);
  if (productionStore) {
    const frozen = JSON.parse(snapshot) as EvalRun;
    const encrypted = encryptSensitiveJson(
      frozen,
      productionStore.encryptionKey,
      {
        recordType: "eval_run",
        runId: run.id,
        schemaVersion: run.schemaVersion,
      },
    );
    productionStore.storage.putSensitive(run.id, "eval_run", encrypted);
    emitterFor(run.id).emit("update", run);
    return;
  }
  const previous = saveQueues.get(run.id) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(runsDir, { recursive: true });
      const target = filePath(run.id);
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, "utf8");
      await rename(temporary, target);
      emitterFor(run.id).emit("update", run);
    });
  saveQueues.set(run.id, queued);
  try {
    await queued;
  } finally {
    if (saveQueues.get(run.id) === queued) saveQueues.delete(run.id);
  }
}

export function emitterFor(runId: string): EventEmitter {
  let emitter = emitters.get(runId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    emitters.set(runId, emitter);
  }
  return emitter;
}

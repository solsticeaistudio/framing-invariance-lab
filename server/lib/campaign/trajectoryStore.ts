import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConversationTrajectory } from "./types.js";
import { serializeTrajectoryJsonl, verifyTrajectoryIntegrity } from "./trajectoryRecorder.js";

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

/**
 * Writes a crash-resistant local checkpoint of the entire trajectory.
 * Call this after every recorded turn/context artifact when the transcript is
 * the experimental source of truth.
 */
export async function persistTrajectoryCheckpoint(args: {
  trajectory: ConversationTrajectory;
  directory: string;
}): Promise<{
  snapshotPath: string;
  jsonlPath: string;
  trajectoryHash: string;
}> {
  const integrity = verifyTrajectoryIntegrity(args.trajectory);
  if (!integrity.valid) {
    throw new Error(
      `Refusing to persist invalid trajectory: ${integrity.errors.join("; ")}`,
    );
  }

  await mkdir(args.directory, { recursive: true });
  const snapshotPath = join(args.directory, "trajectory.json");
  const jsonlPath = join(args.directory, "events.jsonl");

  await atomicWrite(
    snapshotPath,
    JSON.stringify(args.trajectory, null, 2) + "\n",
  );
  await atomicWrite(jsonlPath, serializeTrajectoryJsonl(args.trajectory));

  return {
    snapshotPath,
    jsonlPath,
    trajectoryHash: args.trajectory.trajectoryHash,
  };
}

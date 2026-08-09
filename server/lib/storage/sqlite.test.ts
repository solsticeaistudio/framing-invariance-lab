import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encryptSensitiveJson } from "../encryption.js";
import { SqlitePlatformStorage } from "./sqlite.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function storage() {
  const root = await mkdtemp(path.join(tmpdir(), "framing-sqlite-"));
  roots.push(root);
  const filename = path.join(root, "platform.sqlite");
  return { value: new SqlitePlatformStorage(filename), filename };
}

describe("SQLite platform storage", () => {
  it("migrates, uses immutable identities, and rolls transactions back", async () => {
    const { value } = await storage();
    value.putImmutable("completed_run", "run-1", "a".repeat(64), { ok: true });
    expect(
      value.getImmutable<{ ok: boolean }>("completed_run", "run-1")?.document
        .ok,
    ).toBe(true);
    expect(() =>
      value.putImmutable("completed_run", "run-1", "b".repeat(64), {
        ok: false,
      }),
    ).toThrow("immutable_artifact_conflict");
    expect(() =>
      value.transaction(() => {
        value.putImmutable("test", "rollback", "c".repeat(64), {});
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(value.getImmutable("test", "rollback")).toBeUndefined();
    value.close();
  });

  it("stores encrypted evidence without plaintext and rejects SQL-shaped IDs safely", async () => {
    const { value, filename } = await storage();
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptSensitiveJson(
      { prompt: "DATABASE_SECRET_EVIDENCE" },
      { keyId: "key-1", key },
      { recordType: "trial" },
    );
    value.putSensitive("x'); DROP TABLE users;--", "trial", encrypted);
    expect(value.getSensitive("x'); DROP TABLE users;--")).toBeDefined();
    value.database.pragma("wal_checkpoint(TRUNCATE)");
    value.close();
    expect(
      readFileSync(filename).includes(Buffer.from("DATABASE_SECRET_EVIDENCE")),
    ).toBe(false);
  });

  it("rejects replayed nonces", async () => {
    const { value } = await storage();
    expect(
      value.consumeNonce("holdout", "nonce-1", "2030-01-01T00:00:00.000Z"),
    ).toBe(true);
    expect(
      value.consumeNonce("holdout", "nonce-1", "2030-01-01T00:00:00.000Z"),
    ).toBe(false);
    value.close();
  });

  it("stores organizations, users, teams, and membership updates with prepared statements", async () => {
    const { value } = await storage();
    value.putOrganization({
      id: "lab-a",
      name: "Lab A",
      disabled: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    value.putPrincipal({
      id: "user-a",
      subject: "subject-a",
      organizationId: "lab-a",
      displayName: "Researcher",
      roles: ["researcher"],
      teamIds: [],
      disabled: false,
    });
    value.putTeam({
      id: "team-a",
      name: "Team A",
      organizationId: "lab-a",
      memberIds: ["user-a"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(value.getOrganization("lab-a")?.name).toBe("Lab A");
    expect(value.listPrincipals()).toHaveLength(1);
    expect(value.getTeam("team-a")?.memberIds).toEqual(["user-a"]);
    expect(value.listTeams()).toHaveLength(1);
    value.close();
  });
});

import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import { ArtifactService } from "./lib/artifactService.js";
import { assertSafeHostConfiguration } from "./lib/auth.js";
import { makeRunFixture, TEST_CALIBRATION } from "./testing/fixtures.js";
import { makePkiFixture } from "./testing/pkiFixtures.js";

const INTERNAL_TOKEN = "test-internal-token-value";
const ADMIN_TOKEN = "test-admin-token-value";
const run = makeRunFixture({
  cells: [
    { split: "validation", role: "validation", depth: 3, stage: "fixed" },
  ],
});
let server: Server;
let baseUrl = "";

function headers(token?: string): HeadersInit | undefined {
  return token ? { authorization: `Bearer ${token}` } : undefined;
}

beforeAll(async () => {
  const app = createApp({
    auth: { internalToken: INTERNAL_TOKEN, adminToken: ADMIN_TOKEN },
    getRun: (runId) => (runId === run.id ? run : undefined),
    listRuns: () => [run],
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind to a TCP port.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("safe startup", () => {
  it.each(["127.0.0.1", "localhost", "::1"])(
    "allows loopback host %s without auth",
    (host) => {
      expect(() => assertSafeHostConfiguration(host, {})).not.toThrow();
    },
  );

  it("refuses non-loopback startup without an authentication secret", () => {
    expect(() => assertSafeHostConfiguration("0.0.0.0", {})).toThrow(
      /Refusing to bind/,
    );
    expect(() =>
      assertSafeHostConfiguration("192.168.1.20", {
        internalToken: INTERNAL_TOKEN,
      }),
    ).not.toThrow();
  });
});

describe("API authentication and disclosure", () => {
  it("keeps genuinely public-safe routes available without auth", async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    const report = await fetch(
      `${baseUrl}/api/runs/${run.id}/report?disclosure=public`,
    );
    expect(health.status).toBe(200);
    expect(report.status).toBe(200);
  });

  it("serves only published immutable public reports when signing is configured", async () => {
    const pki = makePkiFixture({
      leafRoles: ["lab_operator", "report_publisher"],
    });
    const artifacts = new ArtifactService({
      certificateChain: pki.chain,
      privateKey: pki.leafKeys.privateKey,
    });
    const signedApp = createApp({
      auth: { internalToken: INTERNAL_TOKEN, adminToken: ADMIN_TOKEN },
      artifactService: artifacts,
      getRun: (runId) => (runId === run.id ? run : undefined),
      listRuns: () => [run],
    });
    const signedServer = signedApp.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) =>
      signedServer.once("listening", resolve),
    );
    const address = signedServer.address();
    if (!address || typeof address === "string")
      throw new Error("Signed test server did not bind to a TCP port.");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(`${origin}/api/runs/${run.id}/report`)).status).toBe(
        404,
      );
      const lifecycleRun = structuredClone(run);
      lifecycleRun.status = "queued";
      lifecycleRun.trials = [];
      artifacts.lockPreregistrationManifest(
        lifecycleRun,
        lifecycleRun.manifest.lockedAt,
      );
      lifecycleRun.status = "running";
      artifacts.sealExecutionManifest(
        lifecycleRun,
        run.trials.map((trial) => trial.startedAt).sort()[0] ?? run.createdAt,
      );
      artifacts.planExecution(
        lifecycleRun,
        run.trials.map((trial) => trial.startedAt).sort()[0] ?? run.createdAt,
      );
      artifacts.publishRun(run, TEST_CALIBRATION);
      const published = await fetch(`${origin}/api/runs/${run.id}/report`);
      expect(published.status).toBe(200);
      expect((await published.text()).includes('"disclosure":"public"')).toBe(
        true,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        signedServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("returns 401 for missing or invalid authentication on an internal report", async () => {
    const missing = await fetch(
      `${baseUrl}/api/runs/${run.id}/report?disclosure=internal`,
    );
    const invalid = await fetch(
      `${baseUrl}/api/runs/${run.id}/report?disclosure=internal`,
      { headers: headers("invalid-token") },
    );
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
  });

  it("returns 403 for an authenticated internal user lacking administrator privilege", async () => {
    const response = await fetch(`${baseUrl}/api/gold/export`, {
      headers: headers(INTERNAL_TOKEN),
    });
    expect(response.status).toBe(403);
  });

  it("lets a privileged token retrieve an internal report", async () => {
    const internalResponse = await fetch(
      `${baseUrl}/api/runs/${run.id}/report?disclosure=internal`,
      { headers: headers(INTERNAL_TOKEN) },
    );
    expect(internalResponse.status).toBe(200);
    const response = await fetch(
      `${baseUrl}/api/runs/${run.id}/report?disclosure=internal`,
      { headers: headers(ADMIN_TOKEN) },
    );
    const body = (await response.json()) as { report: { disclosure: string } };
    expect(response.status).toBe(200);
    expect(body.report.disclosure).toBe("internal");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not upgrade ambiguous disclosure query values to internal", async () => {
    const response = await fetch(
      `${baseUrl}/api/runs/${run.id}/report?disclosure=internal&disclosure=public`,
    );
    const body = (await response.json()) as { report: { disclosure: string } };
    expect(response.status).toBe(200);
    expect(body.report.disclosure).toBe("public");
  });

  it("requires privilege for raw responses, full exports, and gold exports", async () => {
    const trialId = run.trials[0].id;
    const paths = [
      `/api/runs/${run.id}/trials/${trialId}/response`,
      `/api/runs/${run.id}/export`,
      "/api/gold/export",
    ];
    for (const path of paths) {
      const unauthenticated = await fetch(`${baseUrl}${path}`);
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get("cache-control")).toContain(
        "no-store",
      );
    }
    expect(
      (
        await fetch(`${baseUrl}${paths[0]}`, {
          headers: headers(INTERNAL_TOKEN),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}${paths[1]}`, {
          headers: headers(INTERNAL_TOKEN),
        })
      ).status,
    ).toBe(200);
    expect(
      (await fetch(`${baseUrl}${paths[2]}`, { headers: headers(ADMIN_TOKEN) }))
        .status,
    ).toBe(200);
  });

  it("requires authentication for run creation and cancellation", async () => {
    const create = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const cancel = await fetch(`${baseUrl}/api/runs/${run.id}/cancel`, {
      method: "POST",
    });
    expect(create.status).toBe(401);
    expect(cancel.status).toBe(401);
  });

  it("does not allow an authenticated API payload to self-declare trusted holdout provenance", async () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key-never-used";
    try {
      const submitted = structuredClone(run.config);
      submitted.scenarios = [structuredClone(submitted.scenarios[0])];
      submitted.scenarios[0].id = "client-confirmatory-scenario";
      submitted.scenarios[0].datasetSplit = "holdout";
      submitted.scenarios[0].replicationRole = "sealed_holdout";
      submitted.scenarios[0].replicationProvenance = {
        kind: "external_sealed_pack",
        trusted: true,
        sourceHash: "a".repeat(64),
        packHash: "b".repeat(64),
      };
      delete submitted.scenarios[0].contract.canary;
      const response = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${INTERNAL_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(submitted),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error: string;
        details: { issues: unknown[] };
      };
      expect(body.error).toBe("Invalid replication provenance.");
      expect(body.details.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "untrusted_confirmatory_provenance",
            path: "scenarios[0].replicationProvenance",
          }),
        ]),
      );
    } finally {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });

  it("requires administrator privilege for every gold mutation", async () => {
    const requests: Array<[string, RequestInit]> = [
      [
        "/api/gold",
        {
          method: "POST",
          body: "{}",
          headers: { "content-type": "application/json" },
        },
      ],
      [
        "/api/gold/example/annotations",
        {
          method: "POST",
          body: "{}",
          headers: { "content-type": "application/json" },
        },
      ],
      ["/api/gold/example", { method: "DELETE" }],
    ];
    for (const [path, init] of requests)
      expect((await fetch(`${baseUrl}${path}`, init)).status).toBe(401);
  });

  it("public run and report payloads omit all forbidden evidence", async () => {
    const runResponse = await fetch(`${baseUrl}/api/runs/${run.id}`);
    const reportResponse = await fetch(
      `${baseUrl}/api/runs/${run.id}/report?disclosure=public`,
    );
    const payload = `${await runResponse.text()}\n${await reportResponse.text()}`;
    for (const secret of [
      "SENSITIVE_BASE_PROMPT",
      "SENSITIVE_SYSTEM_PROMPT",
      "SENSITIVE_GENERATED_PROMPT",
      "SENSITIVE_RAW_RESPONSE",
      "PRIVATE_PREVIEW",
      "PRIVATE_RATIONALE",
      "PRIVATE_SIGNAL",
      "PRIVATE_SPAN_REASON",
      "PRIVATE_REQUEST",
      "PRIVATE_CANARY",
      "PRIVATE_NOTE",
      "PRIVATE_RUN_NAME",
    ])
      expect(payload).not.toContain(secret);
  });

  it("never reflects configured or supplied tokens in responses", async () => {
    const supplied = "token-that-must-not-be-reflected";
    const response = await fetch(`${baseUrl}/api/gold/export`, {
      headers: headers(supplied),
    });
    const body = await response.text();
    expect(body).not.toContain(supplied);
    expect(body).not.toContain(INTERNAL_TOKEN);
    expect(body).not.toContain(ADMIN_TOKEN);
  });
});

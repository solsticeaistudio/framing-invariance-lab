import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import { makeRunFixture } from "./testing/fixtures.js";

const run = makeRunFixture({
  cells: [{ split: "development", depth: 3, stage: "scout" }],
});
const fingerprint = run.trials.find((trial) => !trial.variant.isBaseline)!.variant.fingerprint;
const body = {
  name: "Controlled framing research",
  hypothesisTitle: "Wording changes a benign contract",
  mechanism: "Framing influences adherence.",
  prediction: "Responses differ under a controlled format.",
  candidateLabel: "Format variant",
  variantFingerprint: fingerprint,
  runIds: [run.id],
};
const token = "campaign-api-test-secret";
let server: Server;
let url: string;

beforeAll(async () => {
  const app = createApp({
    auth: { internalToken: token, adminToken: "campaign-api-test-admin" },
    getRun: (id) => id === run.id ? run : undefined,
    listRuns: () => [run],
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  url = "http://127.0.0.1:" + address.port + "/api/campaigns/assess";
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
});

function post(payload: unknown, auth = true) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(payload),
  });
}

describe("campaign screening API", () => {
  it("rejects anonymous calls", async () => {
    expect((await post(body, false)).status).toBe(401);
  });

  it("returns metadata-only evidence for an authorized completed run", async () => {
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const raw = await response.text();
    expect(raw).not.toContain("SENSITIVE_RAW_RESPONSE");
    expect(raw).not.toContain("SENSITIVE_GENERATED_PROMPT");
    const data = JSON.parse(raw);
    expect(data.result.assessment.breadth.eventTrials).toBe(3);
    expect(data.result.evidence.sensitiveTextIncluded).toBe(false);
  });

  it("does not distinguish unknown and inaccessible run identifiers", async () => {
    const response = await post({ ...body, runIds: ["missing-run"] });
    expect(response.status).toBe(404);
  });

  it("rejects a forged candidate fingerprint", async () => {
    const response = await post({ ...body, variantFingerprint: "fabricated" });
    expect(response.status).toBe(400);
  });
});

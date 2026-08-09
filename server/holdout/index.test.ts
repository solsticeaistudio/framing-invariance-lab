import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createHoldoutApp } from "./index.js";
import { HARNESS_VERSION } from "../lib/protocolVersions.js";
import type { SealedHoldoutExecutor } from "./protocol.js";

const servers: Server[] = [];
afterEach(
  async () =>
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
    ),
);

async function originFor(
  execute: SealedHoldoutExecutor["execute"],
): Promise<string> {
  const server = createHoldoutApp({ execute }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("sealed executor HTTP boundary", () => {
  it("exposes only a safe health document", async () => {
    const origin = await originFor(async () => {
      throw new Error("not called");
    });
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "sealed-holdout-executor",
      version: HARNESS_VERSION,
    });
  });

  it("rejects arbitrary prompt submission without echoing hidden input or errors", async () => {
    const origin = await originFor(async () => {
      throw new Error("HIDDEN_PROVIDER_OR_PACK_DETAIL");
    });
    const response = await fetch(`${origin}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "ARBITRARY_PROMPT_SENTINEL" }),
    });
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(body).not.toContain("ARBITRARY_PROMPT_SENTINEL");
    expect(body).not.toContain("HIDDEN_PROVIDER_OR_PACK_DETAIL");
  });
});

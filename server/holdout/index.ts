import express from "express";
import { fixedWindowRateLimit } from "../lib/rateLimit.js";
import type { SealedHoldoutExecutor } from "./protocol.js";
import type { RemoteExecutionRequest, SignedArtifact } from "../v2/types.js";
import type { PlatformStorage } from "../lib/storage/index.js";
import { HARNESS_VERSION } from "../lib/protocolVersions.js";

export function createHoldoutApp(
  executor: Pick<SealedHoldoutExecutor, "execute">,
  options: { storage?: PlatformStorage } = {},
): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(
    (
      _: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      next();
    },
  );
  app.get("/health", (_request, response) =>
    response.json({
      ok: true,
      service: "sealed-holdout-executor",
      version: HARNESS_VERSION,
    }),
  );
  app.post(
    "/v1/execute",
    fixedWindowRateLimit({
      namespace: "holdout-submit",
      windowMs: 60_000,
      limit: 30,
      store: options.storage,
    }),
    async (request, response) => {
      try {
        const result = await executor.execute(
          request.body as SignedArtifact<RemoteExecutionRequest>,
        );
        response.json({ result });
      } catch (error) {
        const code =
          error instanceof Error &&
          error.message === "holdout_concurrency_limit"
            ? 429
            : 400;
        response.status(code).json({
          error: "The signed holdout execution request was rejected.",
        });
      }
    },
  );
  app.all("*path", (_, response) =>
    response.status(404).json({ error: "Not found." }),
  );
  return app;
}

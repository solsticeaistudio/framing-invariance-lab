import { spawn } from "node:child_process";
import { resolve } from "node:path";

export type DeltaStoreBridgeConfig = {
  sessionId: string;
  dbPath: string;
  deltaSourceDir: string;
  pythonBin?: string;
  bridgeScript?: string;
  redactSensitiveText?: boolean;
  timeoutMs?: number;
};

type BridgeResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export async function runDeltaStoreBridge<T>(
  config: DeltaStoreBridgeConfig,
  op: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const pythonBin =
    config.pythonBin ?? process.env.DELTA_PYTHON_BIN ?? "python";
  const script =
    config.bridgeScript ??
    process.env.DELTA_FORENSIC_BRIDGE ??
    resolve(process.cwd(), "scripts", "delta-forensic-bridge.py");
  const args = [
    script,
    "--source-dir",
    config.deltaSourceDir,
    "--db",
    config.dbPath,
    "--session-id",
    config.sessionId,
  ];
  if (config.redactSensitiveText) args.push("--redact-sensitive-text");

  return await new Promise<T>((resolvePromise, reject) => {
    const child = spawn(pythonBin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `DeltaStore bridge timed out after ${config.timeoutMs ?? 30_000}ms`,
        ),
      );
    }, config.timeoutMs ?? 30_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const last = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      if (!last) {
        reject(
          new Error(
            `DeltaStore bridge returned no JSON (exit ${code ?? "unknown"}): ${stderr.trim()}`,
          ),
        );
        return;
      }
      try {
        const response = JSON.parse(last) as BridgeResponse<T>;
        if (!response.ok) {
          reject(new Error(response.error));
          return;
        }
        if (code !== 0) {
          reject(new Error(`DeltaStore bridge exited ${code}: ${stderr.trim()}`));
          return;
        }
        resolvePromise(response.result);
      } catch (error) {
        reject(
          error instanceof SyntaxError
            ? new Error(`DeltaStore bridge returned invalid JSON: ${last}`)
            : error,
        );
      }
    });
    child.stdin.end(JSON.stringify({ op, data }));
  });
}

import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TrustCertificate } from "../server/v2/types.js";
import { migrateRunFile } from "../server/lib/legacyMigration.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const source = args.find((value) => !value.startsWith("--"));
if (!source)
  throw new Error(
    "Usage: npm run migrate:v2 -- [--dry-run] <legacy-run.json> [destination.json]",
  );
const positional = args.filter((value) => !value.startsWith("--"));
const destination =
  positional[1] ??
  path.join(path.dirname(source), "migrated-v2", path.basename(source));
let identity;
if (!dryRun) {
  const privatePath = process.env.SIGNING_PRIVATE_KEY_FILE;
  const chainPath = process.env.SIGNING_CERTIFICATE_CHAIN_FILE;
  if (!privatePath || !chainPath)
    throw new Error(
      "Actual migration requires SIGNING_PRIVATE_KEY_FILE and SIGNING_CERTIFICATE_CHAIN_FILE.",
    );
  identity = {
    privateKey: createPrivateKey(await readFile(privatePath, "utf8")),
    certificateChain: JSON.parse(
      await readFile(chainPath, "utf8"),
    ) as TrustCertificate[],
  };
}
console.log(
  JSON.stringify(
    await migrateRunFile({
      sourcePath: source,
      destinationPath: destination,
      dryRun,
      identity,
      migratedAt: new Date().toISOString(),
    }),
    null,
    2,
  ),
);

import { readFile } from "node:fs/promises";
import type { ArtifactType, SignedArtifact } from "../server/v2/types.js";
import { verifySignedArtifact } from "../server/lib/signatures.js";
import { trustStoreFromEnvironment } from "../server/lib/trustStoreLoader.js";
import { option, required } from "./cli.js";

const artifact = JSON.parse(
  await readFile(required("in"), "utf8"),
) as SignedArtifact<unknown>;
const expectedType = (option("type") ?? artifact.artifactType) as ArtifactType;
const result = verifySignedArtifact({
  artifact,
  trustStore: await trustStoreFromEnvironment(process.env),
  expectedType,
  expectedPurpose: option("purpose"),
  now: option("now"),
});
console.log(JSON.stringify(result, null, 2));
if (!result.validAtSigning) process.exitCode = 1;

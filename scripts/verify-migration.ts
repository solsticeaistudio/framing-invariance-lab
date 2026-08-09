import { trustStoreFromEnvironment } from "../server/lib/trustStoreLoader.js";
import { verifyMigration } from "../server/lib/legacyMigration.js";
import { required } from "./cli.js";

const errors = await verifyMigration({
  sourcePath: required("source"),
  destinationPath: required("destination"),
  reportPath: required("report"),
  trustStore: await trustStoreFromEnvironment(process.env),
});
console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
if (errors.length) process.exitCode = 1;

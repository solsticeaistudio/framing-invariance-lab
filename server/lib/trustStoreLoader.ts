import { readFile } from "node:fs/promises";
import type { SignedRevocationList, TrustCertificate } from "../v2/types.js";
import { TrustStore } from "./trustStore.js";

function paths(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}
async function documents<T>(files: string[]): Promise<T[]> {
  const output: T[] = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) output.push(...(parsed as T[]));
    else output.push(parsed as T);
  }
  return output;
}

export async function trustStoreFromEnvironment(
  environment: NodeJS.ProcessEnv,
): Promise<TrustStore> {
  const store = new TrustStore();
  const anchors = await documents<TrustCertificate>(
    paths(environment.TRUST_ANCHOR_FILES),
  );
  for (const anchor of anchors) store.addTrustAnchor(anchor, true);
  const certificates = await documents<TrustCertificate>(
    paths(environment.TRUST_CERTIFICATE_FILES),
  );
  for (const certificate of certificates) store.addCertificate(certificate);
  const revocations = await documents<SignedRevocationList>(
    paths(environment.REVOCATION_LIST_FILES),
  );
  for (const list of revocations.sort(
    (left, right) => left.sequence - right.sequence,
  ))
    store.addRevocationList(list);
  return store;
}

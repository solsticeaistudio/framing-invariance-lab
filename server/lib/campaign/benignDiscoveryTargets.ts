import {
  RECEIPT_FIELDS,
  RECEIPT_OPTIONS,
  receiptContract,
  seededRng,
  type ReceiptCase,
  type ReceiptField,
  type ReceiptQuery,
} from "./benignDiscovery.js";

/**
 * Local evaluation-only target factory. Its injected conditional regression is
 * hidden from the discoverReceiptMismatch implementation.
 *
 * IMPORTANT: These are simulated software regressions, not actual security
 * vulnerabilities. This module must never be used as a model-target adapter.
 */
export function makeBlindReceiptTarget(seed: number, mode: "faulty" | "clean"): {
  query: ReceiptQuery;
} {
  const rng = seededRng(seed ^ 0x5a19b723);
  const fields: ReceiptField[] = [...RECEIPT_FIELDS];
  for (let index = fields.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(rng() * (index + 1));
    [fields[index], fields[selected]] = [fields[selected], fields[index]];
  }
  const triggerCount = seed % 3 === 0 ? 2 : 3;
  const hiddenConstraints = fields.slice(0, triggerCount).map((field) => {
    const values: readonly string[] = RECEIPT_OPTIONS[field];
    return [field, values[Math.floor(rng() * values.length)]] as const;
  });
  const faultFamily = (seed >>> 1) % 2;

  return {
    async query(input: ReceiptCase): Promise<string> {
      const correct = receiptContract(input);
      if (mode === "clean") return correct;
      if (!hiddenConstraints.every(([field, value]) => input[field] === value)) {
        return correct;
      }
      // Two independently implemented, deterministic rendering faults.
      // Neither is explicitly given to the discovery algorithm.
      if (faultFamily === 0) {
        return correct.replace('"settled":', '"settled":"corrupt", "originalSettled":');
      }
      return correct.replace('"receipt":"', '"receipt":"[truncated]');
    },
  };
}

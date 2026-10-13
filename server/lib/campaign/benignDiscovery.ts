import { canonicalSha256 } from "../canonicalJson.js";

/**
 * Deliberately narrow, offline black-box research sandbox: fictional receipt
 * rendering, never arbitrary prompts or model endpoints.
 *
 * The discoverer gets only its typed input space, public functional contract,
 * and a callback that returns output. It receives no hidden fault definition.
 */
export const RECEIPT_OPTIONS = {
  locale: ["en", "fr", "es", "de"],
  channel: ["web", "print", "email", "kiosk"],
  style: ["plain", "formal", "brief", "friendly"],
  audience: ["individual", "team", "vendor", "guest"],
  status: ["draft", "paid", "pending", "void"],
  priority: ["normal", "low", "high", "urgent"],
} as const;

export type ReceiptField = keyof typeof RECEIPT_OPTIONS;
export const RECEIPT_FIELDS = Object.keys(RECEIPT_OPTIONS) as ReceiptField[];

export type ReceiptCase = { ticketId: string } & {
  [K in ReceiptField]: (typeof RECEIPT_OPTIONS)[K][number];
};

export type ReceiptQuery = (input: ReceiptCase) => Promise<string>;

export function receiptContract(input: ReceiptCase): string {
  return JSON.stringify({
    ticketId: input.ticketId,
    receipt: [
      input.locale, input.channel, input.style,
      input.audience, input.status, input.priority,
    ].join(" / "),
    settled: input.status === "paid",
  });
}

type Phase = "search" | "ablation" | "holdout_positive" | "holdout_control";
export type ProbeRecord = {
  phase: Phase;
  inputHash: string;
  responseHash: string;
  expectedHash: string;
  mismatch: boolean;
};

export type DiscoveredPattern = {
  requiredValues: Partial<Pick<ReceiptCase, ReceiptField>>;
  eliminatedFields: ReceiptField[];
  /** Distinct held-out ticket IDs; never used during search/ablation. */
  heldOutPositiveTrials: number;
  heldOutPositiveFailures: number;
  heldOutControlTrials: number;
  heldOutControlCorrect: number;
  reproduced: boolean;
};

export type BlindDiscoveryReport = {
  schemaVersion: "fil-blind-receipt-discovery-v1";
  classification: "synthetic_protocol_discovery";
  targetIdentity: string;
  searchBudget: number;
  searchTrials: number;
  searchFailures: number;
  ablationTrials: number;
  discovery: DiscoveredPattern | null;
  probeCount: number;
  probeLedger: ProbeRecord[];
  probeLedgerHash: string;
  limitations: string[];
};

/** Small deterministic PRNG for reproducible *test inputs*, not cryptographic use. */
export function seededRng(seed: number): () => number {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function choose<T>(choices: readonly T[], rng: () => number): T {
  return choices[Math.floor(rng() * choices.length)];
}

function newCase(rng: () => number, ticketId: string): ReceiptCase {
  return {
    ticketId,
    locale: choose(RECEIPT_OPTIONS.locale, rng),
    channel: choose(RECEIPT_OPTIONS.channel, rng),
    style: choose(RECEIPT_OPTIONS.style, rng),
    audience: choose(RECEIPT_OPTIONS.audience, rng),
    status: choose(RECEIPT_OPTIONS.status, rng),
    priority: choose(RECEIPT_OPTIONS.priority, rng),
  };
}

function otherValue<K extends ReceiptField>(
  field: K, original: ReceiptCase[K],
): ReceiptCase[K] {
  const values: readonly string[] = RECEIPT_OPTIONS[field];
  return values.find((value) => value !== original)! as ReceiptCase[K];
}

/** Search, then identify a minimal conditional pattern through counterfactuals. */
export async function discoverReceiptMismatch(args: {
  query: ReceiptQuery;
  targetIdentity: string;
  seed: number;
  searchBudget?: number;
  holdoutEach?: number;
}): Promise<BlindDiscoveryReport> {
  const budget = args.searchBudget ?? 320;
  const holdoutEach = args.holdoutEach ?? 12;
  if (!Number.isInteger(budget) || budget < 1 || budget > 2000) {
    throw new Error("Search budget must be 1..2000.");
  }
  if (!Number.isInteger(holdoutEach) || holdoutEach < 4 || holdoutEach > 60) {
    throw new Error("Holdout trials must be 4..60 per condition.");
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(args.targetIdentity)) {
    throw new Error("Target identity must be a safe, non-sensitive identifier.");
  }
  const rng = seededRng(args.seed);
  const ledger: ProbeRecord[] = [];
  let searchTrials = 0;
  let searchFailures = 0;
  let ablationTrials = 0;
  let anchor: ReceiptCase | undefined;

  async function probe(input: ReceiptCase, phase: Phase): Promise<boolean> {
    const actual = await args.query(input);
    if (typeof actual !== "string" || actual.length > 10000) {
      throw new Error("Invalid offline simulator response.");
    }
    const expected = receiptContract(input);
    const mismatch = actual !== expected;
    ledger.push({
      phase,
      inputHash: canonicalSha256(input),
      responseHash: canonicalSha256({ text: actual }),
      expectedHash: canonicalSha256({ text: expected }),
      mismatch,
    });
    return mismatch;
  }

  // Stratification uses a randomized, per-field Latin cycle. The hidden
  // target is unknown; no target internals or planted trigger strings are read.
  const offsets = RECEIPT_FIELDS.map(() => Math.floor(rng() * 4));
  const permutations = RECEIPT_FIELDS.map((field) => {
    const items = [...RECEIPT_OPTIONS[field]];
    for (let index = items.length - 1; index > 0; index -= 1) {
      const j = Math.floor(rng() * (index + 1));
      [items[index], items[j]] = [items[j], items[index]];
    }
    return items;
  });
  for (let index = 0; index < budget; index += 1) {
    const candidate = newCase(rng, "discovery-" + index);
    if (index < 64) {
      RECEIPT_FIELDS.forEach((field, position) => {
        // Each field cycles through all four values, independently shuffled.
        (candidate as Record<string, string>)[field] =
          permutations[position][(index + offsets[position]) % 4];
      });
    }
    const mismatch = await probe(candidate, "search");
    searchTrials += 1;
    if (mismatch) {
      searchFailures += 1;
      anchor = candidate;
      break;
    }
  }

  let discovery: DiscoveredPattern | null = null;
  if (anchor) {
    const requiredValues: Partial<Pick<ReceiptCase, ReceiptField>> = {};
    const eliminatedFields: ReceiptField[] = [];
    // Test each feature's contribution while preserving the same anchor.
    // This is genuine black-box ablation, not a hard-coded trigger lookup.
    for (const field of RECEIPT_FIELDS) {
      const opposite = {
        ...anchor,
        [field]: otherValue(field, anchor[field]),
      } as ReceiptCase;
      const persists = await probe(opposite, "ablation");
      ablationTrials += 1;
      if (persists) eliminatedFields.push(field);
      else Object.assign(requiredValues, { [field]: anchor[field] });
    }

    const requiredFields = RECEIPT_FIELDS.filter(
      (field) => requiredValues[field] !== undefined,
    );
    let positiveFailures = 0;
    let controlCorrect = 0;

    for (let index = 0; index < holdoutEach; index += 1) {
      const positive = newCase(rng, "holdout-positive-" + index);
      for (const field of requiredFields) {
        (positive as Record<string, string>)[field] = requiredValues[field]!;
      }
      if (await probe(positive, "holdout_positive")) positiveFailures += 1;

      const control = { ...positive, ticketId: "holdout-control-" + index };
      if (requiredFields.length > 0) {
        const field = requiredFields[index % requiredFields.length];
        (control as Record<string, string>)[field] =
          otherValue(field, positive[field]);
      }
      if (!(await probe(control, "holdout_control"))) controlCorrect += 1;
    }

    discovery = {
      requiredValues,
      eliminatedFields,
      heldOutPositiveTrials: holdoutEach,
      heldOutPositiveFailures: positiveFailures,
      heldOutControlTrials: holdoutEach,
      heldOutControlCorrect: controlCorrect,
      reproduced:
        requiredFields.length > 0 &&
        positiveFailures === holdoutEach &&
        controlCorrect === holdoutEach,
    };
  }

  return {
    schemaVersion: "fil-blind-receipt-discovery-v1",
    classification: "synthetic_protocol_discovery",
    targetIdentity: args.targetIdentity,
    searchBudget: budget,
    searchTrials,
    searchFailures,
    ablationTrials,
    discovery,
    probeCount: ledger.length,
    probeLedger: ledger,
    probeLedgerHash: canonicalSha256(ledger),
    limitations: [
      "Only a finite, fictional receipt-rendering protocol is tested.",
      "The agent cannot call external models, issue arbitrary prompts or adapt to real provider endpoints.",
      "Hidden simulator faults are generated for testing; discovery does not prove a real-world AI vulnerability.",
      "Holdout confirms generalization to unseen ticket IDs and randomized irrelevant fields, not other model architectures.",
      "A matching probe ledger hash proves content consistency, not execution authenticity.",
    ],
  };
}

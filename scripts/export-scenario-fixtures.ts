import { writeFile } from "node:fs/promises";
import type { Scenario } from "../server/types.js";
import { canonicalSha256 } from "../server/lib/canonicalJson.js";
import { canonicalResearchIdentity } from "../server/lib/executionPlan.js";

process.env.ENABLE_HOLDOUT = "true";
const { REPLICATION_CAPABILITY, SCENARIO_PACKS } = await import(
  "../server/scenarios.js"
);

const scenarios = SCENARIO_PACKS.flatMap((pack) =>
  pack.scenarios.map((scenario) => ({ pack: pack.id, scenario })),
);

const familyIdentities = new Map<string, Set<string>>();
for (const { scenario } of scenarios) {
  if (!scenario.replicationKey || !scenario.pairId) continue;
  const identity = canonicalResearchIdentity({
    scenario,
    outcomeType: "invariance",
    methodologyCompatibilityHash: canonicalSha256({
      outcome: scenario.expectedBehavior,
      policyArea: scenario.policyArea,
    }),
    targetCompatibilityPolicy: "same_requested_model",
  }).replicationIdentity;
  const key = `${scenario.replicationKey}|${scenario.familyId}|${scenario.pairId}`;
  const identities = familyIdentities.get(key) ?? new Set<string>();
  identities.add(identity);
  familyIdentities.set(key, identities);
}
const inconsistentFamilies = [...familyIdentities.entries()]
  .filter(([, identities]) => identities.size > 1)
  .map(([family]) => family);
if (inconsistentFamilies.length)
  throw new Error(
    `inconsistent_replication_identity:${inconsistentFamilies.join(",")}`,
  );

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function counts(
  select: (scenario: Scenario) => string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const { scenario } of scenarios) increment(result, select(scenario));
  return result;
}

function csv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const catalogHeader = [
  "pack",
  "scenario_id",
  "title",
  "dataset_split",
  "replication_role",
  "replication_key",
  "policy_area",
  "family_id",
  "pair_id",
  "intent_class",
  "capability_level",
  "boundary_position",
  "expected_behavior",
  "risk_tier",
  "safe_response",
  "unsafe_response",
  "mutation_invariants",
  "tags",
];

const catalogRows = scenarios.map(({ pack, scenario }) =>
  [
    pack,
    scenario.id,
    scenario.title,
    scenario.datasetSplit,
    scenario.replicationRole ?? "",
    scenario.replicationKey ?? "",
    scenario.policyArea,
    scenario.familyId,
    scenario.pairId ?? "",
    scenario.intentClass,
    scenario.capabilityLevel,
    scenario.boundaryPosition,
    scenario.expectedBehavior,
    scenario.riskTier,
    scenario.contract.safeResponse,
    scenario.contract.unsafeResponse,
    scenario.mutationInvariants.join(" | "),
    scenario.tags.join(" | "),
  ]
    .map(csv)
    .join(","),
);

const packCounts: Record<string, number> = {};
for (const { pack } of scenarios) increment(packCounts, pack);

const coverage = {
  generatedAt: "2026-08-05",
  schemaVersion: "2.0",
  packs: packCounts,
  totalScenarios: scenarios.length,
  byDatasetSplit: counts((scenario) => scenario.datasetSplit),
  byReplicationRole: counts(
    (scenario) => scenario.replicationRole ?? "unspecified",
  ),
  byPolicyArea: counts((scenario) => scenario.policyArea),
  byBoundaryPosition: counts((scenario) => scenario.boundaryPosition),
  byIntentClass: counts((scenario) => scenario.intentClass),
  byCapabilityLevel: counts((scenario) => scenario.capabilityLevel),
  byRiskTier: counts((scenario) => scenario.riskTier),
  replicationCapability: REPLICATION_CAPABILITY,
};

await Promise.all([
  writeFile(
    "examples/scenario-packs.json",
    `${JSON.stringify(SCENARIO_PACKS, null, 2)}\n`,
  ),
  writeFile(
    "examples/scenario-coverage-summary.json",
    `${JSON.stringify(coverage, null, 2)}\n`,
  ),
  writeFile(
    "examples/scenario-catalog.csv",
    `${catalogHeader.join(",")}\n${catalogRows.join("\n")}\n`,
  ),
]);

console.log(
  JSON.stringify(
    {
      packs: SCENARIO_PACKS.length,
      scenarios: scenarios.length,
      splitCounts: coverage.byDatasetSplit,
      replicationCapability: REPLICATION_CAPABILITY,
    },
    null,
    2,
  ),
);

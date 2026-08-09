import {
  DEFAULT_SCENARIOS,
  HOLDOUT_METADATA,
  SCENARIO_PACKS,
} from "../server/scenarios.js";
import type { RunConfig } from "../server/types.js";
import { calibrationReport, cohensKappa } from "../server/lib/calibration.js";
import {
  buildManifest,
  sealManifest,
  verifyManifest,
  verifySealedManifest,
} from "../server/lib/manifest.js";
import { validateResearchScope } from "../server/lib/policy.js";
import {
  axisDefinitions,
  buildVariants,
  scenarioAxes,
} from "../server/lib/variantFactory.js";

const AXES = Object.keys(axisDefinitions()) as Array<
  keyof ReturnType<typeof axisDefinitions>
>;
const failures: string[] = [];
const scenarios = SCENARIO_PACKS.flatMap((pack) => pack.scenarios);

if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length)
  failures.push("Scenario IDs are not unique.");
for (const pack of SCENARIO_PACKS)
  failures.push(
    ...validateResearchScope(pack.scenarios).map(
      (message) => `${pack.id}: ${message}`,
    ),
  );

let variantsTotal = 0;
let uncoveredPairs = 0;
for (const scenario of scenarios) {
  const variants = buildVariants([scenario], "pairwise", 42);
  variantsTotal += variants.length;
  if (variants.filter((variant) => variant.isBaseline).length !== 1)
    failures.push(`${scenario.id}: expected one baseline.`);
  if (
    variants.find((variant) => variant.isBaseline)?.prompt !==
    scenario.basePrompt
  )
    failures.push(`${scenario.id}: baseline prompt changed.`);
  const axes = scenarioAxes(scenario);
  for (let a = 0; a < AXES.length; a += 1) {
    for (let b = a + 1; b < AXES.length; b += 1) {
      const axisA = AXES[a];
      const axisB = AXES[b];
      for (const valueA of axes[axisA]) {
        for (const valueB of axes[axisB]) {
          if (
            !variants.some(
              (variant) =>
                variant.axes[axisA] === valueA.id &&
                variant.axes[axisB] === valueB.id,
            )
          )
            uncoveredPairs += 1;
        }
      }
    }
  }
}
if (uncoveredPairs)
  failures.push(`${uncoveredPairs} pairwise interactions are uncovered.`);

const testScenario = scenarios[0];
const config: RunConfig = {
  name: "methodology validation",
  targetModel: "target-model",
  judgeModel: "judge-model",
  equivalenceJudgeModel: "equivalence-model",
  secondaryJudgeSampleRate: 0,
  scenarios: [testScenario],
  runMode: "preregistered",
  replicationMode: "adaptive",
  repetitions: 3,
  confirmRepetitions: 10,
  publishRepetitions: 20,
  adaptiveLiftThreshold: 0.1,
  adaptiveMaxVariants: 20,
  concurrency: 1,
  maxTokens: 500,
  temperature: 0.4,
  seed: 42,
  design: "pairwise",
  judgeMode: "ensemble",
  mutationMode: "deterministic",
  redactResponses: true,
  storeRawResponses: true,
  scopeAccepted: true,
};
const manifest = buildManifest({
  config,
  axes: axisDefinitions(),
  lockedAt: "2026-08-02T00:00:00.000Z",
});
if (!verifyManifest(config, axisDefinitions(), manifest))
  failures.push("Locked manifest failed verification.");
const manifestVariants = buildVariants(
  config.scenarios,
  config.design,
  config.seed,
);
const sealed = sealManifest(manifest, manifestVariants);
if (!verifySealedManifest(sealed, manifestVariants))
  failures.push("Sealed variant manifest failed verification.");
if (
  verifySealedManifest(sealed, [
    { ...manifestVariants[0], prompt: `${manifestVariants[0].prompt} changed` },
    ...manifestVariants.slice(1),
  ])
)
  failures.push("Variant tampering was not detected.");
if (cohensKappa(["a", "a", "b", "b"], ["a", "a", "b", "b"]) !== 1)
  failures.push("Cohen's kappa smoke check failed.");
if (calibrationReport([]).goldItems !== 0)
  failures.push("Empty calibration report is malformed.");

const result = {
  packs: SCENARIO_PACKS.length,
  visibleScenarios: scenarios.length,
  defaultScenarios: DEFAULT_SCENARIOS.length,
  hiddenHoldouts: HOLDOUT_METADATA.scenarioCount,
  pairwiseVariants: variantsTotal,
  uncoveredPairs,
  manifestVerified: true,
  sealedVariantSetVerified: true,
  calibrationMathVerified: true,
};

if (failures.length) {
  console.error(JSON.stringify({ ...result, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));

import type {
  CandidateAssessment,
  ResearchCampaign,
  TechniqueCandidate,
} from "./types.js";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderCandidateReport(args: {
  campaign: ResearchCampaign;
  candidate: TechniqueCandidate;
  assessment: CandidateAssessment;
}): string {
  const hypothesis = args.campaign.hypotheses.find(
    (item) => item.id === args.candidate.hypothesisId,
  );
  const lines = [
    `# Campaign candidate report: ${args.candidate.label}`,
    "",
    `Campaign: ${args.campaign.name}`,
    `Candidate ID: ${args.candidate.id}`,
    `Current stage: ${args.assessment.currentStage}`,
    `Recommended stage: ${args.assessment.recommendedStage}`,
    "",
    "## Hypothesis",
    "",
    hypothesis
      ? `**${hypothesis.title}** — ${hypothesis.prediction}`
      : "No hypothesis metadata is available.",
    "",
    "## Breadth summary",
    "",
    `- Completed trials: ${args.assessment.breadth.completedTrials}`,
    `- Evidence-grade trials: ${args.assessment.breadth.promotableTrials}`,
    `- Degraded judge assessments: ${args.assessment.breadth.degradedTrials} (${pct(
      args.assessment.breadth.degradedAssessmentRate,
    )})`,
    `- Event rate (evidence-grade denominator): ${pct(args.assessment.breadth.eventRate)}`,
    `- Distinct scenarios: ${args.assessment.breadth.distinctScenarios}`,
    `- Qualifying scenarios: ${args.assessment.breadth.qualifyingScenarios}`,
    `- Transport error rate: ${pct(
      args.assessment.breadth.transportErrorRate,
    )}`,
    "",
    "## Promotion checks",
    "",
    ...args.assessment.checks.map(
      (check) =>
        `- ${check.pass ? "PASS" : "FAIL"} ${check.id}: observed=${String(
          check.observed,
        )}, required=${String(check.required)} — ${check.explanation}`,
    ),
    "",
    "## Scenario matrix",
    "",
    "| Scenario | Completed | Evidence-grade | Degraded | Events | Event rate | Qualifying |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...args.assessment.breadth.scenarios.map(
      (scenario) =>
        `| ${scenario.scenarioId} | ${scenario.completedTrials} | ${scenario.promotableTrials} | ${scenario.degradedTrials} | ${scenario.eventTrials} | ${pct(
          scenario.eventRate,
        )} | ${scenario.qualifying ? "yes" : "no"} |`,
    ),
    "",
    "## Disclosure note",
    "",
    "This report intentionally summarizes experiment metadata and aggregate outcomes. It does not include prompts, responses, credentials, or provider-private configuration.",
    "",
  ];
  return lines.join("\n");
}

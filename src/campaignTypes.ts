// Read-only exploratory screening API. This is not a signed study tier.
export type CampaignAssessmentRequest = {
  name: string;
  hypothesisTitle: string;
  mechanism: string;
  prediction: string;
  candidateLabel: string;
  variantFingerprint: string;
  runIds: string[];
  eventMode: "contract_failure" | "incorrect_decision";
};

export type CampaignAssessmentResult = {
  campaign: {
    id: string;
    name: string;
    hypothesis: { title: string; mechanism: string; prediction: string };
    candidate: { id: string; label: string };
    runIds: string[];
  };
  assessment: {
    currentStage: string;
    recommendedStage: string;
    blockers: string[];
    checks: Array<{
      id: string;
      pass: boolean;
      observed: number | boolean;
      required: number | boolean;
      explanation: string;
    }>;
    breadth: {
      completedTrials: number;
      promotableTrials: number;
      degradedTrials: number;
      eventTrials: number;
      eventRate: number;
      transportErrors: number;
      distinctScenarios: number;
      qualifyingScenarios: number;
    };
  };
  followUp: {
    perturbations: Array<{ id: string; kind: string; purpose: string }>;
    minimization: Array<{ id: string; label: string }>;
  };
  evidence: {
    bundleHash: string;
    sensitiveTextIncluded: boolean;
    runRefs: Array<{ runId: string; manifestHash: string }>;
  };
  caveats: string[];
};

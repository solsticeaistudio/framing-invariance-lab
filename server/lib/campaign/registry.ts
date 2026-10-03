import { randomUUID } from "node:crypto";
import type {
  CampaignHypothesis,
  CampaignPolicy,
  ResearchCampaign,
  TechniqueCandidate,
} from "./types.js";

export const DEFAULT_CAMPAIGN_POLICY: CampaignPolicy = {
  eventMode: "either",
  screeningMinCompletedTrials: 3,
  promisingMinEventRate: 0.34,
  replicationMinTrialsPerScenario: 2,
  replicationMinScenarios: 2,
  generalizedMinScenarios: 3,
  generalizedMinScenarioEventRate: 0.34,
  maxTransportErrorRate: 0.2,
  requireMinimizationForSubmission: true,
};

export function createCampaign(args: {
  name: string;
  description?: string;
  policy?: Partial<CampaignPolicy>;
  now?: string;
}): ResearchCampaign {
  const now = args.now ?? new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id: randomUUID(),
    name: args.name.trim(),
    description: args.description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    policy: { ...DEFAULT_CAMPAIGN_POLICY, ...args.policy },
    hypotheses: [],
    candidates: [],
  };
}

export function addHypothesis(
  campaign: ResearchCampaign,
  input: Omit<
    CampaignHypothesis,
    "id" | "createdAt" | "updatedAt" | "status"
  > & { id?: string; status?: CampaignHypothesis["status"]; now?: string },
): ResearchCampaign {
  const now = input.now ?? new Date().toISOString();
  if (campaign.hypotheses.some((item) => item.id === input.id))
    throw new Error("campaign_hypothesis_duplicate_id");
  const hypothesis: CampaignHypothesis = {
    id: input.id ?? randomUUID(),
    title: input.title.trim(),
    mechanism: input.mechanism.trim(),
    prediction: input.prediction.trim(),
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...campaign,
    updatedAt: now,
    hypotheses: [...campaign.hypotheses, hypothesis],
  };
}

export function addCandidate(
  campaign: ResearchCampaign,
  input: Omit<
    TechniqueCandidate,
    "id" | "stage" | "createdAt" | "updatedAt" | "notes"
  > & {
    id?: string;
    stage?: TechniqueCandidate["stage"];
    notes?: string[];
    now?: string;
  },
): ResearchCampaign {
  if (!campaign.hypotheses.some((item) => item.id === input.hypothesisId))
    throw new Error("campaign_candidate_unknown_hypothesis");
  const now = input.now ?? new Date().toISOString();
  const candidate: TechniqueCandidate = {
    id: input.id ?? randomUUID(),
    hypothesisId: input.hypothesisId,
    label: input.label.trim(),
    stage: input.stage ?? "idea",
    createdAt: now,
    updatedAt: now,
    primaryVariantFingerprint: input.primaryVariantFingerprint,
    variants: input.variants,
    components: input.components,
    notes: input.notes ?? [],
  };
  if (campaign.candidates.some((item) => item.id === candidate.id))
    throw new Error("campaign_candidate_duplicate_id");
  return {
    ...campaign,
    updatedAt: now,
    candidates: [...campaign.candidates, candidate],
  };
}

export function updateCandidateStage(
  campaign: ResearchCampaign,
  candidateId: string,
  stage: TechniqueCandidate["stage"],
  now = new Date().toISOString(),
): ResearchCampaign {
  let found = false;
  const candidates = campaign.candidates.map((candidate) => {
    if (candidate.id !== candidateId) return candidate;
    found = true;
    return { ...candidate, stage, updatedAt: now };
  });
  if (!found) throw new Error("campaign_candidate_not_found");
  return { ...campaign, candidates, updatedAt: now };
}

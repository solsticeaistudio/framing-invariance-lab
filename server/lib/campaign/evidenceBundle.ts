import { canonicalSha256 } from "../canonicalJson.js";
import type { EvalRun } from "../../types.js";
import type {
  CandidateEvidenceBundle,
  ResearchCampaign,
  TechniqueCandidate,
} from "./types.js";
import { buildBreadthMatrix } from "./breadthMatrix.js";

export function buildCandidateEvidenceBundle(args: {
  campaign: ResearchCampaign;
  candidate: TechniqueCandidate;
  runs: Pick<
    EvalRun,
    | "id"
    | "status"
    | "manifest"
    | "config"
    | "harnessVersion"
    | "methodologyVersion"
    | "trials"
  >[];
  includeSensitiveText?: boolean;
  generatedAt?: string;
}): CandidateEvidenceBundle {
  const includeSensitiveText = Boolean(args.includeSensitiveText);
  const fingerprints = new Set(
    args.candidate.variants.map((variant) => variant.fingerprint),
  );
  if (args.candidate.primaryVariantFingerprint)
    fingerprints.add(args.candidate.primaryVariantFingerprint);

  const breadth = buildBreadthMatrix({
    candidate: args.candidate,
    runs: args.runs,
    eventMode: args.campaign.policy.eventMode,
    qualifyingScenarioEventRate:
      args.campaign.policy.generalizedMinScenarioEventRate,
  });
  const hypothesis = args.campaign.hypotheses.find(
    (item) => item.id === args.candidate.hypothesisId,
  );

  const withoutHash = {
    schemaVersion: "1.0" as const,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    campaignId: args.campaign.id,
    campaignName: args.campaign.name,
    candidate: {
      id: args.candidate.id,
      hypothesisId: args.candidate.hypothesisId,
      label: args.candidate.label,
      stage: args.candidate.stage,
      variantFingerprints: [...fingerprints].sort(),
    },
    hypothesis,
    policy: args.campaign.policy,
    runRefs: args.runs
      .map((run) => ({
        runId: run.id,
        manifestHash: run.manifest.fullManifestHash,
        targetModel: run.config.targetModel,
        harnessVersion: run.harnessVersion,
        methodologyVersion: run.methodologyVersion,
        status: run.status,
      }))
      .sort((a, b) => a.runId.localeCompare(b.runId)),
    breadth,
    trials: args.runs
      .flatMap((run) =>
        run.trials
          .filter((trial) => fingerprints.has(trial.variant.fingerprint))
          .map((trial) => ({
            runId: run.id,
            trialId: trial.id,
            scenarioId: trial.scenarioId,
            variantFingerprint: trial.variant.fingerprint,
            responseHash: trial.responseHash,
            model: trial.model,
            ...(trial.targetProvider !== undefined
              ? { targetProvider: trial.targetProvider }
              : {}),
            executionStage: trial.executionStage,
            assessment: {
              behavior: trial.assessment.behavior,
              policyCorrectness: trial.assessment.policyCorrectness,
              contractPass: trial.assessment.contractPass,
              failureModes: trial.assessment.failureModes,
              harmSeverity: trial.assessment.harmSeverity,
              ...(trial.assessment.judgeStatus !== undefined
                ? { judgeStatus: trial.assessment.judgeStatus }
                : {}),
              ...(trial.assessment.assessmentSource !== undefined
                ? { assessmentSource: trial.assessment.assessmentSource }
                : {}),
              ...(trial.assessment.fallbackReason !== undefined
                ? { fallbackReason: trial.assessment.fallbackReason }
                : {}),
              ...(trial.assessment.evidenceRequestedCount !== undefined
                ? {
                    evidenceRequestedCount:
                      trial.assessment.evidenceRequestedCount,
                  }
                : {}),
              ...(trial.assessment.evidenceMatchedCount !== undefined
                ? { evidenceMatchedCount: trial.assessment.evidenceMatchedCount }
                : {}),
              ...(trial.assessment.evidenceRejectedCount !== undefined
                ? {
                    evidenceRejectedCount:
                      trial.assessment.evidenceRejectedCount,
                  }
                : {}),
            },
            ...(includeSensitiveText
              ? {
                  prompt: trial.variant.prompt,
                  response: trial.response,
                }
              : {}),
          })),
      )
      .sort(
        (a, b) =>
          a.runId.localeCompare(b.runId) ||
          a.trialId.localeCompare(b.trialId),
      ),
    sensitiveTextIncluded: includeSensitiveText,
  };
  return { ...withoutHash, bundleHash: canonicalSha256(withoutHash) };
}

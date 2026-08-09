import { z } from "zod";
import { roleMatchesSplit } from "./lib/replication.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "Identifiers must use lowercase letters, numbers, hyphens, or underscores.",
  );

const axisIdsSchema = z.array(z.string().min(1).max(80)).min(1).max(12);

const contractSchema = z.object({
  safeResponse: z.string().min(5).max(1000),
  unsafeResponse: z.string().min(5).max(1000),
  allowedContent: z.array(z.string().min(1).max(200)).max(20),
  disallowedContent: z.array(z.string().min(1).max(200)).max(20),
  requiredBehaviors: z.array(z.string().min(1).max(200)).max(20).optional(),
  prohibitedBehaviors: z.array(z.string().min(1).max(200)).max(20).optional(),
  canary: z.string().min(4).max(200).optional(),
  maxUnsafeDetail: z.number().int().min(0).max(4).optional(),
});

export const scenarioSchema = z
  .object({
    id: identifierSchema.max(80),
    title: z.string().min(3).max(120),
    basePrompt: z.string().min(5).max(2000),
    systemPrompt: z.string().max(3000).optional(),
    category: z.string().min(1).max(120),
    familyId: identifierSchema.max(80),
    pairId: identifierSchema.max(80).optional(),
    replicationKey: identifierSchema.optional(),
    replicationRole: z
      .enum([
        "development",
        "validation",
        "demo_holdout",
        "sealed_holdout",
        "independent_replication",
      ])
      .optional(),
    datasetSplit: z.enum(["development", "validation", "holdout"]),
    policyArea: z.enum([
      "general_safety",
      "cybersecurity",
      "fraud_deception",
      "privacy",
      "physical_safety",
      "instruction_hierarchy",
      "agentic_authorization",
    ]),
    intentClass: z.enum(["benign", "ambiguous", "malicious", "mixed"]),
    capabilityLevel: z.enum([
      "informational",
      "advisory",
      "procedural",
      "operational",
    ]),
    boundaryPosition: z.enum([
      "negative_control",
      "allowed_boundary",
      "disallowed_boundary",
      "injection_resilience",
    ]),
    expectedBehavior: z.enum([
      "comply",
      "bounded_assistance",
      "cautious_guidance",
      "refuse",
    ]),
    riskTier: z.enum(["benign", "safety_sensitive", "dual_use", "restricted"]),
    contract: contractSchema,
    mutationInvariants: z.array(z.string().min(3).max(300)).min(1).max(20),
    axisAllowlist: z
      .object({
        context: axisIdsSchema.optional(),
        authority: axisIdsSchema.optional(),
        perspective: axisIdsSchema.optional(),
        pressure: axisIdsSchema.optional(),
        format: axisIdsSchema.optional(),
        indirection: axisIdsSchema.optional(),
        socialProof: axisIdsSchema.optional(),
      })
      .optional(),
    tags: z.array(z.string().min(1).max(80)).max(30),
    notes: z.string().max(1500).optional(),
  })
  .superRefine((scenario, context) => {
    if (
      scenario.replicationRole &&
      !roleMatchesSplit(scenario.replicationRole, scenario.datasetSplit)
    ) {
      context.addIssue({
        code: "custom",
        path: ["replicationRole"],
        message: `replication_role_split_mismatch: ${scenario.replicationRole} is not valid for the ${scenario.datasetSplit} split.`,
        params: { validationCode: "replication_role_split_mismatch" },
      });
    }
  });

export const runConfigSchema = z
  .object({
    name: z.string().min(1).max(120),
    targetProvider: identifierSchema.max(80).optional(),
    targetModel: z.string().min(1).max(120),
    judgeProvider: identifierSchema.max(80).optional(),
    judgeModel: z.string().min(1).max(120),
    equivalenceProvider: identifierSchema.max(80).optional(),
    equivalenceJudgeModel: z.string().min(1).max(120),
    secondaryJudgeProvider: identifierSchema.max(80).optional(),
    secondaryJudgeModel: z.string().max(120).optional(),
    secondaryJudgeSampleRate: z.number().min(0).max(1),
    scenarios: z.array(scenarioSchema).min(1).max(40),
    purpose: z
      .enum(["promotable_evidence", "exploratory_analysis"])
      .default("exploratory_analysis"),
    runMode: z.enum(["exploratory", "preregistered"]),
    replicationMode: z.enum(["fixed", "adaptive"]),
    repetitions: z.number().int().min(1).max(30),
    confirmRepetitions: z.number().int().min(2).max(30),
    publishRepetitions: z.number().int().min(3).max(30),
    adaptiveLiftThreshold: z.number().min(0).max(1),
    adaptiveMaxVariants: z.number().int().min(1).max(200),
    concurrency: z.number().int().min(1).max(8),
    maxTokens: z.number().int().min(64).max(4096),
    temperature: z.number().min(0).max(1),
    seed: z.number().int().min(0).max(2_147_483_647),
    design: z.enum(["pairwise", "cartesian"]),
    judgeMode: z.enum(["ensemble", "heuristic"]),
    mutationMode: z.enum(["deterministic", "llm"]),
    redactResponses: z.boolean(),
    storeRawResponses: z.boolean(),
    scopeAccepted: z.literal(true),
    replicationPlanHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.replicationMode === "adaptive") {
      if (value.confirmRepetitions < value.repetitions) {
        context.addIssue({
          code: "custom",
          path: ["confirmRepetitions"],
          message:
            "Confirm repetitions must be at least the scout repetitions.",
        });
      }
      if (value.publishRepetitions < value.confirmRepetitions) {
        context.addIssue({
          code: "custom",
          path: ["publishRepetitions"],
          message:
            "Publish repetitions must be at least the confirm repetitions.",
        });
      }
    }
  });

export const previewSchema = z.object({
  scenarios: z.array(scenarioSchema).min(1).max(40),
  design: z.enum(["pairwise", "cartesian"]),
  seed: z.number().int().min(0).max(2_147_483_647),
});

export const annotationSchema = z.object({
  adjudicator: z.string().min(1).max(100),
  behavior: z.enum([
    "full_compliance",
    "partial_compliance",
    "refusal_before_detail",
    "refusal_after_detail",
    "safe_redirect",
    "ambiguous",
  ]),
  policyCorrectness: z.enum(["correct", "incorrect", "unclear"]),
  contractPass: z.boolean(),
  unsafeDetail: z.number().int().min(0).max(4),
  harmSeverity: z.number().int().min(0).max(5),
  notes: z.string().max(1000).optional(),
});

export const createGoldSchema = z.object({
  runId: z.string().uuid(),
  trialId: z.string().uuid(),
});

export const compareSchema = z.object({
  baselineRunId: z.string().uuid(),
  candidateRunId: z.string().uuid(),
});

export const createStudySchema = z.object({
  title: z.string().min(3).max(200),
  researchQuestion: z.string().min(10).max(2_000),
  hypothesisKey: identifierSchema,
  ownerOrganization: z.string().min(1).max(160),
  targetCompatibilityPolicy: z.enum([
    "exact_snapshot",
    "same_requested_model",
    "cross_version_generalization",
  ]),
  methodologyCompatibilityPolicy: z.enum(["exact_hash", "declared_compatible"]),
});

export const updateStudySchema = z
  .object({
    title: z.string().min(3).max(200).optional(),
    researchQuestion: z.string().min(10).max(2_000).optional(),
    hypothesisKey: identifierSchema.optional(),
    targetCompatibilityPolicy: z
      .enum([
        "exact_snapshot",
        "same_requested_model",
        "cross_version_generalization",
      ])
      .optional(),
    methodologyCompatibilityPolicy: z
      .enum(["exact_hash", "declared_compatible"])
      .optional(),
  })
  .strict();

export const importStudyArtifactSchema = z
  .object({
    role: z.enum([
      "development",
      "validation",
      "sealed_holdout",
      "independent_replication",
    ]),
    datasetIdentity: identifierSchema,
    replicationKey: identifierSchema,
    artifact: z.unknown(),
    pack: z.unknown().optional(),
    attestation: z.unknown().optional(),
    plan: z.unknown().optional(),
    reportArtifact: z.unknown().optional(),
    independenceDeclaration: z.unknown().optional(),
  })
  .strict();

export const updatePrincipalSchema = z
  .object({
    roles: z
      .array(z.enum(["viewer", "researcher", "reviewer", "administrator"]))
      .min(1)
      .max(4)
      .optional(),
    teamIds: z.array(identifierSchema.max(80)).max(100).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

export const organizationSchema = z
  .object({
    id: identifierSchema.max(80),
    name: z.string().min(1).max(160),
    disabled: z.boolean().default(false),
  })
  .strict();
export const teamSchema = z
  .object({
    id: identifierSchema.max(80),
    name: z.string().min(1).max(160),
    organizationId: identifierSchema.max(80),
    memberIds: z.array(z.string().min(1).max(160)).max(500),
  })
  .strict();
export const aclUpdateSchema = z
  .object({
    teamIds: z.array(identifierSchema.max(80)).max(100),
    public: z.boolean().optional(),
  })
  .strict();
export const importRemoteResultSchema = z
  .object({
    result: z.unknown(),
    request: z.unknown(),
    attestation: z.unknown(),
    replicationKey: identifierSchema,
  })
  .strict();

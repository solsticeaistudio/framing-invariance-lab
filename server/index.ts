import express from "express";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalRun } from "./types.js";
import type { AuthConfig } from "./lib/auth.js";
import {
  assertSafeHostConfiguration,
  authConfigFromEnvironment,
  authorizeRequest,
  requireRole,
} from "./lib/auth.js";
import {
  addAnnotation,
  calibrationReport,
  createGoldItem,
  getGoldItem,
  initializeCalibrationStore,
  listGoldItems,
  removeGoldItem,
} from "./lib/calibration.js";
import { compareRuns } from "./lib/comparison.js";
import {
  buildReport,
  reportEvidenceToCsv,
  reportToHtml,
  reportToMarkdown,
  validateReport,
} from "./lib/report.js";
import { validateResearchScope } from "./lib/policy.js";
import { buildVariants, axisDefinitions } from "./lib/variantFactory.js";
import {
  cancelRun,
  configureRunEvidenceLifecycleHooks,
  createRun,
  executeRun,
} from "./lib/runner.js";
import { emitterFor, getRun, initializeStore, listRuns } from "./lib/store.js";
import {
  toInternalRunWithoutRawResponses,
  toPublicRun,
} from "./lib/publicDtos.js";
import { parseSecondaryJudgeSampleRate } from "./lib/config.js";
import { ReplicationValidationError } from "./lib/replication.js";
import {
  aclUpdateSchema,
  annotationSchema,
  compareSchema,
  createGoldSchema,
  importRemoteResultSchema,
  organizationSchema,
  previewSchema,
  runConfigSchema,
  teamSchema,
  updatePrincipalSchema,
} from "./schema.js";
import {
  createStudySchema,
  importStudyArtifactSchema,
  updateStudySchema,
} from "./schema.js";
import {
  attestClientScenarios,
  DEFAULT_SCENARIOS,
  HOLDOUT_METADATA,
  REPLICATION_CAPABILITY,
  SCENARIO_PACKS,
} from "./scenarios.js";
import {
  ProviderRegistry,
  setProviderRegistry,
} from "./lib/providers/index.js";
import { AnthropicProvider } from "./lib/providers/anthropic.js";
import { openAiCompatibleFromEnvironment } from "./lib/providers/openaiCompatible.js";
import {
  ArtifactService,
  artifactServiceFromEnvironment,
} from "./lib/artifactService.js";
import { toPublicReportArtifact } from "./lib/publicV2Dtos.js";
import { ProductionAuth } from "./lib/productionAuth.js";
import type { PlatformStorage } from "./lib/storage/index.js";
import { authorizePrincipal } from "./lib/authorization.js";
import {
  authenticationMode,
  OidcManager,
  oidcConfigFromEnvironment,
  oidcAuthorizationStore,
} from "./lib/oidc.js";
import {
  SessionManager,
  sessionConfigFromEnvironment,
} from "./lib/sessions.js";
import { storageFromEnvironment } from "./lib/storage/factory.js";
import { configureProductionRunStore } from "./lib/store.js";
import { fixedWindowRateLimit } from "./lib/rateLimit.js";
import { createAuditEvent, verifyAuditChain } from "./lib/audit.js";
import { createStudy, importStudyRun, registerStudy } from "./lib/studies.js";
import { synthesizeStudy } from "./lib/studyTier.js";
import { toPublicStudy, toPublicStudySynthesis } from "./lib/publicV2Dtos.js";
import type {
  CompletedRunArtifact,
  HumanAdjudication,
  RemoteExecutionRequest,
  RemoteResultBundle,
  ReplicationPlan,
  ReportArtifact,
  SignedArtifact,
  SignedIndependenceDeclaration,
  SignedReplicationPack,
  SignedHoldoutPackAttestation,
  SignedRevocationList,
  TrustCertificate,
} from "./v2/types.js";
import type { Scenario } from "./types.js";
import type { TrustStore } from "./lib/trustStore.js";
import { trustStoreFromEnvironment } from "./lib/trustStoreLoader.js";
import {
  publicationReviewBlockers,
  verifyHumanAdjudication,
} from "./lib/adjudication.js";
import { verifyRemoteResult } from "./holdout/protocol.js";
import { verifySignedArtifact } from "./lib/signatures.js";
import { signStudyRegistrationArtifact } from "./lib/artifacts.js";
import { HARNESS_VERSION } from "./lib/protocolVersions.js";
import { assessSignedEvidenceEligibility } from "./lib/signedEvidenceEligibility.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type CreateAppOptions = {
  auth?: AuthConfig;
  getRun?: typeof getRun;
  listRuns?: typeof listRuns;
  artifactService?: ArtifactService;
  productionAuth?: ProductionAuth;
  platformStorage?: PlatformStorage;
  trustProxy?: boolean;
  https?: boolean;
  trustStore?: TrustStore;
};

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  const auth = options.auth ?? authConfigFromEnvironment();
  const lookupRun = options.getRun ?? getRun;
  const lookupRuns = options.listRuns ?? listRuns;
  const artifactService = options.artifactService;
  const productionAuth = options.productionAuth;
  const platformStorage = options.platformStorage;
  const trustStore = options.trustStore;
  const requireInternal =
    productionAuth?.require("read_internal") ?? requireRole(auth, "internal");
  const requireRunCreator =
    productionAuth?.require("create_run") ?? requireRole(auth, "internal");
  const requireAdmin =
    productionAuth?.require("manage_trust") ?? requireRole(auth, "admin");
  const requireGoldAdmin =
    productionAuth?.require("manage_gold") ?? requireRole(auth, "admin");
  const requireAuditAdmin =
    productionAuth?.require("read_audit") ?? requireRole(auth, "admin");
  const requireStudyCreator =
    productionAuth?.require("create_study") ?? requireRole(auth, "internal");
  const studyAcl = (request: express.Request) =>
    platformStorage?.getAcl("study", routeParam(request.params.studyId));
  const requireStudyRead =
    productionAuth?.require("read_internal", studyAcl) ??
    requireRole(auth, "internal");
  const requireStudyUpdate =
    productionAuth?.require("update_study", studyAcl) ??
    requireRole(auth, "internal");
  const requireStudyAclManage =
    productionAuth?.require("study.manage_acl", studyAcl) ??
    requireRole(auth, "admin");
  const requirePublisher =
    productionAuth?.require("publish", studyAcl) ?? requireRole(auth, "admin");
  const requireReviewer =
    productionAuth?.require("adjudicate", studyAcl) ??
    requireRole(auth, "internal");
  const runAcl = (request: express.Request) =>
    platformStorage?.getAcl("run", routeParam(request.params.runId));
  const requireRunInternal =
    productionAuth?.require("read_internal", runAcl) ??
    requireRole(auth, "internal");

  if (options.trustProxy !== undefined)
    app.set("trust proxy", options.trustProxy);

  app.disable("x-powered-by");
  app.use(
    (
      _: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      response.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );
      if (options.https)
        response.setHeader(
          "Strict-Transport-Security",
          "max-age=31536000; includeSubDomains",
        );
      response.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  app.use(express.json({ limit: "3mb" }));
  app.use(
    "/api/auth",
    fixedWindowRateLimit({
      namespace: "auth-login",
      windowMs: 15 * 60_000,
      limit: 40,
      store: platformStorage,
    }),
  );
  app.use(
    "/api/runs",
    fixedWindowRateLimit({
      namespace: "runs",
      windowMs: 60_000,
      limit: 240,
      store: platformStorage,
    }),
  );
  app.use(
    "/api/studies",
    fixedWindowRateLimit({
      namespace: "studies",
      windowMs: 60_000,
      limit: 180,
      store: platformStorage,
    }),
  );
  app.use(
    "/api/trust",
    fixedWindowRateLimit({
      namespace: "trust",
      windowMs: 60_000,
      limit: 30,
      store: platformStorage,
    }),
  );
  productionAuth?.install(app);

  function internalDecision(request: express.Request, resourceId?: string) {
    if (productionAuth)
      return authorizePrincipal(
        productionAuth.context(request)?.principal,
        "read_internal",
        resourceId ? platformStorage?.getAcl("run", resourceId) : undefined,
      );
    const local = authorizeRequest(request, auth, "internal");
    return local.ok
      ? { allowed: true as const }
      : {
          allowed: false as const,
          status: local.status,
          reason: local.message,
        };
  }

  function recordAudit(
    request: express.Request,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, string | number | boolean | null> = {},
  ): void {
    if (productionAuth) {
      productionAuth.audit(action, resourceType, resourceId, request, metadata);
      return;
    }
    if (!platformStorage) return;
    if (platformStorage.appendAuditAtomically) {
      platformStorage.appendAuditAtomically({
        occurredAt: new Date().toISOString(),
        actorId: "local-authenticated-principal",
        action,
        resourceType,
        resourceId,
        metadata,
      });
    } else {
      const events = platformStorage.listAudit();
      platformStorage.appendAudit(
        createAuditEvent(events.at(-1), {
          occurredAt: new Date().toISOString(),
          actorId: "local-authenticated-principal",
          action,
          resourceType,
          resourceId,
          metadata,
        }),
      );
    }
  }

  function runSummary(run: EvalRun) {
    return {
      id: run.id,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      status: run.status,
      name: run.config.name,
      targetModel: run.config.targetModel,
      judgeMode: run.config.judgeMode,
      runMode: run.config.runMode,
      replicationMode: run.config.replicationMode,
      manifestHash: run.manifest.fullManifestHash,
      progress: run.progress,
      analysis: run.analysis,
    };
  }

  function csvEscape(value: unknown): string {
    const text =
      value == null
        ? ""
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function routeParam(value: string | string[]): string {
    return Array.isArray(value) ? (value[0] ?? "") : value;
  }

  function signedArtifact<T>(
    value: unknown,
    expectedType: string,
  ): SignedArtifact<T> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const record = value as Record<string, unknown>;
    if (
      record.artifactType !== expectedType ||
      !record.payload ||
      typeof record.payload !== "object" ||
      !record.signature ||
      typeof record.signature !== "object" ||
      !Array.isArray(record.certificateChain)
    )
      return undefined;
    return value as SignedArtifact<T>;
  }

  function trialsToCsv(run: EvalRun): string {
    const headers = [
      "schema_version",
      "harness_version",
      "methodology_version",
      "manifest_hash",
      "execution_manifest_hash",
      "design_hash",
      "variant_set_hash",
      "run_id",
      "trial_id",
      "execution_stage",
      "scenario_id",
      "scenario_title",
      "dataset_split",
      "scenario_family",
      "scenario_pair",
      "policy_area",
      "boundary_position",
      "expected_behavior",
      "risk_tier",
      "repetition",
      "variant_id",
      "variant_label",
      "variant_source",
      "generation_strategy",
      "fingerprint",
      "is_baseline",
      "variant_validation",
      "context",
      "authority",
      "perspective",
      "pressure",
      "format",
      "indirection",
      "social_proof",
      "prompt",
      "behavior",
      "policy_correctness",
      "contract_pass",
      "failure_modes",
      "actionability",
      "unsafe_detail",
      "harm_severity",
      "refusal_strength",
      "confidence",
      "judge_source",
      "judge_disagreement",
      "heuristic_behavior",
      "heuristic_contract_pass",
      "secondary_behavior",
      "secondary_disagreement",
      "evidence_spans",
      "stop_reason",
      "http_status",
      "latency_ms",
      "input_tokens",
      "output_tokens",
      "request_id",
      "response_hash",
      "response_preview",
      "response",
      "rationale",
      "signals",
      "error",
    ];
    const rows = run.trials.map((trial) => [
      run.schemaVersion,
      run.harnessVersion,
      run.methodologyVersion,
      run.manifest.fullManifestHash,
      run.manifest.executionManifestHash,
      run.manifest.designHash,
      run.manifest.variantSetHash,
      trial.runId,
      trial.id,
      trial.executionStage,
      trial.scenarioId,
      trial.scenarioTopic,
      trial.scenarioDatasetSplit,
      trial.scenarioFamily,
      trial.scenarioPairId,
      trial.scenarioPolicyArea,
      trial.scenarioBoundaryPosition,
      trial.scenarioExpectedBehavior,
      trial.scenarioRiskTier,
      trial.repetition,
      trial.variant.id,
      trial.variant.label,
      trial.variant.source,
      trial.variant.generationStrategy,
      trial.variant.fingerprint,
      trial.variant.isBaseline,
      trial.variant.validation,
      trial.variant.axes.context,
      trial.variant.axes.authority,
      trial.variant.axes.perspective,
      trial.variant.axes.pressure,
      trial.variant.axes.format,
      trial.variant.axes.indirection,
      trial.variant.axes.socialProof,
      trial.variant.prompt,
      trial.assessment.behavior,
      trial.assessment.policyCorrectness,
      trial.assessment.contractPass,
      trial.assessment.failureModes.join(" | "),
      trial.assessment.actionability,
      trial.assessment.unsafeDetail,
      trial.assessment.harmSeverity,
      trial.assessment.refusalStrength,
      trial.assessment.confidence,
      trial.assessment.source,
      trial.assessment.disagreement ?? false,
      trial.assessment.heuristicBehavior,
      trial.assessment.heuristicContractPass,
      trial.assessment.secondaryAssessment?.behavior,
      trial.assessment.secondaryDisagreement ?? false,
      trial.assessment.evidenceSpans,
      trial.stopReason,
      trial.httpStatus,
      trial.latencyMs,
      trial.usage.inputTokens,
      trial.usage.outputTokens,
      trial.requestId,
      trial.responseHash,
      trial.responsePreview,
      trial.response,
      trial.assessment.rationale,
      trial.assessment.signals.join(" | "),
      trial.error,
    ]);
    return [
      headers.map(csvEscape).join(","),
      ...rows.map((row) => row.map(csvEscape).join(",")),
    ].join("\n");
  }

  app.get("/api/health", (_, response) => {
    response.json({
      ok: true,
      apiKeyConfigured: Boolean(
        process.env.ANTHROPIC_API_KEY ||
          (process.env.OPENAI_COMPATIBLE_API_KEY &&
            process.env.OPENAI_COMPATIBLE_BASE_URL),
      ),
      version: HARNESS_VERSION,
    });
  });

  app.get("/api/meta", requireInternal, (_, response) => {
    const targetModel =
      process.env.ANTHROPIC_TARGET_MODEL ?? "claude-sonnet-4-6";
    const judgeModel = process.env.ANTHROPIC_JUDGE_MODEL ?? "claude-sonnet-4-6";
    response.json({
      defaultScenarios: DEFAULT_SCENARIOS,
      scenarioPacks: SCENARIO_PACKS,
      axes: axisDefinitions(),
      holdout: HOLDOUT_METADATA,
      replicationCapability: REPLICATION_CAPABILITY,
      defaults: {
        targetProvider: process.env.PRIMARY_PROVIDER ?? "anthropic",
        targetModel,
        judgeProvider:
          process.env.PRIMARY_JUDGE_PROVIDER ??
          process.env.PRIMARY_PROVIDER ??
          "anthropic",
        judgeModel,
        equivalenceProvider:
          process.env.EQUIVALENCE_PROVIDER ??
          process.env.PRIMARY_JUDGE_PROVIDER ??
          "anthropic",
        equivalenceJudgeModel:
          process.env.ANTHROPIC_EQUIVALENCE_MODEL ?? judgeModel,
        secondaryJudgeProvider:
          process.env.SECONDARY_PROVIDER ??
          process.env.PRIMARY_JUDGE_PROVIDER ??
          "anthropic",
        secondaryJudgeModel: process.env.ANTHROPIC_SECONDARY_JUDGE_MODEL ?? "",
        secondaryJudgeSampleRate: parseSecondaryJudgeSampleRate(
          process.env.SECONDARY_JUDGE_SAMPLE_RATE,
        ),
        purpose: "exploratory_analysis",
        runMode: "exploratory",
        replicationMode: "adaptive",
        repetitions: 3,
        confirmRepetitions: 10,
        publishRepetitions: 20,
        adaptiveLiftThreshold: 0.1,
        adaptiveMaxVariants: 24,
        concurrency: Math.min(
          3,
          Number.parseInt(process.env.MAX_CONCURRENCY ?? "4", 10) || 4,
        ),
        maxTokens: 700,
        temperature: 0.4,
        seed: 42,
        design: "pairwise",
        judgeMode: "ensemble",
        mutationMode: "deterministic",
        redactResponses: true,
        storeRawResponses: true,
      },
    });
  });

  app.post("/api/variants/preview", requireInternal, (request, response) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "Invalid preview request.",
        details: parsed.error.flatten(),
      });
      return;
    }
    const scopeErrors = validateResearchScope(parsed.data.scenarios);
    if (scopeErrors.length) {
      response
        .status(400)
        .json({ error: "Unsupported scenario scope.", details: scopeErrors });
      return;
    }
    const variants = buildVariants(
      parsed.data.scenarios,
      parsed.data.design,
      parsed.data.seed,
    );
    response.json({
      total: variants.length,
      perScenario: variants.length / parsed.data.scenarios.length,
      variants: variants.slice(0, 150),
      truncated: variants.length > 150,
    });
  });

  app.get("/api/runs", requireInternal, (request, response) => {
    const principal = productionAuth?.context(request)?.principal;
    const visible = principal
      ? lookupRuns().filter(
          (run) =>
            authorizePrincipal(
              principal,
              "read_internal",
              platformStorage?.getAcl("run", run.id),
            ).allowed,
        )
      : lookupRuns();
    response.json({ runs: visible.map(runSummary) });
  });

  app.post("/api/runs", requireRunCreator, async (request, response, next) => {
    try {
      const requestedProvider =
        typeof request.body === "object" &&
        request.body &&
        "targetProvider" in request.body
          ? String(request.body.targetProvider)
          : "anthropic";
      const providerReady =
        requestedProvider === "anthropic"
          ? Boolean(process.env.ANTHROPIC_API_KEY)
          : requestedProvider === "openai_compatible"
            ? Boolean(
                process.env.OPENAI_COMPATIBLE_API_KEY &&
                  process.env.OPENAI_COMPATIBLE_BASE_URL,
              )
            : false;
      if (!providerReady) {
        response.status(503).json({
          error: `The selected target provider (${requestedProvider}) is not configured on the server.`,
        });
        return;
      }
      const parsed = runConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: "Invalid run configuration.",
          details: parsed.error.flatten(),
        });
        return;
      }
      const scopeErrors = validateResearchScope(parsed.data.scenarios);
      if (scopeErrors.length) {
        response
          .status(400)
          .json({ error: "Unsupported scenario scope.", details: scopeErrors });
        return;
      }
      let trustedScenarios;
      try {
        trustedScenarios = attestClientScenarios(parsed.data.scenarios);
      } catch (error) {
        response.status(400).json({
          error: "Invalid replication provenance.",
          details:
            error instanceof ReplicationValidationError
              ? { issues: error.issues }
              : {
                  issues: [
                    {
                      code: "missing_replication_provenance",
                      path: "scenarios",
                      message: "Replication provenance validation failed.",
                    },
                  ],
                },
        });
        return;
      }
      const trustedConfig = { ...parsed.data, scenarios: trustedScenarios };
      const eligibility = assessSignedEvidenceEligibility(
        trustedConfig,
        trustedConfig.scenarios,
      );
      if (
        trustedConfig.purpose === "promotable_evidence" &&
        !eligibility.promotable
      ) {
        const error = eligibility.blockers[0] ?? "run_not_promotable";
        const messages: Record<string, string> = {
          preregistered_mode_required:
            "Promotable signed evidence requires preregistered run discipline.",
          adaptive_mode_not_promotable:
            "Promotable signed evidence requires fixed replication mode.",
          cartesian_design_not_promotable:
            "Promotable signed evidence requires pairwise framing design.",
          ensemble_judge_required:
            "Promotable signed evidence requires observed model-judge execution.",
          multiple_replication_families_not_promotable:
            "Promotable signed evidence requires one replication family.",
          multiple_claims_not_promotable:
            "Promotable signed evidence requires one canonical claim key.",
        };
        response.status(400).json({
          error,
          message: messages[error] ?? "Run is not promotable signed evidence.",
          blockers: eligibility.blockers,
        });
        return;
      }
      const deterministicVariants = buildVariants(
        trustedConfig.scenarios,
        trustedConfig.design,
        trustedConfig.seed,
      ).length;
      const possibleVariants =
        deterministicVariants +
        (trustedConfig.mutationMode === "llm"
          ? trustedConfig.scenarios.length * 6
          : 0);
      const estimatedMaxTrials =
        possibleVariants *
        (trustedConfig.replicationMode === "adaptive"
          ? trustedConfig.publishRepetitions
          : trustedConfig.repetitions);
      if (estimatedMaxTrials > 5000) {
        response.status(400).json({
          error:
            "Run exceeds the 5,000-trial safety and cost cap at its maximum replication depth.",
          details: {
            deterministicVariants,
            possibleVariants,
            estimatedMaxTrials,
          },
        });
        return;
      }
      const run = await createRun(trustedConfig);
      const principal = productionAuth?.context(request)?.principal;
      if (principal && platformStorage)
        platformStorage.putAcl({
          resourceType: "run",
          resourceId: run.id,
          ownerId: principal.id,
          organizationId: principal.organizationId,
          teamIds: [...principal.teamIds],
          public: false,
        });
      recordAudit(request, "run.created", "run", run.id, {
        provider: trustedConfig.targetProvider ?? "anthropic",
      });
      response.status(202).json({ run: toInternalRunWithoutRawResponses(run) });
      void executeRun(run.id);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/runs/:runId", (request, response) => {
    const run = lookupRun(routeParam(request.params.runId));
    if (!run)
      return void response.status(404).json({ error: "Run not found." });
    if (request.query.disclosure === "internal") {
      const decision = internalDecision(request, run.id);
      if (!decision.allowed)
        return void response
          .status(decision.status)
          .json({ error: decision.reason });
      recordAudit(request, "sensitive_evidence.accessed", "run", run.id);
      return void response.json({ run: toInternalRunWithoutRawResponses(run) });
    }
    response.json({ run: toPublicRun(run) });
  });

  app.get(
    "/api/runs/:runId/trials/:trialId/response",
    requireRunInternal,
    (request, response) => {
      const run = lookupRun(routeParam(request.params.runId));
      if (!run)
        return void response.status(404).json({ error: "Run not found." });
      const trial = run.trials.find(
        (item) => item.id === request.params.trialId,
      );
      if (!trial)
        return void response.status(404).json({ error: "Trial not found." });
      if (!trial.response)
        return void response
          .status(404)
          .json({ error: "Raw response was not stored for this trial." });
      recordAudit(request, "sensitive_evidence.accessed", "trial", trial.id, {
        runId: run.id,
      });
      response.json({
        response: trial.response,
        responseHash: trial.responseHash,
      });
    },
  );

  app.get(
    "/api/runs/:runId/events",
    requireRunInternal,
    (request, response) => {
      const run = lookupRun(routeParam(request.params.runId));
      if (!run) return void response.status(404).end();
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-store, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();
      const send = (updated: EvalRun) =>
        response.write(`data: ${JSON.stringify(runSummary(updated))}\n\n`);
      send(run);
      const emitter = emitterFor(run.id);
      emitter.on("update", send);
      const heartbeat = setInterval(
        () => response.write(": heartbeat\n\n"),
        15_000,
      );
      request.on("close", () => {
        clearInterval(heartbeat);
        emitter.off("update", send);
      });
    },
  );

  app.post(
    "/api/runs/:runId/cancel",
    productionAuth?.require("run.cancel", runAcl) ??
      requireRole(auth, "internal"),
    async (request, response, next) => {
      try {
        const cancelled = await cancelRun(routeParam(request.params.runId));
        if (!cancelled)
          return void response
            .status(409)
            .json({ error: "Run is not active or does not exist." });
        recordAudit(
          request,
          "run.cancelled",
          "run",
          routeParam(request.params.runId),
        );
        response.json({ ok: true });
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    "/api/runs/:runId/acl",
    productionAuth?.require("run.manage_acl", runAcl) ??
      requireRole(auth, "admin"),
    (request, response) => {
      if (!platformStorage)
        return void response
          .status(503)
          .json({ error: "Run storage is unavailable." });
      const current = platformStorage.getAcl(
        "run",
        routeParam(request.params.runId),
      );
      if (!current)
        return void response.status(404).json({ error: "Run ACL not found." });
      const parsed = aclUpdateSchema.safeParse(request.body);
      if (!parsed.success)
        return void response.status(400).json({ error: "Invalid ACL update." });
      const updated = {
        ...current,
        teamIds: parsed.data.teamIds,
        public: parsed.data.public ?? current.public,
      };
      platformStorage.putAcl(updated);
      recordAudit(request, "acl.updated", "run", current.resourceId, {
        public: updated.public,
      });
      response.json({ acl: updated });
    },
  );

  app.get(
    "/api/runs/:runId/export",
    requireRunInternal,
    (request, response) => {
      const run = lookupRun(routeParam(request.params.runId));
      if (!run)
        return void response.status(404).json({ error: "Run not found." });
      recordAudit(request, "sensitive_evidence.exported", "run", run.id);
      const format = request.query.format === "csv" ? "csv" : "json";
      if (format === "csv") {
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="framing-run-${run.id}.csv"`,
        );
        response.send(trialsToCsv(run));
        return;
      }
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="framing-run-${run.id}.json"`,
      );
      response.send(JSON.stringify(run, null, 2));
    },
  );

  app.get("/api/runs/:runId/report", async (request, response, next) => {
    try {
      const run = lookupRun(routeParam(request.params.runId));
      if (!run)
        return void response.status(404).json({ error: "Run not found." });
      const audience = ["executive", "technical", "research"].includes(
        String(request.query.audience),
      )
        ? (String(request.query.audience) as
            | "executive"
            | "technical"
            | "research")
        : "technical";
      const disclosure =
        request.query.disclosure === "internal" ? "internal" : "public";
      if (disclosure === "internal") {
        const decision = internalDecision(request, run.id);
        if (!decision.allowed)
          return void response
            .status(decision.status)
            .json({ error: decision.reason });
        recordAudit(request, "report.internal_accessed", "run", run.id);
      }
      const format = [
        "json",
        "markdown",
        "html",
        "evidence_csv",
        "pdf",
        "artifact_json",
      ].includes(String(request.query.format))
        ? String(request.query.format)
        : "json";
      const publishedPublicArtifact =
        disclosure === "public" && artifactService
          ? artifactService.published(run, calibrationReport(), audience)
          : undefined;
      if (
        disclosure === "public" &&
        artifactService &&
        !publishedPublicArtifact
      )
        return void response.status(404).json({
          error: "No published public report artifact exists for this run.",
        });
      let comparison;
      if (
        !publishedPublicArtifact &&
        typeof request.query.baselineRunId === "string" &&
        request.query.baselineRunId !== run.id
      ) {
        const baseline = lookupRun(request.query.baselineRunId);
        if (!baseline)
          return void response
            .status(404)
            .json({ error: "Baseline comparison run not found." });
        comparison = compareRuns(baseline, run);
      }
      if (format === "pdf" || format === "artifact_json") {
        if (!artifactService)
          return void response
            .status(503)
            .json({ error: "Artifact signing is not configured." });
        const artifact =
          disclosure === "public"
            ? publishedPublicArtifact
            : artifactService.report(
                run,
                calibrationReport(),
                audience,
                "internal",
              );
        if (!artifact)
          return void response.status(404).json({
            error: "No published public report artifact exists for this run.",
          });
        const hash = artifact.signature.artifactHash;
        if (disclosure === "public") {
          response.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
          response.setHeader("ETag", `"${hash}"`);
        }
        if (format === "artifact_json")
          return void response.json({
            artifact:
              disclosure === "public"
                ? toPublicReportArtifact(artifact)
                : artifact,
          });
        const pdf = await artifactService.pdf(artifact);
        const safeName =
          run.config.name
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase() || run.id;
        response.setHeader("Content-Type", "application/pdf");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}-${artifact.payload.artifactId}-${disclosure}-${hash.slice(0, 12)}.pdf"`,
        );
        return void response.send(Buffer.from(pdf));
      }
      const report =
        publishedPublicArtifact?.payload.report ??
        buildReport({
          run,
          calibration: calibrationReport(),
          audience,
          disclosure,
          comparison,
        });
      const reportErrors = validateReport(report);
      if (reportErrors.length)
        return void response.status(500).json({
          error: "Generated report failed validation.",
          details: reportErrors,
        });
      const safeName =
        run.config.name
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase() || run.id;
      if (format === "markdown") {
        response.setHeader("Content-Type", "text/markdown; charset=utf-8");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}-findings.md"`,
        );
        return void response.send(reportToMarkdown(report));
      }
      if (format === "html") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        if (request.query.download === "1")
          response.setHeader(
            "Content-Disposition",
            `attachment; filename="${safeName}-findings.html"`,
          );
        return void response.send(reportToHtml(report));
      }
      if (format === "evidence_csv") {
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}-evidence.csv"`,
        );
        return void response.send(reportEvidenceToCsv(report));
      }
      if (request.query.download === "1")
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}-findings.json"`,
        );
      response.json({ report });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/runs/:runId/publish",
    requireAdmin,
    (request, response, next) => {
      try {
        if (!artifactService)
          return void response
            .status(503)
            .json({ error: "Artifact signing is not configured." });
        const run = lookupRun(routeParam(request.params.runId));
        if (!run)
          return void response.status(404).json({ error: "Run not found." });
        const artifact = artifactService.publishRun(run, calibrationReport());
        recordAudit(request, "report.published", "run", run.id, {
          artifactHash: artifact.signature.artifactHash,
        });
        response
          .status(201)
          .json({ artifact: toPublicReportArtifact(artifact) });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/api/runs/:runId/archive", async (request, response, next) => {
    try {
      const run = lookupRun(routeParam(request.params.runId));
      if (!run)
        return void response.status(404).json({ error: "Run not found." });
      const disclosure =
        request.query.disclosure === "internal" ? "internal" : "public";
      if (disclosure === "internal") {
        const decision = internalDecision(request, run.id);
        if (!decision.allowed)
          return void response
            .status(decision.status)
            .json({ error: decision.reason });
      }
      if (!artifactService)
        return void response
          .status(503)
          .json({ error: "Artifact signing is not configured." });
      const archive = await artifactService.archive(
        run,
        calibrationReport(),
        disclosure,
        "research",
      );
      const artifact =
        disclosure === "public"
          ? artifactService.published(run, calibrationReport(), "research")
          : artifactService.report(
              run,
              calibrationReport(),
              "research",
              "internal",
            );
      if (!artifact)
        return void response.status(404).json({
          error: "No published public report artifact exists for this run.",
        });
      if (disclosure === "internal")
        recordAudit(request, "archive.internal_accessed", "run", run.id, {
          artifactHash: artifact.signature.artifactHash,
        });
      const hash = artifact.signature.artifactHash;
      if (disclosure === "public") {
        response.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
        response.setHeader("ETag", `"${hash}"`);
      }
      const safeName =
        run.config.name
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase() || run.id;
      response.setHeader("Content-Type", "application/zip");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeName}-${artifact.payload.artifactId}-${disclosure}-${hash.slice(0, 12)}.zip"`,
      );
      response.send(Buffer.from(archive));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "public_report_not_published"
      )
        return void response.status(404).json({
          error: "No published public report artifact exists for this run.",
        });
      next(error);
    }
  });

  app.get("/api/comparison", requireInternal, (request, response) => {
    const parsed = compareSchema.safeParse(request.query);
    if (!parsed.success)
      return void response
        .status(400)
        .json({ error: "Invalid comparison request." });
    const baseline = lookupRun(parsed.data.baselineRunId);
    const candidate = lookupRun(parsed.data.candidateRunId);
    if (!baseline || !candidate)
      return void response
        .status(404)
        .json({ error: "One or both runs were not found." });
    if (productionAuth) {
      const principal = productionAuth.context(request)?.principal;
      if (
        !authorizePrincipal(
          principal,
          "read_internal",
          platformStorage?.getAcl("run", baseline.id),
        ).allowed ||
        !authorizePrincipal(
          principal,
          "read_internal",
          platformStorage?.getAcl("run", candidate.id),
        ).allowed
      )
        return void response.status(403).json({
          error: "One or both runs are not shared with this principal.",
        });
    }
    response.json({ comparison: compareRuns(baseline, candidate) });
  });

  app.get("/api/studies", requireInternal, (request, response) => {
    if (!platformStorage)
      return void response
        .status(503)
        .json({ error: "Study storage is unavailable." });
    const principal = productionAuth?.context(request)?.principal;
    const studies = platformStorage
      .listStudies()
      .filter(
        (study) =>
          !principal ||
          authorizePrincipal(
            principal,
            "read_internal",
            platformStorage.getAcl("study", study.id),
          ).allowed,
      );
    response.json({
      studies: studies.map((study) => ({
        ...toPublicStudy(study),
        runLinks: study.runLinks.map((link) => ({
          ...toPublicStudy(study).runLinks.find(
            (item) => item.artifactHash === link.artifactHash,
          ),
          verification: link.verification,
        })),
      })),
    });
  });

  app.post("/api/studies", requireStudyCreator, (request, response) => {
    if (!platformStorage)
      return void response
        .status(503)
        .json({ error: "Study storage is unavailable." });
    const parsed = createStudySchema.safeParse(request.body);
    if (!parsed.success)
      return void response
        .status(400)
        .json({ error: "Invalid study.", details: parsed.error.flatten() });
    const principal = productionAuth?.context(request)?.principal;
    const study = createStudy({
      ...parsed.data,
      ownerOrganization:
        principal?.organizationId ?? parsed.data.ownerOrganization,
      createdBy: principal?.id ?? "local-researcher",
      createdAt: new Date().toISOString(),
    });
    platformStorage.putStudy(study);
    platformStorage.putAcl({
      resourceType: "study",
      resourceId: study.id,
      ownerId: principal?.id ?? "local-researcher",
      organizationId: principal?.organizationId ?? study.ownerOrganization,
      teamIds: principal?.teamIds ?? [],
      public: false,
    });
    recordAudit(request, "study.created", "study", study.id);
    response.status(201).json({ study: toPublicStudy(study) });
  });

  app.get("/api/studies/:studyId", requireStudyRead, (request, response) => {
    const study = platformStorage?.getStudy(routeParam(request.params.studyId));
    if (!study)
      return void response.status(404).json({ error: "Study not found." });
    response.json({ study });
  });

  app.patch(
    "/api/studies/:studyId",
    requireStudyUpdate,
    (request, response) => {
      const study = platformStorage?.getStudy(
        routeParam(request.params.studyId),
      );
      if (!study || !platformStorage)
        return void response.status(404).json({ error: "Study not found." });
      if (study.status !== "draft")
        return void response.status(409).json({
          error:
            "The registered research question and compatibility policy are frozen.",
        });
      const parsed = updateStudySchema.safeParse(request.body);
      if (!parsed.success)
        return void response.status(400).json({
          error: "Invalid study update.",
          details: parsed.error.flatten(),
        });
      Object.assign(study, parsed.data);
      platformStorage.putStudy(study);
      recordAudit(request, "study.updated", "study", study.id);
      response.json({ study });
    },
  );

  app.post(
    "/api/studies/:studyId/register",
    requireStudyUpdate,
    (request, response) => {
      const study = platformStorage?.getStudy(
        routeParam(request.params.studyId),
      );
      if (!study || !platformStorage)
        return void response.status(404).json({ error: "Study not found." });
      if (!artifactService)
        return void response
          .status(503)
          .json({ error: "Signed study registration is not configured." });
      registerStudy(study);
      const identity = artifactService.signingIdentity();
      const registration = signStudyRegistrationArtifact({
        study,
        identity,
        registeredAt: new Date().toISOString(),
      });
      study.registrationArtifact = registration;
      study.registrationRevision = registration.payload.registrationRevision;
      platformStorage.putImmutable(
        "study_registration",
        study.id,
        registration.signature.artifactHash,
        registration,
      );
      platformStorage.putStudy(study);
      recordAudit(request, "study.registered", "study", study.id);
      response.json({ study });
    },
  );

  app.patch(
    "/api/studies/:studyId/acl",
    requireStudyAclManage,
    (request, response) => {
      if (!platformStorage)
        return void response
          .status(503)
          .json({ error: "Study storage is unavailable." });
      const current = platformStorage.getAcl(
        "study",
        routeParam(request.params.studyId),
      );
      if (!current)
        return void response
          .status(404)
          .json({ error: "Study ACL not found." });
      const parsed = aclUpdateSchema.safeParse(request.body);
      if (!parsed.success)
        return void response.status(400).json({ error: "Invalid ACL update." });
      const updated = {
        ...current,
        teamIds: parsed.data.teamIds,
        public: parsed.data.public ?? current.public,
      };
      platformStorage.putAcl(updated);
      recordAudit(request, "acl.updated", "study", current.resourceId, {
        public: updated.public,
      });
      response.json({ acl: updated });
    },
  );

  app.post(
    "/api/studies/:studyId/artifacts/import",
    requireStudyUpdate,
    (request, response) => {
      if (!platformStorage || !trustStore)
        return void response
          .status(503)
          .json({ error: "Study trust or storage is unavailable." });
      const study = platformStorage.getStudy(
        routeParam(request.params.studyId),
      );
      if (!study)
        return void response.status(404).json({ error: "Study not found." });
      const parsed = importStudyArtifactSchema.safeParse(request.body);
      if (!parsed.success)
        return void response.status(400).json({
          error: "Invalid artifact import.",
          details: parsed.error.flatten(),
        });
      const artifact = signedArtifact<CompletedRunArtifact>(
        parsed.data.artifact,
        "completed_run",
      );
      const pack = signedArtifact<SignedReplicationPack<Scenario>["payload"]>(
        parsed.data.pack,
        "scenario_pack",
      ) as SignedReplicationPack<Scenario> | undefined;
      const attestation = parsed.data.attestation
        ? (signedArtifact<SignedHoldoutPackAttestation["payload"]>(
            parsed.data.attestation,
            "holdout_pack_attestation",
          ) as SignedHoldoutPackAttestation | undefined)
        : undefined;
      const plan = parsed.data.plan
        ? signedArtifact<ReplicationPlan>(parsed.data.plan, "replication_plan")
        : undefined;
      const reportArtifact = parsed.data.reportArtifact
        ? signedArtifact<ReportArtifact>(
            parsed.data.reportArtifact,
            "run_report",
          )
        : undefined;
      const independenceDeclaration = parsed.data.independenceDeclaration
        ? (signedArtifact<SignedIndependenceDeclaration["payload"]>(
            parsed.data.independenceDeclaration,
            "independence_declaration",
          ) as SignedIndependenceDeclaration | undefined)
        : undefined;
      if (
        !artifact ||
        (parsed.data.role === "sealed_holdout"
          ? !attestation || !!pack
          : !pack) ||
        (parsed.data.plan && !plan) ||
        (parsed.data.reportArtifact && !reportArtifact) ||
        (parsed.data.independenceDeclaration && !independenceDeclaration)
      )
        return void response.status(400).json({
          error:
            "Signed artifact envelope is malformed or has the wrong artifact type.",
        });
      try {
        const link = importStudyRun({
          study,
          artifact,
          role: parsed.data.role,
          datasetIdentity: parsed.data.datasetIdentity,
          pack,
          packAttestation: attestation,
          replicationKey: parsed.data.replicationKey,
          trustStore,
          importedAt: new Date().toISOString(),
          plan,
          reportArtifact,
          independenceDeclaration,
        });
        platformStorage.transaction(() => {
          platformStorage.putImmutable(
            "completed_run",
            artifact.payload.runId,
            artifact.signature.artifactHash,
            artifact,
          );
          platformStorage.putStudy(study);
        });
        recordAudit(request, "study.run_linked", "study", study.id, {
          artifactHash: link.artifactHash,
          role: link.role,
        });
        response.status(201).json({ link });
      } catch (error) {
        response.status(400).json({
          error:
            error instanceof Error ? error.message : "Artifact import failed.",
        });
      }
    },
  );

  app.post(
    "/api/studies/:studyId/remote-results/import",
    requireStudyUpdate,
    (request, response) => {
      if (!platformStorage || !trustStore)
        return void response
          .status(503)
          .json({ error: "Study trust or storage is unavailable." });
      const study = platformStorage.getStudy(
        routeParam(request.params.studyId),
      );
      if (!study)
        return void response.status(404).json({ error: "Study not found." });
      const parsed = importRemoteResultSchema.safeParse(request.body);
      if (!parsed.success)
        return void response
          .status(400)
          .json({ error: "Invalid remote result import." });
      const result = signedArtifact<RemoteResultBundle>(
        parsed.data.result,
        "remote_result_bundle",
      );
      const executionRequest = signedArtifact<RemoteExecutionRequest>(
        parsed.data.request,
        "remote_execution_request",
      );
      const attestation = signedArtifact<
        SignedHoldoutPackAttestation["payload"]
      >(parsed.data.attestation, "holdout_pack_attestation") as
        | SignedHoldoutPackAttestation
        | undefined;
      if (!result || !executionRequest || !attestation)
        return void response.status(400).json({
          error: "Remote result, request, or pack envelope is malformed.",
        });
      const requestVerification = verifySignedArtifact({
        artifact: executionRequest,
        trustStore,
        expectedType: "remote_execution_request",
        expectedPurpose: "remote-sealed-holdout-execution",
        requiredRole: "lab_operator",
        now: result.payload.completedAt,
      });
      const errors = [
        ...(!requestVerification.validAtSigning
          ? ["remote_request_signature_invalid"]
          : []),
        ...verifyRemoteResult({
          result,
          request: executionRequest,
          trustStore,
          now: result.payload.completedAt,
          attestation,
          requireAttestation: true,
        }),
      ];
      if (errors.length)
        return void response.status(400).json({
          error: "Remote result verification failed.",
          details: errors,
        });
      if (executionRequest.payload.studyId !== study.id)
        return void response
          .status(400)
          .json({ error: "Remote result targets another study." });
      try {
        const link = importStudyRun({
          study,
          artifact: result.payload.completedRunArtifact,
          role: "sealed_holdout",
          datasetIdentity: result.payload.datasetIdentity,
          packAttestation: attestation,
          replicationKey: parsed.data.replicationKey,
          trustStore,
          importedAt: new Date().toISOString(),
          plan: executionRequest.payload.replicationPlan,
        });
        if (
          !platformStorage.consumeNonce(
            "remote-result-import",
            result.signature.artifactHash,
            "9999-12-31T23:59:59.999Z",
          )
        )
          return void response
            .status(409)
            .json({ error: "Remote result was already imported." });
        platformStorage.transaction(() => {
          platformStorage.putImmutable(
            "remote_request",
            executionRequest.payload.requestId,
            executionRequest.signature.artifactHash,
            executionRequest,
          );
          platformStorage.putImmutable(
            "remote_result",
            result.payload.resultId,
            result.signature.artifactHash,
            result,
          );
          platformStorage.putImmutable(
            "completed_run",
            result.payload.completedRunArtifact.payload.runId,
            result.payload.completedRunArtifact.signature.artifactHash,
            result.payload.completedRunArtifact,
          );
          platformStorage.putStudy(study);
        });
        recordAudit(request, "remote_result.imported", "study", study.id, {
          artifactHash: result.signature.artifactHash,
        });
        response.status(201).json({ link });
      } catch (error) {
        response.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Remote result import failed.",
        });
      }
    },
  );

  app.post(
    "/api/studies/:studyId/runs",
    requireStudyUpdate,
    (request, response) => {
      if (!artifactService)
        return void response
          .status(503)
          .json({ error: "Artifact signing is not configured." });
      if (!request.body || typeof request.body.runId !== "string")
        return void response.status(400).json({
          error:
            "runId is required; use artifacts/import with its signed pack to establish provenance.",
        });
      const run = lookupRun(request.body.runId);
      if (!run)
        return void response.status(404).json({ error: "Run not found." });
      const artifact = artifactService.completedRun(run, calibrationReport());
      response.json({
        artifact,
        next: "Import this immutable artifact together with its signed scenario pack and replication plan at /artifacts/import.",
      });
    },
  );

  function synthesisTime(
    study: ReturnType<NonNullable<typeof platformStorage>["getStudy"]>,
  ): string {
    if (!study) return new Date().toISOString();
    return [study.createdAt, ...study.runLinks.map((link) => link.importedAt)]
      .sort()
      .at(-1)!;
  }

  app.post(
    "/api/studies/:studyId/synthesize",
    requireStudyUpdate,
    (request, response) => {
      if (!platformStorage || !trustStore || !artifactService)
        return void response
          .status(503)
          .json({ error: "Study synthesis services are unavailable." });
      const study = platformStorage.getStudy(
        routeParam(request.params.studyId),
      );
      if (!study)
        return void response.status(404).json({ error: "Study not found." });
      const synthesis = artifactService.signStudySynthesis(
        synthesizeStudy(study, trustStore, synthesisTime(study)),
      );
      platformStorage.putImmutable(
        "study_synthesis",
        synthesis.signature.artifactId,
        synthesis.signature.artifactHash,
        synthesis,
      );
      recordAudit(request, "study.synthesized", "study", study.id, {
        artifactHash: synthesis.signature.artifactHash,
      });
      response.json({ synthesis });
    },
  );

  app.post(
    "/api/studies/:studyId/adjudications",
    requireReviewer,
    (request, response) => {
      if (!platformStorage || !trustStore)
        return void response
          .status(503)
          .json({ error: "Review trust or storage is unavailable." });
      const study = platformStorage.getStudy(
        routeParam(request.params.studyId),
      );
      if (!study)
        return void response.status(404).json({ error: "Study not found." });
      const adjudication = signedArtifact<HumanAdjudication>(
        request.body?.adjudication,
        "human_adjudication",
      );
      if (!adjudication)
        return void response
          .status(400)
          .json({ error: "A signed human-adjudication artifact is required." });
      const errors = verifyHumanAdjudication({
        adjudication,
        trustStore,
        expectedStudyId: study.id,
        expectedReviewerId: productionAuth?.context(request)?.principal.id,
        now: new Date().toISOString(),
      });
      if (errors.length)
        return void response.status(400).json({
          error: "Human adjudication verification failed.",
          details: errors,
        });
      study.adjudications = [
        ...(study.adjudications ?? []).filter(
          (item) => item.payload.id !== adjudication.payload.id,
        ),
        adjudication,
      ];
      platformStorage.putStudy(study);
      platformStorage.putImmutable(
        "human_adjudication",
        adjudication.payload.id,
        adjudication.signature.artifactHash,
        adjudication,
      );
      recordAudit(request, "human_adjudication.imported", "study", study.id, {
        findingId: adjudication.payload.findingId,
        status: adjudication.payload.status,
      });
      response.status(201).json({ adjudication });
    },
  );

  app.post(
    "/api/studies/:studyId/publish",
    requirePublisher,
    async (request, response) => {
      if (!platformStorage || !trustStore || !artifactService)
        return void response
          .status(503)
          .json({ error: "Study publication services are unavailable." });
      const study = platformStorage.getStudy(
        routeParam(request.params.studyId),
      );
      if (!study)
        return void response.status(404).json({ error: "Study not found." });
      if (!study.registrationArtifact)
        return void response.status(409).json({
          error: "Study registration must be signed before publication.",
        });
      const revision = (study.publishedRevision ?? 0) + 1;
      const rawSynthesis = synthesizeStudy(
        study,
        trustStore,
        synthesisTime(study),
      );
      const reviewBlockers = publicationReviewBlockers(
        rawSynthesis,
        study.adjudications ?? [],
        trustStore,
        new Date().toISOString(),
      );
      if (reviewBlockers.length)
        return void response.status(409).json({
          error: "Study is not publication-ready.",
          blockers: reviewBlockers,
        });
      const synthesis = artifactService.signStudySynthesis(rawSynthesis);
      study.publishedRevision = revision;
      study.status = "published";
      const report = artifactService.studyReport(study, synthesis, "public");
      const archive = await artifactService.studyArchive(
        study,
        synthesis,
        "public",
      );
      study.publishedReportArtifactHash = report.signature.artifactHash;
      const archiveArtifactHash = createHash("sha256")
        .update(archive)
        .digest("hex");
      study.revisions = [
        ...(study.revisions ?? []).map((item) =>
          item.status === "published"
            ? { ...item, status: "superseded" as const }
            : item,
        ),
        {
          revision,
          registrationArtifactHash: study.registrationArtifact
            ? study.registrationArtifact.signature.artifactHash
            : "",
          includedRunArtifactHashes: study.runLinks.map(
            (link) => link.artifactHash,
          ),
          includedAdjudicationHashes: (study.adjudications ?? []).map(
            (item) => item.signature.artifactHash,
          ),
          synthesisArtifactHash: synthesis.signature.artifactHash,
          reportArtifactHash: report.signature.artifactHash,
          archiveArtifactHash,
          status: "published" as const,
          publishedAt: new Date().toISOString(),
          supersedesRevision: revision > 1 ? revision - 1 : undefined,
        },
      ];
      platformStorage.putStudy(study);
      const acl = platformStorage.getAcl("study", study.id);
      if (acl) platformStorage.putAcl({ ...acl, public: true });
      recordAudit(request, "study.published", "study", study.id, {
        artifactHash: report.signature.artifactHash,
      });
      response.json({ report: toPublicReportArtifact(report) });
    },
  );

  app.get("/api/studies/:studyId/report", async (request, response, next) => {
    try {
      if (!platformStorage || !trustStore || !artifactService)
        return void response
          .status(503)
          .json({ error: "Study report services are unavailable." });
      const study = platformStorage.getStudy(
        routeParam(request.params.studyId),
      );
      if (!study)
        return void response.status(404).json({ error: "Study not found." });
      const disclosure =
        request.query.disclosure === "internal" ? "internal" : "public";
      if (disclosure === "internal") {
        const decision = productionAuth
          ? authorizePrincipal(
              productionAuth.context(request)?.principal,
              "read_internal",
              platformStorage.getAcl("study", study.id),
            )
          : (() => {
              const value = authorizeRequest(request, auth, "internal");
              return value.ok
                ? { allowed: true as const }
                : {
                    allowed: false as const,
                    status: value.status,
                    reason: value.message,
                  };
            })();
        if (!decision.allowed)
          return void response
            .status(decision.status)
            .json({ error: decision.reason });
      }
      if (disclosure === "public" && study.status !== "published")
        return void response
          .status(404)
          .json({ error: "Published study report not found." });
      const publishedReport =
        disclosure === "public" && study.publishedReportArtifactHash
          ? artifactService.storedStudyReport(study.publishedReportArtifactHash)
          : undefined;
      if (disclosure === "public" && !publishedReport)
        return void response
          .status(404)
          .json({ error: "Published study report artifact is unavailable." });
      const synthesis = artifactService.signStudySynthesis(
        synthesizeStudy(study, trustStore, synthesisTime(study)),
      );
      const report =
        publishedReport ??
        artifactService.studyReport(study, synthesis, disclosure);
      if (request.query.format === "pdf") {
        const pdf = await artifactService.pdf(report);
        response.setHeader("Content-Type", "application/pdf");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="study-${study.id}-${disclosure}-${report.signature.artifactHash.slice(0, 12)}.pdf"`,
        );
        return void response.send(Buffer.from(pdf));
      }
      response.json({
        report:
          disclosure === "public" ? toPublicReportArtifact(report) : report,
        synthesis: disclosure === "public" ? undefined : synthesis,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/studies/:studyId/archive", async (request, response, next) => {
    try {
      if (!platformStorage || !trustStore || !artifactService)
        return void response
          .status(503)
          .json({ error: "Study archive services are unavailable." });
      const study = platformStorage.getStudy(
        routeParam(request.params.studyId),
      );
      if (!study)
        return void response.status(404).json({ error: "Study not found." });
      const disclosure =
        request.query.disclosure === "internal" ? "internal" : "public";
      if (disclosure === "public" && study.status !== "published")
        return void response
          .status(404)
          .json({ error: "Published study archive not found." });
      if (disclosure === "internal" && productionAuth) {
        const decision = authorizePrincipal(
          productionAuth.context(request)?.principal,
          "read_internal",
          platformStorage.getAcl("study", study.id),
        );
        if (!decision.allowed)
          return void response
            .status(decision.status)
            .json({ error: decision.reason });
      }
      if (disclosure === "internal" && !productionAuth) {
        const decision = authorizeRequest(request, auth, "internal");
        if (!decision.ok)
          return void response
            .status(decision.status)
            .json({ error: decision.message });
      }
      if (disclosure === "public" && study.publishedReportArtifactHash) {
        const publishedReport = artifactService.storedStudyReport(
          study.publishedReportArtifactHash,
        );
        const publishedArchive = artifactService.storedStudyArchive(
          study.publishedReportArtifactHash,
        );
        if (publishedReport && publishedArchive) {
          response.setHeader("Content-Type", "application/zip");
          response.setHeader(
            "ETag",
            `\"${study.revisions?.find((item) => item.reportArtifactHash === study.publishedReportArtifactHash)?.archiveArtifactHash ?? study.publishedReportArtifactHash}\"`,
          );
          response.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
          response.setHeader(
            "Content-Disposition",
            `attachment; filename="study-${study.id}-public-${study.publishedReportArtifactHash.slice(0, 12)}.zip"`,
          );
          return void response.send(Buffer.from(publishedArchive));
        }
      }
      if (disclosure === "public")
        return void response.status(404).json({
          error: "Published archive artifact is unavailable.",
        });
      const synthesis = artifactService.signStudySynthesis(
        synthesizeStudy(study, trustStore, synthesisTime(study)),
      );
      const archive = await artifactService.studyArchive(
        study,
        synthesis,
        disclosure,
      );
      response.setHeader("Content-Type", "application/zip");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="study-${study.id}-${disclosure}-${synthesis.signature.artifactHash.slice(0, 12)}.zip"`,
      );
      response.send(Buffer.from(archive));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/public/studies/:studyId", (request, response) => {
    const study = platformStorage?.getStudy(routeParam(request.params.studyId));
    if (!study || study.status !== "published")
      return void response
        .status(404)
        .json({ error: "Published study not found." });
    response.json({ study: toPublicStudy(study) });
  });

  app.get("/api/audit", requireAuditAdmin, (request, response) => {
    const events = platformStorage?.listAudit() ?? [];
    recordAudit(request, "audit.accessed", "audit", "transparency-log", {
      events: events.length,
    });
    const current = platformStorage?.listAudit() ?? events;
    response.json({
      verification: {
        valid: verifyAuditChain(current).length === 0,
        errors: verifyAuditChain(current),
      },
      events: current,
    });
  });
  app.post("/api/audit/checkpoint", requireAuditAdmin, (request, response) => {
    if (!platformStorage || !artifactService)
      return void response
        .status(503)
        .json({ error: "Audit signing is unavailable." });
    recordAudit(
      request,
      "audit.checkpoint_requested",
      "audit",
      "transparency-log",
    );
    const checkpoint = artifactService.auditCheckpoint(
      platformStorage.listAudit(),
      new Date().toISOString(),
    );
    response.status(201).json({ checkpoint });
  });

  app.get("/api/admin/users", requireAdmin, (_, response) => {
    response.json({ users: platformStorage?.listPrincipals() ?? [] });
  });
  app.patch("/api/admin/users/:userId", requireAdmin, (request, response) => {
    if (!platformStorage)
      return void response
        .status(503)
        .json({ error: "Identity storage is unavailable." });
    const user = platformStorage.getPrincipal(
      routeParam(request.params.userId),
    );
    if (!user)
      return void response.status(404).json({ error: "User not found." });
    const parsed = updatePrincipalSchema.safeParse(request.body);
    if (!parsed.success)
      return void response.status(400).json({ error: "Invalid user update." });
    const updated = { ...user, ...parsed.data };
    platformStorage.putPrincipal(updated);
    recordAudit(request, "user.updated", "user", user.id, {
      disabled: updated.disabled,
    });
    response.json({ user: updated });
  });
  app.get("/api/admin/organizations", requireAdmin, (_, response) => {
    response.json({
      organizations: platformStorage?.listOrganizations() ?? [],
    });
  });
  app.post("/api/admin/organizations", requireAdmin, (request, response) => {
    if (!platformStorage)
      return void response
        .status(503)
        .json({ error: "Identity storage is unavailable." });
    const parsed = organizationSchema.safeParse(request.body);
    if (!parsed.success)
      return void response.status(400).json({ error: "Invalid organization." });
    const organization = {
      ...parsed.data,
      createdAt: new Date().toISOString(),
    };
    platformStorage.putOrganization(organization);
    recordAudit(
      request,
      "organization.created",
      "organization",
      organization.id,
    );
    response.status(201).json({ organization });
  });
  app.get("/api/admin/teams", requireAdmin, (_, response) => {
    response.json({ teams: platformStorage?.listTeams() ?? [] });
  });
  app.post("/api/admin/teams", requireAdmin, (request, response) => {
    if (!platformStorage)
      return void response
        .status(503)
        .json({ error: "Identity storage is unavailable." });
    const parsed = teamSchema.safeParse(request.body);
    if (!parsed.success)
      return void response.status(400).json({ error: "Invalid team." });
    if (!platformStorage.getOrganization(parsed.data.organizationId))
      return void response
        .status(400)
        .json({ error: "Team organization does not exist." });
    const team = { ...parsed.data, createdAt: new Date().toISOString() };
    platformStorage.putTeam(team);
    for (const memberId of team.memberIds) {
      const user = platformStorage.getPrincipal(memberId);
      if (user && !user.teamIds.includes(team.id))
        platformStorage.putPrincipal({
          ...user,
          teamIds: [...user.teamIds, team.id].sort(),
        });
    }
    recordAudit(request, "team.created", "team", team.id, {
      members: team.memberIds.length,
    });
    response.status(201).json({ team });
  });

  app.get("/api/trust", requireAdmin, (_, response) => {
    response.json({
      anchors: trustStore?.listAnchors() ?? [],
      certificates: trustStore?.listCertificates() ?? [],
      revocations: trustStore?.revocations() ?? [],
    });
  });
  app.post("/api/trust/anchors", requireAdmin, (request, response) => {
    if (!trustStore || !platformStorage)
      return void response
        .status(503)
        .json({ error: "Trust storage is unavailable." });
    const certificate = request.body?.certificate as
      | TrustCertificate
      | undefined;
    if (!certificate)
      return void response
        .status(400)
        .json({ error: "certificate is required." });
    try {
      trustStore.addTrustAnchor(certificate, true);
      platformStorage.putImmutable(
        "trust_anchor",
        certificate.certificateId,
        certificate.keyId.replace(/^ed25519:/, ""),
        certificate,
      );
      recordAudit(
        request,
        "trust.anchor_added",
        "trust",
        certificate.certificateId,
        { keyId: certificate.keyId },
      );
      if (artifactService)
        artifactService.auditCheckpoint(
          platformStorage.listAudit(),
          new Date().toISOString(),
        );
      response.status(201).json({ certificate });
    } catch {
      response.status(400).json({ error: "Trust anchor verification failed." });
    }
  });
  app.post("/api/trust/certificates", requireAdmin, (request, response) => {
    if (!trustStore || !platformStorage || !Array.isArray(request.body?.chain))
      return void response
        .status(400)
        .json({ error: "A certificate chain is required." });
    const chain = request.body.chain as TrustCertificate[];
    const verification = trustStore.verificationForChain({
      chain,
      signedAt: new Date().toISOString(),
    });
    if (!verification.validAtSigning)
      return void response.status(400).json({
        error: "Certificate chain verification failed.",
        details: verification.errors,
      });
    const certificate = chain[0];
    trustStore.addCertificate(certificate);
    platformStorage.putImmutable(
      "certificate",
      certificate.certificateId,
      certificate.keyId.replace(/^ed25519:/, ""),
      certificate,
    );
    recordAudit(
      request,
      "trust.certificate_added",
      "trust",
      certificate.certificateId,
      { keyId: certificate.keyId },
    );
    if (artifactService)
      artifactService.auditCheckpoint(
        platformStorage.listAudit(),
        new Date().toISOString(),
      );
    response.status(201).json({ certificate, verification });
  });
  app.post("/api/trust/revocations", requireAdmin, (request, response) => {
    if (!trustStore || !platformStorage)
      return void response
        .status(503)
        .json({ error: "Trust storage is unavailable." });
    const list = request.body?.revocationList as
      | SignedRevocationList
      | undefined;
    if (!list)
      return void response
        .status(400)
        .json({ error: "revocationList is required." });
    try {
      trustStore.addRevocationList(list);
      platformStorage.putImmutable(
        "revocation_list",
        String(list.sequence),
        list.signature,
        list,
      );
      recordAudit(
        request,
        "trust.revocations_updated",
        "trust",
        String(list.sequence),
        { count: list.revocations.length },
      );
      if (artifactService)
        artifactService.auditCheckpoint(
          platformStorage.listAudit(),
          new Date().toISOString(),
        );
      response.status(201).json({ sequence: list.sequence });
    } catch {
      response
        .status(400)
        .json({ error: "Revocation list verification failed." });
    }
  });

  app.get("/api/gold", requireGoldAdmin, (_, response) => {
    response.json({
      items: listGoldItems().map((item) => ({ ...item, response: "" })),
      report: calibrationReport(),
    });
  });

  app.get("/api/gold/export", requireGoldAdmin, (_, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="framing-gold-set.json"',
    );
    response.send(
      JSON.stringify(
        {
          schemaVersion: "2.0",
          exportedAt: new Date().toISOString(),
          report: calibrationReport(),
          items: listGoldItems(),
        },
        null,
        2,
      ),
    );
  });

  app.get(
    "/api/gold/:itemId/response",
    requireGoldAdmin,
    (request, response) => {
      const item = getGoldItem(routeParam(request.params.itemId));
      if (!item)
        return void response
          .status(404)
          .json({ error: "Gold item not found." });
      response.json({
        response: item.response,
        responseHash: item.responseHash,
      });
    },
  );

  app.post("/api/gold", requireGoldAdmin, async (request, response, next) => {
    try {
      const parsed = createGoldSchema.safeParse(request.body);
      if (!parsed.success)
        return void response
          .status(400)
          .json({ error: "Invalid gold-item request." });
      const run = lookupRun(parsed.data.runId);
      const trial = run?.trials.find((item) => item.id === parsed.data.trialId);
      if (!run || !trial)
        return void response
          .status(404)
          .json({ error: "Run or trial not found." });
      const item = await createGoldItem(run, trial);
      recordAudit(request, "gold.created", "gold", item.id, { runId: run.id });
      response
        .status(201)
        .json({ item: { ...item, response: "" }, report: calibrationReport() });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/gold/:itemId/annotations",
    requireGoldAdmin,
    async (request, response, next) => {
      try {
        const parsed = annotationSchema.safeParse(request.body);
        if (!parsed.success)
          return void response.status(400).json({
            error: "Invalid annotation.",
            details: parsed.error.flatten(),
          });
        const item = await addAnnotation(
          routeParam(request.params.itemId),
          parsed.data,
        );
        recordAudit(request, "gold.annotation_added", "gold", item.id);
        response.status(201).json({
          item: { ...item, response: "" },
          report: calibrationReport(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/gold/:itemId",
    requireGoldAdmin,
    async (request, response, next) => {
      try {
        const removed = await removeGoldItem(routeParam(request.params.itemId));
        if (!removed)
          return void response
            .status(404)
            .json({ error: "Gold item not found." });
        recordAudit(
          request,
          "gold.deleted",
          "gold",
          routeParam(request.params.itemId),
        );
        response.json({ ok: true, report: calibrationReport() });
      } catch (error) {
        next(error);
      }
    },
  );

  const clientDist = path.resolve(__dirname, "../dist");
  app.use(express.static(clientDist));
  app.use(
    (
      request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (request.path.startsWith("/api/")) return next();
      response.sendFile(
        path.join(clientDist, "index.html"),
        (error: unknown) => {
          if (error) next();
        },
      );
    },
  );

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error("Request failed.", { errorName });
      response
        .status(500)
        .json({ error: "The server could not complete the request." });
    },
  );

  return app;
}

export async function startServer(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const host = environment.HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(environment.PORT ?? "8787", 10);
  const mode = authenticationMode(environment);
  const auth = authConfigFromEnvironment(environment);
  if (mode === "local") assertSafeHostConfiguration(host, auth);
  parseSecondaryJudgeSampleRate(environment.SECONDARY_JUDGE_SAMPLE_RATE);
  const storage = storageFromEnvironment(environment);
  if (!storage.platform)
    throw new Error("Platform storage failed to initialize.");
  if (storage.mode === "sqlite" && storage.encryptionKey)
    configureProductionRunStore({
      storage: storage.platform,
      encryptionKey: storage.encryptionKey,
      decryptionKeys: storage.decryptionKeys,
    });
  const providers = new ProviderRegistry().register(new AnthropicProvider());
  const openAiCompatible = openAiCompatibleFromEnvironment(environment);
  if (openAiCompatible) providers.register(openAiCompatible);
  setProviderRegistry(providers);
  const trustStore = await trustStoreFromEnvironment(environment);
  const artifactService = await artifactServiceFromEnvironment(
    environment,
    storage.platform,
    trustStore,
  );
  if (mode === "oidc" && !artifactService)
    throw new Error(
      "OIDC production mode requires configured artifact signing keys and certificate chain.",
    );
  configureRunEvidenceLifecycleHooks(
    artifactService
      ? {
          manifestLocked: (run) => {
            if (run.purpose === "promotable_evidence")
              artifactService.lockPreregistrationManifest(run);
          },
          executionSealed: (run) => {
            if (run.purpose === "promotable_evidence")
              artifactService.sealExecutionManifest(run);
          },
          executionPlanned: (run) => {
            if (run.purpose === "promotable_evidence")
              artifactService.planExecution(run);
          },
        }
      : undefined,
  );
  let productionAuth: ProductionAuth | undefined;
  let oidcSettings: ReturnType<typeof oidcConfigFromEnvironment> | undefined;
  if (mode === "oidc") {
    oidcSettings = oidcConfigFromEnvironment(environment);
    const oidc = await OidcManager.discover(
      oidcSettings,
      oidcAuthorizationStore(storage.platform),
    );
    const sessions = new SessionManager(
      storage.platform,
      sessionConfigFromEnvironment(environment),
    );
    productionAuth = new ProductionAuth({
      oidc,
      sessions,
      storage: storage.platform,
      publicBaseUrl: oidcSettings.publicBaseUrl,
      secureCookies: environment.NODE_ENV === "production",
    });
  }
  await Promise.all([initializeStore(), initializeCalibrationStore()]);
  const app = createApp({
    auth,
    artifactService,
    productionAuth,
    platformStorage: storage.platform,
    trustStore,
    trustProxy: oidcSettings?.trustProxy ?? false,
    https: oidcSettings
      ? new URL(oidcSettings.publicBaseUrl).protocol === "https:"
      : false,
  });
  const server = app.listen(port, host, () =>
    console.log(
      `Framing Invariance Lab server listening on ${mode === "oidc" ? oidcSettings?.publicBaseUrl : `http://${host}:${port}`}`,
    ),
  );
  const shutdown = () =>
    server.close(() => {
      configureRunEvidenceLifecycleHooks(undefined);
      storage.platform?.close();
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url))
  : false;
if (isMainModule) {
  await startServer();
}

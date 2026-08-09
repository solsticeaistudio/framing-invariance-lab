import type { KeyObject } from "node:crypto";
import type { JudgeAssessment, Scenario } from "../types.js";
import type {
  CompletedRunArtifact,
  EncryptedReplicationPack,
  MethodologyDescriptor,
  RemoteExecutionRequest,
  RemoteResultBundle,
  RunFindingSummary,
  SignedArtifact,
  SignedReplicationPack,
  TrustCertificate,
  SignedHoldoutPackAttestation,
  PlannedTrialCommitment,
  TrialExecutionRecord,
  PreExecutionPlanArtifact,
} from "../v2/types.js";
import { canonicalSha256 } from "../lib/canonicalJson.js";
import { unsealReplicationPack } from "../lib/encryption.js";
import type { ModelProvider } from "../lib/providers/index.js";
import { signArtifact, verifySignedArtifact } from "../lib/signatures.js";
import {
  verifyHoldoutPackAttestation,
  verifySignedReplicationPack,
} from "../lib/signedPacks.js";
import type { PlatformStorage } from "../lib/storage/index.js";
import { riskDifferenceInterval, wilson } from "../lib/statistics.js";
import { TrustStore } from "../lib/trustStore.js";
import { createAuditEvent } from "../lib/audit.js";
import { buildVariants } from "../lib/variantFactory.js";
import { canonicalResearchIdentity } from "../lib/executionPlan.js";
import { PAIRWISE_FRAMING_PROTOCOL } from "../lib/framingProtocol.js";
import {
  HARNESS_VERSION,
  JUDGE_PROTOCOL_VERSION,
} from "../lib/protocolVersions.js";
import { VARIANT_PROTOCOL_VERSION } from "../lib/protocolVersions.js";
import { axisDefinitions } from "../lib/variantFactory.js";
import {
  executionLedgerHash,
  reconcileExecutionLedger,
} from "../lib/executionLedger.js";
import type { HoldoutEvidenceVault } from "./evidenceVault.js";

export type HoldoutSigningIdentity = {
  certificateChain: TrustCertificate[];
  privateKey: KeyObject;
};

export function signRemoteExecutionRequest(
  payload: RemoteExecutionRequest,
  identity: HoldoutSigningIdentity,
  signedAt: string,
) {
  if (payload.issuedAt !== signedAt)
    throw new Error("request_signature_time_mismatch");
  if (
    payload.holdoutAttestationHash !==
    payload.holdoutAttestation.signature.artifactHash
  )
    throw new Error("request_attestation_binding_invalid");
  return signArtifact({
    artifactType: "remote_execution_request",
    artifactSchemaVersion: payload.schemaVersion,
    artifactId: payload.requestId,
    payload,
    purpose: "remote-sealed-holdout-execution",
    parentArtifactHashes: [
      payload.replicationPlan.signature.artifactHash,
      payload.parentReportHash,
      payload.packCommitment,
      payload.holdoutAttestationHash,
    ],
    disclosure: "sealed",
    signedAt,
    ...identity,
  });
}

function frozenVariants(
  scenario: Scenario,
  seed: number,
): Array<{
  prompt: string;
  fingerprint: string;
  isBaseline: boolean;
}> {
  return buildVariants([scenario], "pairwise", seed).map((variant) => ({
    prompt: variant.prompt,
    fingerprint: variant.fingerprint,
    isBaseline: variant.isBaseline,
  }));
}

export class SealedHoldoutExecutor {
  private active = 0;
  constructor(
    private readonly settings: {
      recipientKeyId: string;
      encryptedPack: EncryptedReplicationPack;
      decryptionKeys: Map<string, Buffer>;
      trustStore: TrustStore;
      storage: PlatformStorage;
      targetProvider: ModelProvider;
      judgeProvider: ModelProvider;
      signingIdentity: HoldoutSigningIdentity;
      maxConcurrency: number;
      clock?: () => string;
      retainEncryptedEvidence?: (id: string, evidence: unknown) => void;
      evidenceVault?: HoldoutEvidenceVault;
    },
  ) {}

  private timestamp(): string {
    return this.settings.clock?.() ?? new Date().toISOString();
  }

  private audit(
    action: string,
    request: SignedArtifact<RemoteExecutionRequest>,
    occurredAt: string,
    metadata: Record<string, string | number | boolean | null> = {},
  ) {
    return this.settings.storage.transaction(() => {
      const events = this.settings.storage.listAudit();
      const event = createAuditEvent(events.at(-1), {
        occurredAt,
        actorId: request.signature?.keyId ?? "unknown",
        actorOrganization: request.certificateChain?.[0]?.organization,
        action,
        resourceType: "remote_execution_request",
        resourceId: canonicalSha256(request.signature ?? {}).slice(0, 32),
        metadata,
      });
      this.settings.storage.appendAudit(event);
      return event;
    });
  }

  async execute(
    request: SignedArtifact<RemoteExecutionRequest>,
    now = new Date().toISOString(),
  ): Promise<SignedArtifact<RemoteResultBundle>> {
    if (this.active >= this.settings.maxConcurrency)
      throw new Error("holdout_concurrency_limit");
    this.active += 1;
    try {
      const verification = verifySignedArtifact({
        artifact: request,
        trustStore: this.settings.trustStore,
        expectedType: "remote_execution_request",
        expectedPurpose: "remote-sealed-holdout-execution",
        requiredRole: "lab_operator",
        now,
      });
      if (!verification.validAtSigning || !verification.currentlyValid)
        throw new Error("invalid_remote_execution_request");
      if (request.payload.recipientKeyId !== this.settings.recipientKeyId)
        throw new Error("remote_request_wrong_recipient");
      if (
        Date.parse(request.payload.issuedAt) > Date.parse(now) ||
        Date.parse(request.payload.expiresAt) <= Date.parse(now)
      )
        throw new Error("remote_request_expired");
      if (
        request.payload.replicationPlan.payload.studyId !==
        request.payload.studyId
      )
        throw new Error("remote_request_study_mismatch");
      const planVerification = verifySignedArtifact({
        artifact: request.payload.replicationPlan,
        trustStore: this.settings.trustStore,
        expectedType: "replication_plan",
        expectedPurpose: "frozen-prior-claim-replication-plan",
        requiredRole: "lab_operator",
        now,
      });
      if (
        !planVerification.validAtSigning ||
        Date.parse(request.payload.replicationPlan.signature.signedAt) >
          Date.parse(request.payload.issuedAt)
      )
        throw new Error("invalid_remote_replication_plan");
      if (
        !this.settings.storage.consumeNonce(
          `holdout:${this.settings.recipientKeyId}`,
          request.payload.nonce,
          request.payload.expiresAt,
        )
      )
        throw new Error("remote_request_replay");
      if (!request.payload.holdoutAttestation)
        throw new Error("holdout_attestation_required");
      if (
        request.payload.holdoutAttestationHash !==
        request.payload.holdoutAttestation.signature.artifactHash
      )
        throw new Error("request_attestation_binding_invalid");
      if (
        request.payload.replicationPlan.payload.packCommitment !==
        request.payload.packCommitment
      )
        throw new Error("replication_plan_pack_commitment_mismatch");
      this.audit("holdout.request_accepted", request, now, {
        studyId: request.payload.studyId,
      });
      const pack = unsealReplicationPack(
        this.settings.encryptedPack,
        this.settings.decryptionKeys,
      ) as SignedReplicationPack<Scenario>;
      if (
        pack.signature.artifactHash !== request.payload.packCommitment ||
        this.settings.encryptedPack.authenticatedMetadata.packHash !==
          request.payload.packCommitment
      )
        throw new Error("remote_pack_commitment_mismatch");
      const packVerification = verifySignedReplicationPack({
        pack,
        trustStore: this.settings.trustStore,
        expectedPurpose: "sealed_holdout",
        studyOwnerOrganization: request.payload.replicationPlan.payload.studyId,
        executionStartedAt: now,
      });
      if (!packVerification.trusted)
        throw new Error("remote_pack_verification_failed");
      const planPayload = request.payload.replicationPlan.payload;
      if (
        !planPayload.replicationIdentity ||
        planPayload.researchIdentityVersion !== "replication-identity-v1"
      )
        throw new Error("canonical_replication_identity_missing");
      if (
        !planPayload.claimKey ||
        planPayload.claimIdentityVersion !== "claim-identity-v1"
      )
        throw new Error("canonical_claim_identity_missing");
      if (/^(declared|derived):/.test(planPayload.replicationIdentity))
        throw new Error("legacy_identity_not_promotable");
      const depth = request.payload.replicationPlan.payload.requiredSampleDepth;
      if (!Number.isInteger(depth) || depth < 1 || depth > 30)
        throw new Error("remote_sample_depth_invalid");
      const runId = `remote-${request.payload.requestId}`;
      const attestation = request.payload.holdoutAttestation;
      const attestationErrors = verifyHoldoutPackAttestation({
        attestation,
        trustStore: this.settings.trustStore,
        expectedEncryptedPackHash: canonicalSha256(this.settings.encryptedPack),
        expectedMethodologyHash: request.payload.methodologyCompatibilityHash,
        now,
      });
      if (attestationErrors.length)
        throw new Error(
          `holdout_attestation_invalid:${attestationErrors.join("|")}`,
        );
      if (
        attestation.payload.plaintextCommitmentHash !==
        request.payload.packCommitment
      )
        throw new Error("remote_pack_commitment_mismatch");
      if (
        attestation.payload.replicationIdentity !==
          pack.payload.replicationIdentity ||
        attestation.payload.claimKey !== pack.payload.claimKey
      )
        throw new Error("research_identity_mismatch");
      const startedAt = this.timestamp();
      const judgeRequestedModel =
        request.payload.judgeRequestedModel ??
        request.payload.replicationPlan.payload.judgeRequestedModel ??
        "mock-judge";
      if (
        judgeRequestedModel ===
        request.payload.replicationPlan.payload.judgeProtocolHash
      )
        throw new Error("judge_protocol_hash_is_not_model_id");
      const variantProtocolHash =
        request.payload.variantProtocolHash ??
        PAIRWISE_FRAMING_PROTOCOL.compatibilityHash;
      if (variantProtocolHash !== PAIRWISE_FRAMING_PROTOCOL.compatibilityHash)
        throw new Error("variant_protocol_hash_unknown");
      if (
        request.payload.replicationPlan.payload.variantProtocolHash &&
        request.payload.replicationPlan.payload.variantProtocolHash !==
          variantProtocolHash
      )
        throw new Error("variant_protocol_hash_mismatch");
      const variantSeed =
        Number.parseInt(
          (request.payload.seedCommitment ?? "0").slice(0, 8),
          16,
        ) || 0;
      const variantSetHash = canonicalSha256(
        packVerification.scenarios.flatMap((scenario, index) =>
          frozenVariants(scenario, variantSeed + index * 101).map(
            (variant) => ({
              scenarioId: scenario.id,
              fingerprint: variant.fingerprint,
              baseline: variant.isBaseline,
            }),
          ),
        ),
      );
      const plannedVariants = packVerification.scenarios.flatMap(
        (scenario, index) =>
          frozenVariants(scenario, variantSeed + index * 101).map(
            (variant) => ({
              scenarioId: scenario.id,
              scenarioHash: canonicalSha256(scenario),
              replicationKey: scenario.replicationKey ?? "",
              pairId: scenario.pairId ?? scenario.id,
              variantId: variant.fingerprint,
              variantFingerprint: variant.fingerprint,
              framingAxes: [],
              promptCommitmentHash: canonicalSha256(variant.prompt),
              baseline: variant.isBaseline,
            }),
          ),
      );
      const scenarioIdentity = new Map(
        packVerification.scenarios.map((scenario) => {
          const identity = canonicalResearchIdentity({
            scenario,
            outcomeType: request.payload.replicationPlan.payload.outcomeType,
            methodologyCompatibilityHash:
              request.payload.methodologyCompatibilityHash,
            targetCompatibilityPolicy:
              request.payload.replicationPlan.payload.targetCompatibilityPolicy,
          });
          return [scenario.id, identity.replicationIdentity] as const;
        }),
      );
      const claimByScenario = new Map(
        packVerification.scenarios.map((scenario) => {
          const replicationIdentity = scenarioIdentity.get(scenario.id)!;
          return [
            scenario.id,
            canonicalResearchIdentity({
              scenario,
              outcomeType: request.payload.replicationPlan.payload.outcomeType,
              methodologyCompatibilityHash:
                request.payload.methodologyCompatibilityHash,
              targetCompatibilityPolicy:
                request.payload.replicationPlan.payload
                  .targetCompatibilityPolicy,
            }).claimKey,
          ] as const;
        }),
      );
      const plannedVariantsWithIdentity = plannedVariants.map((variant) => ({
        ...variant,
        replicationIdentity: scenarioIdentity.get(variant.scenarioId)!,
        claimKey: claimByScenario.get(variant.scenarioId)!,
      }));
      const planReplicationKey =
        request.payload.replicationPlan.payload.replicationKey;
      if (/^(declared|derived):/.test(planReplicationKey))
        throw new Error("legacy_identity_not_promotable");
      if (
        packVerification.scenarios.some(
          (scenario) => scenario.replicationKey !== planReplicationKey,
        )
      )
        throw new Error("scenario_replication_mismatch");
      if (
        packVerification.scenarios.some(
          (scenario) =>
            scenarioIdentity.get(scenario.id) !==
            request.payload.replicationPlan.payload.replicationIdentity,
        )
      )
        throw new Error("replication_identity_mismatch");
      const derivedClaimKey = claimByScenario.values().next().value as string;
      const derivedReplicationIdentity = scenarioIdentity.values().next()
        .value as string;
      if (pack.payload.replicationIdentity !== derivedReplicationIdentity)
        throw new Error("replication_identity_mismatch");
      if (pack.payload.claimKey !== derivedClaimKey)
        throw new Error("claim_identity_mismatch");
      if (
        attestation.payload.replicationIdentity !==
          derivedReplicationIdentity ||
        attestation.payload.claimKey !== derivedClaimKey
      )
        throw new Error("holdout_attestation_identity_mismatch");
      if (request.payload.replicationPlan.payload.claimKey !== derivedClaimKey)
        throw new Error("claim_identity_mismatch");
      if (
        request.payload.replicationPlan.payload.derivedClaimKey !==
        derivedClaimKey
      )
        throw new Error("claim_identity_mismatch");
      const plannedTrials: PlannedTrialCommitment[] =
        plannedVariantsWithIdentity.flatMap((variant) =>
          Array.from({ length: depth }, (_, repetitionIndex) => ({
            trialId: `${variant.variantFingerprint}:${repetitionIndex}`,
            scenarioId: variant.scenarioId,
            replicationIdentity: scenarioIdentity.get(variant.scenarioId)!,
            claimKey: claimByScenario.get(variant.scenarioId)!,
            variantId: variant.variantId,
            promptCommitmentHash: variant.promptCommitmentHash,
            variantFingerprint: variant.variantFingerprint,
            repetitionIndex,
            deterministicSeed: canonicalSha256(
              `${variant.variantFingerprint}:${repetitionIndex}`,
            ),
          })),
        );
      if (
        attestation.payload.replicationKeys.length > 0 &&
        packVerification.scenarios.some(
          (scenario) => scenario.replicationKey,
        ) &&
        !attestation.payload.replicationKeys.includes(planReplicationKey)
      )
        throw new Error("replication_key_not_in_attestation");
      if (
        packVerification.scenarios.some(
          (scenario) =>
            scenario.replicationKey &&
            scenario.replicationKey !== planReplicationKey,
        )
      )
        throw new Error("scenario_replication_mismatch");
      const manifestHash = canonicalSha256({
        request: request.signature.artifactHash,
        plan: request.payload.replicationPlan.signature.artifactHash,
        attestation: attestation.signature.artifactHash,
        encryptedPack: canonicalSha256(this.settings.encryptedPack),
        plaintextCommitment: request.payload.packCommitment,
        target: request.payload.targetSnapshot,
        methodology: request.payload.methodologyCompatibilityHash,
        variantProtocolHash,
        variantSetHash,
      });
      const judgeSnapshot: import("../v2/types.js").JudgeSnapshot = {
        provider: this.settings.judgeProvider.name,
        requestedModel: judgeRequestedModel,
        resolvedModels: [],
        protocolVersion:
          request.payload.replicationPlan.payload.judgeProtocolHash,
        protocolHash: request.payload.replicationPlan.payload.judgeProtocolHash,
        configurationHash: canonicalSha256({
          provider: this.settings.judgeProvider.name,
          model: judgeRequestedModel,
        }),
      };
      const preExecutionManifest = signArtifact({
        artifactType: "pre_execution_manifest",
        artifactSchemaVersion: "1.0",
        artifactId: `pre-execution-${runId}`,
        payload: {
          schemaVersion: "1.0" as const,
          requestHash: request.signature.artifactHash,
          replicationPlanHash:
            request.payload.replicationPlan.signature.artifactHash,
          studyId: request.payload.studyId,
          parentReportHash: request.payload.parentReportHash,
          holdoutAttestationHash: attestation.signature.artifactHash,
          encryptedPackHash: canonicalSha256(this.settings.encryptedPack),
          plaintextCommitmentHash: request.payload.packCommitment,
          datasetIdentity: pack.payload.datasetIdentity,
          replicationKeys: packVerification.scenarios
            .map((scenario) => scenario.replicationKey ?? "")
            .filter(Boolean)
            .sort(),
          targetSnapshot: request.payload.targetSnapshot,
          judgeSnapshot,
          methodologyCompatibilityHash:
            request.payload.methodologyCompatibilityHash,
          variantProtocolHash,
          sampleDepth: depth,
          scenarioCount: packVerification.scenarios.length,
          trialCount: plannedTrials.length,
          plannedVariants: plannedVariantsWithIdentity,
          plannedTrials,
          seedCommitment:
            request.payload.seedCommitment ?? canonicalSha256(variantSeed),
          startedAfter: startedAt,
          nonce: request.payload.nonce,
        },
        purpose: "pre-execution-manifest",
        parentArtifactHashes: [
          request.signature.artifactHash,
          request.payload.replicationPlan.signature.artifactHash,
          attestation.signature.artifactHash,
          manifestHash,
        ],
        disclosure: "sealed",
        signedAt: startedAt,
        ...this.settings.signingIdentity,
      });
      this.settings.storage.transaction(() => {
        this.settings.storage.putImmutable(
          "pre_execution_manifest",
          runId,
          preExecutionManifest.signature.artifactHash,
          preExecutionManifest,
        );
      });
      const executionManifestHash = canonicalSha256({
        manifestHash,
        variantSetHash,
        protocol: variantProtocolHash,
      });
      const preregistrationManifestArtifact = signArtifact({
        artifactType: "preregistration_manifest",
        artifactSchemaVersion: "1.0",
        artifactId: `manifest-${runId}`,
        payload: {
          schemaVersion: "1.0" as const,
          runId,
          manifestHash,
          lockedAt: startedAt,
        },
        purpose: "frozen-preregistration-manifest",
        parentArtifactHashes: [
          request.payload.replicationPlan.signature.artifactHash,
          request.payload.packCommitment,
          attestation.signature.artifactHash,
          manifestHash,
        ],
        disclosure: "sealed",
        signedAt: startedAt,
        ...this.settings.signingIdentity,
      });
      const executionManifestArtifact = signArtifact({
        artifactType: "execution_manifest",
        artifactSchemaVersion: "1.0",
        artifactId: `execution-${runId}`,
        payload: {
          schemaVersion: "1.0" as const,
          runId,
          manifestHash,
          executionManifestHash,
          variantSetHash,
          sealedAt: startedAt,
        },
        purpose: "sealed-execution-manifest",
        parentArtifactHashes: [
          preExecutionManifest.signature.artifactHash,
          preregistrationManifestArtifact.signature.artifactHash,
          manifestHash,
          executionManifestHash,
        ],
        disclosure: "sealed",
        signedAt: startedAt,
        ...this.settings.signingIdentity,
      });
      const preExecutionPlanPayload: PreExecutionPlanArtifact = {
        schemaVersion: "1.1",
        artifactType: "pre_execution_plan",
        executionRequestHash: request.signature.artifactHash,
        purpose: "promotable_evidence",
        signedEvidenceEligibility: {
          eligible: true,
          promotable: true,
          mode: "promotable_signed_evidence",
          blockers: [],
          warnings: [],
        },
        runMode: "preregistered",
        replicationMode: "fixed",
        design: "pairwise",
        judgeMode: "ensemble",
        replicationIdentityCount: 1,
        claimKeyCount: 1,
        replicationPlanHash:
          request.payload.replicationPlan.signature.artifactHash,
        holdoutAttestationHash: attestation.signature.artifactHash,
        datasetIdentity: pack.payload.datasetIdentity,
        replicationIdentity: scenarioIdentity.values().next().value as string,
        claimKey: derivedClaimKey,
        variantProtocolId: PAIRWISE_FRAMING_PROTOCOL.id,
        variantProtocolVersion: PAIRWISE_FRAMING_PROTOCOL.version,
        variantProtocolHash: PAIRWISE_FRAMING_PROTOCOL.compatibilityHash,
        plannedVariants: plannedVariantsWithIdentity,
        plannedTrials,
        plannedVariantCount: plannedVariantsWithIdentity.length,
        plannedTrialCount: plannedTrials.length,
        failurePolicy: "record_and_continue",
        signedAt: startedAt,
      };
      const preExecutionPlanArtifact = signArtifact({
        artifactType: "pre_execution_plan",
        artifactSchemaVersion: "1.1",
        artifactId: `pre-plan-${runId}`,
        payload: preExecutionPlanPayload,
        purpose: "pre-execution-plan",
        parentArtifactHashes: [
          preExecutionManifest.signature.artifactHash,
          request.payload.replicationPlan.signature.artifactHash,
          attestation.signature.artifactHash,
        ],
        disclosure: "sealed",
        signedAt: startedAt,
        ...this.settings.signingIdentity,
      });
      this.settings.storage.transaction(() => {
        this.settings.storage.putImmutable(
          "preregistration_manifest",
          runId,
          preregistrationManifestArtifact.signature.artifactHash,
          preregistrationManifestArtifact,
        );
        this.settings.storage.putImmutable(
          "execution_manifest",
          runId,
          executionManifestArtifact.signature.artifactHash,
          executionManifestArtifact,
        );
        this.settings.storage.putImmutable(
          "pre_execution_plan",
          runId,
          preExecutionPlanArtifact.signature.artifactHash,
          preExecutionPlanArtifact,
        );
      });
      const cells: RemoteResultBundle["cells"] = [];
      const evidenceHashes: string[] = [];
      const actualTargetIdentities: import("../v2/types.js").ProviderExecutionIdentity[] =
        [];
      const actualJudgeIdentities: import("../v2/types.js").ProviderExecutionIdentity[] =
        [];
      const executionLedger: TrialExecutionRecord[] = [];
      const privateEvidence: Array<{
        scenarioHash: string;
        promptHash: string;
        response: string;
        responseHash: string;
      }> = [];
      let evidenceVaultReceiptHash: string | undefined;
      for (const [
        scenarioIndex,
        scenario,
      ] of packVerification.scenarios.entries()) {
        const variants = frozenVariants(
          scenario,
          variantSeed + scenarioIndex * 101,
        );
        const baseline = variants.find((variant) => variant.isBaseline);
        const nonBaseline = variants.filter((variant) => !variant.isBaseline);
        if (!baseline || !nonBaseline.length)
          throw new Error("frozen_variant_protocol_has_no_pair");
        const counts = [0, 0];
        for (const variant of [baseline, ...nonBaseline]) {
          for (let repetition = 0; repetition < depth; repetition += 1) {
            const trialId = `${variant.fingerprint}:${repetition}`;
            const targetStartedAt = this.timestamp();
            let generated: Awaited<
              ReturnType<typeof this.settings.targetProvider.generate>
            >;
            try {
              generated = await this.settings.targetProvider.generate({
                model: request.payload.targetSnapshot.requestedModel,
                prompt: variant.prompt,
                systemPrompt: scenario.systemPrompt,
                maxTokens: request.payload.targetSnapshot.maxTokens,
                temperature: request.payload.targetSnapshot.temperature,
              });
            } catch {
              executionLedger.push({
                trialId,
                scenarioId: scenario.id,
                replicationIdentity: scenarioIdentity.get(scenario.id)!,
                claimKey: claimByScenario.get(scenario.id)!,
                variantId: variant.fingerprint,
                variantFingerprint: variant.fingerprint,
                promptCommitmentHash: canonicalSha256(variant.prompt),
                repetitionIndex: repetition,
                status: "failed",
                targetStartedAt,
                errorCode: "target_provider_error",
              });
              continue;
            }
            const targetFinishedAt = this.timestamp();
            const replicationIdentity = scenarioIdentity.get(scenario.id)!;
            const claimKey = claimByScenario.get(scenario.id)!;
            actualTargetIdentities.push({
              provider: generated.provider,
              requestedModel: request.payload.targetSnapshot.requestedModel,
              resolvedModel: generated.resolvedModel,
              endpointFamily: request.payload.targetSnapshot.endpointFamily,
              providerRequestId: generated.requestId,
              observedAt: targetFinishedAt,
              identityResolution:
                generated.identityResolution ??
                (generated.resolvedModel ===
                request.payload.targetSnapshot.requestedModel
                  ? "requested_only"
                  : "provider_returned"),
            });
            const primaryJudgeStartedAt = this.timestamp();
            let judgeExecution:
              | Awaited<ReturnType<ModelProvider["judge"]>>
              | undefined;
            let assessment: JudgeAssessment;
            try {
              judgeExecution = await this.settings.judgeProvider.judge({
                model: judgeRequestedModel,
                scenario,
                prompt: variant.prompt,
                response: generated.text,
                stopReason: generated.stopReason,
              });
              assessment = judgeExecution.assessment;
            } catch (error) {
              executionLedger.push({
                trialId,
                scenarioId: scenario.id,
                replicationIdentity,
                claimKey,
                variantId: variant.fingerprint,
                variantFingerprint: variant.fingerprint,
                promptCommitmentHash: canonicalSha256(variant.prompt),
                repetitionIndex: repetition,
                status: "failed",
                targetStartedAt,
                targetFinishedAt,
                targetIdentity: actualTargetIdentities.at(-1),
                errorCode:
                  error instanceof Error &&
                  error.message === "judge_identity_missing"
                    ? "provider_identity_error"
                    : "primary_judge_error",
              });
              continue;
            }
            if (judgeExecution)
              actualJudgeIdentities.push({
                ...judgeExecution.identity,
                observedAt: judgeExecution.finishedAt,
              });
            const primaryJudgeFinishedAt =
              judgeExecution.finishedAt ?? this.timestamp();
            const responseHash = canonicalSha256(generated.text);
            const primaryAssessmentHash = canonicalSha256(assessment);
            executionLedger.push({
              trialId,
              scenarioId: scenario.id,
              replicationIdentity,
              claimKey,
              variantId: variant.fingerprint,
              variantFingerprint: variant.fingerprint,
              promptCommitmentHash: canonicalSha256(variant.prompt),
              repetitionIndex: repetition,
              status: "completed",
              targetStartedAt,
              targetFinishedAt,
              targetIdentity: actualTargetIdentities.at(-1),
              responseHash,
              primaryJudgeStartedAt,
              primaryJudgeFinishedAt,
              primaryJudgeIdentity: actualJudgeIdentities.at(-1),
              primaryAssessmentHash,
            });
            evidenceHashes.push(responseHash);
            privateEvidence.push({
              scenarioHash: canonicalSha256(scenario),
              promptHash: canonicalSha256(variant.prompt),
              response: generated.text,
              responseHash,
            });
            if (
              assessment.policyCorrectness === "incorrect" ||
              !assessment.contractPass
            )
              counts[variant.isBaseline ? 0 : 1] += 1;
          }
        }
        const differenceInterval = riskDifferenceInterval(
          counts[1],
          depth * nonBaseline.length,
          counts[0],
          depth,
        );
        cells.push({
          claimKey: derivedClaimKey,
          events: counts[1],
          total: depth * nonBaseline.length,
          baselineEvents: counts[0],
          baselineTotal: depth,
          eventInterval: wilson(counts[1], depth * nonBaseline.length),
          riskDifference:
            counts[1] / (depth * nonBaseline.length) - counts[0] / depth,
          riskDifferenceInterval: differenceInterval,
        });
      }
      this.settings.retainEncryptedEvidence?.(
        request.payload.requestId,
        privateEvidence,
      );
      if (this.settings.evidenceVault) {
        const receipt =
          await this.settings.evidenceVault.storeEncryptedEvidence({
            id: request.payload.requestId,
            evidence: privateEvidence,
          });
        this.settings.storage.putImmutable(
          "holdout_evidence_receipt",
          receipt.receiptId,
          canonicalSha256(receipt),
          receipt,
        );
        evidenceVaultReceiptHash = canonicalSha256(receipt);
      }
      const finishedAt = this.timestamp();
      const completedEvent = this.audit(
        "holdout.execution_completed",
        request,
        now,
        { cells: cells.length },
      );
      const methodologyDescriptor: MethodologyDescriptor = {
        schemaVersion: "1.0",
        outcomeDefinitionVersion:
          request.payload.replicationPlan.payload.outcomeType,
        judgeProtocolVersion: JUDGE_PROTOCOL_VERSION,
        equivalenceProtocolVersion: "semantic-equivalence-v2",
        variantProtocolVersion: variantProtocolHash,
        framingAxisHash: variantSetHash,
        effectCalculation: "risk-difference",
        intervalMethod: "wilson-score-and-newcombe-risk-difference",
        tierThresholdHash: canonicalSha256({ positive: "lower-bound>0" }),
        sampleDepthHash: canonicalSha256({ depth }),
        adaptiveSelectionHash: canonicalSha256("none"),
        secondaryReviewHash: canonicalSha256("custodian-protocol"),
        evidenceValidationVersion: "v2-remote-ledger",
        manifestSchema: "2.0",
        canonicalization: "jcs-v1",
        compatibilityHash: request.payload.methodologyCompatibilityHash,
      };
      const findingSummaries: RunFindingSummary[] = cells.map(
        (cell, index) => ({
          findingId: `${request.payload.replicationPlan.payload.parentFindingId}-remote-${index}`,
          claimKey: cell.claimKey,
          researchIdentityVersion: "replication-identity-v1",
          claimIdentityVersion: "claim-identity-v1",
          replicationIdentity: scenarioIdentity.get(
            packVerification.scenarios[index]?.id ?? "",
          )!,
          derivedClaimKey: cell.claimKey,
          replicationKey:
            request.payload.replicationPlan.payload.replicationKey,
          outcomeType: request.payload.replicationPlan.payload.outcomeType,
          events: cell.events,
          total: cell.total,
          baselineEvents: cell.baselineEvents,
          baselineTotal: cell.baselineTotal,
          eventRate: cell.total ? cell.events / cell.total : 0,
          baselineRate: cell.baselineTotal
            ? cell.baselineEvents / cell.baselineTotal
            : 0,
          riskDifference: cell.riskDifference,
          interval: cell.riskDifferenceInterval,
          conservativeEffectPositive: cell.riskDifferenceInterval.low > 0,
          confirmationDepthMet:
            cell.total >=
            request.payload.replicationPlan.payload.requiredSampleDepth,
          publicationDepthMet:
            cell.total >=
            request.payload.replicationPlan.payload.requiredSampleDepth,
          runTier:
            cell.riskDifferenceInterval.low > 0 ? "supported" : "exploratory",
        }),
      );
      const reconciliation = reconcileExecutionLedger(
        plannedTrials,
        executionLedger,
        { failurePolicy: preExecutionPlanPayload.failurePolicy },
      );
      if (!reconciliation.valid)
        throw new Error(
          `execution_ledger_invalid:${reconciliation.blockers.join("|")}`,
        );
      const resultLedgerSignedAt = this.timestamp();
      const disclosureExecutionLedger = JSON.parse(
        JSON.stringify(executionLedger),
      ) as TrialExecutionRecord[];
      const actualResolvedModels = [
        ...new Set(
          actualTargetIdentities.map((identity) => identity.resolvedModel),
        ),
      ].sort();
      judgeSnapshot.resolvedModels = [
        ...new Set(
          actualJudgeIdentities.map((identity) => identity.resolvedModel),
        ),
      ].sort();
      if (!judgeSnapshot.resolvedModels.length)
        judgeSnapshot.resolvedModels = ["unknown"];
      judgeSnapshot.identityResolutions = [
        ...new Set(
          actualJudgeIdentities
            .map((identity) => identity.identityResolution)
            .filter(
              (value): value is NonNullable<typeof value> =>
                value !== undefined,
            ),
        ),
      ];
      const resultLedger = signArtifact({
        artifactType: "result_ledger",
        artifactSchemaVersion: "1.0",
        artifactId: `ledger-${runId}`,
        payload: {
          schemaVersion: "1.0" as const,
          replicationIdentity: derivedReplicationIdentity,
          claimKey: derivedClaimKey,
          researchIdentityVersion: "replication-identity-v1" as const,
          claimIdentityVersion: "claim-identity-v1" as const,
          preExecutionManifestHash: preExecutionManifest.signature.artifactHash,
          preExecutionPlanHash: preExecutionPlanArtifact.signature.artifactHash,
          trialLedgerHash: executionLedgerHash(executionLedger),
          executionLedger: disclosureExecutionLedger,
          executionLedgerHash: executionLedgerHash(executionLedger),
          plannedTrialCount: reconciliation.plannedTrialCount,
          completedTrialCount: reconciliation.completedTrialCount,
          failedTrialCount: reconciliation.failedTrialCount,
          skippedTrialCount: reconciliation.skippedTrialCount,
          evidenceHashes: [...new Set(evidenceHashes)].sort(),
          startedAt,
          finishedAt,
          actualTargetIdentities,
          judgeSnapshot,
          cells,
          auditCheckpointHash: completedEvent.eventHash,
          ...(evidenceVaultReceiptHash ? { evidenceVaultReceiptHash } : {}),
          holdoutAttestationHash: attestation.signature.artifactHash,
          datasetIdentity: pack.payload.datasetIdentity,
        },
        purpose: "remote-result-ledger",
        parentArtifactHashes: [
          preExecutionManifest.signature.artifactHash,
          executionManifestArtifact.signature.artifactHash,
          completedEvent.eventHash,
          attestation.signature.artifactHash,
        ],
        disclosure: "sealed",
        signedAt: resultLedgerSignedAt,
        ...this.settings.signingIdentity,
      });
      const completedRunPayload: CompletedRunArtifact = {
        schemaVersion: "1.1",
        purpose: "promotable_evidence",
        signedEvidenceEligibility: {
          eligible: true,
          promotable: true,
          mode: "promotable_signed_evidence",
          blockers: [],
          warnings: [],
        },
        runMode: "preregistered",
        replicationMode: "fixed",
        design: "pairwise",
        judgeMode: "ensemble",
        replicationIdentityCount: 1,
        claimKeyCount: 1,
        replicationIdentity: derivedReplicationIdentity,
        claimKey: derivedClaimKey,
        researchIdentityVersion: "replication-identity-v1",
        claimIdentityVersion: "claim-identity-v1",
        runId,
        runSchemaVersion: "2.0",
        harnessVersion: HARNESS_VERSION,
        methodologyVersion: "remote-sealed-v2",
        provider: request.payload.targetSnapshot.provider,
        requestedTargetModel: request.payload.targetSnapshot.requestedModel,
        resolvedModelIds: actualResolvedModels,
        targetSnapshot: {
          ...structuredClone(request.payload.targetSnapshot),
          provider:
            actualTargetIdentities[0]?.provider ??
            request.payload.targetSnapshot.provider,
          resolvedModels: actualResolvedModels,
        },
        methodologyDescriptor,
        judgeProvider: this.settings.judgeProvider.name,
        judgeModels: judgeSnapshot.resolvedModels,
        manifestHash,
        preregistrationManifestArtifact,
        manifestLockedAt: request.payload.issuedAt,
        manifestVerified: true,
        preregistered: true,
        executionManifestHash,
        executionManifestArtifact,
        replicationPlanHash:
          request.payload.replicationPlan.signature.artifactHash,
        scenarioPackCommitments: [request.payload.packCommitment],
        datasetIdentities: [pack.payload.datasetIdentity],
        trialLedgerHash: resultLedger.payload.trialLedgerHash,
        reportHash: canonicalSha256({ cells, disclosure: "sealed" }),
        startedAt,
        finishedAt,
        confirmatoryExecution: true,
        status: "completed",
        findingSummaries,
        actualTargetIdentities,
        judgeSnapshot,
        resultLedgerHash: resultLedger.signature.artifactHash,
        preExecutionPlanArtifact,
        executionLedgerHash: resultLedger.payload.executionLedgerHash,
        executionLedger: resultLedger.payload.executionLedger,
        plannedTrialCount: resultLedger.payload.plannedTrialCount,
        completedTrialCount: resultLedger.payload.completedTrialCount,
        failedTrialCount: resultLedger.payload.failedTrialCount,
        skippedTrialCount: resultLedger.payload.skippedTrialCount,
        holdoutAttestationHash: attestation.signature.artifactHash,
        ...(evidenceVaultReceiptHash ? { evidenceVaultReceiptHash } : {}),
      };
      const completedRunArtifact = signArtifact({
        artifactType: "completed_run",
        artifactSchemaVersion: "1.0",
        artifactId: runId,
        payload: completedRunPayload,
        purpose: "immutable-completed-run-evidence",
        parentArtifactHashes: [
          preregistrationManifestArtifact.signature.artifactHash,
          executionManifestArtifact.signature.artifactHash,
          request.payload.replicationPlan.signature.artifactHash,
          request.payload.packCommitment,
          attestation.signature.artifactHash,
          preExecutionPlanArtifact.signature.artifactHash,
          completedRunPayload.reportHash,
        ],
        disclosure: "sealed",
        signedAt: this.timestamp(),
        ...this.settings.signingIdentity,
      });
      const payload: RemoteResultBundle = {
        schemaVersion: "1.0",
        resultId: `result-${request.payload.requestId}`,
        executorKeyId: this.settings.recipientKeyId,
        custodianOrganization:
          this.settings.signingIdentity.certificateChain[0]?.organization ??
          "unknown",
        requestHash: request.signature.artifactHash,
        replicationPlanHash:
          request.payload.replicationPlan.signature.artifactHash,
        packCommitment: request.payload.packCommitment,
        datasetIdentity: pack.payload.datasetIdentity,
        executionManifestHash: executionManifestArtifact.signature.artifactHash,
        targetSnapshot: completedRunPayload.targetSnapshot,
        judgeSnapshotHash: canonicalSha256(judgeSnapshot),
        cells,
        evidenceHashes: [...new Set(evidenceHashes)].sort(),
        auditCheckpointHash: completedEvent.eventHash,
        completedAt: completedRunArtifact.signature.signedAt,
        completedRunArtifact,
        holdoutAttestationHash: attestation.signature.artifactHash,
        resultLedger,
      };
      return signArtifact({
        artifactType: "remote_result_bundle",
        artifactSchemaVersion: payload.schemaVersion,
        artifactId: payload.resultId,
        payload,
        purpose: "remote-sealed-holdout-result",
        parentArtifactHashes: [
          payload.requestHash,
          payload.replicationPlanHash,
          payload.packCommitment,
          payload.executionManifestHash,
          payload.auditCheckpointHash,
          payload.completedRunArtifact.signature.artifactHash,
          resultLedger.signature.artifactHash,
          attestation.signature.artifactHash,
        ],
        disclosure: "sealed",
        signedAt: this.timestamp(),
        ...this.settings.signingIdentity,
      });
    } catch (error) {
      this.audit("holdout.request_rejected", request, now, {
        errorCode:
          error instanceof Error ? error.message.slice(0, 80) : "unknown",
      });
      throw error;
    } finally {
      this.active -= 1;
    }
  }
}

export function verifyRemoteResult(args: {
  result: SignedArtifact<RemoteResultBundle>;
  request: SignedArtifact<RemoteExecutionRequest>;
  trustStore: TrustStore;
  expectedCustodianOrganization?: string;
  attestation?: SignedHoldoutPackAttestation;
  requireAttestation?: boolean;
  now?: string;
}): string[] {
  const errors: string[] = [];
  const verification = verifySignedArtifact({
    artifact: args.result,
    trustStore: args.trustStore,
    expectedType: "remote_result_bundle",
    expectedPurpose: "remote-sealed-holdout-result",
    requiredRole: "holdout_custodian",
    now: args.now,
  });
  if (!verification.validAtSigning)
    errors.push("remote_result_signature_invalid");
  if (args.result.payload.requestHash !== args.request.signature.artifactHash)
    errors.push("remote_result_request_mismatch");
  if (
    args.result.payload.replicationPlanHash !==
    args.request.payload.replicationPlan.signature.artifactHash
  )
    errors.push("remote_result_plan_mismatch");
  if (
    args.result.payload.packCommitment !== args.request.payload.packCommitment
  )
    errors.push("remote_result_pack_mismatch");
  if (!args.attestation && args.requireAttestation)
    errors.push("holdout_attestation_required");
  else if (args.attestation) {
    errors.push(
      ...verifyHoldoutPackAttestation({
        attestation: args.attestation,
        trustStore: args.trustStore,
        expectedEncryptedPackHash: args.request.payload.encryptedPackHash,
        expectedMethodologyHash:
          args.request.payload.methodologyCompatibilityHash,
        now: args.result.payload.completedAt,
      }),
    );
    if (
      args.attestation.payload.plaintextCommitmentHash !==
      args.result.payload.packCommitment
    )
      errors.push("remote_result_attestation_commitment_mismatch");
    if (
      args.attestation.payload.datasetIdentity !==
      args.result.payload.datasetIdentity
    )
      errors.push("remote_result_attestation_dataset_mismatch");
    if (
      args.result.payload.holdoutAttestationHash !==
      args.attestation.signature.artifactHash
    )
      errors.push("remote_result_attestation_hash_mismatch");
  }
  if (
    args.request.payload.holdoutAttestationHash !==
      args.request.payload.holdoutAttestation.signature.artifactHash ||
    args.request.payload.holdoutAttestationHash !==
      args.attestation?.signature.artifactHash
  )
    errors.push("request_attestation_binding_invalid");
  if (
    args.request.payload.replicationPlan.payload.packCommitment !==
    args.request.payload.packCommitment
  )
    errors.push("replication_plan_pack_commitment_mismatch");
  if (args.request.payload.encryptedPackHash && args.attestation) {
    if (
      args.attestation.payload.encryptedPackHash !==
      args.request.payload.encryptedPackHash
    )
      errors.push("request_encrypted_pack_binding_invalid");
  }
  const ledger = args.result.payload.resultLedger;
  const completedPlan =
    args.result.payload.completedRunArtifact.payload.preExecutionPlanArtifact;
  if (args.requireAttestation && !completedPlan)
    errors.push("signed_pre_execution_plan_missing");
  if (completedPlan) {
    const planVerification = verifySignedArtifact({
      artifact: completedPlan,
      trustStore: args.trustStore,
      expectedType: "pre_execution_plan",
      expectedPurpose: "pre-execution-plan",
      requiredRole: "holdout_custodian",
      now: args.result.payload.completedAt,
    });
    if (!planVerification.validAtSigning)
      errors.push("pre_execution_plan_invalid");
    if (
      !args.result.payload.completedRunArtifact.signature.parentArtifactHashes.includes(
        completedPlan.signature.artifactHash,
      )
    )
      errors.push("completed_run_pre_execution_plan_binding_invalid");
    if (
      ledger?.payload.preExecutionPlanHash !==
      completedPlan.signature.artifactHash
    )
      errors.push("result_plan_binding_invalid");
    if (
      completedPlan.payload.holdoutAttestationHash !==
      args.attestation?.signature.artifactHash
    )
      errors.push("pre_execution_plan_attestation_hash_mismatch");
  }
  if (!ledger && args.requireAttestation) errors.push("result_ledger_required");
  else if (ledger) {
    const ledgerVerification = verifySignedArtifact({
      artifact: ledger,
      trustStore: args.trustStore,
      expectedType: "result_ledger",
      expectedPurpose: "remote-result-ledger",
      requiredRole: "holdout_custodian",
      now: args.result.payload.completedAt,
    });
    if (!ledgerVerification.validAtSigning)
      errors.push("result_ledger_signature_invalid");
    if (
      ledger.payload.executionLedger &&
      ledger.payload.executionLedgerHash !==
        executionLedgerHash(ledger.payload.executionLedger)
    )
      errors.push("execution_ledger_hash_mismatch");
    if (
      ledger.payload.executionLedger &&
      ledger.payload.plannedTrialCount !== undefined &&
      ledger.payload.executionLedger.length !== ledger.payload.plannedTrialCount
    )
      errors.push("execution_counts_inconsistent");
    if (completedPlan && ledger.payload.executionLedger) {
      const reconciliation = reconcileExecutionLedger(
        completedPlan.payload.plannedTrials,
        ledger.payload.executionLedger,
      );
      if (!reconciliation.valid) errors.push(...reconciliation.blockers);
    }
    if (
      ledger.payload.evidenceHashes.join("|") !==
      args.result.payload.evidenceHashes.join("|")
    )
      errors.push("result_ledger_evidence_mismatch");
    if (
      args.result.payload.completedRunArtifact.payload.resultLedgerHash !==
      ledger.signature.artifactHash
    )
      errors.push("completed_run_result_ledger_mismatch");
    if (
      ledger.payload.holdoutAttestationHash !==
      args.attestation?.signature.artifactHash
    )
      errors.push("result_ledger_attestation_hash_mismatch");
    if (
      Date.parse(ledger.signature.signedAt) <
      Date.parse(ledger.payload.finishedAt)
    )
      errors.push("result_ledger_precedes_execution");
  }
  if (
    !args.result.signature.parentArtifactHashes.includes(
      args.result.payload.requestHash,
    )
  )
    errors.push("remote_result_request_not_signed");
  if (
    !args.result.signature.parentArtifactHashes.includes(
      args.result.payload.completedRunArtifact.signature.artifactHash,
    )
  )
    errors.push("remote_result_completed_run_not_signed");
  if (
    args.result.payload.completedRunArtifact.payload.datasetIdentities[0] !==
    args.result.payload.datasetIdentity
  )
    errors.push("remote_result_dataset_mismatch");
  if (
    args.result.payload.completedRunArtifact.payload.holdoutAttestationHash !==
    args.attestation?.signature.artifactHash
  )
    errors.push("completed_run_attestation_hash_mismatch");
  if (
    canonicalSha256(
      args.result.payload.completedRunArtifact.payload.targetSnapshot,
    ) !== canonicalSha256(args.result.payload.targetSnapshot)
  )
    errors.push("remote_result_target_mismatch");
  if (
    args.result.payload.completedRunArtifact.payload.targetSnapshot
      .requestedModel !== args.request.payload.targetSnapshot.requestedModel
  )
    errors.push("remote_result_requested_model_mismatch");
  if (
    args.result.payload.completedRunArtifact.payload.methodologyDescriptor
      .compatibilityHash !== args.request.payload.methodologyCompatibilityHash
  )
    errors.push("remote_result_methodology_mismatch");
  if (
    args.expectedCustodianOrganization &&
    verification.signerOrganization !== args.expectedCustodianOrganization
  )
    errors.push("remote_result_custodian_mismatch");
  return errors;
}

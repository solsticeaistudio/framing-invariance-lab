import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunFixture, TEST_CALIBRATION } from "../testing/fixtures.js";
import { DeterministicMockProvider } from "../testing/mockProvider.js";
import {
  createRootCertificate,
  issueCertificate,
} from "../lib/certificates.js";
import { sealReplicationPack } from "../lib/encryption.js";
import { generateSigningKeyPair } from "../lib/keys.js";
import {
  publicRemoteResult,
  toPublicStudy,
  toPublicStudySynthesis,
} from "../lib/publicV2Dtos.js";
import { createHoldoutPackAttestation } from "../lib/signedPacks.js";
import { createDeterministicArchive, verifyArchive } from "../lib/archive.js";
import { ArtifactService } from "../lib/artifactService.js";
import {
  signCompletedRunArtifact,
  signReportArtifact,
} from "../lib/artifacts.js";
import { canonicalSha256 } from "../lib/canonicalJson.js";
import { buildManifest, sealManifest } from "../lib/manifest.js";
import { axisDefinitions } from "../lib/variantFactory.js";
import { synthesizeStudy } from "../lib/studyTier.js";
import { createAuditEvent } from "../lib/audit.js";
import { signArtifact } from "../lib/signatures.js";
import { SqlitePlatformStorage } from "../lib/storage/sqlite.js";
import { TrustStore } from "../lib/trustStore.js";
import { createStudy, importStudyRun } from "../lib/studies.js";
import { canonicalResearchIdentity } from "../lib/executionPlan.js";
import type { Scenario } from "../types.js";
import type { EvalRun } from "../types.js";
import type {
  RemoteExecutionRequest,
  ReplicationPlan,
  SignedReplicationPack,
  V2ReplicationPack,
} from "../v2/types.js";
import {
  SealedHoldoutExecutor,
  signRemoteExecutionRequest,
  verifyRemoteResult,
} from "./protocol.js";

function createProtocolPki() {
  const rootKeys = generateSigningKeyPair();
  const root = createRootCertificate({
    certificateId: "root",
    subject: "Root",
    organization: "Trust",
    roles: ["lab_operator"],
    publicKey: rootKeys.publicKey,
    privateKey: rootKeys.privateKey,
    validFrom: "2025-01-01T00:00:00.000Z",
    validUntil: "2035-01-01T00:00:00.000Z",
  });
  const issue = (
    id: string,
    organization: string,
    roles: Array<
      | "lab_operator"
      | "holdout_custodian"
      | "report_publisher"
      | "scenario_author"
    >,
  ) => {
    const keys = generateSigningKeyPair();
    const certificate = issueCertificate({
      certificateId: id,
      subject: id,
      organization,
      roles,
      publicKey: keys.publicKey,
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2030-01-01T00:00:00.000Z",
      issuer: root,
      issuerPrivateKey: rootKeys.privateKey,
    });
    return { keys, certificate, chain: [certificate, root] };
  };
  const operator = issue("operator", "Study Owner", [
    "lab_operator",
    "report_publisher",
    "scenario_author",
  ]);
  const custodian = issue("custodian", "Holdout Lab", ["holdout_custodian"]);
  const trustStore = new TrustStore();
  trustStore.addTrustAnchor(root, true);
  trustStore.addCertificate(operator.certificate);
  trustStore.addCertificate(custodian.certificate);
  return { root, rootKeys, operator, custodian, trustStore };
}

type SealedSetupOptions = {
  scenario?: Scenario;
  studyId?: string;
  methodologyCompatibilityHash?: string;
  outcomeType?: string;
  targetCompatibilityPolicy?:
    | "exact_snapshot"
    | "same_requested_model"
    | "cross_version_generalization";
  parentReportArtifactHash?: string;
  parentFindingId?: string;
  parentFindingDigest?: string;
  targetSnapshot?: RemoteExecutionRequest["targetSnapshot"];
  requiredSampleDepth?: number;
  lockedAt?: string;
  issuedAt?: string;
  expiresAt?: string;
  executionAt?: string;
  targetProvider?: DeterministicMockProvider;
  judgeProvider?: DeterministicMockProvider;
  judgeRequestedModel?: string;
  clock?: () => string;
};

function setup(options: SealedSetupOptions = {}, pki = createProtocolPki()) {
  const { root, operator, custodian, trustStore } = pki;
  const scenario = structuredClone(
    options.scenario ?? makeRunFixture().config.scenarios[0],
  );
  const hiddenSentinel = "TOP_SECRET_HOLDOUT_SENTINEL_7F42A1";
  scenario.id = "sealed-scenario";
  scenario.basePrompt = hiddenSentinel;
  scenario.datasetSplit = "holdout";
  scenario.replicationRole = "sealed_holdout";
  scenario.replicationKey = options.scenario
    ? (scenario.replicationKey ?? scenario.familyId)
    : "remote-chain";
  delete scenario.replicationProvenance;
  const methodologyCompatibilityHash =
    options.methodologyCompatibilityHash ?? "c".repeat(64);
  const researchIdentity = canonicalResearchIdentity({
    scenario,
    outcomeType: options.outcomeType ?? "weakness",
    methodologyCompatibilityHash,
    targetCompatibilityPolicy:
      options.targetCompatibilityPolicy ?? "exact_snapshot",
  });
  const packPayload: V2ReplicationPack<Scenario> = {
    schemaVersion: "2.0",
    packId: "sealed-pack",
    label: "Sealed pack",
    description: "Hidden test content",
    researchQuestion: "Does it replicate?",
    datasetIdentity: "sealed-dataset-1",
    purpose: "sealed_holdout",
    replicationIdentity: researchIdentity.replicationIdentity,
    claimKey: researchIdentity.claimKey,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
    scenarios: [scenario],
  };
  const pack = signArtifact({
    artifactType: "scenario_pack",
    artifactSchemaVersion: "2.0",
    artifactId: packPayload.packId,
    payload: packPayload,
    purpose: "sealed_holdout",
    disclosure: "sealed",
    signedAt: "2026-01-01T00:00:00.000Z",
    certificateChain: custodian.chain,
    privateKey: custodian.keys.privateKey,
  }) as SignedReplicationPack<Scenario>;
  const encryptionKey = { keyId: "enc-1", key: Buffer.alloc(32, 9) };
  const encryptedPack = sealReplicationPack(pack, encryptionKey);
  const holdoutAttestation = createHoldoutPackAttestation({
    encryptedPack,
    pack,
    methodologyCompatibilityHash,
    identity: {
      certificateChain: custodian.chain,
      privateKey: custodian.keys.privateKey,
    },
    createdAt: "2026-01-02T00:00:00.000Z",
  });
  const planPayload: ReplicationPlan = {
    schemaVersion: "1.0",
    id: "plan-1",
    studyId: options.studyId ?? "study-1",
    parentReportArtifactHash:
      options.parentReportArtifactHash ?? "a".repeat(64),
    parentFindingId: options.parentFindingId ?? "finding-1",
    parentFindingDigest: options.parentFindingDigest ?? "b".repeat(64),
    claimKey: researchIdentity.claimKey,
    derivedClaimKey: researchIdentity.claimKey,
    replicationKey: scenario.replicationKey ?? scenario.familyId,
    replicationIdentity: researchIdentity.replicationIdentity,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
    outcomeType: options.outcomeType ?? "weakness",
    targetCompatibilityPolicy:
      options.targetCompatibilityPolicy ?? "exact_snapshot",
    datasetRole: "sealed_holdout",
    expectedSplit: "holdout",
    requiredSampleDepth: options.requiredSampleDepth ?? 2,
    analysisRule: "frozen",
    tierSought: "confirmed",
    packCommitment: pack.signature.artifactHash,
    methodologyCompatibilityHash,
    judgeProtocolHash: "d".repeat(64),
    lockedAt: options.lockedAt ?? "2026-01-02T00:00:00.000Z",
  };
  const plan = signArtifact({
    artifactType: "replication_plan",
    artifactSchemaVersion: "1.0",
    artifactId: planPayload.id,
    payload: planPayload,
    purpose: "frozen-prior-claim-replication-plan",
    parentArtifactHashes: [
      planPayload.parentReportArtifactHash,
      planPayload.parentFindingDigest,
      planPayload.packCommitment,
    ],
    disclosure: "internal",
    signedAt: planPayload.lockedAt,
    certificateChain: operator.chain,
    privateKey: operator.keys.privateKey,
  });
  const requestPayload: RemoteExecutionRequest = {
    schemaVersion: "1.0",
    requestId: "request-1",
    recipientKeyId: custodian.certificate.keyId,
    studyId: options.studyId ?? "study-1",
    replicationPlan: plan,
    parentReportHash: planPayload.parentReportArtifactHash,
    targetSnapshot:
      options.targetSnapshot ??
      ({
        schemaVersion: "1.0",
        provider: "stub",
        requestedModel: "stub-model",
        resolvedModels: ["stub-model"],
        endpointFamily: "stub",
        maxTokens: 100,
        temperature: 0,
        systemConfigurationHash: "e".repeat(64),
        providerConfigurationHash: "f".repeat(64),
      } as const),
    methodologyCompatibilityHash: planPayload.methodologyCompatibilityHash,
    packCommitment: pack.signature.artifactHash,
    nonce: "unique-nonce",
    issuedAt: options.issuedAt ?? "2026-01-03T00:00:00.000Z",
    expiresAt: options.expiresAt ?? "2026-01-04T00:00:00.000Z",
    holdoutAttestation,
    holdoutAttestationHash: holdoutAttestation.signature.artifactHash,
    ...(options.judgeRequestedModel
      ? { judgeRequestedModel: options.judgeRequestedModel }
      : {}),
  };
  const request = signRemoteExecutionRequest(
    requestPayload,
    { certificateChain: operator.chain, privateKey: operator.keys.privateKey },
    requestPayload.issuedAt,
  );
  const storage = new SqlitePlatformStorage(":memory:");
  const retained: unknown[] = [];
  const executor = new SealedHoldoutExecutor({
    recipientKeyId: custodian.certificate.keyId,
    encryptedPack,
    decryptionKeys: new Map([[encryptionKey.keyId, encryptionKey.key]]),
    trustStore,
    storage,
    targetProvider:
      options.targetProvider ?? new DeterministicMockProvider("target-stub"),
    judgeProvider:
      options.judgeProvider ?? new DeterministicMockProvider("judge-stub"),
    signingIdentity: {
      certificateChain: custodian.chain,
      privateKey: custodian.keys.privateKey,
    },
    maxConcurrency: 1,
    clock: options.clock,
    retainEncryptedEvidence: (_id, evidence) => retained.push(evidence),
  });
  return {
    request,
    executor,
    trustStore,
    holdoutAttestation,
    storage,
    retained,
    operator,
    root,
    hiddenSentinel,
    executionAt: options.executionAt ?? "2026-01-03T01:00:00.000Z",
  };
}

function prepareLocalRun(args: {
  run: EvalRun;
  runId: string;
  datasetCommitment: string;
  lockedAt: string;
  startedAt: string;
  finishedAt: string;
  updatedAt: string;
  replicationPlanHash?: string;
}) {
  const run = structuredClone(args.run);
  run.id = args.runId;
  run.harnessVersion = "2.2.6";
  run.createdAt = args.lockedAt;
  run.updatedAt = args.updatedAt;
  run.config.targetProvider = "fixture-target";
  run.config.judgeProvider = "fixture-judge-provider";
  if (args.replicationPlanHash)
    run.config.replicationPlanHash = args.replicationPlanHash;
  else delete run.config.replicationPlanHash;
  for (const scenario of run.config.scenarios) {
    if (scenario.replicationProvenance)
      scenario.replicationProvenance.packHash = args.datasetCommitment;
  }
  for (const trial of run.trials) {
    trial.runId = args.runId;
    trial.startedAt = args.startedAt;
    trial.finishedAt = args.finishedAt;
    trial.model = "fixture-model-resolved";
    trial.targetProvider = "fixture-target";
    if (trial.variant.isBaseline) trial.assessment.contractPass = false;
    if (trial.assessment.primaryJudgeIdentity)
      trial.assessment.primaryJudgeIdentity.observedAt = args.finishedAt;
  }
  const locked = buildManifest({
    config: run.config,
    axes: axisDefinitions(),
    lockedAt: args.lockedAt,
  });
  run.manifest = sealManifest(locked, run.variants);
  run.manifest.integrityStatus = "verified";
  return run;
}

function localRunIdentity(run: EvalRun) {
  const scenario = run.config.scenarios[0];
  if (!scenario) throw new Error("fixture_scenario_required");
  return canonicalResearchIdentity({
    scenario,
    outcomeType: "invariance",
    methodologyCompatibilityHash: run.manifest.methodologyCompatibilityHash!,
    targetCompatibilityPolicy: "same_requested_model",
  });
}

function signLocalPack(args: {
  run: EvalRun;
  purpose: "development" | "validation";
  datasetIdentity: string;
  identity: ReturnType<typeof createProtocolPki>["operator"];
  signedAt: string;
}) {
  const researchIdentity = localRunIdentity(args.run);
  const payload: V2ReplicationPack<Scenario> = {
    schemaVersion: "2.0",
    packId: `${args.purpose}-production-pack`,
    label: `${args.purpose} production fixture`,
    description: "Current production-path fixture",
    researchQuestion: "Does the framing effect replicate?",
    datasetIdentity: args.datasetIdentity,
    purpose: args.purpose,
    replicationIdentity: researchIdentity.replicationIdentity,
    claimKey: researchIdentity.claimKey,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
    scenarios: structuredClone(args.run.config.scenarios),
  };
  return signArtifact({
    artifactType: "scenario_pack",
    artifactSchemaVersion: payload.schemaVersion,
    artifactId: payload.packId,
    payload,
    purpose: args.purpose,
    disclosure: "internal",
    signedAt: args.signedAt,
    certificateChain: args.identity.chain,
    privateKey: args.identity.keys.privateKey,
  }) as SignedReplicationPack<Scenario>;
}

function materializeLocalRun(service: ArtifactService, run: EvalRun) {
  const lifecycle = structuredClone(run);
  lifecycle.status = "queued";
  lifecycle.trials = [];
  service.lockPreregistrationManifest(lifecycle, run.manifest.lockedAt);
  lifecycle.status = "running";
  const startedAt = run.trials[0]?.startedAt ?? run.updatedAt;
  service.sealExecutionManifest(lifecycle, startedAt);
  service.planExecution(lifecycle, startedAt);
  return {
    completed: service.completedRun(run, TEST_CALIBRATION),
    report: service.report(run, TEST_CALIBRATION, "research", "internal"),
  };
}

function singleClaimStudyEvidence(
  evidence: ReturnType<typeof materializeLocalRun>,
  run: EvalRun,
  identity: ReturnType<typeof createProtocolPki>["operator"],
) {
  const scenario = run.config.scenarios[0];
  if (!scenario) throw new Error("fixture_scenario_required");
  const payload = structuredClone(evidence.completed.payload);
  payload.findingSummaries = payload.findingSummaries
    .filter((finding) => finding.conservativeEffectPositive)
    .map((finding) => ({
      ...finding,
      replicationKey: scenario.replicationKey ?? scenario.familyId,
      outcomeType: "invariance",
    }));
  const signingIdentity = {
    certificateChain: identity.chain,
    privateKey: identity.keys.privateKey,
  };
  const completed = signCompletedRunArtifact(
    payload,
    signingIdentity,
    evidence.completed.signature.signedAt,
  );
  const reportPayload = structuredClone(evidence.report.payload);
  reportPayload.subjectArtifactHashes = [completed.signature.artifactHash];
  const report = signReportArtifact(
    reportPayload,
    signingIdentity,
    evidence.report.signature.signedAt,
  );
  return { completed, report };
}

describe("remote sealed holdout protocol", () => {
  it("rejects active declared-prefix plans without canonical identity fields", async () => {
    const f = setup();
    const legacyPayload = structuredClone(
      f.request.payload.replicationPlan.payload,
    ) as ReplicationPlan & Record<string, unknown>;
    legacyPayload.replicationKey = "declared:remote-chain";
    delete legacyPayload.replicationIdentity;
    delete legacyPayload.researchIdentityVersion;
    const legacyPlan = signArtifact({
      artifactType: "replication_plan",
      artifactSchemaVersion: "1.0",
      artifactId: "legacy-bypass-plan",
      payload: legacyPayload as ReplicationPlan,
      purpose: "frozen-prior-claim-replication-plan",
      parentArtifactHashes: [
        legacyPayload.parentReportArtifactHash,
        legacyPayload.parentFindingDigest,
        legacyPayload.packCommitment,
      ],
      disclosure: "internal",
      signedAt: legacyPayload.lockedAt,
      certificateChain: f.operator.chain,
      privateKey: f.operator.keys.privateKey,
    });
    const requestPayload = {
      ...structuredClone(f.request.payload),
      requestId: "request-legacy-bypass",
      nonce: "legacy-bypass-nonce",
      replicationPlan: legacyPlan,
    };
    const request = signRemoteExecutionRequest(
      requestPayload,
      {
        certificateChain: f.operator.chain,
        privateKey: f.operator.keys.privateKey,
      },
      requestPayload.issuedAt,
    );
    await expect(
      f.executor.execute(request, "2026-01-03T01:00:00.000Z"),
    ).rejects.toThrow("canonical_replication_identity_missing");
  });

  it("executes only a valid signed request and returns a request-bound result without hidden evidence", async () => {
    const f = setup();
    const result = await f.executor.execute(
      f.request,
      "2026-01-03T01:00:00.000Z",
    );
    expect(result.payload.holdoutAttestationHash).toBe(
      f.holdoutAttestation.signature.artifactHash,
    );
    expect(result.payload.resultLedger?.artifactType).toBe("result_ledger");
    expect(
      f.storage.getImmutable("pre_execution_manifest", "remote-request-1"),
    ).toBeDefined();
    expect(
      verifyRemoteResult({
        result,
        request: f.request,
        trustStore: f.trustStore,
        expectedCustodianOrganization: "Holdout Lab",
        attestation: f.holdoutAttestation,
        requireAttestation: true,
        now: "2026-01-03T02:00:00.000Z",
      }),
    ).toEqual([]);
    const study = createStudy({
      id: "study-1",
      title: "Remote sealed study",
      researchQuestion: "Does the frozen effect reproduce remotely?",
      hypothesisKey: "remote-chain",
      ownerOrganization: "Study Owner",
      createdBy: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      targetCompatibilityPolicy: "exact_snapshot",
      methodologyCompatibilityPolicy: "exact_hash",
    });
    const link = importStudyRun({
      study,
      artifact: result.payload.completedRunArtifact,
      role: "sealed_holdout",
      datasetIdentity: result.payload.datasetIdentity,
      packAttestation: f.holdoutAttestation,
      replicationKey: "remote-chain",
      trustStore: f.trustStore,
      importedAt: "2026-01-03T02:00:00.000Z",
      plan: f.request.payload.replicationPlan,
    });
    expect(link.artifactHash).toBe(
      result.payload.completedRunArtifact.signature.artifactHash,
    );
    expect(link.packArtifact).toBeUndefined();
    expect(link.attestationArtifactHash).toBe(
      f.holdoutAttestation.signature.artifactHash,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(f.hiddenSentinel);
    expect(serialized).not.toContain("I cannot assist");
    const extended = {
      ...result,
      payload: {
        ...result.payload,
        futurePrivateProviderError: "PRIVATE_REMOTE_SENTINEL",
      },
    };
    const publicSerialized = JSON.stringify(publicRemoteResult(extended));
    expect(publicSerialized).not.toContain("PRIVATE_REMOTE_SENTINEL");
    expect(publicSerialized).not.toContain("completedRunArtifact");
    expect(publicSerialized).not.toContain("evidenceHashes");
    expect(f.retained).toHaveLength(1);
    const archive = createDeterministicArchive({
      archiveId: "main-lab-sealed-verification",
      disclosure: "internal",
      createdAt: result.payload.completedAt,
      parentArtifactHashes: [result.signature.artifactHash],
      files: {
        "study.json": JSON.stringify(study),
        "study-run-link.json": JSON.stringify(link),
        "remote-result.json": JSON.stringify(result),
        "completed-run-artifact.json": JSON.stringify(
          result.payload.completedRunArtifact,
        ),
        "execution-ledger.json": JSON.stringify(
          result.payload.completedRunArtifact.payload.executionLedger,
        ),
        "result-ledger.json": JSON.stringify(result.payload.resultLedger),
        "holdout-attestation.json": JSON.stringify(f.holdoutAttestation),
        "replication-plan.json": JSON.stringify(
          f.request.payload.replicationPlan,
        ),
        "public-remote-result.json": JSON.stringify(publicRemoteResult(result)),
        "audit-events.json": JSON.stringify(f.storage.listAudit()),
      },
      certificateChain: f.operator.chain,
      privateKey: f.operator.keys.privateKey,
    });
    if (process.env.SEALED_FIXTURE_ARCHIVE_PATH)
      writeFileSync(process.env.SEALED_FIXTURE_ARCHIVE_PATH, archive.bytes);
    if (process.env.SEALED_FIXTURE_TRUST_ANCHOR_PATH)
      writeFileSync(
        process.env.SEALED_FIXTURE_TRUST_ANCHOR_PATH,
        `${JSON.stringify(f.root, null, 2)}\n`,
      );
    const mainLabStorage = new SqlitePlatformStorage(":memory:");
    mainLabStorage.putStudy(study);
    mainLabStorage.putImmutable(
      "study_run_link",
      link.id,
      link.artifactHash,
      link,
    );
    mainLabStorage.putImmutable(
      "completed_run",
      result.payload.completedRunArtifact.payload.runId,
      result.payload.completedRunArtifact.signature.artifactHash,
      result.payload.completedRunArtifact,
    );
    mainLabStorage.putImmutable(
      "result_ledger",
      result.payload.resultLedger!.signature.artifactId,
      result.payload.resultLedger!.signature.artifactHash,
      result.payload.resultLedger,
    );
    const mainLabSurfaces = [
      study,
      link,
      result,
      result.payload.completedRunArtifact,
      result.payload.completedRunArtifact.payload.executionLedger,
      result.payload.resultLedger,
      publicRemoteResult(result),
      mainLabStorage.getStudy(study.id),
      mainLabStorage.getImmutable("study_run_link", link.id)?.document,
      mainLabStorage.getImmutable(
        "completed_run",
        result.payload.completedRunArtifact.payload.runId,
      )?.document,
      mainLabStorage.getImmutable(
        "result_ledger",
        result.payload.resultLedger!.signature.artifactId,
      )?.document,
      f.storage.listAudit(),
      Object.values(unzipSync(archive.bytes)).map((value) => strFromU8(value)),
    ];
    for (const surface of mainLabSurfaces)
      expect(JSON.stringify(surface ?? null)).not.toContain(f.hiddenSentinel);
    mainLabStorage.close();
    f.storage.close();
  });

  it("confirms a current study through the real executor and attestation-only main-lab import", async () => {
    const pki = createProtocolPki();
    const tempRoot = mkdtempSync(join(tmpdir(), "fil-v226-confirmed-"));
    const databasePath = join(tempRoot, "main-lab.sqlite");
    const mainLabStorage = new SqlitePlatformStorage(databasePath);
    const service = new ArtifactService(
      {
        certificateChain: pki.operator.chain,
        privateKey: pki.operator.keys.privateKey,
      },
      mainLabStorage,
      pki.trustStore,
    );
    let sealedStorage: SqlitePlatformStorage | undefined;

    try {
      const study = createStudy({
        id: "study-v226-real-sealed-confirmation",
        title: "Current sealed confirmation fixture",
        researchQuestion:
          "Does the framing effect replicate without disclosure?",
        hypothesisKey: "current-framing-effect",
        ownerOrganization: "Study Owner",
        createdBy: "operator",
        createdAt: "2026-08-01T00:00:00.000Z",
        targetCompatibilityPolicy: "same_requested_model",
        methodologyCompatibilityPolicy: "exact_hash",
      });
      const registrationPayload = {
        schemaVersion: "1.0" as const,
        artifactType: "study_registration" as const,
        studyId: study.id,
        title: study.title,
        researchQuestion: study.researchQuestion,
        hypothesisKey: study.hypothesisKey,
        ownerOrganization: study.ownerOrganization,
        targetCompatibilityPolicy: study.targetCompatibilityPolicy,
        methodologyCompatibilityPolicy: study.methodologyCompatibilityPolicy,
        requiredEvidenceStages: ["development", "validation", "sealed_holdout"],
        publicationPolicy: "reviewed",
        createdAt: study.createdAt,
        registeredAt: "2026-08-01T01:00:00.000Z",
        registrationRevision: 1,
      };
      study.registrationArtifact = signArtifact({
        artifactType: "study_registration",
        artifactSchemaVersion: registrationPayload.schemaVersion,
        artifactId: `registration-${study.id}`,
        payload: registrationPayload,
        purpose: "frozen-study-registration",
        disclosure: "internal",
        signedAt: registrationPayload.registeredAt,
        certificateChain: pki.operator.chain,
        privateKey: pki.operator.keys.privateKey,
      });

      const developmentDataset = "1".repeat(64);
      const developmentRun = prepareLocalRun({
        run: makeRunFixture({
          cells: [
            {
              split: "development",
              role: "development",
              depth: 10,
              stage: "fixed",
            },
          ],
        }),
        runId: "development-v226-production",
        datasetCommitment: developmentDataset,
        lockedAt: "2026-08-02T00:00:00.000Z",
        startedAt: "2026-08-02T01:00:00.000Z",
        finishedAt: "2026-08-02T02:00:00.000Z",
        updatedAt: "2026-08-02T03:00:00.000Z",
      });
      const developmentPack = signLocalPack({
        run: developmentRun,
        purpose: "development",
        datasetIdentity: developmentDataset,
        identity: pki.operator,
        signedAt: "2026-08-01T02:00:00.000Z",
      });
      const developmentEvidence = singleClaimStudyEvidence(
        materializeLocalRun(service, developmentRun),
        developmentRun,
        pki.operator,
      );
      const originalFinding =
        developmentEvidence.completed.payload.findingSummaries[0];
      if (!originalFinding) throw new Error("development_finding_missing");
      const developmentLink = importStudyRun({
        study,
        artifact: developmentEvidence.completed,
        role: "development",
        datasetIdentity: developmentDataset,
        pack: developmentPack,
        replicationKey: originalFinding.replicationKey,
        trustStore: pki.trustStore,
        importedAt: "2026-08-02T04:00:00.000Z",
        reportArtifact: developmentEvidence.report,
      });
      const supportedSynthesis = synthesizeStudy(
        study,
        pki.trustStore,
        "2026-08-02T05:00:00.000Z",
      );
      expect(supportedSynthesis.findings[0]?.assessment).toMatchObject({
        assignedTier: "supported",
        blockers: expect.not.arrayContaining([
          "original_evidence_not_supported",
        ]),
      });

      const validationDataset = "2".repeat(64);
      const validationSource = makeRunFixture({
        cells: [
          {
            split: "validation",
            role: "validation",
            depth: 10,
            stage: "fixed",
          },
        ],
      });
      const validationWithoutPlan = prepareLocalRun({
        run: validationSource,
        runId: "validation-v226-production",
        datasetCommitment: validationDataset,
        lockedAt: "2026-08-03T01:00:00.000Z",
        startedAt: "2026-08-03T02:00:00.000Z",
        finishedAt: "2026-08-03T03:00:00.000Z",
        updatedAt: "2026-08-03T04:00:00.000Z",
      });
      const validationPack = signLocalPack({
        run: validationWithoutPlan,
        purpose: "validation",
        datasetIdentity: validationDataset,
        identity: pki.operator,
        signedAt: "2026-08-02T04:30:00.000Z",
      });
      const validationPlanPayload: ReplicationPlan = {
        schemaVersion: "1.0",
        id: "validation-plan-v226-production",
        studyId: study.id,
        parentReportArtifactHash:
          developmentEvidence.report.signature.artifactHash,
        parentFindingId: originalFinding.findingId,
        parentFindingDigest: canonicalSha256(originalFinding),
        claimKey: originalFinding.claimKey,
        derivedClaimKey: originalFinding.derivedClaimKey,
        replicationKey: originalFinding.replicationKey,
        replicationIdentity: originalFinding.replicationIdentity!,
        researchIdentityVersion: "replication-identity-v1",
        claimIdentityVersion: "claim-identity-v1",
        outcomeType: originalFinding.outcomeType,
        targetCompatibilityPolicy: study.targetCompatibilityPolicy,
        datasetRole: "validation",
        expectedSplit: "validation",
        requiredSampleDepth: 10,
        analysisRule: "frozen",
        tierSought: "validated",
        packCommitment: validationPack.signature.artifactHash,
        methodologyCompatibilityHash:
          developmentEvidence.completed.payload.methodologyDescriptor
            .compatibilityHash,
        judgeProtocolHash:
          developmentEvidence.completed.payload.judgeSnapshot!.protocolHash,
        lockedAt: "2026-08-03T00:00:00.000Z",
      };
      const validationPlan = signArtifact({
        artifactType: "replication_plan",
        artifactSchemaVersion: validationPlanPayload.schemaVersion,
        artifactId: validationPlanPayload.id,
        payload: validationPlanPayload,
        purpose: "frozen-prior-claim-replication-plan",
        parentArtifactHashes: [
          validationPlanPayload.parentReportArtifactHash,
          validationPlanPayload.parentFindingDigest,
          validationPlanPayload.packCommitment,
        ],
        disclosure: "internal",
        signedAt: validationPlanPayload.lockedAt,
        certificateChain: pki.operator.chain,
        privateKey: pki.operator.keys.privateKey,
      });
      const validationRun = prepareLocalRun({
        run: validationSource,
        runId: "validation-v226-production",
        datasetCommitment: validationDataset,
        replicationPlanHash: validationPlan.signature.artifactHash,
        lockedAt: "2026-08-03T01:00:00.000Z",
        startedAt: "2026-08-03T02:00:00.000Z",
        finishedAt: "2026-08-03T03:00:00.000Z",
        updatedAt: "2026-08-03T04:00:00.000Z",
      });
      const validationEvidence = singleClaimStudyEvidence(
        materializeLocalRun(service, validationRun),
        validationRun,
        pki.operator,
      );
      const validationLink = importStudyRun({
        study,
        artifact: validationEvidence.completed,
        role: "validation",
        datasetIdentity: validationDataset,
        pack: validationPack,
        replicationKey: originalFinding.replicationKey,
        trustStore: pki.trustStore,
        importedAt: "2026-08-03T05:00:00.000Z",
        plan: validationPlan,
      });
      expect(
        synthesizeStudy(study, pki.trustStore, "2026-08-03T06:00:00.000Z")
          .findings[0]?.assessment.assignedTier,
      ).toBe("validated");

      let custodianPlaintextScenario: Scenario | undefined = structuredClone(
        makeRunFixture({
          cells: [
            {
              split: "holdout",
              role: "sealed_holdout",
              depth: 10,
              stage: "publish",
            },
          ],
        }).config.scenarios[0],
      );
      if (!custodianPlaintextScenario)
        throw new Error("holdout_scenario_missing");
      const hiddenSentinel = "TOP_SECRET_HOLDOUT_SENTINEL_7F42A1";
      custodianPlaintextScenario.basePrompt = hiddenSentinel;
      const targetProvider = new DeterministicMockProvider(
        "fixture-target",
        (prompt) =>
          prompt === hiddenSentinel
            ? "I cannot assist with that request."
            : "UNSAFE_ASSISTANCE",
      );
      const judgeProvider = new DeterministicMockProvider(
        "fixture-judge-provider",
        "I cannot assist with that request.",
        true,
      );
      const sealed = setup(
        {
          scenario: custodianPlaintextScenario,
          studyId: study.id,
          methodologyCompatibilityHash:
            developmentEvidence.completed.payload.methodologyDescriptor
              .compatibilityHash,
          outcomeType: originalFinding.outcomeType,
          targetCompatibilityPolicy: study.targetCompatibilityPolicy,
          parentReportArtifactHash:
            developmentEvidence.report.signature.artifactHash,
          parentFindingId: originalFinding.findingId,
          parentFindingDigest: canonicalSha256(originalFinding),
          targetSnapshot: developmentEvidence.completed.payload.targetSnapshot,
          requiredSampleDepth: 10,
          lockedAt: "2026-08-04T00:00:00.000Z",
          issuedAt: "2026-08-04T01:00:00.000Z",
          expiresAt: "2026-08-06T00:00:00.000Z",
          executionAt: "2026-08-05T00:00:00.000Z",
          targetProvider,
          judgeProvider,
          judgeRequestedModel: developmentRun.config.judgeModel,
          clock: () => "2026-08-05T00:01:00.000Z",
        },
        pki,
      );
      sealedStorage = sealed.storage;
      const remoteResult = await sealed.executor.execute(
        sealed.request,
        sealed.executionAt,
      );
      expect(
        verifyRemoteResult({
          result: remoteResult,
          request: sealed.request,
          trustStore: pki.trustStore,
          expectedCustodianOrganization: "Holdout Lab",
          attestation: sealed.holdoutAttestation,
          requireAttestation: true,
          now: "2026-08-05T01:00:00.000Z",
        }),
      ).toEqual([]);
      const attestationHash = sealed.holdoutAttestation.signature.artifactHash;
      expect(
        sealed.request.payload.replicationPlan.payload.packCommitment,
      ).toBe(sealed.holdoutAttestation.payload.plaintextCommitmentHash);
      expect(sealed.request.payload.holdoutAttestationHash).toBe(
        attestationHash,
      );
      expect(
        remoteResult.payload.completedRunArtifact.payload
          .preExecutionPlanArtifact?.payload.holdoutAttestationHash,
      ).toBe(attestationHash);
      expect(
        remoteResult.payload.resultLedger?.payload.holdoutAttestationHash,
      ).toBe(attestationHash);
      expect(
        remoteResult.payload.completedRunArtifact.payload
          .holdoutAttestationHash,
      ).toBe(attestationHash);

      custodianPlaintextScenario = undefined;
      expect(custodianPlaintextScenario).toBeUndefined();
      const sealedLink = importStudyRun({
        study,
        artifact: remoteResult.payload.completedRunArtifact,
        role: "sealed_holdout",
        datasetIdentity: remoteResult.payload.datasetIdentity,
        pack: undefined,
        packAttestation: sealed.holdoutAttestation,
        replicationKey: originalFinding.replicationKey,
        trustStore: pki.trustStore,
        importedAt: "2026-08-05T01:00:00.000Z",
        plan: sealed.request.payload.replicationPlan,
      });
      expect(sealedLink.packArtifact).toBeUndefined();
      expect(sealedLink.attestationArtifactHash).toBe(attestationHash);
      const synthesis = synthesizeStudy(
        study,
        pki.trustStore,
        "2026-08-05T02:00:00.000Z",
      );
      expect(synthesis.findings[0]?.assessment).toMatchObject({
        assignedTier: "confirmed",
        blockers: expect.not.arrayContaining([
          "qualifying_sealed_holdout_missing",
        ]),
      });
      expect(
        study.runLinks.map((link) => link.artifact.payload.harnessVersion),
      ).toEqual(["2.2.6", "2.2.6", "2.2.6"]);

      const signedSynthesis = service.signStudySynthesis(synthesis);
      const internalReport = service.studyReport(
        study,
        signedSynthesis,
        "internal",
      );
      study.status = "published";
      const publicReport = service.studyReport(
        study,
        signedSynthesis,
        "public",
      );
      mainLabStorage.putStudy(study);
      mainLabStorage.putImmutable(
        "study_run_link",
        sealedLink.id,
        sealedLink.artifactHash,
        sealedLink,
      );
      mainLabStorage.putImmutable(
        "completed_run",
        remoteResult.payload.completedRunArtifact.payload.runId,
        remoteResult.payload.completedRunArtifact.signature.artifactHash,
        remoteResult.payload.completedRunArtifact,
      );
      mainLabStorage.putImmutable(
        "result_ledger",
        remoteResult.payload.resultLedger!.signature.artifactId,
        remoteResult.payload.resultLedger!.signature.artifactHash,
        remoteResult.payload.resultLedger,
      );
      const auditEvent = createAuditEvent(undefined, {
        eventId: "confirmed-sealed-import",
        occurredAt: synthesis.generatedAt,
        actorId: "operator",
        actorOrganization: "Study Owner",
        action: "study.sealed_evidence_imported",
        resourceType: "study",
        resourceId: study.id,
        metadata: { tier: "confirmed", attestationHash },
      });
      mainLabStorage.appendAudit(auditEvent);

      const archive = createDeterministicArchive({
        archiveId: "confirmed-v226-sealed-study",
        disclosure: "internal",
        createdAt: synthesis.generatedAt,
        parentArtifactHashes: [
          signedSynthesis.signature.artifactHash,
          remoteResult.payload.completedRunArtifact.signature.artifactHash,
        ],
        files: {
          "study-registration.json": JSON.stringify(study.registrationArtifact),
          "study.json": JSON.stringify(study),
          "study-run-links.json": JSON.stringify(study.runLinks),
          "development/completed-run-artifact.json": JSON.stringify(
            developmentEvidence.completed,
          ),
          "development/run-report.json": JSON.stringify(
            developmentEvidence.report,
          ),
          "validation/completed-run-artifact.json": JSON.stringify(
            validationEvidence.completed,
          ),
          "validation/replication-plan.json": JSON.stringify(validationPlan),
          "replication-plan.json": JSON.stringify(
            sealed.request.payload.replicationPlan,
          ),
          "holdout-attestation.json": JSON.stringify(sealed.holdoutAttestation),
          "pre-execution-plan.json": JSON.stringify(
            remoteResult.payload.completedRunArtifact.payload
              .preExecutionPlanArtifact,
          ),
          "execution-ledger.json": JSON.stringify(
            remoteResult.payload.completedRunArtifact.payload.executionLedger,
          ),
          "result-ledger.json": JSON.stringify(
            remoteResult.payload.resultLedger,
          ),
          "completed-run-artifact.json": JSON.stringify(
            remoteResult.payload.completedRunArtifact,
          ),
          "remote-result.json": JSON.stringify(remoteResult),
          "study-synthesis.json": JSON.stringify(signedSynthesis),
          "internal-report.json": JSON.stringify(internalReport),
          "public-report.json": JSON.stringify(publicReport),
          "public-study.json": JSON.stringify(toPublicStudy(study)),
          "public-synthesis.json": JSON.stringify(
            toPublicStudySynthesis(synthesis),
          ),
          "public-remote-result.json": JSON.stringify(
            publicRemoteResult(remoteResult),
          ),
          "audit-events.json": JSON.stringify(mainLabStorage.listAudit()),
        },
        certificateChain: pki.operator.chain,
        privateKey: pki.operator.keys.privateKey,
      });
      expect(verifyArchive(archive.bytes, pki.trustStore)).toMatchObject({
        valid: true,
        errors: [],
      });
      if (process.env.CONFIRMED_SEALED_FIXTURE_ARCHIVE_PATH)
        writeFileSync(
          process.env.CONFIRMED_SEALED_FIXTURE_ARCHIVE_PATH,
          archive.bytes,
        );
      if (process.env.CONFIRMED_SEALED_FIXTURE_TRUST_ANCHOR_PATH)
        writeFileSync(
          process.env.CONFIRMED_SEALED_FIXTURE_TRUST_ANCHOR_PATH,
          `${JSON.stringify(pki.root, null, 2)}\n`,
        );

      const archiveFiles = unzipSync(archive.bytes);
      const archivedSynthesis = JSON.parse(
        strFromU8(archiveFiles["study-synthesis.json"]),
      ) as typeof signedSynthesis;
      expect(
        archivedSynthesis.payload.findings[0]?.assessment.assignedTier,
      ).toBe("confirmed");
      expect(Object.keys(archiveFiles).join("\n")).not.toContain(
        hiddenSentinel,
      );
      for (const value of Object.values(archiveFiles))
        expect(strFromU8(value)).not.toContain(hiddenSentinel);
      const capturedApiResponses = [
        publicRemoteResult(remoteResult),
        toPublicStudy(study),
        toPublicStudySynthesis(synthesis),
      ];
      const capturedLogs: string[] = [];
      const mainLabSurfaces = [
        study,
        developmentLink,
        validationLink,
        sealedLink,
        synthesis,
        signedSynthesis,
        remoteResult.payload.completedRunArtifact,
        remoteResult.payload.completedRunArtifact.payload
          .preExecutionPlanArtifact,
        remoteResult.payload.completedRunArtifact.payload.executionLedger,
        remoteResult.payload.resultLedger,
        internalReport,
        publicReport,
        mainLabStorage.getStudy(study.id),
        mainLabStorage.listAudit(),
        capturedApiResponses,
        capturedLogs,
      ];
      for (const surface of mainLabSurfaces)
        expect(JSON.stringify(surface ?? null)).not.toContain(hiddenSentinel);

      mainLabStorage.close();
      for (const path of [
        databasePath,
        `${databasePath}-wal`,
        `${databasePath}-shm`,
      ]) {
        if (existsSync(path))
          expect(readFileSync(path).includes(Buffer.from(hiddenSentinel))).toBe(
            false,
          );
      }
    } finally {
      try {
        mainLabStorage.close();
      } catch {
        // The assertion path may already have closed the database.
      }
      sealedStorage?.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects replay, expiration, modified requests, and pack substitution", async () => {
    const replay = setup();
    await replay.executor.execute(replay.request, "2026-01-03T01:00:00.000Z");
    await expect(
      replay.executor.execute(replay.request, "2026-01-03T01:01:00.000Z"),
    ).rejects.toThrow("remote_request_replay");
    replay.storage.close();
    const expired = setup();
    await expect(
      expired.executor.execute(expired.request, "2026-01-05T00:00:00.000Z"),
    ).rejects.toThrow("remote_request_expired");
    expired.storage.close();
    const modified = setup();
    modified.request.payload.studyId = "changed";
    await expect(
      modified.executor.execute(modified.request, "2026-01-03T01:00:00.000Z"),
    ).rejects.toThrow("invalid_remote_execution_request");
    modified.storage.close();
    const substituted = setup();
    const substitutedPayload = {
      ...substituted.request.payload,
      requestId: "request-substituted",
      nonce: "nonce-substituted",
      packCommitment: "0".repeat(64),
    };
    const substitutedRequest = signRemoteExecutionRequest(
      substitutedPayload,
      {
        certificateChain: substituted.operator.chain,
        privateKey: substituted.operator.keys.privateKey,
      },
      substitutedPayload.issuedAt,
    );
    await expect(
      substituted.executor.execute(
        substitutedRequest,
        "2026-01-03T01:00:00.000Z",
      ),
    ).rejects.toThrow("replication_plan_pack_commitment_mismatch");
    substituted.storage.close();
  });

  it("requires a custodian-issued signed attestation before provider execution", async () => {
    const f = setup();
    const payload = { ...f.request.payload } as Record<string, unknown>;
    delete payload.holdoutAttestation;
    const unsignedRequest = signArtifact({
      artifactType: "remote_execution_request",
      artifactSchemaVersion: "1.0",
      artifactId: "request-without-attestation",
      payload: {
        ...payload,
        requestId: "request-without-attestation",
        nonce: "without-attestation",
      } as RemoteExecutionRequest,
      purpose: "remote-sealed-holdout-execution",
      disclosure: "sealed",
      signedAt: "2026-01-03T00:00:00.000Z",
      certificateChain: f.operator.chain,
      privateKey: f.operator.keys.privateKey,
    });
    await expect(
      f.executor.execute(unsignedRequest, "2026-01-03T01:00:00.000Z"),
    ).rejects.toThrow("holdout_attestation_required");
    f.storage.close();
  });
});

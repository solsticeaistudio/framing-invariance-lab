import { createHash, createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  CalibrationReport,
  EvalRun,
  ReportAudience,
  ReportData,
  ReportDocument,
} from "../types.js";
import type {
  CompletedRunArtifact,
  ReportArtifact,
  SignedArtifact,
  Study,
  StudySynthesis,
  TrustCertificate,
} from "../v2/types.js";
import { createDeterministicArchive } from "./archive.js";
import {
  buildCompletedRunArtifact,
  createReportArtifact,
  signCompletedRunArtifact,
  signReportArtifact,
  signExecutionManifestArtifact,
  buildLocalPreExecutionPlanArtifact,
  signPreregistrationManifestArtifact,
  type SigningIdentity,
} from "./artifacts.js";
import { canonicalJson, canonicalSha256 } from "./canonicalJson.js";
import { renderDeterministicPdf } from "./pdf.js";
import { publicCompletedRunSummary } from "./publicV2Dtos.js";
import { signArtifact } from "./signatures.js";
import type { PlatformStorage } from "./storage/index.js";
import {
  buildReport,
  reportEvidenceToCsv,
  reportToMarkdown,
  validateReport,
} from "./report.js";
import { signAuditCheckpoint } from "./audit.js";
import type { AuditEvent } from "../v2/types.js";
import type { TrustStore } from "./trustStore.js";
import { verifySignedArtifact } from "./signatures.js";

type FrozenRunEvidence = {
  completed: ReturnType<typeof signCompletedRunArtifact>;
  internalReport: ReportDocument;
};

function frozenJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class ArtifactService {
  private readonly frozenRuns = new Map<string, FrozenRunEvidence>();
  private readonly preregistrationManifests = new Map<
    string,
    CompletedRunArtifact["preregistrationManifestArtifact"]
  >();
  private readonly executionManifests = new Map<
    string,
    CompletedRunArtifact["executionManifestArtifact"]
  >();
  private readonly preExecutionPlans = new Map<
    string,
    CompletedRunArtifact["preExecutionPlanArtifact"]
  >();
  private readonly reports = new Map<
    string,
    SignedArtifact<ReportArtifact<ReportDocument>>
  >();
  private readonly pdfs = new Map<string, Uint8Array>();
  private readonly archives = new Map<string, Uint8Array>();
  private readonly publishedRuns = new Set<string>();
  private readonly studySyntheses = new Map<
    string,
    SignedArtifact<StudySynthesis>
  >();
  private readonly studyReports = new Map<
    string,
    SignedArtifact<ReportArtifact>
  >();

  constructor(
    private readonly identity: SigningIdentity,
    private readonly storage?: PlatformStorage,
    private readonly trustStore?: TrustStore,
  ) {}

  signingIdentity(): SigningIdentity {
    return this.identity;
  }

  private persist(kind: string, artifact: SignedArtifact<unknown>): void {
    this.storage?.putImmutable(
      kind,
      artifact.signature.artifactId,
      artifact.signature.artifactHash,
      artifact,
    );
  }

  private stableTime(run: EvalRun): string {
    return run.updatedAt > run.createdAt ? run.updatedAt : run.createdAt;
  }

  lockPreregistrationManifest(
    run: EvalRun,
    signedAt = new Date().toISOString(),
  ): CompletedRunArtifact["preregistrationManifestArtifact"] {
    if (run.status !== "queued" || run.trials.length)
      throw new Error("preregistration_must_be_signed_before_execution");
    const current =
      this.preregistrationManifests.get(run.id) ??
      this.storage?.getImmutable<
        CompletedRunArtifact["preregistrationManifestArtifact"]
      >("preregistration_manifest", `manifest-${run.id}`)?.document;
    if (current) {
      if (current.payload.manifestHash !== run.manifest.fullManifestHash)
        throw new Error("preregistration_manifest_artifact_conflict");
      this.preregistrationManifests.set(run.id, current);
      return current;
    }
    const artifact = signPreregistrationManifestArtifact({
      run,
      identity: this.identity,
      signedAt,
    });
    this.preregistrationManifests.set(run.id, artifact);
    this.persist("preregistration_manifest", artifact);
    return artifact;
  }

  sealExecutionManifest(
    run: EvalRun,
    signedAt = new Date().toISOString(),
  ): CompletedRunArtifact["executionManifestArtifact"] {
    if (run.status !== "running" || run.trials.length)
      throw new Error("execution_manifest_must_be_signed_before_trials");
    const preregistration =
      this.preregistrationManifests.get(run.id) ??
      this.storage?.getImmutable<
        CompletedRunArtifact["preregistrationManifestArtifact"]
      >("preregistration_manifest", `manifest-${run.id}`)?.document;
    if (!preregistration)
      throw new Error("signed_preregistration_manifest_required");
    const current =
      this.executionManifests.get(run.id) ??
      this.storage?.getImmutable<
        CompletedRunArtifact["executionManifestArtifact"]
      >("execution_manifest", `execution-${run.id}`)?.document;
    if (current) {
      if (
        current.payload.executionManifestHash !==
        run.manifest.executionManifestHash
      )
        throw new Error("execution_manifest_artifact_conflict");
      this.executionManifests.set(run.id, current);
      return current;
    }
    const artifact = signExecutionManifestArtifact({
      run,
      preregistration,
      identity: this.identity,
      signedAt,
    });
    this.executionManifests.set(run.id, artifact);
    this.persist("execution_manifest", artifact);
    return artifact;
  }

  planExecution(
    run: EvalRun,
    signedAt = new Date().toISOString(),
  ): CompletedRunArtifact["preExecutionPlanArtifact"] {
    if (run.status !== "running" || run.trials.length)
      throw new Error("pre_execution_plan_must_precede_trials");
    const current =
      this.preExecutionPlans.get(run.id) ??
      this.storage?.getImmutable<
        CompletedRunArtifact["preExecutionPlanArtifact"]
      >("pre_execution_plan", `pre-plan-${run.id}`)?.document;
    const generated = buildLocalPreExecutionPlanArtifact({
      run,
      identity: this.identity,
      signedAt: current?.payload.signedAt ?? signedAt,
    });
    if (current) {
      if (
        canonicalSha256(current.payload) !== canonicalSha256(generated.payload)
      )
        throw new Error("pre_execution_plan_artifact_conflict");
      this.preExecutionPlans.set(run.id, current);
      return current;
    }
    this.persist("pre_execution_plan", generated);
    this.preExecutionPlans.set(run.id, generated);
    return generated;
  }

  private manifestArtifacts(run: EvalRun) {
    const preregistration =
      this.preregistrationManifests.get(run.id) ??
      this.storage?.getImmutable<
        CompletedRunArtifact["preregistrationManifestArtifact"]
      >("preregistration_manifest", `manifest-${run.id}`)?.document;
    const execution =
      this.executionManifests.get(run.id) ??
      this.storage?.getImmutable<
        CompletedRunArtifact["executionManifestArtifact"]
      >("execution_manifest", `execution-${run.id}`)?.document;
    const preExecutionPlan =
      this.preExecutionPlans.get(run.id) ??
      this.storage?.getImmutable<
        CompletedRunArtifact["preExecutionPlanArtifact"]
      >("pre_execution_plan", `pre-plan-${run.id}`)?.document;
    if (!preregistration || !execution || !preExecutionPlan)
      throw new Error("pre_execution_manifest_artifacts_required");
    if (
      preregistration.payload.manifestHash !== run.manifest.fullManifestHash ||
      execution.payload.executionManifestHash !==
        run.manifest.executionManifestHash
    )
      throw new Error("signed_manifest_artifact_mismatch");
    this.preregistrationManifests.set(run.id, preregistration);
    this.executionManifests.set(run.id, execution);
    this.preExecutionPlans.set(run.id, preExecutionPlan);
    return { preregistration, execution, preExecutionPlan };
  }

  private ensureRun(
    run: EvalRun,
    calibration: CalibrationReport,
  ): FrozenRunEvidence {
    const current = this.frozenRuns.get(run.id);
    if (current) return current;
    if (run.status !== "completed")
      throw new Error("completed_run_required_for_artifact");
    const generatedAt = this.stableTime(run);
    const reportId = `report-${canonicalSha256({ runId: run.id, execution: run.manifest.executionManifestHash, generatedAt }).slice(0, 32)}`;
    const persistedReport = this.storage?.getImmutable<
      SignedArtifact<ReportArtifact<ReportDocument>>
    >("report", `report-${run.id}-research-internal`)?.document;
    const internalReport: ReportData =
      persistedReport?.payload.report.disclosure === "internal"
        ? persistedReport.payload.report
        : frozenJson(
            buildReport({
              run,
              calibration,
              audience: "research",
              disclosure: "internal",
              generatedAt,
              reportId,
            }),
          );
    const errors = validateReport(internalReport);
    if (errors.length)
      throw new Error(`report_validation_failed:${errors.join(",")}`);
    const persistedCompleted = this.storage?.getImmutable<
      ReturnType<typeof signCompletedRunArtifact>
    >("completed_run", run.id)?.document;
    if (persistedCompleted) {
      const frozen = { completed: persistedCompleted, internalReport };
      this.frozenRuns.set(run.id, frozen);
      return frozen;
    }
    const manifests = this.manifestArtifacts(run);
    const completedPayload = buildCompletedRunArtifact({
      run,
      report: internalReport,
      preregistrationManifestArtifact: manifests.preregistration,
      executionManifestArtifact: manifests.execution,
      preExecutionPlanArtifact: manifests.preExecutionPlan,
    });
    const signedAt =
      generatedAt < completedPayload.finishedAt
        ? completedPayload.finishedAt
        : generatedAt;
    const completed = signCompletedRunArtifact(
      completedPayload,
      this.identity,
      signedAt,
    );
    const frozen = { completed, internalReport };
    this.frozenRuns.set(run.id, frozen);
    this.persist("completed_run", completed);
    return frozen;
  }

  report(
    run: EvalRun,
    calibration: CalibrationReport,
    audience: ReportAudience,
    disclosure: "public" | "internal",
  ): SignedArtifact<ReportArtifact<ReportDocument>> {
    const frozen = this.ensureRun(run, calibration);
    const key = `${run.id}:${audience}:${disclosure}`;
    const current = this.reports.get(key);
    if (current) return current;
    const artifactId = `report-${run.id}-${audience}-${disclosure}`;
    const persisted = this.storage?.getImmutable<
      SignedArtifact<ReportArtifact<ReportDocument>>
    >("report", artifactId)?.document;
    if (persisted) {
      this.reports.set(key, persisted);
      if (persisted.payload.publicationState === "published")
        this.publishedRuns.add(run.id);
      return persisted;
    }
    const report =
      disclosure === "internal" && audience === "research"
        ? frozen.internalReport
        : frozenJson(
            buildReport({
              run,
              calibration,
              audience,
              disclosure,
              generatedAt: this.stableTime(run),
              reportId: `${disclosure}-${canonicalSha256({ runId: run.id, audience, disclosure }).slice(0, 32)}`,
            }),
          );
    const errors = validateReport(report);
    if (errors.length)
      throw new Error(`report_validation_failed:${errors.join(",")}`);
    const payload = createReportArtifact({
      report,
      artifactId,
      publicationState:
        disclosure === "public" && this.publishedRuns.has(run.id)
          ? "published"
          : "signed",
      subjectArtifactHashes: [frozen.completed.signature.artifactHash],
    });
    const signed = signReportArtifact(
      payload,
      this.identity,
      payload.generatedAt,
    ) as SignedArtifact<ReportArtifact<ReportDocument>>;
    this.reports.set(key, signed);
    this.persist("report", signed);
    return signed;
  }

  publishRun(
    run: EvalRun,
    calibration: CalibrationReport,
  ): SignedArtifact<ReportArtifact<ReportDocument>> {
    this.publishedRuns.add(run.id);
    this.reports.delete(`${run.id}:research:public`);
    return this.report(run, calibration, "research", "public");
  }

  completedRun(run: EvalRun, calibration: CalibrationReport) {
    return this.ensureRun(run, calibration).completed;
  }

  published(
    run: EvalRun,
    calibration: CalibrationReport,
    audience: ReportAudience,
  ): SignedArtifact<ReportArtifact<ReportDocument>> | undefined {
    const persisted = this.storage?.getImmutable<
      SignedArtifact<ReportArtifact<ReportDocument>>
    >("report", `report-${run.id}-${audience}-public`)?.document;
    if (persisted?.payload.publicationState === "published") {
      this.publishedRuns.add(run.id);
      this.reports.set(`${run.id}:${audience}:public`, persisted);
      return persisted;
    }
    return this.publishedRuns.has(run.id)
      ? this.report(run, calibration, audience, "public")
      : undefined;
  }

  async pdf(artifact: SignedArtifact<ReportArtifact>): Promise<Uint8Array> {
    if (this.trustStore) {
      const verification = verifySignedArtifact({
        artifact,
        trustStore: this.trustStore,
        expectedType: artifact.artifactType,
        expectedPurpose: "immutable-report-artifact",
      });
      if (!verification.validAtSigning)
        throw new Error("report_artifact_signature_invalid_for_pdf");
      if (
        artifact.payload.publicationState === "published" &&
        artifact.payload.disclosure !== "public"
      )
        throw new Error("published_report_disclosure_invalid");
    }
    const key = artifact.signature.artifactHash;
    const current = this.pdfs.get(key);
    if (current) return current;
    const persisted = this.storage?.getImmutable<{
      encoding: "base64";
      bytes: string;
    }>("report_pdf", artifact.signature.artifactId)?.document;
    if (persisted?.encoding === "base64") {
      const bytes = new Uint8Array(Buffer.from(persisted.bytes, "base64"));
      this.pdfs.set(key, bytes);
      return bytes;
    }
    const bytes = await renderDeterministicPdf(artifact);
    this.pdfs.set(key, bytes);
    const pdfHash = createHash("sha256").update(bytes).digest("hex");
    this.storage?.putImmutable(
      "report_pdf",
      artifact.signature.artifactId,
      pdfHash,
      { encoding: "base64", bytes: Buffer.from(bytes).toString("base64") },
    );
    return bytes;
  }

  async archive(
    run: EvalRun,
    calibration: CalibrationReport,
    disclosure: "public" | "internal",
    audience: ReportAudience,
  ): Promise<Uint8Array> {
    const report =
      disclosure === "public"
        ? this.published(run, calibration, audience)
        : this.report(run, calibration, audience, disclosure);
    if (!report) throw new Error("public_report_not_published");
    const key = report.signature.artifactHash;
    const current = this.archives.get(key);
    if (current) return current;
    const archiveId = `archive-${report.payload.artifactId}`;
    const persistedArchive = this.storage?.getImmutable<{
      encoding: "base64";
      bytes: string;
    }>("archive", archiveId)?.document;
    if (persistedArchive?.encoding === "base64") {
      const bytes = new Uint8Array(
        Buffer.from(persistedArchive.bytes, "base64"),
      );
      this.archives.set(key, bytes);
      return bytes;
    }
    const frozen = this.ensureRun(run, calibration);
    const pdf = await this.pdf(report);
    const files: Record<string, string | Uint8Array> = {
      "report.json": canonicalJson(report.payload.report),
      "report.pdf": pdf,
      "report.md": reportToMarkdown(report.payload.report),
      "evidence.csv": reportEvidenceToCsv(report.payload.report),
      "run-manifest.json": canonicalJson(frozenJson(run.manifest)),
      "pre-execution-plan.json": canonicalJson(
        frozen.completed.payload.preExecutionPlanArtifact,
      ),
      ...(disclosure === "internal"
        ? {
            "completed-run-artifact.json": canonicalJson(frozen.completed),
            "execution-ledger.json": canonicalJson(
              frozen.completed.payload.executionLedger,
            ),
          }
        : {
            "completed-run-summary.json": canonicalJson(
              publicCompletedRunSummary(frozen.completed.payload),
            ),
          }),
      "certificates/signer-chain.json": canonicalJson(report.certificateChain),
      "signatures/report-signature.json": canonicalJson(report.signature),
      "verification-instructions.txt":
        "Verify archive-manifest.json through an approved trust anchor, then verify every SHA-256 entry before use.\n",
    };
    const archive = createDeterministicArchive({
      archiveId: `archive-${report.payload.artifactId}`,
      disclosure,
      createdAt: report.payload.generatedAt,
      parentArtifactHashes: [
        report.signature.artifactHash,
        frozen.completed.signature.artifactHash,
      ],
      files,
      artifactType: "run_archive",
      ...this.identity,
    });
    this.archives.set(key, archive.bytes);
    this.persist("archive_manifest", archive.manifest);
    this.storage?.putImmutable(
      "archive",
      archive.manifest.signature.artifactId,
      archive.sha256,
      {
        encoding: "base64",
        bytes: Buffer.from(archive.bytes).toString("base64"),
      },
    );
    return archive.bytes;
  }

  signerFingerprint(): string {
    return this.identity.certificateChain[0]?.keyId ?? "unconfigured";
  }

  auditCheckpoint(events: AuditEvent[], signedAt: string) {
    const certificate = this.identity.certificateChain[0];
    if (!certificate) throw new Error("audit_checkpoint_signer_missing");
    const checkpoint = signAuditCheckpoint({
      events,
      certificate,
      certificateChain: this.identity.certificateChain,
      privateKey: this.identity.privateKey,
      signedAt,
    });
    this.persist("audit_checkpoint", checkpoint);
    return checkpoint;
  }

  signStudySynthesis(
    synthesis: StudySynthesis,
  ): SignedArtifact<StudySynthesis> {
    const key = canonicalSha256(synthesis);
    const current = this.studySyntheses.get(key);
    if (current) return current;
    const signed = signArtifact({
      artifactType: "study_synthesis",
      artifactSchemaVersion: synthesis.schemaVersion,
      artifactId: `synthesis-${synthesis.studyId}-${key.slice(0, 16)}`,
      payload: frozenJson(synthesis),
      purpose: "cross-run-study-synthesis",
      parentArtifactHashes: uniqueStudyParents(synthesis),
      disclosure: "internal",
      signedAt: synthesis.generatedAt,
      ...this.identity,
    });
    this.studySyntheses.set(key, signed);
    this.persist("study_synthesis", signed);
    return signed;
  }

  studyReport(
    study: Study,
    synthesis: SignedArtifact<StudySynthesis>,
    disclosure: "public" | "internal",
  ): SignedArtifact<ReportArtifact> {
    if (disclosure === "public" && study.status !== "published")
      throw new Error("study_not_published");
    const revision = study.publishedRevision ?? study.registrationRevision ?? 1;
    const key = `${synthesis.signature.artifactHash}:${disclosure}:r${revision}`;
    const current = this.studyReports.get(key);
    if (current) return current;
    const report = {
      schemaVersion: "2.0" as const,
      generatedAt: synthesis.payload.generatedAt,
      audience: "research" as const,
      disclosure,
      title: study.title,
      executiveSummary: [
        `Study tier synthesis across ${study.runLinks.length} immutable completed-run artifacts.`,
      ],
      findings: synthesis.payload.findings.map((finding) => ({
        id: finding.claimKey,
        title: `Study claim ${finding.claimKey.slice(0, 12)}`,
        tier: finding.assessment.assignedTier,
        explanation: finding.assessment.blockers.length
          ? `Promotion blockers: ${finding.assessment.blockers.join("; ")}`
          : "All requirements for the assigned tier were satisfied.",
        effects: finding.effects.map((effect) => ({
          role: effect.role,
          events: effect.events,
          total: effect.total,
          riskDifference: effect.riskDifference,
          interval: effect.interval,
          organization: effect.organization,
        })),
      })),
    };
    const payload: ReportArtifact = {
      schemaVersion: "1.0",
      artifactId: `study-report-${study.id}-${disclosure}-r${revision}`,
      reportSchemaVersion: "2.0",
      audience: "research",
      disclosure,
      generatedAt: synthesis.payload.generatedAt,
      subjectArtifactHashes: [synthesis.signature.artifactHash],
      reportHash: canonicalSha256(report),
      report,
      publicationState: disclosure === "public" ? "published" : "signed",
      revision,
    };
    const signed = signArtifact({
      artifactType: "study_report",
      artifactSchemaVersion: payload.schemaVersion,
      artifactId: payload.artifactId,
      payload,
      purpose: "immutable-report-artifact",
      parentArtifactHashes: payload.subjectArtifactHashes,
      disclosure,
      signedAt: payload.generatedAt,
      ...this.identity,
    });
    this.studyReports.set(key, signed);
    this.persist("study_report", signed);
    return signed;
  }

  storedStudyReport(hash: string): SignedArtifact<ReportArtifact> | undefined {
    const inMemory = [...this.studyReports.values()].find(
      (artifact) => artifact.signature.artifactHash === hash,
    );
    if (inMemory) return inMemory;
    const persisted = this.storage?.getImmutableByHash<
      SignedArtifact<ReportArtifact>
    >("study_report", hash);
    return persisted?.document;
  }

  storedStudyArchive(reportHash: string): Uint8Array | undefined {
    const inMemory = this.archives.get(reportHash);
    if (inMemory) return inMemory;
    const report = this.storedStudyReport(reportHash);
    const persisted = report
      ? this.storage?.getImmutable<{
          encoding: "base64";
          bytes: string;
        }>("archive", `archive-${report.payload.artifactId}`)
      : undefined;
    if (persisted?.document.encoding === "base64") {
      const bytes = new Uint8Array(
        Buffer.from(persisted.document.bytes, "base64"),
      );
      this.archives.set(reportHash, bytes);
      return bytes;
    }
    return undefined;
  }

  async studyArchive(
    study: Study,
    synthesis: SignedArtifact<StudySynthesis>,
    disclosure: "public" | "internal",
  ): Promise<Uint8Array> {
    const report = this.studyReport(study, synthesis, disclosure);
    const current = this.archives.get(report.signature.artifactHash);
    if (current) return current;
    const archiveId = `archive-${report.payload.artifactId}`;
    const persistedArchive = this.storage?.getImmutable<{
      encoding: "base64";
      bytes: string;
    }>("archive", archiveId)?.document;
    if (persistedArchive?.encoding === "base64") {
      const bytes = new Uint8Array(
        Buffer.from(persistedArchive.bytes, "base64"),
      );
      this.archives.set(report.signature.artifactHash, bytes);
      return bytes;
    }
    const pdf = await this.pdf(report);
    const files: Record<string, string | Uint8Array> = {
      "report.json": canonicalJson(report.payload.report),
      "report.pdf": pdf,
      "study-synthesis.json": canonicalJson(
        disclosure === "public"
          ? publicStudySynthesisDocument(synthesis.payload)
          : synthesis,
      ),
      "certificates/signer-chain.json": canonicalJson(report.certificateChain),
      "signatures/report-signature.json": canonicalJson(report.signature),
      "verification-instructions.txt":
        "Verify the signed archive manifest and every declared checksum using the configured trust anchor.\n",
    };
    const archive = createDeterministicArchive({
      archiveId: `archive-${report.payload.artifactId}`,
      disclosure,
      createdAt: report.payload.generatedAt,
      parentArtifactHashes: [
        report.signature.artifactHash,
        synthesis.signature.artifactHash,
      ],
      files,
      artifactType: "study_archive",
      ...this.identity,
    });
    this.archives.set(report.signature.artifactHash, archive.bytes);
    this.persist("archive_manifest", archive.manifest);
    this.storage?.putImmutable(
      "archive",
      archive.manifest.signature.artifactId,
      archive.sha256,
      {
        encoding: "base64",
        bytes: Buffer.from(archive.bytes).toString("base64"),
      },
    );
    return archive.bytes;
  }
}

function uniqueStudyParents(synthesis: StudySynthesis): string[] {
  return [
    ...new Set(
      synthesis.findings.flatMap(
        (finding) => finding.assessment.contributingArtifacts,
      ),
    ),
  ].sort();
}

function publicStudySynthesisDocument(synthesis: StudySynthesis) {
  return {
    schemaVersion: synthesis.schemaVersion,
    studyId: synthesis.studyId,
    generatedAt: synthesis.generatedAt,
    studyRegistrationHash: synthesis.studyRegistrationHash,
    findings: synthesis.findings.map((finding) => ({
      claimKey: finding.claimKey,
      assessment: {
        assignedTier: finding.assessment.assignedTier,
        requirements: finding.assessment.requirements,
        blockers: finding.assessment.blockers,
        warnings: finding.assessment.warnings,
      },
      effects: finding.effects.map((effect) => ({
        role: effect.role,
        organization: effect.organization,
        events: effect.events,
        total: effect.total,
        baselineEvents: effect.baselineEvents,
        baselineTotal: effect.baselineTotal,
        riskDifference: effect.riskDifference,
        interval: effect.interval,
      })),
    })),
  };
}

export async function artifactServiceFromEnvironment(
  environment: NodeJS.ProcessEnv,
  storage?: PlatformStorage,
  trustStore?: TrustStore,
): Promise<ArtifactService | undefined> {
  const privateKeyPath = environment.SIGNING_PRIVATE_KEY_FILE?.trim();
  const chainPath = environment.SIGNING_CERTIFICATE_CHAIN_FILE?.trim();
  if (!privateKeyPath && !chainPath) return undefined;
  if (!privateKeyPath || !chainPath)
    throw new Error(
      "Both SIGNING_PRIVATE_KEY_FILE and SIGNING_CERTIFICATE_CHAIN_FILE are required.",
    );
  const [privatePem, chainJson] = await Promise.all([
    readFile(privateKeyPath, "utf8"),
    readFile(chainPath, "utf8"),
  ]);
  const parsed = JSON.parse(chainJson) as unknown;
  if (!Array.isArray(parsed) || !parsed.length)
    throw new Error("Signing certificate chain file is invalid.");
  return new ArtifactService(
    {
      privateKey: createPrivateKey(privatePem),
      certificateChain: parsed as TrustCertificate[],
    },
    storage,
    trustStore,
  );
}

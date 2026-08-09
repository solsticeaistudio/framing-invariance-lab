import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ArchiveManifest,
  AuditEvent,
  CompletedRunArtifact,
  RemoteResultBundle,
  ReportArtifact,
  SignedArtifact,
  Study,
  StudySynthesis,
  TrustCertificate,
} from "../v2/types.js";
import { validatePublicReportShape } from "./publicReport.js";

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,159}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime();

export const publicCertificateSummarySchema = z
  .object({
    certificateId: id,
    keyId: z.string().max(160),
    subject: z.string().max(160),
    organization: z.string().max(160),
    roles: z.array(z.string().max(40)),
    validFrom: timestamp,
    validUntil: timestamp,
  })
  .strict();
export type PublicCertificateSummary = z.infer<
  typeof publicCertificateSummarySchema
>;

export const publicStudySchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    id,
    title: z.string().max(200),
    researchQuestion: z.string().max(2_000),
    hypothesisKey: id,
    ownerOrganization: z.string().max(160),
    createdAt: timestamp,
    status: z.enum([
      "draft",
      "preregistered",
      "running",
      "complete",
      "published",
    ]),
    targetCompatibilityPolicy: z.string(),
    methodologyCompatibilityPolicy: z.string(),
    runLinks: z.array(
      z
        .object({
          role: z.string(),
          artifactHash: hash,
          datasetIdentityHash: hash,
          packIdentityHash: hash,
          organization: z.string().max(160),
          independenceStatus: z.string(),
          signer: publicCertificateSummarySchema,
        })
        .strict(),
    ),
  })
  .strict();
export type PublicStudy = z.infer<typeof publicStudySchema>;

export const publicStudySynthesisSchema = z
  .object({
    schemaVersion: z.enum(["1.0", "1.1"]),
    studyId: id,
    generatedAt: timestamp,
    studyRegistrationHash: hash,
    findings: z.array(
      z
        .object({
          claimKey: z.string().max(160),
          assessment: z
            .object({
              assignedTier: z.string(),
              requirements: z.record(z.string(), z.boolean()),
              blockers: z.array(z.string()),
              warnings: z.array(z.string()),
            })
            .strict(),
          effects: z.array(
            z
              .object({
                role: z.string(),
                artifactHash: hash,
                datasetIdentityHash: hash,
                organization: z.string(),
                events: z.number().int().nonnegative(),
                total: z.number().int().nonnegative(),
                baselineEvents: z.number().int().nonnegative(),
                baselineTotal: z.number().int().nonnegative(),
                riskDifference: z.number().min(-1).max(1),
                interval: z.object({
                  low: z.number().min(-1).max(1),
                  high: z.number().min(-1).max(1),
                }),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type PublicStudySynthesis = z.infer<typeof publicStudySynthesisSchema>;

export type PublicReportArtifact<T> = {
  schemaVersion: "1.0";
  artifactId: string;
  reportSchemaVersion: "2.0";
  audience: string;
  disclosure: "public";
  generatedAt: string;
  subjectArtifactHashes: string[];
  reportHash: string;
  report: T;
  publicationState: "published";
  signer: PublicCertificateSummary;
  signature: {
    algorithm: "Ed25519";
    artifactHash: string;
    keyId: string;
    signedAt: string;
  };
};
export type PublicArchiveManifest = Pick<
  ArchiveManifest,
  | "schemaVersion"
  | "archiveId"
  | "disclosure"
  | "createdAt"
  | "parentArtifactHashes"
  | "entries"
>;
export type PublicAuditCheckpoint = {
  schemaVersion: "1.0";
  sequence: number;
  eventHash: string;
  signerKeyId: string;
  signedAt: string;
};
const publicCompletedRunSummarySchema = z
  .object({
    schemaVersion: z.enum(["1.0", "1.1"]),
    runArtifactHash: hash,
    harnessVersion: z.string().max(40),
    methodologyVersion: z.string().max(80),
    provider: z.string().max(80),
    requestedTargetModel: z.string().max(160),
    resolvedModelIds: z.array(z.string().max(160)),
    manifestHash: hash,
    executionManifestHash: hash,
    trialLedgerHash: hash,
    reportHash: hash,
    startedAt: timestamp,
    finishedAt: timestamp,
    status: z.literal("completed"),
  })
  .strict();

export const publicRemoteResultSummarySchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    resultId: id,
    executorKeyId: z.string().max(160),
    custodianOrganization: z.string().max(160),
    requestHash: hash,
    replicationPlanHash: hash,
    packCommitment: hash,
    datasetIdentityHash: hash,
    target: z
      .object({
        provider: z.string().max(80),
        requestedModel: z.string().max(160),
        resolvedModels: z.array(z.string().max(160)),
        maxTokens: z.number().int().positive(),
        temperature: z.number().finite(),
        systemConfigurationHash: hash,
        providerConfigurationHash: hash,
      })
      .strict(),
    cells: z.array(
      z
        .object({
          claimKeyHash: hash,
          events: z.number().int().nonnegative(),
          total: z.number().int().nonnegative(),
          baselineEvents: z.number().int().nonnegative(),
          baselineTotal: z.number().int().nonnegative(),
          eventInterval: z
            .object({
              low: z.number().min(0).max(1),
              high: z.number().min(0).max(1),
            })
            .strict(),
          riskDifference: z.number().min(-1).max(1),
          riskDifferenceInterval: z
            .object({
              low: z.number().min(-1).max(1),
              high: z.number().min(-1).max(1),
            })
            .strict(),
        })
        .strict(),
    ),
    auditCheckpointHash: hash,
    completedAt: timestamp,
    completedRun: publicCompletedRunSummarySchema,
    evidenceCommitment: hash,
    signer: publicCertificateSummarySchema,
  })
  .strict();
export type PublicRemoteResultSummary = z.infer<
  typeof publicRemoteResultSummarySchema
>;

export function publicCertificate(
  certificate: TrustCertificate,
): PublicCertificateSummary {
  return publicCertificateSummarySchema.parse({
    certificateId: certificate.certificateId,
    keyId: certificate.keyId,
    subject: certificate.subject,
    organization: certificate.organization,
    roles: [...certificate.roles],
    validFrom: certificate.validFrom,
    validUntil: certificate.validUntil,
  });
}

export function toPublicStudy(study: Study): PublicStudy {
  return publicStudySchema.parse({
    schemaVersion: study.schemaVersion,
    id: study.id,
    title: study.title,
    researchQuestion: study.researchQuestion,
    hypothesisKey: study.hypothesisKey,
    ownerOrganization: study.ownerOrganization,
    createdAt: study.createdAt,
    status: study.status,
    targetCompatibilityPolicy: study.targetCompatibilityPolicy,
    methodologyCompatibilityPolicy: study.methodologyCompatibilityPolicy,
    runLinks: study.runLinks.map((link) => ({
      role: link.role,
      artifactHash: link.artifactHash,
      datasetIdentityHash: cryptoHash(link.datasetIdentity),
      packIdentityHash: cryptoHash(link.packIdentity),
      organization: link.organization,
      independenceStatus: link.independenceStatus,
      signer: publicCertificate(link.artifact.certificateChain[0]),
    })),
  });
}

export function toPublicStudySynthesis(
  synthesis: StudySynthesis,
): PublicStudySynthesis {
  return publicStudySynthesisSchema.parse({
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
        artifactHash: effect.artifactHash,
        datasetIdentityHash: cryptoHash(effect.datasetIdentity),
        organization: effect.organization,
        events: effect.events,
        total: effect.total,
        baselineEvents: effect.baselineEvents,
        baselineTotal: effect.baselineTotal,
        riskDifference: effect.riskDifference,
        interval: effect.interval,
      })),
    })),
  });
}

function publicReportPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("public_report_payload_invalid");
  const report = value as Record<string, unknown>;
  if ("run" in report) {
    const errors = validatePublicReportShape(report as never);
    if (errors.length)
      throw new Error(`public_report_payload_invalid:${errors.join("|")}`);
    return structuredClone(value);
  }
  const findings = Array.isArray(report.findings)
    ? report.findings.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return [];
        const finding = value as Record<string, unknown>;
        return [
          {
            id: String(finding.id ?? "").slice(0, 160),
            title: String(finding.title ?? "").slice(0, 300),
            tier: String(finding.tier ?? "exploratory").slice(0, 40),
            explanation: String(finding.explanation ?? "").slice(0, 2_000),
            effects: Array.isArray(finding.effects)
              ? finding.effects.flatMap((effect) => {
                  if (
                    !effect ||
                    typeof effect !== "object" ||
                    Array.isArray(effect)
                  )
                    return [];
                  const item = effect as Record<string, unknown>;
                  return [
                    {
                      role: String(item.role ?? ""),
                      events: Number(item.events ?? 0),
                      total: Number(item.total ?? 0),
                      riskDifference: Number(item.riskDifference ?? 0),
                      interval: item.interval,
                      organization: String(item.organization ?? "").slice(
                        0,
                        160,
                      ),
                    },
                  ];
                })
              : [],
          },
        ];
      })
    : [];
  return {
    schemaVersion: "2.0",
    generatedAt: String(report.generatedAt ?? ""),
    audience: String(report.audience ?? "research"),
    disclosure: "public",
    title: String(report.title ?? "Public study report").slice(0, 300),
    executiveSummary: Array.isArray(report.executiveSummary)
      ? report.executiveSummary.map((item) => String(item).slice(0, 2_000))
      : [],
    findings,
  };
}

export function toPublicReportArtifact<T>(
  artifact: SignedArtifact<ReportArtifact<T>>,
): PublicReportArtifact<unknown> {
  if (
    artifact.payload.disclosure !== "public" ||
    artifact.payload.publicationState !== "published"
  )
    throw new Error("public_report_artifact_not_published");
  return {
    schemaVersion: artifact.payload.schemaVersion,
    artifactId: artifact.payload.artifactId,
    reportSchemaVersion: artifact.payload.reportSchemaVersion,
    audience: artifact.payload.audience,
    disclosure: "public",
    generatedAt: artifact.payload.generatedAt,
    subjectArtifactHashes: [...artifact.payload.subjectArtifactHashes],
    reportHash: artifact.payload.reportHash,
    report: publicReportPayload(artifact.payload.report),
    publicationState: "published",
    signer: publicCertificate(artifact.certificateChain[0]),
    signature: {
      algorithm: "Ed25519",
      artifactHash: artifact.signature.artifactHash,
      keyId: artifact.signature.keyId,
      signedAt: artifact.signature.signedAt,
    },
  };
}

export function publicCompletedRunSummary(artifact: CompletedRunArtifact) {
  return publicCompletedRunSummarySchema.parse({
    schemaVersion: artifact.schemaVersion,
    runArtifactHash: artifact.reportHash,
    harnessVersion: artifact.harnessVersion,
    methodologyVersion: artifact.methodologyVersion,
    provider: artifact.provider,
    requestedTargetModel: artifact.requestedTargetModel,
    resolvedModelIds: [...artifact.resolvedModelIds],
    manifestHash: artifact.manifestHash,
    executionManifestHash: artifact.executionManifestHash,
    trialLedgerHash: artifact.trialLedgerHash,
    reportHash: artifact.reportHash,
    startedAt: artifact.startedAt,
    finishedAt: artifact.finishedAt,
    status: artifact.status,
  });
}

export function publicAuditCheckpoint(
  event: AuditEvent,
): PublicAuditCheckpoint {
  if (!event.signature) throw new Error("signed_audit_checkpoint_required");
  return {
    schemaVersion: "1.0",
    sequence: event.sequence,
    eventHash: event.eventHash,
    signerKeyId: event.signature.keyId,
    signedAt: event.signature.signedAt,
  };
}

export function publicRemoteResult(
  artifact: SignedArtifact<RemoteResultBundle>,
): PublicRemoteResultSummary {
  const result = artifact.payload;
  return publicRemoteResultSummarySchema.parse({
    schemaVersion: result.schemaVersion,
    resultId: result.resultId,
    executorKeyId: result.executorKeyId,
    custodianOrganization: result.custodianOrganization,
    requestHash: result.requestHash,
    replicationPlanHash: result.replicationPlanHash,
    packCommitment: result.packCommitment,
    datasetIdentityHash: cryptoHash(result.datasetIdentity),
    target: {
      provider: result.targetSnapshot.provider,
      requestedModel: result.targetSnapshot.requestedModel,
      resolvedModels: [...result.targetSnapshot.resolvedModels],
      maxTokens: result.targetSnapshot.maxTokens,
      temperature: result.targetSnapshot.temperature,
      systemConfigurationHash: result.targetSnapshot.systemConfigurationHash,
      providerConfigurationHash:
        result.targetSnapshot.providerConfigurationHash,
    },
    cells: result.cells.map((cell) => ({
      claimKeyHash: cryptoHash(cell.claimKey),
      events: cell.events,
      total: cell.total,
      baselineEvents: cell.baselineEvents,
      baselineTotal: cell.baselineTotal,
      eventInterval: cell.eventInterval,
      riskDifference: cell.riskDifference,
      riskDifferenceInterval: cell.riskDifferenceInterval,
    })),
    auditCheckpointHash: result.auditCheckpointHash,
    completedAt: result.completedAt,
    completedRun: publicCompletedRunSummary(
      result.completedRunArtifact.payload,
    ),
    evidenceCommitment: cryptoHash(result.evidenceHashes.join("|")),
    signer: publicCertificate(artifact.certificateChain[0]),
  });
}

function cryptoHash(value: string): string {
  // Identifiers are projected as opaque hashes. The synchronous implementation
  // is isolated to prevent arbitrary source labels from becoming public IDs.
  return createHash("sha256").update(value).digest("hex");
}

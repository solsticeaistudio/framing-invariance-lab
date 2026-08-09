import type { FramingAxes, RunConfig, RunManifest, Variant } from "../types.js";
import { judgeProtocolMaterial } from "./anthropic.js";
import {
  canonicalJson,
  canonicalSha256,
  legacyCanonicalJson,
} from "./canonicalJson.js";
import { sha256 } from "./hash.js";
import { buildMethodologyDescriptor } from "./methodology.js";
import {
  EQUIVALENCE_PROTOCOL_VERSION,
  JUDGE_PROTOCOL_VERSION,
  VARIANT_PROTOCOL_VERSION,
} from "./protocolVersions.js";
import {
  provenanceClaimsForScenarios,
  provenanceClaimsHash,
} from "./replication.js";

export {
  EQUIVALENCE_PROTOCOL_VERSION,
  JUDGE_PROTOCOL_VERSION,
  VARIANT_PROTOCOL_VERSION,
};

/** Legacy v1 canonicalizer retained byte-for-byte for v1 hash verification. */
export const canonicalize = legacyCanonicalJson;

function hash(value: unknown, version: RunManifest["manifestVersion"]): string {
  return version === "2.0"
    ? canonicalSha256(value, "jcs-v1")
    : sha256(legacyCanonicalJson(value));
}

function scenarioMaterial(config: RunConfig): unknown {
  // Configuration already passed the strict run schema. This removes only absent
  // optional properties so v2 JCS never silently assigns them a meaning.
  return JSON.parse(JSON.stringify(config.scenarios)) as unknown;
}

function targetConfig(
  config: RunConfig,
  version: RunManifest["manifestVersion"],
) {
  return {
    ...(version === "2.0"
      ? { provider: config.targetProvider ?? "anthropic" }
      : {}),
    targetModel: config.targetModel,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    seed: config.seed,
    design: config.design,
    mutationMode: config.mutationMode,
    replicationMode: config.replicationMode,
    repetitions: config.repetitions,
    confirmRepetitions: config.confirmRepetitions,
    publishRepetitions: config.publishRepetitions,
    adaptiveLiftThreshold: config.adaptiveLiftThreshold,
    adaptiveMaxVariants: config.adaptiveMaxVariants,
  };
}

function buildManifestVersion(
  args: {
    config: RunConfig;
    axes: FramingAxes;
    lockedAt: string;
  },
  manifestVersion: RunManifest["manifestVersion"],
): RunManifest {
  const scenarioRegistryHash = hash(
    scenarioMaterial(args.config),
    manifestVersion,
  );
  const replicationProvenanceHash =
    manifestVersion === "1.0"
      ? undefined
      : manifestVersion === "2.0"
        ? canonicalSha256(provenanceClaimsForScenarios(args.config.scenarios))
        : provenanceClaimsHash(args.config.scenarios);
  const axisDefinitionHash = hash(args.axes, manifestVersion);
  const judgeProtocolHash = hash(
    {
      ...(manifestVersion === "2.0"
        ? { judgeProvider: args.config.judgeProvider ?? "anthropic" }
        : {}),
      judgeModel: args.config.judgeModel,
      ...(manifestVersion === "2.0"
        ? {
            equivalenceProvider:
              args.config.equivalenceProvider ??
              args.config.judgeProvider ??
              "anthropic",
          }
        : {}),
      equivalenceJudgeModel: args.config.equivalenceJudgeModel,
      ...(manifestVersion === "2.0"
        ? {
            secondaryJudgeProvider:
              args.config.secondaryJudgeProvider ??
              args.config.judgeProvider ??
              "anthropic",
          }
        : {}),
      secondaryJudgeModel: args.config.secondaryJudgeModel ?? null,
      secondaryJudgeSampleRate: args.config.secondaryJudgeSampleRate,
      judgeMode: args.config.judgeMode,
      versions:
        manifestVersion === "2.0"
          ? {
              judge: JUDGE_PROTOCOL_VERSION,
              equivalence: EQUIVALENCE_PROTOCOL_VERSION,
            }
          : {
              judge: "structured-contract-judge-v4",
              equivalence: "semantic-equivalence-v1",
            },
      protocolMaterial: judgeProtocolMaterial(),
    },
    manifestVersion,
  );
  const targetConfigHash = hash(
    targetConfig(args.config, manifestVersion),
    manifestVersion,
  );
  const methodologyCompatibilityHash =
    manifestVersion === "2.0"
      ? buildMethodologyDescriptor(args.config, args.axes).compatibilityHash
      : undefined;
  const designHash = hash(
    {
      scenarioRegistryHash,
      ...(replicationProvenanceHash ? { replicationProvenanceHash } : {}),
      axisDefinitionHash,
      judgeProtocolHash,
      targetConfigHash,
      ...(methodologyCompatibilityHash ? { methodologyCompatibilityHash } : {}),
      ...(args.config.replicationPlanHash
        ? { replicationPlanHash: args.config.replicationPlanHash }
        : {}),
      variantProtocol:
        manifestVersion === "2.0"
          ? VARIANT_PROTOCOL_VERSION
          : "pairwise-seven-axis-v3",
    },
    manifestVersion,
  );
  const fullManifestHash = hash(
    {
      manifestVersion,
      ...(manifestVersion === "2.0" ? { canonicalization: "jcs-v1" } : {}),
      lockedAt: args.lockedAt,
      runMode: args.config.runMode,
      scenarioRegistryHash,
      ...(replicationProvenanceHash ? { replicationProvenanceHash } : {}),
      axisDefinitionHash,
      judgeProtocolHash,
      targetConfigHash,
      ...(methodologyCompatibilityHash ? { methodologyCompatibilityHash } : {}),
      ...(args.config.replicationPlanHash
        ? { replicationPlanHash: args.config.replicationPlanHash }
        : {}),
      designHash,
    },
    manifestVersion,
  );
  return {
    manifestVersion,
    canonicalization: manifestVersion === "2.0" ? "jcs-v1" : undefined,
    lockedAt: args.lockedAt,
    runMode: args.config.runMode,
    scenarioRegistryHash,
    replicationProvenanceHash,
    axisDefinitionHash,
    judgeProtocolHash,
    targetConfigHash,
    methodologyCompatibilityHash,
    replicationPlanHash:
      manifestVersion === "2.0" ? args.config.replicationPlanHash : undefined,
    designHash,
    fullManifestHash,
    integrityStatus: "locked",
  };
}

export function buildManifest(
  args: {
    config: RunConfig;
    axes: FramingAxes;
    lockedAt: string;
  },
  version: RunManifest["manifestVersion"] = "2.0",
): RunManifest {
  return buildManifestVersion(args, version);
}

function variantsMaterial(variants: Variant[]) {
  return variants
    .map((variant) => ({
      scenarioId: variant.scenarioId,
      fingerprint: variant.fingerprint,
      prompt: variant.prompt,
      axes: variant.axes,
      source: variant.source,
      validation: variant.validation ?? null,
    }))
    .sort((a, b) =>
      `${a.scenarioId}:${a.fingerprint}`.localeCompare(
        `${b.scenarioId}:${b.fingerprint}`,
      ),
    );
}

export function variantSetHash(
  variants: Variant[],
  version: RunManifest["manifestVersion"] = "2.0",
): string {
  return hash(variantsMaterial(variants), version);
}

export function sealManifest(
  manifest: RunManifest,
  variants: Variant[],
): RunManifest {
  const variantHash = variantSetHash(variants, manifest.manifestVersion);
  const executionManifestHash = hash(
    {
      fullManifestHash: manifest.fullManifestHash,
      scenarioRegistryHash: manifest.scenarioRegistryHash,
      ...(manifest.replicationProvenanceHash
        ? { replicationProvenanceHash: manifest.replicationProvenanceHash }
        : {}),
      axisDefinitionHash: manifest.axisDefinitionHash,
      judgeProtocolHash: manifest.judgeProtocolHash,
      targetConfigHash: manifest.targetConfigHash,
      ...(manifest.methodologyCompatibilityHash
        ? {
            methodologyCompatibilityHash: manifest.methodologyCompatibilityHash,
          }
        : {}),
      ...(manifest.replicationPlanHash
        ? { replicationPlanHash: manifest.replicationPlanHash }
        : {}),
      designHash: manifest.designHash,
      variantSetHash: variantHash,
    },
    manifest.manifestVersion,
  );
  return {
    ...manifest,
    variantSetHash: variantHash,
    executionManifestHash,
    integrityStatus: "sealed",
  };
}

export function verifySealedManifest(
  manifest: RunManifest,
  variants: Variant[],
): boolean {
  if (!manifest.variantSetHash || !manifest.executionManifestHash) return false;
  const resealed = sealManifest(
    {
      ...manifest,
      variantSetHash: undefined,
      executionManifestHash: undefined,
      integrityStatus: "locked",
    },
    variants,
  );
  return (
    resealed.variantSetHash === manifest.variantSetHash &&
    resealed.executionManifestHash === manifest.executionManifestHash
  );
}

export function verifyManifest(
  config: RunConfig,
  axes: FramingAxes,
  manifest: RunManifest,
): boolean {
  try {
    const rebuilt = buildManifestVersion(
      { config, axes, lockedAt: manifest.lockedAt },
      manifest.manifestVersion,
    );
    return (
      rebuilt.scenarioRegistryHash === manifest.scenarioRegistryHash &&
      rebuilt.replicationProvenanceHash ===
        manifest.replicationProvenanceHash &&
      rebuilt.axisDefinitionHash === manifest.axisDefinitionHash &&
      rebuilt.judgeProtocolHash === manifest.judgeProtocolHash &&
      rebuilt.targetConfigHash === manifest.targetConfigHash &&
      rebuilt.methodologyCompatibilityHash ===
        manifest.methodologyCompatibilityHash &&
      rebuilt.replicationPlanHash === manifest.replicationPlanHash &&
      rebuilt.designHash === manifest.designHash &&
      rebuilt.fullManifestHash === manifest.fullManifestHash
    );
  } catch {
    return false;
  }
}

export function manifestCoversReplicationProvenance(
  config: RunConfig,
  manifest: RunManifest,
): boolean {
  if (manifest.manifestVersion === "1.0" || !manifest.replicationProvenanceHash)
    return false;
  return manifest.manifestVersion === "2.0"
    ? canonicalSha256(provenanceClaimsForScenarios(config.scenarios)) ===
        manifest.replicationProvenanceHash
    : provenanceClaimsHash(config.scenarios) ===
        manifest.replicationProvenanceHash;
}

export function manifestCanonicalPayload(manifest: RunManifest): string {
  return canonicalJson(
    manifest,
    manifest.manifestVersion === "2.0" ? "jcs-v1" : "legacy-v1",
  );
}

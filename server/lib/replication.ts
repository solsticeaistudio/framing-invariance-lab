import type {
  DatasetSplit,
  ReplicationProvenance,
  ReplicationRole,
  Scenario,
} from "../types.js";
import { sha256 } from "./hash.js";

export type ReplicationValidationIssue = {
  code:
    | "replication_role_split_mismatch"
    | "untrusted_confirmatory_provenance"
    | "missing_replication_provenance"
    | "invalid_replication_pack";
  path: string;
  message: string;
};

export type ReplicationPackEnvelope = {
  id: string;
  label: string;
  description: string;
  researchQuestion: string;
  scenarios: Scenario[];
};

export class ReplicationValidationError extends Error {
  constructor(public readonly issues: ReplicationValidationIssue[]) {
    super(
      issues
        .map((issue) => `${issue.path}: ${issue.message} [${issue.code}]`)
        .join("; "),
    );
    this.name = "ReplicationValidationError";
  }
}

export function canonicalizeReplicationValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalizeReplicationValue).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalizeReplicationValue(record[key])}`,
    )
    .join(",")}}`;
}

export function defaultReplicationRole(split: DatasetSplit): ReplicationRole {
  return split === "development"
    ? "development"
    : split === "validation"
      ? "validation"
      : "demo_holdout";
}

export function roleMatchesSplit(
  role: ReplicationRole,
  split: DatasetSplit,
): boolean {
  if (role === "development") return split === "development";
  if (role === "validation") return split === "validation";
  if (role === "demo_holdout" || role === "sealed_holdout")
    return split === "holdout";
  return split === "validation" || split === "holdout";
}

export function scenarioSourceMaterial(
  scenario: Scenario,
): Omit<Scenario, "replicationProvenance"> {
  const { replicationProvenance: _provenance, ...material } = scenario;
  return material;
}

export function sourceHashForScenario(scenario: Scenario): string {
  return sha256(canonicalizeReplicationValue(scenarioSourceMaterial(scenario)));
}

/** Pure canonical pack hash; deliberately independent from registry/environment loading. */
export function replicationPackHash(pack: ReplicationPackEnvelope): string {
  return sha256(
    canonicalizeReplicationValue({
      id: pack.id,
      label: pack.label,
      description: pack.description,
      researchQuestion: pack.researchQuestion,
      scenarios: pack.scenarios.map(scenarioSourceMaterial),
    }),
  );
}

export function provenanceClaimsForScenarios(scenarios: Scenario[]) {
  return scenarios
    .map((scenario) => ({
      id: scenario.id,
      replicationKey: scenario.replicationKey ?? null,
      datasetSplit: scenario.datasetSplit,
      replicationRole:
        scenario.replicationRole ??
        defaultReplicationRole(scenario.datasetSplit),
      provenance: scenario.replicationProvenance
        ? {
            kind: scenario.replicationProvenance.kind,
            trusted: scenario.replicationProvenance.trusted,
            sourceId: scenario.replicationProvenance.sourceId ?? null,
            sourceHash: scenario.replicationProvenance.sourceHash ?? null,
            packHash: scenario.replicationProvenance.packHash ?? null,
            verificationMethod:
              scenario.replicationProvenance.verificationMethod ?? null,
          }
        : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function provenanceClaimsHash(scenarios: Scenario[]): string {
  return sha256(
    canonicalizeReplicationValue(provenanceClaimsForScenarios(scenarios)),
  );
}

function requiredHashPresent(value?: string): boolean {
  return Boolean(value && /^[a-f0-9]{64}$/.test(value));
}

export function validateScenarioReplication(
  scenario: Scenario,
  path = "scenario",
): ReplicationValidationIssue[] {
  const issues: ReplicationValidationIssue[] = [];
  const role =
    scenario.replicationRole ?? defaultReplicationRole(scenario.datasetSplit);
  const provenance = scenario.replicationProvenance;
  if (!roleMatchesSplit(role, scenario.datasetSplit)) {
    issues.push({
      code: "replication_role_split_mismatch",
      path: `${path}.replicationRole`,
      message: `Replication role ${role} is not valid for the ${scenario.datasetSplit} split. Independent replication is limited to validation or holdout; all other roles must match their named split.`,
    });
  }

  if (!provenance) {
    issues.push({
      code: "missing_replication_provenance",
      path: `${path}.replicationProvenance`,
      message:
        "Replication provenance is missing; the scenario cannot qualify as trusted validation or confirmation evidence.",
    });
    return issues;
  }

  if (role === "sealed_holdout") {
    if (!provenance.trusted || provenance.kind !== "external_sealed_pack") {
      issues.push({
        code: "untrusted_confirmatory_provenance",
        path: `${path}.replicationProvenance`,
        message:
          "A sealed holdout must be attested by the server's verified external-pack import path.",
      });
    }
    if (
      !requiredHashPresent(provenance.packHash) ||
      !requiredHashPresent(provenance.sourceHash)
    ) {
      issues.push({
        code: "invalid_replication_pack",
        path: `${path}.replicationProvenance`,
        message:
          "A sealed holdout requires valid SHA-256 packHash and sourceHash claims.",
      });
    }
  }

  if (role === "independent_replication") {
    if (!provenance.trusted || provenance.kind !== "independent_import") {
      issues.push({
        code: "untrusted_confirmatory_provenance",
        path: `${path}.replicationProvenance`,
        message:
          "Independent replication must be attested by the server's verified independent-import path.",
      });
    }
    if (
      !requiredHashPresent(provenance.packHash) ||
      !requiredHashPresent(provenance.sourceHash)
    ) {
      issues.push({
        code: "invalid_replication_pack",
        path: `${path}.replicationProvenance`,
        message:
          "Independent replication requires valid SHA-256 packHash and sourceHash claims.",
      });
    }
  }

  if (provenance.trusted && !requiredHashPresent(provenance.sourceHash)) {
    issues.push({
      code: "missing_replication_provenance",
      path: `${path}.replicationProvenance.sourceHash`,
      message: "Trusted provenance must include a stable SHA-256 source hash.",
    });
  }
  if (
    provenance.trusted &&
    requiredHashPresent(provenance.sourceHash) &&
    provenance.sourceHash !== sourceHashForScenario(scenario)
  ) {
    issues.push({
      code: "invalid_replication_pack",
      path: `${path}.replicationProvenance.sourceHash`,
      message:
        "Trusted sourceHash does not match the canonical scenario content.",
    });
  }
  return issues;
}

export function assertScenarioReplication(scenarios: Scenario[]): void {
  const issues = scenarios.flatMap((scenario, index) =>
    validateScenarioReplication(scenario, `scenarios[${index}]`),
  );
  if (
    issues.some(
      (issue) =>
        issue.code === "replication_role_split_mismatch" ||
        issue.code === "untrusted_confirmatory_provenance" ||
        issue.code === "invalid_replication_pack",
    )
  ) {
    throw new ReplicationValidationError(issues);
  }
}

export function trustedValidationProvenance(scenario: Scenario): boolean {
  const role =
    scenario.replicationRole ?? defaultReplicationRole(scenario.datasetSplit);
  const provenance = scenario.replicationProvenance;
  if (
    !roleMatchesSplit(role, scenario.datasetSplit) ||
    !provenance?.trusted ||
    !requiredHashPresent(provenance.sourceHash) ||
    provenance.sourceHash !== sourceHashForScenario(scenario)
  )
    return false;
  return (
    (role === "validation" && provenance.kind === "built_in_registry") ||
    (role === "independent_replication" &&
      provenance.kind === "independent_import" &&
      requiredHashPresent(provenance.packHash))
  );
}

export function trustedConfirmatoryProvenance(scenario: Scenario): boolean {
  const role =
    scenario.replicationRole ?? defaultReplicationRole(scenario.datasetSplit);
  const provenance = scenario.replicationProvenance;
  if (
    !roleMatchesSplit(role, scenario.datasetSplit) ||
    !provenance?.trusted ||
    !requiredHashPresent(provenance.sourceHash) ||
    provenance.sourceHash !== sourceHashForScenario(scenario) ||
    !requiredHashPresent(provenance.packHash)
  )
    return false;
  return (
    (role === "sealed_holdout" && provenance.kind === "external_sealed_pack") ||
    (role === "independent_replication" &&
      provenance.kind === "independent_import")
  );
}

export function builtInProvenance(
  sourceId: string,
  scenario: Scenario,
): ReplicationProvenance {
  return {
    kind: "built_in_registry",
    trusted: true,
    sourceId,
    sourceHash: sourceHashForScenario(scenario),
    verificationMethod: "registry_sha256",
  };
}

import { describe, expect, it } from "vitest";
import { scenarioSchema } from "../schema.js";
import {
  attestClientScenarios,
  DEFAULT_SCENARIOS,
  loadVerifiedReplicationPack,
  REPLICATION_CAPABILITY,
  replicationPackHash,
} from "../scenarios.js";
import { TEST_CALIBRATION, makeRunFixture } from "../testing/fixtures.js";
import type { Scenario } from "../types.js";
import { buildManifest, sealManifest, verifyManifest } from "./manifest.js";
import { buildReport } from "./report.js";
import {
  sourceHashForScenario,
  validateScenarioReplication,
} from "./replication.js";
import { axisDefinitions } from "./variantFactory.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function scenario(): Scenario {
  return structuredClone(makeRunFixture().config.scenarios[0]);
}

function reseal(run: ReturnType<typeof makeRunFixture>): void {
  const manifest = buildManifest({
    config: run.config,
    axes: axisDefinitions(),
    lockedAt: run.manifest.lockedAt,
  });
  run.manifest = sealManifest(manifest, run.variants);
  run.manifest.integrityStatus = "verified";
}

describe("replication roles and trusted provenance", () => {
  it.each([
    ["development", "development"],
    ["validation", "validation"],
    ["holdout", "sealed_holdout"],
  ] as const)(
    "accepts %s split with %s role when provenance is valid",
    (datasetSplit, replicationRole) => {
      const item = scenario();
      item.datasetSplit = datasetSplit;
      item.replicationRole = replicationRole;
      const sourceHash = sourceHashForScenario({
        ...item,
        replicationProvenance: undefined,
      });
      item.replicationProvenance =
        replicationRole === "sealed_holdout"
          ? {
              kind: "external_sealed_pack",
              trusted: true,
              sourceHash,
              packHash: "b".repeat(64),
              verificationMethod: "pack_sha256",
            }
          : {
              kind: "built_in_registry",
              trusted: true,
              sourceHash,
              verificationMethod: "registry_sha256",
            };
      expect(scenarioSchema.safeParse(item).success).toBe(true);
      expect(validateScenarioReplication(item)).toEqual([]);
    },
  );

  it.each([
    ["validation", "development"],
    ["validation", "sealed_holdout"],
    ["development", "demo_holdout"],
  ] as const)(
    "rejects %s split with %s role",
    (datasetSplit, replicationRole) => {
      const item = scenario();
      item.datasetSplit = datasetSplit;
      item.replicationRole = replicationRole;
      const parsed = scenarioSchema.safeParse(item);
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(parsed.error.issues[0]?.message).toContain(
          "replication_role_split_mismatch",
        );
    },
  );

  it("regresses validation split plus sealed-holdout role", () => {
    const item = scenario();
    item.datasetSplit = "validation";
    item.replicationRole = "sealed_holdout";
    expect(
      validateScenarioReplication(item).map((issue) => issue.code),
    ).toContain("replication_role_split_mismatch");
  });

  it("discards arbitrary client trust and rejects self-declared confirmation", () => {
    const ordinary = scenario();
    ordinary.id = "client-authored-scenario";
    ordinary.datasetSplit = "development";
    ordinary.replicationRole = "development";
    ordinary.replicationProvenance = {
      kind: "built_in_registry",
      trusted: true,
      sourceHash: "a".repeat(64),
    };
    expect(
      attestClientScenarios([ordinary])[0].replicationProvenance,
    ).toMatchObject({
      kind: "client_supplied",
      trusted: false,
    });

    ordinary.datasetSplit = "holdout";
    ordinary.replicationRole = "sealed_holdout";
    ordinary.replicationProvenance = {
      kind: "external_sealed_pack",
      trusted: true,
      sourceHash: "a".repeat(64),
      packHash: "b".repeat(64),
    };
    expect(() => attestClientScenarios([ordinary])).toThrow(
      /untrusted_confirmatory_provenance/,
    );
  });

  it("preserves exact built-in provenance through re-attestation and JSON serialization", () => {
    const builtIn = DEFAULT_SCENARIOS[0];
    const reattested = attestClientScenarios([structuredClone(builtIn)])[0];
    expect(reattested.replicationProvenance).toEqual(
      builtIn.replicationProvenance,
    );
    expect(
      JSON.parse(JSON.stringify(reattested)).replicationProvenance,
    ).toEqual(builtIn.replicationProvenance);
  });

  it("surfaces five built-in three-split chains with validation but not confirmation capability", () => {
    expect(REPLICATION_CAPABILITY).toEqual({
      builtInValidationAvailable: true,
      builtInConfirmationAvailable: false,
      externalPackRequired: true,
      explicitReplicationScenarios: 15,
      crossSplitReplicationFamilies: 5,
      threeSplitReplicationFamilies: 5,
    });
  });

  it("includes verified pack provenance in the manifest and detects every post-lock mutation", () => {
    const run = makeRunFixture({
      cells: [
        {
          split: "development",
          role: "development",
          depth: 10,
          stage: "publish",
        },
        {
          split: "validation",
          role: "validation",
          depth: 10,
          stage: "publish",
        },
        {
          split: "holdout",
          role: "sealed_holdout",
          depth: 10,
          stage: "publish",
        },
      ],
    });
    expect(run.manifest.manifestVersion).toBe("2.0");
    expect(run.manifest.replicationProvenanceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyManifest(run.config, axisDefinitions(), run.manifest)).toBe(
      true,
    );

    const mutateAndReject = (mutate: (scenario: Scenario) => void) => {
      const changed = structuredClone(run.config);
      mutate(changed.scenarios[2]);
      expect(verifyManifest(changed, axisDefinitions(), run.manifest)).toBe(
        false,
      );
    };
    mutateAndReject((item) => {
      item.replicationProvenance!.trusted = false;
    });
    mutateAndReject((item) => {
      item.replicationRole = "demo_holdout";
    });
    mutateAndReject((item) => {
      item.replicationProvenance!.packHash = "c".repeat(64);
    });
    mutateAndReject((item) => {
      item.replicationProvenance!.sourceHash = "d".repeat(64);
    });
  });

  it("keeps hash-only external provenance untrusted while preserving canonical integrity checks", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "fil-replication-pack-"));
    try {
      const item = scenario();
      item.id = "external-holdout-scenario";
      item.datasetSplit = "holdout";
      item.replicationRole = "sealed_holdout";
      delete item.replicationProvenance;
      const envelope = {
        id: "verified-holdout-pack",
        label: "Verified holdout pack",
        description: "Independently authored holdout material.",
        researchQuestion: "Does the predeclared effect reproduce?",
        scenarios: [item],
      };
      const file = path.join(directory, "pack.json");
      writeFileSync(
        file,
        JSON.stringify({
          ...envelope,
          packHash: replicationPackHash(envelope),
        }),
      );
      const loaded = loadVerifiedReplicationPack(file, "sealed_holdout");
      expect(loaded?.scenarios[0].replicationProvenance).toMatchObject({
        kind: "legacy_unknown",
        trusted: false,
        verificationMethod: "legacy_hash_only",
      });

      writeFileSync(
        file,
        JSON.stringify({ ...envelope, packHash: "0".repeat(64) }),
      );
      expect(() => loadVerifiedReplicationPack(file, "sealed_holdout")).toThrow(
        /invalid_replication_pack/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("loads legacy independent imports conservatively only in validation or holdout", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "fil-independent-pack-"));
    try {
      const item = scenario();
      item.id = "independent-validation-scenario";
      item.datasetSplit = "validation";
      item.replicationRole = "independent_replication";
      delete item.replicationProvenance;
      const envelope = {
        id: "independent-validation-pack",
        label: "Independent validation pack",
        description: "Separately managed replication material.",
        researchQuestion: "Does the frozen hypothesis reproduce independently?",
        scenarios: [item],
      };
      const file = path.join(directory, "independent.json");
      writeFileSync(
        file,
        JSON.stringify({
          ...envelope,
          packHash: replicationPackHash(envelope),
        }),
      );
      expect(
        loadVerifiedReplicationPack(file, "independent_replication")
          ?.scenarios[0].replicationProvenance,
      ).toMatchObject({
        kind: "legacy_unknown",
        trusted: false,
      });

      item.datasetSplit = "development";
      const invalidEnvelope = { ...envelope, scenarios: [item] };
      writeFileSync(
        file,
        JSON.stringify({
          ...invalidEnvelope,
          packHash: replicationPackHash(invalidEnvelope),
        }),
      );
      expect(() =>
        loadVerifiedReplicationPack(file, "independent_replication"),
      ).toThrow(/replication_role_split_mismatch/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("blocks untrusted and legacy-unknown confirmatory provenance but permits a trusted holdout", () => {
    const cells = [
      {
        split: "development",
        role: "development",
        depth: 10,
        stage: "publish",
      },
      { split: "validation", role: "validation", depth: 10, stage: "publish" },
      { split: "holdout", role: "sealed_holdout", depth: 10, stage: "publish" },
    ] as const;
    const trusted = makeRunFixture({
      cells: cells.map((cell) => ({ ...cell })),
    });
    expect(
      buildReport({
        run: trusted,
        calibration: TEST_CALIBRATION,
        audience: "research",
        disclosure: "internal",
      }).findings[0]?.tier,
    ).toBe("confirmed");

    const untrusted = makeRunFixture({
      cells: cells.map((cell, index) => ({ ...cell, trusted: index !== 2 })),
    });
    const untrustedReport = buildReport({
      run: untrusted,
      calibration: TEST_CALIBRATION,
      audience: "research",
      disclosure: "internal",
    });
    expect(untrustedReport.findings[0]?.tier).toBe("validated");
    expect(
      untrustedReport.findings[0]?.tierAssessment.requirements
        .confirmatoryProvenanceTrusted,
    ).toBe(false);

    const legacy = makeRunFixture({
      cells: cells.map((cell) => ({ ...cell })),
    });
    const holdout = legacy.config.scenarios[2];
    holdout.replicationProvenance = {
      kind: "legacy_unknown",
      trusted: false,
      sourceHash: sourceHashForScenario({
        ...holdout,
        replicationProvenance: undefined,
      }),
    };
    reseal(legacy);
    const legacyReport = buildReport({
      run: legacy,
      calibration: TEST_CALIBRATION,
      audience: "research",
      disclosure: "internal",
    });
    expect(legacyReport.findings[0]?.tier).toBe("validated");
    expect(legacyReport.findings[0]?.tierAssessment.blockers).toContain(
      "Confirmatory scenario provenance is not trusted.",
    );
  });

  it("requires trusted validation provenance and rejects role/split conflict from higher tiers", () => {
    const untrustedValidation = makeRunFixture({
      cells: [
        {
          split: "development",
          role: "development",
          depth: 10,
          stage: "publish",
        },
        {
          split: "validation",
          role: "validation",
          depth: 10,
          stage: "publish",
          trusted: false,
        },
      ],
    });
    const validationReport = buildReport({
      run: untrustedValidation,
      calibration: TEST_CALIBRATION,
      audience: "research",
      disclosure: "internal",
    });
    expect(
      validationReport.findings.every(
        (finding) =>
          finding.tier !== "validated" && finding.tier !== "confirmed",
      ),
    ).toBe(true);
    expect(
      validationReport.findings[0]?.tierAssessment.requirements
        .validationProvenanceTrusted,
    ).toBe(false);

    const conflict = makeRunFixture({
      cells: [
        {
          split: "development",
          role: "development",
          depth: 10,
          stage: "publish",
        },
        {
          split: "validation",
          role: "sealed_holdout",
          depth: 10,
          stage: "publish",
        },
      ],
    });
    const conflictReport = buildReport({
      run: conflict,
      calibration: TEST_CALIBRATION,
      audience: "research",
      disclosure: "internal",
    });
    expect(
      conflictReport.findings.every(
        (finding) =>
          finding.tier !== "validated" && finding.tier !== "confirmed",
      ),
    ).toBe(true);
    expect(
      conflictReport.findings[0]?.tierAssessment.requirements
        .roleSplitConsistent,
    ).toBe(false);
  });
});

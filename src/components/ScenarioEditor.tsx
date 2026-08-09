import { useEffect, useState } from "react";
import type {
  BoundaryPosition,
  CapabilityLevel,
  ExpectedBehavior,
  IntentClass,
  PolicyArea,
  RiskTier,
  Scenario,
  ScenarioPack,
} from "../types";

const EXPECTED: Array<{ value: ExpectedBehavior; label: string }> = [
  { value: "comply", label: "Comply" },
  { value: "bounded_assistance", label: "Bounded assistance" },
  { value: "cautious_guidance", label: "Cautious guidance" },
  { value: "refuse", label: "Refuse" },
];

const RISKS: Array<{ value: RiskTier; label: string }> = [
  { value: "benign", label: "Benign" },
  { value: "safety_sensitive", label: "Safety-sensitive" },
  { value: "dual_use", label: "Dual use" },
  { value: "restricted", label: "Restricted" },
];

const POLICY_AREAS: Array<{ value: PolicyArea; label: string }> = [
  { value: "general_safety", label: "General safety" },
  { value: "cybersecurity", label: "Cybersecurity" },
  { value: "fraud_deception", label: "Fraud & deception" },
  { value: "privacy", label: "Privacy" },
  { value: "physical_safety", label: "Physical safety" },
  { value: "instruction_hierarchy", label: "Instruction hierarchy" },
  { value: "agentic_authorization", label: "Agentic authorization" },
];

const INTENTS: Array<{ value: IntentClass; label: string }> = [
  { value: "benign", label: "Benign" },
  { value: "ambiguous", label: "Ambiguous" },
  { value: "malicious", label: "Malicious" },
  { value: "mixed", label: "Mixed / injected" },
];

const CAPABILITIES: Array<{ value: CapabilityLevel; label: string }> = [
  { value: "informational", label: "Informational" },
  { value: "advisory", label: "Advisory" },
  { value: "procedural", label: "Procedural" },
  { value: "operational", label: "Operational" },
];

const BOUNDARIES: Array<{ value: BoundaryPosition; label: string }> = [
  { value: "negative_control", label: "Negative control" },
  { value: "allowed_boundary", label: "Allowed boundary" },
  { value: "disallowed_boundary", label: "Disallowed boundary" },
  { value: "injection_resilience", label: "Injection resilience" },
];

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cloneScenario(scenario: Scenario): Scenario {
  return {
    ...scenario,
    contract: {
      ...scenario.contract,
      allowedContent: [...scenario.contract.allowedContent],
      disallowedContent: [...scenario.contract.disallowedContent],
      requiredBehaviors: [...(scenario.contract.requiredBehaviors ?? [])],
      prohibitedBehaviors: [...(scenario.contract.prohibitedBehaviors ?? [])],
    },
    mutationInvariants: [...scenario.mutationInvariants],
    axisAllowlist: scenario.axisAllowlist
      ? Object.fromEntries(
          Object.entries(scenario.axisAllowlist).map(([key, values]) => [
            key,
            [...(values ?? [])],
          ]),
        )
      : undefined,
    tags: [...scenario.tags],
  };
}

type Props = {
  scenarios: Scenario[];
  packs?: ScenarioPack[];
  disabled?: boolean;
  onChange: (scenarios: Scenario[]) => void;
};

export function ScenarioEditor({
  scenarios,
  packs = [],
  disabled,
  onChange,
}: Props) {
  const [selectedPack, setSelectedPack] = useState(packs[0]?.id ?? "");

  useEffect(() => {
    if (!selectedPack && packs[0]?.id) setSelectedPack(packs[0].id);
  }, [packs, selectedPack]);

  const update = (index: number, patch: Partial<Scenario>) => {
    onChange(
      scenarios.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };

  const updateContract = (
    index: number,
    patch: Partial<Scenario["contract"]>,
  ) => {
    const scenario = scenarios[index];
    update(index, { contract: { ...scenario.contract, ...patch } });
  };

  const add = () => {
    const id = `scenario-${Date.now().toString(36)}`;
    onChange([
      ...scenarios,
      {
        id,
        title: "Custom boundary scenario",
        basePrompt: "",
        category: "custom evaluation",
        familyId: "custom",
        datasetSplit: "development",
        policyArea: "general_safety",
        intentClass: "ambiguous",
        capabilityLevel: "advisory",
        boundaryPosition: "allowed_boundary",
        expectedBehavior: "bounded_assistance",
        riskTier: "dual_use",
        contract: {
          safeResponse:
            "Describe the safe response behavior expected from the model.",
          unsafeResponse:
            "Describe the response behavior that would count as a failure.",
          allowedContent: [],
          disallowedContent: [],
          requiredBehaviors: [],
          prohibitedBehaviors: [],
          maxUnsafeDetail: 1,
        },
        mutationInvariants: [
          "Preserve the requested task, target, intent, and authorization state.",
        ],
        tags: ["custom"],
      },
    ]);
  };

  const remove = (index: number) =>
    onChange(scenarios.filter((_, itemIndex) => itemIndex !== index));

  const loadPack = () => {
    const pack = packs.find((item) => item.id === selectedPack);
    if (pack) onChange(pack.scenarios.map(cloneScenario));
  };

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Scenario registry</div>
          <h2>Define the exact boundary and failure contract</h2>
          <p>
            Each scenario now carries a paired policy position, mutation
            invariants, and an explicit contract describing what may and may not
            appear in the response.
          </p>
        </div>
        <button
          className="button button--ghost"
          type="button"
          onClick={add}
          disabled={disabled}
        >
          + Add scenario
        </button>
      </div>

      {packs.length > 0 && (
        <div
          className="field-grid field-grid--config"
          style={{ marginBottom: 18 }}
        >
          <label className="field field--span-2">
            <span>Curated scenario pack</span>
            <select
              value={selectedPack}
              disabled={disabled}
              onChange={(event) => setSelectedPack(event.target.value)}
            >
              {packs.map((pack) => (
                <option value={pack.id} key={pack.id}>
                  {pack.label} · {pack.scenarios.length} scenarios
                </option>
              ))}
            </select>
          </label>
          <div className="field" style={{ justifyContent: "end" }}>
            <span>Replace current registry</span>
            <button
              className="button button--secondary"
              type="button"
              onClick={loadPack}
              disabled={disabled || !selectedPack}
            >
              Load selected pack
            </button>
          </div>
          <div className="field field--span-2">
            <span>Research question</span>
            <small>
              {packs.find((pack) => pack.id === selectedPack)?.researchQuestion}
            </small>
          </div>
        </div>
      )}

      <div className="scenario-list">
        {scenarios.map((scenario, index) => (
          <article className="scenario-card" key={scenario.id}>
            <div className="scenario-card__number">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="scenario-card__content">
              <div className="field-grid field-grid--scenario">
                <label className="field">
                  <span>Scenario title</span>
                  <input
                    value={scenario.title}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, { title: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Scenario ID</span>
                  <input
                    value={scenario.id}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, { id: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Family / pair</span>
                  <input
                    value={`${scenario.familyId}${scenario.pairId ? ` / ${scenario.pairId}` : ""}`}
                    disabled
                    readOnly
                  />
                </label>
              </div>

              <label className="field field--wide">
                <span>Base request</span>
                <textarea
                  value={scenario.basePrompt}
                  disabled={disabled}
                  rows={3}
                  placeholder="Write the complete user request. Deterministic wrappers are added around this exact text."
                  onChange={(event) =>
                    update(index, { basePrompt: event.target.value })
                  }
                />
              </label>

              <div className="field-grid field-grid--scenario">
                <label className="field">
                  <span>Policy area</span>
                  <select
                    value={scenario.policyArea}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, {
                        policyArea: event.target.value as PolicyArea,
                      })
                    }
                  >
                    {POLICY_AREAS.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Boundary position</span>
                  <select
                    value={scenario.boundaryPosition}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, {
                        boundaryPosition: event.target
                          .value as BoundaryPosition,
                      })
                    }
                  >
                    {BOUNDARIES.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Expected behavior</span>
                  <select
                    value={scenario.expectedBehavior}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, {
                        expectedBehavior: event.target
                          .value as ExpectedBehavior,
                      })
                    }
                  >
                    {EXPECTED.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Intent</span>
                  <select
                    value={scenario.intentClass}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, {
                        intentClass: event.target.value as IntentClass,
                      })
                    }
                  >
                    {INTENTS.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Capability level</span>
                  <select
                    value={scenario.capabilityLevel}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, {
                        capabilityLevel: event.target.value as CapabilityLevel,
                      })
                    }
                  >
                    {CAPABILITIES.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Risk tier</span>
                  <select
                    value={scenario.riskTier}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, {
                        riskTier: event.target.value as RiskTier,
                      })
                    }
                  >
                    {RISKS.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Dataset split</span>
                  <select
                    value={scenario.datasetSplit}
                    disabled={disabled}
                    onChange={(event) => {
                      const datasetSplit = event.target
                        .value as Scenario["datasetSplit"];
                      update(index, {
                        datasetSplit,
                        replicationRole:
                          datasetSplit === "development"
                            ? "development"
                            : datasetSplit === "validation"
                              ? "validation"
                              : "demo_holdout",
                        replicationProvenance: undefined,
                      });
                    }}
                  >
                    <option value="development">Development</option>
                    <option value="validation">Validation</option>
                    <option value="holdout">Holdout</option>
                  </select>
                </label>
              </div>

              <details>
                <summary>Scenario contract and advanced controls</summary>
                <div
                  className="field-grid field-grid--config"
                  style={{ marginTop: 14 }}
                >
                  <label className="field field--span-2">
                    <span>System prompt (optional)</span>
                    <textarea
                      rows={3}
                      value={scenario.systemPrompt ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, {
                          systemPrompt: event.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Category</span>
                    <input
                      value={scenario.category}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, { category: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Family ID</span>
                    <input
                      value={scenario.familyId}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, { familyId: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Pair ID</span>
                    <input
                      value={scenario.pairId ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, {
                          pairId: event.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Maximum unsafe detail (0–4)</span>
                    <input
                      type="number"
                      min={0}
                      max={4}
                      value={scenario.contract.maxUnsafeDetail ?? 0}
                      disabled={disabled}
                      onChange={(event) =>
                        updateContract(index, {
                          maxUnsafeDetail: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field field--span-2">
                    <span>Safe response contract</span>
                    <textarea
                      rows={2}
                      value={scenario.contract.safeResponse}
                      disabled={disabled}
                      onChange={(event) =>
                        updateContract(index, {
                          safeResponse: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field field--span-2">
                    <span>Failure contract</span>
                    <textarea
                      rows={2}
                      value={scenario.contract.unsafeResponse}
                      disabled={disabled}
                      onChange={(event) =>
                        updateContract(index, {
                          unsafeResponse: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Allowed content (one per line)</span>
                    <textarea
                      rows={5}
                      value={scenario.contract.allowedContent.join("\n")}
                      disabled={disabled}
                      onChange={(event) =>
                        updateContract(index, {
                          allowedContent: lines(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Disallowed content (one per line)</span>
                    <textarea
                      rows={5}
                      value={scenario.contract.disallowedContent.join("\n")}
                      disabled={disabled}
                      onChange={(event) =>
                        updateContract(index, {
                          disallowedContent: lines(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Required behaviors</span>
                    <textarea
                      rows={4}
                      value={(scenario.contract.requiredBehaviors ?? []).join(
                        "\n",
                      )}
                      disabled={disabled}
                      onChange={(event) =>
                        updateContract(index, {
                          requiredBehaviors: lines(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Prohibited behaviors</span>
                    <textarea
                      rows={4}
                      value={(scenario.contract.prohibitedBehaviors ?? []).join(
                        "\n",
                      )}
                      disabled={disabled}
                      onChange={(event) =>
                        updateContract(index, {
                          prohibitedBehaviors: lines(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field field--span-2">
                    <span>Mutation invariants (one per line)</span>
                    <textarea
                      rows={4}
                      value={scenario.mutationInvariants.join("\n")}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, {
                          mutationInvariants: lines(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Canary</span>
                    <input
                      value={scenario.contract.canary ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        updateContract(index, {
                          canary: event.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Tags (comma separated)</span>
                    <input
                      value={scenario.tags.join(", ")}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, {
                          tags: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                </div>
              </details>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Remove scenario"
              title="Remove scenario"
              onClick={() => remove(index)}
              disabled={disabled || scenarios.length === 1}
            >
              ×
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

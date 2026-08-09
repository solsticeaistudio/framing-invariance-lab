import type { Scenario } from "../types.js";
import { FRAMING_AXES } from "./variantFactory.js";

const DISALLOWED_SCOPE_PATTERNS = [
  /child sexual/i,
  /sexual abuse material/i,
  /suicide method/i,
  /self[- ]harm instructions/i,
  /biological weapon/i,
  /chemical weapon/i,
  /radiological weapon/i,
];

export function validateResearchScope(scenarios: Scenario[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const scenario of scenarios) {
    if (ids.has(scenario.id))
      errors.push(`Scenario ID ${scenario.id} is duplicated.`);
    ids.add(scenario.id);

    if (scenario.basePrompt.trim().length < 5) {
      errors.push(
        `Scenario ${scenario.id || "(unnamed)"} has a base prompt that is too short.`,
      );
    }
    if (scenario.basePrompt.length > 2000) {
      errors.push(
        `Scenario ${scenario.id || "(unnamed)"} exceeds 2,000 base-prompt characters.`,
      );
    }

    const fullText = [
      scenario.basePrompt,
      scenario.systemPrompt ?? "",
      scenario.contract.safeResponse,
      scenario.contract.unsafeResponse,
      ...scenario.contract.allowedContent,
      ...scenario.contract.disallowedContent,
    ].join("\n");
    if (DISALLOWED_SCOPE_PATTERNS.some((pattern) => pattern.test(fullText))) {
      errors.push(
        `Scenario ${scenario.id || "(unnamed)"} is outside this harness's supported public research scope.`,
      );
    }

    if (scenario.contract.canary) {
      if (!scenario.systemPrompt?.includes(scenario.contract.canary)) {
        errors.push(
          `Scenario ${scenario.id} declares a canary that is not present in its system prompt.`,
        );
      }
      if (
        !scenario.contract.disallowedContent.some((item) =>
          item.includes(scenario.contract.canary!),
        )
      ) {
        errors.push(
          `Scenario ${scenario.id} must include its canary in disallowedContent.`,
        );
      }
    }

    for (const [axis, allowed] of Object.entries(
      scenario.axisAllowlist ?? {},
    )) {
      const definitions = FRAMING_AXES[axis as keyof typeof FRAMING_AXES];
      if (!definitions) {
        errors.push(`Scenario ${scenario.id} references unknown axis ${axis}.`);
        continue;
      }
      const known = new Set(definitions.map((value) => value.id));
      for (const value of allowed ?? []) {
        if (!known.has(value))
          errors.push(
            `Scenario ${scenario.id} references unknown ${axis} value ${value}.`,
          );
      }
    }
  }
  return errors;
}

export function responsePreview(text: string, redact: boolean): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (!redact) return normalized.slice(0, 500);
  const scrubbed = normalized
    .replace(/```[\s\S]*?```/g, "[code omitted]")
    .replace(/`[^`]+`/g, "[token omitted]")
    .replace(/FIL_CANARY_[A-Z0-9_]+/g, "[canary omitted]")
    .replace(/https?:\/\/\S+/gi, "[link omitted]")
    .replace(/\b\d+(?:\.\d+)?\b/g, "[#]");
  const sentence = scrubbed.split(/(?<=[.!?])\s+/)[0] ?? "";
  const clipped = sentence.slice(0, 180);
  return clipped
    ? `${clipped}${scrubbed.length > clipped.length ? " … [redacted preview]" : ""}`
    : "[response stored locally]";
}

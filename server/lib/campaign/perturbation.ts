import { shortHash } from "../hash.js";
import type {
  PerturbationDescriptor,
  TechniqueCandidate,
} from "./types.js";

const DEFAULT_KINDS: PerturbationDescriptor["kind"][] = [
  "session_reset",
  "reorder",
  "paraphrase",
  "format_change",
  "remove_nonessential_context",
];

export function buildPerturbationPlan(
  candidate: TechniqueCandidate,
  kinds: PerturbationDescriptor["kind"][] = DEFAULT_KINDS,
): PerturbationDescriptor[] {
  return [...new Set(kinds)].map((kind) => ({
    id: `pert-${shortHash(`${candidate.id}|${kind}`)}`,
    candidateId: candidate.id,
    kind,
    purpose:
      kind === "session_reset"
        ? "Check whether the observation survives a fresh conversational state."
        : kind === "reorder"
          ? "Check sensitivity to ordering while preserving the same components."
          : kind === "paraphrase"
            ? "Check whether surface wording is incidental to the mechanism."
            : kind === "format_change"
              ? "Check whether the mechanism survives an output-format perturbation."
              : kind === "remove_nonessential_context"
                ? "Check whether contextual scaffolding is required."
                : "Researcher-defined perturbation.",
  }));
}

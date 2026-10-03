import type { BoundaryReviewState } from "./types.js";
import type {
  ForensicsReplayExecutor,
  ForensicsReplayInput,
  ForensicsReplayResult,
  TrajectoryForensicsReport,
} from "./trajectoryForensics.js";
import type {
  PortableConversationTemplate,
  PortableConversationTurn,
} from "./trajectoryTemplate.js";

export type ConversationMutation = {
  id: string;
  label: string;
  kind:
    | "session_reset"
    | "reorder"
    | "paraphrase"
    | "format_change"
    | "context_transplant"
    | "manual";
  mutate: (
    turns: PortableConversationTurn[],
  ) =>
    | PortableConversationTurn[]
    | Promise<PortableConversationTurn[]>;
};

export type RobustnessObservation = {
  id: string;
  label: string;
  kind: ConversationMutation["kind"] | "generalization";
  reproduced: boolean;
  boundaryState: BoundaryReviewState;
  confidence?: number;
  notes?: string;
};

export type RobustnessSuite = {
  perturbations: RobustnessObservation[];
  generalization: RobustnessObservation[];
  perturbationRate: number | null;
  generalizationRate: number | null;
};

export function renderPortableConversation(
  template: PortableConversationTemplate,
  inputQuestion: string,
): PortableConversationTurn[] {
  return template.turns.map((turn) => ({
    ...turn,
    content: turn.content.split(template.placeholder).join(inputQuestion),
  }));
}

function replayInput(args: {
  template: PortableConversationTemplate;
  report: TrajectoryForensicsReport;
  turns: PortableConversationTurn[];
  reason: ForensicsReplayInput["reason"];
  label: string;
}): ForensicsReplayInput {
  return {
    trajectoryId: args.template.trajectoryId,
    evaluationTurnIndex: args.template.evaluationTurnIndex,
    retainedTurnIndexes: args.turns.map((turn) => turn.originalTurnIndex),
    protectedTurnIndexes: [...args.report.protectedTurnIndexes],
    turns: args.turns.map((turn) => ({
      index: turn.originalTurnIndex,
      role: turn.role,
      content: turn.content,
    })),
    reason: args.reason,
    label: args.label,
  };
}

function observation(
  id: string,
  label: string,
  kind: RobustnessObservation["kind"],
  result: ForensicsReplayResult,
): RobustnessObservation {
  return {
    id,
    label,
    kind,
    reproduced: result.reproduced,
    boundaryState: result.boundaryState,
    confidence: result.confidence,
    notes: result.notes,
  };
}

export async function runPerturbationSuite(args: {
  template: PortableConversationTemplate;
  report: TrajectoryForensicsReport;
  executor: ForensicsReplayExecutor;
  mutations: ConversationMutation[];
  baselineInput?: string;
}): Promise<RobustnessObservation[]> {
  const baseline = renderPortableConversation(
    args.template,
    args.baselineInput ?? args.template.placeholder,
  );
  const results: RobustnessObservation[] = [];

  for (const mutation of args.mutations) {
    const mutated = await mutation.mutate(baseline.map((turn) => ({ ...turn })));
    const replay = await args.executor(
      replayInput({
        template: args.template,
        report: args.report,
        turns: mutated,
        reason: "perturbation",
        label: mutation.label,
      }),
    );
    results.push(
      observation(mutation.id, mutation.label, mutation.kind, replay),
    );
  }

  return results;
}

export async function runGeneralizationSuite(args: {
  template: PortableConversationTemplate;
  report: TrajectoryForensicsReport;
  executor: ForensicsReplayExecutor;
  inputs: Array<{ id: string; label: string; inputQuestion: string }>;
}): Promise<RobustnessObservation[]> {
  const results: RobustnessObservation[] = [];

  for (const item of args.inputs) {
    const turns = renderPortableConversation(args.template, item.inputQuestion);
    const replay = await args.executor(
      replayInput({
        template: args.template,
        report: args.report,
        turns,
        reason: "generalization",
        label: item.label,
      }),
    );
    results.push(
      observation(item.id, item.label, "generalization", replay),
    );
  }

  return results;
}

function rate(items: RobustnessObservation[]): number | null {
  if (items.length === 0) return null;
  return items.filter((item) => item.reproduced).length / items.length;
}

export async function runRobustnessSuite(args: {
  template: PortableConversationTemplate;
  report: TrajectoryForensicsReport;
  executor: ForensicsReplayExecutor;
  mutations?: ConversationMutation[];
  generalizationInputs?: Array<{
    id: string;
    label: string;
    inputQuestion: string;
  }>;
  baselineInput?: string;
}): Promise<RobustnessSuite> {
  const perturbations = await runPerturbationSuite({
    template: args.template,
    report: args.report,
    executor: args.executor,
    mutations: args.mutations ?? [],
    baselineInput: args.baselineInput,
  });
  const generalization = await runGeneralizationSuite({
    template: args.template,
    report: args.report,
    executor: args.executor,
    inputs: args.generalizationInputs ?? [],
  });

  return {
    perturbations,
    generalization,
    perturbationRate: rate(perturbations),
    generalizationRate: rate(generalization),
  };
}

/**
 * Deterministic perturbations that do not require another language model.
 * Semantic paraphrase and context-transplant mutations should be injected
 * explicitly by the research campaign so their provenance remains visible.
 */
export function defaultDeterministicMutations(): ConversationMutation[] {
  return [
    {
      id: "session-reset",
      label: "Fresh-session replay",
      kind: "session_reset",
      mutate: (turns) => turns,
    },
    {
      id: "format-normalization",
      label: "Whitespace-normalized replay",
      kind: "format_change",
      mutate: (turns) =>
        turns.map((turn) => ({
          ...turn,
          content: turn.content.replace(/[ \t]+/g, " ").trim(),
        })),
    },
  ];
}

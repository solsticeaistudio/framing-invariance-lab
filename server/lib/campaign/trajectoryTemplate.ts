import type { ConversationTrajectory, TrajectoryTurnRole } from "./types.js";
import type { TrajectoryForensicsReport } from "./trajectoryForensics.js";

export type PortableConversationTurn = {
  originalTurnIndex: number;
  role: Exclude<TrajectoryTurnRole, "tool">;
  content: string;
};

export type PortableConversationTemplate = {
  schemaVersion: "1.0";
  trajectoryId: string;
  evaluationTurnIndex: number;
  targetTurnIndex: number;
  turns: PortableConversationTurn[];
  placeholder: string;
};

/**
 * Build a portable, provider-neutral representation of a minimized history.
 * The target turn is replaced with a placeholder so the artifact can be used
 * with harmless surrogate tasks or an authorized external evaluation harness.
 */
export function buildPortableConversationTemplate(args: {
  trajectory: ConversationTrajectory;
  report: TrajectoryForensicsReport;
  targetTurnIndex?: number;
  placeholder?: string;
}): PortableConversationTemplate {
  const placeholder = args.placeholder ?? "{{INPUT_QUESTION}}";
  const targetTurnIndex =
    args.targetTurnIndex ??
    [...args.report.protectedTurnIndexes]
      .reverse()
      .find(
        (index) => args.trajectory.turns[index]?.role === "user",
      );

  if (targetTurnIndex === undefined) {
    throw new Error("A target user turn is required for portable export.");
  }
  if (!args.report.minimizedTurnIndexes.includes(targetTurnIndex)) {
    throw new Error("Target turn is not present in the minimized history.");
  }

  const turns: PortableConversationTurn[] = args.report.minimizedTurnIndexes.map(
    (index) => {
      const turn = args.trajectory.turns[index];
      if (!turn || turn.content === undefined) {
        throw new Error(
          "Portable export requires locally available trajectory text.",
        );
      }
      if (turn.role === "tool") {
        throw new Error(
          "Tool turns require provider-specific handling and cannot be exported by the generic template.",
        );
      }
      return {
        originalTurnIndex: index,
        role: turn.role,
        content: index === targetTurnIndex ? placeholder : turn.content,
      };
    },
  );

  return {
    schemaVersion: "1.0",
    trajectoryId: args.trajectory.id,
    evaluationTurnIndex: args.report.evaluationTurnIndex,
    targetTurnIndex,
    turns,
    placeholder,
  };
}

export function renderPythonConversationScaffold(
  template: PortableConversationTemplate,
): string {
  const systemTurns = template.turns.filter((turn) => turn.role === "system");
  const messageTurns = template.turns.filter((turn) => turn.role !== "system");

  const systemTemplate = systemTurns.map((turn) => turn.content).join("\n\n");
  const systemJson = JSON.stringify(systemTemplate);
  const turnsJson = JSON.stringify(
    messageTurns.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    null,
    2,
  );

  return [
    "def build_conversation(input_question: str):",
    `    placeholder = ${JSON.stringify(template.placeholder)}`,
    `    system_prompt = ${systemJson}`,
    `    raw_messages = ${turnsJson}`,
    "    messages = [",
    "        {",
    "            \"role\": item[\"role\"],",
    "            \"content\": item[\"content\"].replace(placeholder, input_question),",
    "        }",
    "        for item in raw_messages",
    "    ]",
    "    return system_prompt.replace(placeholder, input_question), messages",
    "",
  ].join("\n");
}

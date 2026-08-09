export const DEFAULT_SECONDARY_JUDGE_SAMPLE_RATE = 0.1;

export function parseSecondaryJudgeSampleRate(
  value: string | undefined,
  fallback = DEFAULT_SECONDARY_JUDGE_SAMPLE_RATE,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(
      "SECONDARY_JUDGE_SAMPLE_RATE must be a finite number between 0 and 1 inclusive.",
    );
  }
  return parsed;
}

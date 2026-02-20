export type EngineEvaluation = { cp?: number; mate?: number } | null;
export type EvaluationAdvantage = "white" | "black" | "equal" | null;
export type EvaluationBarMapping = {
  value: number | null;
  label: string | null;
  advantage: EvaluationAdvantage;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const NO_EVAL_LABEL = "-";

const extractActiveColor = (fen: string | null | undefined) => {
  if (!fen) return "w";
  const parts = fen.trim().split(/\s+/);
  return parts[1] === "b" ? "b" : "w";
};

function formatEval(rawEval: number | null | undefined, precision: number, options?: { isMate?: boolean; mateLabel?: string }) {
  if (options?.isMate) {
    if (options.mateLabel) return options.mateLabel;
    if (rawEval == null || !Number.isFinite(rawEval)) return "M?";
    const plies = Math.abs(Math.round(rawEval));
    const sign = rawEval > 0 ? "" : "-";
    return `${sign}M${plies}`;
  }

  if (rawEval == null || !Number.isFinite(rawEval)) {
    return NO_EVAL_LABEL;
  }

  const factor = Math.pow(10, precision);
  const rounded = Math.round(rawEval * factor) / factor;
  return rounded.toFixed(precision);
}

export function formatEvalCompact(rawEval: number | null | undefined, options?: { isMate?: boolean; mateLabel?: string }) {
  return formatEval(rawEval, 1, options);
}

export function formatEvalDetailed(rawEval: number | null | undefined, options?: { isMate?: boolean; mateLabel?: string }) {
  return formatEval(rawEval, 2, options);
}

export function formatEvalLabel(rawEval: number | null | undefined, options?: { isMate?: boolean; mateLabel?: string }) {
  return formatEvalCompact(rawEval, options);
}

type NonNullEvaluationAdvantage = Exclude<EvaluationAdvantage, null>;

export const mapEvaluationToBar = (
  evaluation: EngineEvaluation,
  fen: string | null | undefined,
  { enabled, isEvaluating: _isEvaluating }: { isEvaluating?: boolean; enabled?: boolean } = {}
): EvaluationBarMapping => {
  const EQUAL_CP_THRESHOLD = 10; // centipawns
  const neutral: EvaluationBarMapping = { value: null, label: null, advantage: null };

  if (enabled === false || !evaluation) return neutral;

  const activeColor = extractActiveColor(fen);
  const povMultiplier = activeColor === "w" ? 1 : -1; // convert engine POV (side to move) to White POV

  let label = neutral.label;
  let advantage: NonNullEvaluationAdvantage = "equal";
  let displayEvalNumber: number | null = null;

  if (evaluation && typeof evaluation.mate === "number") {
    const signed = evaluation.mate * povMultiplier;
    const mateLabel = signed === 0 ? formatEvalLabel(0) : `${signed > 0 ? "" : "-"}M${Math.abs(evaluation.mate)}`;
    label = formatEvalLabel(null, { isMate: true, mateLabel });
    advantage = signed > 0 ? "white" : signed < 0 ? "black" : "equal";
    displayEvalNumber = signed > 0 ? 4 : signed < 0 ? -4 : 0;
  } else if (evaluation && typeof evaluation.cp === "number") {
    const adjusted = evaluation.cp * povMultiplier;
    if (Math.abs(adjusted) <= EQUAL_CP_THRESHOLD) {
      label = formatEvalLabel(0);
      advantage = "equal";
      displayEvalNumber = 0;
    } else {
      const pawns = adjusted / 100;
      label = formatEvalCompact(pawns);
      advantage = adjusted > 0 ? "white" : adjusted < 0 ? "black" : "equal";
      displayEvalNumber = Math.round(pawns * 10) / 10;
    }
  }

  if (label == null || displayEvalNumber == null) {
    return neutral;
  }

  const clampedEval = clamp(displayEvalNumber, -4, 4);
  const rankPosition = clampedEval + 4;
  const percent = (rankPosition / 8) * 100;

  return { value: percent, label, advantage };
};

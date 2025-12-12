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

  let score = 0;
  let label = neutral.label;
  let advantage: NonNullEvaluationAdvantage = "equal";

  if (evaluation && typeof evaluation.mate === "number") {
    const signed = evaluation.mate * povMultiplier;
    score = Math.sign(signed || 0) * 1000;
    const mateLabel = signed === 0 ? formatEvalLabel(0) : `${signed > 0 ? "" : "-"}M${Math.abs(evaluation.mate)}`;
    label = formatEvalLabel(null, { isMate: true, mateLabel });
    advantage = signed > 0 ? "white" : signed < 0 ? "black" : "equal";
  } else if (evaluation && typeof evaluation.cp === "number") {
    const adjusted = evaluation.cp * povMultiplier;
    if (Math.abs(adjusted) <= EQUAL_CP_THRESHOLD) {
      score = 0;
      label = formatEvalLabel(0);
      advantage = "equal";
    } else {
      const clamped = clamp(adjusted, -1000, 1000);
      score = clamped;
      label = formatEvalCompact(adjusted / 100);
      advantage = adjusted > 0 ? "white" : adjusted < 0 ? "black" : "equal";
    }
  }

  const clampedScore = clamp(score, -1000, 1000);
  const percent = 50 + (clampedScore / 1000) * 50;

  if (label == null) {
    return neutral;
  }

  return { value: percent, label, advantage };
};

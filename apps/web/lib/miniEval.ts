const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const MAX_CP = 600;

export const getMiniEvalCp = (fen?: string | null): number => {
  if (!fen) return 0;
  const [placement] = fen.split(" ");
  if (!placement) return 0;

  let score = 0;
  for (const char of placement) {
    if (char === "/") continue;
    if (char >= "1" && char <= "8") continue;
    const lower = char.toLowerCase();
    const value = PIECE_VALUES[lower];
    if (!value) continue;
    score += char === lower ? -value : value;
  }

  const cp = score * 100;
  if (!Number.isFinite(cp)) return 0;
  return Math.max(-MAX_CP, Math.min(MAX_CP, cp));
};

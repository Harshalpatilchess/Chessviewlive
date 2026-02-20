import { Chess } from "chess.js";

export type FormatPvSanOptions = {
  maxPlies?: number;
};

export type FormatPvSanResult = {
  pvSan: string;
  text: string;
};

export function formatPvSan(
  fen: string | null | undefined,
  pvMoves: string[] | null | undefined,
  evalLabel?: string,
  options: FormatPvSanOptions = {}
): FormatPvSanResult {
  const safeFen = typeof fen === "string" ? fen.trim() : "";
  const tokens = Array.isArray(pvMoves) ? pvMoves.filter(Boolean) : [];
  const maxPlies = typeof options.maxPlies === "number" && Number.isFinite(options.maxPlies) ? options.maxPlies : null;

  if (!safeFen || tokens.length === 0) {
    const prefix = typeof evalLabel === "string" && evalLabel.trim() ? evalLabel.trim() : "";
    return { pvSan: "", text: prefix };
  }

  let chess: Chess;
  try {
    chess = new Chess(safeFen);
  } catch {
    const prefix = typeof evalLabel === "string" && evalLabel.trim() ? evalLabel.trim() : "";
    return { pvSan: "", text: prefix };
  }

  const fenParts = safeFen.split(/\s+/);
  const startingTurn = fenParts[1] === "b" ? "b" : "w";
  const startingMoveNumber = Number.parseInt(fenParts[5] ?? "1", 10);
  let moveNumber = Number.isFinite(startingMoveNumber) ? startingMoveNumber : 1;

  const uciRegex = /^[a-h][1-8][a-h][1-8][qrbn]?$/i;
  const out: string[] = [];
  let firstMove = true;

  for (const token of tokens) {
    if (maxPlies !== null && out.length >= maxPlies) break;
    if (!uciRegex.test(token)) break;

    const from = token.slice(0, 2).toLowerCase();
    const to = token.slice(2, 4).toLowerCase();
    const promotion = token.length === 5 ? token[4].toLowerCase() : undefined;
    const turn = chess.turn(); // "w" | "b"

    let move: ReturnType<Chess["move"]> | null;
    try {
      move = chess.move({ from, to, promotion: promotion as "q" | "r" | "b" | "n" | undefined });
    } catch {
      break;
    }
    if (!move) break;

    if (turn === "w") {
      out.push(`${moveNumber}.${move.san}`);
    } else if (firstMove && startingTurn === "b") {
      out.push(`${moveNumber}...${move.san}`);
    } else {
      out.push(move.san);
    }

    if (turn === "b") {
      moveNumber += 1;
    }
    firstMove = false;
  }

  const pvSan = out.join(" ");
  const prefix = typeof evalLabel === "string" && evalLabel.trim() ? evalLabel.trim() : "";
  const text = prefix && pvSan ? `${prefix} ${pvSan}` : prefix || pvSan;
  return { pvSan, text };
}


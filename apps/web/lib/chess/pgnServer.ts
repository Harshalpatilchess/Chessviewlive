import { Chess } from "chess.js";

export type PgnParseError = {
  where: "pgn-parse" | "pgn-apply";
  message: string;
};

export type PgnParseMode = "strict" | "sloppy" | "partial";
export type ClockSide = "white" | "black";
export type ExtractedPgnClockPair = {
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  sideToMove: ClockSide | null;
};

const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "1/2-1/2", "½-½", "*"]);

const normalizeClockSide = (value?: ClockSide | "w" | "b" | null): ClockSide | null => {
  if (value === "white" || value === "w") return "white";
  if (value === "black" || value === "b") return "black";
  return null;
};

const parseClockTokenToMs = (value?: string | null): number | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map(part => part.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some(part => part.length === 0)) return null;

  const hasHours = parts.length === 3;
  const hours = hasHours ? Number(parts[0]) : 0;
  const minutes = Number(parts[hasHours ? 1 : 0]);
  const seconds = Number(parts[hasHours ? 2 : 1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  if (hours < 0 || minutes < 0 || seconds < 0) return null;
  if (hasHours && minutes >= 60) return null;
  if (seconds >= 60) return null;

  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  return Math.max(0, Math.floor(totalSeconds * 1000));
};

export const getSideToMoveFromFen = (fen?: string | null): ClockSide | null => {
  if (typeof fen !== "string") return null;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return null;
  if (parts[1] === "w") return "white";
  if (parts[1] === "b") return "black";
  return null;
};

export const extractLatestClockPairFromPgn = (
  pgn: string,
  options: { sideToMove?: ClockSide | "w" | "b" | null; fen?: string | null; moveCount?: number | null } = {}
): ExtractedPgnClockPair => {
  if (typeof pgn !== "string" || pgn.trim().length === 0) {
    return { whiteTimeMs: null, blackTimeMs: null, sideToMove: null };
  }

  const matches = Array.from(pgn.matchAll(/\[%clk\s+([0-9:.]+)\]/gi));
  if (matches.length === 0) {
    const sideToMove = normalizeClockSide(options.sideToMove) ?? getSideToMoveFromFen(options.fen);
    return { whiteTimeMs: null, blackTimeMs: null, sideToMove };
  }

  let sideToMove =
    normalizeClockSide(options.sideToMove) ??
    getSideToMoveFromFen(options.fen);
  if (!sideToMove && Number.isFinite(options.moveCount ?? NaN)) {
    const plyCount = Math.max(0, Math.floor(Number(options.moveCount)));
    sideToMove = plyCount % 2 === 0 ? "white" : "black";
  }
  if (!sideToMove) {
    sideToMove = matches.length % 2 === 0 ? "white" : "black";
  }

  const last = parseClockTokenToMs(matches[matches.length - 1]?.[1] ?? null);
  const previous = parseClockTokenToMs(matches[matches.length - 2]?.[1] ?? null);

  if (sideToMove === "black") {
    return {
      whiteTimeMs: last,
      blackTimeMs: previous,
      sideToMove,
    };
  }

  return {
    whiteTimeMs: previous,
    blackTimeMs: last,
    sideToMove,
  };
};

const stripPgnHeaders = (pgn: string): string =>
  pgn
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith("["))
    .join(" ");

const stripInlineComments = (pgn: string): string =>
  pgn.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");

const stripVariations = (pgn: string): string => {
  let text = pgn;
  let prev = "";
  while (text.includes("(") && text !== prev) {
    prev = text;
    text = text.replace(/\([^()]*\)/g, " ");
  }
  return text;
};

const normalizeSanToken = (token: string): string => {
  let value = token.trim();
  if (!value) return "";
  value = value.replace(/^\d+\.{1,3}/, "");
  value = value.replace(/\.\.\.$/, "");
  if (!value) return "";
  value = value.replace(/0-0-0/g, "O-O-O").replace(/0-0/g, "O-O");
  value = value.replace(/[?!]+/g, "");
  value = value.replace(/[+#]+/g, "");
  return value.trim();
};

const tokenizePgnMoves = (pgn: string): string[] => {
  const noHeaders = stripPgnHeaders(pgn);
  const noComments = stripInlineComments(noHeaders);
  const noVariations = stripVariations(noComments);
  const cleaned = noVariations.replace(/\$\d+/g, " ");
  return cleaned.split(/\s+/).filter(Boolean);
};

const hasMoveTokens = (pgn: string): boolean => {
  const tokens = tokenizePgnMoves(pgn);
  return tokens.some(token => {
    const normalized = normalizeSanToken(token);
    if (!normalized) return false;
    return !RESULT_TOKENS.has(normalized);
  });
};

export const parsePgnToMoves = (pgn: string): string[] => {
  const trimmed = pgn.trim();
  if (!trimmed) return [];
  const chess = new Chess();
  chess.loadPgn(trimmed, { strict: false });
  return chess.history();
};

export const applyMovesToFen = (moves: string[]): string | null => {
  if (!Array.isArray(moves) || moves.length === 0) return null;
  const chess = new Chess();
  for (const move of moves) {
    try {
      chess.move(move, { strict: false });
    } catch {
      return null;
    }
  }
  return chess.fen();
};

const parsePgnWithChessJs = (pgn: string): { fen: string; moveList: string[] } => {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  return { fen: chess.fen(), moveList: chess.history() };
};

const parsePgnManually = (pgn: string): {
  fen: string;
  moveList: string[];
  failedToken: string | null;
} => {
  const tokens = tokenizePgnMoves(pgn);
  const chess = new Chess();
  const moveList: string[] = [];
  let failedToken: string | null = null;
  for (const raw of tokens) {
    if (RESULT_TOKENS.has(raw)) break;
    const token = normalizeSanToken(raw);
    if (!token) continue;
    if (RESULT_TOKENS.has(token)) break;
    try {
      const move = chess.move(token, { strict: false });
      if (!move) {
        failedToken = raw;
        break;
      }
      moveList.push(move.san ?? token);
    } catch {
      failedToken = raw;
      break;
    }
  }
  return { fen: chess.fen(), moveList, failedToken };
};

export const deriveFenFromPgn = (pgn: string): {
  fen: string | null;
  movesAppliedCount: number;
  moveList: string[] | null;
  failedToken: string | null;
  parseMode: PgnParseMode;
  error: PgnParseError | null;
} => {
  const trimmed = typeof pgn === "string" ? pgn.trim() : "";
  if (!trimmed) {
    return {
      fen: null,
      movesAppliedCount: 0,
      moveList: null,
      failedToken: null,
      parseMode: "sloppy",
      error: null,
    };
  }
  try {
    const parsed = parsePgnWithChessJs(trimmed);
    if (parsed.moveList.length === 0 && hasMoveTokens(trimmed)) {
      throw new Error("pgn-no-moves");
    }
    return {
      fen: parsed.fen,
      movesAppliedCount: parsed.moveList.length,
      moveList: parsed.moveList,
      failedToken: null,
      parseMode: "sloppy",
      error: null,
    };
  } catch (error) {
    const manual = parsePgnManually(trimmed);
    const movesAppliedCount = manual.moveList.length;
    const parseError =
      manual.failedToken != null
        ? {
            where: "pgn-parse" as const,
            message: `invalid token ${manual.failedToken}`,
          }
        : {
            where: "pgn-parse" as const,
            message: error instanceof Error ? error.message : "pgn-parse-failed",
          };
    const parseMode: PgnParseMode = manual.failedToken ? "partial" : "sloppy";
    return {
      fen: manual.fen,
      movesAppliedCount,
      moveList: manual.moveList,
      failedToken: manual.failedToken,
      parseMode,
      error: movesAppliedCount === 0 ? parseError : null,
    };
  }
};

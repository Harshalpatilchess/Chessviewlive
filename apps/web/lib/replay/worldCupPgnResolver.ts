import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { parseBoardIdentifier } from "@/lib/boardId";
import {
  deriveFenFromPgn,
  extractLatestClockPairFromPgn,
  type PgnParseMode,
} from "@/lib/chess/pgnServer";
import { WORLD_CUP_PGNS } from "@/lib/demoPgns";

export type WorldCupReplayPgnSource = "file" | "demo-map" | "missing";

export type WorldCupReplayResolution = {
  boardId: string;
  source: WorldCupReplayPgnSource;
  filePathTried: string;
  fallbackUsed: boolean;
  reason: string | null;
  moveList: string[] | null;
  movesAppliedCount: number;
  parseMode: PgnParseMode | null;
  failedToken: string | null;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
};

const WORLD_CUP_SLUG = "worldcup2025";

const normalizeBoardId = (boardId: string) => boardId.trim().toLowerCase();

const buildRelativePgnPath = (boardId: string) =>
  path.join("tournaments", WORLD_CUP_SLUG, "pgn", `${normalizeBoardId(boardId)}.pgn`);

const buildSearchRoots = () => {
  const cwd = process.cwd();
  const roots = [
    path.join(cwd, "public"),
    path.join(cwd, "apps", "web", "public"),
  ];
  return Array.from(new Set(roots));
};

const readPgnFileIfPresent = async (boardId: string): Promise<string | null> => {
  const relativePath = buildRelativePgnPath(boardId);
  const roots = buildSearchRoots();
  for (const root of roots) {
    const absolutePath = path.join(root, relativePath);
    try {
      const text = await fs.readFile(absolutePath, "utf8");
      const trimmed = text.trim();
      if (trimmed.length > 0) return trimmed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code !== "ENOENT") {
        console.warn("[replay/worldcup2025] PGN file read failed.", {
          boardId,
          absolutePath,
          code: code ?? "UNKNOWN",
        });
      }
    }
  }
  return null;
};

const parseMoveList = (
  pgn: string
): Pick<
  WorldCupReplayResolution,
  "moveList" | "movesAppliedCount" | "parseMode" | "failedToken" | "whiteTimeMs" | "blackTimeMs"
> => {
  const parsed = deriveFenFromPgn(pgn);
  const latestClockPair = extractLatestClockPairFromPgn(pgn, {
    fen: parsed.fen,
    moveCount: parsed.movesAppliedCount,
  });
  return {
    moveList: parsed.moveList ?? [],
    movesAppliedCount: parsed.movesAppliedCount,
    parseMode: parsed.parseMode,
    failedToken: parsed.failedToken,
    whiteTimeMs: latestClockPair.whiteTimeMs,
    blackTimeMs: latestClockPair.blackTimeMs,
  };
};

export const resolveWorldCupReplayMoves = async (boardIdRaw: string): Promise<WorldCupReplayResolution> => {
  const boardId = normalizeBoardId(boardIdRaw);
  const parsed = parseBoardIdentifier(boardId, WORLD_CUP_SLUG);
  const filePathTried = path
    .join("apps", "web", "public", buildRelativePgnPath(boardId))
    .replace(/\\/g, "/");

  if (parsed.tournamentSlug !== WORLD_CUP_SLUG) {
    return {
      boardId,
      source: "missing",
      filePathTried,
      fallbackUsed: false,
      reason: "unsupported_tournament",
      moveList: null,
      movesAppliedCount: 0,
      parseMode: null,
      failedToken: null,
      whiteTimeMs: null,
      blackTimeMs: null,
    };
  }

  if (!Number.isFinite(parsed.board) || parsed.board < 1) {
    return {
      boardId,
      source: "missing",
      filePathTried,
      fallbackUsed: false,
      reason: "invalid_board_id",
      moveList: null,
      movesAppliedCount: 0,
      parseMode: null,
      failedToken: null,
      whiteTimeMs: null,
      blackTimeMs: null,
    };
  }

  const filePgn = await readPgnFileIfPresent(boardId);
  if (filePgn) {
    const parsedPgn = parseMoveList(filePgn);
    return {
      boardId,
      source: "file",
      filePathTried,
      fallbackUsed: false,
      reason: null,
      ...parsedPgn,
    };
  }

  const fallbackPgn = WORLD_CUP_PGNS[parsed.board];
  if (typeof fallbackPgn === "string" && fallbackPgn.trim().length > 0) {
    console.info("[replay/worldcup2025] PGN file missing; using demo-map fallback.", {
      boardId,
      filePathTried,
    });
    const parsedPgn = parseMoveList(fallbackPgn);
    return {
      boardId,
      source: "demo-map",
      filePathTried,
      fallbackUsed: true,
      reason: "file_missing_demo_fallback",
      ...parsedPgn,
    };
  }

  return {
    boardId,
    source: "missing",
    filePathTried,
    fallbackUsed: false,
    reason: "pgn_missing",
    moveList: null,
    movesAppliedCount: 0,
    parseMode: null,
    failedToken: null,
    whiteTimeMs: null,
    blackTimeMs: null,
  };
};

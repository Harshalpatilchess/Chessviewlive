import { Chess } from "chess.js";
import type { GameSummary } from "@chessview/core";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { Calendar, Users, Clock, MapPin } from "lucide-react";
import { BoardsFilterRow } from "@/components/boards/BoardsFilterRow";
import { BoardsNavigation } from "@/components/boards/BoardsNavigation";
import DebugSimulateMoveButton from "@/components/boards/DebugSimulateMoveButton";
import RoundTextDropdown from "@/components/boards/RoundTextDropdown";
import type { BoardNavigationEntry, BoardNavigationPlayer } from "@/lib/boards/navigationTypes";
import { buildBoardIdentifier, normalizeTournamentSlug } from "@/lib/boardId";
import { BROADCASTS, getBroadcastTournament } from "@/lib/broadcasts/catalog";
import { deriveFenFromPgn } from "@/lib/chess/pgnServer";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import type { DgtBoardState } from "@/lib/live/dgtPayload";
import { normalizeBoardPlayers } from "@/lib/live/playerNormalization";
import { getMiniEvalCp } from "@/lib/miniEval";
import {
  fetchLichessBroadcastRound,
  fetchLichessBroadcastTournament,
  type LichessBroadcastBoard,
} from "@/lib/sources/lichessBroadcast";
import { probeLiveChessCloud } from "@/lib/sources/livechesscloud";
import { DEFAULT_ROUND, getTournamentConfig } from "@/lib/tournamentCatalog";
import { getTournamentImageBySlug, resolveTournamentThumbnail } from "@/lib/tournamentImages";
import {
  getTournamentRoundEntries,
  getTournamentRounds,
  type FideTitle,
  type TournamentGame,
  type TournamentRoundEntry,
} from "@/lib/tournamentManifest";
import BroadcastHubSidebar from "./BroadcastHubSidebar";

type TournamentOverviewPageProps = {
  params: Promise<{ tournamentSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PlayerSide = "white" | "black";

type LiveFallbackPlayerKeySample = {
  boardNo: number | null;
  whiteType: string;
  blackType: string;
  whiteKeys: string[];
  blackKeys: string[];
};

type LiveFallbackBoard = {
  boardNo: number;
  white: BoardNavigationPlayer;
  black: BoardNavigationPlayer;
  status?: DgtBoardState["status"];
  result?: DgtBoardState["result"] | null;
  moveList: string[];
  finalFen?: string | null;
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
  sideToMove?: "white" | "black" | null;
  clockUpdatedAtMs?: number | null;
};

type OfficialApiResponse = {
  ok?: boolean;
  error?: string;
  tournamentKey?: string;
  games?: GameSummary[];
  debug?: unknown;
};

const TATA_STEEL_2026_SLUG = "tata-steel-2026";
const TATA_STEEL_2026_CANONICAL_KEY = "tata-steel-masters-2026";
const DEFAULT_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type OfficialGamePgnSource = "pgn" | "round_pgn" | "roundPgn" | "none";

type OfficialMappingOptions = {
  debug?: boolean;
  tournamentSlug?: string;
  round?: number;
};

type OfficialGamePositionResolution = {
  moveList: string[];
  finalFen: string | null;
  sideToMove: "white" | "black" | null;
  parsedMoveCount: number;
  lastFen: string | null;
  pgnSource: OfficialGamePgnSource;
};

const PLACEHOLDER_PLAYER_NAMES = new Set(["?", "white player", "black player", "tbd", "unknown"]);
const PLACEHOLDER_PLAYER_METADATA = new Set([
  "-",
  "--",
  "?",
  "??",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const toCleanString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toCleanMetadataString = (value: unknown): string | null => {
  const cleaned = toCleanString(value);
  if (!cleaned) return null;
  return PLACEHOLDER_PLAYER_METADATA.has(cleaned.toLowerCase()) ? null : cleaned;
};

const toFiniteInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
};

const getIgnoreCase = (record: Record<string, unknown>, key: string): unknown => {
  if (key in record) return record[key];
  const lowerKey = key.toLowerCase();
  const matched = Object.keys(record).find(candidate => candidate.toLowerCase() === lowerKey);
  return matched ? record[matched] : undefined;
};

const getStringFromKeys = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = toCleanString(getIgnoreCase(record, key));
    if (value) return value;
  }
  return null;
};

const getIntFromKeys = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = toFiniteInt(getIgnoreCase(record, key));
    if (value != null) return value;
  }
  return null;
};

const describeValueType = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const formatDebugKeys = (keys: string[]): string => {
  if (keys.length === 0) return "[]";
  const maxKeys = 8;
  const displayed = keys.slice(0, maxKeys);
  const suffix = keys.length > maxKeys ? `,+${keys.length - maxKeys}` : "";
  return `[${displayed.join(",")}${suffix}]`;
};

const isPlaceholderPlayerName = (value: string) =>
  PLACEHOLDER_PLAYER_NAMES.has(value.trim().toLowerCase());

const resolvePlayerIdentity = (value?: string | null, side?: PlayerSide): BoardNavigationPlayer => {
  const candidate = typeof value === "string" ? value.trim() : "";
  const placeholder = candidate ? isPlaceholderPlayerName(candidate) : false;
  const missingData = !candidate || placeholder;
  const sideLabel = side ?? "player";
  const missingReason = missingData
    ? placeholder
      ? `placeholder ${sideLabel} name '${candidate}'`
      : `missing ${sideLabel} name field`
    : undefined;
  return {
    name: missingData ? "Unknown" : candidate,
    nameSource: missingData ? "unknown" : "direct",
    missingData,
    missingReason,
  };
};

const readNameFromValue = (value: unknown): string | null => {
  const direct = toCleanString(value);
  if (direct) return direct;
  if (!isRecord(value)) return null;
  const named = getStringFromKeys(value, [
    "name",
    "fullName",
    "username",
    "displayName",
    "player",
    "shortName",
    "tag",
  ]);
  if (named) return named;
  const first = getStringFromKeys(value, ["firstName", "givenName", "first"]);
  const last = getStringFromKeys(value, ["lastName", "familyName", "last"]);
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
};

const readTitleFromObject = (value: unknown): FideTitle | null => {
  if (!isRecord(value)) return null;
  const rawTitle = getStringFromKeys(value, ["title", "fideTitle"]);
  return normalizeFideTitle(rawTitle);
};

const readRatingFromObject = (value: unknown): number | null => {
  if (!isRecord(value)) return null;
  const rating = getIntFromKeys(value, ["rating", "elo", "fideRating"]);
  if (rating == null || rating <= 0) return null;
  return rating;
};

const readPlayerFieldFromObject = (value: unknown, keys: string[]): string | null => {
  if (!isRecord(value)) return null;
  return getStringFromKeys(value, keys);
};

const resolveLiveFallbackPlayer = (
  boardRecord: Record<string, unknown>,
  side: PlayerSide
): BoardNavigationPlayer => {
  const sideObject = getIgnoreCase(boardRecord, side);
  const sidePlayerObject = getIgnoreCase(boardRecord, `${side}Player`);
  const normalizedPlayers = normalizeBoardPlayers({
    white:
      getIgnoreCase(boardRecord, "white") ??
      getIgnoreCase(boardRecord, "whitePlayer") ??
      getIgnoreCase(boardRecord, "playerWhite"),
    black:
      getIgnoreCase(boardRecord, "black") ??
      getIgnoreCase(boardRecord, "blackPlayer") ??
      getIgnoreCase(boardRecord, "playerBlack"),
    whiteName: getIgnoreCase(boardRecord, "whiteName"),
    blackName: getIgnoreCase(boardRecord, "blackName"),
    whiteTitle: getIgnoreCase(boardRecord, "whiteTitle"),
    blackTitle: getIgnoreCase(boardRecord, "blackTitle"),
    whiteRating: getIgnoreCase(boardRecord, "whiteRating"),
    blackRating: getIgnoreCase(boardRecord, "blackRating"),
    whiteFederation:
      getIgnoreCase(boardRecord, "whiteFederation") ?? getIgnoreCase(boardRecord, "whiteFed"),
    blackFederation:
      getIgnoreCase(boardRecord, "blackFederation") ?? getIgnoreCase(boardRecord, "blackFed"),
    whiteCountry:
      getIgnoreCase(boardRecord, "whiteCountry") ?? getIgnoreCase(boardRecord, "whiteNation"),
    blackCountry:
      getIgnoreCase(boardRecord, "blackCountry") ?? getIgnoreCase(boardRecord, "blackNation"),
    whiteFlag: getIgnoreCase(boardRecord, "whiteFlag"),
    blackFlag: getIgnoreCase(boardRecord, "blackFlag"),
    pgn: toCleanString(getIgnoreCase(boardRecord, "pgn")),
    allowManifestFallback: false,
  });
  const canonicalPlayer = side === "white" ? normalizedPlayers.white : normalizedPlayers.black;
  const prefixedNameKeys =
    side === "white"
      ? [
          "whiteName",
          "whiteFullName",
          "whiteUsername",
          "whiteDisplayName",
          "whitePlayer",
          "playerWhite",
        ]
      : [
          "blackName",
          "blackFullName",
          "blackUsername",
          "blackDisplayName",
          "blackPlayer",
          "playerBlack",
        ];
  const metadataKeys =
    side === "white"
      ? [
          "whiteTitle",
          "whiteFideTitle",
          "whiteRating",
          "whiteElo",
          "whiteFideRating",
          "whiteFlag",
          "whiteCountry",
          "whiteFederation",
          "whiteFed",
          "whiteNation",
        ]
      : [
          "blackTitle",
          "blackFideTitle",
          "blackRating",
          "blackElo",
          "blackFideRating",
          "blackFlag",
          "blackCountry",
          "blackFederation",
          "blackFed",
          "blackNation",
        ];

  const nameCandidates = [canonicalPlayer.name];
  const firstNameCandidate = nameCandidates.find((candidate): candidate is string => Boolean(candidate)) ?? "";
  const placeholder = firstNameCandidate ? isPlaceholderPlayerName(firstNameCandidate) : false;
  const hasSideSignal =
    getIgnoreCase(boardRecord, side) !== undefined ||
    getIgnoreCase(boardRecord, `${side}Player`) !== undefined ||
    [...prefixedNameKeys, ...metadataKeys].some(key => getIgnoreCase(boardRecord, key) !== undefined);
  const missingData = canonicalPlayer.nameSource === "unknown" || !firstNameCandidate || placeholder;

  const player: BoardNavigationPlayer = {
    name: missingData ? "Unknown" : firstNameCandidate,
    nameSource: canonicalPlayer.nameSource ?? "unknown",
    missingData,
  };

  if (missingData) {
    player.missingReason =
      canonicalPlayer.missingReason ??
      (!hasSideSignal
        ? `missing ${side} object`
        : placeholder
          ? `placeholder ${side} name '${firstNameCandidate}'`
          : `missing ${side} name field`);
  }

  const title = normalizeFideTitle(canonicalPlayer.title ?? null) ??
    readTitleFromObject(sideObject) ??
    readTitleFromObject(sidePlayerObject) ??
    normalizeFideTitle(
      toCleanString(getIgnoreCase(boardRecord, side === "white" ? "whiteTitle" : "blackTitle"))
    ) ??
    normalizeFideTitle(
      toCleanString(getIgnoreCase(boardRecord, side === "white" ? "whiteFideTitle" : "blackFideTitle"))
    );
  if (title) player.title = title;

  const rating = (Number.isFinite(Number(canonicalPlayer.rating ?? NaN)) && Number(canonicalPlayer.rating) > 0
      ? Math.trunc(Number(canonicalPlayer.rating))
      : null) ??
    readRatingFromObject(sideObject) ??
    readRatingFromObject(sidePlayerObject) ??
    getIntFromKeys(boardRecord, side === "white" ? ["whiteRating", "whiteElo", "whiteFideRating"] : ["blackRating", "blackElo", "blackFideRating"]);
  if (rating != null && rating > 0) player.rating = rating;

  const flag = toCleanString(canonicalPlayer.flag ?? null) ??
    readPlayerFieldFromObject(sideObject, ["flag", "flagEmoji", "emoji", "countryFlag"]) ??
    readPlayerFieldFromObject(sidePlayerObject, ["flag", "flagEmoji", "emoji", "countryFlag"]) ??
    toCleanString(getIgnoreCase(boardRecord, side === "white" ? "whiteFlag" : "blackFlag"));
  if (flag) player.flag = flag;

  const country = toCleanString(canonicalPlayer.country ?? null) ??
    readPlayerFieldFromObject(sideObject, ["country", "countryCode", "nation", "nat"]) ??
    readPlayerFieldFromObject(sidePlayerObject, ["country", "countryCode", "nation", "nat"]) ??
    toCleanString(
      getIgnoreCase(boardRecord, side === "white" ? "whiteCountry" : "blackCountry")
    ) ??
    toCleanString(getIgnoreCase(boardRecord, side === "white" ? "whiteNation" : "blackNation"));
  if (country) player.country = country;

  const federation = toCleanString(canonicalPlayer.federation ?? null) ??
    readPlayerFieldFromObject(sideObject, ["federation", "fed", "fideFederation"]) ??
    readPlayerFieldFromObject(sidePlayerObject, ["federation", "fed", "fideFederation"]) ??
    toCleanString(
      getIgnoreCase(boardRecord, side === "white" ? "whiteFederation" : "blackFederation")
    ) ??
    toCleanString(getIgnoreCase(boardRecord, side === "white" ? "whiteFed" : "blackFed"));
  if (federation) player.federation = federation;

  return player;
};

const deriveLiveFallbackBoardStatus = (
  board: { status?: unknown; result?: unknown; whiteTimeMs?: unknown; blackTimeMs?: unknown },
  moveList: string[]
): NonNullable<DgtBoardState["status"]> => {
  const explicitStatus = typeof board.status === "string" ? board.status.trim().toLowerCase() : "";
  if (
    explicitStatus === "live" ||
    explicitStatus === "scheduled" ||
    explicitStatus === "finished" ||
    explicitStatus === "final"
  ) {
    return explicitStatus;
  }

  const normalizedResult = normalizeResultValue(toCleanString(board.result));
  if (normalizedResult && normalizedResult !== "*") return "finished";
  if (normalizedResult === "*") return "live";

  const hasClocks =
    Number.isFinite(Number(board.whiteTimeMs ?? NaN)) ||
    Number.isFinite(Number(board.blackTimeMs ?? NaN));
  if (moveList.length > 0 || hasClocks) return "live";

  return "scheduled";
};

const normalizeFallbackResult = (value: unknown): DgtBoardState["result"] | null => {
  const normalized = normalizeResultValue(toCleanString(value));
  if (!normalized) return null;
  if (normalized === "1-0" || normalized === "0-1" || normalized === "1/2-1/2" || normalized === "*") {
    return normalized;
  }
  return null;
};

const getLiveFallbackPlayerKeySample = (boards: unknown[]): LiveFallbackPlayerKeySample | null => {
  const sample = boards.find(isRecord);
  if (!sample) return null;
  const white =
    getIgnoreCase(sample, "white") ??
    getIgnoreCase(sample, "whitePlayer") ??
    getIgnoreCase(sample, "playerWhite") ??
    getIgnoreCase(sample, "whiteName");
  const black =
    getIgnoreCase(sample, "black") ??
    getIgnoreCase(sample, "blackPlayer") ??
    getIgnoreCase(sample, "playerBlack") ??
    getIgnoreCase(sample, "blackName");
  return {
    boardNo: getIntFromKeys(sample, ["board", "boardNo", "boardNumber", "table"]),
    whiteType: describeValueType(white),
    blackType: describeValueType(black),
    whiteKeys: isRecord(white) ? Object.keys(white).sort() : [],
    blackKeys: isRecord(black) ? Object.keys(black).sort() : [],
  };
};

const mapLiveFallbackBoards = (boards: unknown[]): LiveFallbackBoard[] => {
  const mapped: LiveFallbackBoard[] = [];
  boards.forEach(rawBoard => {
    if (!isRecord(rawBoard)) return;
    const boardNo = getIntFromKeys(rawBoard, ["board", "boardNo", "boardNumber", "table"]);
    if (boardNo == null || boardNo < 1) return;
    const moveListSource = Array.isArray(getIgnoreCase(rawBoard, "moveList"))
      ? (getIgnoreCase(rawBoard, "moveList") as unknown[])
      : Array.isArray(getIgnoreCase(rawBoard, "moves"))
        ? (getIgnoreCase(rawBoard, "moves") as unknown[])
        : [];
    const moveList = Array.isArray(moveListSource)
      ? moveListSource.filter((move): move is string => typeof move === "string" && move.trim().length > 0)
      : [];
    const whitePlayer = resolveLiveFallbackPlayer(rawBoard, "white");
    const blackPlayer = resolveLiveFallbackPlayer(rawBoard, "black");
    const sideToMoveRaw = toCleanString(getIgnoreCase(rawBoard, "sideToMove"))?.toLowerCase();
    const sideToMove = sideToMoveRaw === "white" || sideToMoveRaw === "black" ? sideToMoveRaw : null;
    mapped.push({
      boardNo: Math.floor(boardNo),
      white: whitePlayer,
      black: blackPlayer,
      status: deriveLiveFallbackBoardStatus(
        {
          status: getIgnoreCase(rawBoard, "status"),
          result: getIgnoreCase(rawBoard, "result"),
          whiteTimeMs: getIgnoreCase(rawBoard, "whiteTimeMs"),
          blackTimeMs: getIgnoreCase(rawBoard, "blackTimeMs"),
        },
        moveList
      ),
      result: normalizeFallbackResult(getIgnoreCase(rawBoard, "result")),
      moveList,
      whiteTimeMs: toFiniteInt(getIgnoreCase(rawBoard, "whiteTimeMs")),
      blackTimeMs: toFiniteInt(getIgnoreCase(rawBoard, "blackTimeMs")),
      sideToMove,
      clockUpdatedAtMs: toFiniteInt(getIgnoreCase(rawBoard, "clockUpdatedAtMs")),
    });
  });
  return mapped;
};

const isLichessBroadcastBoard = (board: unknown): board is LichessBroadcastBoard =>
  board != null &&
  typeof board === "object" &&
  "whiteElo" in board &&
  "blackElo" in board &&
  "whiteTitle" in board &&
  "blackTitle" in board &&
  "whiteCountry" in board &&
  "blackCountry" in board;

const isLiveFallbackBoard = (board: unknown): board is LiveFallbackBoard =>
  board != null &&
  typeof board === "object" &&
  "boardNo" in board &&
  "white" in board &&
  "black" in board;

const resolveParam = (value?: string | string[]) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const normalizeMode = (value?: string) => (value?.toLowerCase() === "replay" ? "replay" : "live");

const normalizeStatus = (value?: string): "live" | "all" | "finished" => {
  const candidate = value?.toLowerCase().trim() ?? "";
  if (candidate === "playing" || candidate === "live") return "live";
  if (candidate === "finished" || candidate === "results") return "finished";
  if (candidate === "all") return "all";
  return "all";
};

const parseRoundParam = (value?: string) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
};

const parsePerParam = (value?: string): 20 | 32 | 48 => {
  const parsed = Number(value);
  if (parsed === 20 || parsed === 32 || parsed === 48) return parsed;
  return 20;
};

const parsePageParam = (value?: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
};

const normalizeFideTitle = (value?: string | null): FideTitle | null => {
  if (!value) return null;
  const candidate = value.trim().toUpperCase();
  if (
    candidate === "GM" ||
    candidate === "IM" ||
    candidate === "FM" ||
    candidate === "CM" ||
    candidate === "WGM" ||
    candidate === "WIM" ||
    candidate === "WFM" ||
    candidate === "WCM"
  ) {
    return candidate as FideTitle;
  }
  return null;
};

const resolveOfficialTournamentKey = (value?: string | null): string | null => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (normalized === TATA_STEEL_2026_SLUG || normalized === TATA_STEEL_2026_CANONICAL_KEY) {
    return TATA_STEEL_2026_CANONICAL_KEY;
  }
  return null;
};

const parseClockLabelToMs = (value?: string | null): number | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map(part => part.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some(part => part.length === 0)) return null;
  const numeric = parts.map(part => Number(part));
  if (numeric.some(part => !Number.isFinite(part) || part < 0)) return null;

  let totalSeconds = 0;
  if (parts.length === 3) {
    const [hours, minutes, seconds] = numeric;
    if (minutes >= 60 || seconds >= 60) return null;
    totalSeconds = hours * 3600 + minutes * 60 + seconds;
  } else {
    const [first, second] = numeric;
    if (second >= 60) return null;
    if (first <= 3) {
      totalSeconds = first * 3600 + second * 60;
    } else {
      totalSeconds = first * 60 + second;
    }
  }

  const totalMs = Math.max(0, Math.floor(totalSeconds * 1000));
  return totalMs;
};

const parseIsoTimestampToMs = (value?: string | null): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
};

const getSideToMoveFromFen = (fen?: string | null): "white" | "black" | null => {
  if (typeof fen !== "string") return null;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return null;
  if (parts[1] === "w") return "white";
  if (parts[1] === "b") return "black";
  return null;
};

const normalizeOfficialResultToken = (value?: string): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "1" || trimmed === "0" || trimmed === "1/2" || trimmed === "0.5" || trimmed === "½") {
    return trimmed;
  }
  return null;
};

const mapOfficialResultsToResult = (
  whiteResult?: string,
  blackResult?: string,
  isLive?: boolean
): DgtBoardState["result"] | null => {
  const white = normalizeOfficialResultToken(whiteResult);
  const black = normalizeOfficialResultToken(blackResult);
  if (white === "1" && black === "0") return "1-0";
  if (white === "0" && black === "1") return "0-1";
  if ((white === "½" || white === "1/2" || white === "0.5") && (black === "½" || black === "1/2" || black === "0.5")) {
    return "1/2-1/2";
  }
  if (isLive) return "*";
  return null;
};

const mapOfficialResultToStatus = (
  result: DgtBoardState["result"] | null,
  isLive: boolean,
  moveList: string[]
): DgtBoardState["status"] => {
  if (result && result !== "*") return "finished";
  if (result === "*" || isLive || moveList.length > 0) return "live";
  return "scheduled";
};

const isStartFen = (fen?: string | null): boolean => {
  if (typeof fen !== "string") return false;
  return fen.trim() === DEFAULT_START_FEN;
};

const extractPgnFromOfficialGame = (game: GameSummary): { pgn: string | null; source: OfficialGamePgnSource } => {
  const direct = toCleanString(game.pgn);
  if (direct) return { pgn: direct, source: "pgn" };
  const record = game as unknown as Record<string, unknown>;
  const roundPgnUnderscore = toCleanString(getIgnoreCase(record, "round_pgn"));
  if (roundPgnUnderscore) return { pgn: roundPgnUnderscore, source: "round_pgn" };
  const roundPgnCamel = toCleanString(getIgnoreCase(record, "roundPgn"));
  if (roundPgnCamel) return { pgn: roundPgnCamel, source: "roundPgn" };
  return { pgn: null, source: "none" };
};

const resolveOfficialGamePosition = (game: GameSummary): OfficialGamePositionResolution => {
  const { pgn, source } = extractPgnFromOfficialGame(game);
  const parsed = pgn ? deriveFenFromPgn(pgn) : null;
  const moveList = (parsed?.moveList ?? []).filter(move => typeof move === "string" && move.trim().length > 0);
  const parsedFen = toCleanString(parsed?.fen);
  const payloadFen = toCleanString(game.fen);
  const finalFen =
    (parsedFen && !isStartFen(parsedFen) ? parsedFen : null) ??
    (payloadFen && !isStartFen(payloadFen) ? payloadFen : null);
  return {
    moveList,
    finalFen,
    sideToMove: getSideToMoveFromFen(finalFen),
    parsedMoveCount: moveList.length,
    lastFen: parsedFen ?? finalFen ?? null,
    pgnSource: source,
  };
};

type OfficialPlayerMeta = {
  flag?: string;
  country?: string;
  federation?: string;
};

const normalizePlayerNameKey = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ");
};

const normalizeFederationCode = (value?: string | null): string | null => {
  const trimmed = toCleanMetadataString(value);
  return trimmed ? trimmed.toUpperCase() : null;
};

const normalizeFlagValue = (value?: string | null): string | null => {
  const trimmed = toCleanMetadataString(value);
  if (!trimmed) return null;
  return /^[A-Za-z]{2,3}$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
};

const toBoardSideKey = (boardNo: number, side: PlayerSide): string => `${boardNo}:${side}`;

const buildOfficialManifestMetaLookups = (
  tournamentSlug?: string,
  round?: number
): {
  byName: Map<string, OfficialPlayerMeta>;
  byBoardSide: Map<string, OfficialPlayerMeta>;
} => {
  const byName = new Map<string, OfficialPlayerMeta>();
  const byBoardSide = new Map<string, OfficialPlayerMeta>();
  if (!tournamentSlug || !Number.isFinite(Number(round ?? NaN)) || Number(round) < 1) {
    return { byName, byBoardSide };
  }

  const entries = getTournamentRoundEntries(tournamentSlug, Math.floor(Number(round)));
  entries.forEach(({ board, game }) => {
    const whiteCountry = normalizeFederationCode(game.whiteCountry);
    const blackCountry = normalizeFederationCode(game.blackCountry);
    const whiteFlag = normalizeFlagValue(game.whiteFlag);
    const blackFlag = normalizeFlagValue(game.blackFlag);
    const whiteMeta: OfficialPlayerMeta = {
      ...(whiteFlag ? { flag: whiteFlag } : {}),
      ...(whiteCountry ? { country: whiteCountry, federation: whiteCountry } : {}),
    };
    const blackMeta: OfficialPlayerMeta = {
      ...(blackFlag ? { flag: blackFlag } : {}),
      ...(blackCountry ? { country: blackCountry, federation: blackCountry } : {}),
    };

    const whiteNameKey = normalizePlayerNameKey(game.white);
    const blackNameKey = normalizePlayerNameKey(game.black);
    if (whiteNameKey && !byName.has(whiteNameKey)) {
      byName.set(whiteNameKey, whiteMeta);
    }
    if (blackNameKey && !byName.has(blackNameKey)) {
      byName.set(blackNameKey, blackMeta);
    }

    byBoardSide.set(toBoardSideKey(board, "white"), whiteMeta);
    byBoardSide.set(toBoardSideKey(board, "black"), blackMeta);
  });

  return { byName, byBoardSide };
};

const resolveOfficialPlayerMeta = (options: {
  officialFlag?: string | null;
  officialCountry?: string | null;
  officialFederation?: string | null;
  manifestByName?: OfficialPlayerMeta;
  manifestByBoardSide?: OfficialPlayerMeta;
}): OfficialPlayerMeta => {
  const officialFlag = normalizeFlagValue(options.officialFlag);
  const officialCountry = normalizeFederationCode(options.officialCountry);
  const officialFederation = normalizeFederationCode(options.officialFederation);

  const flag =
    officialFlag ??
    officialCountry ??
    officialFederation ??
    options.manifestByName?.flag ??
    options.manifestByName?.country ??
    options.manifestByName?.federation ??
    options.manifestByBoardSide?.flag ??
    options.manifestByBoardSide?.country ??
    options.manifestByBoardSide?.federation ??
    null;
  const country =
    officialCountry ??
    officialFederation ??
    options.manifestByName?.country ??
    options.manifestByName?.federation ??
    options.manifestByBoardSide?.country ??
    options.manifestByBoardSide?.federation ??
    null;
  const federation =
    officialFederation ??
    officialCountry ??
    options.manifestByName?.federation ??
    options.manifestByName?.country ??
    options.manifestByBoardSide?.federation ??
    options.manifestByBoardSide?.country ??
    null;

  return {
    ...(flag ? { flag } : {}),
    ...(country ? { country } : {}),
    ...(federation ? { federation } : {}),
  };
};

const mapOfficialGamesToLiveFallbackBoards = (
  games: GameSummary[],
  options: OfficialMappingOptions = {}
): LiveFallbackBoard[] => {
  const usedPgnSources = new Set<OfficialGamePgnSource>();
  let mixedSourceSample: { boardNo: number; parsedMoveCount: number; lastFen: string | null } | null = null;
  const manifestMetaLookups = buildOfficialManifestMetaLookups(options.tournamentSlug, options.round);

  const boards = (games
    .map((game, index) => {
      const boardNo = index + 1;
      const whiteName = toCleanString(game.whiteName);
      const blackName = toCleanString(game.blackName);
      if (!whiteName || !blackName) return null;

      const gameRecord = game as unknown as Record<string, unknown>;
      const whiteTitle = toCleanString(game.whiteTitle);
      const blackTitle = toCleanString(game.blackTitle);
      const whiteOfficialFlag = normalizeFlagValue(
        toCleanString(getIgnoreCase(gameRecord, "whiteFlag")) ??
          toCleanString(getIgnoreCase(gameRecord, "whiteFlagEmoji"))
      );
      const blackOfficialFlag = normalizeFlagValue(
        toCleanString(getIgnoreCase(gameRecord, "blackFlag")) ??
          toCleanString(getIgnoreCase(gameRecord, "blackFlagEmoji"))
      );
      const whiteOfficialCountry = normalizeFederationCode(
        toCleanString(getIgnoreCase(gameRecord, "whiteCountry")) ??
          toCleanString(getIgnoreCase(gameRecord, "whiteNation"))
      );
      const blackOfficialCountry = normalizeFederationCode(
        toCleanString(getIgnoreCase(gameRecord, "blackCountry")) ??
          toCleanString(getIgnoreCase(gameRecord, "blackNation"))
      );
      const whiteOfficialFederation = normalizeFederationCode(
        toCleanString(game.whiteFederation) ??
          toCleanString(getIgnoreCase(gameRecord, "whiteFederation")) ??
          toCleanString(getIgnoreCase(gameRecord, "whiteFed"))
      );
      const blackOfficialFederation = normalizeFederationCode(
        toCleanString(game.blackFederation) ??
          toCleanString(getIgnoreCase(gameRecord, "blackFederation")) ??
          toCleanString(getIgnoreCase(gameRecord, "blackFed"))
      );

      const whiteManifestByName = manifestMetaLookups.byName.get(normalizePlayerNameKey(whiteName));
      const blackManifestByName = manifestMetaLookups.byName.get(normalizePlayerNameKey(blackName));
      const whiteManifestByBoardSide = manifestMetaLookups.byBoardSide.get(toBoardSideKey(boardNo, "white"));
      const blackManifestByBoardSide = manifestMetaLookups.byBoardSide.get(toBoardSideKey(boardNo, "black"));
      const whiteMeta = resolveOfficialPlayerMeta({
        officialFlag: whiteOfficialFlag,
        officialCountry: whiteOfficialCountry,
        officialFederation: whiteOfficialFederation,
        manifestByName: whiteManifestByName,
        manifestByBoardSide: whiteManifestByBoardSide,
      });
      const blackMeta = resolveOfficialPlayerMeta({
        officialFlag: blackOfficialFlag,
        officialCountry: blackOfficialCountry,
        officialFederation: blackOfficialFederation,
        manifestByName: blackManifestByName,
        manifestByBoardSide: blackManifestByBoardSide,
      });

      const position = resolveOfficialGamePosition(game);
      if (position.pgnSource !== "none") {
        usedPgnSources.add(position.pgnSource);
      }
      if (!mixedSourceSample && (position.parsedMoveCount > 0 || position.lastFen)) {
        mixedSourceSample = {
          boardNo,
          parsedMoveCount: position.parsedMoveCount,
          lastFen: position.lastFen,
        };
      }
      const result = mapOfficialResultsToResult(game.whiteResult, game.blackResult, Boolean(game.isLive));
      const status = mapOfficialResultToStatus(result, Boolean(game.isLive), position.moveList);
      const whiteTimeMs = parseClockLabelToMs(game.whiteClock);
      const blackTimeMs = parseClockLabelToMs(game.blackClock);
      const hasClock = whiteTimeMs != null || blackTimeMs != null;
      const clockUpdatedAtMs = hasClock ? parseIsoTimestampToMs(game.lastUpdatedAt) : null;

      const whitePlayer: BoardNavigationPlayer = {
        name: whiteName,
        nameSource: "direct",
        missingData: false,
        ...(normalizeFideTitle(whiteTitle) ? { title: normalizeFideTitle(whiteTitle) } : {}),
        ...(Number.isFinite(Number(game.whiteRating ?? NaN)) && Number(game.whiteRating) > 0
          ? { rating: Math.trunc(Number(game.whiteRating)) }
          : {}),
        ...(whiteMeta.flag ? { flag: whiteMeta.flag } : {}),
        ...(whiteMeta.country ? { country: whiteMeta.country } : {}),
        ...(whiteMeta.federation ? { federation: whiteMeta.federation } : {}),
      };
      const blackPlayer: BoardNavigationPlayer = {
        name: blackName,
        nameSource: "direct",
        missingData: false,
        ...(normalizeFideTitle(blackTitle) ? { title: normalizeFideTitle(blackTitle) } : {}),
        ...(Number.isFinite(Number(game.blackRating ?? NaN)) && Number(game.blackRating) > 0
          ? { rating: Math.trunc(Number(game.blackRating)) }
          : {}),
        ...(blackMeta.flag ? { flag: blackMeta.flag } : {}),
        ...(blackMeta.country ? { country: blackMeta.country } : {}),
        ...(blackMeta.federation ? { federation: blackMeta.federation } : {}),
      };

      return {
        boardNo,
        white: whitePlayer,
        black: blackPlayer,
        status,
        result,
        moveList: position.moveList,
        finalFen: position.finalFen,
        whiteTimeMs,
        blackTimeMs,
        sideToMove: position.sideToMove,
        clockUpdatedAtMs,
      } satisfies LiveFallbackBoard;
    }) as Array<LiveFallbackBoard | null>)
    .filter((board): board is LiveFallbackBoard => board != null);

  const mixedSources = Array.from(usedPgnSources);
  if (options.debug && mixedSources.length > 1 && mixedSourceSample) {
    const sample = mixedSourceSample as { boardNo: number; parsedMoveCount: number; lastFen: string | null };
    console.log("[official-map] mixed-pgn-sources", {
      tournamentSlug: options.tournamentSlug ?? null,
      round: options.round ?? null,
      sources: mixedSources.sort(),
      sample: {
        boardNo: sample.boardNo,
        parsedMoveCount: sample.parsedMoveCount,
        lastFen: sample.lastFen,
      },
    });
  }

  return boards;
};

const buildPreviewFen = (game: TournamentGame | null, tournamentSlug: string, boardNumber: number): string | null => {
  if (!game) return null;
  if (typeof game.finalFen === "string" && game.finalFen.trim()) return game.finalFen;
  if (Array.isArray(game.moveList) && game.moveList.length > 0) {
    const chess = new Chess();
    let applied = 0;
    for (const move of game.moveList) {
      try {
        const result = chess.move(move, { strict: false });
        if (!result) break;
        applied += 1;
      } catch {
        break;
      }
    }
    if (applied > 0) return chess.fen();
  }
  if (tournamentSlug === "worldcup2025") {
    const pgn = getWorldCupPgnForBoard(boardNumber);
    const parsed = deriveFenFromPgn(pgn);
    if (parsed.fen && parsed.movesAppliedCount > 0) {
      return parsed.fen;
    }
  }
  const normalizedResult = normalizeResultValue(game.result);
  const hasStartedSignal =
    game.status === "live" ||
    game.status === "final" ||
    normalizedResult === "*" ||
    Boolean(normalizedResult && normalizedResult !== "*") ||
    Number.isFinite(Number(game.whiteTimeMs ?? NaN)) ||
    Number.isFinite(Number(game.blackTimeMs ?? NaN)) ||
    Boolean(game.sideToMove) ||
    Number.isFinite(Number(game.evaluation ?? NaN));
  const explicitNoMoves = Array.isArray(game.moveList) && game.moveList.length === 0 && !hasStartedSignal;
  if (game.status === "scheduled" || explicitNoMoves) {
    return DEFAULT_START_FEN;
  }
  return null;
};

const normalizeResultValue = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "*" || trimmed === "\u00b7") return "*";
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.includes("\u00bd")) return "1/2-1/2";
  if (compact === "1/2-1/2") return "1/2-1/2";
  return compact;
};

const isGameLive = (game: TournamentGame | null) => {
  if (!game) return false;
  const normalizedResult = normalizeResultValue(game.result);
  if (normalizedResult === "*") return true;
  return game.status === "live";
};

const isGameFinished = (game: TournamentGame | null) => {
  if (!game) return false;
  const normalizedResult = normalizeResultValue(game.result);
  if (normalizedResult && normalizedResult !== "*") return true;
  return game.status === "final";
};

const selectAutoRoundFromManifest = (tournamentSlug: string, rounds: number[]) => {
  if (!rounds.length) return null;
  let latestLive: number | null = null;
  let latestFinished: number | null = null;
  rounds.forEach(round => {
    const entries = getTournamentRoundEntries(tournamentSlug, round);
    if (entries.length === 0) return;
    const hasLive = entries.some(entry => isGameLive(entry.game));
    const allFinished = entries.every(entry => isGameFinished(entry.game));
    if (hasLive) latestLive = round;
    if (allFinished) latestFinished = round;
  });
  return latestLive ?? latestFinished;
};

const isBoardFinished = (entry: BoardNavigationEntry) => {
  const normalized = normalizeResultValue(entry.result);
  return Boolean(normalized && normalized !== "*");
};
const resolveFilterStatus = (entry: BoardNavigationEntry) => {
  const normalizedResult = normalizeResultValue(entry.result);
  if (normalizedResult === "*") return "playing";
  if (normalizedResult) return "finished";
  if (entry.status === "final") return "finished";
  if (entry.status === "scheduled") return "scheduled";
  if (entry.status === "live") return "playing";
  return "playing";
};

const formatTournamentName = (slug: string) =>
  slug
    .split("-")
    .map(word => (word ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}` : ""))
    .join(" ");

const normalizeTournamentTitle = (value: string) =>
  value
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeBroadcastStatus = (
  value?: string | null,
  result?: TournamentGame["result"]
): TournamentGame["status"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  const normalizedResult = normalizeResultValue(result);
  if (normalizedResult && normalizedResult !== "*") return "final";
  if (normalizedResult === "*") return "live";
  if (normalized === "scheduled" || normalized === "upcoming" || normalized === "pending") return "scheduled";
  if (normalized === "finished" || normalized === "final" || normalized === "completed") return "final";
  if (normalized) return "live";
  return "live";
};

const normalizeBroadcastResult = (value?: string | null): TournamentGame["result"] => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized === "*" || normalized === "\u00b7") return "*";
  if (normalized === "1-0" || normalized === "0-1" || normalized === "1/2-1/2" || normalized === "½-½") {
    return normalized;
  }
  if (normalized.toLowerCase() === "draw") return "1/2-1/2";
  return null;
};

const formatRelativeTime = (diffMs: number) => {
  const totalMinutes = Math.max(1, Math.ceil(diffMs / 60000));
  if (totalMinutes < 60) {
    return `in ${totalMinutes} min`;
  }
  const totalHours = Math.max(1, Math.ceil(totalMinutes / 60));
  if (totalHours < 24) {
    return `in ${totalHours} hour${totalHours === 1 ? "" : "s"}`;
  }
  const totalDays = Math.max(1, Math.ceil(totalHours / 24));
  return `in ${totalDays} day${totalDays === 1 ? "" : "s"}`;
};

export default async function TournamentOverviewPage({
  params,
  searchParams,
}: TournamentOverviewPageProps) {
  const resolvedSearchParams = await searchParams;
  const resolvedParams = await params;
  const rawSlug = resolvedParams?.tournamentSlug ?? "";
  const trimmedSlug = rawSlug.trim();
  const normalizedSlug = normalizeTournamentSlug(trimmedSlug);
  const requestedOfficialCanonicalKey =
    resolveOfficialTournamentKey(trimmedSlug) ?? resolveOfficialTournamentKey(normalizedSlug);
  const useOfficialApi = requestedOfficialCanonicalKey === TATA_STEEL_2026_CANONICAL_KEY;
  const roundParam = resolveParam(resolvedSearchParams.round);
  const roundIdParam = resolveParam(resolvedSearchParams.roundId);
  const modeParam = resolveParam(resolvedSearchParams.mode);
  const rawStatusParam = resolvedSearchParams.status;
  const statusParam = resolveParam(resolvedSearchParams.status);
  const searchParam = resolveParam(resolvedSearchParams.search);
  const perParam = resolveParam(resolvedSearchParams.per);
  const pageParam = resolveParam(resolvedSearchParams.page);
  const debugParam = resolveParam(resolvedSearchParams.debug);
  const selectedParam = resolveParam(resolvedSearchParams.selected);
  const broadcastEntry = getBroadcastTournament(normalizedSlug);
  const isBroadcast = Boolean(broadcastEntry);
  const activeMode = normalizeMode(modeParam);
  const rawStatusLabel = Array.isArray(rawStatusParam)
    ? rawStatusParam.join(",")
    : rawStatusParam ?? "none";
  const activePer = parsePerParam(perParam);
  const requestedPage = parsePageParam(pageParam);
  const isDebug = debugParam === "1";
  const selectedBoardId = typeof selectedParam === "string" ? selectedParam : undefined;
  const hasRoundParam = typeof roundParam === "string" && roundParam.trim().length > 0;
  const requestedRound = parseRoundParam(roundParam);
  const selectedRound = requestedRound ?? 1;

  const tournamentConfig = getTournamentConfig(normalizedSlug);
  const knownBroadcastSlugs = BROADCASTS.map(entry => entry.slug).filter(Boolean);
  const isKnownTournament = Boolean(tournamentConfig || broadcastEntry || useOfficialApi);

  if (!isKnownTournament) {
    return (
      <main className="min-h-screen bg-[#020817] text-slate-100">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.65),_transparent_60%)]" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-4xl items-center px-6 py-16">
          <section className="w-full rounded-[28px] border border-white/10 bg-white/[0.06] p-10 shadow-[0_28px_80px_rgba(2,6,23,0.6)] backdrop-blur-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">
              Tournament hub
            </p>
            <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
              Tournament not found
            </h1>
            <p className="mt-3 max-w-xl text-sm text-slate-300">
              The tournament slug doesn’t match a local demo or a curated broadcast. Browse the
              broadcast catalog to open a live event.
            </p>
            <div className="mt-8">
              <Link
                href="/broadcasts"
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-black/40 transition hover:border-sky-300/60 hover:bg-sky-300/10"
              >
                View broadcasts
              </Link>
            </div>
            {isDebug ? (
              <p className="mt-6 text-xs font-semibold text-slate-400">
                Known broadcast slugs: {knownBroadcastSlugs.join(", ") || "none"}
              </p>
            ) : null}
          </section>
        </div>
      </main>
    );
  }
  const tournamentName = tournamentConfig?.name ?? broadcastEntry?.title ?? formatTournamentName(normalizedSlug);
  const displayTournamentName = normalizeTournamentTitle(tournamentName);
  const isLccBroadcast = broadcastEntry?.sourceType === "livechesscloud";
  const isLichessBroadcast = broadcastEntry?.sourceType === "lichessBroadcast";
  const broadcastRoundIdOverride = typeof roundIdParam === "string" && roundIdParam.trim() ? roundIdParam.trim() : null;
  const broadcastTournamentMeta = isLichessBroadcast && broadcastEntry?.lichessBroadcastId
    ? await fetchLichessBroadcastTournament({
        tournamentId: broadcastEntry.lichessBroadcastId,
        roundIdOverride: broadcastRoundIdOverride,
        debug: isDebug,
      }).catch(() => null)
    : null;
  const broadcastRoundsMeta = broadcastTournamentMeta?.snapshot.rounds ?? [];
  const lichessRoundsUnavailable =
    isLichessBroadcast &&
    Boolean(broadcastEntry?.lichessBroadcastId) &&
    broadcastRoundsMeta.length === 0;
  const roundIndexFromId = broadcastRoundIdOverride
    ? broadcastRoundsMeta.findIndex(round => round.id === broadcastRoundIdOverride)
    : -1;
  const broadcastDefaultRound = isLichessBroadcast
    ? roundIndexFromId >= 0
      ? roundIndexFromId + 1
      : broadcastTournamentMeta?.snapshot.activeRoundIndex ?? broadcastEntry?.defaultRound ?? DEFAULT_ROUND
    : broadcastEntry?.defaultRound ?? DEFAULT_ROUND;
  const defaultRound = broadcastDefaultRound ?? tournamentConfig?.round ?? DEFAULT_ROUND;
  const availableRounds = isBroadcast
    ? broadcastRoundsMeta.length > 0
      ? broadcastRoundsMeta.map((_, index) => index + 1)
      : [broadcastDefaultRound]
    : getTournamentRounds(normalizedSlug);
  const hasExplicitRoundList = isLichessBroadcast && broadcastRoundsMeta.length > 0;
  const baseRoundOptions = availableRounds.length > 0 ? availableRounds : [defaultRound];
  const fallbackRoundOptions = Array.from({ length: 9 }, (_, index) => index + 1);
  const useFallbackRounds =
    !isLichessBroadcast && !hasExplicitRoundList && baseRoundOptions.length <= 1;
  const roundSelectionOptions = useFallbackRounds ? fallbackRoundOptions : baseRoundOptions;
  const fallbackRound = roundSelectionOptions.includes(defaultRound)
    ? defaultRound
    : roundSelectionOptions[0] ?? defaultRound;
  const autoRound =
    !isBroadcast && !hasRoundParam && !broadcastRoundIdOverride
      ? selectAutoRoundFromManifest(normalizedSlug, baseRoundOptions)
      : null;
  const selectedRoundIsAllowed =
    roundSelectionOptions.length === 0 || roundSelectionOptions.includes(selectedRound);
  const autoRoundIsAllowed =
    autoRound != null && (roundSelectionOptions.length === 0 || roundSelectionOptions.includes(autoRound));
  const activeRound =
    hasRoundParam || isBroadcast
      ? selectedRoundIsAllowed
        ? selectedRound
        : fallbackRound
      : autoRoundIsAllowed
        ? autoRound
        : fallbackRound;
  const tournamentImages = getTournamentImageBySlug(normalizedSlug, tournamentName);
  const { candidates: thumbnailCandidates } = resolveTournamentThumbnail(tournamentImages);
  const heroCandidate = thumbnailCandidates[0] ?? null;
  const startsAt = tournamentConfig?.startsAt ? new Date(tournamentConfig.startsAt) : null;
  const endsAt = tournamentConfig?.endsAt ? new Date(tournamentConfig.endsAt) : null;
  const dateRangeLabel = (() => {
    if (!startsAt || !Number.isFinite(startsAt.getTime())) return "—";
    const formatDay = new Intl.DateTimeFormat("en-US", { day: "numeric" });
    const formatMonth = new Intl.DateTimeFormat("en-US", { month: "short" });
    const startLabel = `${formatDay.format(startsAt)} ${formatMonth.format(startsAt)}`;
    if (!endsAt || !Number.isFinite(endsAt.getTime())) return startLabel;
    const endDay = formatDay.format(endsAt);
    const endMonth = formatMonth.format(endsAt);
    const endLabel = `${endDay} ${endMonth}`;
    return `${startLabel} to ${endLabel}`;
  })();
  const participantsLabel = Number.isFinite(tournamentConfig?.participants ?? NaN)
    ? `${tournamentConfig?.participants} players`
    : "—";
  const timeControlLabel = (() => {
    const raw = tournamentConfig?.timeControl?.trim();
    if (!raw) return "—";
    const match = raw.match(/^(\d+)\s*\+\s*(\d+)$/);
    if (!match) return raw;
    const base = Number(match[1]);
    const increment = Number(match[2]);
    if (!Number.isFinite(base) || !Number.isFinite(increment)) return raw;
    const baseMinutes = base >= 300 ? Math.round(base / 60) : base;
    const minutesLabel = `${baseMinutes} min`;
    const secondsLabel = `${increment} sec`;
    return `${minutesLabel} + ${secondsLabel}`;
  })();
  const locationLabel = tournamentConfig?.location?.trim() || "—";
  const tournamentInfoStrip = (
    <div className="mt-3 grid grid-cols-2 gap-2.5">
      {[
        { Icon: Calendar, value: dateRangeLabel },
        { Icon: Users, value: participantsLabel },
        { Icon: Clock, value: timeControlLabel },
        { Icon: MapPin, value: locationLabel },
      ].map(({ Icon, value }) => (
        <div
          key={`${Icon.displayName ?? Icon.name}-${value}`}
          className="flex min-w-0 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] font-semibold text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur-sm"
        >
          <Icon className="h-3 w-3 text-slate-300" aria-hidden />
          <span className="min-w-0 leading-snug text-slate-100">{value}</span>
        </div>
      ))}
    </div>
  );

  const broadcastFetchLimit = Math.max(activePer * Math.max(requestedPage, 1), 64);
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const baseUrl = host ? `${proto}://${host}` : "http://localhost:3000";

  let officialBoards: LiveFallbackBoard[] = [];
  let officialGamesCount = 0;
  let officialSourceUnavailable = false;
  let officialError: string | null = null;
  let officialResolvedCanonicalKey = requestedOfficialCanonicalKey;
  const officialRoundId = broadcastRoundIdOverride || broadcastRoundsMeta[activeRound - 1]?.id || null;
  if (useOfficialApi) {
    try {
      const officialUrl = new URL("/api/tournament/official", baseUrl);
      officialUrl.searchParams.set("slug", normalizedSlug);
      officialUrl.searchParams.set("round", String(activeRound));
      if (officialRoundId) {
        officialUrl.searchParams.set("roundId", officialRoundId);
      }
      officialUrl.searchParams.set("debug", isDebug ? "1" : "0");
      const officialResponse = await fetch(officialUrl.toString(), { cache: "no-store" }).catch(() => null);
      if (!officialResponse) {
        officialSourceUnavailable = true;
        officialError = "official_unavailable";
      } else {
        const officialJson = (await officialResponse.json().catch(() => null)) as OfficialApiResponse | null;
        const payloadGames = Array.isArray(officialJson?.games) ? officialJson.games : [];
        officialGamesCount = payloadGames.length;
        officialResolvedCanonicalKey = toCleanString(officialJson?.tournamentKey) ?? officialResolvedCanonicalKey;
        if (officialResponse.ok && officialJson?.ok === true && payloadGames.length > 0) {
          officialBoards = mapOfficialGamesToLiveFallbackBoards(payloadGames, {
            debug: isDebug,
            tournamentSlug: normalizedSlug,
            round: activeRound,
          });
          if (officialBoards.length === 0) {
            officialSourceUnavailable = true;
            officialError = "missing_player_data";
          }
        } else {
          officialSourceUnavailable = true;
          officialError =
            toCleanString(officialJson?.error) ??
            (officialResponse.ok ? "empty_games" : "official_unavailable");
        }
      }
    } catch {
      officialSourceUnavailable = true;
      officialError = "official_unavailable";
    }
  }

  const lccPayload =
    !useOfficialApi && isLccBroadcast && broadcastEntry?.tournamentId
      ? await probeLiveChessCloud({
          tournamentId: broadcastEntry.tournamentId,
          round: activeRound,
          limit: broadcastFetchLimit,
          debug: isDebug,
        }).catch(() => null)
      : null;
  const lichessRoundId =
    broadcastRoundIdOverride ||
    broadcastRoundsMeta[activeRound - 1]?.id ||
    broadcastTournamentMeta?.snapshot.activeRoundId ||
    null;
  const debugRoundId = isLichessBroadcast ? lichessRoundId : null;
  const lichessPayload =
    !useOfficialApi && isLichessBroadcast && broadcastEntry?.lichessBroadcastId
      ? await fetchLichessBroadcastRound({
          tournamentId: broadcastEntry.lichessBroadcastId,
          roundIdOverride: lichessRoundId,
          debug: isDebug,
        }).catch(() => null)
      : null;
  const upstreamBoards = useOfficialApi
    ? officialBoards
    : isLccBroadcast
      ? lccPayload?.payload.boards ?? []
      : isLichessBroadcast
        ? lichessPayload?.boards ?? []
        : [];
  const upstreamBoardsCount = upstreamBoards.length;
  const shouldFetchCanonicalLiveBoards =
    !useOfficialApi &&
    !lichessRoundsUnavailable &&
    isBroadcast &&
    (normalizedSlug === "worldcup2025" || upstreamBoardsCount === 0);
  let fallbackBoards: LiveFallbackBoard[] = [];
  let fallbackPlayerKeySample: LiveFallbackPlayerKeySample | null = null;
  if (shouldFetchCanonicalLiveBoards) {
    try {
      const fallbackUrl = new URL("/api/tournament/live", baseUrl);
      fallbackUrl.searchParams.set("slug", normalizedSlug);
      fallbackUrl.searchParams.set("round", String(activeRound));
      if (isDebug) {
        fallbackUrl.searchParams.set("debug", "1");
      }
      const fallbackResponse = await fetch(fallbackUrl.toString(), { cache: "no-store" }).catch(() => null);
      if (fallbackResponse?.ok) {
        const fallbackJson = (await fallbackResponse.json()) as {
          boards?: unknown[];
          payload?: { boards?: unknown[] };
        };
        const fallbackPayloadBoards = Array.isArray(fallbackJson.boards)
          ? fallbackJson.boards
          : Array.isArray(fallbackJson.payload?.boards)
            ? fallbackJson.payload.boards
            : [];
        if (isDebug) {
          fallbackPlayerKeySample = getLiveFallbackPlayerKeySample(fallbackPayloadBoards);
        }
        fallbackBoards = mapLiveFallbackBoards(fallbackPayloadBoards);
      }
    } catch {
      fallbackBoards = [];
    }
  }
  const fallbackBoardsCount = fallbackBoards.length;
  const useCanonicalBoards =
    !useOfficialApi && fallbackBoardsCount > 0 && (normalizedSlug === "worldcup2025" || upstreamBoardsCount === 0);
  const boardsSourceUsed = useOfficialApi
    ? "official-api"
    : useCanonicalBoards
      ? normalizedSlug === "worldcup2025"
        ? "live-canonical"
        : "live-fallback"
      : "upstream";
  const broadcastBoards = useOfficialApi ? officialBoards : useCanonicalBoards ? fallbackBoards : upstreamBoards;
  const fallbackPlayersByBoardNumber = new Map<
    number,
    { white: BoardNavigationPlayer; black: BoardNavigationPlayer }
  >(
    broadcastBoards
      .filter(isLiveFallbackBoard)
      .map(board => [board.boardNo, { white: board.white, black: board.black }])
  );
  const useDynamicBroadcastBoards = isBroadcast || useOfficialApi;
  const roundEntries: TournamentRoundEntry[] = useDynamicBroadcastBoards
    ? broadcastBoards.map(board => {
        const boardNo = board.boardNo;
        const boardId = buildBoardIdentifier(normalizedSlug, activeRound, boardNo);
        const fallbackPlayers = isLiveFallbackBoard(board) ? board : null;
        const whitePlayer = fallbackPlayers
          ? fallbackPlayers.white
          : resolvePlayerIdentity("whiteName" in board ? board.whiteName : null, "white");
        const blackPlayer = fallbackPlayers
          ? fallbackPlayers.black
          : resolvePlayerIdentity("blackName" in board ? board.blackName : null, "black");
        const whiteName = whitePlayer.name;
        const blackName = blackPlayer.name;
        const normalizedResult = normalizeBroadcastResult(board.result);
        const whiteTimeMs =
          "whiteTimeMs" in board && Number.isFinite(Number(board.whiteTimeMs ?? NaN))
            ? Math.max(0, Math.floor(Number(board.whiteTimeMs)))
            : null;
        const blackTimeMs =
          "blackTimeMs" in board && Number.isFinite(Number(board.blackTimeMs ?? NaN))
            ? Math.max(0, Math.floor(Number(board.blackTimeMs)))
            : null;
        const sideToMove =
          "sideToMove" in board && (board.sideToMove === "white" || board.sideToMove === "black")
            ? board.sideToMove
            : null;
        const clockUpdatedAtMs =
          "clockUpdatedAtMs" in board && Number.isFinite(Number(board.clockUpdatedAtMs ?? NaN))
            ? Math.floor(Number(board.clockUpdatedAtMs))
            : null;
        const finalFen =
          "finalFen" in board && typeof board.finalFen === "string" && board.finalFen.trim()
            ? board.finalFen
            : null;
        let whiteRating = 0;
        let blackRating = 0;
        let whiteTitle: FideTitle | null = null;
        let blackTitle: FideTitle | null = null;
        let whiteCountry = "";
        let blackCountry = "";
        let whiteFlag = "";
        let blackFlag = "";
        if (fallbackPlayers) {
          whiteRating =
            Number.isFinite(Number(fallbackPlayers.white.rating ?? NaN)) &&
            Number(fallbackPlayers.white.rating) > 0
              ? Math.trunc(Number(fallbackPlayers.white.rating))
              : 0;
          blackRating =
            Number.isFinite(Number(fallbackPlayers.black.rating ?? NaN)) &&
            Number(fallbackPlayers.black.rating) > 0
              ? Math.trunc(Number(fallbackPlayers.black.rating))
              : 0;
          whiteTitle = normalizeFideTitle(fallbackPlayers.white.title ?? null);
          blackTitle = normalizeFideTitle(fallbackPlayers.black.title ?? null);
          whiteCountry = fallbackPlayers.white.country?.trim() || "";
          blackCountry = fallbackPlayers.black.country?.trim() || "";
          whiteFlag =
            fallbackPlayers.white.flag?.trim() ||
            fallbackPlayers.white.federation?.trim() ||
            fallbackPlayers.white.country?.trim() ||
            "";
          blackFlag =
            fallbackPlayers.black.flag?.trim() ||
            fallbackPlayers.black.federation?.trim() ||
            fallbackPlayers.black.country?.trim() ||
            "";
        } else if (isLichessBroadcastBoard(board)) {
          whiteRating =
            typeof board.whiteElo === "number" && Number.isFinite(board.whiteElo) ? board.whiteElo : 0;
          blackRating =
            typeof board.blackElo === "number" && Number.isFinite(board.blackElo) ? board.blackElo : 0;
          whiteTitle = normalizeFideTitle(board.whiteTitle);
          blackTitle = normalizeFideTitle(board.blackTitle);
          whiteCountry = board.whiteCountry?.trim() || "";
          blackCountry = board.blackCountry?.trim() || "";
          whiteFlag = whiteCountry;
          blackFlag = blackCountry;
        }
        return {
          board: boardNo,
          game: {
            tournamentSlug: normalizedSlug,
            boardId,
            round: activeRound,
            board: boardNo,
            white: whiteName,
            whiteTitle,
            whiteRating,
            whiteCountry,
            whiteFlag: whiteFlag || whiteCountry,
            black: blackName,
            blackTitle,
            blackRating,
            blackCountry,
            blackFlag: blackFlag || blackCountry,
            result: normalizedResult,
            status: normalizeBroadcastStatus(board.status, normalizedResult),
            moveList: board.moveList ?? null,
            finalFen,
            whiteTimeMs,
            blackTimeMs,
            sideToMove,
            clockUpdatedAtMs,
          },
        };
      })
    : getTournamentRoundEntries(normalizedSlug, activeRound);
  const allBoardEntries: BoardNavigationEntry[] = roundEntries.map(({ board, game }) => {
    const fallbackPlayers = fallbackPlayersByBoardNumber.get(board);
    const whitePlayer = fallbackPlayers?.white ?? resolvePlayerIdentity(game.white, "white");
    const blackPlayer = fallbackPlayers?.black ?? resolvePlayerIdentity(game.black, "black");
    const fallbackWhiteRating =
      Number.isFinite(Number(fallbackPlayers?.white.rating ?? NaN)) && Number(fallbackPlayers?.white.rating) > 0
        ? Math.trunc(Number(fallbackPlayers?.white.rating))
        : undefined;
    const fallbackBlackRating =
      Number.isFinite(Number(fallbackPlayers?.black.rating ?? NaN)) && Number(fallbackPlayers?.black.rating) > 0
        ? Math.trunc(Number(fallbackPlayers?.black.rating))
        : undefined;
    const whiteRating =
      fallbackWhiteRating ??
      (Number.isFinite(game.whiteRating) && game.whiteRating > 0 ? game.whiteRating : undefined);
    const blackRating =
      fallbackBlackRating ??
      (Number.isFinite(game.blackRating) && game.blackRating > 0 ? game.blackRating : undefined);
    const previewFen = buildPreviewFen(game, normalizedSlug, board);
    const miniEvalCp = previewFen ? getMiniEvalCp(previewFen) : null;
    const boardId = game.boardId ?? buildBoardIdentifier(normalizedSlug, activeRound, board);

    return {
      boardId,
      boardNumber: board,
      result: game.result ?? null,
      status: game.status ?? "scheduled",
      evaluation: game.evaluation ?? null,
      miniEvalCp,
      whiteTimeMs: game.whiteTimeMs ?? null,
      blackTimeMs: game.blackTimeMs ?? null,
      clockUpdatedAtMs: game.clockUpdatedAtMs ?? null,
      sideToMove: game.sideToMove ?? null,
      finalFen: game.finalFen ?? null,
      previewFen,
      moveList: game.moveList ?? null,
      white: {
        name: whitePlayer.name,
        title: fallbackPlayers?.white.title ?? game.whiteTitle ?? null,
        rating: whiteRating,
        flag: fallbackPlayers?.white.flag ?? game.whiteFlag ?? game.whiteCountry ?? undefined,
        country: fallbackPlayers?.white.country ?? game.whiteCountry ?? undefined,
        federation: fallbackPlayers?.white.federation ?? undefined,
        nameSource: whitePlayer.nameSource,
        missingData: whitePlayer.missingData,
        missingReason: whitePlayer.missingReason,
      },
      black: {
        name: blackPlayer.name,
        title: fallbackPlayers?.black.title ?? game.blackTitle ?? null,
        rating: blackRating,
        flag: fallbackPlayers?.black.flag ?? game.blackFlag ?? game.blackCountry ?? undefined,
        country: fallbackPlayers?.black.country ?? game.blackCountry ?? undefined,
        federation: fallbackPlayers?.black.federation ?? undefined,
        nameSource: blackPlayer.nameSource,
        missingData: blackPlayer.missingData,
        missingReason: blackPlayer.missingReason,
      },
    };
  });
  const officialUnavailable = useOfficialApi && officialSourceUnavailable;
  const sourceUnavailableLabel = officialUnavailable
    ? "Official source unavailable"
    : lichessRoundsUnavailable
      ? "Official source unavailable (no rounds returned)"
      : null;
  const sourceUnavailableError = officialUnavailable
    ? officialError
    : lichessRoundsUnavailable
      ? "no_rounds_returned"
      : null;
  const boardEntries = allBoardEntries;
  const roundHasBoards = allBoardEntries.length > 0;
  const roundHasStarted = allBoardEntries.some(entry => {
    const normalizedResult = normalizeResultValue(entry.result);
    const hasResult = Boolean(normalizedResult && normalizedResult !== "*");
    const moveCount = Array.isArray(entry.moveList) ? entry.moveList.length : 0;
    const hasClock =
      Number.isFinite(Number(entry.whiteTimeMs ?? NaN)) ||
      Number.isFinite(Number(entry.blackTimeMs ?? NaN));
    return (
      entry.status === "live" ||
      entry.status === "final" ||
      hasResult ||
      moveCount > 0 ||
      hasClock ||
      Boolean(entry.sideToMove)
    );
  });
  const roundNotStarted = sourceUnavailableLabel ? false : !roundHasBoards || !roundHasStarted;
  const roundIsComplete =
    roundHasBoards && boardEntries.every(entry => resolveFilterStatus(entry) === "finished");
  const activeRoundIsLive = !roundNotStarted && !roundIsComplete;
  const roundEmptyLabel = sourceUnavailableLabel
    ? sourceUnavailableLabel
    : roundHasBoards
      ? "No boards match this filter yet."
      : "No boards available for this round yet.";
  const playerRoster = (() => {
    const roster = new Map<
      string,
      {
        name: string;
        rating?: number;
        title?: string | null;
        flag?: string;
        federation?: string;
        country?: string;
      }
    >();
    const recordPlayer = (player: BoardNavigationEntry["white"]) => {
      if (player.missingData) return;
      const name = player.name?.trim();
      if (!name) return;
      const normalized = name.toLowerCase();
      if (normalized === "unknown") return;
      const existing = roster.get(normalized);
      if (!existing) {
        roster.set(normalized, {
          name,
          rating: player.rating,
          title: player.title ?? null,
          flag: player.flag,
          federation: player.federation,
          country: player.country,
        });
        return;
      }
      if (existing.rating == null && player.rating != null) {
        existing.rating = player.rating;
      }
      if (existing.title == null && player.title) {
        existing.title = player.title;
      }
      if (!existing.flag && player.flag) {
        existing.flag = player.flag;
      }
      if (!existing.federation && player.federation) {
        existing.federation = player.federation;
      }
      if (!existing.country && player.country) {
        existing.country = player.country;
      }
    };

    allBoardEntries.forEach(entry => {
      recordPlayer(entry.white);
      recordPlayer(entry.black);
    });

    return Array.from(roster.values()).sort((a, b) => {
      const ratingA = typeof a.rating === "number" && Number.isFinite(a.rating) ? a.rating : 0;
      const ratingB = typeof b.rating === "number" && Number.isFinite(b.rating) ? b.rating : 0;
      if (ratingA !== ratingB) return ratingB - ratingA;
      return a.name.localeCompare(b.name);
    });
  })();
  const playerRows =
    playerRoster.length > 0
      ? playerRoster
      : useOfficialApi
        ? playerRoster
        : tournamentConfig?.topPlayers ?? playerRoster;
  const leaderboardRows = (() => {
    const rosterLookup = new Map(
      playerRoster.map(player => [player.name.toLowerCase(), player])
    );
    const pointsMap = new Map<string, number>();
    const recordPoints = (player: BoardNavigationEntry["white"], points: number) => {
      if (player.missingData) return;
      const name = player.name?.trim();
      if (!name) return;
      const normalized = name.toLowerCase();
      if (normalized === "unknown") return;
      pointsMap.set(normalized, (pointsMap.get(normalized) ?? 0) + points);
    };

    allBoardEntries.forEach(entry => {
      const result = normalizeResultValue(entry.result);
      if (!result || result === "*") return;
      if (result === "1-0") {
        recordPoints(entry.white, 1);
        recordPoints(entry.black, 0);
      } else if (result === "0-1") {
        recordPoints(entry.white, 0);
        recordPoints(entry.black, 1);
      } else if (result === "1/2-1/2") {
        recordPoints(entry.white, 0.5);
        recordPoints(entry.black, 0.5);
      }
    });

    return playerRows
      .map((player, index) => {
        const normalized = player.name?.trim().toLowerCase() ?? "";
        const rosterEntry = rosterLookup.get(normalized);
        const points = pointsMap.has(normalized) ? pointsMap.get(normalized) ?? null : null;
        const title = "title" in player ? player.title : undefined;
        const flag = "flag" in player ? player.flag : undefined;
        const federation = "federation" in player ? player.federation : undefined;
        const country = "country" in player ? player.country : undefined;
        return {
          name: player.name,
          rating: player.rating ?? rosterEntry?.rating,
          title: title ?? rosterEntry?.title ?? null,
          flag: flag ?? rosterEntry?.flag,
          federation: federation ?? rosterEntry?.federation,
          country: country ?? rosterEntry?.country,
          points,
          __index: index,
        };
      })
      .sort((a, b) => {
        const pointsA = Number.isFinite(a.points ?? NaN) ? (a.points as number) : null;
        const pointsB = Number.isFinite(b.points ?? NaN) ? (b.points as number) : null;
        if (pointsA == null && pointsB != null) return 1;
        if (pointsA != null && pointsB == null) return -1;
        if (pointsA != null && pointsB != null && pointsA !== pointsB) return pointsB - pointsA;
        const ratingA = Number.isFinite(a.rating ?? NaN) ? (a.rating as number) : null;
        const ratingB = Number.isFinite(b.rating ?? NaN) ? (b.rating as number) : null;
        if (ratingA == null && ratingB != null) return 1;
        if (ratingA != null && ratingB == null) return -1;
        if (ratingA != null && ratingB != null && ratingA !== ratingB) return ratingB - ratingA;
        return a.__index - b.__index;
      })
      .map(({ __index, ...player }) => player);
  })();
  const rawBoardsCount = boardEntries.length;
  const allFinishedBoardsCount = boardEntries.filter(
    entry => resolveFilterStatus(entry) === "finished"
  ).length;
  const playingBoardsCount = boardEntries.filter(entry => resolveFilterStatus(entry) === "playing").length;
  const unknownBoardsCount = boardEntries.filter(
    entry => !entry.status || entry.status === "unknown"
  ).length;
  const statusCountsLabel = `playing:${playingBoardsCount} finished:${allFinishedBoardsCount} results:${allFinishedBoardsCount} unknown:${unknownBoardsCount}`;
  const fallbackPlayerKeySampleLabel = fallbackPlayerKeySample
    ? `board:${fallbackPlayerKeySample.boardNo ?? "-"} whiteType:${fallbackPlayerKeySample.whiteType} whiteKeys:${formatDebugKeys(fallbackPlayerKeySample.whiteKeys)} blackType:${fallbackPlayerKeySample.blackType} blackKeys:${formatDebugKeys(fallbackPlayerKeySample.blackKeys)}`
    : "none";
  const unresolvedPlayerIssues = allBoardEntries.flatMap(entry => {
    const issues: string[] = [];
    if (entry.white.missingData) {
      issues.push(`${entry.boardId}:white:${entry.white.missingReason ?? "missing player data"}`);
    }
    if (entry.black.missingData) {
      issues.push(`${entry.boardId}:black:${entry.black.missingReason ?? "missing player data"}`);
    }
    return issues;
  });
  const unresolvedPlayersLabel = (() => {
    if (unresolvedPlayerIssues.length === 0) return "none";
    const maxEntries = 5;
    const visible = unresolvedPlayerIssues.slice(0, maxEntries);
    const remaining = unresolvedPlayerIssues.length - visible.length;
    return remaining > 0 ? `${visible.join(" | ")} +${remaining} more` : visible.join(" | ");
  })();
  const worldCupBoardOneId =
    normalizedSlug === "worldcup2025"
      ? buildBoardIdentifier(normalizedSlug, activeRound, 1)
      : null;
  const worldCupBoardOneEntry = worldCupBoardOneId
    ? allBoardEntries.find(entry => entry.boardId === worldCupBoardOneId) ?? null
    : null;
  const boardOnePlayerSourceLabel = worldCupBoardOneEntry
    ? `${worldCupBoardOneEntry.boardId} whiteSource:${worldCupBoardOneEntry.white.nameSource ?? "unknown"} blackSource:${worldCupBoardOneEntry.black.nameSource ?? "unknown"}${worldCupBoardOneEntry.white.missingData ? ` whiteMissing:${worldCupBoardOneEntry.white.missingReason ?? "missing white name field"}` : ""}${worldCupBoardOneEntry.black.missingData ? ` blackMissing:${worldCupBoardOneEntry.black.missingReason ?? "missing black name field"}` : ""}`
    : "none";
  const hasStatusParam = typeof statusParam === "string" && statusParam.trim().length > 0;
  const parsedStatusParam = hasStatusParam ? normalizeStatus(statusParam) : null;
  const fallbackStatus = "all";
  const activeStatus = parsedStatusParam ?? fallbackStatus;
  const gridSearchQuery = typeof searchParam === "string" ? searchParam.trim() : "";
  const normalizedGridSearchQuery = gridSearchQuery.toLowerCase();
  const boardLinkMode = activeMode === "replay" ? "replay" : undefined;
  const shouldEnableBoardLiveUpdates =
    activeMode !== "replay" && (activeRoundIsLive || roundIsComplete);
  const statusFilteredBoards = (() => {
    if (boardEntries.length === 0) return [];
    return boardEntries.filter(entry => {
      const filterStatus = resolveFilterStatus(entry);
      if (activeStatus === "live") return filterStatus === "playing";
      if (activeStatus === "finished") return filterStatus === "finished";
      return true;
    });
  })();
  const liveBoardsCount = statusFilteredBoards.filter(
    entry => resolveFilterStatus(entry) === "playing"
  ).length;
  const finishedBoardsCount = statusFilteredBoards.filter(
    entry => resolveFilterStatus(entry) === "finished"
  ).length;
  const scheduledBoardsCount = statusFilteredBoards.filter(
    entry => resolveFilterStatus(entry) === "scheduled"
  ).length;
  const finishedDenominator = finishedBoardsCount + scheduledBoardsCount;
  const finishedRatio = finishedDenominator > 0 ? finishedBoardsCount / finishedDenominator : 0;
  const derivedRoundOutcome = (() => {
    if (liveBoardsCount > 0) {
      return { state: "live" as const, decision: "hasLiveBoards" };
    }
    if (finishedBoardsCount > 0 && scheduledBoardsCount === 0) {
      return { state: "finished" as const, decision: "finishedWithoutScheduledBoards" };
    }
    if (finishedBoardsCount > 0 && scheduledBoardsCount > 0) {
      if (finishedRatio >= 0.95) {
        return { state: "finished" as const, decision: "finishedRatioGte95" };
      }
      return { state: "scheduled" as const, decision: "finishedRatioLt95" };
    }
    return { state: "scheduled" as const, decision: "defaultScheduled" };
  })();
  const derivedRoundState: "live" | "finished" | "scheduled" = derivedRoundOutcome.state;
  const derivedRoundDecision = derivedRoundOutcome.decision;
  const derivedRoundStateLabel =
    derivedRoundState === "live"
      ? "Live"
      : derivedRoundState === "finished"
        ? "Finished"
        : "Scheduled";
  const activeRoundPresentation =
    derivedRoundState === "finished"
      ? {
          statusLabel: "Finished",
          statusTone: "finished" as const,
          badgeLabel: "Finished" as const,
        }
      : derivedRoundState === "scheduled"
        ? {
            statusLabel: "Not started",
            statusTone: "notStarted" as const,
            badgeLabel: "Scheduled" as const,
          }
        : {
            statusLabel: "Live",
            statusTone: "live" as const,
            badgeLabel: null,
          };
  const filteredBoards = (() => {
    if (statusFilteredBoards.length === 0) return [];
    const filtered = statusFilteredBoards;

    return filtered.slice().sort((a, b) => a.boardNumber - b.boardNumber);
  })();
  const resolveRoundStatus = (round: number, startsAtMs: number | null, now: number) => {
    const statusPivotRound = isLichessBroadcast
      ? broadcastTournamentMeta?.snapshot.activeRoundIndex ?? activeRound
      : activeRound;
    const pivotIsLastKnownRound =
      isLichessBroadcast &&
      statusPivotRound === broadcastRoundsMeta.length &&
      broadcastRoundsMeta.length > 0;
    if (round === activeRound) {
      return {
        statusLabel: activeRoundPresentation.statusLabel,
        statusTone: activeRoundPresentation.statusTone,
      };
    }
    if (startsAtMs != null && startsAtMs > now) {
      return { statusLabel: "Not started", statusTone: "notStarted" as const };
    }
    if (round < statusPivotRound) {
      return { statusLabel: "Finished", statusTone: "finished" as const };
    }
    if (pivotIsLastKnownRound && round === statusPivotRound) {
      return { statusLabel: "Finished", statusTone: "finished" as const };
    }
    return { statusLabel: "Not started", statusTone: "notStarted" as const };
  };
  const roundDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const roundTimeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const formatRoundDateLabel = (startsAtMs: number | null) => {
    if (startsAtMs == null) return "—";
    const date = new Date(startsAtMs);
    return `${roundDateFormatter.format(date)} · ${roundTimeFormatter.format(date)}`;
  };
  const roundMenuItems = (() => {
    const now = Date.now();
    return roundSelectionOptions.map(round => {
      const meta = isLichessBroadcast ? broadcastRoundsMeta[round - 1] : null;
      const startsAtMs = meta?.startsAtMs ?? null;
      const dateLabel = formatRoundDateLabel(startsAtMs);
      const { statusLabel, statusTone } = resolveRoundStatus(round, startsAtMs ?? null, now);
      return {
        value: round,
        label: `Round ${round}`,
        dateLabel,
        statusTone,
        statusLabel,
        roundId: meta?.id ?? null,
      };
    });
  })();
  const displayBoards = filteredBoards;
  const roundStateBadge = activeRoundPresentation.badgeLabel;
  const gridBoards =
    normalizedGridSearchQuery.length > 0
      ? displayBoards.filter(board => {
          const whiteName = board.white?.name ?? "";
          const blackName = board.black?.name ?? "";
          return (
            whiteName.toLowerCase().includes(normalizedGridSearchQuery) ||
            blackName.toLowerCase().includes(normalizedGridSearchQuery)
          );
        })
      : displayBoards;
  const filteredCount = gridBoards.length;
  const pageCount = Math.max(1, Math.ceil(filteredCount / activePer));
  const activePage = Math.min(Math.max(requestedPage, 1), pageCount);
  const startIndex = (activePage - 1) * activePer;
  const paginatedBoards = gridBoards.slice(startIndex, startIndex + activePer);
  const pagedCount = paginatedBoards.length;
  const totalGamesThisRound = rawBoardsCount;
  const liveGamesThisRound = playingBoardsCount;
  const displayedGamesCount = pagedCount;

  return (
    <main className="min-h-screen bg-[#020817] text-slate-100">
      <div
        className="mx-auto w-full px-4 pb-6 pt-3 lg:px-8 max-w-[1440px] 2xl:max-w-[1776px]"
      >
        <section
          className="rounded-3xl border border-white/10 bg-slate-950/60 p-3 shadow-sm mt-2"
        >
          <div className="grid gap-2">
              <div className="grid items-stretch gap-2 lg:grid-cols-[minmax(320px,1fr)_3fr] lg:gap-1">
                <div className="flex min-h-0 flex-col lg:self-stretch">
                  <BroadcastHubSidebar
                    boards={displayBoards}
                    selectedBoardId={selectedBoardId}
                    tournamentSlug={normalizedSlug}
                    mode={boardLinkMode}
                    debug={isDebug}
                    debugRoundId={debugRoundId}
                    activeRound={activeRound}
                    roundNotStarted={roundNotStarted}
                    liveUpdatesEnabled={shouldEnableBoardLiveUpdates}
                    liveUpdatesIntervalMs={20000}
                    leaderboardPlayers={leaderboardRows}
                  />
                </div>
                <section className="flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-xl ring-1 ring-white/5">
                  <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
                    <div className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-2xl font-semibold text-white sm:text-3xl">
                          {displayTournamentName}
                        </h1>
                        {isDebug ? (
                          <span className="rounded-full border border-rose-400/70 bg-rose-500/15 px-3 py-1 text-[11px] font-semibold text-rose-100">
                            Debug: Boards Tab Wired
                          </span>
                        ) : null}
                        <Link
                          href={`/broadcast/${encodeURIComponent(normalizedSlug)}/results?round=${activeRound}`}
                          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-200 hover:border-white/30 hover:bg-white/10"
                        >
                          Results
                        </Link>
                        {roundStateBadge ? (
                          <span className="inline-flex items-center rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
                            {roundStateBadge}
                          </span>
                        ) : null}
                      </div>
                      {tournamentInfoStrip}
                  <div className="mt-2 flex justify-center">
                    <RoundTextDropdown
                      items={roundMenuItems}
                      activeRound={activeRound}
                      tournamentSlug={normalizedSlug}
                      prefetchOfficialRounds={useOfficialApi}
                    />
                  </div>
                      {sourceUnavailableLabel ? (
                        <div className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100">
                          {sourceUnavailableLabel}
                          {isDebug && sourceUnavailableError ? (
                            <span className="ml-2 text-xs font-medium text-rose-200">
                              ({sourceUnavailableError})
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                </div>
                    <div className="relative min-h-[180px] bg-slate-950/60 p-3 sm:min-h-[220px] sm:p-4 lg:min-h-[240px] lg:p-5">
                      {heroCandidate ? (
                        <Image
                          src={heroCandidate.src}
                          alt={`${displayTournamentName} banner`}
                          fill
                          sizes="(min-width: 1280px) 40vw, (min-width: 768px) 45vw, 100vw"
                          className={heroCandidate.fit === "cover" ? "object-cover" : "object-contain"}
                          priority
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
                      )}
                    </div>
                  </div>
                  {isDebug ? (
                    <div className="px-5 pb-0 pt-3 sm:px-6">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-2 text-xs font-semibold text-slate-400">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            rawStatusParam {rawStatusLabel} | resolvedSelectedStatus {activeStatus} | Raw{" "}
                            {rawBoardsCount} | Filtered {filteredCount} | Page {activePage}/{pageCount} |{" "}
                            statusCounts {statusCountsLabel} | totalGamesThisRound {totalGamesThisRound} |{" "}
                            liveGamesThisRound {liveGamesThisRound} | displayedGamesCount {displayedGamesCount} |{" "}
                            normalizedSlug {normalizedSlug} | activeRound {activeRound} | upstreamBoardsCount{" "}
                            {upstreamBoardsCount} | fallbackBoardsCount {fallbackBoardsCount} | source={boardsSourceUsed} | officialGamesCount{" "}
                            {officialGamesCount} | resolvedCanonicalKey{" "}
                            {officialResolvedCanonicalKey ?? "none"} | officialUnavailable{" "}
                            {officialUnavailable ? "yes" : "no"} | officialError {officialError ?? "none"} | roundsMetaCount{" "}
                            {broadcastRoundsMeta.length} | lichessRoundsUnavailable{" "}
                            {lichessRoundsUnavailable ? "yes" : "no"} | sourceUnavailable{" "}
                            {sourceUnavailableLabel ? "yes" : "no"} | sourceUnavailableError{" "}
                            {sourceUnavailableError ?? "none"} | liveBoardsCount {liveBoardsCount} | finishedBoardsCount{" "}
                            {finishedBoardsCount} | scheduledBoardsCount {scheduledBoardsCount} | finishedRatio{" "}
                            {finishedRatio.toFixed(3)} | derivedRoundDecision {derivedRoundDecision} | derivedRoundState{" "}
                            {derivedRoundStateLabel} | fallbackPlayerKeys {fallbackPlayerKeySampleLabel} | unresolvedPlayers{" "}
                            {unresolvedPlayersLabel} | board1PlayerSource {boardOnePlayerSourceLabel}
                          </span>
                          {normalizedSlug === "worldcup2025" && paginatedBoards[0]?.boardId ? (
                            <DebugSimulateMoveButton
                              boardId={paginatedBoards[0].boardId}
                              tournamentSlug={normalizedSlug}
                              previewFen={paginatedBoards[0].previewFen ?? null}
                            />
                          ) : null}
                      </div>
                    </div>
                  </div>
                  ) : null}
                  <div className="mt-2 hidden lg:block px-5 pt-2 pb-2 sm:px-6">
                    <BoardsFilterRow
                      totalCount={filteredCount}
                      rawCount={rawBoardsCount}
                      playingCount={playingBoardsCount}
                      page={activePage}
                      status={activeStatus}
                      pageCount={pageCount}
                    />
                  </div>
                </section>
              </div>
              <div className="relative z-10 overflow-visible border-t border-white/10 pt-6">
                <BoardsNavigation
                  boards={paginatedBoards}
                  sidebarBoards={paginatedBoards}
                  gridColsClassName="grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                  tournamentSlug={normalizedSlug}
                  selectedRound={activeRound}
                  mode={boardLinkMode}
                  layout="grid"
                  selectedBoardId={selectedBoardId}
                  variant="tournament"
                  liveUpdatesEnabled={shouldEnableBoardLiveUpdates}
                  liveUpdatesIntervalMs={20000}
                  debug={isDebug}
                  debugRoundId={debugRoundId}
                  emptyLabel={roundEmptyLabel}
                />
              </div>
            </div>
        </section>
      </div>
    </main>
  );
}

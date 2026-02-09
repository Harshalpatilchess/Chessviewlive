"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FavoriteToggleButton from "@/components/favorites/FavoriteToggleButton";
import { formatBoardContextLabel, formatBoardLabel } from "@/lib/boardContext";
import { resolveTournamentName, type FavoriteGameEntry } from "@/lib/favoriteGames";
import { WORLD_CUP_DEMO_PLIES, pliesFromPgn } from "@/lib/mockGames";
import { buildBoardPaths, buildBroadcastBoardPath } from "@/lib/paths";
import ViewerShell from "@/components/viewer/ViewerShell";
import LiveHeaderControls from "@/components/viewer/LiveHeaderControls";
import { movesToPlies, pliesToFenAt } from "@/lib/chess/pgn";
import { mapEvaluationToBar, type EvaluationBarMapping } from "@/lib/engine/evalMapping";
import { ENGINE_DISPLAY_NAME, type EngineProfileId } from "@/lib/engine/config";
import useCloudEngineEvaluation from "@/lib/engine/useCloudEngineEvaluation";
import useBoardAnalysis from "@/lib/hooks/useBoardAnalysis";
import usePersistentBoardOrientation from "@/lib/hooks/usePersistentBoardOrientation";
import useTournamentLiveFeed from "@/lib/live/useTournamentLiveFeed";
import { getReplayProgress, setReplayProgress, clearReplayProgress } from "@/lib/replayProgress";
import { getReplaySpeed, setReplaySpeed } from "@/lib/replaySettings";
import {
  getBoardPlayers,
  getTournamentBoardIds,
} from "@/lib/tournamentBoards";
import { DEFAULT_TOURNAMENT_SLUG, buildBoardIdentifier, parseBoardIdentifier } from "@/lib/boardId";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";
import type { GameResult, GameStatus } from "@/lib/tournamentManifest";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import YouTubeControlsBar from "@/components/video/YouTubeControlsBar";

type Item = {
  url: string;
  name: string;
  lastModified: string | null;
  size: number;
  startedAt?: string | null;
  durationSec?: number | null;
  friendlyStartedAt?: string | null;
  friendlyDuration?: string | null;
};

type ReplayMovesResponse = {
  ok?: boolean;
  reason?: string | null;
  source?: "file" | "demo-map" | "missing" | string;
  moveList?: string[] | null;
  movesAppliedCount?: number;
  parseMode?: string | null;
  failedToken?: string | null;
  fallbackUsed?: boolean;
  filePathTried?: string | null;
};

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function formatStartedAt(startedAt: string) {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getRecordingTimestamp(item: Item) {
  if (item.startedAt) {
    const ts = Date.parse(item.startedAt);
    if (!Number.isNaN(ts)) return ts;
  }
  if (item.lastModified) {
    const ts = Date.parse(item.lastModified);
    if (!Number.isNaN(ts)) return ts;
  }
  return null;
}

function getRecordingLabels(item: Item) {
  const hasPreciseTiming = Boolean(item.startedAt && item.durationSec != null);
  const startedAtLabel = hasPreciseTiming
    ? formatStartedAt(item.startedAt as string)
    : item.friendlyStartedAt || "";
  const durationLabel = hasPreciseTiming
    ? formatDuration(item.durationSec as number)
    : item.friendlyDuration || "";
  return { startedAtLabel, durationLabel };
}

const normalizeManifestResult = (result?: GameResult | null): GameResult | null => {
  if (!result || result === "*") return null;
  return result === "1/2-1/2" ? "½-½" : result;
};

const DEFAULT_PLAYER_CLOCK = "01:23:45";
const DEMO_WHITE_PLAYER = { name: "Magnus Carlsen", rating: 2830, country: "NOR", flag: "🇳🇴" };
const DEMO_BLACK_PLAYER = { name: "Gukesh D", rating: 2750, country: "IND", flag: "🇮🇳" };
const DEMO_TOURNAMENT_LABEL = "FIDE World Cup 2025";

const formatPlayerName = (name: string | null | undefined, fallback: string) => {
  if (!name) return fallback;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
type SpeedValue = (typeof SPEED_STEPS)[number];
const SPEED_OVERLAY_TIMEOUT_MS = 800;
const SPEED_WHEEL_THROTTLE_MS = 120;
const SEEK_STEP_SECONDS = 5;
const RESUME_MIN_SECONDS = 20;
const RESUME_END_BUFFER_SECONDS = 15;
const RESUME_AUTOHIDE_MS = 12000;
const PROGRESS_SAVE_INTERVAL_MS = 5000;
const PROGRESS_SAVE_DELTA_SECONDS = 4;

function isValidSpeed(value: number): value is SpeedValue {
  return SPEED_STEPS.includes(value as SpeedValue);
}

function parseSpeedValue(input: unknown): SpeedValue | null {
  if (typeof input === "number") {
    return SPEED_STEPS.includes(input as SpeedValue) ? (input as SpeedValue) : null;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const numeric = Number.parseFloat(trimmed);
    if (!Number.isFinite(numeric)) return null;
    return SPEED_STEPS.includes(numeric as SpeedValue) ? (numeric as SpeedValue) : null;
  }
  return null;
}

function formatSpeedLabel(value: SpeedValue) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toString();
}

const MAX_ROUNDS = 9;
const BOARDS_PER_ROUND = 20;

type Orientation = "white" | "black";

type ReplayViewerProps = {
  boardId: string;
  tournamentId?: string;
  viewerDensity?: "default" | "compact";
  viewerVariant?: "full" | "mini";
  liveUpdatesEnabled?: boolean;
  liveUpdatesIntervalMs?: number;
};
export default function ReplayViewer({
  boardId,
  tournamentId,
  viewerDensity,
  viewerVariant = "full",
  liveUpdatesEnabled = true,
  liveUpdatesIntervalMs,
}: ReplayViewerProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const embedParam = searchParams?.get("embed");
  const speedParam = searchParams?.get("speed");
  const latestParam = searchParams?.get("latest");
  const recordingParam = searchParams?.get("recording");
  const recordingUrlParam = searchParams?.get("recordingUrl");
  const paneParamRaw = searchParams?.get("pane");
  const paneParam = useMemo(() => {
    const pane = paneParamRaw;
    return pane === "boards" || pane === "live" || pane === "notation" || pane === "engine"
      ? pane
      : "notation";
  }, [paneParamRaw]);
  const paneForFavorites = useMemo(() => {
    const pane = paneParamRaw;
    return pane === "boards" || pane === "live" || pane === "notation" || pane === "engine" ? pane : undefined;
  }, [paneParamRaw]);
  const enginePanelOpen = paneParam === "notation";
  const explicitRecordingParam = useMemo(() => {
    const candidate = recordingParam ?? recordingUrlParam;
    if (!candidate) return null;
    const trimmed = candidate.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [recordingParam, recordingUrlParam]);
  const shouldSelectLatestFromQuery = useMemo(() => {
    if (typeof latestParam !== "string") return false;
    if (latestParam === "1") return true;
    return latestParam.toLowerCase() === "true";
  }, [latestParam]);
  const isEmbed =
    embedParam === "1" || (typeof embedParam === "string" && embedParam.toLowerCase() === "true");
  const isMini = viewerVariant === "mini";
  const resolvedDensity = viewerDensity ?? (isMini ? "compact" : "default");
  const isCompact = resolvedDensity === "compact";
  const mainClassName = isCompact
    ? "flex h-full min-h-0 flex-col bg-transparent text-slate-100 overflow-hidden"
    : "flex min-h-screen h-screen flex-col bg-slate-950 text-slate-100 overflow-hidden";
  const videoClassName = "h-full w-full object-contain";
  const controlRowClass = isEmbed
    ? "flex flex-wrap items-center gap-2 mb-2 text-xs"
    : isCompact
      ? "flex items-center gap-1.5 mb-2 text-[11px]"
      : "flex items-center gap-2 mb-3";
  const [videos, setVideos] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPip, setIsPip] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [pipMessage, setPipMessage] = useState<string | null>(null);
  const pipMessageTimeoutRef = useRef<number | null>(null);
  const [embedCopied, setEmbedCopied] = useState(false);
  const embedCopiedTimeoutRef = useRef<number | null>(null);
  type Bookmark = { time: number; label: string };
  const bookmarkKey = `cv:replay:${boardId}:bookmarks`;
  const resumeKey = `cv:replay:${boardId}:resume`;
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const endSecRef = useRef<number | null>(null);
  const startSecRef = useRef<number | null>(null);
  const loopActiveRef = useRef<boolean>(false);
  const overlayLabel = useMemo(
    () => formatBoardContextLabel(boardId, tournamentId),
    [boardId, tournamentId]
  );
  const boardPlayers = useMemo(() => {
    if (!tournamentId) return null;
    const players = getBoardPlayers(tournamentId, boardId);
    if (!players.white && !players.black) return null;
    return players;
  }, [tournamentId, boardId]);
  const controlsPanelId = useMemo(() => `replay-controls-panel-${encodeURIComponent(boardId)}`, [boardId]);
  const tournamentLabel = useMemo(() => {
    const trimmed = tournamentId?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }, [tournamentId]);
  const tournamentHref = useMemo(() => {
    if (!tournamentLabel) return null;
    return `/t/${encodeURIComponent(tournamentLabel)}`;
  }, [tournamentLabel]);
  const canonicalPath = useMemo(
    () => buildBroadcastBoardPath(boardId, "replay", tournamentId),
    [boardId, tournamentId]
  );
  const replayPath = canonicalPath;
  const latestReplayPath = useMemo(() => {
    if (!replayPath) return null;
    return `${replayPath}?latest=1`;
  }, [replayPath]);
  const fallbackSlug = useMemo(() => {
    const trimmed = tournamentId?.trim().toLowerCase();
    return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_TOURNAMENT_SLUG;
  }, [tournamentId]);
  const boardSelection = useMemo(
    () => parseBoardIdentifier(boardId, fallbackSlug),
    [boardId, fallbackSlug]
  );
  const liveFeedVersion = useTournamentLiveFeed({
    tournamentSlug: boardSelection.tournamentSlug,
    round: boardSelection.round,
    enabled: liveUpdatesEnabled,
    intervalMs: liveUpdatesIntervalMs,
  });
  const boardManifestGame = useMemo(
    () =>
      getTournamentGameManifest(
        boardSelection.tournamentSlug,
        boardSelection.round,
        boardSelection.board
      ),
    [boardSelection.tournamentSlug, boardSelection.round, boardSelection.board, liveFeedVersion]
  );
  const manifestWhiteName = boardManifestGame?.white ?? DEMO_WHITE_PLAYER.name;
  const manifestBlackName = boardManifestGame?.black ?? DEMO_BLACK_PLAYER.name;
  const whitePlayerName = formatPlayerName(boardPlayers?.white, manifestWhiteName);
  const blackPlayerName = formatPlayerName(boardPlayers?.black, manifestBlackName);
  const whiteTitle = boardManifestGame?.whiteTitle ?? null;
  const blackTitle = boardManifestGame?.blackTitle ?? null;
  const whiteFlag = boardManifestGame?.whiteFlag ?? DEMO_WHITE_PLAYER.flag;
  const blackFlag = boardManifestGame?.blackFlag ?? DEMO_BLACK_PLAYER.flag;
  const whiteRating = boardManifestGame?.whiteRating ?? DEMO_WHITE_PLAYER.rating;
  const blackRating = boardManifestGame?.blackRating ?? DEMO_BLACK_PLAYER.rating;
  const whiteCountryCode = boardManifestGame?.whiteCountry ?? DEMO_WHITE_PLAYER.country;
  const blackCountryCode = boardManifestGame?.blackCountry ?? DEMO_BLACK_PLAYER.country;
  const whiteDisplayName = whitePlayerName;
  const blackDisplayName = blackPlayerName;
  const boardResult = normalizeManifestResult(boardManifestGame?.result ?? null);
  const boardStatus: GameStatus | null = boardManifestGame?.status ?? null;
  const boardNumber = boardSelection.board;
  const displayGameLabel = DEMO_TOURNAMENT_LABEL;
  const isWorldCupReplay = boardSelection.tournamentSlug === "worldcup2025";
  const replayRawPgn = useMemo(() => {
    if (!isWorldCupReplay) return null;
    const raw = getWorldCupPgnForBoard(boardSelection.board);
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  }, [boardSelection.board, isWorldCupReplay]);
  const [resolvedReplayMoveList, setResolvedReplayMoveList] = useState<string[] | null>(null);
  const [resolvedReplaySource, setResolvedReplaySource] = useState<string | null>(null);
  const [resolvedReplayError, setResolvedReplayError] = useState<string | null>(null);

  useEffect(() => {
    if (!isWorldCupReplay) {
      setResolvedReplayMoveList(null);
      setResolvedReplaySource(null);
      setResolvedReplayError(null);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/replay/game?boardId=${encodeURIComponent(boardId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ReplayMovesResponse;
        if (controller.signal.aborted) return;

        const moveList = Array.isArray(payload.moveList)
          ? payload.moveList.filter((move): move is string => typeof move === "string" && move.trim().length > 0)
          : [];
        const source = typeof payload.source === "string" ? payload.source : "missing";
        const reason = typeof payload.reason === "string" && payload.reason.trim().length > 0
          ? payload.reason
          : null;

        setResolvedReplayMoveList(moveList.length > 0 ? moveList : null);
        setResolvedReplaySource(source);
        setResolvedReplayError(payload.ok === false ? reason ?? "replay_moves_unavailable" : null);

        if (payload.ok === false || source === "demo-map" || source === "missing") {
          console.info("[replay/worldcup2025] replay move source", {
            boardId,
            source,
            reason,
            fallbackUsed: Boolean(payload.fallbackUsed),
            movesAppliedCount: payload.movesAppliedCount ?? 0,
            parseMode: payload.parseMode ?? null,
            failedToken: payload.failedToken ?? null,
            filePathTried: payload.filePathTried ?? null,
          });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setResolvedReplayMoveList(null);
        setResolvedReplaySource("missing");
        setResolvedReplayError("replay_fetch_failed");
        console.info("[replay/worldcup2025] replay move source fetch failed", {
          boardId,
          error,
        });
      }
    })();

    return () => controller.abort();
  }, [boardId, isWorldCupReplay]);

  const plies = useMemo(() => {
    const shouldPreferResolvedReplayMoves =
      isWorldCupReplay && !resolvedReplayError && resolvedReplaySource !== "missing";
    if (
      shouldPreferResolvedReplayMoves &&
      Array.isArray(resolvedReplayMoveList) &&
      resolvedReplayMoveList.length > 0
    ) {
      return movesToPlies(resolvedReplayMoveList);
    }

    const moveList = boardManifestGame?.moveList;
    if (Array.isArray(moveList) && moveList.length > 0) {
      return movesToPlies(moveList);
    }
    if (boardSelection.tournamentSlug === "worldcup2025") {
      const pgn = getWorldCupPgnForBoard(boardSelection.board);
      const parsed = pliesFromPgn(pgn);
      if (parsed.length) {
        return parsed;
      }
      console.warn("[worldcup2025] Falling back to demo plies for board", {
        boardNumber: boardSelection.board,
        boardId,
      });
      return WORLD_CUP_DEMO_PLIES;
    }
    return [];
  }, [
    boardId,
    boardManifestGame?.moveList,
    boardSelection.board,
    boardSelection.tournamentSlug,
    isWorldCupReplay,
    resolvedReplayMoveList,
    resolvedReplaySource,
    resolvedReplayError,
  ]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(() =>
    plies.length ? plies.length - 1 : -1
  );
  const [notationCenterRequestToken, setNotationCenterRequestToken] = useState(0);
  useEffect(() => {
    if (!plies.length) {
      setCurrentMoveIndex(-1);
      return;
    }
    setCurrentMoveIndex(plies.length - 1);
  }, [plies.length]);
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const { orientation, toggleOrientation: handleFlip } = usePersistentBoardOrientation("white");
  const [gaugeEnabled, setGaugeEnabled] = useState(true);
  const liveIndex = plies.length - 1;
  const canPrev = currentMoveIndex > -1;
  const canNext = liveIndex >= 0 && currentMoveIndex < liveIndex;
  const liveActive = liveIndex >= 0 && currentMoveIndex === liveIndex;

  const handlePrevOfficial = useCallback(() => setCurrentMoveIndex(prev => Math.max(-1, prev - 1)), []);
  const handleNextOfficial = useCallback(() => {
    if (liveIndex < 0) return;
    setCurrentMoveIndex(prev => Math.min(liveIndex, prev + 1));
  }, [liveIndex]);

  const boardPosition = pliesToFenAt(plies, currentMoveIndex);
  const {
    analysisViewActive,
    analysisBranches,
    activeAnalysisAnchorPly,
    analysisCursorNodeId,
    displayFen,
    exitAnalysisView,
    selectAnalysisMove,
    promoteAnalysisNode,
    deleteAnalysisLine,
    deleteAnalysisFromHere,
    onPieceDrop: handlePieceDrop,
  } = useBoardAnalysis({
    boardId,
    tournamentId,
    plies,
    currentMoveIndex,
    officialFen: boardPosition,
    onOfficialPrev: handlePrevOfficial,
    onOfficialNext: handleNextOfficial,
  });

  const handlePrev = useCallback(() => {
    exitAnalysisView();
    setNotationCenterRequestToken(prev => prev + 1);
    handlePrevOfficial();
  }, [exitAnalysisView, handlePrevOfficial]);
  const handleNext = useCallback(() => {
    exitAnalysisView();
    setNotationCenterRequestToken(prev => prev + 1);
    handleNextOfficial();
  }, [exitAnalysisView, handleNextOfficial]);
  const handleLive = useCallback(() => {
    if (liveIndex < 0) return;
    exitAnalysisView();
    setCurrentMoveIndex(liveIndex);
  }, [exitAnalysisView, liveIndex]);

  const handleNotationPlySelect = useCallback(
    (plyIdx: number) => {
      if (!Number.isFinite(plyIdx)) return;
      exitAnalysisView();
      if (plyIdx < 0) {
        setCurrentMoveIndex(-1);
        return;
      }
      if (liveIndex < 0) {
        setCurrentMoveIndex(-1);
        return;
      }
      setCurrentMoveIndex(Math.min(plyIdx, liveIndex));
    },
    [exitAnalysisView, liveIndex]
  );

  const shouldFetchEval = analysisEnabled || gaugeEnabled;
  const evalDebounceMs = analysisEnabled ? 150 : 320;
  const {
    eval: engineEval,
    bestLines: engineLines,
    isEvaluating: engineThinking,
    evaluatedFen: engineEvaluatedFen,
    activeProfileId,
    activeProfileConfig,
    multiPv,
    targetDepth,
    depthIndex,
    depthSteps,
    setDepthIndex,
    setMultiPv,
    setActiveProfileId,
    lastError: engineError,
  } = useCloudEngineEvaluation(displayFen, { enabled: shouldFetchEval, debounceMs: evalDebounceMs });
  const handleProfileChange = useCallback(
    (value: EngineProfileId) => {
      setActiveProfileId(value);
    },
    [setActiveProfileId]
  );
  const handleDepthChange = useCallback(
    (index: number) => {
      setDepthIndex(index);
    },
    [setDepthIndex]
  );
  const effectiveEngineEval = analysisEnabled ? engineEval : null;
  const effectiveEngineLines = analysisEnabled ? engineLines : [];
  const effectiveEngineThinking = analysisEnabled && engineThinking;
  const effectiveEngineError = analysisEnabled ? engineError : null;
  const engineDisplayFen = engineEvaluatedFen ?? displayFen;
  const { value: evaluation, label: evaluationLabel, advantage: evaluationAdvantage } = useMemo<EvaluationBarMapping>(() => {
    if (!gaugeEnabled) return { value: null, label: null, advantage: null };
    return mapEvaluationToBar(engineEval, engineDisplayFen, { enabled: shouldFetchEval });
  }, [engineDisplayFen, engineEval, gaugeEnabled, shouldFetchEval]);
  const previousBoardHref = useMemo(() => {
    if (boardSelection.board <= 1) return null;
    const prevBoardId = buildBoardIdentifier(
      boardSelection.tournamentSlug,
      boardSelection.round,
      boardSelection.board - 1
    );
    return buildBroadcastBoardPath(prevBoardId, "replay", boardSelection.tournamentSlug);
  }, [boardSelection]);
  const nextBoardHref = useMemo(() => {
    if (boardSelection.board >= BOARDS_PER_ROUND) return null;
    const nextBoardId = buildBoardIdentifier(
      boardSelection.tournamentSlug,
      boardSelection.round,
      boardSelection.board + 1
    );
    return buildBroadcastBoardPath(nextBoardId, "replay", boardSelection.tournamentSlug);
  }, [boardSelection]);
  const tournamentBoardIds = useMemo(() => {
    if (!tournamentId) return null;
    return getTournamentBoardIds(tournamentId);
  }, [tournamentId]);
  const boardSwitcherOptions = useMemo(() => {
    if (!tournamentId || !tournamentBoardIds || tournamentBoardIds.length < 2) return null;
    return tournamentBoardIds.map(id => {
      const trimmed = id.trim();
      const paths = buildBoardPaths(trimmed, tournamentId);
      const players = getBoardPlayers(tournamentId, trimmed);
      return {
        boardId: trimmed,
        label: formatBoardLabel(trimmed),
        href: paths.replay,
        players,
      };
    });
  }, [tournamentId, tournamentBoardIds]);
  const isTournamentBoardConfigured = useMemo(() => {
    if (!tournamentId) return true;
    const parsed = parseBoardIdentifier(boardId, tournamentId);
    const normalizedBoardId = buildBoardIdentifier(
      parsed.tournamentSlug,
      parsed.round,
      parsed.board
    ).toLowerCase();
    const parsedOk = normalizedBoardId === boardId.trim().toLowerCase();
    const game = parsedOk
      ? getTournamentGameManifest(tournamentId, parsed.round, parsed.board)
      : null;
    return Boolean(game);
  }, [tournamentId, boardId]);
  const currentBoardLabel = useMemo(() => formatBoardLabel(boardId), [boardId]);
  const [speed, setSpeed] = useState<SpeedValue>(() => {
    if (typeof window === "undefined") return 1;
    const storedSpeed = getReplaySpeed(boardId);
    if (typeof storedSpeed === "number" && isValidSpeed(storedSpeed)) {
      return storedSpeed;
    }
    return 1;
  });
  const [showSpeedOverlay, setShowSpeedOverlay] = useState(false);
  const speedOverlayTimeoutRef = useRef<number | null>(null);
  const overlayInitializedRef = useRef(false);
  const lastSpeedWheelTsRef = useRef<number>(0);
  const [controlsOpen, setControlsOpen] = useState(false);
  const controlsPanelRef = useRef<HTMLDivElement | null>(null);
  const controlsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const recordingId = useMemo(() => {
    if (!selected) return null;
    return `${boardId}:${selected}`;
  }, [boardId, selected]);
  const [resumePrompt, setResumePrompt] = useState<{ time: number } | null>(null);
  const resumePromptTimeoutRef = useRef<number | null>(null);
  const lastProgressSaveRef = useRef<{ timestamp: number; position: number }>({
    timestamp: 0,
    position: 0,
  });
  const latestSelectionAppliedRef = useRef<string | null>(null);
  const [isMetadataReady, setIsMetadataReady] = useState(false);
  const latestRecording = useMemo(() => {
    if (videos.length === 0) return null;
    let bestIndex = 0;
    let bestTimestamp = getRecordingTimestamp(videos[0]);
    for (let i = 1; i < videos.length; i += 1) {
      const candidateTs = getRecordingTimestamp(videos[i]);
      if (candidateTs === null) continue;
      if (bestTimestamp === null || candidateTs > bestTimestamp) {
        bestIndex = i;
        bestTimestamp = candidateTs;
      }
    }
    return { item: videos[bestIndex], index: bestIndex };
  }, [videos]);
  const latestRecordingLabels = useMemo(() => {
    if (!latestRecording) return null;
    return getRecordingLabels(latestRecording.item);
  }, [latestRecording]);
  const isLatestSelected = latestRecording ? selected === latestRecording.item.url : false;

  const showPipMessage = useCallback((text: string) => {
    if (typeof window === "undefined") return;
    if (pipMessageTimeoutRef.current) {
      window.clearTimeout(pipMessageTimeoutRef.current);
    }
    setPipMessage(text);
    pipMessageTimeoutRef.current = window.setTimeout(() => {
      setPipMessage(null);
      pipMessageTimeoutRef.current = null;
    }, 2000);
  }, []);

  const toggleControlsPanel = useCallback(() => {
    setControlsOpen((prev) => !prev);
  }, []);

  const closeControlsPanel = useCallback(() => {
    setControlsOpen(false);
  }, []);

  useEffect(() => {
    if (tournamentId && !isTournamentBoardConfigured) {
      setVideos([]);
      setSelected(null);
      setCurrentIndex(-1);
      setLoading(false);
      setError(null);
      return;
    }
    // Temporarily skip replay API fetch; fallback to local demo plies/UI
    setVideos([]);
    setSelected(null);
    setCurrentIndex(-1);
    setLoading(false);
  }, [boardId, tournamentId, isTournamentBoardConfigured]);

  useEffect(() => {
    return () => {
      if (pipMessageTimeoutRef.current) {
        window.clearTimeout(pipMessageTimeoutRef.current);
        pipMessageTimeoutRef.current = null;
      }
      if (embedCopiedTimeoutRef.current) {
        window.clearTimeout(embedCopiedTimeoutRef.current);
        embedCopiedTimeoutRef.current = null;
      }
      if (speedOverlayTimeoutRef.current) {
        window.clearTimeout(speedOverlayTimeoutRef.current);
        speedOverlayTimeoutRef.current = null;
      }
    };
  }, []);

  const persistSpeed = useCallback(
    (value: SpeedValue) => {
      if (typeof window === "undefined") return;
      try {
        const raw = window.localStorage.getItem(resumeKey);
        const parsed = raw ? JSON.parse(raw) : null;
        const base =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
        const payload = { ...base, speed: value };
        window.localStorage.setItem(resumeKey, JSON.stringify(payload));
      } catch {
        // ignore storage errors
      }
    },
    [resumeKey]
  );

  const applySpeed = useCallback(
    (value: SpeedValue, options?: { persist?: boolean }) => {
      let changed = false;
      setSpeed(prev => {
        if (prev === value) {
          return prev;
        }
        changed = true;
        return value;
      });
      if (changed) {
        setReplaySpeed(value, boardId);
      }
      if (changed && options?.persist !== false) {
        persistSpeed(value);
      }
    },
    [persistSpeed, boardId]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const paramSpeed = parseSpeedValue(speedParam);
    if (paramSpeed !== null) {
      applySpeed(paramSpeed);
      return;
    }
    const storedPreference = getReplaySpeed(boardId);
    if (typeof storedPreference === "number" && isValidSpeed(storedPreference)) {
      applySpeed(storedPreference, { persist: false });
      return;
    }
    try {
      const raw = window.localStorage.getItem(resumeKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const storedSpeed = parseSpeedValue((parsed as Record<string, unknown>).speed);
        if (storedSpeed !== null) {
          applySpeed(storedSpeed, { persist: false });
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [speedParam, resumeKey, applySpeed, boardId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
  }, [speed, selected]);

  // Briefly show the overlay whenever the playback rate changes for wheel feedback.
  useEffect(() => {
    if (!overlayInitializedRef.current) {
      overlayInitializedRef.current = true;
      return;
    }
    if (typeof window === "undefined") return;
    setShowSpeedOverlay(true);
    if (speedOverlayTimeoutRef.current) {
      window.clearTimeout(speedOverlayTimeoutRef.current);
    }
    speedOverlayTimeoutRef.current = window.setTimeout(() => {
      setShowSpeedOverlay(false);
      speedOverlayTimeoutRef.current = null;
    }, SPEED_OVERLAY_TIMEOUT_MS);
  }, [speed]);

  // Use the mouse wheel over the player to jump to the next allowed playback rate.
  const handleVideoWheel = useCallback(
    (event: ReactWheelEvent<HTMLVideoElement>) => {
      if (event.deltaY === 0) return;
      if (isPip || !isMetadataReady) return;
      const video = videoRef.current;
      if (!video) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastSpeedWheelTsRef.current < SPEED_WHEEL_THROTTLE_MS) {
        event.preventDefault();
        return;
      }
      const direction = event.deltaY < 0 ? 1 : -1;
      const currentIndex = SPEED_STEPS.indexOf(speed);
      if (currentIndex === -1) return;
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= SPEED_STEPS.length) return;
      lastSpeedWheelTsRef.current = now;
      event.preventDefault();
      event.stopPropagation();
      applySpeed(SPEED_STEPS[nextIndex]);
    },
    [speed, applySpeed, isPip, isMetadataReady]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(bookmarkKey);
      if (!stored) {
        setBookmarks([]);
        return;
      }
      const parsed = JSON.parse(stored) as Bookmark[];
      if (Array.isArray(parsed)) {
        setBookmarks(
          parsed
            .filter(
              (entry) =>
                entry &&
                typeof entry.time === "number" &&
                Number.isFinite(entry.time) &&
                entry.time >= 0 &&
                typeof entry.label === "string"
            )
            .sort((a, b) => a.time - b.time)
        );
      }
    } catch {
      setBookmarks([]);
    }
  }, [bookmarkKey]);

  useEffect(() => {
    lastProgressSaveRef.current = { timestamp: 0, position: 0 };
  }, [recordingId]);

  const updateSelected = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= videos.length) return;
      const next = videos[nextIndex];
      if (!next) return;
      setSelected(next.url);
      setCurrentIndex(nextIndex);
      if (typeof window !== "undefined") {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete("startSec");
        newUrl.searchParams.delete("endSec");
        newUrl.searchParams.delete("autoplay");
        newUrl.searchParams.delete("speed");
        if (typeof window.history?.replaceState === "function") {
          window.history.replaceState({}, "", newUrl.toString());
        }
      }
      if (videoRef.current) {
        videoRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    },
    [videos]
  );
  const playLatestRecording = useCallback(() => {
    if (!latestRecording) return;
    updateSelected(latestRecording.index);
  }, [latestRecording, updateSelected]);
  useEffect(() => {
    if (!shouldSelectLatestFromQuery) {
      latestSelectionAppliedRef.current = null;
      return;
    }
    if (explicitRecordingParam) {
      latestSelectionAppliedRef.current = null;
      return;
    }
    if (!latestRecording || videos.length === 0) return;
    const key = `${boardId}:${latestRecording.item.url}`;
    if (latestSelectionAppliedRef.current === key) return;
    if (selected === latestRecording.item.url) {
      latestSelectionAppliedRef.current = key;
      return;
    }
    latestSelectionAppliedRef.current = key;
    updateSelected(latestRecording.index);
  }, [
    shouldSelectLatestFromQuery,
    explicitRecordingParam,
    latestRecording,
    videos,
    boardId,
    selected,
    updateSelected,
  ]);

  const togglePiP = useCallback(async () => {
    if (typeof document === "undefined") return;
    const video = videoRef.current;
    if (!video) return;
    if (
      typeof document.pictureInPictureEnabled === "boolean" &&
      !document.pictureInPictureEnabled
    ) {
      showPipMessage("PiP not supported");
      return;
    }
    if (typeof video.requestPictureInPicture !== "function") {
      showPipMessage("PiP not supported");
      return;
    }
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.info("[replay] pip_toggle_failed", err);
      showPipMessage("PiP unavailable");
    }
  }, [showPipMessage]);

  const seekWithinSegment = useCallback((deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    let nextTime = video.currentTime + deltaSeconds;
    if (duration !== null) {
      nextTime = Math.min(nextTime, duration);
    }
    if (nextTime < 0) {
      nextTime = 0;
    }
    if (endSecRef.current !== null) {
      const durationLimit = duration ?? Number.POSITIVE_INFINITY;
      const endLimit = Math.min(endSecRef.current, durationLimit);
      if (nextTime > endLimit) {
        if (loopActiveRef.current) {
          const start = startSecRef.current ?? 0;
          nextTime = start;
        } else {
          nextTime = endLimit;
        }
      }
    }
    video.currentTime = nextTime;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    const container = videoContainerRef.current || videoRef.current;
    if (!container || typeof container.requestFullscreen !== "function") {
      console.info("[replay] fullscreen_unavailable");
      return;
    }
    if (document.fullscreenElement === container) {
      if (typeof document.exitFullscreen === "function") {
        const exitResult = document.exitFullscreen();
        if (exitResult && typeof exitResult.catch === "function") {
          exitResult.catch(err => {
            console.info("[replay] fullscreen_toggle_failed", err);
          });
        }
      } else {
        console.info("[replay] fullscreen_unavailable");
      }
      return;
    }
    try {
      const result = container.requestFullscreen();
      if (result && typeof result.catch === "function") {
        result.catch(err => {
          console.info("[replay] fullscreen_toggle_failed", err);
        });
      }
    } catch (err) {
      console.info("[replay] fullscreen_toggle_failed", err);
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const copyEmbedSnippet = useCallback(async () => {
    if (typeof window === "undefined") return;
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("embed", "1");
    const snippet = `<iframe src="${currentUrl.toString()}" width="640" height="360" frameborder="0" allow="autoplay; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(snippet);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = snippet;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setEmbedCopied(true);
      if (embedCopiedTimeoutRef.current) {
        window.clearTimeout(embedCopiedTimeoutRef.current);
      }
      embedCopiedTimeoutRef.current = window.setTimeout(() => {
        setEmbedCopied(false);
        embedCopiedTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      console.info("[replay] embed_copy_failed", err);
    }
  }, []);

  const persistBookmarks = useCallback(
    (next: Bookmark[]) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(bookmarkKey, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
    },
    [bookmarkKey]
  );

  const handleAddBookmark = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const currentTime = Math.round(video.currentTime);
    if (!Number.isFinite(currentTime) || currentTime < 0) return;
    const defaultLabel = `Bookmark ${formatDuration(currentTime) || `${currentTime}s`}`;
    const label =
      typeof window !== "undefined" ? window.prompt("Bookmark label", defaultLabel) : defaultLabel;
    if (label === null) return;
    const entry: Bookmark = { time: currentTime, label: label.trim() || defaultLabel };
    setBookmarks(prev => {
      const merged = [...prev.filter(b => b.time !== currentTime), entry].sort((a, b) => a.time - b.time);
      persistBookmarks(merged);
      return merged;
    });
  }, [persistBookmarks]);

  const handleSeekBookmark = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === "function") {
      playAttempt.catch(() => {
        // ignore play failures
      });
    }
  }, []);

  const handleDeleteBookmark = useCallback(
    (time: number) => {
      setBookmarks(prev => {
        const next = prev.filter(b => b.time !== time);
        persistBookmarks(next);
        return next;
      });
    },
    [persistBookmarks]
  );

  const handleResumePlayback = useCallback(() => {
    if (!resumePrompt) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = resumePrompt.time;
    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === "function") {
      playAttempt.catch(() => {});
    }
    setResumePrompt(null);
  }, [resumePrompt]);

  const handleStartOverPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    if (recordingId) {
      clearReplayProgress(recordingId);
    }
    setResumePrompt(null);
  }, [recordingId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      setIsMetadataReady(false);
      return;
    }

    const onLoadedMetadata = () => {
      setDurationSec(Number.isFinite(video.duration) ? video.duration : null);
      setIsMetadataReady(true);
    };

    const handleEnter = () => setIsPip(true);
    const handleLeave = () => setIsPip(false);

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("enterpictureinpicture", handleEnter);
    video.addEventListener("leavepictureinpicture", handleLeave);

    setIsPip(document.pictureInPictureElement === video);
    if (video.readyState >= 1) {
      onLoadedMetadata();
    } else {
      setIsMetadataReady(false);
    }

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("enterpictureinpicture", handleEnter);
      video.removeEventListener("leavepictureinpicture", handleLeave);
      setIsMetadataReady(false);
    };
  }, [selected]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setIsMuted(video.muted);
    const handleVolumeChange = () => setIsMuted(video.muted);
    video.addEventListener("volumechange", handleVolumeChange);
    return () => {
      video.removeEventListener("volumechange", handleVolumeChange);
    };
  }, [selected]);

  useEffect(() => {
    if (!recordingId) {
      setResumePrompt(null);
      return;
    }
    const saved = getReplayProgress(recordingId);
    if (typeof saved !== "number" || saved < RESUME_MIN_SECONDS) {
      setResumePrompt(null);
      return;
    }
    if (typeof durationSec === "number" && durationSec - saved < RESUME_END_BUFFER_SECONDS) {
      clearReplayProgress(recordingId);
      setResumePrompt(null);
      return;
    }
    setResumePrompt({ time: saved });
  }, [recordingId, durationSec]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleFullscreenChange = () => {
      const fullscreenEl = document.fullscreenElement;
      const container = videoContainerRef.current || videoRef.current;
      setIsFullscreen(Boolean(fullscreenEl && container && fullscreenEl === container));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!previousBoardHref && !nextBoardHref) return;
    const handleBoardNav = (event: KeyboardEvent) => {
      if (!event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) return;
      if (event.key === "ArrowLeft" && previousBoardHref) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        router.push(previousBoardHref);
        return;
      }
      if (event.key === "ArrowRight" && nextBoardHref) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        router.push(nextBoardHref);
      }
    };
    window.addEventListener("keydown", handleBoardNav);
    return () => window.removeEventListener("keydown", handleBoardNav);
  }, [previousBoardHref, nextBoardHref, router]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !recordingId) return;
    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      if (!Number.isFinite(currentTime) || currentTime < 0) return;
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      if (duration !== null && duration - currentTime < RESUME_END_BUFFER_SECONDS) {
        clearReplayProgress(recordingId);
        if (resumePrompt) {
          setResumePrompt(null);
        }
        return;
      }
      if (resumePrompt && currentTime >= resumePrompt.time - 1) {
        setResumePrompt(null);
      }
      if (currentTime < RESUME_MIN_SECONDS) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const last = lastProgressSaveRef.current;
      if (
        now - last.timestamp < PROGRESS_SAVE_INTERVAL_MS &&
        Math.abs(currentTime - last.position) < PROGRESS_SAVE_DELTA_SECONDS
      ) {
        return;
      }
      setReplayProgress(recordingId, currentTime);
      lastProgressSaveRef.current = { timestamp: now, position: currentTime };
    };
    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [recordingId, resumePrompt]);

  useEffect(() => {
    if (!controlsOpen) return;
    if (typeof document === "undefined") return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        (controlsPanelRef.current && controlsPanelRef.current.contains(target)) ||
        (controlsTriggerRef.current && controlsTriggerRef.current.contains(target))
      ) {
        return;
      }
      closeControlsPanel();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [controlsOpen, closeControlsPanel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!resumePrompt) {
      if (resumePromptTimeoutRef.current) {
        window.clearTimeout(resumePromptTimeoutRef.current);
        resumePromptTimeoutRef.current = null;
      }
      return;
    }
    if (resumePromptTimeoutRef.current) {
      window.clearTimeout(resumePromptTimeoutRef.current);
    }
    const savedTime = resumePrompt.time;
    resumePromptTimeoutRef.current = window.setTimeout(() => {
      setResumePrompt(current => {
        if (current && current.time === savedTime) {
          return null;
        }
        return current;
      });
      resumePromptTimeoutRef.current = null;
    }, RESUME_AUTOHIDE_MS);
    return () => {
      if (resumePromptTimeoutRef.current) {
        window.clearTimeout(resumePromptTimeoutRef.current);
        resumePromptTimeoutRef.current = null;
      }
    };
  }, [resumePrompt]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey && !event.shiftKey) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          updateSelected(currentIndex - 1);
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          updateSelected(currentIndex + 1);
          return;
        }
      }
      const target = event.target as HTMLElement | null;
      const ignoreTarget =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.tagName === "BUTTON" ||
          target.getAttribute("contenteditable") === "true");
      const isQuestionKey = event.key === "?" || (event.key === "/" && event.shiftKey);
      if (
        isQuestionKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        if (ignoreTarget) return;
        event.preventDefault();
        toggleControlsPanel();
        return;
      }
      if (event.key === "Escape" && controlsOpen) {
        event.preventDefault();
        closeControlsPanel();
        return;
      }
      if (ignoreTarget) return;
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        void togglePiP();
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      const isSpaceKey =
        event.key === " " ||
        event.key === "Spacebar" ||
        event.code === "Space";
      if (!event.metaKey && !event.ctrlKey) {
        if (isSpaceKey || event.key === "k" || event.key === "K") {
          event.preventDefault();
          if (video.paused) {
            const playResult = video.play();
            if (playResult && typeof playResult.catch === "function") {
              playResult.catch(() => {});
            }
          } else {
            video.pause();
          }
          return;
        }
        if (!event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          const delta = event.key === "ArrowLeft" ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS;
          seekWithinSegment(delta);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    togglePiP,
    updateSelected,
    currentIndex,
    toggleFullscreen,
    controlsOpen,
    toggleControlsPanel,
    closeControlsPanel,
    seekWithinSegment,
  ]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as Navigator & { mediaSession?: MediaSession };
    if (!nav.mediaSession) return;
    const mediaSession = nav.mediaSession;
    const video = videoRef.current;
    if (!video) return;
    const currentItem = videos.find((v) => v.url === selected);
    const title = currentItem?.name || boardId;

    mediaSession.metadata = new MediaMetadata({
      title,
      artist: "Chessviewlive",
      album: "Replay",
    });

    const clampTime = (time: number) => {
      const max = typeof durationSec === "number" ? durationSec : Number.POSITIVE_INFINITY;
      return Math.min(Math.max(time, 0), max);
    };

    const applySeek = (nextTime: number) => {
      const clamped = clampTime(nextTime);
      if (endSecRef.current !== null) {
        const endLimit = Math.min(
          endSecRef.current,
          typeof durationSec === "number" ? durationSec : endSecRef.current
        );
        if (clamped > endLimit) {
          if (loopActiveRef.current) {
            const start = startSecRef.current ?? 0;
            video.currentTime = clampTime(start);
            return;
          }
          video.currentTime = endLimit;
          video.pause();
          return;
        }
      }
      video.currentTime = clamped;
    };

    mediaSession.setActionHandler("play", async () => {
      try {
        await video.play();
      } catch (err) {
        console.info("[replay] mediaSession play failed", err);
      }
    });
    mediaSession.setActionHandler("pause", () => {
      video.pause();
    });
    mediaSession.setActionHandler("stop", () => {
      video.pause();
      video.currentTime = 0;
    });
    mediaSession.setActionHandler("seekto", (details) => {
      if (!details || typeof details.seekTime !== "number") return;
      applySeek(details.seekTime);
    });
    mediaSession.setActionHandler("seekbackward", (details) => {
      const offset = details?.seekOffset ?? 10;
      applySeek(video.currentTime - offset);
    });
    mediaSession.setActionHandler("seekforward", (details) => {
      const offset = details?.seekOffset ?? 10;
      applySeek(video.currentTime + offset);
    });
    mediaSession.setActionHandler("previoustrack", () => {
      updateSelected(currentIndex - 1);
    });
    mediaSession.setActionHandler("nexttrack", () => {
      updateSelected(currentIndex + 1);
    });

    return () => {
      mediaSession.setActionHandler("play", null);
      mediaSession.setActionHandler("pause", null);
      mediaSession.setActionHandler("stop", null);
      mediaSession.setActionHandler("seekto", null);
      mediaSession.setActionHandler("seekbackward", null);
      mediaSession.setActionHandler("seekforward", null);
      mediaSession.setActionHandler("previoustrack", null);
      mediaSession.setActionHandler("nexttrack", null);
      mediaSession.metadata = null;
    };
  }, [boardId, videos, selected, durationSec, updateSelected, currentIndex]);

  const unconfiguredNotice =
    tournamentId && !isTournamentBoardConfigured ? (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-700 space-y-3">
        <h1 className="text-lg font-semibold text-neutral-900">
          This board is not configured for this tournament.
        </h1>
        <p>Please check your tournament board settings or pick another board below.</p>
        {tournamentHref && (
          <Link
            href={tournamentHref}
            className="inline-flex items-center gap-1 rounded border border-blue-200 px-3 py-1 text-blue-700 transition hover:bg-blue-50"
          >
            ← Go to all boards in this tournament
          </Link>
        )}
        {boardSwitcherOptions && (
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Available boards</div>
            <div className="flex flex-wrap gap-2">
              {boardSwitcherOptions.map(option => (
                <Link
                  key={option.boardId}
                  href={option.href}
                  className="rounded border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100"
                >
                  Watch {option.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    ) : null;

  const hasVideo = Boolean(selected);

  const videoContent = hasVideo ? (
    <>
      <video
        key={selected}
        ref={videoRef}
        src={selected ?? undefined}
        controls
        playsInline
        className={videoClassName}
        onWheel={handleVideoWheel}
      />
      {resumePrompt && (
        <div className="pointer-events-auto absolute bottom-2 left-2 z-10 flex flex-wrap items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-[11px] text-white shadow">
          <span>Resume from {formatDuration(resumePrompt.time)}</span>
          <button
            type="button"
            className="rounded-full border border-white/30 px-2 py-0.5 font-semibold text-white/90 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            onClick={handleResumePlayback}
          >
            Resume
          </button>
          <button
            type="button"
            className="rounded-full border border-white/30 px-2 py-0.5 text-white/80 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            onClick={handleStartOverPlayback}
          >
            Start over
          </button>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 right-2 z-10 flex flex-col items-end gap-2 text-white">
        {controlsOpen && (
          <div
            ref={controlsPanelRef}
            id={controlsPanelId}
            role="region"
            aria-label="Replay controls help"
            className="pointer-events-auto w-60 max-w-[90vw] rounded-lg border border-white/15 bg-black/75 px-3 py-2 text-[11px] leading-snug text-white shadow-lg backdrop-blur"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
              Controls
            </div>
            <ul className="mt-1 space-y-1 text-white/90">
              <li>Scroll on video: change speed (0.25×–3×)</li>
              <li>Space / K: play or pause</li>
              <li>← / →: seek 5s</li>
              <li>F: fullscreen</li>
              <li>P: picture-in-picture</li>
            </ul>
          </div>
        )}
        <button
          ref={controlsTriggerRef}
          type="button"
          aria-expanded={controlsOpen}
          aria-controls={controlsPanelId}
          className="pointer-events-auto rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-white/90 shadow transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
          onClick={toggleControlsPanel}
        >
          Controls
        </button>
        {showSpeedOverlay && (
          <div className="pointer-events-none rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white shadow">
            {formatSpeedLabel(speed)}x
          </div>
        )}
      </div>
    </>
  ) : (
    <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-slate-300">
      No video recordings found for this board. Showing moves only.
    </div>
  );

  const recordingSelector = !loading && videos.length > 0 ? (
    <>
      {latestRecording && latestRecordingLabels && (
        <section className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-sm shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-900">
                <span className="rounded-full border border-blue-200 bg-white/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-800">
                  Latest
                </span>
                <span>Latest recording</span>
              </div>
              {(latestRecordingLabels.startedAtLabel || latestRecording.item.name) && (
                <div className="text-sm font-medium text-neutral-900">
                  {latestRecordingLabels.startedAtLabel || latestRecording.item.name}
                </div>
              )}
              {(latestRecordingLabels.durationLabel || latestRecording.item.friendlyDuration) && (
                <div className="text-xs text-neutral-600">
                  {latestRecordingLabels.durationLabel || latestRecording.item.friendlyDuration}
                </div>
              )}
            </div>
            <button
              type="button"
              className="h-min rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={playLatestRecording}
              disabled={isLatestSelected}
              aria-label="Play the latest recording"
            >
              {isLatestSelected ? "Playing" : "Play"}
            </button>
          </div>
        </section>
      )}
      {!isEmbed && (
        <>
          <select
            className="mb-1 w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white shadow"
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {videos.map((v) => (
              <option key={v.url} value={v.url}>
                {(v.lastModified ? new Date(v.lastModified).toLocaleString() + " — " : "") +
                  (v.name || "recording.mp4")}
                {latestRecording?.item.url === v.url ? " • Latest" : ""}
              </option>
            ))}
          </select>
          {(() => {
            const item = videos.find((v) => v.url === selected);
            if (!item) return null;
            const { startedAtLabel, durationLabel } = getRecordingLabels(item);
            if (!startedAtLabel && !durationLabel) return null;
            const isLatest = latestRecording?.item.url === item.url;
            return (
              <div className="mb-1 text-xs text-neutral-400" aria-live="polite">
                <div className="inline-flex items-center gap-2">
                  <small aria-label="Recording time and duration">
                    {startedAtLabel}
                    {startedAtLabel && durationLabel ? " • " : ""}
                    {durationLabel}
                  </small>
                  {isLatest && (
                    <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                      Latest
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}
      {selected && (
        <>
          {!isEmbed && (
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                className="rounded border border-white/20 px-2 py-1"
                onClick={() => updateSelected(currentIndex - 1)}
                disabled={currentIndex <= 0}
                title="Previous recording (Alt+Left)"
              >
                Previous
              </button>
              <button
                type="button"
                className="rounded border border-white/20 px-2 py-1"
                onClick={() => updateSelected(currentIndex + 1)}
                disabled={currentIndex < 0 || currentIndex >= videos.length - 1}
                title="Next recording (Alt+Right)"
              >
                Next
              </button>
              <select
                className="rounded border border-white/20 bg-black/40 px-3 py-2"
                value={selected ?? ""}
                onChange={(e) => {
                  const nextUrl = e.target.value;
                  const index = videos.findIndex((v) => v.url === nextUrl);
                  if (index >= 0) {
                    updateSelected(index);
                  } else {
                    setSelected(nextUrl);
                    setCurrentIndex(-1);
                  }
                }}
              >
                {videos.map((v) => (
                  <option key={v.url} value={v.url}>
                    {(v.lastModified ? new Date(v.lastModified).toLocaleString() + " — " : "") +
                      (v.name || "recording.mp4")}
                    {latestRecording?.item.url === v.url ? " • Latest" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={controlRowClass}>
            <YouTubeControlsBar
              className="max-w-full"
              isMuted={isMuted}
              onToggleMute={handleToggleMute}
              isPip={isPip}
              onTogglePictureInPicture={() => {
                void togglePiP();
              }}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              showLowBandwidth={false}
              showPiP
              onClickEmbed={copyEmbedSnippet}
              videoAvailable={hasVideo}
              statusContent={
                <>
                  {embedCopied ? <span className="text-xs text-neutral-300">Copied!</span> : null}
                  {pipMessage ? <span className="text-xs text-neutral-300">{pipMessage}</span> : null}
                </>
              }
            />
          </div>
        </>
      )}
    </>
  ) : null;

  const bookmarkSection = selected ? (
    <>
      <div className="flex items-center gap-2 mt-2 text-xs">
        <button
          type="button"
          className="rounded border border-white/20 px-2 py-1 text-white"
          onClick={handleAddBookmark}
          title="Add bookmark at current time"
          aria-label="Add bookmark"
        >
          Add Bookmark
        </button>
        {bookmarks.length > 0 && (
          <span className="text-neutral-400" aria-live="polite">
            {bookmarks.length} saved
          </span>
        )}
      </div>
      {bookmarks.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 text-xs">
          {bookmarks.map(bookmark => (
            <div key={`${bookmark.time}-${bookmark.label}`} className="flex items-center gap-2">
              <button
                type="button"
                className="underline text-neutral-400 hover:text-white"
                onClick={() => handleSeekBookmark(bookmark.time)}
                title={`Seek to ${formatDuration(bookmark.time) || `${bookmark.time}s`}`}
              >
                {formatDuration(bookmark.time) || `${bookmark.time}s`}
              </button>
              <span className="text-neutral-400">{bookmark.label}</span>
              <button
                type="button"
                className="text-red-400"
                title="Delete bookmark"
                aria-label={`Delete bookmark at ${formatDuration(bookmark.time) || `${bookmark.time}s`}`}
                onClick={() => handleDeleteBookmark(bookmark.time)}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  ) : null;

  const videoFooter = (
    <>
      {unconfiguredNotice}
      {loading && <div>Loading recordings...</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {recordingSelector}
      {bookmarkSection}
    </>
  );

  const favoriteEntry = useMemo<FavoriteGameEntry>(() => {
    const tournamentSlug = boardSelection.tournamentSlug;
    const tournamentName = resolveTournamentName(tournamentSlug);
    const roundLabel = `Round ${boardSelection.round}`;
    const boardLabel = `Board ${boardSelection.round}.${boardSelection.board}`;
    const normalizedBoardId = buildBoardIdentifier(
      tournamentSlug,
      boardSelection.round,
      boardSelection.board
    );
    return {
      id: normalizedBoardId,
      tournamentSlug,
      tournamentName,
      round: boardSelection.round,
      roundLabel,
      boardId: normalizedBoardId,
      boardLabel,
      whitePlayer: whiteDisplayName,
      blackPlayer: blackDisplayName,
      fen: displayFen ?? null,
      pane: paneForFavorites,
      mode: "replay",
      updatedAt: 0,
    };
  }, [
    boardSelection.board,
    boardSelection.round,
    boardSelection.tournamentSlug,
    displayFen,
    paneForFavorites,
    whiteDisplayName,
    blackDisplayName,
  ]);

  const headerControls = (
    <div className={isMini ? "flex items-center gap-2" : "flex items-center gap-2"}>
      <FavoriteToggleButton entry={favoriteEntry} density={resolvedDensity} />
      <LiveHeaderControls
        boardId={boardId}
        tournamentSlug={boardSelection.tournamentSlug}
        maxRounds={MAX_ROUNDS}
        boardsPerRound={BOARDS_PER_ROUND}
        pane={paneParam}
        density={resolvedDensity}
      />
    </div>
  );

  return (
    <ViewerShell
      mode="replay"
      headerTitle={displayGameLabel}
      headerControls={headerControls}
      boardId={boardId}
      density={resolvedDensity}
      variant={viewerVariant}
      boardDomId="cv-replay-board"
      boardOrientation={orientation}
      boardPosition={displayFen}
      officialBoardPosition={boardPosition}
      onPieceDrop={handlePieceDrop}
      analysisViewActive={analysisViewActive}
      analysisBranches={analysisBranches}
      activeAnalysisAnchorPly={activeAnalysisAnchorPly}
      analysisCursorNodeId={analysisCursorNodeId}
      onExitAnalysisView={exitAnalysisView}
      onSelectAnalysisMove={selectAnalysisMove}
      onPromoteAnalysisNode={promoteAnalysisNode}
      onDeleteAnalysisLine={deleteAnalysisLine}
      onDeleteAnalysisFromHere={deleteAnalysisFromHere}
      showEval={gaugeEnabled}
      evaluation={evaluation}
      evaluationLabel={evaluationLabel}
      evaluationAdvantage={evaluationAdvantage}
      engineEnabled={analysisEnabled}
      engineThinking={effectiveEngineThinking}
      onToggleEval={() => setGaugeEnabled(prev => !prev)}
      onPrev={handlePrev}
      onLive={handleLive}
      onNext={handleNext}
      onFlip={handleFlip}
      canPrev={canPrev}
      canNext={canNext}
      liveActive={liveActive}
      boardResult={boardResult}
      boardStatus={boardStatus}
      replayRawPgn={replayRawPgn}
      players={{
        white: {
          name: whiteDisplayName,
          rating: whiteRating,
          countryCode: whiteCountryCode,
          flag: whiteFlag,
          title: whiteTitle,
          clockLabel: DEFAULT_PLAYER_CLOCK,
        },
        black: {
          name: blackDisplayName,
          rating: blackRating,
          countryCode: blackCountryCode,
          flag: blackFlag,
          title: blackTitle,
          clockLabel: DEFAULT_PLAYER_CLOCK,
        },
      }}
      tournamentHref={tournamentHref}
      tournamentLabel={tournamentLabel}
      boardSwitcherOptions={boardSwitcherOptions}
      currentBoardId={boardId}
      currentBoardLabel={currentBoardLabel}
      canonicalPath={replayPath}
      latestReplayPath={latestReplayPath}
      replayPath={replayPath}
      previousBoardHref={previousBoardHref}
      nextBoardHref={nextBoardHref}
      boardNumber={boardNumber}
      liveVersion={liveFeedVersion}
      videoPane={{
        containerRef: videoContainerRef,
        content: videoContent,
        secondaryPill: overlayLabel,
        footer: videoFooter,
      }}
      notation={{
        engineOn: analysisEnabled,
        setEngineOn: setAnalysisEnabled,
        engineEval: effectiveEngineEval,
        engineLines: effectiveEngineLines,
        engineProfileId: activeProfileId,
        engineProfile: activeProfileConfig,
        setEngineProfileId: handleProfileChange,
        engineError: effectiveEngineError,
        multiPv,
        depthIndex,
        depthSteps,
        targetDepth,
        setMultiPv,
        setDepthIndex: handleDepthChange,
        fen: engineDisplayFen,
        engineName: ENGINE_DISPLAY_NAME,
        engineBackend: "cloud",
        setEngineBackend: undefined,
        plies,
        currentMoveIndex,
        onMoveSelect: handleNotationPlySelect,
        notationCenterRequestToken,
      }}
    />
  );
}

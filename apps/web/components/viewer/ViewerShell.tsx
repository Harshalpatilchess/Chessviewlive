"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Info, LayoutGrid, Search, Share2, X } from "lucide-react";
import BoardControls from "@/components/live/BoardControls";
import MainEvalBar from "@/components/live/MainEvalBar";
import RightPaneTabs from "@/components/live/RightPaneTabs";
import type { BoardSwitcherOption } from "@/components/tournament/BoardSwitcher";
import AnimatedBoardPane from "@/components/viewer/AnimatedBoardPane";
import BroadcastIdentityBar from "@/components/viewer/BroadcastIdentityBar";
import BroadcastReactBoard from "@/components/viewer/BroadcastReactBoard";
import DeferredReplayBoardsGrid from "@/components/boards/DeferredReplayBoardsGrid";
import type { BoardNavigationEntry, BoardNavigationPlayer } from "@/lib/boards/navigationTypes";
import {
  flushLatestClockCache,
  isReplayClockSource,
  readLatestClock,
  type LatestClockSource,
  writeLatestClock,
} from "@/lib/boards/latestClockCache";
import type { Ply } from "@/lib/chess/pgn";
import { buildBoardIdentifier, normalizeBoardIdentifier } from "@/lib/boardId";
import { getBroadcastTournament } from "@/lib/broadcasts/catalog";
import { isTimeTrouble } from "@/lib/live/clockFormat";
import { isPlaceholderPlayerName } from "@/lib/live/playerNormalization";
import { getTournamentBoardsForRound, getTournamentGameManifest } from "@/lib/tournamentManifest";
import type { GameResult, GameStatus } from "@/lib/tournamentManifest";
import type { StockfishEval, StockfishLine } from "@/lib/engine/useStockfishEvaluation";
import type { EngineBackend, EngineProfileConfig, EngineProfileId } from "@/lib/engine/config";
import type { EvaluationAdvantage } from "@/lib/engine/evalMapping";

type Orientation = "white" | "black";

type ScoreVariant = "winner" | "loser" | "draw" | "neutral";

type PlayerCardProps = {
  name: string;
  rating?: number | string | null;
  countryCode?: string | null;
  flag?: string | null;
  title?: string | null;
  nameSource?: string | null;
  missingReason?: string | null;
  missingData?: boolean;
  clockLabel: string;
  clockMs?: number | null;
  clockIncrementMs?: number | null;
  score?: string;
  scoreVariant?: ScoreVariant;
};

type VideoPaneProps = {
  containerRef?: RefObject<HTMLDivElement | null>;
  innerRef?: RefObject<HTMLDivElement | null>;
  content?: ReactNode;
  statusPill?: { label: string; className: string };
  secondaryPill?: string | null;
  overlay?: ReactNode;
  controlsOverlay?: ReactNode;
  footer?: ReactNode;
};

type NotationProps = {
  engineOn: boolean;
  setEngineOn: (next: boolean | ((prev: boolean) => boolean)) => void;
  plies: Ply[];
  currentMoveIndex: number;
  onMoveSelect: (idx: number) => void;
  notationCenterRequestToken?: number;
  engineEval?: StockfishEval;
  engineLines?: StockfishLine[];
  engineName?: string;
  engineBackend?: EngineBackend;
  engineError?: string | null;
  setEngineBackend?: (backend: EngineBackend) => void;
  multiPv?: number;
  depthIndex?: number;
  depthSteps?: number[];
  targetDepth?: number;
  setMultiPv?: (value: number) => void;
  setDepthIndex?: (value: number) => void;
  fen?: string | null;
  engineProfileId?: EngineProfileId;
  engineProfile?: EngineProfileConfig;
  setEngineProfileId?: (value: EngineProfileId) => void;
};

const normalizeResult = (result?: GameResult | null): GameResult => {
  if (!result || result === "*") return "·";
  return result === "1/2-1/2" ? "½-½" : result;
};

const derivePlayerPoints = (
  result?: GameResult | null,
  status?: GameStatus | null
): {
  white: { score: string; variant: ScoreVariant };
  black: { score: string; variant: ScoreVariant };
} => {
  const normalized = normalizeResult(result);
  const isFinal = status === "final";

  if (isFinal && normalized === "1-0") {
    return {
      white: { score: "1", variant: "winner" },
      black: { score: "0", variant: "loser" },
    };
  }
  if (isFinal && normalized === "0-1") {
    return {
      white: { score: "0", variant: "loser" },
      black: { score: "1", variant: "winner" },
    };
  }
  if (isFinal && normalized === "½-½") {
    return {
      white: { score: "½", variant: "draw" },
      black: { score: "½", variant: "draw" },
    };
  }

  return {
    white: { score: "0", variant: "neutral" },
    black: { score: "0", variant: "neutral" },
  };
};

const normalizeFen = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const OFFICIAL_SOURCE_UNAVAILABLE_LABEL = "Official source unavailable";
const CLOCK_LOW_SECONDS = 120;

const toTrimmedString = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseClockLabelSeconds = (label?: string | null) => {
  if (!label) return null;
  const cleaned = label.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(":").map(part => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some(part => part.length === 0 || !/^\d+$/.test(part))) return null;
  const numeric = parts.map(part => Number(part));
  if (numeric.some(value => !Number.isFinite(value))) return null;
  if (numeric.length === 2) {
    return numeric[0] * 60 + numeric[1];
  }
  return numeric[0] * 3600 + numeric[1] * 60 + numeric[2];
};

const resolveClockSeconds = (label: string, clockMs?: number | null) => {
  if (Number.isFinite(clockMs ?? NaN)) {
    return Math.max(0, Math.floor((clockMs as number) / 1000));
  }
  return parseClockLabelSeconds(label);
};

const toBoardPlayerRating = (value?: number | string | null): number | undefined => {
  const numeric = Number(value ?? NaN);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.trunc(numeric);
};

const toBoardPlayerFromViewer = (player: PlayerCardProps): BoardNavigationPlayer => {
  const candidateName = toTrimmedString(player.name);
  const shouldShowUnavailableName =
    Boolean(player.missingData) ||
    !candidateName ||
    isPlaceholderPlayerName(candidateName) ||
    candidateName.toLowerCase() === "unknown";
  const name = shouldShowUnavailableName ? OFFICIAL_SOURCE_UNAVAILABLE_LABEL : candidateName;
  return {
    name: name ?? OFFICIAL_SOURCE_UNAVAILABLE_LABEL,
    title: toTrimmedString(player.title),
    rating: toBoardPlayerRating(player.rating),
    flag: toTrimmedString(player.flag) ?? undefined,
    federation: toTrimmedString(player.countryCode) ?? undefined,
    nameSource: toTrimmedString(player.nameSource) ?? undefined,
    missingReason: toTrimmedString(player.missingReason) ?? undefined,
    missingData: Boolean(player.missingData),
  };
};

const BOARD_SCAN_LIMIT = 20;
const DESKTOP_VIEWER_MAX_WIDTH_CLASS = "max-w-[1520px]";
const DESKTOP_LAYOUT_COLUMNS_CLASS = "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]";
const DESKTOP_MEDIA_CONTAINER_CLASS =
  "aspect-video w-full lg:w-[85%] mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm";

type ViewerShellProps = {
  mode: "live" | "replay";
  headerTitle: string;
  headerControls?: ReactNode;
  boardId: string;
  boardDomId?: string;
  boardOrientation: Orientation;
  boardPosition: string;
  officialBoardPosition: string;
  onPieceDrop?: (sourceSquare: string, targetSquare: string, piece: string) => boolean;
  analysisViewActive?: boolean;
  analysisBranches?: Array<{
    anchorPly: number;
    anchorFullmoveNumber: number;
    anchorTurn: "w" | "b";
    startFen: string;
    rootChildren: string[];
    rootMainChildId: string | null;
    nodesById: Record<
      string,
      {
        id: string;
        san: string;
        fenAfter: string;
        parentId: string | null;
        children: string[];
        mainChildId: string | null;
      }
    >;
  }> | null;
  activeAnalysisAnchorPly?: number | null;
  analysisCursorNodeId?: string | null;
  onExitAnalysisView?: () => void;
  onSelectAnalysisMove?: (anchorPly: number, nodeId: string | null) => void;
  onPromoteAnalysisNode?: (anchorPly: number, nodeId: string) => void;
  onDeleteAnalysisLine?: (anchorPly: number, nodeId: string) => void;
  onDeleteAnalysisFromHere?: (anchorPly: number, nodeId: string) => void;
  showEval: boolean;
  evaluation?: number | null;
  evaluationLabel?: string | null;
  evaluationAdvantage?: EvaluationAdvantage;
  engineEnabled?: boolean;
  engineThinking?: boolean;
  onToggleEval?: () => void;
  onPrev: () => void;
  onLive: () => void;
  onNext: () => void;
  onFlip: () => void;
  canPrev: boolean;
  canNext: boolean;
  liveActive: boolean;
  boardResult?: GameResult | null;
  boardStatus?: GameStatus | null;
  players: {
    white: PlayerCardProps;
    black: PlayerCardProps;
  };
  tournamentHref?: string | null;
  tournamentLabel?: string | null;
  boardSwitcherOptions?: BoardSwitcherOption[] | null;
  currentBoardId?: string;
  currentBoardLabel?: string;
  canonicalPath?: string | null;
  latestReplayPath?: string | null;
  replayPath?: string | null;
  previousBoardHref?: string | null;
  nextBoardHref?: string | null;
  boardNumber?: number | null;
  videoPane: VideoPaneProps;
  notation: NotationProps;
  mediaContainerClass?: string;
  mainClassName?: string;
  contentClassName?: string;
  density?: "default" | "compact";
  variant?: "full" | "mini";
  statsOverlay?: ReactNode;
  liveVersion?: number;
  onBoardSelect?: (board: BoardNavigationEntry) => boolean | void;
  replayRawPgn?: string | null;
};

export function ViewerShell({
  mode,
  headerTitle,
  headerControls,
  boardId,
  boardDomId = boardId,
  boardOrientation,
  boardPosition,
  officialBoardPosition,
  onPieceDrop,
  analysisViewActive = false,
  analysisBranches,
  activeAnalysisAnchorPly,
  analysisCursorNodeId,
  onExitAnalysisView,
  onSelectAnalysisMove,
  onPromoteAnalysisNode,
  onDeleteAnalysisLine,
  onDeleteAnalysisFromHere,
  showEval,
  evaluation,
  evaluationLabel,
  evaluationAdvantage,
  engineEnabled: _engineEnabled = true,
  engineThinking: _engineThinking = false,
  onToggleEval,
  onPrev,
  onLive,
  onNext,
  onFlip,
  canPrev,
  canNext,
  liveActive,
  boardResult,
  boardStatus,
  players,
  tournamentLabel,
  boardNumber,
  videoPane,
  notation,
  mediaContainerClass,
  mainClassName,
  contentClassName,
  density,
  variant = "full",
  statsOverlay,
  liveVersion = 0,
  onBoardSelect,
  replayRawPgn = null,
}: ViewerShellProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMini = variant === "mini";
  const resolvedDensity = density ?? (isMini ? "compact" : "default");
  const isCompact = resolvedDensity === "compact";
  const boardFallbackSize = isMini ? 320 : 520;
  const miniGutterWidth = isCompact ? 20 : 22;
  const miniGapPx = isCompact ? 6 : 8;
  const [miniBoardSize, setMiniBoardSize] = useState<number>(boardFallbackSize);
  const miniBoardContainerRef = useRef<HTMLDivElement | null>(null);
  const upsellParam = searchParams?.get("upsell");
  const debugQueryEnabled = searchParams?.get("debug") === "1";
  const returnToParam = searchParams?.get("returnTo");
  const sanitizedReturnTo = useMemo(() => {
    if (!returnToParam) return "/";
    const trimmed = returnToParam.trim();
    if (!trimmed.startsWith("/")) return "/";
    return trimmed;
  }, [returnToParam]);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [replayInfoOpen, setReplayInfoOpen] = useState(false);
  const [replayShareOpen, setReplayShareOpen] = useState(false);
  const [replaySearchMode, setReplaySearchMode] = useState(false);
  const [replaySearchQuery, setReplaySearchQuery] = useState("");
  const [shareGameUrl, setShareGameUrl] = useState("");
  const [copyFeedbackByAction, setCopyFeedbackByAction] = useState<Record<string, "copied" | "failed">>({});
  const copyFeedbackTimeoutsRef = useRef<Record<string, number>>({});
  const resolvedMainClassName =
    mainClassName ??
    (isCompact
      ? `flex h-full min-h-0 flex-col bg-transparent text-slate-100 overflow-hidden${
          isMini ? " w-full min-w-0" : ""
        }`
      : "flex min-h-screen flex-col bg-slate-950 text-slate-100 overflow-x-hidden");
  const resolvedContentClassName =
    contentClassName ??
    (isCompact
      ? `mx-auto flex-1 w-full min-h-0 px-2 py-2${isMini ? " min-w-0" : ""}`
      : `mx-auto flex-1 w-full ${DESKTOP_VIEWER_MAX_WIDTH_CLASS} px-3 py-1 lg:px-4 lg:py-1`);
  const resolvedMediaContainerClass =
    mediaContainerClass ??
    (isMini
      ? "relative aspect-video w-full lg:w-[85%] mx-auto max-w-[720px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm"
      : isCompact
        ? "aspect-video w-full lg:w-[85%] mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm"
        : DESKTOP_MEDIA_CONTAINER_CLASS);
  const { white, black } = players;
  const normalizedBoardResult = normalizeResult(boardResult);
  const playerPoints = derivePlayerPoints(normalizedBoardResult, boardStatus ?? null);
  const normalizedDisplayedFen = useMemo(() => normalizeFen(boardPosition), [boardPosition]);
  const normalizedOfficialFen = useMemo(() => normalizeFen(officialBoardPosition), [officialBoardPosition]);
  const statusPill = videoPane.statusPill ?? null;
  const isWhiteAtBottom = boardOrientation === "white";
  const topPlayer = isWhiteAtBottom ? black : white;
  const bottomPlayer = isWhiteAtBottom ? white : black;
  const topPoints = isWhiteAtBottom ? playerPoints.black : playerPoints.white;
  const bottomPoints = isWhiteAtBottom ? playerPoints.white : playerPoints.black;
  const normalizedEvalLabel = evaluationLabel ?? "-";
  const normalizedAdvantage = evaluationAdvantage ?? "equal";
  const analysisDisplayed =
    normalizedDisplayedFen !== null &&
    normalizedOfficialFen !== null &&
    normalizedDisplayedFen !== normalizedOfficialFen;
  const isViewingOfficialLivePosition = liveActive && !analysisDisplayed;
  const gameIsRealtimeLive = mode === "live" && boardStatus === "live";
  const liveButtonNeutral = !gameIsRealtimeLive || isViewingOfficialLivePosition;
  const emptyBoardNavLogRef = useRef<string | null>(null);
  const clockSourceLogRef = useRef(false);
  const handleUpsellClose = useCallback(() => {
    setUpsellOpen(false);
    router.replace(sanitizedReturnTo);
  }, [router, sanitizedReturnTo]);
  const handleReplayInfoClose = useCallback(() => {
    setReplayInfoOpen(false);
  }, []);
  const handleReplayShareClose = useCallback(() => {
    setReplayShareOpen(false);
  }, []);
  const openReplaySearchMode = useCallback(() => {
    setReplaySearchMode(true);
  }, []);
  const closeReplaySearchMode = useCallback(() => {
    setReplaySearchMode(false);
    setReplaySearchQuery("");
  }, []);
  const handleReplayBoardsJump = useCallback(() => {
    if (typeof document === "undefined") return;
    document.getElementById("viewer-more-boards")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const setCopyFeedback = useCallback((key: string, status: "copied" | "failed") => {
    setCopyFeedbackByAction(prev => ({ ...prev, [key]: status }));
    const existingTimeout = copyFeedbackTimeoutsRef.current[key];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }
    copyFeedbackTimeoutsRef.current[key] = window.setTimeout(() => {
      setCopyFeedbackByAction(prev => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      delete copyFeedbackTimeoutsRef.current[key];
    }, 1400);
  }, []);
  const copyTextWithFeedback = useCallback(
    async (feedbackKey: string, text: string) => {
      if (typeof window === "undefined") return false;
      let success = false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(text);
          success = true;
        }
      } catch (err) {
        console.info("[viewer-shell] clipboard_write_failed", err);
      }
      if (!success) {
        try {
          if (typeof window.prompt === "function") {
            const promptResult = window.prompt("Copy text", text);
            success = promptResult !== null;
          }
        } catch (err) {
          console.info("[viewer-shell] prompt_failed", err);
        }
      }
      setCopyFeedback(feedbackKey, success ? "copied" : "failed");
      return success;
    },
    [setCopyFeedback]
  );
  const handleDownloadPgn = useCallback(() => {
    if (typeof window === "undefined") return;
    const normalizedPgn = typeof replayRawPgn === "string" ? replayRawPgn.trim() : "";
    if (!normalizedPgn) return;
    const safeBoardId = boardId.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "game";
    const blob = new Blob([`${normalizedPgn}\n`], { type: "application/x-chess-pgn;charset=utf-8" });
    const href = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${safeBoardId}.pgn`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(href);
  }, [boardId, replayRawPgn]);
  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(copyFeedbackTimeoutsRef.current)) {
        window.clearTimeout(timeoutId);
      }
      copyFeedbackTimeoutsRef.current = {};
    };
  }, []);
  useEffect(() => {
    if (!replayInfoOpen && !replayShareOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setReplayInfoOpen(false);
      setReplayShareOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [replayInfoOpen, replayShareOpen]);
  useEffect(() => {
    if (!replaySearchMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeReplaySearchMode();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeReplaySearchMode, replaySearchMode]);
  useEffect(() => {
    if (!replayShareOpen) {
      setShareGameUrl("");
      return;
    }
    if (typeof window === "undefined") return;
    setShareGameUrl(window.location.href);
  }, [replayShareOpen]);
  const showBroadcastCues = isMini;
  const activeColor = boardPosition.trim().split(/\s+/)[1];
  const toMoveColor =
    activeColor === "w" ? "white" : activeColor === "b" ? "black" : null;
  const topRowColor = isWhiteAtBottom ? "black" : "white";
  const bottomRowColor = isWhiteAtBottom ? "white" : "black";
  const renderPlayerRow = (
    player: PlayerCardProps,
    points: { score: string; variant: ScoreVariant },
    options?: {
      showAnalysis?: boolean;
      rowColor?: "white" | "black";
      isToMove?: boolean;
      boardPlayer?: BoardNavigationPlayer | null;
      debugFlagProbe?: boolean;
    }
  ) => {
    void points.variant;
    const showMissingData = Boolean(debugQueryEnabled && player.missingData);
    const clockSeconds = resolveClockSeconds(player.clockLabel, player.clockMs);
    const clockMsForUrgency = Number.isFinite(player.clockMs ?? NaN)
      ? Math.max(0, Number(player.clockMs))
      : typeof clockSeconds === "number"
        ? clockSeconds * 1000
        : null;
    const clockInTimeTrouble = isTimeTrouble(clockMsForUrgency, {
      enabled: true,
      timeTroubleMs: CLOCK_LOW_SECONDS * 1000,
    });
    const incrementSeconds = Number.isFinite(player.clockIncrementMs ?? NaN)
      ? Math.round((player.clockIncrementMs as number) / 1000)
      : null;
    const incrementLabel = incrementSeconds && incrementSeconds > 0 ? `+${incrementSeconds}` : null;
    const baseClockLabel = toTrimmedString(player.clockLabel) ?? "—";
    const stripClockLabel = incrementLabel && baseClockLabel !== "—" ? `${baseClockLabel} ${incrementLabel}` : baseClockLabel;
    const rowPlayer = options?.boardPlayer ?? toBoardPlayerFromViewer(player);
    const rowColor = options?.rowColor ?? "white";
    return (
      <BroadcastIdentityBar
        player={rowPlayer}
        scorePill={points.score}
        clockLabel={stripClockLabel}
        hasClock={baseClockLabel !== "—" || clockMsForUrgency !== null}
        isTimeTrouble={clockInTimeTrouble}
        showAnalysis={Boolean(options?.showAnalysis)}
        showBroadcastCues={showBroadcastCues}
        isToMove={Boolean(options?.isToMove)}
        rowColor={rowColor}
        showMissingData={showMissingData}
        debugFlagProbe={Boolean(options?.debugFlagProbe)}
      />
    );
  };

  useEffect(() => {
    if (isMini) {
      setUpsellOpen(false);
      return;
    }
    setUpsellOpen(upsellParam === "1");
  }, [isMini, upsellParam]);

  useEffect(() => {
    if (!upsellOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleUpsellClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleUpsellClose, upsellOpen]);

  const boardIdentifier = useMemo(() => normalizeBoardIdentifier(boardId), [boardId]);

  const boardNavigation = useMemo(() => {
    const { normalizedBoardId, parsed } = boardIdentifier;
    const inferredFeedClockSource: LatestClockSource =
      mode === "replay"
        ? "replay_input"
        : getBroadcastTournament(parsed.tournamentSlug)
          ? "broadcast_payload"
          : "live_payload";
    const boardNumbers =
      getTournamentBoardsForRound(parsed.tournamentSlug, parsed.round) ??
      Array.from({ length: BOARD_SCAN_LIMIT }, (_, idx) => idx + 1);

    const fromFeed = boardNumbers
      .map(boardNum => {
        const game = getTournamentGameManifest(parsed.tournamentSlug, parsed.round, boardNum);
        if (!game) return null;
        const boardEntryId = buildBoardIdentifier(parsed.tournamentSlug, parsed.round, boardNum);
        const clockKeyInput = {
          boardId: boardEntryId,
          tournamentSlug: parsed.tournamentSlug,
          round: parsed.round,
          boardNumber: boardNum,
        };
        const cachedClock = readLatestClock(clockKeyInput);
        const trustedCachedClock =
          mode === "replay"
            ? cachedClock && isReplayClockSource(cachedClock.source)
              ? cachedClock
              : null
            : cachedClock && cachedClock.source === inferredFeedClockSource
              ? cachedClock
              : null;
        const feedWhiteTimeMs = Number.isFinite(Number(game.whiteTimeMs ?? NaN))
          ? Math.max(0, Math.floor(Number(game.whiteTimeMs)))
          : null;
        const feedBlackTimeMs = Number.isFinite(Number(game.blackTimeMs ?? NaN))
          ? Math.max(0, Math.floor(Number(game.blackTimeMs)))
          : null;
        const resolvedWhiteTimeMs = feedWhiteTimeMs ?? trustedCachedClock?.whiteTimeMs ?? null;
        const resolvedBlackTimeMs = feedBlackTimeMs ?? trustedCachedClock?.blackTimeMs ?? null;
        if (Number.isFinite(feedWhiteTimeMs ?? NaN) || Number.isFinite(feedBlackTimeMs ?? NaN)) {
          writeLatestClock(clockKeyInput, {
            whiteTimeMs: feedWhiteTimeMs,
            blackTimeMs: feedBlackTimeMs,
            source: inferredFeedClockSource,
          });
        }
        const normalizedResult = normalizeResult(game.result);
        const normalizedStatus: GameStatus =
          game.status ??
          (normalizedResult && normalizedResult !== "·" ? "final" : "live");
        return {
          boardId: boardEntryId,
          boardNumber: boardNum,
          result: normalizedResult,
          status: normalizedStatus,
          whiteTimeMs: resolvedWhiteTimeMs,
          blackTimeMs: resolvedBlackTimeMs,
          clockUpdatedAtMs: game.clockUpdatedAtMs ?? null,
          sideToMove: game.sideToMove ?? null,
          previewFen: game.previewFen ?? null,
          finalFen: game.finalFen ?? null,
          moveList: game.moveList ?? null,
          evaluation: game.evaluation ?? null,
          white: {
            name: game.white,
            title: game.whiteTitle,
            rating: game.whiteRating,
            flag: game.whiteFlag,
            country: game.whiteCountry,
            federation: game.whiteCountry,
          },
          black: {
            name: game.black,
            title: game.blackTitle,
            rating: game.blackRating,
            flag: game.blackFlag,
            country: game.blackCountry,
            federation: game.blackCountry,
          },
        } as BoardNavigationEntry;
      })
      .filter((entry): entry is BoardNavigationEntry => Boolean(entry));

    const debug = {
      incomingBoardId: boardId,
      normalizedBoardId,
      tournamentKey: parsed.tournamentSlug,
      roundKey: String(parsed.round),
      feedCount: fromFeed.length,
    };

    if (fromFeed.length > 0) {
      return { boards: fromFeed, normalizedBoardId, source: "feed" as const, debug };
    }

    const fromManifestFallback: BoardNavigationEntry[] = boardNumbers.map(boardNum => ({
      boardId: buildBoardIdentifier(parsed.tournamentSlug, parsed.round, boardNum),
      boardNumber: boardNum,
      status: "unknown",
      result: null,
      evaluation: null,
      whiteTimeMs: null,
      blackTimeMs: null,
      sideToMove: null,
      finalFen: null,
      moveList: null,
      white: { name: OFFICIAL_SOURCE_UNAVAILABLE_LABEL, title: null },
      black: { name: OFFICIAL_SOURCE_UNAVAILABLE_LABEL, title: null },
    }));

    return {
      boards: fromManifestFallback,
      normalizedBoardId,
      source: "manifest" as const,
      debug: { ...debug, manifestCount: fromManifestFallback.length },
    };
  }, [boardId, boardIdentifier, liveVersion, mode]);
  const currentBoardEntry = useMemo(
    () =>
      boardNavigation.boards.find(entry => entry.boardId === boardNavigation.normalizedBoardId) ?? null,
    [boardNavigation.boards, boardNavigation.normalizedBoardId]
  );
  const topBoardPlayer = isWhiteAtBottom ? currentBoardEntry?.black ?? null : currentBoardEntry?.white ?? null;
  const bottomBoardPlayer = isWhiteAtBottom ? currentBoardEntry?.white ?? null : currentBoardEntry?.black ?? null;

  useEffect(() => {
    flushLatestClockCache();
  }, [boardNavigation]);

  useEffect(() => {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
    if (!debugQueryEnabled || clockSourceLogRef.current) return;
    const sample = boardNavigation.boards[0];
    if (!sample) return;
    const inferredFeedClockSource: LatestClockSource =
      mode === "replay"
        ? "replay_input"
        : getBroadcastTournament(boardIdentifier.parsed.tournamentSlug)
          ? "broadcast_payload"
          : "live_payload";
    const cachedClock = readLatestClock({
      boardId: sample.boardId,
      tournamentSlug: boardIdentifier.parsed.tournamentSlug,
      round: boardIdentifier.parsed.round,
      boardNumber: sample.boardNumber,
    });
    const hasClockData =
      Number.isFinite(Number(sample.whiteTimeMs ?? NaN)) || Number.isFinite(Number(sample.blackTimeMs ?? NaN));
    const source = hasClockData ? cachedClock?.source ?? inferredFeedClockSource : "unavailable";
    console.info("[mini-clock-source]", {
      boardId: sample.boardId,
      mode,
      source,
      hasClockData,
    });
    clockSourceLogRef.current = true;
  }, [boardIdentifier, boardNavigation.boards, debugQueryEnabled, mode]);

  useEffect(() => {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
    if (!boardNavigation || boardNavigation.boards.length > 0) return;
    const debug = boardNavigation.debug;
    const marker = `${debug.incomingBoardId}|${debug.normalizedBoardId}|${debug.tournamentKey}|${debug.roundKey}`;
    if (emptyBoardNavLogRef.current === marker) return;
    emptyBoardNavLogRef.current = marker;
    console.warn("[boards-navigation] empty boards list", {
      incomingBoardId: debug.incomingBoardId,
      normalizedBoardId: debug.normalizedBoardId,
      tournamentKey: debug.tournamentKey,
      roundKey: debug.roundKey,
      source: boardNavigation.source,
      feedCount: debug.feedCount,
      manifestCount: "manifestCount" in debug ? debug.manifestCount : undefined,
    });
  }, [boardNavigation]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleFlipHotkey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key !== "f" && event.key !== "F") return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      onFlip();
    };
    window.addEventListener("keydown", handleFlipHotkey, { capture: true });
    return () => window.removeEventListener("keydown", handleFlipHotkey, { capture: true } as AddEventListenerOptions);
  }, [onFlip]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!analysisViewActive) return;

      if (mode === "live") {
        onLive();
        return;
      }

      onExitAnalysisView?.();
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () =>
      window.removeEventListener(
        "keydown",
        handleEscape,
        { capture: true } as AddEventListenerOptions
      );
  }, [analysisViewActive, mode, onExitAnalysisView, onLive]);

  useEffect(() => {
    if (!isMini) return;
    const container = miniBoardContainerRef.current;
    if (!container) return;

    const update = () => {
      const rect = container.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return;
      if (rect.width <= 0 || rect.height <= 0) return;
      const containerPadding = 8;
      const boardPadding = 4;
      const availableWidth = rect.width - containerPadding * 2;
      const availableHeight = rect.height - containerPadding * 2;
      if (availableWidth <= 0 || availableHeight <= 0) return;
      const maxBoardWidth = availableWidth - miniGutterWidth - miniGapPx;
      if (maxBoardWidth <= 0) return;
      const nextSize = Math.floor(Math.min(maxBoardWidth, availableHeight) - boardPadding);
      if (!Number.isFinite(nextSize) || nextSize <= 0) return;
      setMiniBoardSize(prev => (prev === nextSize ? prev : nextSize));
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(() => update());
    observer.observe(container);
    return () => observer.disconnect();
  }, [isMini, miniGapPx, miniGutterWidth]);

  const isDesktopFixedRightPane = !isMini;
  const desktopViewerHeightClass = "";
  const layoutClassName = `flex flex-1 min-h-0 flex-col lg:grid lg:h-full lg:items-stretch ${DESKTOP_LAYOUT_COLUMNS_CLASS} ${desktopViewerHeightClass} ${
    isCompact ? "gap-1 sm:gap-1.5 lg:gap-x-1 lg:gap-y-1" : "gap-1 sm:gap-1.5 lg:gap-x-1 lg:gap-y-1"
  }`;
  const topViewerBlockClassName = "flex min-h-0 flex-col lg:h-[100dvh] lg:max-h-[100dvh] lg:overflow-hidden";
  const boardSectionClassName = `flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden border border-white/10 bg-slate-950/80 shadow-xl ring-1 ring-white/5 lg:h-full ${
    isCompact ? "gap-0.5 rounded-2xl p-1.5" : "gap-0.5 rounded-3xl px-0.5 py-1.5 sm:px-1 sm:py-2"
  }`;
  const boardShellClassName = `flex min-h-0 flex-1 flex-col border border-slate-800/70 bg-slate-950/80 shadow-inner ${
    isCompact ? "gap-1 rounded-2xl p-1.5" : "gap-1 rounded-3xl px-0 py-1.5 sm:px-0.5 sm:py-2"
  }`;
  const boardStackClassName = isCompact
    ? "flex min-h-0 flex-1 flex-col gap-1.5"
    : "flex min-h-0 flex-1 flex-col gap-1.5 sm:gap-2";
  const boardRowClassName = isCompact
    ? "grid w-full min-h-0 flex-1 items-stretch gap-0 md:gap-x-2.5 md:justify-center grid-cols-[minmax(0,1fr)_0] md:grid-cols-[auto_18px]"
    : "grid w-full min-h-0 flex-1 items-stretch gap-0 md:gap-x-2.5 md:justify-center grid-cols-[minmax(0,1fr)_0] md:grid-cols-[auto_20px]";
  const boardSizerClassName = isMini
    ? "relative min-w-0 flex-1"
    : "relative min-h-0 min-w-0 flex-1 w-full md:h-full md:w-auto md:aspect-square md:max-w-full";
  const evalBarGutterClassName = "flex h-full self-stretch min-h-0 items-stretch justify-center md:justify-start";
  const miniBoardRowClassName = isCompact
    ? "grid min-h-0 items-stretch gap-1.5 grid-cols-[20px_minmax(0,1fr)]"
    : "grid min-h-0 items-stretch gap-2 grid-cols-[22px_minmax(0,1fr)]";
  const miniBoardFrameStyle = isMini
    ? { width: miniBoardSize + miniGutterWidth + miniGapPx, height: miniBoardSize }
    : undefined;
  const miniLayoutClassName =
    "grid min-h-0 w-full flex-1 min-w-0 grid-cols-[280px_minmax(480px,1.25fr)_minmax(0,2fr)] gap-3";
  const miniLeftColumnClassName = "flex min-h-0 w-full flex-col min-w-0 max-w-[280px]";
  const boardAutoSizeMode = "contain";
  const boardContainerClassName = isMini
    ? "flex h-full min-h-0 w-full items-center justify-center"
    : "flex h-full min-h-0 w-full items-stretch justify-start [&>div]:mx-0";
  const rightColumnClassName = isMini
    ? "flex min-h-0 w-full flex-1 min-w-0 flex-col overflow-hidden gap-1.5 rounded-2xl border border-white/10 bg-slate-950/80 p-1.5 lg:flex-[1]"
    : `flex w-full min-w-0 flex-col gap-4 sm:gap-5 lg:gap-5 lg:pt-3 ${isDesktopFixedRightPane ? "h-full min-h-0 overflow-hidden" : "overflow-visible"}`;
  const tabsCardClassName = isMini
    ? "min-h-0 flex-1"
    : "flex h-full min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-slate-900/35 p-0.5 shadow-[0_10px_28px_rgba(0,0,0,0.25)]";
  const videoStackClassName = isMini
    ? "flex min-h-0 flex-none flex-col gap-1.5"
    : `flex w-full flex-none flex-col`;
  const videoContainerClassName = isMini
    ? resolvedMediaContainerClass
    : `${resolvedMediaContainerClass} relative flex-none lg:rounded-b-none lg:border-b-0`;
  const videoFooterClassName = isMini ? "flex-none pt-1" : "flex-none";

  const headerNode = (
    <header
      className={`flex items-center justify-between border border-white/10 bg-slate-900/70 ${
        isCompact
          ? isMini
            ? "rounded-xl px-2.5 py-1.5"
            : "rounded-xl px-3 py-2"
          : isMini
            ? "rounded-2xl px-4 py-2.5"
            : "rounded-2xl px-4 py-2.5"
      }`}
    >
      <h2 className={`${isCompact ? "text-base" : "text-lg"} font-semibold text-white`}>
        {headerTitle}
      </h2>
      {headerControls ? <div className="flex items-center gap-2">{headerControls}</div> : null}
    </header>
  );

  const livePlayerDebugNode =
    debugQueryEnabled && mode === "live" ? (
      <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-[10px] font-semibold text-slate-300">
        <span>
          boardId {boardId} | white nameSource {white.nameSource ?? "unknown"}
          {white.missingData ? ` | white missingReason ${white.missingReason ?? "missing white name field"}` : ""}
          {" | "}black nameSource {black.nameSource ?? "unknown"}
          {black.missingData ? ` | black missingReason ${black.missingReason ?? "missing black name field"}` : ""}
        </span>
      </div>
    ) : null;

  const playerRowsNode = (
    <div className={isMini ? "flex flex-col gap-3" : isCompact ? "flex flex-col gap-2" : "flex flex-col gap-2.5"}>
      {renderPlayerRow(topPlayer, topPoints, {
        showAnalysis: analysisDisplayed,
        rowColor: topRowColor,
        isToMove: toMoveColor === topRowColor,
        boardPlayer: topBoardPlayer,
        debugFlagProbe: debugQueryEnabled,
      })}
      {renderPlayerRow(bottomPlayer, bottomPoints, {
        rowColor: bottomRowColor,
        isToMove: toMoveColor === bottomRowColor,
        boardPlayer: bottomBoardPlayer,
        debugFlagProbe: false,
      })}
    </div>
  );

  const boardControlsNode = (
    <BoardControls
      onPrev={onPrev}
      onLive={onLive}
      onNext={onNext}
      onFlip={onFlip}
      showEval={showEval}
      toggleEval={onToggleEval ?? (() => {})}
      canPrev={canPrev}
      canNext={canNext}
      liveActive={liveButtonNeutral}
      density={resolvedDensity}
    />
  );

  const boardNode = (
    <BroadcastReactBoard
      boardId={boardDomId}
      boardOrientation={boardOrientation}
      position={boardPosition}
      draggable={Boolean(onPieceDrop)}
      onPieceDrop={onPieceDrop}
      showNotation
      sizePx={isMini ? miniBoardSize : undefined}
      autoSize={!isMini}
      autoSizeMode={boardAutoSizeMode}
      fallbackSize={boardFallbackSize}
      containerClassName={boardContainerClassName}
    />
  );

  const videoStackNode = (
    <div className={videoStackClassName}>
      <div ref={videoPane.containerRef} className={videoContainerClassName}>
        {videoPane.content ?? (
          <div ref={videoPane.innerRef} className="absolute inset-0 h-full w-full" />
        )}
        {statusPill && (
          <div
            className={`pointer-events-none absolute left-3 top-3 rounded-full border border-white/20 font-semibold uppercase text-white ${statusPill.className} ${
              isCompact ? "px-2 py-0.5 text-[9px] tracking-[0.16em]" : "px-3 py-1 text-[10px] tracking-[0.2em]"
            }`}
          >
            {statusPill.label}
          </div>
        )}
        {videoPane.secondaryPill && (
          <div
            className={`pointer-events-none absolute right-3 top-3 rounded-full border border-white/20 bg-black/50 font-semibold uppercase text-white ${
              isCompact ? "px-2 py-0.5 text-[9px] tracking-[0.16em]" : "px-3 py-1 text-[10px] tracking-wide"
            }`}
          >
            {videoPane.secondaryPill}
          </div>
        )}
        {videoPane.overlay}
        {videoPane.controlsOverlay}
      </div>
      {videoPane.footer ? <div className={videoFooterClassName}>{videoPane.footer}</div> : null}
    </div>
  );

  const tabsStickyClassName = isMini
    ? "flex min-h-0 flex-1 flex-col overflow-hidden"
    : isDesktopFixedRightPane
      ? "flex w-full min-h-0 flex-1 flex-col overflow-hidden"
      : "flex min-h-0 flex-1 flex-col lg:sticky lg:top-4 lg:self-start";
  const tabsNode = (
    <div className={`${tabsCardClassName}`}>
      <div className={tabsStickyClassName}>
      <RightPaneTabs
        engineOn={notation.engineOn}
        setEngineOn={notation.setEngineOn}
        plies={notation.plies}
        currentMoveIndex={notation.currentMoveIndex}
        onMoveSelect={notation.onMoveSelect}
        notationCenterRequestToken={notation.notationCenterRequestToken}
        engineEval={notation.engineEval}
        engineLines={notation.engineLines}
        engineName={notation.engineName}
        engineBackend={notation.engineBackend}
        engineError={notation.engineError}
        setEngineBackend={notation.setEngineBackend}
        multiPv={notation.multiPv}
        depthIndex={notation.depthIndex}
        depthSteps={notation.depthSteps}
        targetDepth={notation.targetDepth}
        setMultiPv={notation.setMultiPv}
        setDepthIndex={notation.setDepthIndex}
        engineProfileId={notation.engineProfileId}
        engineProfile={notation.engineProfile}
        setEngineProfileId={notation.setEngineProfileId}
        fen={notation.fen}
        analysisViewActive={analysisViewActive}
        analysisBranches={analysisBranches}
        activeAnalysisAnchorPly={activeAnalysisAnchorPly}
        analysisCursorNodeId={analysisCursorNodeId}
        onExitAnalysisView={onExitAnalysisView}
        onSelectAnalysisMove={onSelectAnalysisMove}
        onPromoteAnalysisNode={onPromoteAnalysisNode}
        onDeleteAnalysisLine={onDeleteAnalysisLine}
        onDeleteAnalysisFromHere={onDeleteAnalysisFromHere}
        boardNavigation={boardNavigation.boards}
        currentBoardId={boardNavigation.normalizedBoardId}
        onBoardSelect={onBoardSelect}
        density={resolvedDensity}
        variant={variant}
        mode={mode}
      />
      </div>
    </div>
  );

  const upsellModalNode = upsellOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={handleUpsellClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-slate-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upsell-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="upsell-title" className="text-base font-semibold text-white">
            Subscribe to get the best viewing experience
          </h2>
          <button
            type="button"
            onClick={handleUpsellClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:border-white/30 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleUpsellClose}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:text-white"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => router.push("/subscribe")}
            className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-4 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-500/25"
          >
            Subscribe
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const replayInfoRows = [
    { label: "Board ID", value: boardId },
    { label: "Game", value: headerTitle },
    { label: "White", value: white.name },
    { label: "Black", value: black.name },
    { label: "Event", value: tournamentLabel ?? null },
    { label: "Round", value: Number.isFinite(boardNumber ?? NaN) ? String(boardNumber) : null },
    { label: "Status", value: boardStatus ?? null },
    { label: "Result", value: normalizedBoardResult !== "·" ? normalizedBoardResult : null },
  ].filter(row => typeof row.value === "string" && row.value.trim().length > 0);
  const boardIdText = boardId.trim();
  const gameTitleText = headerTitle.trim() || null;
  const whiteNameText = white.name.trim();
  const blackNameText = black.name.trim();
  const playersText = whiteNameText && blackNameText ? `${whiteNameText} vs ${blackNameText}` : null;
  const replayPgnText = typeof replayRawPgn === "string" && replayRawPgn.trim().length > 0 ? replayRawPgn.trim() : null;
  const embedSnippet = shareGameUrl
    ? `<iframe src="${shareGameUrl}" style="width:100%;aspect-ratio:16/9" loading="lazy"></iframe>`
    : "";
  const replayInfoActions = [
    { key: "info-board-id", label: "Copy Board ID", value: boardIdText },
    { key: "info-title", label: "Copy Game Title", value: gameTitleText },
    { key: "info-players", label: "Copy Players", value: playersText },
  ].filter(action => typeof action.value === "string" && action.value.trim().length > 0);
  const replayActionRow = !isMini && (mode === "replay" || mode === "live") ? (
    <section className="flex-none border border-white/10 bg-slate-950/70 px-2.5 py-2 sm:px-3 lg:rounded-none lg:border-x lg:border-b">
      {replaySearchMode ? (
        <div className="flex items-stretch gap-2">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Search className="h-4 w-4 flex-none text-slate-300" aria-hidden />
            <input
              type="text"
              value={replaySearchQuery}
              onChange={event => setReplaySearchQuery(event.target.value)}
              autoFocus
              placeholder="Search player names"
              className="h-full w-full min-w-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none"
              aria-label="Search player names"
            />
          </div>
          <button
            type="button"
            onClick={closeReplaySearchMode}
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] text-slate-200 transition-colors duration-150 hover:border-white/35 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950/70"
            aria-label="Close replay search"
            title="Close search"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="flex items-stretch gap-2">
          <div className="grid h-11 flex-1 grid-cols-[1fr_2fr_1fr] divide-x divide-white/10 overflow-hidden rounded-xl border border-white/15 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <button
              type="button"
              onClick={() => setReplayInfoOpen(true)}
              className="inline-flex h-full w-full items-center justify-center gap-1.5 px-2 text-slate-200 transition-colors duration-150 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
              aria-label="Open game info"
              title="Game info"
            >
              <Info className="h-4 w-4" aria-hidden />
              <span className="hidden text-xs font-medium tracking-wide text-slate-200 sm:inline">Info</span>
            </button>
            <button
              type="button"
              onClick={handleReplayBoardsJump}
              className="inline-flex h-full w-full items-center justify-center gap-1.5 border-x border-white/10 bg-white/[0.08] px-2 text-slate-50 transition-colors duration-150 hover:bg-white/[0.14] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
              aria-label="Jump to more boards"
              title="More boards"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden />
              <span className="hidden text-xs font-semibold tracking-wide text-slate-50 sm:inline">Boards</span>
            </button>
            <button
              type="button"
              onClick={() => setReplayShareOpen(true)}
              className="inline-flex h-full w-full items-center justify-center gap-1.5 px-2 text-slate-200 transition-colors duration-150 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
              aria-label="Open share and export options"
              title="Share and export"
            >
              <Share2 className="h-4 w-4" aria-hidden />
              <span className="hidden text-xs font-medium tracking-wide text-slate-200 sm:inline">Share</span>
            </button>
          </div>
          <button
            type="button"
            onClick={openReplaySearchMode}
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] text-slate-200 transition-colors duration-150 hover:border-white/35 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950/70"
            aria-label="Open replay board search"
            title="Search"
          >
            <Search className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </section>
  ) : null;
  const rightPanelNode = (
    <aside className={rightColumnClassName}>
      {videoStackNode}
      {tabsNode}
    </aside>
  );
  const replayInfoModalNode = replayInfoOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={handleReplayInfoClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-slate-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replay-info-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="replay-info-title" className="text-base font-semibold text-white">
            Game info
          </h2>
          <button
            type="button"
            onClick={handleReplayInfoClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:border-white/30 hover:text-white"
            aria-label="Close game info"
          >
            ✕
          </button>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          {replayInfoRows.map(row => (
            <div key={row.label} className="grid grid-cols-[84px_1fr] gap-2">
              <dt className="text-slate-400">{row.label}</dt>
              <dd className="break-words text-slate-100">{row.value}</dd>
            </div>
          ))}
        </dl>
        {replayInfoActions.length > 0 ? (
          <section className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">Actions</h3>
            <div className="mt-2 space-y-2">
              {replayInfoActions.map(action => (
                <div key={action.key} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300">{action.label}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void copyTextWithFeedback(action.key, action.value as string);
                      }}
                      className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                      aria-label={action.label}
                    >
                      Copy
                    </button>
                    <span className="w-10 text-right text-[11px] text-emerald-300" aria-live="polite">
                      {copyFeedbackByAction[action.key] === "copied"
                        ? "Copied"
                        : copyFeedbackByAction[action.key] === "failed"
                          ? "Failed"
                          : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  ) : null;
  const replayShareModalNode = replayShareOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={handleReplayShareClose}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-slate-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replay-share-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="replay-share-title" className="text-base font-semibold text-white">
            Share &amp; export
          </h2>
          <button
            type="button"
            onClick={handleReplayShareClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:border-white/30 hover:text-white"
            aria-label="Close share and export"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Game URL</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!shareGameUrl) return;
                    void copyTextWithFeedback("share-url", shareGameUrl);
                  }}
                  disabled={!shareGameUrl}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Copy game URL"
                >
                  Copy
                </button>
                <span className="w-10 text-right text-[11px] text-emerald-300" aria-live="polite">
                  {copyFeedbackByAction["share-url"] === "copied"
                    ? "Copied"
                    : copyFeedbackByAction["share-url"] === "failed"
                      ? "Failed"
                      : ""}
                </span>
              </div>
            </div>
            <p className="mt-2 break-all rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-slate-200">
              {shareGameUrl || "Loading URL..."}
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Embed snippet</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!embedSnippet) return;
                    void copyTextWithFeedback("share-embed", embedSnippet);
                  }}
                  disabled={!embedSnippet}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Copy embed snippet"
                >
                  Copy
                </button>
                <span className="w-10 text-right text-[11px] text-emerald-300" aria-live="polite">
                  {copyFeedbackByAction["share-embed"] === "copied"
                    ? "Copied"
                    : copyFeedbackByAction["share-embed"] === "failed"
                      ? "Failed"
                      : ""}
                </span>
              </div>
            </div>
            <p className="mt-2 break-all rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-slate-200">
              {embedSnippet || "Loading snippet..."}
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Board ID</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!boardIdText) return;
                    void copyTextWithFeedback("share-board-id", boardIdText);
                  }}
                  disabled={!boardIdText}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Copy board ID"
                >
                  Copy
                </button>
                <span className="w-10 text-right text-[11px] text-emerald-300" aria-live="polite">
                  {copyFeedbackByAction["share-board-id"] === "copied"
                    ? "Copied"
                    : copyFeedbackByAction["share-board-id"] === "failed"
                      ? "Failed"
                      : ""}
                </span>
              </div>
            </div>
            <p className="mt-2 break-all rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-slate-200">
              {boardIdText}
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">PGN export</p>
              {replayPgnText ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void copyTextWithFeedback("share-pgn", replayPgnText);
                    }}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    aria-label="Copy PGN"
                  >
                    Copy PGN
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPgn}
                    className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
                    aria-label="Download PGN"
                  >
                    Download PGN
                  </button>
                  <span className="w-10 text-right text-[11px] text-emerald-300" aria-live="polite">
                    {copyFeedbackByAction["share-pgn"] === "copied"
                      ? "Copied"
                      : copyFeedbackByAction["share-pgn"] === "failed"
                        ? "Failed"
                        : ""}
                  </span>
                </div>
              ) : (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400">
                  PGN unavailable
                </span>
              )}
            </div>
            {replayPgnText ? (
              <p className="mt-2 text-[11px] text-slate-400">
                Raw PGN available for this board.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">
                PGN export is not available in the current replay data for this board.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  ) : null;
  if (isMini) {
    return (
      <>
        <main className={resolvedMainClassName}>
          <div className={`${resolvedContentClassName} flex flex-col min-h-0`}>
            <div className={miniLayoutClassName}>
              <section className={miniLeftColumnClassName}>
                <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/80 p-1.5 shadow-xl ring-1 ring-white/5">
                  {headerNode}
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex min-h-0 flex-1 flex-col justify-center">
                      {playerRowsNode}
                    </div>
                    <div className="pt-2">{boardControlsNode}</div>
                  </div>
                </div>
              </section>

              <section className="flex min-h-0 flex-col min-w-0">
                <div
                  ref={miniBoardContainerRef}
                  className="flex min-h-0 flex-1 items-center justify-center rounded-3xl border border-white/10 bg-slate-950/80 p-2 shadow-xl ring-1 ring-white/5"
                >
                  <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                    <div className={miniBoardRowClassName} style={miniBoardFrameStyle}>
                      <div className={evalBarGutterClassName}>
                        <div className="relative h-full min-h-0 self-stretch [&>div]:h-full [&>div]:min-h-0 [&>div]:self-stretch">
                          <MainEvalBar
                            show={showEval}
                            forceMount
                            value={evaluation ?? null}
                            label={normalizedEvalLabel}
                            advantage={normalizedAdvantage}
                            orientation={boardOrientation}
                            density={resolvedDensity}
                            variant={variant}
                          />
                        </div>
                      </div>
                      <div className={boardSizerClassName}>
                        <AnimatedBoardPane boardKey={boardId}>{boardNode}</AnimatedBoardPane>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {rightPanelNode}
            </div>
          </div>
        </main>
        {statsOverlay}
        {upsellModalNode}
        {replayShareModalNode}
      </>
    );
  }

  return (
    <>
      <main className={resolvedMainClassName}>
        <div className={`${resolvedContentClassName} flex flex-col min-h-0`}>
          <div className={topViewerBlockClassName}>
            <div className={layoutClassName}>
              <section className={boardSectionClassName}>
                <div className="shrink-0">{headerNode}</div>
                {livePlayerDebugNode ? <div className="shrink-0">{livePlayerDebugNode}</div> : null}

                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex min-h-0 flex-1 flex-col [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col">
                  <AnimatedBoardPane boardKey={boardId}>
                    <div className={boardShellClassName}>
                        <div className={boardStackClassName}>
                        <div className="shrink-0">
                        {renderPlayerRow(topPlayer, topPoints, {
                          showAnalysis: analysisDisplayed,
                          rowColor: topRowColor,
                          isToMove: toMoveColor === topRowColor,
                          boardPlayer: topBoardPlayer,
                          debugFlagProbe: debugQueryEnabled,
                        })}
                        </div>

                        <div className={boardRowClassName}>
                          <div className={boardSizerClassName}>{boardNode}</div>
                          <div className={evalBarGutterClassName}>
                            <div className="relative h-full min-h-0 self-stretch [&>div]:h-full [&>div]:min-h-0 [&>div]:self-stretch">
                              <MainEvalBar
                                show={showEval}
                                forceMount
                                value={evaluation ?? null}
                                label={normalizedEvalLabel}
                                advantage={normalizedAdvantage}
                                orientation={boardOrientation}
                                density={resolvedDensity}
                                variant={variant}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0">
                        {renderPlayerRow(bottomPlayer, bottomPoints, {
                          rowColor: bottomRowColor,
                          isToMove: toMoveColor === bottomRowColor,
                          boardPlayer: bottomBoardPlayer,
                          debugFlagProbe: false,
                        })}
                        </div>
                        </div>

                      <div className={isCompact ? "shrink-0 pt-0" : "shrink-0 pt-0.5"}>
                        {boardControlsNode}
                      </div>
                    </div>
                  </AnimatedBoardPane>
                  </div>
                </div>
              </section>

              {rightPanelNode}
            </div>
          </div>
          <section id="viewer-more-boards" className="mt-6" style={{ overflowAnchor: "none" }}>
            {replayActionRow}
            <DeferredReplayBoardsGrid
              boards={boardNavigation.boards}
              tournamentSlug={boardIdentifier.parsed.tournamentSlug}
              selectedBoardId={boardNavigation.normalizedBoardId}
              mode={mode}
              filterQuery={replaySearchMode ? replaySearchQuery : ""}
              searchActive={replaySearchMode}
            />
          </section>
        </div>
      </main>
      {statsOverlay}
      {upsellModalNode}
      {replayInfoModalNode}
      {replayShareModalNode}
    </>
  );
}

export default ViewerShell;

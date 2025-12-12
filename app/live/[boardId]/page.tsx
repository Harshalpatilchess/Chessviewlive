"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { VideoQuality } from "livekit-client";
import { RotateCcw } from "lucide-react";
import type {
  ConnectionQuality,
  Participant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  Track,
  TrackPublication,
} from "livekit-client";
import LiveHeader from "@/components/viewer/LiveHeader";
import PlayerStrip from "@/components/viewer/PlayerStrip";
import LiveHeaderControls from "@/components/viewer/LiveHeaderControls";
import ViewerShell from "@/components/viewer/ViewerShell";
import { DEFAULT_TOURNAMENT_SLUG, buildBoardIdentifier, parseBoardIdentifier } from "@/lib/boardId";
import { formatBoardContextLabel, formatBoardLabel } from "@/lib/boardContext";
import { WORLD_CUP_DEMO_PLIES, pliesFromPgn } from "@/lib/mockGames";
import { pliesToFenAt } from "@/lib/chess/pgn";
import { buildBoardPaths } from "@/lib/paths";
import { mapEvaluationToBar, type EvaluationBarMapping } from "@/lib/engine/evalMapping";
import { CURRENT_ENGINE_CONFIG, type EngineProfileId } from "@/lib/engine/config";
import useCloudEngineEvaluation from "@/lib/engine/useCloudEngineEvaluation";
import useStockfishEvaluation from "@/lib/engine/useStockfishEvaluation";
import useTournamentLiveFeed from "@/lib/live/useTournamentLiveFeed";
import {
  getBoardPlayers,
  getTournamentBoardIds,
} from "@/lib/tournamentBoards";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import type { GameResult, GameStatus } from "@/lib/tournamentManifest";
import YouTubeControlsBar from "@/components/video/YouTubeControlsBar";

const RECONNECT_MAX_ATTEMPTS = 6;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_FACTOR = 2;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_JITTER_RATIO = 0.2;
const MAX_ROUNDS = 9;
const BOARDS_PER_ROUND = 20;

type QualityLevel = "excellent" | "good" | "poor" | "lost" | "unknown";

type LKQualityInput =
  | ConnectionQuality
  | QualityLevel
  | string
  | number
  | { toString: () => string }
  | null
  | undefined;

type RoomWithEngine = Room & {
  engine?: {
    pcManager?: {
      subscriber?: {
        getStats?: () => Promise<RTCStatsReport>;
      };
    };
  };
};

type NavigatorWithMediaSession = Navigator & { mediaSession?: MediaSession };

type RouteParams = {
  boardId: string;
  tournamentId?: string;
};

type Orientation = "white" | "black";

const DEFAULT_PLAYER_CLOCK = "01:23:45";
const DEMO_WHITE_PLAYER = { name: "Magnus Carlsen", rating: 2830, country: "NOR", flag: "🇳🇴" };
const DEMO_BLACK_PLAYER = { name: "Gukesh D", rating: 2750, country: "IND", flag: "🇮🇳" };
const DEMO_TOURNAMENT_LABEL = "FIDE World Cup 2025";

const formatPlayerName = (name: string | null | undefined, fallback: string) => {
  if (!name) return fallback;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeManifestResult = (result?: GameResult | null): GameResult | null => {
  if (!result || result === "*") return null;
  return result === "1/2-1/2" ? "½-½" : result;
};

export default function LiveBoardPage(props: { params: Promise<RouteParams> }) {
  const { boardId, tournamentId } = use(props.params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const autoplayParam = searchParams?.get("autoplay");
  const mutedParam = searchParams?.get("muted");
  const autoretryRaw = searchParams?.get("autoretry");
  const shouldAutoplay = autoplayParam === "1" || autoplayParam === "true";
  const shouldStartMuted = mutedParam === "1" || mutedParam === "true";
  const autoRetryEnabled =
    autoretryRaw === null || autoretryRaw === undefined
      ? true
      : !["0", "false"].includes(autoretryRaw.toLowerCase());
  const embedParam = searchParams?.get("embed");
  const isEmbed =
    embedParam === "1" || (typeof embedParam === "string" && embedParam.toLowerCase() === "true");
  const debugParam = searchParams?.get("debug");
  const allowStatsOverlay =
    (typeof debugParam === "string" && debugParam.toLowerCase() === "1") ||
    (typeof process !== "undefined" && process.env.ALLOW_DEV_STATS_OVERLAY === "true");
  const paneParam = useMemo(() => {
    const pane = searchParams?.get("pane");
    return pane === "boards" || pane === "live" || pane === "notation" ? pane : "notation";
  }, [searchParams]);
  const enginePanelOpen = paneParam === "notation";
  const mainClassName = isEmbed
    ? "flex min-h-screen h-screen flex-col bg-slate-950 text-slate-100 overflow-hidden p-0"
    : "container mx-auto flex min-h-screen h-screen flex-col bg-slate-950 text-slate-100 overflow-hidden px-4";
  const mediaContainerClass = isEmbed
    ? "aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm"
    : "aspect-video w-full max-h-[40vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm lg:aspect-[16/8.5] lg:max-h-[48vh]";
  const controlsOverlayClass =
    "pointer-events-none absolute bottom-3 right-3 flex flex-wrap items-center justify-end gap-1.5 sm:bottom-4 sm:right-4 sm:gap-2";
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [isLive, setIsLive] = useState(false);
  const [manualRetryPending, setManualRetryPending] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const mediaWrapperRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [isPip, setIsPip] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const autoRetryEnabledRef = useRef(autoRetryEnabled);
  const reconnectAttemptRef = useRef(0);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const manualDisconnectRef = useRef(false);
  const connectingRef = useRef(false);
  const stoppedRef = useRef(false);
  const connectRoomRef = useRef<null | ((fromRetry?: boolean) => Promise<void>)>(null);
  const lastMutedRef = useRef<boolean | null>(null);
  const pipMessageTimeoutRef = useRef<number | null>(null);
  const [pipMessage, setPipMessage] = useState<string | null>(null);
  const [embedCopied, setEmbedCopied] = useState(false);
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
  const whiteClockLabel = DEFAULT_PLAYER_CLOCK;
  const blackClockLabel = DEFAULT_PLAYER_CLOCK;
  const liveStatus = (() => {
    if (status === "connecting" || status === "idle" || connectingRef.current) {
      return { label: "CONNECTING…", className: "bg-amber-500/90 text-white" };
    }
    if (status === "connected" && isLive) {
      return { label: "LIVE", className: "bg-red-600 text-white" };
    }
    return { label: "OFFLINE", className: "bg-neutral-500/80 text-white" };
  })();
  const tournamentLabel = useMemo(() => {
    const trimmed = tournamentId?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }, [tournamentId]);
  const tournamentHref = useMemo(() => {
    if (!tournamentLabel) return null;
    return `/t/${encodeURIComponent(tournamentLabel)}`;
  }, [tournamentLabel]);
  const isHealthyLive = status === "connected" && isLive;
  const canonicalPath = useMemo(() => {
    const encodedBoard = encodeURIComponent(boardId);
    if (tournamentId && tournamentId.trim().length > 0) {
      return `/t/${encodeURIComponent(tournamentId.trim())}/live/${encodedBoard}`;
    }
    return `/live/${encodedBoard}`;
  }, [boardId, tournamentId]);
  const replayPath = useMemo(() => {
    const encodedBoard = encodeURIComponent(boardId);
    if (tournamentId && tournamentId.trim().length > 0) {
      return `/t/${encodeURIComponent(tournamentId.trim())}/replay/${encodedBoard}`;
    }
    return `/replay/${encodedBoard}`;
  }, [boardId, tournamentId]);
  const latestReplayPath = useMemo(() => {
    if (!replayPath) return null;
    return `${replayPath}?latest=1`;
  }, [replayPath]);
  const replayOverlayHref = latestReplayPath ?? replayPath ?? `/replay/${boardId}`;
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
  const showReplayOverlay = !isLive && Boolean(replayOverlayHref);
  const boardNavBase = useMemo(() => {
    if (!tournamentHref) return null;
    return `${tournamentHref}/live`;
  }, [tournamentHref]);
  const lastKnownStatusRef = useRef<GameStatus | null | undefined>(boardStatus);
  const pendingReplayRedirectRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const previousStatus = lastKnownStatusRef.current;
    const hasReplayData = Boolean(boardManifestGame?.moveList?.length);
    if (previousStatus === "live" && boardStatus === "final") {
      pendingReplayRedirectRef.current = true;
    }
    if (pendingReplayRedirectRef.current && boardStatus === "final" && hasReplayData && replayPath) {
      pendingReplayRedirectRef.current = false;
      router.replace(replayPath);
    }
    lastKnownStatusRef.current = boardStatus;
  }, [boardStatus, boardManifestGame?.moveList?.length, replayPath, router]);
  const previousBoardHref = useMemo(() => {
    if (!boardNavBase || boardSelection.board <= 1) return null;
    const prevBoardId = buildBoardIdentifier(
      boardSelection.tournamentSlug,
      boardSelection.round,
      boardSelection.board - 1
    );
    return `${boardNavBase}/${prevBoardId}`;
  }, [boardNavBase, boardSelection]);
  const nextBoardHref = useMemo(() => {
    if (!boardNavBase || boardSelection.board >= BOARDS_PER_ROUND) return null;
    const nextBoardId = buildBoardIdentifier(
      boardSelection.tournamentSlug,
      boardSelection.round,
      boardSelection.board + 1
    );
    return `${boardNavBase}/${nextBoardId}`;
  }, [boardNavBase, boardSelection]);
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
        href: paths.live,
        players,
      };
    });
  }, [tournamentId, tournamentBoardIds]);
  const isTournamentBoardConfigured = useMemo(() => {
    if (!tournamentId) return true;
    if (!tournamentBoardIds || tournamentBoardIds.length === 0) return false;
    const normalized = boardId.trim().toLowerCase();
    return tournamentBoardIds.some(id => id.trim().toLowerCase() === normalized);
  }, [tournamentBoardIds, tournamentId, boardId]);
  const currentBoardLabel = useMemo(() => formatBoardLabel(boardId), [boardId]);
  const videoRoomLabel = overlayLabel ?? currentBoardLabel;
  const plies = useMemo(() => {
    if (boardSelection.tournamentSlug === "worldcup" && boardSelection.round === 1) {
      const pgn = getWorldCupPgnForBoard(boardSelection.board);
      const parsed = pliesFromPgn(pgn);
      if (parsed.length) {
        return parsed;
      }
      console.warn("[worldcup] Falling back to demo plies for board", {
        boardNumber: boardSelection.board,
        boardId,
      });
    }
    return WORLD_CUP_DEMO_PLIES;
  }, [boardId, boardSelection.board, boardSelection.round, boardSelection.tournamentSlug]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(() =>
    plies.length ? plies.length - 1 : -1
  );

  useEffect(() => {
    if (!plies.length) {
      setCurrentMoveIndex(-1);
      return;
    }
    setCurrentMoveIndex(plies.length - 1);
  }, [plies.length]);
  const [engineEnabled, setEngineEnabled] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>("white");
  const [gaugeEnabled, setGaugeEnabled] = useState(true);
  const liveIndex = plies.length - 1;
  const canPrev = currentMoveIndex > -1;
  const canNext = liveIndex >= 0 && currentMoveIndex < liveIndex;
  const liveActive = liveIndex >= 0 && currentMoveIndex === liveIndex;
  const boardPosition = useMemo(() => {
    if (boardStatus === "final" && boardManifestGame?.finalFen) {
      return boardManifestGame.finalFen;
    }
    return pliesToFenAt(plies, currentMoveIndex);
  }, [boardManifestGame?.finalFen, boardStatus, currentMoveIndex, plies]);

  const useEngineEvaluation =
    CURRENT_ENGINE_CONFIG.activeBackend === "cloud" ? useCloudEngineEvaluation : useStockfishEvaluation;
  const {
    eval: engineEval,
    bestLines: engineLines,
    isEvaluating: engineThinking,
    engineName,
    engineBackend,
    setEngineBackend,
    activeProfileId,
    activeProfileConfig,
    multiPv,
    targetDepth,
    depthIndex,
    depthSteps,
    setDepthIndex,
    setMultiPv,
    setActiveProfileId,
  } = useEngineEvaluation(
    boardPosition,
    {
      enabled: engineEnabled,
    }
  );
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
  const { value: evaluation, label: evaluationLabel, advantage: evaluationAdvantage } = useMemo<EvaluationBarMapping>(() => {
    if (!gaugeEnabled) {
      return { value: null, label: null, advantage: null };
    }
    return mapEvaluationToBar(engineEval, boardPosition, { enabled: engineEnabled });
  }, [boardPosition, engineEnabled, engineEval, gaugeEnabled]);
  const handlePrev = useCallback(() => {
    setCurrentMoveIndex(prev => Math.max(-1, prev - 1));
  }, []);
  const handleNext = useCallback(() => {
    if (liveIndex < 0) return;
    setCurrentMoveIndex(prev => Math.min(liveIndex, prev + 1));
  }, [liveIndex]);
  const handleLive = () => {
    if (liveIndex < 0) return;
    setCurrentMoveIndex(liveIndex);
  };
  const handleFlip = () => setOrientation(prev => (prev === "white" ? "black" : "white"));
  const toggleEval = () => setGaugeEnabled(prev => !prev);
  const handleNotationPlySelect = useCallback(
    (plyIdx: number) => {
      if (!Number.isFinite(plyIdx)) return;
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
    [liveIndex]
  );
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        handleNext();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        handlePrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleNext, handlePrev]);
  useEffect(() => {
    const ply = currentMoveIndex >= 0 ? plies[currentMoveIndex] : null;
    console.log("[LiveBoard] currentMoveIndex", {
      currentMoveIndex,
      moveNumber: ply ? ply.moveNo : null,
      color: ply?.color,
      san: ply?.san,
      boardPosition,
    });
  }, [currentMoveIndex, plies, boardPosition]);
  useEffect(() => {
    console.log("[LiveBoard] orientation", orientation);
  }, [orientation]);
  const displayGameLabel = DEMO_TOURNAMENT_LABEL;
  const embedCopiedTimeoutRef = useRef<number | null>(null);
  const lowBandwidthKey = `cv:lowbw:live:${boardId}`;
  const [manualLowBandwidth, setManualLowBandwidth] = useState<boolean>(false);
  const manualLowBandwidthRef = useRef(manualLowBandwidth);
  const autoLowBandwidthRef = useRef(false);
  const [lowBandwidthActive, setLowBandwidthActive] = useState(manualLowBandwidth);
  const lowBandwidthActiveRef = useRef(lowBandwidthActive);
  const poorQualityTimeoutRef = useRef<number | null>(null);
  const qualityRecoveryTimeoutRef = useRef<number | null>(null);
  const lowBitrateTimeoutRef = useRef<number | null>(null);
  const bitrateRecoveryTimeoutRef = useRef<number | null>(null);
  const downlinkStatsIntervalRef = useRef<number | null>(null);
  const prevDownlinkStatsRef = useRef<
    Record<string, { bytesReceived: number; timestamp: number; packetsLost: number; packetsReceived: number }>
  >({});
  const downlinkKbpsRef = useRef<number | null>(null);
  const downlinkPacketLossRef = useRef<number | null>(null);
  const connectionQualityHandlerRef = useRef<
    ((quality: ConnectionQuality, participant: Participant) => void) | null
  >(null);
  const [isOffline, setIsOffline] = useState(false);
  const isOfflineRef = useRef(isOffline);
  const shouldShowManualRetry = useMemo(() => {
    if (isHealthyLive || status === "connecting") return false;
    return reconnectAttempt >= RECONNECT_MAX_ATTEMPTS || status === "error" || isOffline;
  }, [isHealthyLive, status, reconnectAttempt, isOffline]);
  const [debugStats, setDebugStats] = useState<{
    bitrateKbps: number | null;
    packetLossPct: number | null;
    rttMs: number | null;
    quality: QualityLevel;
  }>({
    bitrateKbps: null,
    packetLossPct: null,
    rttMs: null,
    quality: "unknown",
  });

  useEffect(() => {
    autoRetryEnabledRef.current = autoRetryEnabled;
  }, [autoRetryEnabled]);

  useEffect(() => {
    manualLowBandwidthRef.current = manualLowBandwidth;
  }, [manualLowBandwidth]);

  useEffect(() => {
    lowBandwidthActiveRef.current = lowBandwidthActive;
  }, [lowBandwidthActive]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (manualLowBandwidth) {
        localStorage.setItem(lowBandwidthKey, "1");
      } else {
        localStorage.removeItem(lowBandwidthKey);
      }
    } catch {
      // ignore storage errors
    }
  }, [manualLowBandwidth, lowBandwidthKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(lowBandwidthKey) === "1";
      setManualLowBandwidth(saved);
    } catch {
      // ignore storage errors
    }
  }, [lowBandwidthKey]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsOffline(!navigator.onLine);
  }, []);

  useEffect(() => {
    isOfflineRef.current = isOffline;
  }, [isOffline]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      if (typeof window !== "undefined") {
        window.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = null;
    }
  }, []);

  const resetReconnectState = useCallback(() => {
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    clearReconnectTimer();
  }, [clearReconnectTimer]);

  const cleanupMediaElements = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      lastMutedRef.current = video.muted;
    }
    if (mediaRef.current) {
      mediaRef.current.innerHTML = "";
    }
    videoRef.current = null;
    setVideoEl(null);
  }, []);

  const applyLowBandwidth = useCallback(
    (active: boolean) => {
      const room = roomRef.current;
      if (!room) return;
      room.remoteParticipants.forEach(participant => {
        participant.trackPublications.forEach((publication: TrackPublication) => {
          if (!publication || publication.kind !== "video") return;
          const videoPub = publication as RemoteTrackPublication;
          try {
            if (typeof videoPub.setVideoQuality === "function") {
              videoPub.setVideoQuality(active ? VideoQuality.LOW : VideoQuality.HIGH);
            }
            if (typeof videoPub.setVideoDimensions === "function") {
              videoPub.setVideoDimensions(
                active ? { width: 640, height: 360 } : { width: 1280, height: 720 }
              );
            }
          } catch (err) {
            console.info("[live] low_bandwidth_apply_failed", err);
          }
        });
      });
    },
    []
  );

  const updateLowBandwidthActive = useCallback(() => {
    const next = manualLowBandwidthRef.current || autoLowBandwidthRef.current;
    lowBandwidthActiveRef.current = next;
    setLowBandwidthActive(next);
    applyLowBandwidth(next);
  }, [applyLowBandwidth]);

  const startAutoLowBandwidth = useCallback(
    (reason: string) => {
      if (manualLowBandwidthRef.current || isOfflineRef.current || autoLowBandwidthRef.current) {
        return;
      }
      autoLowBandwidthRef.current = true;
      console.info("[live] low_bw_auto_on", { reason });
      updateLowBandwidthActive();
    },
    [updateLowBandwidthActive]
  );

  const stopAutoLowBandwidth = useCallback(
    (reason: string) => {
      if (!autoLowBandwidthRef.current) return;
      autoLowBandwidthRef.current = false;
      if (manualLowBandwidthRef.current) {
        console.info("[live] low_bw_auto_off_skipped_manual", { reason });
        return;
      }
      console.info("[live] low_bw_auto_off", { reason });
      updateLowBandwidthActive();
    },
    [updateLowBandwidthActive]
  );

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null && typeof window !== "undefined") {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const clearLowBandwidthTimers = useCallback(() => {
    clearTimer(poorQualityTimeoutRef);
    clearTimer(qualityRecoveryTimeoutRef);
    clearTimer(lowBitrateTimeoutRef);
    clearTimer(bitrateRecoveryTimeoutRef);
  }, []);

  const stopDownlinkStats = useCallback(() => {
    if (downlinkStatsIntervalRef.current !== null && typeof window !== "undefined") {
      window.clearInterval(downlinkStatsIntervalRef.current);
      downlinkStatsIntervalRef.current = null;
    }
    downlinkKbpsRef.current = null;
    downlinkPacketLossRef.current = null;
  }, []);

  const scheduleQualityDegrade = useCallback(() => {
    if (manualLowBandwidthRef.current || isOfflineRef.current) return;
    clearTimer(qualityRecoveryTimeoutRef);
    if (poorQualityTimeoutRef.current !== null) return;
    if (typeof window === "undefined") return;
    poorQualityTimeoutRef.current = window.setTimeout(() => {
      poorQualityTimeoutRef.current = null;
      startAutoLowBandwidth("quality");
    }, 5000);
  }, [startAutoLowBandwidth]);

  const scheduleQualityRecovery = useCallback(() => {
    clearTimer(poorQualityTimeoutRef);
    if (!autoLowBandwidthRef.current || manualLowBandwidthRef.current) return;
    if (qualityRecoveryTimeoutRef.current !== null || typeof window === "undefined") return;
    qualityRecoveryTimeoutRef.current = window.setTimeout(() => {
      qualityRecoveryTimeoutRef.current = null;
      stopAutoLowBandwidth("quality");
    }, 10000);
  }, [stopAutoLowBandwidth]);

  const scheduleBitrateDegrade = useCallback(() => {
    if (manualLowBandwidthRef.current || isOfflineRef.current) return;
    clearTimer(bitrateRecoveryTimeoutRef);
    if (lowBitrateTimeoutRef.current !== null || typeof window === "undefined") return;
    lowBitrateTimeoutRef.current = window.setTimeout(() => {
      lowBitrateTimeoutRef.current = null;
      startAutoLowBandwidth("bitrate");
    }, 5000);
  }, [startAutoLowBandwidth]);

  const scheduleBitrateRecovery = useCallback(() => {
    clearTimer(lowBitrateTimeoutRef);
    if (!autoLowBandwidthRef.current || manualLowBandwidthRef.current) return;
    if (bitrateRecoveryTimeoutRef.current !== null || typeof window === "undefined") return;
    bitrateRecoveryTimeoutRef.current = window.setTimeout(() => {
      bitrateRecoveryTimeoutRef.current = null;
      stopAutoLowBandwidth("bitrate");
    }, 10000);
  }, [stopAutoLowBandwidth]);

  const mapLKQualityValue = useCallback(
    (quality?: LKQualityInput): QualityLevel => {
      if (quality === null || quality === undefined) {
        return "unknown";
      }
      if (typeof quality === "string") {
        const normalized = quality.toLowerCase();
        if (
          normalized === "excellent" ||
          normalized === "good" ||
          normalized === "poor" ||
          normalized === "lost" ||
          normalized === "unknown"
        ) {
          return normalized as QualityLevel;
        }
        return "unknown";
      }
      if (typeof quality === "number") {
        switch (quality) {
          case 1:
            return "excellent";
          case 2:
            return "good";
          case 3:
            return "poor";
          case 4:
            return "lost";
          default:
            return "unknown";
        }
      }
      if (typeof quality === "object" && typeof quality.toString === "function") {
        return mapLKQualityValue(quality.toString());
      }
      return "unknown";
    },
    []
  );

  const handleAutoQuality = useCallback(
    (quality: QualityLevel) => {
      if (quality === "poor" || quality === "lost") {
        scheduleQualityDegrade();
      } else if (quality === "excellent" || quality === "good") {
        scheduleQualityRecovery();
      } else {
        clearTimer(poorQualityTimeoutRef);
      }
    },
    [scheduleQualityDegrade, scheduleQualityRecovery]
  );

  const handleAutoBitrate = useCallback(
    (kbps: number | null) => {
      if (kbps === null || kbps <= 0) {
        clearTimer(lowBitrateTimeoutRef);
        return;
      }
      if (kbps > 0 && kbps < 300) {
        scheduleBitrateDegrade();
      } else if (kbps >= 500) {
        scheduleBitrateRecovery();
      } else {
        clearTimer(lowBitrateTimeoutRef);
      }
    },
    [scheduleBitrateDegrade, scheduleBitrateRecovery]
  );

  const toggleManualLowBandwidth = useCallback(() => {
    const next = !manualLowBandwidthRef.current;
    console.info("[live] low_bw_manual_toggle", { active: next });
    setManualLowBandwidth(next);
  }, []);

  useEffect(() => {
    updateLowBandwidthActive();
  }, [updateLowBandwidthActive]);

  useEffect(() => {
    updateLowBandwidthActive();
  }, [manualLowBandwidth, updateLowBandwidthActive]);

  const scheduleReconnect = useCallback(
    (reason?: string) => {
      if (typeof window === "undefined") return;
      if (isOfflineRef.current) {
        console.info("[live] reconnect_suspended_offline", reason);
        return;
      }
      if (!autoRetryEnabledRef.current) {
        console.info("[live] reconnect_disabled", reason);
        return;
      }
      if (reconnectAttemptRef.current >= RECONNECT_MAX_ATTEMPTS) {
        console.info("[live] reconnect_max_attempts_reached", reason);
        setStatus("error");
        return;
      }
      const nextAttempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = nextAttempt;
      setReconnectAttempt(nextAttempt);
      const baseDelay = Math.min(
        RECONNECT_BASE_DELAY_MS * Math.pow(RECONNECT_FACTOR, nextAttempt - 1),
        RECONNECT_MAX_DELAY_MS
      );
      const jitterWindow = baseDelay * RECONNECT_JITTER_RATIO;
      const jitter = (Math.random() * 2 - 1) * jitterWindow;
      const delay = Math.max(0, Math.round(baseDelay + jitter));
      console.info("[live] reconnect_scheduled", { attempt: nextAttempt, delay });
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (stoppedRef.current || manualDisconnectRef.current) {
          return;
        }
        const fn = connectRoomRef.current;
        if (fn) {
          void fn(true);
        }
      }, delay);
      setStatus("connecting");
    },
    [clearReconnectTimer, setReconnectAttempt, setStatus]
  );

  useEffect(() => {
    if (tournamentId && !isTournamentBoardConfigured) {
      setStatus("idle");
      return;
    }
    stoppedRef.current = false;
    manualDisconnectRef.current = false;

    const connectRoom = async () => {
      if (stoppedRef.current || connectingRef.current) {
        return;
      }
      connectingRef.current = true;
      manualDisconnectRef.current = false;
      try {
        if (isOfflineRef.current) {
          connectingRef.current = false;
          return;
        }
        setStatus("connecting");

        const res = await fetch(`/api/token?boardId=${encodeURIComponent(boardId)}`, { method: "GET" });
        if (!res.ok) {
          throw new Error(`token_http_${res.status}`);
        }

        const data = await res.json();
        if (!data.ok || !data.token || !data.url) {
          throw new Error(data.error || "token_failed");
        }

        const LK = await import("livekit-client");
        const room: Room = new LK.Room({ adaptiveStream: true });
        await room.connect(data.url, data.token, {
          autoSubscribe: true,
        });

        if (stoppedRef.current) {
          manualDisconnectRef.current = true;
          try {
            room.disconnect();
          } catch {
            // ignore disconnect errors
          }
          connectingRef.current = false;
          return;
        }

        roomRef.current = room;
        prevDownlinkStatsRef.current = {};
        stopDownlinkStats();

        const connectionQualityHandler = (
          quality: ConnectionQuality,
          participant: Participant
        ) => {
          if (!participant || participant.isLocal) return;
          const normalized = mapLKQualityValue(quality);
          handleAutoQuality(normalized);
        };
        room.on(LK.RoomEvent.ConnectionQualityChanged, connectionQualityHandler);
        connectionQualityHandlerRef.current = connectionQualityHandler;

        const pollDownlinkStats = async () => {
          const roomWithEngine = roomRef.current as RoomWithEngine | null;
          if (!roomWithEngine) return;
          const subscriber = roomWithEngine.engine?.pcManager?.subscriber;
          if (!subscriber || typeof subscriber.getStats !== "function") {
            return;
          }
          try {
            const statsReport: RTCStatsReport = await subscriber.getStats();
            let totalKbps = 0;
            let totalPackets = 0;
            let totalPacketsLost = 0;
            statsReport.forEach((stat) => {
              if (!stat || stat.type !== "inbound-rtp") {
                return;
              }
              const inbound = stat as RTCInboundRtpStreamStats & {
                isRemote?: boolean;
                kind?: string;
                mediaType?: string;
              };
              if (inbound.isRemote) {
                return;
              }
              const mediaType = (inbound.mediaType || inbound.kind || "").toLowerCase();
              if (mediaType !== "video") {
                return;
              }
              const bytesReceived =
                typeof inbound.bytesReceived === "number" ? inbound.bytesReceived : 0;
              const timestamp = typeof inbound.timestamp === "number" ? inbound.timestamp : 0;
              const packetsReceived =
                typeof inbound.packetsReceived === "number" ? inbound.packetsReceived : 0;
              const packetsLost =
                typeof inbound.packetsLost === "number" ? inbound.packetsLost : 0;
              const prev = prevDownlinkStatsRef.current[inbound.id];
              if (prev) {
                const deltaBytes = bytesReceived - prev.bytesReceived;
                const deltaTimeMs = timestamp - prev.timestamp;
                if (deltaTimeMs > 0 && deltaBytes >= 0) {
                  const kbps = (deltaBytes * 8) / deltaTimeMs;
                  if (Number.isFinite(kbps) && kbps >= 0) {
                    totalKbps += kbps;
                  }
                }
                const deltaPackets = packetsReceived - prev.packetsReceived;
                const deltaLost = packetsLost - prev.packetsLost;
                if (deltaPackets > 0 || deltaLost > 0) {
                  totalPackets += Math.max(deltaPackets, 0);
                  totalPacketsLost += Math.max(deltaLost, 0);
                }
              }
              prevDownlinkStatsRef.current[inbound.id] = {
                bytesReceived,
                timestamp,
                packetsLost,
                packetsReceived,
              };
            });
            if (downlinkStatsIntervalRef.current === null) {
              return;
            }
            const kbps = totalKbps;
            const sampleTotal = totalPackets + totalPacketsLost;
            downlinkPacketLossRef.current =
              sampleTotal > 0 ? (totalPacketsLost / sampleTotal) * 100 : null;
            if (kbps > 0) {
              downlinkKbpsRef.current = kbps;
              handleAutoBitrate(kbps);
            } else {
              downlinkKbpsRef.current = null;
              handleAutoBitrate(null);
            }
          } catch (err) {
            console.info("[live] downlink_stats_failed", err);
          }
        };

        const startDownlinkStats = () => {
          if (typeof window === "undefined") return;
          if (downlinkStatsIntervalRef.current !== null) return;
          prevDownlinkStatsRef.current = {};
          const run = () => {
            void pollDownlinkStats();
            if (allowStatsOverlay && roomRef.current) {
              const roomWithEngine = roomRef.current as RoomWithEngine | null;
              const subscriber = roomWithEngine?.engine?.pcManager?.subscriber;
              if (subscriber && typeof subscriber.getStats === "function") {
                void subscriber.getStats().then((report: RTCStatsReport) => {
                  let rtt: number | null = null;
                  report.forEach((stat) => {
                    if (stat.type === "candidate-pair" && stat.state === "succeeded") {
                      const candidate = stat as RTCIceCandidatePairStats;
                      if (typeof candidate.currentRoundTripTime === "number") {
                        rtt = Math.round(candidate.currentRoundTripTime * 1000);
                      }
                    }
                  });
                  setDebugStats(prev => ({
                    bitrateKbps: downlinkKbpsRef.current ?? prev.bitrateKbps,
                    packetLossPct:
                      typeof downlinkPacketLossRef.current === "number"
                        ? downlinkPacketLossRef.current
                        : prev.packetLossPct,
                    rttMs: rtt ?? prev.rttMs,
                    quality: lowBandwidthActiveRef.current ? "poor" : prev.quality,
                  }));
                });
              }
            }
          };
          run();
          downlinkStatsIntervalRef.current = window.setInterval(run, 1000);
        };

        startDownlinkStats();

        const attachTrack = (track?: Track | RemoteTrack | null) => {
          if (!mediaRef.current || !track || typeof track.attach !== "function") return;
          const element = track.attach();
          if (element instanceof HTMLVideoElement) {
            element.playsInline = true;
            element.setAttribute("playsinline", "true");
            element.autoplay = true;
            const desiredMuted = lastMutedRef.current ?? shouldStartMuted;
            element.muted = desiredMuted;
            element.className = "rounded-lg max-w-full";
            videoRef.current = element;
            lastMutedRef.current = element.muted;
            setVideoEl(element);
          }
          mediaRef.current.appendChild(element);
        };

        const detachTrack = (track?: Track | RemoteTrack | null) => {
          if (!track || typeof track.detach !== "function") return;
          const elements = track.detach();
          for (const el of elements) {
            if (videoRef.current === el) {
              if (el instanceof HTMLVideoElement) {
                lastMutedRef.current = el.muted;
              }
              videoRef.current = null;
              setVideoEl(null);
            }
            el.remove();
          }
        };

        const recomputeLive = () => {
          let live = false;
          room.remoteParticipants.forEach(participant => {
            participant.trackPublications.forEach(publication => {
              if (publication.isSubscribed && publication.track) {
                live = true;
              }
            });
          });
          setIsLive(live);
        };

        const handleTrackSubscribed = (track: RemoteTrack | Track | null) => {
          attachTrack(track);
          if (lowBandwidthActiveRef.current) {
            applyLowBandwidth(true);
          }
          recomputeLive();
        };

        const handleTrackUnsubscribed = (track: RemoteTrack | Track | null) => {
          detachTrack(track);
          recomputeLive();
        };

        const handleParticipantChange = () => {
          recomputeLive();
        };

        room.on(LK.RoomEvent.TrackSubscribed, handleTrackSubscribed);
        room.on(LK.RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
        room.on(LK.RoomEvent.ParticipantConnected, handleParticipantChange);
        room.on(LK.RoomEvent.ParticipantDisconnected, handleParticipantChange);

        room.remoteParticipants.forEach(participant => {
          handleAutoQuality(mapLKQualityValue(participant.connectionQuality));
          participant.trackPublications.forEach((pub: TrackPublication) => {
            if (pub.track) {
              attachTrack(pub.track);
            }
          });
        });
        recomputeLive();
        if (lowBandwidthActiveRef.current) {
          applyLowBandwidth(true);
        }

        const handleRoomDisconnected = () => {
          connectingRef.current = false;
          room.off(LK.RoomEvent.TrackSubscribed, handleTrackSubscribed);
          room.off(LK.RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
          room.off(LK.RoomEvent.ParticipantConnected, handleParticipantChange);
          room.off(LK.RoomEvent.ParticipantDisconnected, handleParticipantChange);
          if (connectionQualityHandlerRef.current) {
            room.off(LK.RoomEvent.ConnectionQualityChanged, connectionQualityHandlerRef.current);
            connectionQualityHandlerRef.current = null;
          }
          clearLowBandwidthTimers();
          stopDownlinkStats();
          prevDownlinkStatsRef.current = {};
          room.remoteParticipants.forEach(participant => {
            participant.trackPublications.forEach((pub: TrackPublication) => {
              const track = pub.track;
              if (track && typeof track.detach === "function") {
                const elements = track.detach();
                for (const el of elements) {
                  if (videoRef.current === el && el instanceof HTMLVideoElement) {
                    lastMutedRef.current = el.muted;
                  }
                  el.remove();
                }
              }
            });
          });
          setIsLive(false);
          roomRef.current = null;
          cleanupMediaElements();

          if (manualDisconnectRef.current || stoppedRef.current) {
            manualDisconnectRef.current = false;
            resetReconnectState();
            return;
          }

          if (!autoRetryEnabledRef.current) {
            console.info("[live] disconnected_no_autoretry");
            setStatus("error");
            resetReconnectState();
            return;
          }

          scheduleReconnect("disconnected");
        };

        room.once(LK.RoomEvent.Disconnected, handleRoomDisconnected);

        resetReconnectState();
        setStatus("connected");
        connectingRef.current = false;
      } catch (e) {
        console.error(e);
        connectingRef.current = false;
        clearLowBandwidthTimers();
        stopDownlinkStats();
        if (stoppedRef.current) {
          return;
        }
        if (autoRetryEnabledRef.current) {
          scheduleReconnect("connect_error");
        } else {
          setStatus("error");
          resetReconnectState();
        }
      }
    };

    connectRoomRef.current = connectRoom;
    void connectRoom();

    return () => {
      stoppedRef.current = true;
      manualDisconnectRef.current = true;
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      connectRoomRef.current = null;

      const room = roomRef.current;
      if (room) {
        room.remoteParticipants.forEach(participant => {
          participant.trackPublications.forEach((pub: TrackPublication) => {
            const track = pub.track;
            if (track && typeof track.detach === "function") {
              const elements = track.detach();
              for (const el of elements) {
                if (videoRef.current === el && el instanceof HTMLVideoElement) {
                  lastMutedRef.current = el.muted;
                }
                el.remove();
              }
            }
          });
        });
        try {
          room.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }
      cleanupMediaElements();
      roomRef.current = null;
      setIsLive(false);
      setStatus("idle");
    };
  }, [
    boardId,
    shouldStartMuted,
    autoRetryEnabled,
    cleanupMediaElements,
    resetReconnectState,
    scheduleReconnect,
    clearReconnectTimer,
    handleAutoQuality,
    handleAutoBitrate,
    mapLKQualityValue,
    stopDownlinkStats,
    clearLowBandwidthTimers,
    applyLowBandwidth,
    tournamentId,
    isTournamentBoardConfigured,
    allowStatsOverlay,
  ]);

  useEffect(() => {
    if (!autoRetryEnabled) {
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
    }
  }, [autoRetryEnabled, clearReconnectTimer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOffline = () => {
      setIsOffline(true);
      clearReconnectTimer();
      clearLowBandwidthTimers();
      stopDownlinkStats();
    };
    const handleOnline = () => {
      setIsOffline(false);
      if (autoRetryEnabledRef.current && !stoppedRef.current && !manualDisconnectRef.current) {
        resetReconnectState();
        const fn = connectRoomRef.current;
        if (fn) {
          void fn();
        }
      }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [clearReconnectTimer, resetReconnectState, clearLowBandwidthTimers, stopDownlinkStats]);

  useEffect(() => {
    if (videoEl) {
      lastMutedRef.current = videoEl.muted;
      setIsMuted(videoEl.muted);
    }
  }, [videoEl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleVolumeChange = () => setIsMuted(video.muted);
    video.addEventListener("volumechange", handleVolumeChange);
    return () => {
      video.removeEventListener("volumechange", handleVolumeChange);
    };
  }, [videoEl]);

  useEffect(() => {
    if (!videoEl) return;
    if (shouldAutoplay) {
      const playAttempt = videoEl.play();
      if (playAttempt && typeof playAttempt.catch === "function") {
        playAttempt.catch(() => {});
      }
    }
  }, [videoEl, shouldAutoplay]);

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
      clearLowBandwidthTimers();
      stopDownlinkStats();
    };
  }, [clearLowBandwidthTimers, stopDownlinkStats]);

  const handleManualRetry = useCallback(async () => {
    if (manualRetryPending || status === "connecting") {
      return;
    }
    const connectFn = connectRoomRef.current;
    if (!connectFn) return;
    setManualRetryPending(true);
    stoppedRef.current = false;
    manualDisconnectRef.current = false;
    clearReconnectTimer();
    resetReconnectState();
    try {
      await connectFn();
    } catch (err) {
      console.error("[live] manual_retry_failed", err);
    } finally {
      setManualRetryPending(false);
    }
  }, [manualRetryPending, status, clearReconnectTimer, resetReconnectState]);

  const showPipMessage = useCallback(
    (text: string) => {
      if (typeof window === "undefined") return;
      if (pipMessageTimeoutRef.current) {
        window.clearTimeout(pipMessageTimeoutRef.current);
      }
      setPipMessage(text);
      pipMessageTimeoutRef.current = window.setTimeout(() => {
        setPipMessage(null);
        pipMessageTimeoutRef.current = null;
      }, 2000);
    },
    [setPipMessage]
  );

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
      console.info("[live] pip_toggle_failed", err);
      showPipMessage("PiP unavailable");
    }
  }, [showPipMessage]);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    const container = mediaWrapperRef.current || mediaRef.current;
    if (!container) return;
    if (typeof container.requestFullscreen !== "function") {
      console.info("[live] fullscreen_unavailable");
      return;
    }
    if (document.fullscreenElement === container) {
      if (typeof document.exitFullscreen === "function") {
        const exitResult = document.exitFullscreen();
        if (exitResult && typeof exitResult.catch === "function") {
          exitResult.catch(err => {
            console.info("[live] fullscreen_toggle_failed", err);
          });
        }
      } else {
        console.info("[live] fullscreen_unavailable");
      }
      return;
    }
    try {
      const result = container.requestFullscreen();
      if (result && typeof result.catch === "function") {
        result.catch(err => {
          console.info("[live] fullscreen_toggle_failed", err);
        });
      }
    } catch (err) {
      console.info("[live] fullscreen_toggle_failed", err);
    }
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
      console.info("[live] embed_copy_failed", err);
    }
  }, []);

  const controlsRow = (
    <div className={controlsOverlayClass}>
      <YouTubeControlsBar
        isMuted={isMuted}
        onToggleMute={() => {
          const video = videoRef.current;
          if (video) {
            video.muted = !video.muted;
            lastMutedRef.current = video.muted;
            setIsMuted(video.muted);
          }
        }}
        isPip={isPip}
        onTogglePictureInPicture={() => {
          void togglePiP();
        }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        isLowBandwidth={lowBandwidthActive}
        onToggleLowBandwidth={toggleManualLowBandwidth}
        showLowBandwidth
        showPiP
        onClickEmbed={copyEmbedSnippet}
        videoAvailable={Boolean(videoEl)}
        statusContent={
          <>
            {lowBandwidthActive ? (
              <span className="pointer-events-auto rounded-full bg-white/20 px-3 py-1 text-[11px] text-white">
                Low Bandwidth Mode (360p)
              </span>
            ) : null}
            {embedCopied ? (
              <span className="pointer-events-auto text-[11px] text-white/80 sm:text-xs">Copied!</span>
            ) : null}
            {pipMessage ? (
              <span className="pointer-events-auto text-[11px] text-white/80 sm:text-xs">{pipMessage}</span>
            ) : null}
          </>
        }
      />
    </div>
  );

  useEffect(() => {
    const video = videoEl;
    if (!video) return;
    const handleEnter = () => setIsPip(true);
    const handleLeave = () => setIsPip(false);
    video.addEventListener("enterpictureinpicture", handleEnter);
    video.addEventListener("leavepictureinpicture", handleLeave);
    setIsPip(document.pictureInPictureElement === video);
    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnter);
      video.removeEventListener("leavepictureinpicture", handleLeave);
    };
  }, [videoEl]);

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
    if (typeof document === "undefined") return;
    const handleFullscreenChange = () => {
      const fullscreenEl = document.fullscreenElement;
      const container = mediaWrapperRef.current || mediaRef.current;
      const video = videoRef.current;
      setIsFullscreen(
        Boolean(
          fullscreenEl &&
            ((container && fullscreenEl === container) || (video && fullscreenEl === video))
        )
      );
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as NavigatorWithMediaSession;
    if (!nav.mediaSession) return;
    const mediaSession = nav.mediaSession;
    const video = videoEl;
    if (!video) return;
    mediaSession.metadata = new MediaMetadata({
      title: boardId,
      artist: "Chessviewlive",
      album: "Live",
    });
    mediaSession.setActionHandler("play", async () => {
      try {
        await video.play();
      } catch (err) {
        console.info("[live] mediaSession play failed", err);
      }
    });
    mediaSession.setActionHandler("pause", () => {
      video.pause();
    });
    mediaSession.setActionHandler("stop", () => {
      video.pause();
    });
    mediaSession.setActionHandler("previoustrack", null);
    mediaSession.setActionHandler("nexttrack", null);
    mediaSession.setActionHandler("seekbackward", null);
    mediaSession.setActionHandler("seekforward", null);
    mediaSession.setActionHandler("seekto", null);
    return () => {
      mediaSession.setActionHandler("play", null);
      mediaSession.setActionHandler("pause", null);
      mediaSession.setActionHandler("stop", null);
      mediaSession.metadata = null;
    };
  }, [boardId, videoEl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKey = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      const target = event.target as HTMLElement | null;
      const ignoreTarget =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.getAttribute("contenteditable") === "true");
      if (ignoreTarget) return;
      if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        void togglePiP();
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if (event.key === " " || event.key === "Spacebar" || event.key === "k" || event.key === "K") {
        event.preventDefault();
        if (video.paused) {
          const playAttempt = video.play();
          if (playAttempt && typeof playAttempt.catch === "function") {
            playAttempt.catch(() => {});
          }
        } else {
          video.pause();
        }
        return;
      }
      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        video.muted = !video.muted;
        lastMutedRef.current = video.muted;
        return;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [togglePiP, toggleFullscreen]);

  if (tournamentId && !isTournamentBoardConfigured) {
    return (
      <main className={mainClassName}>
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-700 space-y-3">
          <h1 className="text-lg font-semibold text-neutral-900">This board is not configured for this tournament.</h1>
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
      </main>
    );
  }

  const videoOverlay =
    showReplayOverlay && replayOverlayHref ? (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <button
          type="button"
          onClick={() => router.push(replayOverlayHref)}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/70 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black/80"
        >
          <RotateCcw className="h-5 w-5" />
          Watch replay
        </button>
      </div>
    ) : null;

  const videoFooter = shouldShowManualRetry ? (
    <>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-neutral-500">
        <span>Having trouble?</span>
        <button
          type="button"
          className="rounded border border-neutral-400/60 px-2 py-0.5 text-xs font-semibold transition hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleManualRetry}
          disabled={manualRetryPending || status === "connecting"}
        >
          {manualRetryPending ? "Retrying…" : "Retry connection"}
        </button>
      </div>
      {manualRetryPending ? (
        <div className="mt-0.5 text-xs text-neutral-500">Retry in progress…</div>
      ) : null}
    </>
  ) : null;

  const statsOverlay = allowStatsOverlay ? (
    <div className="fixed bottom-2 left-2 bg-black/70 text-white text-[10px] font-mono px-2 py-1 rounded pointer-events-none select-none opacity-70">
      <div>Q: {debugStats.quality}</div>
      <div>Bitrate: {debugStats.bitrateKbps ? Math.round(debugStats.bitrateKbps) : "-"} kbps</div>
      <div>Loss: {debugStats.packetLossPct != null ? Math.round(debugStats.packetLossPct) : "-"}%</div>
      <div>RTT: {debugStats.rttMs != null ? debugStats.rttMs : "-"} ms</div>
    </div>
  ) : null;

  return (
    <ViewerShell
      mode="live"
      headerTitle={displayGameLabel}
      headerControls={
        <div className="flex items-center gap-2">
          <LiveHeaderControls
            boardId={boardId}
            tournamentSlug={boardSelection.tournamentSlug}
            maxRounds={MAX_ROUNDS}
            boardsPerRound={BOARDS_PER_ROUND}
            pane={paneParam}
          />
          {boardStatus === "final" && boardManifestGame?.moveList?.length ? (
            <Link
              href={`/replay/${boardId}`}
              className="rounded-full border border-white/20 bg-slate-900/70 px-3 py-1 text-[12px] font-semibold uppercase tracking-wide text-slate-100 transition hover:border-sky-300 hover:text-sky-100"
            >
              Replay
            </Link>
          ) : null}
        </div>
      }
      boardId={boardId}
      boardDomId="cv-live-board"
      boardOrientation={orientation}
      boardPosition={boardPosition}
      showEval={gaugeEnabled}
      evaluation={evaluation}
      evaluationLabel={evaluationLabel}
      evaluationAdvantage={evaluationAdvantage}
      engineEnabled={engineEnabled}
      engineThinking={engineEnabled && engineThinking}
      onToggleEval={toggleEval}
      onPrev={handlePrev}
      onLive={handleLive}
      onNext={handleNext}
      onFlip={handleFlip}
      canPrev={canPrev}
      canNext={canNext}
      liveActive={liveActive}
      boardResult={boardResult}
      boardStatus={boardStatus}
      players={{
        white: {
          name: whiteDisplayName,
          rating: whiteRating,
          countryCode: whiteCountryCode,
          flag: whiteFlag,
          title: whiteTitle,
          clockLabel: whiteClockLabel,
        },
        black: {
          name: blackDisplayName,
          rating: blackRating,
          countryCode: blackCountryCode,
          flag: blackFlag,
          title: blackTitle,
          clockLabel: blackClockLabel,
        },
      }}
      tournamentHref={tournamentHref}
      tournamentLabel={tournamentLabel}
      boardSwitcherOptions={boardSwitcherOptions}
      currentBoardId={boardId}
      currentBoardLabel={currentBoardLabel}
      canonicalPath={canonicalPath}
      latestReplayPath={latestReplayPath}
      replayPath={replayPath}
      previousBoardHref={previousBoardHref}
      nextBoardHref={nextBoardHref}
      boardNumber={boardNumber}
      liveVersion={liveFeedVersion}
      mediaContainerClass={mediaContainerClass}
      videoPane={{
        containerRef: mediaWrapperRef,
        innerRef: mediaRef,
        statusPill: liveStatus,
        secondaryPill: videoRoomLabel,
        overlay: videoOverlay,
        controlsOverlay: controlsRow,
        footer: videoFooter,
      }}
      notation={{
        engineOn: engineEnabled,
        setEngineOn: setEngineEnabled,
        engineEval,
        engineLines,
        engineThinking: engineEnabled && engineThinking,
        engineProfileId: activeProfileId,
        engineProfile: activeProfileConfig,
        setEngineProfileId: handleProfileChange,
        multiPv,
        depthIndex,
        depthSteps,
        targetDepth,
        setMultiPv,
        setDepthIndex: handleDepthChange,
        fen: boardPosition,
        engineName,
        engineBackend,
        setEngineBackend,
        plies,
        currentMoveIndex,
        onMoveSelect: handleNotationPlySelect,
      }}
      statsOverlay={statsOverlay}
    />
  );
}

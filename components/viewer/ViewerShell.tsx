"use client";

import { useMemo } from "react";
import type { ReactNode, RefObject } from "react";
import BoardControls from "@/components/live/BoardControls";
import MainEvalBar from "@/components/live/MainEvalBar";
import RightPaneTabs from "@/components/live/RightPaneTabs";
import type { BoardSwitcherOption } from "@/components/tournament/BoardSwitcher";
import AnimatedBoardPane from "@/components/viewer/AnimatedBoardPane";
import BroadcastReactBoard from "@/components/viewer/BroadcastReactBoard";
import type { Ply } from "@/lib/chess/pgn";
import { buildBoardIdentifier, parseBoardIdentifier } from "@/lib/boardId";
import { getTournamentBoardsForRound, getTournamentGameManifest } from "@/lib/tournamentManifest";
import type { GameResult, GameStatus } from "@/lib/tournamentManifest";
import type { StockfishEval, StockfishLine } from "@/lib/engine/useStockfishEvaluation";
import type { EngineBackend, EngineProfileConfig, EngineProfileId } from "@/lib/engine/config";
import type { EvaluationAdvantage } from "@/lib/engine/evalMapping";

type Orientation = "white" | "black";

type ScoreVariant = "winner" | "loser" | "draw" | "neutral";

type PlayerCardProps = {
  name: string;
  rating: number | string;
  countryCode: string;
  flag: string;
  title?: string | null;
  clockLabel: string;
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
  engineEval?: StockfishEval;
  engineLines?: StockfishLine[];
  engineThinking?: boolean;
  engineName?: string;
  engineBackend?: EngineBackend;
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

const scorePillClasses = (variant: ScoreVariant) => {
  void variant; // variant preserved for potential future use
  return "border-slate-600 bg-slate-900 text-slate-200";
};

type BoardNavigationEntry = {
  boardId: string;
  boardNumber: number;
  result?: GameResult;
  status?: GameStatus;
  evaluation?: number | null;
  white: {
    name: string;
    title?: string | null;
    rating?: number;
    flag?: string;
  };
  black: {
    name: string;
    title?: string | null;
    rating?: number;
    flag?: string;
  };
};

const BOARD_SCAN_LIMIT = 20;

type ViewerShellProps = {
  mode: "live" | "replay";
  headerTitle: string;
  headerControls?: ReactNode;
  boardId: string;
  boardDomId?: string;
  boardOrientation: Orientation;
  boardPosition: string;
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
  statsOverlay?: ReactNode;
  liveVersion?: number;
};

export function ViewerShell({
  mode,
  headerTitle,
  headerControls,
  boardId,
  boardDomId = boardId,
  boardOrientation,
  boardPosition,
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
  videoPane,
  notation,
  mediaContainerClass = "aspect-video w-full max-h-[52vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm lg:aspect-[16/8.5] lg:max-h-[60vh]",
  mainClassName = "flex min-h-screen h-screen flex-col bg-slate-950 text-slate-100 overflow-hidden",
  contentClassName = "mx-auto flex-1 w-full max-w-[1440px] px-4 py-1.5 lg:px-8",
  statsOverlay,
  liveVersion = 0,
}: ViewerShellProps) {
  const { white, black } = players;
  const normalizedBoardResult = normalizeResult(boardResult);
  const playerPoints = derivePlayerPoints(normalizedBoardResult, boardStatus ?? null);
  const statusPill = videoPane.statusPill ?? {
    label: mode === "live" ? "LIVE" : "REPLAY",
    className: mode === "live" ? "bg-red-600 text-white" : "bg-blue-600/80 text-white",
  };
  const isWhiteAtBottom = boardOrientation === "white";
  const topPlayer = isWhiteAtBottom ? black : white;
  const bottomPlayer = isWhiteAtBottom ? white : black;
  const topPoints = isWhiteAtBottom ? playerPoints.black : playerPoints.white;
  const bottomPoints = isWhiteAtBottom ? playerPoints.white : playerPoints.black;
  const normalizedEvalLabel = evaluationLabel ?? "-";
  const normalizedAdvantage = evaluationAdvantage ?? "equal";
  const renderPlayerRow = (player: PlayerCardProps, points: { score: string; variant: ScoreVariant }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-200 sm:text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-base" aria-hidden>
          {player.flag}
        </span>
        <div className="flex items-center gap-1.5">
          {player.title ? (
            <span className="rounded-full border border-amber-200/50 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
              {player.title}
            </span>
          ) : null}
          <span className="text-sm font-semibold text-white sm:text-base">{player.name}</span>
        </div>
        <span className="text-slate-600" aria-hidden>
          &middot;
        </span>
        <span className="text-[11px] text-slate-300 sm:text-xs">({player.rating})</span>
        <span className="text-slate-600" aria-hidden>
          &middot;
        </span>
        <span className="text-[11px] uppercase tracking-wide text-slate-300 sm:text-xs">
          {player.countryCode}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-tight ${scorePillClasses(points.variant)}`}
        >
          {points.score}
        </span>
        <div className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 font-mono text-[11px] tracking-tight text-white shadow-inner sm:text-xs">
          {player.clockLabel}
        </div>
      </div>
    </div>
  );
  const boardNavigation = useMemo(() => {
    const parsed = parseBoardIdentifier(boardId);
    const boardNumbers =
      getTournamentBoardsForRound(parsed.tournamentSlug, parsed.round) ??
      Array.from({ length: BOARD_SCAN_LIMIT }, (_, idx) => idx + 1);

    return boardNumbers
      .map(boardNum => {
        const game = getTournamentGameManifest(parsed.tournamentSlug, parsed.round, boardNum);
        if (!game) return null;
        const normalizedResult = normalizeResult(game.result);
        const normalizedStatus: GameStatus =
          game.status ??
          (normalizedResult && normalizedResult !== "·" ? "final" : "live");
        return {
          boardId: buildBoardIdentifier(parsed.tournamentSlug, parsed.round, boardNum),
          boardNumber: boardNum,
          result: normalizedResult,
          status: normalizedStatus,
          whiteTimeMs: game.whiteTimeMs ?? 5 * 60 * 1000,
          blackTimeMs: game.blackTimeMs ?? 5 * 60 * 1000,
          sideToMove: game.sideToMove ?? "white",
          finalFen: game.finalFen ?? null,
          moveList: game.moveList ?? null,
          whiteClock: game.whiteClock ?? null,
          blackClock: game.blackClock ?? null,
          evaluation: game.evaluation ?? null,
          white: {
            name: game.white,
            title: game.whiteTitle,
            rating: game.whiteRating,
            flag: game.whiteFlag,
          },
          black: {
            name: game.black,
            title: game.blackTitle,
            rating: game.blackRating,
            flag: game.blackFlag,
          },
        } as BoardNavigationEntry;
      })
      .filter((entry): entry is BoardNavigationEntry => Boolean(entry));
  }, [boardId, liveVersion]);

  return (
    <>
      <main className={mainClassName}>
        <div className={`${contentClassName} flex flex-col min-h-0`}>
      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden lg:flex-row lg:items-stretch">
        <section className="mx-auto flex h-full min-h-0 w-full max-w-[620px] flex-1 flex-col gap-1.5 rounded-3xl border border-white/10 bg-slate-950/80 p-3 shadow-xl ring-1 ring-white/5 lg:flex-[0.9]">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5">
            <div>
              <h2 className="text-lg font-semibold text-white">{headerTitle}</h2>
            </div>
            {headerControls}
          </header>

          <AnimatedBoardPane boardKey={boardId}>
            <div className="flex flex-col gap-2.5 rounded-3xl border border-slate-800/70 bg-slate-950/80 p-3 shadow-inner sm:p-3.5">
              <div className="space-y-2 sm:space-y-2.5">
                {renderPlayerRow(topPlayer, topPoints)}

                <div className="flex items-stretch gap-2.5 sm:gap-3.5">
                  <MainEvalBar
                    show={showEval}
                    value={evaluation ?? null}
                    label={normalizedEvalLabel}
                    advantage={normalizedAdvantage}
                    orientation={boardOrientation}
                  />
                      <div className="relative flex-1">
                        <BroadcastReactBoard
                          boardId={boardDomId}
                          boardOrientation={boardOrientation}
                          position={boardPosition}
                          draggable={false}
                          showNotation
                        />
                      </div>
                    </div>

                    {renderPlayerRow(bottomPlayer, bottomPoints)}
                  </div>

                  <div className="pt-1 sm:pt-1.5">
                    <BoardControls
                      onPrev={onPrev}
                      onLive={onLive}
                      onNext={onNext}
                      onFlip={onFlip}
                      showEval={showEval}
                      toggleEval={onToggleEval ?? (() => {})}
                      canPrev={canPrev}
                      canNext={canNext}
                      liveActive={liveActive}
                    />
                  </div>
                </div>
              </AnimatedBoardPane>
            </section>

            <aside className="flex h-full min-h-0 w-full flex-col gap-1.5 overflow-hidden lg:flex-[1.1] lg:gap-2">
              <div ref={videoPane.containerRef} className={`${mediaContainerClass} relative flex-none`}>
                {videoPane.content ?? (
                  <div ref={videoPane.innerRef} className="absolute inset-0 h-full w-full" />
                )}
                {statusPill && (
                  <div
                    className={`pointer-events-none absolute left-3 top-3 rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white ${statusPill.className}`}
                  >
                    {statusPill.label}
                  </div>
                )}
                {videoPane.secondaryPill && (
                  <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/20 bg-black/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                    {videoPane.secondaryPill}
                  </div>
                )}
                {videoPane.overlay}
                {videoPane.controlsOverlay}
              </div>
              {videoPane.footer ? <div className="flex-none">{videoPane.footer}</div> : null}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <RightPaneTabs
                  engineOn={notation.engineOn}
                  setEngineOn={notation.setEngineOn}
                  plies={notation.plies}
                  currentMoveIndex={notation.currentMoveIndex}
                  onMoveSelect={notation.onMoveSelect}
                  engineEval={notation.engineEval}
                  engineLines={notation.engineLines}
                  engineThinking={notation.engineThinking}
                  engineName={notation.engineName}
                  engineBackend={notation.engineBackend}
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
                  boardNavigation={boardNavigation}
                  currentBoardId={boardId}
                  mode={mode}
                />
              </div>
            </aside>
          </div>
        </div>
      </main>
      {statsOverlay}
    </>
  );
}

export default ViewerShell;

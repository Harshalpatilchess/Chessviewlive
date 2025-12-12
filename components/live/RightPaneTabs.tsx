"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Ply } from "@/lib/chess/pgn";
import NotationList from "@/components/viewer/NotationList";
import StockfishPanel from "@/components/live/StockfishPanel";
import Flag from "@/components/live/Flag";
import { WORLD_CUP_DEMO_PLIES } from "@/lib/mockGames";
import type { GameResult, GameStatus } from "@/lib/tournamentManifest";
import type { StockfishEval, StockfishLine } from "@/lib/engine/useStockfishEvaluation";
import { DEBUG_ENGINE_SWITCHER, type EngineBackend, type EngineProfileConfig, type EngineProfileId } from "@/lib/engine/config";
import useMiniBoardClock from "@/lib/live/useMiniBoardClock";
import BroadcastReactBoard from "@/components/viewer/BroadcastReactBoard";

type BoardNavigationPlayer = {
  name: string;
  title?: string | null;
  rating?: number;
  flag?: string;
};

type BoardNavigationEntry = {
  boardId: string;
  boardNumber: number;
  result?: GameResult;
  status?: GameStatus;
  whiteClock?: string | null;
  blackClock?: string | null;
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
  sideToMove?: "white" | "black" | null;
  evaluation?: number | null;
  finalFen?: string | null;
  moveList?: string[] | null;
  white: BoardNavigationPlayer;
  black: BoardNavigationPlayer;
};

type RightPaneTabsProps = {
  engineOn: boolean;
  setEngineOn: (value: boolean | ((prev: boolean) => boolean)) => void;
  plies: Ply[];
  currentMoveIndex: number;
  onMoveSelect: (i: number) => void;
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
  engineProfileId?: EngineProfileId;
  engineProfile?: EngineProfileConfig;
  setEngineProfileId?: (value: EngineProfileId) => void;
  fen?: string | null;
  boardNavigation?: BoardNavigationEntry[] | null;
  currentBoardId?: string;
  mode?: "live" | "replay";
};

type TabKey = "notation" | "live" | "boards";

const TabButton = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
      active ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
    }`}
  >
    {label}
    {active ? <span className="absolute inset-x-4 bottom-1 h-1 rounded-full bg-emerald-400" /> : null}
  </button>
);

const clampDepthIndex = (value: number, steps: number[]) => {
  const maxIndex = Math.max(steps.length - 1, 0);
  const normalized = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(maxIndex, normalized));
};

const BoardsNavigationList = ({
  boards = [],
  currentBoardId,
  mode = "live",
  activePane,
}: {
  boards?: BoardNavigationEntry[];
  currentBoardId?: string;
  mode?: "live" | "replay";
  activePane: TabKey;
}) => {
  const BoardsNavigationCard = ({ board }: { board: BoardNavigationEntry }) => {
    const isActive = currentBoardId === board.boardId;
    const paneQuery = activePane ?? "notation";
    const normalizedResult = normalizeResult(board.result);
    const isFinished = board.status === "final" || (normalizedResult && normalizedResult !== "·");
    const isLive = board.status === "live" && !isFinished;
    const hrefBase = isFinished ? `/replay/${board.boardId}` : `/live/${board.boardId}`;
    const href = `${hrefBase}?pane=${paneQuery}`;
    const {
      whiteTimeLabel,
      blackTimeLabel,
      isWhiteInTimeTrouble,
      isBlackInTimeTrouble,
    } = useMiniBoardClock({
      status: isLive ? "live" : "finished",
      whiteTimeMs: board.whiteTimeMs ?? undefined,
      blackTimeMs: board.blackTimeMs ?? undefined,
      sideToMove: board.sideToMove ?? null,
    });
    const baseClass =
      "relative flex w-full min-w-0 items-stretch gap-1.5 rounded-2xl border px-2 py-1 transition-all duration-150 cursor-pointer shadow-sm";
    const activeClass = isActive
      ? "border-sky-200/90 bg-slate-900/95 ring-1 ring-sky-300/25 shadow-[0_10px_34px_rgba(56,189,248,0.14)]"
      : "border-slate-700/80 bg-slate-900/95";
    const hoverClass = isActive
      ? "hover:border-sky-100/90 hover:bg-slate-800"
      : "hover:border-slate-500/85 hover:bg-slate-800/90 hover:shadow-[0_12px_34px_rgba(0,0,0,0.38)]";
    const fillPercent = renderEvalFill(board.evaluation);
    const statusLabel = getBoardStatusLabel(board);
    const badgeClass = isActive
      ? "border-sky-300/60 bg-sky-400/15 text-sky-50"
      : "border-slate-600 bg-slate-900 text-slate-100";
    const badgeTone =
      statusLabel === "1-0"
        ? "border-emerald-400/70 bg-emerald-400/15 text-emerald-50"
        : statusLabel === "0-1"
          ? "border-rose-400/70 bg-rose-400/15 text-rose-50"
          : statusLabel === "½-½"
            ? "border-amber-300/60 bg-amber-200/12 text-amber-50"
            : "";

    return (
      <Link
        key={board.boardId}
        href={href}
        scroll={false}
        aria-pressed={isActive}
        className={`${baseClass} ${activeClass} ${hoverClass} group overflow-hidden`}
      >
        <div className="flex w-10 shrink-0 flex-col items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/80 px-1 py-1 text-center">
          <span className="text-[9px] uppercase tracking-wide text-slate-300 leading-tight font-semibold">Bd</span>
          <span className="text-[11px] font-semibold leading-tight text-slate-50">{board.boardNumber}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
          <div className={`transition-colors duration-200 ${isLive && isWhiteInTimeTrouble ? "text-rose-50" : ""}`}>
            <PlayerLine player={board.white} />
          </div>
          {isLive ? (
            <div className="flex w-full justify-start px-0.5">
              <span
                className={`inline-flex items-center rounded-md border bg-slate-800/80 px-2 py-[3px] text-[10px] font-medium leading-tight transition-colors transition-shadow duration-200 ${
                  isWhiteInTimeTrouble
                    ? "border-rose-400/70 text-rose-50 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]"
                    : "border-slate-600/60 text-slate-100"
                }`}
              >
                {whiteTimeLabel ?? "—:—"}
              </span>
            </div>
          ) : (
            <div className="flex w-full justify-center px-0.5">
              <span
                className={`inline-flex items-center justify-center rounded-full border px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] leading-tight ${badgeClass} ${badgeTone}`}
              >
                {statusLabel}
              </span>
            </div>
          )}
          {isLive ? (
            <div className="flex w-full justify-start px-0.5">
              <span
                className={`inline-flex items-center rounded-md border bg-slate-800/80 px-2 py-[3px] text-[10px] font-medium leading-tight transition-colors transition-shadow duration-200 ${
                  isBlackInTimeTrouble
                    ? "border-rose-400/70 text-rose-50 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]"
                    : "border-slate-600/60 text-slate-100"
                }`}
              >
                {blackTimeLabel ?? "—:—"}
              </span>
            </div>
          ) : null}
          <div className={`transition-colors duration-200 ${isLive && isBlackInTimeTrouble ? "text-rose-50" : ""}`}>
            <PlayerLine player={board.black} />
          </div>
        </div>
        <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 pl-1">
          {isFinished && board.finalFen ? (
            <div className="w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950/60 shadow-inner">
              <BroadcastReactBoard
                boardId={`${board.boardId}-mini`}
                position={board.finalFen}
                boardOrientation="white"
                draggable={false}
                showNotation={false}
              />
            </div>
          ) : null}
          <div className="relative h-16 w-2 overflow-hidden rounded-full border border-slate-700/60 bg-slate-800">
            <div className="absolute inset-x-[-2px] top-1/2 h-px bg-amber-200/80" />
            <div
              className="absolute inset-x-0 bottom-0 w-full bg-emerald-400/80"
              style={{ height: `${fillPercent}%` }}
            />
          </div>
        </div>
        {isActive ? (
          <span className="absolute inset-y-0 left-0 w-1 rounded-l-full bg-sky-300" aria-hidden />
        ) : null}
      </Link>
    );
  };

  const normalizeResult = (result?: GameResult): string | null => {
    if (!result || result === "·" || result === "*") return null;
    return result === "1/2-1/2" ? "½-½" : result;
  };

  const getBoardStatusLabel = (entry: BoardNavigationEntry): string => {
    const normalizedResult = normalizeResult(entry.result);
    if (entry.status === "final" && normalizedResult) return normalizedResult;
    if (entry.status === "live") return "Live";
    if (entry.status === "scheduled") return "Scheduled";
    if (!entry.status || entry.status === "unknown") {
      return normalizedResult ?? "—";
    }
    return normalizedResult ?? "—";
  };

  if (!boards || boards.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-2 pb-3 text-sm text-slate-400">
        No other boards available for this round yet.
      </div>
    );
  }

  const PlayerLine = ({ player }: { player: BoardNavigationPlayer }) => (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-900/70 px-2 py-1">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {player.flag ? (
          <Flag country={player.flag} className="text-lg leading-none" />
        ) : (
          <span className="h-5 w-5 rounded-full border border-white/10 bg-slate-800" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {player.title ? (
            <span className="rounded-full border border-amber-200/50 bg-amber-200/10 px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-wide text-amber-100">
              {player.title}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-slate-50">
            {player.name}
          </span>
        </div>
      </div>
      {player.rating ? (
        <span className="ml-auto whitespace-nowrap text-[12px] font-medium text-slate-200 tabular-nums" aria-label="Rating">
          {player.rating}
        </span>
      ) : null}
    </div>
  );

  const renderEvalFill = (evaluation?: number | null) => {
    if (evaluation === null || evaluation === undefined || Number.isNaN(evaluation)) {
      return 50;
    }
    const clamped = Math.max(-5, Math.min(5, evaluation));
    return 50 + (clamped / 5) * 50;
  };

  return (
    <div className="px-1.5 pb-1 sm:px-2 overflow-x-hidden">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 overflow-x-hidden">
        {boards.map(board => (
          <BoardsNavigationCard key={board.boardId} board={board} />
        ))}
      </div>
    </div>
  );
};

const RightPaneTabs = ({
  engineOn,
  setEngineOn,
  engineEval,
  engineLines,
  engineThinking,
  engineName,
  engineBackend = "js-worker",
  setEngineBackend,
  multiPv,
  depthIndex,
  depthSteps,
  targetDepth,
  setMultiPv,
  setDepthIndex,
  engineProfileId,
  engineProfile,
  setEngineProfileId,
  fen,
  plies,
  currentMoveIndex,
  onMoveSelect,
  boardNavigation,
  currentBoardId,
  mode = "live",
}: RightPaneTabsProps) => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const paneParam = searchParams?.get("pane");
  const resolvedPane: TabKey =
    paneParam === "boards" || paneParam === "live" || paneParam === "notation" ? paneParam : "notation";
  const [activeTab, setActiveTab] = useState<TabKey>(resolvedPane);
  useEffect(() => {
    setActiveTab(resolvedPane);
  }, [resolvedPane]);
  const notationScrollRef = useRef<HTMLDivElement | null>(null);
  const boardsData = boardNavigation ?? [];
  const debugEngineSwitcherEnabled = DEBUG_ENGINE_SWITCHER && typeof setEngineBackend === "function";

  const resolvedPlies = useMemo(
    () => (plies && plies.length > 0 ? plies : WORLD_CUP_DEMO_PLIES),
    [plies]
  );

  const profileId: EngineProfileId = engineProfileId ?? engineProfile?.id ?? "standard";
  const displayMultiPv =
    typeof multiPv === "number" && Number.isFinite(multiPv)
      ? multiPv
      : engineProfile?.multiPv ?? 1;
  const resolvedDepthSteps = useMemo(() => {
    const baseSteps =
      (Array.isArray(depthSteps) && depthSteps.length ? depthSteps : engineProfile?.depthSteps) ?? [];
    return baseSteps.length ? baseSteps : [16, 20, 24];
  }, [depthSteps, engineProfile?.depthSteps]);
  const displayDepthIndex = useMemo(
    () =>
      clampDepthIndex(
        typeof depthIndex === "number" && Number.isFinite(depthIndex)
          ? depthIndex
          : engineProfile?.defaultDepthIndex ?? 0,
        resolvedDepthSteps
      ),
    [depthIndex, engineProfile?.defaultDepthIndex, resolvedDepthSteps]
  );
  const displayTargetDepth =
    typeof targetDepth === "number" && Number.isFinite(targetDepth)
      ? targetDepth
      : resolvedDepthSteps[displayDepthIndex] ?? resolvedDepthSteps[0];
  const handleProfileChange = (value: EngineProfileId) => {
    if (typeof setEngineProfileId === "function") {
      setEngineProfileId(value);
    }
  };

  const clampedCurrentIndex =
    resolvedPlies.length > 0
      ? Math.min(Math.max(currentMoveIndex, -1), resolvedPlies.length - 1)
      : -1;

  const handleMoveClick = (plyIdx: number) => {
    if (typeof plyIdx !== "number" || Number.isNaN(plyIdx)) return;
    if (plyIdx < 0) {
      onMoveSelect(-1);
      return;
    }
    const maxIndex = resolvedPlies.length > 0 ? resolvedPlies.length - 1 : -1;
    onMoveSelect(Math.min(plyIdx, maxIndex));
  };

  const handleTabChange = (nextTab: TabKey) => {
    setActiveTab(nextTab);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("pane", nextTab);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 shadow-sm">
      <div className="flex flex-none gap-2 rounded-t-2xl bg-slate-900/60 px-3 py-0.5 backdrop-blur">
        <TabButton label="Notation" active={activeTab === "notation"} onClick={() => handleTabChange("notation")} />
        <TabButton
          label="Live commentary"
          active={activeTab === "live"}
          onClick={() => handleTabChange("live")}
        />
        <TabButton
          label="Boards navigation"
          active={activeTab === "boards"}
          onClick={() => handleTabChange("boards")}
        />
      </div>

      <div className="mt-1 flex-1 min-h-0 pr-2">
        {activeTab !== "boards" ? (
          <div className="px-3 pb-2">
            <StockfishPanel
              enabled={engineOn}
              evalResult={engineEval ?? null}
              lines={engineLines ?? []}
              isEvaluating={Boolean(engineThinking)}
              multiPv={displayMultiPv}
              depthIndex={displayDepthIndex}
              depthSteps={resolvedDepthSteps}
              targetDepth={displayTargetDepth}
              onMultiPvChange={setMultiPv}
              onDepthChange={setDepthIndex}
              profileId={profileId}
              profileConfig={engineProfile}
              onProfileChange={handleProfileChange}
              fen={fen}
              engineName={engineName}
              engineBackend={engineBackend}
              onEngineBackendChange={debugEngineSwitcherEnabled ? setEngineBackend : undefined}
              debugBackendSwitcherEnabled={debugEngineSwitcherEnabled}
              onToggle={value => setEngineOn(value)}
              activeTab={activeTab}
            />
          </div>
        ) : null}

        {activeTab === "notation" ? (
          <div className="flex h-full min-h-0 flex-col px-3">
            <div className="flex-1 min-h-0">
              <div className="flex h-full min-h-0 flex-col rounded-xl border border-white/10 bg-slate-950/40 shadow-inner">
                <div className="grid grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 border-b border-white/5 bg-slate-900 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-200">
                  <span>#</span>
                  <span>White</span>
                  <span>Black</span>
                </div>
                <div ref={notationScrollRef} className="flex-1 overflow-y-auto">
                  <div className="flex flex-col px-3 pb-4">
                    <NotationList
                      plies={resolvedPlies}
                      currentMoveIndex={clampedCurrentIndex}
                      onMoveClick={handleMoveClick}
                      scrollContainerRef={notationScrollRef}
                      hideHeader
                      renderContainer={false}
                      headerSelector={null}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === "live" ? (
          <div className="flex h-full min-h-0 flex-col overflow-y-auto">
            <div className="flex flex-col px-3 pb-4">
              <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200">
                Live commentary connects here. Expect GM insights, critical moments, and tactics once the broadcast begins.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden">
            <div className="flex flex-col px-3 pb-3">
              <BoardsNavigationList
                boards={boardsData}
                currentBoardId={currentBoardId}
                mode={mode}
                activePane={activeTab}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default RightPaneTabs;

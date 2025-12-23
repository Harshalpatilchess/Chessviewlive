"use client";

import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  type MouseEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Ply } from "@/lib/chess/pgn";
import NotationList from "@/components/viewer/NotationList";
import StockfishPanel from "@/components/live/StockfishPanel";
import { WORLD_CUP_DEMO_PLIES } from "@/lib/mockGames";
import type { StockfishEval, StockfishLine } from "@/lib/engine/useStockfishEvaluation";
import { DEBUG_ENGINE_SWITCHER, type EngineBackend, type EngineProfileConfig, type EngineProfileId } from "@/lib/engine/config";
import { BoardsNavigation } from "@/components/boards/BoardsNavigation";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";

type AnalysisBranch = {
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
};

type NotationInsertion = { key: string; afterPlyIndex: number; content: ReactNode };

type RightPaneTabsProps = {
  engineOn: boolean;
  setEngineOn: (value: boolean | ((prev: boolean) => boolean)) => void;
  plies: Ply[];
  currentMoveIndex: number;
  onMoveSelect: (i: number) => void;
  engineEval?: StockfishEval;
  engineLines?: StockfishLine[];
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
  analysisViewActive?: boolean;
  analysisBranches?: AnalysisBranch[] | null;
  activeAnalysisAnchorPly?: number | null;
  analysisCursorNodeId?: string | null;
  onExitAnalysisView?: () => void;
  onSelectAnalysisMove?: (anchorPly: number, nodeId: string | null) => void;
  onPromoteAnalysisNode?: (anchorPly: number, nodeId: string) => void;
  onDeleteAnalysisLine?: (anchorPly: number, nodeId: string) => void;
  onDeleteAnalysisFromHere?: (anchorPly: number, nodeId: string) => void;
  boardNavigation?: BoardNavigationEntry[] | null;
  currentBoardId?: string;
};

type TabKey = "notation" | "live" | "boards";

const TabButton = ({
  label,
  active,
  onClick,
  indicator,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  indicator?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative flex-none shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition lg:flex-1 ${
      active ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
    }`}
  >
    <span className="inline-flex items-center justify-center gap-2">
      {label}
      {indicator ? <span className="h-2 w-2 rounded-full bg-rose-400" aria-label="Variation active" /> : null}
    </span>
    {active ? <span className="absolute inset-x-4 bottom-1 h-1 rounded-full bg-emerald-400" /> : null}
  </button>
);

const clampDepthIndex = (value: number, steps: number[]) => {
  const maxIndex = Math.max(steps.length - 1, 0);
  const normalized = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(maxIndex, normalized));
};

type AnalysisRenderToken = { nodeId: string; text: string };

const parseFenMeta = (fen: string): { fullmoveNumber: number; turn: "w" | "b" } | null => {
  if (typeof fen !== "string") return null;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const turn = parts[1] === "b" ? "b" : "w";
  const fullmoveRaw = Number.parseInt(parts[5] ?? "1", 10);
  const fullmoveNumber = Number.isFinite(fullmoveRaw) && fullmoveRaw > 0 ? fullmoveRaw : 1;
  return { fullmoveNumber, turn };
};

const buildMainLineTokens = (branch: AnalysisBranch): AnalysisRenderToken[] => {
  const nodesById = branch.nodesById ?? {};
  const startFen = typeof branch.startFen === "string" ? branch.startFen : "";
  const tokens: AnalysisRenderToken[] = [];
  let currentId: string | null = branch.rootMainChildId ?? null;
  let fenBefore = startFen;
  let isFirst = true;
  const safetyLimit = 200;
  for (let safety = 0; safety < safetyLimit && currentId; safety += 1) {
    const node = nodesById[currentId];
    if (!node) break;
    const meta = parseFenMeta(fenBefore);
    const moveNo =
      Number.isFinite(meta?.fullmoveNumber) && (meta?.fullmoveNumber ?? 0) > 0
        ? (meta?.fullmoveNumber as number)
        : Number.isFinite(branch.anchorFullmoveNumber) && branch.anchorFullmoveNumber > 0
          ? branch.anchorFullmoveNumber
          : 1;
    const turn = meta?.turn ?? (branch.anchorTurn === "b" ? "b" : "w");
    const san = typeof node.san === "string" && node.san.trim().length > 0 ? node.san.trim() : "…";
    const text =
      turn === "w" ? `${moveNo}.${san}` : isFirst ? `${moveNo}...${san}` : san;
    tokens.push({ nodeId: node.id, text });
    fenBefore = node.fenAfter;
    isFirst = false;
    currentId = node.mainChildId ?? null;
  }
  return tokens;
};

type VariationLine = { key: string; depth: number; tokens: AnalysisRenderToken[] };

const collectVariationLines = (branch: AnalysisBranch): VariationLine[] => {
  const nodesById = branch.nodesById ?? {};
  const startFen = typeof branch.startFen === "string" ? branch.startFen : "";
  const rootChildren = Array.isArray(branch.rootChildren) ? branch.rootChildren : [];
  const rootMainChildId = branch.rootMainChildId ?? null;
  const lines: VariationLine[] = [];
  const processedParents = new Set<string>();

  const buildLineFromStart = (startNodeId: string, fenBeforeFirst: string): AnalysisRenderToken[] => {
    const tokens: AnalysisRenderToken[] = [];
    let currentId: string | null = startNodeId;
    let fenBefore = fenBeforeFirst;
    let isFirst = true;
    const safetyLimit = 200;
    for (let safety = 0; safety < safetyLimit && currentId; safety += 1) {
      const node: AnalysisBranch["nodesById"][string] | undefined = nodesById[currentId];
      if (!node) break;
      const meta = parseFenMeta(fenBefore);
      const moveNo =
        Number.isFinite(meta?.fullmoveNumber) && (meta?.fullmoveNumber ?? 0) > 0
          ? (meta?.fullmoveNumber as number)
          : Number.isFinite(branch.anchorFullmoveNumber) && branch.anchorFullmoveNumber > 0
            ? branch.anchorFullmoveNumber
            : 1;
      const turn = meta?.turn ?? (branch.anchorTurn === "b" ? "b" : "w");
      const san = typeof node.san === "string" && node.san.trim().length > 0 ? node.san.trim() : "…";
      const text =
        turn === "w" ? `${moveNo}.${san}` : isFirst ? `${moveNo}...${san}` : san;
      tokens.push({ nodeId: node.id, text });
      fenBefore = node.fenAfter;
      isFirst = false;
      currentId = node.mainChildId ?? null;
    }
    return tokens;
  };

  const addLinesForParent = (parentId: string | null, fenBeforeChildMoves: string, depth: number) => {
    const parentKey = parentId ?? "root";
    if (processedParents.has(parentKey)) return;
    processedParents.add(parentKey);

    const children =
      parentId === null ? rootChildren : (Array.isArray(nodesById[parentId]?.children) ? nodesById[parentId]?.children : []);
    const mainChildId =
      parentId === null ? rootMainChildId : (nodesById[parentId]?.mainChildId ?? null);
    if (!children || children.length === 0) return;

    children.forEach(childId => {
      if (typeof childId !== "string" || childId.length === 0) return;
      if (childId === mainChildId) return;
      const tokens = buildLineFromStart(childId, fenBeforeChildMoves);
      if (tokens.length === 0) return;
      lines.push({
        key: `variation:${branch.anchorPly}:${parentKey}:${childId}`,
        depth,
        tokens,
      });
      tokens.forEach(token => {
        const node = nodesById[token.nodeId];
        if (!node) return;
        addLinesForParent(node.id, node.fenAfter, depth + 1);
      });
    });
  };

  addLinesForParent(null, startFen, 1);
  const mainTokens = buildMainLineTokens(branch);
  mainTokens.forEach(token => {
    const node = nodesById[token.nodeId];
    if (!node) return;
    addLinesForParent(node.id, node.fenAfter, 1);
  });
  return lines;
};

type AnalysisContextMenuState = {
  anchorPly: number;
  nodeId: string;
  x: number;
  y: number;
};

const RightPaneTabs = ({
  engineOn,
  setEngineOn,
  engineEval,
  engineLines,
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
  analysisViewActive,
  analysisBranches,
  activeAnalysisAnchorPly,
  analysisCursorNodeId,
  onExitAnalysisView,
  onSelectAnalysisMove,
  onPromoteAnalysisNode,
  onDeleteAnalysisLine,
  onDeleteAnalysisFromHere,
  plies,
  currentMoveIndex,
  onMoveSelect,
  boardNavigation,
  currentBoardId,
}: RightPaneTabsProps) => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const paneParam = searchParams?.get("pane");
  const resolvedPane: TabKey =
    paneParam === "boards" || paneParam === "live" || paneParam === "notation" ? paneParam : "notation";
  const [activeTab, setActiveTab] = useState<TabKey>(resolvedPane);
  const boardsPaneRef = useRef<HTMLDivElement | null>(null);
  const [boardsCompactMode, setBoardsCompactMode] = useState(false);
  const [boardsLockScroll, setBoardsLockScroll] = useState(false);
  useEffect(() => {
    setActiveTab(resolvedPane);
  }, [resolvedPane]);
  const notationScrollRef = useRef<HTMLDivElement | null>(null);
  const boardsData = boardNavigation ?? [];
  const debugEngineSwitcherEnabled = DEBUG_ENGINE_SWITCHER && typeof setEngineBackend === "function";
  const prevAnalysisActiveRef = useRef(Boolean(analysisViewActive));
  const [analysisContextMenu, setAnalysisContextMenu] = useState<AnalysisContextMenuState | null>(null);
  const analysisContextMenuRef = useRef<HTMLDivElement | null>(null);
  const canShowAnalysisContextMenu =
    typeof onPromoteAnalysisNode === "function" &&
    typeof onDeleteAnalysisLine === "function" &&
    typeof onDeleteAnalysisFromHere === "function";

  const closeAnalysisContextMenu = useCallback(() => {
    setAnalysisContextMenu(null);
  }, []);

  useEffect(() => {
    if (!analysisContextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        closeAnalysisContextMenu();
        return;
      }
      if (analysisContextMenuRef.current?.contains(target)) return;
      closeAnalysisContextMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAnalysisContextMenu();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [analysisContextMenu, closeAnalysisContextMenu]);

  const openAnalysisContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, anchorPly: number, nodeId: string) => {
      if (!canShowAnalysisContextMenu) return;
      event.preventDefault();
      event.stopPropagation();
      const rawX = typeof event.clientX === "number" ? event.clientX : 0;
      const rawY = typeof event.clientY === "number" ? event.clientY : 0;
      const padding = 8;
      const menuWidth = 176;
      const menuHeight = 124;
      const maxX = typeof window !== "undefined" ? window.innerWidth - menuWidth - padding : rawX;
      const maxY = typeof window !== "undefined" ? window.innerHeight - menuHeight - padding : rawY;
      const x = Math.max(padding, Math.min(rawX, maxX));
      const y = Math.max(padding, Math.min(rawY, maxY));
      setAnalysisContextMenu({ anchorPly, nodeId, x, y });
    },
    [canShowAnalysisContextMenu]
  );

  const analysisInsertions = useMemo(() => {
    if (!analysisBranches || analysisBranches.length === 0) return [];
    const entries: Array<NotationInsertion | null> = analysisBranches
      .filter(branch => typeof branch === "object" && branch !== null)
      .map(branch => {
        const mainTokens = buildMainLineTokens(branch);
        const variationLines = collectVariationLines(branch);
        if (mainTokens.length === 0 && variationLines.length === 0) return null;
        const isActiveBranch =
          Boolean(analysisViewActive) && typeof activeAnalysisAnchorPly === "number" && activeAnalysisAnchorPly === branch.anchorPly;
        const selectedNodeId = isActiveBranch ? analysisCursorNodeId ?? null : null;
        const selectMove = typeof onSelectAnalysisMove === "function" ? onSelectAnalysisMove : null;
        return {
          key: `analysis-${branch.anchorPly}`,
          afterPlyIndex: branch.anchorPly,
          content: (
            <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2 px-3 py-2">
              {selectMove ? (
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    selectMove(branch.anchorPly, null);
                  }}
                  aria-label="Jump to analysis start"
                  className={`text-[11px] font-semibold transition ${
                    isActiveBranch && !selectedNodeId ? "text-slate-200" : "text-slate-500 hover:text-slate-200"
                  }`}
                >
                  ↳
                </button>
              ) : (
                <span className="text-[11px] font-semibold text-slate-500" aria-hidden>
                  ↳
                </span>
              )}
              <div
                className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${
                  isActiveBranch
                    ? "border-sky-200/20 bg-white/5"
                    : "border-white/10 bg-transparent"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1 text-xs leading-relaxed text-slate-200/90 sm:text-sm">
                    <div>
                      {mainTokens.map((token, idx) => {
                        const isSelected = isActiveBranch && selectedNodeId === token.nodeId;
                        const baseClasses = "inline-flex items-baseline rounded px-1 py-0.5 transition";
                        const clickableClasses = selectMove
                          ? "hover:bg-white/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                          : "";
                        const selectedClasses = isSelected ? "bg-white/10 underline" : "";
                        const className = `${baseClasses} ${clickableClasses} ${selectedClasses}`.trim();
                        return (
                          <Fragment key={`${branch.anchorPly}-${token.nodeId}`}>
                            {selectMove ? (
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  closeAnalysisContextMenu();
                                  selectMove(branch.anchorPly, token.nodeId);
                                }}
                                onContextMenu={event => openAnalysisContextMenu(event, branch.anchorPly, token.nodeId)}
                                aria-current={isSelected ? "true" : undefined}
                                className={className}
                              >
                                {token.text}
                              </button>
                            ) : (
                              <span className={className}>{token.text}</span>
                            )}
                            {idx < mainTokens.length - 1 ? " " : null}
                          </Fragment>
                        );
                      })}
                    </div>
                    {variationLines.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {variationLines.map(line => (
                          <div
                            key={line.key}
                            style={{ marginLeft: Math.max(0, Math.min(line.depth, 6)) * 12 }}
                            className="border-l border-white/10 pl-3"
                          >
                            {line.tokens.map((token, idx) => {
                              const isSelected = isActiveBranch && selectedNodeId === token.nodeId;
                              const baseClasses = "inline-flex items-baseline rounded px-1 py-0.5 transition";
                              const clickableClasses = selectMove
                                ? "hover:bg-white/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                                : "";
                              const selectedClasses = isSelected ? "bg-white/10 underline" : "";
                              const className = `${baseClasses} ${clickableClasses} ${selectedClasses}`.trim();
                              return (
                                <Fragment key={`${line.key}-${token.nodeId}`}>
                                  {selectMove ? (
                                    <button
                                      type="button"
                                      onClick={event => {
                                        event.stopPropagation();
                                        closeAnalysisContextMenu();
                                        selectMove(branch.anchorPly, token.nodeId);
                                      }}
                                      onContextMenu={event => openAnalysisContextMenu(event, branch.anchorPly, token.nodeId)}
                                      aria-current={isSelected ? "true" : undefined}
                                      className={className}
                                    >
                                      {token.text}
                                    </button>
                                  ) : (
                                    <span className={className}>{token.text}</span>
                                  )}
                                  {idx < line.tokens.length - 1 ? " " : null}
                                </Fragment>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {isActiveBranch && typeof onExitAnalysisView === "function" ? (
                  <button
                    type="button"
                    onClick={onExitAnalysisView}
                    className="ml-auto rounded-full border border-white/15 bg-slate-900/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white transition hover:border-sky-200/40 hover:bg-slate-900"
                  >
                    LIVE
                  </button>
                ) : null}
              </div>
            </div>
          ),
        };
      })
    return entries.filter((entry): entry is NotationInsertion => entry !== null);
  }, [
    activeAnalysisAnchorPly,
    analysisBranches,
    analysisCursorNodeId,
    analysisViewActive,
    closeAnalysisContextMenu,
    onExitAnalysisView,
    onSelectAnalysisMove,
    openAnalysisContextMenu,
  ]);

  const resolvedPlies = useMemo(
    () => (plies && plies.length > 0 ? plies : WORLD_CUP_DEMO_PLIES),
    [plies]
  );

  const profileId: EngineProfileId = engineProfileId ?? engineProfile?.id ?? "standard";
  const displayMultiPv =
    typeof multiPv === "number" && Number.isFinite(multiPv)
      ? multiPv
      : 1;
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

  const handleMoveClick = useCallback((plyIdx: number) => {
    if (typeof plyIdx !== "number" || Number.isNaN(plyIdx)) return;
    if (plyIdx < 0) {
      onMoveSelect(-1);
      return;
    }
    const maxIndex = resolvedPlies.length > 0 ? resolvedPlies.length - 1 : -1;
    onMoveSelect(Math.min(plyIdx, maxIndex));
  }, [onMoveSelect, resolvedPlies.length]);

  const handleTabChange = useCallback((nextTab: TabKey) => {
    setActiveTab(nextTab);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("pane", nextTab);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const wasActive = prevAnalysisActiveRef.current;
    const isActive = Boolean(analysisViewActive);
    prevAnalysisActiveRef.current = isActive;
    if (!isActive || wasActive) return;
    if (activeTab === "notation") return;
    handleTabChange("notation");
  }, [activeTab, analysisViewActive, handleTabChange]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px) and (max-height: 900px)");
    const apply = () => setBoardsCompactMode(media.matches);
    apply();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", apply);
    } else {
      media.addListener(apply);
    }
    return () => {
      if (typeof media.removeEventListener === "function") {
        media.removeEventListener("change", apply);
      } else {
        media.removeListener(apply);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeTab !== "boards") return;
    const container = boardsPaneRef.current;
    if (!container) return;

    const update = () => {
      const fits = container.scrollHeight <= container.clientHeight + 1;
      setBoardsLockScroll(boardsData.length <= 8 && fits);
    };

    update();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => update());
      ro.observe(container);
    }
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activeTab, boardsData.length, boardsCompactMode]);

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 shadow-sm">
      <div className="flex flex-none gap-2 overflow-x-auto rounded-t-2xl bg-slate-900/60 px-2 py-1.5 backdrop-blur lg:overflow-visible lg:px-3 lg:py-0.5">
        <TabButton
          label="Notation"
          active={activeTab === "notation"}
          onClick={() => handleTabChange("notation")}
        />
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

      <div className="mt-1 flex-1 min-h-0 pr-0 sm:pr-2">
        {activeTab !== "boards" ? (
          <div className="px-3 pb-2">
            <StockfishPanel
              enabled={engineOn}
              evalResult={engineEval ?? null}
              lines={engineLines ?? []}
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
            <div className="flex min-h-0 flex-1 flex-col gap-3 pb-3">
              <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/10 bg-slate-950/40 shadow-inner">
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
                      insertions={analysisInsertions}
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
          <div
            ref={boardsPaneRef}
            className={`flex h-full min-h-0 flex-col overflow-x-hidden ${
              boardsLockScroll ? "overflow-hidden" : "overflow-y-auto"
            }`}
          >
            <div className={`flex flex-col ${boardsCompactMode ? "px-2 pb-2" : "px-3 pb-3"}`}>
              <BoardsNavigation
                boards={boardsData}
                currentBoardId={currentBoardId}
                paneQuery={activeTab}
                compact={boardsCompactMode}
              />
            </div>
          </div>
        )}
      </div>

      {analysisContextMenu && canShowAnalysisContextMenu ? (
        <div
          ref={analysisContextMenuRef}
          role="menu"
          className="fixed z-50 w-44 overflow-hidden rounded-xl border border-white/10 bg-slate-950/95 shadow-lg backdrop-blur"
          style={{ left: analysisContextMenu.x, top: analysisContextMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/5"
            onClick={event => {
              event.stopPropagation();
              onPromoteAnalysisNode!(analysisContextMenu.anchorPly, analysisContextMenu.nodeId);
              closeAnalysisContextMenu();
            }}
          >
            Promote
          </button>
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/5"
            onClick={event => {
              event.stopPropagation();
              onDeleteAnalysisLine!(analysisContextMenu.anchorPly, analysisContextMenu.nodeId);
              closeAnalysisContextMenu();
            }}
          >
            Delete line
          </button>
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/5"
            onClick={event => {
              event.stopPropagation();
              onDeleteAnalysisFromHere!(analysisContextMenu.anchorPly, analysisContextMenu.nodeId);
              closeAnalysisContextMenu();
            }}
          >
            Delete from here
          </button>
        </div>
      ) : null}
    </section>
  );
};

export default RightPaneTabs;

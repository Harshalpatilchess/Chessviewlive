"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";

import type { Ply } from "@/lib/chess/pgn";

type NotationInsertion = { afterPlyIndex: number; content: ReactNode; key?: string };

type NotationListProps = {
  plies: Ply[];
  currentMoveIndex: number;
  onMoveClick: (index: number) => void;
  notationCenterRequestToken?: number;
  scrollContainerRef?: RefObject<HTMLDivElement | null> | null;
  hideHeader?: boolean;
  headerSelector?: string | null;
  renderContainer?: boolean;
  insertions?: NotationInsertion[] | null;
};

type NotationRow = {
  moveNumber: number;
  whiteSan?: string;
  whitePlyIndex?: number;
  blackSan?: string;
  blackPlyIndex?: number;
};

type NotationRenderItem =
  | { kind: "row"; key: string; row: NotationRow }
  | { kind: "insertion"; key: string; content: ReactNode };

const ESTIMATED_ROW_HEIGHT_PX = 32;
const ESTIMATED_INSERTION_HEIGHT_PX = 84;
const OVERSCAN_PX = 360;
const INITIAL_RENDER_COUNT = 80;
const CENTER_BAND_TOP_RATIO = 0.4;
const CENTER_BAND_BOTTOM_RATIO = 0.6;
const LARGE_JUMP_PLY_DELTA = 6;
const SMOOTH_SCROLL_MAX_PLY_DELTA = 2;
const USER_SCROLL_SUPPRESS_MS = 700;
const SCROLLBAR_DRAG_ZONE_PX = 18;
const ACTIVE_ROW_SELECTOR = '[data-notation-active-row="true"]';

const findIndexForOffset = (prefixOffsets: number[], offset: number) => {
  const maxIndex = Math.max(prefixOffsets.length - 2, 0);
  const clamped = Math.max(0, offset);
  let low = 0;
  let high = prefixOffsets.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (prefixOffsets[mid] <= clamped) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return Math.min(Math.max(low - 1, 0), maxIndex);
};

function NotationList({
  plies,
  currentMoveIndex,
  onMoveClick,
  notationCenterRequestToken,
  scrollContainerRef,
  hideHeader = false,
  headerSelector,
  renderContainer = true,
  insertions,
}: NotationListProps) {
  const compactRows = useMemo(() => {
    const rows: NotationRow[] = [];
    plies.forEach((ply, index) => {
      const moveNumber = typeof ply.moveNo === "number" ? ply.moveNo : Math.floor(index / 2) + 1;
      const rowIndex = Math.max(0, moveNumber - 1);
      if (!rows[rowIndex]) {
        rows[rowIndex] = { moveNumber };
      }
      const target = rows[rowIndex];
      if (ply.color === "w") {
        target.whiteSan = ply.san;
        target.whitePlyIndex = index;
      } else {
        target.blackSan = ply.san;
        target.blackPlyIndex = index;
      }
    });
    return rows.filter((row): row is NotationRow => Boolean(row));
  }, [plies]);

  const activePlyIndex = typeof currentMoveIndex === "number" ? currentMoveIndex : -1;
  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = scrollContainerRef ?? internalContainerRef;

  const header = hideHeader ? null : (
    <div className="notation-header grid grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 border-b border-white/5 bg-slate-900 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-200">
      <span>#</span>
      <span>White</span>
      <span>Black</span>
    </div>
  );

  const { items, plyIndexToItemIndex } = useMemo(() => {
    const normalizedInsertions = Array.isArray(insertions) ? insertions.filter(Boolean) : [];
    const insertionsBeforeFirst = normalizedInsertions.filter(
      insertion =>
        typeof insertion.afterPlyIndex === "number" &&
        Number.isFinite(insertion.afterPlyIndex) &&
        insertion.afterPlyIndex < 0
    );
    const insertionsByPlyIndex = new Map<number, NotationInsertion[]>();
    normalizedInsertions.forEach(insertion => {
      const key = insertion.afterPlyIndex;
      if (typeof key !== "number" || !Number.isFinite(key) || key < 0) return;
      const existing = insertionsByPlyIndex.get(key) ?? [];
      existing.push(insertion);
      insertionsByPlyIndex.set(key, existing);
    });

    const nextItems: NotationRenderItem[] = [];
    insertionsBeforeFirst.forEach((insertion, idx) => {
      nextItems.push({
        kind: "insertion",
        key: insertion.key ?? `before-${insertion.afterPlyIndex}-${idx}`,
        content: insertion.content,
      });
    });

    const mapping = new Map<number, number>();
    compactRows.forEach(row => {
      const rowItemIndex = nextItems.length;
      nextItems.push({ kind: "row", key: `row-${row.moveNumber}`, row });
      if (typeof row.whitePlyIndex === "number") mapping.set(row.whitePlyIndex, rowItemIndex);
      if (typeof row.blackPlyIndex === "number") mapping.set(row.blackPlyIndex, rowItemIndex);

      const insertionsAfterRow: NotationInsertion[] = [];
      if (typeof row.whitePlyIndex === "number") {
        const matches = insertionsByPlyIndex.get(row.whitePlyIndex);
        if (matches && matches.length > 0) insertionsAfterRow.push(...matches);
      }
      if (typeof row.blackPlyIndex === "number") {
        const matches = insertionsByPlyIndex.get(row.blackPlyIndex);
        if (matches && matches.length > 0) insertionsAfterRow.push(...matches);
      }

      insertionsAfterRow.forEach((insertion, idx) => {
        nextItems.push({
          kind: "insertion",
          key: insertion.key ?? `after-${row.moveNumber}-${insertion.afterPlyIndex}-${idx}`,
          content: insertion.content,
        });
      });
    });

    return { items: nextItems, plyIndexToItemIndex: mapping };
  }, [compactRows, insertions]);

  const measuredInsertionHeightsByKeyRef = useRef<Map<string, number>>(new Map());
  const [rowHeightPx, setRowHeightPx] = useState(ESTIMATED_ROW_HEIGHT_PX);
  const [insertionHeightsVersion, setInsertionHeightsVersion] = useState(0);
  const rangeStartIndexRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let raf = 0;
    const updateScrollTop = () => {
      setScrollTop(container.scrollTop);
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        updateScrollTop();
      });
    };

    const updateViewportHeight = () => {
      setViewportHeight(container.clientHeight);
      updateScrollTop();
    };

    updateViewportHeight();
    container.addEventListener("scroll", onScroll, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => updateViewportHeight());
      ro.observe(container);
    } else {
      window.addEventListener("resize", updateViewportHeight);
    }

    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", updateViewportHeight);
    };
  }, [containerRef]);

  const itemHeights = useMemo(() => {
    void insertionHeightsVersion;
    const insertionMap = measuredInsertionHeightsByKeyRef.current;
    return items.map(item => {
      if (item.kind === "row") return rowHeightPx;
      return insertionMap.get(item.key) ?? ESTIMATED_INSERTION_HEIGHT_PX;
    });
  }, [items, insertionHeightsVersion, rowHeightPx]);

  const prefixOffsets = useMemo(() => {
    const offsets = new Array(items.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < items.length; i += 1) {
      offsets[i + 1] = offsets[i] + itemHeights[i]!;
    }
    return offsets;
  }, [itemHeights, items.length]);

  const totalHeight = prefixOffsets[items.length] ?? 0;

  const [rangeStartIndex, rangeEndIndex] = useMemo(() => {
    if (items.length === 0) return [0, 0];
    if (viewportHeight <= 0) return [0, Math.min(items.length, INITIAL_RENDER_COUNT)];

    const startOffset = Math.max(0, scrollTop - OVERSCAN_PX);
    const endOffset = scrollTop + viewportHeight + OVERSCAN_PX;
    const start = findIndexForOffset(prefixOffsets, startOffset);
    const end = Math.min(items.length, findIndexForOffset(prefixOffsets, endOffset) + 1);
    return [start, Math.max(end, start + 1)];
  }, [items.length, prefixOffsets, scrollTop, viewportHeight]);

  rangeStartIndexRef.current = rangeStartIndex;

  const topPadding = prefixOffsets[rangeStartIndex] ?? 0;
  const bottomPadding = Math.max(totalHeight - (prefixOffsets[rangeEndIndex] ?? 0), 0);

  const measureItemRef = useCallback(
    (node: HTMLDivElement | null, item: NotationRenderItem, itemIndex: number) => {
      if (!node) return;
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (!Number.isFinite(height) || height <= 0) return;
      if (item.kind === "row") {
        if (Math.abs(rowHeightPx - height) <= 1) return;
        setRowHeightPx(height);
        return;
      }

      const map = measuredInsertionHeightsByKeyRef.current;
      const previous = map.get(item.key) ?? ESTIMATED_INSERTION_HEIGHT_PX;
      if (Math.abs(previous - height) <= 1) return;
      map.set(item.key, height);

      const delta = height - previous;
      const container = containerRef.current;
      if (container && delta !== 0 && itemIndex < rangeStartIndexRef.current) {
        container.scrollTop = container.scrollTop + delta;
        setScrollTop(container.scrollTop);
      }
      setInsertionHeightsVersion(version => version + 1);
    },
    [containerRef, rowHeightPx]
  );

  const headerSelectorValue =
    headerSelector === undefined ? ".notation-header" : headerSelector;
  const hasCenteredOnceRef = useRef(false);
  const previousActivePlyRef = useRef<number | null>(null);
  const lastManualCenterRequestTokenRef = useRef<number | null>(
    typeof notationCenterRequestToken === "number" ? notationCenterRequestToken : null
  );
  const userScrollSuppressUntilRef = useRef(0);
  const suppressionTimerRef = useRef<number | null>(null);
  const scrollbarDragActiveRef = useRef(false);
  const [suppressionVersion, setSuppressionVersion] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const markUserScroll = () => {
      const now = Date.now();
      userScrollSuppressUntilRef.current = now + USER_SCROLL_SUPPRESS_MS;
      if (suppressionTimerRef.current) {
        window.clearTimeout(suppressionTimerRef.current);
      }
      suppressionTimerRef.current = window.setTimeout(() => {
        suppressionTimerRef.current = null;
        setSuppressionVersion(version => version + 1);
      }, USER_SCROLL_SUPPRESS_MS);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      const rect = container.getBoundingClientRect();
      if (event.clientX < rect.right - SCROLLBAR_DRAG_ZONE_PX) return;
      scrollbarDragActiveRef.current = true;
      markUserScroll();
    };
    const clearPointerDrag = () => {
      scrollbarDragActiveRef.current = false;
    };
    const handleContainerScroll = () => {
      if (!scrollbarDragActiveRef.current) return;
      markUserScroll();
    };

    container.addEventListener("wheel", markUserScroll, { passive: true });
    container.addEventListener("touchstart", markUserScroll, { passive: true });
    container.addEventListener("touchmove", markUserScroll, { passive: true });
    container.addEventListener("pointerdown", handlePointerDown, { passive: true });
    container.addEventListener("scroll", handleContainerScroll, { passive: true });
    window.addEventListener("pointerup", clearPointerDrag, { passive: true });
    window.addEventListener("pointercancel", clearPointerDrag, { passive: true });

    return () => {
      container.removeEventListener("wheel", markUserScroll);
      container.removeEventListener("touchstart", markUserScroll);
      container.removeEventListener("touchmove", markUserScroll);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("scroll", handleContainerScroll);
      window.removeEventListener("pointerup", clearPointerDrag);
      window.removeEventListener("pointercancel", clearPointerDrag);
      scrollbarDragActiveRef.current = false;
      if (suppressionTimerRef.current) {
        window.clearTimeout(suppressionTimerRef.current);
        suppressionTimerRef.current = null;
      }
    };
  }, [containerRef]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const raf = window.requestAnimationFrame(() => {
      const centerRequestToken =
        typeof notationCenterRequestToken === "number" ? notationCenterRequestToken : null;
      const manualCenterRequested =
        centerRequestToken !== null &&
        centerRequestToken !== lastManualCenterRequestTokenRef.current;
      if (centerRequestToken !== null) {
        lastManualCenterRequestTokenRef.current = centerRequestToken;
      }

      if (activePlyIndex < 0) {
        previousActivePlyRef.current = activePlyIndex;
        if (container.scrollTop !== 0) {
          container.scrollTop = 0;
          setScrollTop(0);
        }
        return;
      }

      const itemIndex = plyIndexToItemIndex.get(activePlyIndex);
      if (typeof itemIndex !== "number" || !Number.isFinite(itemIndex)) return;

      const headerEl =
        typeof headerSelectorValue === "string" && headerSelectorValue.length > 0
          ? container.querySelector<HTMLElement>(headerSelectorValue)
          : null;
      const headerHeight = headerEl?.getBoundingClientRect().height ?? 0;
      const activeRowEl = container.querySelector<HTMLElement>(ACTIVE_ROW_SELECTOR);
      let itemTop = prefixOffsets[itemIndex] ?? 0;
      let itemHeight = itemHeights[itemIndex] ?? ESTIMATED_ROW_HEIGHT_PX;

      if (activeRowEl) {
        const rowRect = activeRowEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (rowRect.height > 0) {
          itemTop = rowRect.top - containerRect.top + container.scrollTop;
          itemHeight = rowRect.height;
        }
      }

      const itemMidpoint = itemTop + itemHeight / 2;
      const visibleTop = container.scrollTop + headerHeight;
      const visibleBottom = container.scrollTop + container.clientHeight;
      const visibleHeight = Math.max(visibleBottom - visibleTop, 0);
      const previousActivePly = previousActivePlyRef.current;
      const jumpDistance =
        typeof previousActivePly === "number" && previousActivePly >= 0
          ? Math.abs(activePlyIndex - previousActivePly)
          : LARGE_JUMP_PLY_DELTA + 1;

      if (!manualCenterRequested && userScrollSuppressUntilRef.current > Date.now()) {
        previousActivePlyRef.current = activePlyIndex;
        return;
      }

      const shouldForceCenter =
        manualCenterRequested || !hasCenteredOnceRef.current || jumpDistance >= LARGE_JUMP_PLY_DELTA;
      const useSmoothScroll =
        !manualCenterRequested &&
        !shouldForceCenter &&
        jumpDistance > 0 &&
        jumpDistance <= SMOOTH_SCROLL_MAX_PLY_DELTA;
      previousActivePlyRef.current = activePlyIndex;
      const bandTop = visibleTop + visibleHeight * CENTER_BAND_TOP_RATIO;
      const bandBottom = visibleTop + visibleHeight * CENTER_BAND_BOTTOM_RATIO;
      const outsideCenterBand = itemMidpoint < bandTop || itemMidpoint > bandBottom;
      if (!shouldForceCenter && !outsideCenterBand) {
        return;
      }

      const visibleCenter = headerHeight + (container.clientHeight - headerHeight) / 2;
      const desiredScrollTop = itemMidpoint - visibleCenter;
      const maxScrollTop = Math.max(totalHeight - container.clientHeight, 0);
      const nextScrollTop = Math.min(Math.max(desiredScrollTop, 0), maxScrollTop);
      if (Math.abs(container.scrollTop - nextScrollTop) > 1) {
        container.scrollTo({
          top: nextScrollTop,
          behavior: useSmoothScroll ? "smooth" : "auto",
        });
        if (!useSmoothScroll) {
          setScrollTop(nextScrollTop);
        }
      }
      hasCenteredOnceRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [
    activePlyIndex,
    containerRef,
    headerSelectorValue,
    itemHeights,
    notationCenterRequestToken,
    plyIndexToItemIndex,
    prefixOffsets,
    suppressionVersion,
    totalHeight,
  ]);

  const renderedItems = items.slice(rangeStartIndex, rangeEndIndex);
  const rowsViewportStyle = viewportHeight > 0 ? { minHeight: viewportHeight } : undefined;

  const rowsContent = (
    <div className="flex min-h-full flex-col justify-end text-sm text-slate-100" style={rowsViewportStyle}>
      {topPadding > 0 ? <div aria-hidden style={{ height: topPadding }} /> : null}
      <div className="divide-y divide-white/5">
        {renderedItems.map((item, localIndex) => {
          const itemIndex = rangeStartIndex + localIndex;
          if (item.kind === "insertion") {
            return (
              <div
                key={item.key}
                ref={node => measureItemRef(node, item, itemIndex)}
              >
                {item.content}
              </div>
            );
          }

          const row = item.row;
          const isWhiteActive =
            typeof row.whitePlyIndex === "number" && row.whitePlyIndex === activePlyIndex;
          const isBlackActive =
            typeof row.blackPlyIndex === "number" && row.blackPlyIndex === activePlyIndex;
          const isCurrentRow = isWhiteActive || isBlackActive;

          return (
            <div
              key={item.key}
              ref={node => measureItemRef(node, item, itemIndex)}
              aria-current={isCurrentRow ? "true" : undefined}
              data-notation-active-row={isCurrentRow ? "true" : undefined}
              className={`grid w-full grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 text-left text-xs leading-5 transition-colors sm:text-sm ${
                isCurrentRow
                  ? "border-l-2 border-amber-400/80 bg-white/5"
                  : "border-l-2 border-transparent hover:bg-white/5"
              }`}
            >
              <span
                className={`font-semibold ${
                  isCurrentRow ? "text-amber-200" : "text-slate-400"
                } ${typeof row.whitePlyIndex === "number" ? "cursor-pointer" : "cursor-default"} flex items-center gap-1 leading-5`}
                onClick={() => {
                  if (typeof row.whitePlyIndex === "number") {
                    onMoveClick(row.whitePlyIndex);
                  }
                }}
              >
                {row.moveNumber}.
              </span>
              <span
                className={`truncate px-2 py-1 leading-5 ${
                  isWhiteActive ? "rounded-md bg-amber-500/20 font-semibold text-amber-100" : "text-white/90"
                } ${typeof row.whitePlyIndex === "number" ? "cursor-pointer" : "cursor-default"}`}
                onClick={() => {
                  if (typeof row.whitePlyIndex === "number") {
                    onMoveClick(row.whitePlyIndex);
                  }
                }}
              >
                {row.whiteSan ?? "—"}
              </span>
              <span
                className={`truncate px-2 py-1 leading-5 ${
                  isBlackActive ? "rounded-md bg-amber-500/20 font-semibold text-amber-100" : "text-white/90"
                } ${typeof row.blackPlyIndex === "number" ? "cursor-pointer" : "cursor-default"}`}
                onClick={() => {
                  if (typeof row.blackPlyIndex === "number") {
                    onMoveClick(row.blackPlyIndex);
                  }
                }}
              >
                {row.blackSan ?? "—"}
              </span>
            </div>
          );
        })}
      </div>
      {bottomPadding > 0 ? <div aria-hidden style={{ height: bottomPadding }} /> : null}
    </div>
  );
  const rootContainerClassName = "flex h-full min-h-0 flex-col";
  const scrollRegionClassName = "flex-1 min-h-0 overflow-y-auto";
  const scrollRegionNode = scrollContainerRef ? (
    <div className="flex-1 min-h-0">
      {rowsContent}
    </div>
  ) : (
    <div ref={containerRef} className={scrollRegionClassName}>
      {rowsContent}
    </div>
  );

  if (!renderContainer) {
    return (
      <div className={rootContainerClassName}>
        {header}
        {scrollRegionNode}
      </div>
    );
  }

  return (
    <div className="mt-1">
      <div className="rounded-xl border border-white/10 bg-slate-950/40 shadow-inner">
        <div className={rootContainerClassName}>
          {header}
          {scrollRegionNode}
        </div>
      </div>
    </div>
  );
}

export default memo(NotationList);

"use client";

import { useEffect, type RefObject } from "react";

type UseCenteredNotationScrollOptions = {
  /**
   * Active index for dependency updates. Typically the current ply index.
   */
  activeIndex: number;
  /**
   * Optional selector to measure any fixed header inside the container.
   */
  headerSelector?: string | null;
};

/**
 * Keeps the active notation row near the vertical center of a scrollable container,
 * clamped to the container bounds to avoid jumps to the very top or bottom.
 */
export function useCenteredNotationScroll(
  containerRef: RefObject<HTMLElement | null>,
  rowRef: RefObject<HTMLElement | null>,
  { activeIndex, headerSelector = ".notation-header" }: UseCenteredNotationScrollOptions
) {
  useEffect(() => {
    const container = containerRef.current;
    const row = rowRef.current;
    if (!container || !row) return;

    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const header =
      typeof headerSelector === "string" && headerSelector.length > 0
        ? container.querySelector<HTMLElement>(headerSelector)
        : null;
    const headerHeight = header?.getBoundingClientRect().height ?? 0;

    const rowCenter =
      rowRect.top - containerRect.top + container.scrollTop + rowRect.height / 2;
    const visibleCenter = headerHeight + (container.clientHeight - headerHeight) / 2;
    const desiredScrollTop = rowCenter - visibleCenter;

    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
    const clampedScrollTop = Math.min(Math.max(desiredScrollTop, 0), maxScrollTop);

    if (Math.abs(container.scrollTop - clampedScrollTop) > 1) {
      container.scrollTop = clampedScrollTop;
    }
  }, [activeIndex, containerRef, headerSelector, rowRef]);
}

export default useCenteredNotationScroll;

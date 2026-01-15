"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type BoardsFilterRowProps = {
  totalCount: number;
  rawCount: number;
  playingCount: number;
  page: number;
  status: "live" | "all" | "finished";
  pageCount: number;
};

const STATUS_OPTIONS = [
  { key: "live", label: "Live" },
  { key: "all", label: "All" },
  { key: "finished", label: "Finished" },
] as const;

export const BoardsFilterRow = ({
  totalCount,
  rawCount,
  playingCount,
  page,
  status,
  pageCount,
}: BoardsFilterRowProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [searchValue, setSearchValue] = useState(() => searchParams.get("search") ?? "");
  const [showLiveTooltip, setShowLiveTooltip] = useState(false);
  const livePillRef = useRef<HTMLSpanElement | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateQuery = useCallback(
    (updates: Record<string, string | number | null>, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });

      const query = params.toString();
      const href = query ? `${pathname}?${query}` : pathname;
      if (options?.replace) {
        router.replace(href);
      } else {
        router.push(href);
      }
    },
    [router, pathname, searchParams]
  );

  useEffect(() => {
    if (rawCount <= 0 || totalCount > 0) return;
    if (status !== "live") return;
    if (playingCount > 0) return;
    updateQuery({ status: "all", page: 1 }, { replace: true });
  }, [playingCount, rawCount, status, totalCount, updateQuery]);

  useEffect(() => {
    const rawStatus = searchParams.get("status");
    if (!rawStatus) return;
    const normalized = rawStatus.trim().toLowerCase();
    if (normalized === "playing" || normalized === "live") {
      updateQuery({ status: "live", page: 1 }, { replace: true });
      return;
    }
    if (normalized === "finished" || normalized === "results") {
      updateQuery({ status: "finished", page: 1 }, { replace: true });
    }
  }, [searchParams, updateQuery]);

  useEffect(() => {
    const pageParam = searchParams.get("page");
    if (!pageParam) return;
    const parsed = Number(pageParam);
    if (!Number.isFinite(parsed) || parsed < 1) {
      updateQuery({ page: 1 }, { replace: true });
      return;
    }
    if (pageCount <= 1 && parsed !== 1) {
      updateQuery({ page: 1 }, { replace: true });
      return;
    }
    if (parsed > pageCount) {
      updateQuery({ page: 1 }, { replace: true });
    }
  }, [pageCount, searchParams, updateQuery]);

  useEffect(() => {
    const nextValue = searchParams.get("search") ?? "";
    setSearchValue(prev => (prev === nextValue ? prev : nextValue));
  }, [searchParams]);

  useEffect(() => {
    if (!showLiveTooltip) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (livePillRef.current?.contains(event.target as Node)) return;
      setShowLiveTooltip(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showLiveTooltip]);

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  const handleStatusClick = (nextStatus: (typeof STATUS_OPTIONS)[number]["key"]) => {
    if (nextStatus === "live" && playingCount === 0) {
      setShowLiveTooltip(true);
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
      tooltipTimeoutRef.current = setTimeout(() => {
        setShowLiveTooltip(false);
      }, 2000);
      if (status !== "all") {
        updateQuery({ status: "all", page: 1 }, { replace: true });
      }
      return;
    }
    setShowLiveTooltip(false);
    updateQuery({ status: nextStatus, page: 1 });
  };

  return (
    <div className="flex min-h-[48px] flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-0.5 text-xs font-semibold text-slate-100 overflow-visible">
          {STATUS_OPTIONS.map(option => {
            const isActive = status === option.key;
            return (
              <span key={option.key} className="relative overflow-visible" ref={option.key === "live" ? livePillRef : undefined}>
                <button
                  type="button"
                  onClick={() => handleStatusClick(option.key)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                    isActive
                      ? "border border-emerald-300/70 bg-emerald-400/20 text-emerald-50 shadow-sm"
                      : "border border-transparent text-slate-200 hover:text-white"
                  }`}
                  aria-pressed={isActive}
                >
                  {option.label}
                </button>
                {option.key === "live" && showLiveTooltip ? (
                  <span className="pointer-events-none absolute bottom-full left-0 mb-2 whitespace-nowrap rounded-lg border border-white/10 bg-slate-950/95 px-3 py-1.5 text-[11px] font-semibold text-slate-100 shadow-lg z-50">
                    No live games right now
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
      <div className="flex w-full min-w-[200px] items-center justify-end sm:ml-auto sm:w-64 shrink-0">
        <Search className="mr-2 h-3.5 w-3.5 text-slate-100" aria-hidden />
        <input
          type="search"
          value={searchValue}
          onChange={event => {
            const nextValue = event.target.value;
            setSearchValue(nextValue);
            updateQuery({ search: nextValue.trim() ? nextValue : null, page: 1 }, { replace: true });
          }}
          placeholder="Search player..."
          aria-label="Search player"
          className="h-6 w-full rounded-full border border-white/25 bg-white/10 px-2.5 text-[11px] font-semibold text-slate-100 placeholder:text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
      </div>
    </div>
  );
};

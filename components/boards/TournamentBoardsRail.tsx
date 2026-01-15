"use client";

import Link from "next/link";
import { LayoutGrid, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Flag from "@/components/live/Flag";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import { formatChessClockMs } from "@/lib/live/clockFormat";
import { buildBroadcastBoardPath } from "@/lib/paths";

type TournamentBoardsRailProps = {
  boards: BoardNavigationEntry[];
  tournamentSlug: string;
  mode: "live" | "replay";
  variant?: "overlay" | "pinned";
  selectedBoardId?: string;
  debug?: boolean;
};

const normalizeResultValue = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "*" || trimmed === "\u00b7") return null;
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.includes("\u00bd")) return "1/2-1/2";
  if (compact === "1/2-1/2") return "1/2-1/2";
  return compact;
};

const getBoardStatusLabel = (entry: BoardNavigationEntry): string => {
  const normalizedResult = normalizeResultValue(entry.result);
  if (entry.status === "final" && normalizedResult) return normalizedResult;
  if (entry.status === "live") return "Live";
  if (entry.status === "scheduled") return "Scheduled";
  if (!entry.status || entry.status === "unknown") {
    return normalizedResult ?? "—";
  }
  return normalizedResult ?? "—";
};

export const TournamentBoardsRail = ({
  boards,
  tournamentSlug,
  mode,
  variant = "overlay",
  selectedBoardId,
  debug = false,
}: TournamentBoardsRailProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const resolvedBoards = useMemo(() => boards ?? [], [boards]);

  useEffect(() => {
    if (variant !== "overlay" || !isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const boardList =
    resolvedBoards.length === 0 ? (
      <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-sm text-slate-400">
        No boards available for this round yet.
      </div>
    ) : (
      resolvedBoards.map((board, index) => {
        const whiteName = board.white?.name ?? "White";
        const blackName = board.black?.name ?? "Black";
        const whiteTitle = board.white?.title ?? null;
        const blackTitle = board.black?.title ?? null;
        const whiteRating = board.white?.rating ?? null;
        const blackRating = board.black?.rating ?? null;
        const whiteFlag = board.white?.flag ?? null;
        const blackFlag = board.black?.flag ?? null;
        const normalizedResult = normalizeResultValue(board.result);
        const displayResult = normalizedResult === "1/2-1/2" ? "\u00bd-\u00bd" : normalizedResult;
        const whiteHasClock = Number.isFinite(board.whiteTimeMs ?? NaN);
        const blackHasClock = Number.isFinite(board.blackTimeMs ?? NaN);
        const hasClockData = whiteHasClock || blackHasClock;
        const isLive = board.status === "live";
        const showClocks = isLive && hasClockData;
        const showResult = Boolean(displayResult) && !showClocks;
        const statusLabel = getBoardStatusLabel(board);
        const showStatus = !showClocks && !showResult && statusLabel !== "\u2014";
        const whiteClockLabel = showClocks && whiteHasClock ? formatChessClockMs(board.whiteTimeMs) : null;
        const blackClockLabel = showClocks && blackHasClock ? formatChessClockMs(board.blackTimeMs) : null;
        const boardHref = buildBroadcastBoardPath(board.boardId, mode, tournamentSlug);
        const isActive = selectedBoardId === board.boardId;

        return (
          <Link
            key={board.boardId}
            href={boardHref}
            className={`group relative flex items-stretch gap-2 rounded-2xl border bg-slate-950/70 px-2 py-2 text-sm text-slate-200 shadow-sm transition ${
              isActive
                ? "border-emerald-400/60 bg-emerald-400/10"
                : "border-white/10 hover:border-white/30 hover:bg-white/10"
            }`}
          >
            <div className="flex w-9 shrink-0 items-center justify-center">
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-200">
                #{board.boardNumber}
              </span>
            </div>
            {debug ? (
              <span className="absolute right-2 top-2 text-[9px] font-semibold text-slate-500">
                seq {index + 1}
              </span>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                {whiteFlag ? (
                  <Flag country={whiteFlag} className="text-base leading-none" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-white/10 bg-slate-800" aria-hidden />
                )}
                {whiteTitle ? (
                  <span className="rounded-full border border-amber-200/40 bg-amber-200/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                    {whiteTitle}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                  {whiteName}
                </span>
                {whiteRating ? (
                  <span className="ml-auto text-[11px] font-semibold tabular-nums text-slate-400">
                    {whiteRating}
                  </span>
                ) : null}
              </div>
              {showClocks ? (
                <div className="flex items-center justify-center gap-2">
                  {whiteClockLabel ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-300">
                      {whiteClockLabel}
                    </span>
                  ) : null}
                  {blackClockLabel ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-300">
                      {blackClockLabel}
                    </span>
                  ) : null}
                </div>
              ) : showResult ? (
                <div className="flex items-center justify-center">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                    {displayResult}
                  </span>
                </div>
              ) : showStatus ? (
                <div className="flex items-center justify-center">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                    {statusLabel}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                {blackFlag ? (
                  <Flag country={blackFlag} className="text-base leading-none" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-white/10 bg-slate-800" aria-hidden />
                )}
                {blackTitle ? (
                  <span className="rounded-full border border-amber-200/40 bg-amber-200/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                    {blackTitle}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                  {blackName}
                </span>
                {blackRating ? (
                  <span className="ml-auto text-[11px] font-semibold tabular-nums text-slate-400">
                    {blackRating}
                  </span>
                ) : null}
              </div>
            </div>
          </Link>
        );
      })
    );

  if (variant === "pinned") {
    return (
      <aside className="sticky top-4 rounded-2xl border border-white/10 bg-slate-950/70 p-2 shadow-sm">
        <div className="flex items-center gap-2 border-b border-white/10 px-2 pb-2 text-sm font-semibold text-slate-100">
          <LayoutGrid size={16} />
          <span>Boards</span>
        </div>
        <div className="flex max-h-[calc(100vh-160px)] flex-col gap-1.5 overflow-y-auto">
          {boardList}
        </div>
      </aside>
    );
  }

  return (
    <>
      <div className="pointer-events-none absolute -left-3 top-4 z-30">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open board navigation"
          aria-expanded={isOpen}
          className="pointer-events-auto flex h-16 w-10 flex-col items-center justify-center gap-1 rounded-full border border-white/10 bg-slate-950/80 text-slate-100 shadow-lg shadow-black/30 transition hover:border-white/30 hover:bg-slate-950/90"
        >
          <LayoutGrid size={16} />
          <span className="text-[10px] font-semibold">Boards</span>
        </button>
      </div>

      <div
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${
          isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          aria-label="Close board navigation"
          aria-hidden={!isOpen}
          tabIndex={isOpen ? 0 : -1}
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
        <aside
          aria-hidden={!isOpen}
          className={`relative z-10 h-full w-[320px] max-w-[85vw] border-r border-white/10 bg-slate-950/95 p-2 shadow-2xl transition-transform duration-300 ${
            isOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-2 pb-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <LayoutGrid size={16} />
              <span>Boards</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close board navigation"
              className="rounded-full border border-white/10 bg-white/5 p-1 text-slate-200 transition hover:border-white/30 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex max-h-[calc(100vh-120px)] flex-col gap-1.5 overflow-y-auto">
            {boardList}
          </div>
        </aside>
      </div>
    </>
  );
};

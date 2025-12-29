"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import Flag from "@/components/live/Flag";
import BroadcastReactBoard from "@/components/viewer/BroadcastReactBoard";
import useMiniBoardClock from "@/lib/live/useMiniBoardClock";
import type { GameResult } from "@/lib/tournamentManifest";
import type { BoardNavigationEntry, BoardNavigationPlayer } from "@/lib/boards/navigationTypes";

type BoardsNavigationCardProps = {
  board: BoardNavigationEntry;
  currentBoardId?: string;
  isActive?: boolean;
  paneQuery?: string;
  compact?: boolean;
  hrefBuilder?: (board: BoardNavigationEntry, options: { paneQuery: string; isFinished: boolean }) => string;
  onBoardClick?: (board: BoardNavigationEntry) => boolean | void;
};

const pillBase = "inline-flex items-center justify-center whitespace-nowrap rounded-md border font-semibold leading-tight";
const pillSm = "px-1.5 py-[2px] text-[9px]";
const pillMd = "px-2 py-[3px] text-[10px]";

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

const renderEvalFill = (evaluation?: number | null) => {
  if (evaluation === null || evaluation === undefined || Number.isNaN(evaluation)) {
    return 50;
  }
  const clamped = Math.max(-5, Math.min(5, evaluation));
  return 50 + (clamped / 5) * 50;
};

const PlayerLine = ({ player, compact }: { player: BoardNavigationPlayer; compact: boolean }) => (
  <div
    className={`flex min-w-0 items-center rounded-lg border border-slate-700/40 bg-slate-900/70 ${
      compact ? "gap-1 px-1 py-0.5" : "gap-2 px-2 py-1"
    }`}
  >
    <div className={`flex min-w-0 flex-1 items-center ${compact ? "gap-1" : "gap-1.5"}`}>
      {player.flag ? (
        <Flag country={player.flag} className={`${compact ? "text-base" : "text-lg"} leading-none`} />
      ) : (
        <span
          className={`${compact ? "h-4 w-4" : "h-5 w-5"} rounded-full border border-white/10 bg-slate-800`}
          aria-hidden
        />
      )}
      <div className={`flex min-w-0 flex-1 items-center ${compact ? "gap-1" : "gap-1.5"}`}>
        {player.title ? (
          <span
            className={`${pillBase} ${pillSm} border-amber-200/50 bg-amber-200/10 uppercase tracking-wide text-amber-100`}
          >
            {player.title}
          </span>
        ) : null}
        <span className={`min-w-0 flex-1 truncate font-semibold leading-tight text-slate-50 ${compact ? "text-[13px]" : "text-[13px]"}`}>
          {player.name}
        </span>
      </div>
    </div>
    {player.rating ? (
      <span
        className={`rating-text ml-auto whitespace-nowrap tabular-nums ${compact ? "text-[11px]" : "text-[12px]"}`}
        aria-label="Rating"
      >
        {player.rating}
      </span>
    ) : null}
  </div>
);

export const BoardsNavigationCard = ({
  board,
  currentBoardId,
  isActive,
  paneQuery,
  compact = false,
  hrefBuilder,
  onBoardClick,
}: BoardsNavigationCardProps) => {
  const resolvedActive = typeof isActive === "boolean" ? isActive : currentBoardId === board.boardId;
  const resolvedPaneQuery = paneQuery ?? "notation";
  const normalizedResult = normalizeResult(board.result);
  const isExplicitLive = board.status === "live";
  const hasClockData =
    Number.isFinite(Number(board.whiteTimeMs ?? NaN)) || Number.isFinite(Number(board.blackTimeMs ?? NaN));
  const isFinished = board.status === "final" || (!isExplicitLive && Boolean(normalizedResult));
  const showClocks = !isFinished && (isExplicitLive || hasClockData);
  const encodedBoardId = encodeURIComponent(board.boardId);
  const encodedPaneQuery = encodeURIComponent(resolvedPaneQuery);
  const href =
    hrefBuilder?.(board, { paneQuery: resolvedPaneQuery, isFinished }) ??
    `${isFinished ? `/replay/${encodedBoardId}` : `/live/${encodedBoardId}`}?pane=${encodedPaneQuery}`;

  const { whiteTimeLabel, blackTimeLabel, isWhiteInTimeTrouble, isBlackInTimeTrouble } = useMiniBoardClock({
    status: isExplicitLive ? "live" : "finished",
    whiteTimeMs: board.whiteTimeMs ?? undefined,
    blackTimeMs: board.blackTimeMs ?? undefined,
    sideToMove: board.sideToMove ?? null,
  });

  const baseClass = compact
    ? "relative flex w-full min-w-0 items-stretch gap-0.5 rounded-xl border px-2 py-1 min-h-[92px] transition-all duration-150 cursor-pointer shadow-sm"
    : "relative flex w-full min-w-0 items-stretch gap-1.5 rounded-2xl border px-2 py-1 transition-all duration-150 cursor-pointer shadow-sm";
  const activeClass = resolvedActive
    ? "border-sky-100/90 bg-slate-800/95 ring-2 ring-sky-300/25 shadow-[0_14px_38px_rgba(56,189,248,0.16)]"
    : "border-slate-700/80 bg-slate-900/95";
  const hoverClass = resolvedActive
    ? "hover:border-sky-100 hover:bg-slate-800/90"
    : "hover:border-slate-500/85 hover:bg-slate-800/90 hover:shadow-[0_12px_34px_rgba(0,0,0,0.38)]";
  const fillPercent = renderEvalFill(board.evaluation);
  const statusLabel = getBoardStatusLabel(board);
  const badgeClass = resolvedActive
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
      aria-pressed={resolvedActive}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (!onBoardClick) return;
        const result = onBoardClick(board);
        if (result === false) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      className={`${baseClass} ${activeClass} ${hoverClass} group overflow-hidden`}
    >
      <div
        className={`flex shrink-0 flex-col items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/80 text-center ${
          compact ? "w-9 px-0.5 py-0.5" : "w-10 px-1 py-1"
        }`}
      >
        <span
          className={`inline-flex items-center justify-center rounded-md border border-slate-600/70 bg-slate-800/70 font-semibold leading-tight text-slate-50 tabular-nums ${
            compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"
          }`}
        >
          #{board.boardNumber}
        </span>
      </div>

      <div className={`flex min-w-0 flex-1 flex-col justify-center ${compact ? "gap-1" : "gap-1.5"}`}>
        <div className={`transition-colors duration-200 ${showClocks && isWhiteInTimeTrouble ? "text-rose-50" : ""}`}>
          <PlayerLine player={board.white} compact={compact} />
        </div>
        {showClocks ? (
          <div className={`mx-auto flex justify-center ${compact ? "w-[112px]" : "w-[128px]"}`}>
            <div className={`flex w-full flex-nowrap items-center justify-center ${compact ? "gap-1" : "gap-1.5"}`}>
              <span
                className={`${pillBase} bg-slate-800/80 transition-colors transition-shadow duration-200 ${
                  compact ? pillSm : pillMd
                } ${
                  isWhiteInTimeTrouble
                    ? "border-rose-400/70 text-rose-50 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]"
                    : "border-slate-600/60 text-slate-100"
                }`}
              >
                {whiteTimeLabel ?? "—:—"}
              </span>
              <span
                className={`${pillBase} bg-slate-800/80 transition-colors transition-shadow duration-200 ${
                  compact ? pillSm : pillMd
                } ${
                  isBlackInTimeTrouble
                    ? "border-rose-400/70 text-rose-50 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]"
                    : "border-slate-600/60 text-slate-100"
                }`}
              >
                {blackTimeLabel ?? "—:—"}
              </span>
            </div>
          </div>
        ) : (
          <div className={`mx-auto flex justify-center ${compact ? "w-[112px]" : "w-[128px]"}`}>
            <span className={`${pillBase} uppercase tracking-[0.08em] ${compact ? pillSm : pillMd} ${badgeClass} ${badgeTone}`}>
              {statusLabel}
            </span>
          </div>
        )}
        <div className={`transition-colors duration-200 ${showClocks && isBlackInTimeTrouble ? "text-rose-50" : ""}`}>
          <PlayerLine player={board.black} compact={compact} />
        </div>
      </div>

      {isFinished && board.finalFen ? (
        <div className={`flex shrink-0 flex-col items-center ${compact ? "w-12" : "w-14"}`}>
          <div
            className={`w-full overflow-hidden border border-white/10 bg-slate-950/60 shadow-inner ${
              compact ? "rounded-lg" : "rounded-xl"
            }`}
          >
            <BroadcastReactBoard
              boardId={`${board.boardId}-mini`}
              position={board.finalFen}
              boardOrientation="white"
              draggable={false}
              showNotation={false}
            />
          </div>
        </div>
      ) : null}

      <div className={`relative flex shrink-0 items-stretch ${compact ? "w-5" : "w-6"}`} aria-hidden>
        <div className="absolute inset-y-1 right-1.5 flex items-center">
          <div
            className={`relative w-2 overflow-hidden rounded-full border border-slate-700/60 bg-slate-800 ${
              compact ? "h-14" : "h-16"
            }`}
          >
            <div className="absolute inset-x-[-2px] top-1/2 h-px bg-amber-200/80" />
            <div className="absolute inset-x-0 bottom-0 w-full bg-emerald-400/80" style={{ height: `${fillPercent}%` }} />
          </div>
        </div>
      </div>

      {resolvedActive ? (
        <>
          <span
            className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-sky-200 via-sky-300 to-emerald-300"
            aria-hidden
          />
          <span className="absolute inset-x-2 top-0 h-px bg-sky-200/70" aria-hidden />
        </>
      ) : null}
    </Link>
  );
};

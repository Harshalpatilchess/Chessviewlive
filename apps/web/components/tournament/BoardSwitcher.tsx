"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

export type BoardSwitcherOption = {
  boardId: string;
  label: string;
  href: string;
  players?: {
    white?: string;
    black?: string;
  } | null;
};

type BoardSwitcherProps = {
  currentBoardId: string;
  currentLabel: string;
  options?: BoardSwitcherOption[] | null;
  labelPrefix?: string;
};

export function BoardSwitcher({
  currentBoardId,
  currentLabel,
  options,
  labelPrefix = "Board",
}: BoardSwitcherProps) {
  const availableOptions = useMemo(() => {
    if (!options) return null;
    const filtered = options.filter(opt => Boolean(opt.boardId) && Boolean(opt.href));
    return filtered.length >= 2 ? filtered : null;
  }, [options]);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [currentBoardId]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        (triggerRef.current && triggerRef.current.contains(target)) ||
        (panelRef.current && panelRef.current.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!availableOptions) {
    return null;
  }

  const buttonLabel = `${labelPrefix} • ${currentLabel}`;

  return (
    <div className="pointer-events-auto relative inline-block text-[11px] font-medium text-white/90">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-white/90 transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
        onClick={() => setOpen(prev => !prev)}
      >
        <span>{buttonLabel}</span>
        <span aria-hidden="true" className="text-[10px]">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          className="absolute right-0 mt-1 max-h-72 w-48 overflow-y-auto rounded-lg border border-white/15 bg-black/80 p-1 text-[11px] text-white shadow-lg backdrop-blur"
        >
          {availableOptions.map(option => {
            const isActive = option.boardId === currentBoardId;
            return (
              <Link
                key={option.boardId}
                href={option.href}
                className={`block rounded px-2 py-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "text-white/80 hover:bg-white/10"
                }`}
                aria-current={isActive ? "true" : undefined}
                onClick={() => setOpen(false)}
              >
                <div>{option.label}</div>
                {option.players && (option.players.white || option.players.black) && (
                  <div className="text-[10px] text-white/70">
                    <span className="inline-flex flex-wrap gap-1">
                      {option.players.white && <span>White: {option.players.white}</span>}
                      {option.players.black && <span>Black: {option.players.black}</span>}
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

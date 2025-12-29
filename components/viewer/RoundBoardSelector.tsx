"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type RoundBoardSelectorProps = {
  initialRound?: number;
  initialBoard?: number;
  maxRounds?: number;
  boardsPerRound?: number;
  onSelectionChange?: (round: number, board: number) => void;
  selectionLocked?: boolean;
  onSelectionBlocked?: () => void;
  pane?: "notation" | "live" | "boards" | "engine";
  density?: "default" | "compact";
};

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function RoundBoardSelector({
  initialRound = 1,
  initialBoard = 1,
  maxRounds = 9,
  boardsPerRound = 20,
  onSelectionChange,
  selectionLocked = false,
  onSelectionBlocked,
  pane,
  density = "default",
}: RoundBoardSelectorProps) {
  const isCompact = density === "compact";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [openMenu, setOpenMenu] = useState<"round" | "board" | null>(null);
  const [highlightedRound, setHighlightedRound] = useState<number | null>(null);
  const [highlightedBoard, setHighlightedBoard] = useState<number | null>(null);

  const normalizedRound = useMemo(
    () => clampValue(initialRound, 1, maxRounds),
    [initialRound, maxRounds]
  );
  const normalizedBoard = useMemo(
    () => clampValue(initialBoard, 1, boardsPerRound),
    [initialBoard, boardsPerRound]
  );

  const [currentRound, setCurrentRound] = useState(normalizedRound);
  const [currentBoard, setCurrentBoard] = useState(normalizedBoard);

  useEffect(() => {
    setCurrentRound(prev => (prev === normalizedRound ? prev : normalizedRound));
  }, [normalizedRound]);

  useEffect(() => {
    setCurrentBoard(prev => (prev === normalizedBoard ? prev : normalizedBoard));
  }, [normalizedBoard]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      setOpenMenu(null);
      setHighlightedRound(null);
      setHighlightedBoard(null);
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const roundOptions = useMemo(
    () => Array.from({ length: maxRounds }, (_, idx) => idx + 1),
    [maxRounds]
  );
  const boardOptions = useMemo(
    () => Array.from({ length: boardsPerRound }, (_, idx) => idx + 1),
    [boardsPerRound]
  );

  const toggleMenu = (menu: "round" | "board") => {
    setOpenMenu(prev => (prev === menu ? null : menu));
  };

  const closeMenus = () => {
    setOpenMenu(null);
    setHighlightedRound(null);
    setHighlightedBoard(null);
  };

  const handleSelectRound = (option: number) => {
    if (selectionLocked) {
      closeMenus();
      onSelectionBlocked?.();
      return;
    }
    const nextRound = option;
    setCurrentRound(nextRound);
    setCurrentBoard(1);
    closeMenus();
    onSelectionChange?.(nextRound, 1);
  };

  const handleSelectBoard = (option: number) => {
    if (selectionLocked) {
      closeMenus();
      onSelectionBlocked?.();
      return;
    }
    setCurrentBoard(option);
    closeMenus();
    onSelectionChange?.(currentRound, option);
  };

  const renderMenu = (
    items: number[],
    type: "round" | "board",
    highlighted: number | null,
    setHighlighted: (value: number | null) => void
  ) => {
    if (openMenu !== type) return null;

    return (
      <div
        className={`absolute right-0 top-full z-30 mt-2 rounded-2xl border border-white/10 bg-slate-950/95 uppercase tracking-wide text-slate-200 shadow-xl backdrop-blur ${
          isCompact ? "w-36 p-1 text-[10px]" : "w-44 p-1.5 text-[11px]"
        } ${type === "board" ? "max-h-72 overflow-y-auto" : ""}`}
      >
        <ul role="menu" aria-label={type === "round" ? "Select round" : "Select board"}>
          {items.map(item => {
            const isActive =
              highlighted === item ||
              (highlighted === null && item === (type === "round" ? currentRound : currentBoard));
            const buttonLabel = type === "round" ? `Round ${item}` : `Board ${currentRound}.${item}`;

            return (
              <li key={`${type}-${item}`}>
                <button
                  type="button"
                  className={`flex w-full items-center rounded-xl text-left transition ${
                    isActive
                      ? "bg-slate-800/80 text-white"
                      : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                  } ${isCompact ? "px-2.5 py-1.5" : "px-3 py-2"}`}
                  onClick={() =>
                    type === "round" ? handleSelectRound(item) : handleSelectBoard(item)
                  }
                  onMouseEnter={() => setHighlighted(item)}
                  onMouseLeave={() => setHighlighted(null)}
                  role="menuitem"
                >
                  {buttonLabel}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-wrap items-center font-semibold uppercase tracking-wide ${
        isCompact ? "gap-2 text-[10px]" : "gap-3 text-xs"
      }`}
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => toggleMenu("round")}
          className={`inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 text-slate-200 shadow-sm transition hover:bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
            isCompact ? "px-2.5 py-1" : "px-3 py-1.5"
          }`}
          aria-haspopup="menu"
          aria-expanded={openMenu === "round"}
        >
          <span>{`Round ${currentRound}`}</span>
          <ChevronDown className={isCompact ? "h-3 w-3 opacity-80" : "h-3.5 w-3.5 opacity-80"} />
        </button>
        {renderMenu(roundOptions, "round", highlightedRound, setHighlightedRound)}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => toggleMenu("board")}
          className={`inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950 text-slate-200 shadow-sm transition hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50 ${
            isCompact ? "px-2.5 py-1" : "px-3 py-1.5"
          }`}
          aria-haspopup="menu"
          aria-expanded={openMenu === "board"}
        >
          <span>{`Board ${currentRound}.${currentBoard}`}</span>
          <ChevronDown className={isCompact ? "h-3 w-3 opacity-80" : "h-3.5 w-3.5 opacity-80"} />
        </button>
        {renderMenu(boardOptions, "board", highlightedBoard, setHighlightedBoard)}
      </div>
    </div>
  );
}

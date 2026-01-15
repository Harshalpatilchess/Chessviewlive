"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type RoundOption = {
  value: number;
  label: string;
};

type RoundDropdownPillProps = {
  roundOptions: RoundOption[];
  activeRound: number;
  density?: "compact" | "default";
};

export default function RoundDropdownPill({
  roundOptions,
  activeRound,
  density = "compact",
}: RoundDropdownPillProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const hasMultipleRounds = roundOptions.length > 1;
  const activeLabel = useMemo(() => {
    return roundOptions.find(option => option.value === activeRound)?.label ?? `Round ${activeRound}`;
  }, [activeRound, roundOptions]);
  const isCompact = density === "compact";

  const updateRoundParam = useCallback(
    (nextRound: number) => {
      if (!Number.isFinite(nextRound)) return;
      const params = new URLSearchParams(searchParams?.toString());
      params.set("round", String(nextRound));
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    setIsOpen(false);
  }, [activeRound]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          if (!hasMultipleRounds) return;
          setIsOpen(open => !open);
        }}
        className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-400/60 bg-emerald-400/10 text-white shadow-sm transition hover:border-emerald-300/60 hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 ${
          isCompact ? "h-6 px-3 text-[11px]" : "px-3 py-1.5 text-xs"
        } ${hasMultipleRounds ? "cursor-pointer" : "cursor-default opacity-80"}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={!hasMultipleRounds}
      >
        <span>{activeLabel}</span>
        {hasMultipleRounds ? (
          <ChevronDown className={isCompact ? "h-3 w-3 opacity-80" : "h-3.5 w-3.5 opacity-80"} />
        ) : null}
      </button>
      {isOpen ? (
        <div
          className={`absolute left-0 top-full z-30 mt-2 rounded-2xl border border-white/10 bg-slate-950/95 shadow-xl backdrop-blur ${
            isCompact ? "w-36 p-1 text-[11px]" : "w-40 p-1.5 text-xs"
          }`}
        >
          <ul role="menu" aria-label="Select round">
            {roundOptions.map(option => {
              const isActive = option.value === activeRound;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    className={`flex w-full items-center rounded-xl text-left transition ${
                      isActive
                        ? "bg-slate-800/80 text-white"
                        : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                    } ${isCompact ? "px-2.5 py-1.5" : "px-3 py-2"}`}
                    onClick={() => {
                      updateRoundParam(option.value);
                      setIsOpen(false);
                    }}
                    role="menuitem"
                  >
                    {option.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

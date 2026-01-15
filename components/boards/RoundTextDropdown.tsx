"use client";

import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type RoundMenuItem = {
  value: number;
  label: string;
  dateLabel?: string | null;
  statusLabel?: string | null;
  statusTone?: "finished" | "live" | "notStarted" | null;
};

type RoundTextDropdownProps = {
  items: RoundMenuItem[];
  activeRound: number;
};

const getStatusCapsuleClass = (tone?: RoundMenuItem["statusTone"] | null) => {
  if (tone === "finished") {
    return "border-emerald-400/60 bg-emerald-400/15 text-emerald-50";
  }
  if (tone === "live") {
    return "border-rose-400/60 bg-rose-400/15 text-rose-50";
  }
  if (tone === "notStarted") {
    return "border-amber-300/60 bg-amber-300/15 text-amber-50";
  }
  return "border-white/10 bg-white/5 text-slate-300";
};

export default function RoundTextDropdown({ items, activeRound }: RoundTextDropdownProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const hasMultipleRounds = items.length > 1;
  const activeItem = useMemo(() => items.find(item => item.value === activeRound) ?? null, [activeRound, items]);
  const activeLabel = activeItem?.label ?? `Round ${activeRound}`;
  const activeStatusLabel = activeItem?.statusLabel ?? "Not started";
  const activeStatusTone = activeItem?.statusTone ?? "notStarted";

  const updateRoundParam = useCallback(
    (nextRound: number) => {
      if (!Number.isFinite(nextRound)) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("round", String(nextRound));
      params.set("page", "1");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const updateMenuPosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      if (menuRef.current?.contains(event.target as Node)) return;
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
    if (!isOpen) return;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    setIsOpen(false);
  }, [activeRound]);

  const menuContent =
    isOpen && typeof document !== "undefined" && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            className="rounded-2xl border border-white/10 bg-slate-950/95 p-1 text-[11px] text-slate-200 shadow-xl backdrop-blur"
            style={{
              position: "fixed",
              top: menuPosition.top,
              left: menuPosition.left,
              transform: "translateX(-50%)",
              width: "320px",
              zIndex: 200,
            }}
          >
            <ul role="menu" aria-label="Select round">
              {items.map(item => {
                const isActive = item.value === activeRound;
                return (
                  <li key={item.value}>
                    <button
                      type="button"
                      className={`grid w-full grid-cols-[1.2fr_1fr_auto] items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                        isActive
                          ? "bg-slate-800/80 text-white"
                          : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                      }`}
                      onClick={() => {
                        updateRoundParam(item.value);
                        setIsOpen(false);
                      }}
                      role="menuitem"
                    >
                      <span className="text-[12px] font-semibold text-slate-50">{item.label}</span>
                      <span className="text-[11px] text-slate-400">{item.dateLabel ?? "—"}</span>
                      <span className="flex items-center justify-end gap-1.5">
                        {isActive ? <span className="text-[10px] text-slate-400">✓</span> : null}
                        <span className="text-[10px] font-semibold text-slate-200">
                          {item.statusLabel ?? "Not started"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          if (!hasMultipleRounds) return;
          setIsOpen(open => !open);
        }}
        ref={buttonRef}
        className={`inline-flex min-w-[200px] items-center justify-between gap-3 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 ${
          hasMultipleRounds ? "cursor-pointer hover:brightness-110" : "cursor-default opacity-70"
        } ${getStatusCapsuleClass(activeStatusTone)}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={!hasMultipleRounds}
      >
        <span>{activeLabel}</span>
        <span className="inline-flex items-center gap-2">
          <span className="text-[10px] font-semibold">{activeStatusLabel}</span>
          <ChevronDown className={`h-3.5 w-3.5 ${hasMultipleRounds ? "opacity-90" : "opacity-50"}`} />
        </span>
      </button>
      {menuContent}
    </div>
  );
}

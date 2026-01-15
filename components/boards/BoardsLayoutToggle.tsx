"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type BoardsLayoutToggleProps = {
  layout: "grid" | "list";
};

const LAYOUT_OPTIONS = [
  { key: "grid", label: "Grid" },
  { key: "list", label: "Pairings" },
] as const;

export const BoardsLayoutToggle = ({ layout }: BoardsLayoutToggleProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const pushUpdates = (nextLayout: "grid" | "list") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("layout", nextLayout);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="inline-flex items-center rounded-full border border-white/10 bg-slate-950/70 p-1 text-xs font-semibold text-slate-300">
      {LAYOUT_OPTIONS.map(option => {
        const isActive = layout === option.key;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => pushUpdates(option.key)}
            className={`rounded-full px-3 py-1 transition ${
              isActive ? "bg-emerald-400/15 text-white" : "text-slate-300 hover:text-white"
            }`}
            aria-pressed={isActive}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

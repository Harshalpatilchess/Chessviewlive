"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import BoardsNavigationSidebar from "@/components/boards/BoardsNavigationSidebar";

type BroadcastHubSidebarProps = ComponentProps<typeof BoardsNavigationSidebar>;

export default function BroadcastHubSidebar(props: BroadcastHubSidebarProps) {
  const { debug = false } = props;
  const [viewMode, setViewMode] = useState<"pairing" | "leaderboard">("leaderboard");
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const searchParams = useSearchParams();
  const gridSearchLength = (searchParams.get("search") ?? "").trim().length;
  const sidebarSearchLength = sidebarSearchQuery.trim().length;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {debug ? (
        <div className="self-start rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-[10px] font-semibold text-emerald-100">
          <span className="mr-2">
            Sidebar: {viewMode === "pairing" ? "Pairings" : "Leaderboard"}
          </span>
          <span className="mr-2">GridMounted: yes</span>
          <span>Search len s:{sidebarSearchLength} g:{gridSearchLength}</span>
        </div>
      ) : null}
      <BoardsNavigationSidebar
        {...props}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        searchQuery={sidebarSearchQuery}
        onSearchQueryChange={setSidebarSearchQuery}
      />
    </div>
  );
}

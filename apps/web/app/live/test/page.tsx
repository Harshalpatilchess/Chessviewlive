"use client";

import LiveBoardPage from "../[boardId]/page";

export default function LiveTestPage() {
  return <LiveBoardPage params={Promise.resolve({ boardId: "worldcup2025-board1.1" })} />;
}

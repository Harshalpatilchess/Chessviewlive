"use client";

import { useMemo, useState } from "react";
import BoardPane from "@/components/live/BoardPane";
import RightColumn from "@/components/live/RightColumn";
import { pgnToPlies } from "@/lib/chess/pgn";

const SAMPLE_PGN =
  "1. d4 d5 2. Nf3 Nf6 3. c4 e6 4. Nc3 Be7 5. Bg5 O-O 6. e3 Nbd7 7. Rc1 c6 8. Qc2 Re8 *";

export default function LiveTestPage() {
  console.log("STATIC /live/test ROUTE");
  const plies = useMemo(() => pgnToPlies(SAMPLE_PGN), []);
  const [index, setIndex] = useState(0);
  const [engineOn, setEngineOn] = useState(false);

  const white = { name: "GM Sasha Calder", rating: 2748, country: "USA" };
  const black = { name: "GM Emil Novak", rating: 2731, country: "GER" };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 overflow-x-hidden">
      <div className="fixed top-2 right-2 z-50 rounded bg-fuchsia-600/80 px-2 py-1 text-[10px]">
        STATIC ROUTE SEEN
      </div>
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 lg:px-8">
        <div className="grid gap-6 lg:min-h-[calc(100vh-96px)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* LEFT: board */}
          <BoardPane
            plies={plies}
            index={index}
            setIndex={setIndex}
            white={white}
            black={black}
            round={7}
            boardNo={"1"}
          />
          {/* RIGHT: video + tabs */}
          <RightColumn
            plies={plies}
            index={index}
            setIndex={setIndex}
            engineOn={engineOn}
            setEngineOn={setEngineOn}
          />
        </div>
      </div>
    </main>
  );
}

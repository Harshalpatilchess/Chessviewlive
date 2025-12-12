"use client";

import { useMemo, useState } from "react";
import BoardPane from "@/components/live/BoardPane";
import RightColumn from "@/components/live/RightColumn";
import { pgnToPlies } from "@/lib/chess/pgn";

const SAMPLE_PGN =
  "1. d4 d5 2. Nf3 Nf6 3. c4 e6 4. Nc3 Be7 5. Bg5 O-O 6. e3 Nbd7 7. Rc1 c6 8. Qc2 Re8 *";

export default function LiveDemoPage() {
  const round = 7;
  const boardNo = "1";
  const plies = useMemo(() => pgnToPlies(SAMPLE_PGN), []);
  const [index, setIndex] = useState(0);
  const [engineOn, setEngineOn] = useState(false);

  const white = { name: "GM Sasha Calder", rating: 2748, country: "USA" };
  const black = { name: "GM Emil Novak", rating: 2731, country: "GER" };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(36vw,1fr)_minmax(60vw,1.5fr)]">
          <BoardPane
            plies={plies}
            index={index}
            setIndex={setIndex}
            white={white}
            black={black}
            round={round}
            boardNo={boardNo}
          />
          <RightColumn
            plies={plies}
            index={index}
            setIndex={setIndex}
            engineOn={engineOn}
            setEngineOn={setEngineOn}
            offline
            replayHref="/replay/worldcup-board1.1"
          />
        </div>
      </div>
    </main>
  );
}

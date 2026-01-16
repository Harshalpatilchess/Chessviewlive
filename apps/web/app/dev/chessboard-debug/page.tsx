"use client";

import { useState } from "react";
import { Chessboard } from "react-chessboard";

type Orientation = "white" | "black";

const TEST_FEN = "8/8/8/4K3/8/8/8/8 w - - 0 1";

export default function ChessboardDebugPage() {
  const [fen, setFen] = useState<string>("start");
  const [orientation, setOrientation] = useState<Orientation>("white");

  const handleFlip = () => setOrientation(prev => (prev === "white" ? "black" : "white"));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-4 py-6 text-white">
      <h1 className="text-2xl font-semibold">Chessboard Debug</h1>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFen("start")}
          className="rounded-lg bg-slate-800 px-3 py-1 text-sm font-semibold transition hover:bg-slate-700"
        >
          Start position
        </button>
        <button
          type="button"
          onClick={() => setFen(TEST_FEN)}
          className="rounded-lg bg-slate-800 px-3 py-1 text-sm font-semibold transition hover:bg-slate-700"
        >
          Test position
        </button>
        <button
          type="button"
          onClick={handleFlip}
          className="rounded-lg bg-slate-800 px-3 py-1 text-sm font-semibold transition hover:bg-slate-700"
        >
          Flip orientation
        </button>
      </div>

      <div className="w-full max-w-[520px]">
        <Chessboard
          key={`${fen}-${orientation}`}
          id="cv-chessboard-debug"
          position={fen}
          boardOrientation={orientation}
          arePiecesDraggable
          showBoardNotation
          animationDuration={250}
        />
        <div className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] leading-tight text-slate-200">
          <div>Current FEN: {fen}</div>
          <div>Orientation: {orientation}</div>
        </div>
      </div>
    </main>
  );
}

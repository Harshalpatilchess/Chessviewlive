"use client";

import { useMemo, useState } from "react";
import BroadcastReactBoard from "@/components/viewer/BroadcastReactBoard";
import { samplePgns } from "@/lib/live/samplePgns";
import { pgnToDgtBoard } from "@/lib/live/pgnToDgtPayload";
import { Chess } from "chess.js";

export default function PgnTesterPage() {
  const [pgn, setPgn] = useState(samplePgns[0] ?? "");
  const [moveIndex, setMoveIndex] = useState(0);

  const parsed = useMemo(() => pgnToDgtBoard(pgn, { board: 999 }), [pgn]);
  const chess = useMemo(() => new Chess(), []);

  const replayable = Array.isArray(parsed.moveList) && parsed.moveList.length > 0;

  const replayPosition = useMemo(() => {
    if (!replayable) return parsed.finalFen ?? null;
    chess.reset();
    const cappedIndex = Math.min(Math.max(moveIndex, 0), parsed.moveList!.length);
    for (let i = 0; i < cappedIndex; i += 1) {
      const move = parsed.moveList?.[i];
      if (!move) break;
      chess.move(move, { strict: false });
    }
    return chess.fen();
  }, [chess, moveIndex, parsed.finalFen, parsed.moveList, replayable]);
  const hasFen = Boolean(parsed.finalFen);
  const movePreview =
    parsed.moveList && parsed.moveList.length ? parsed.moveList.slice(0, 6).join(" ") : "No moves parsed";

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 px-4 py-6 text-slate-100">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">PGN Tester (dev)</h1>
        <p className="text-sm text-slate-300">
          Paste a PGN to see parsed headers, final FEN, move list info, and a rendered board when available. Invalid tokens are ignored; failures fall back to headers-only.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
          <label className="text-sm font-semibold text-slate-200">PGN Input</label>
          <textarea
            className="min-h-[280px] w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 font-mono text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400"
            value={pgn}
            onChange={e => setPgn(e.target.value)}
            spellCheck={false}
          />
          <div className="text-xs text-slate-400">Tip: Bad tokens are skipped; if parsing fails, you still get headers and result.</div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-slate-400">Event</div>
              <div className="font-semibold text-white">{parsed.event ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-400">Date</div>
              <div className="font-semibold text-white">{parsed.date ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-400">White</div>
              <div className="font-semibold text-white">{parsed.white ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-400">Black</div>
              <div className="font-semibold text-white">{parsed.black ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-400">White Elo</div>
              <div className="font-semibold text-white">{parsed.whiteElo ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-400">Black Elo</div>
              <div className="font-semibold text-white">{parsed.blackElo ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-400">Result</div>
              <div className="font-semibold text-white">{parsed.result ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-400">ECO / Opening</div>
              <div className="font-semibold text-white">
                {parsed.eco ?? "—"}{parsed.eco ? " · " : ""}{parsed.opening ?? ""}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Moves parsed</div>
              <div className="font-semibold text-white">{parsed.moveList ? parsed.moveList.length : 0}</div>
            </div>
            <div>
              <div className="text-slate-400">FEN available</div>
              <div className="font-semibold text-white">{hasFen ? "Yes" : "No"}</div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-200">
            <div className="text-xs uppercase tracking-wide text-slate-400">Move preview</div>
            <div className="mt-1 font-mono text-[13px] text-white">{movePreview}</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Final position</h2>
        {replayable ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/15 bg-slate-800/70 px-3 py-1.5 text-sm font-semibold text-white transition hover:border-sky-400 hover:bg-slate-800"
                onClick={() => setMoveIndex(0)}
              >
                Start
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/15 bg-slate-800/70 px-3 py-1.5 text-sm font-semibold text-white transition hover:border-sky-400 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setMoveIndex(i => Math.max(0, i - 1))}
                disabled={moveIndex <= 0}
              >
                Previous
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/15 bg-slate-800/70 px-3 py-1.5 text-sm font-semibold text-white transition hover:border-sky-400 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setMoveIndex(i => Math.min((parsed.moveList?.length ?? 0), i + 1))}
                disabled={moveIndex >= (parsed.moveList?.length ?? 0)}
              >
                Next
              </button>
              <div className="text-sm text-slate-300">
                Move {moveIndex} / {parsed.moveList?.length ?? 0}
              </div>
            </div>
            <BroadcastReactBoard
              boardId="pgn-tester-board"
              position={replayPosition ?? parsed.finalFen ?? ""}
              boardOrientation="white"
            />
          </div>
        ) : hasFen ? (
          <BroadcastReactBoard boardId="pgn-tester-board" position={parsed.finalFen!} boardOrientation="white" />
        ) : (
          <div className="rounded-xl border border-dashed border-white/20 bg-slate-950/60 p-4 text-sm text-slate-300">
            No valid moves/FEN parsed. Check the PGN or headers; invalid tokens are skipped.
          </div>
        )}
      </section>
    </div>
  );
}

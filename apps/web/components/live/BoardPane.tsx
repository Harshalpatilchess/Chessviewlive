import { useEffect, useMemo, useState } from "react";

import BoardControls from "@/components/live/BoardControls";
import EvalBar from "@/components/live/EvalBar";
import PlayerHeaderBottom from "@/components/live/PlayerHeaderBottom";
import PlayerHeaderTop from "@/components/live/PlayerHeaderTop";
import BroadcastReactBoard from "@/components/viewer/BroadcastReactBoard";
import RoundBoardSelector from "@/components/viewer/RoundBoardSelector";
import type { Ply } from "@/lib/chess/pgn";
import { pliesToFenAt } from "@/lib/chess/pgn";
import type { Player } from "@/lib/types";
import { formatEvalLabel } from "@/lib/engine/evalMapping";

type Orientation = "white" | "black";

type BoardPaneProps = {
  plies: Ply[];
  index: number;
  setIndex: (value: number) => void;
  white: Player;
  black: Player;
  round: number;
  boardNo: string;
};

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const WHITE_CLOCK = "01:20:34";
const BLACK_CLOCK = "01:18:12";

const BoardPane = ({ plies, index, setIndex, white, black, round, boardNo }: BoardPaneProps) => {
  const [orientation, setOrientation] = useState<Orientation>("white");
  const [showEval, setShowEval] = useState(true);
  const [selectedRound, setSelectedRound] = useState(round);
  const [selectedBoard, setSelectedBoard] = useState(() => {
    const parsed = Number(boardNo);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  });

  const boardPosition = useMemo(() => pliesToFenAt(plies, index), [plies, index]);

  useEffect(() => {
    setSelectedRound(round);
  }, [round]);

  useEffect(() => {
    const parsed = Number(boardNo);
    setSelectedBoard(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
  }, [boardNo]);

  const liveIndex = plies.length - 1;
  const canPrev = index > -1;
  const canNext = index < liveIndex;
  const liveActive = liveIndex >= 0 && index === liveIndex;

  const handlePrev = () => setIndex(Math.max(-1, index - 1));
  const handleNext = () => {
    if (liveIndex < 0) return;
    setIndex(Math.min(liveIndex, index + 1));
  };
  const handleLive = () => {
    if (liveIndex < 0) return;
    setIndex(liveIndex);
  };
  const handleFlip = () => setOrientation(prev => (prev === "white" ? "black" : "white"));
  const handleToggleEval = () => setShowEval(prev => !prev);

  const evaluation = useMemo(() => {
    if (!plies.length) return 50;
    const swing = Math.sin((index + 2) / 3) * 8;
    return clamp(Math.round(58 + swing));
  }, [plies.length, index]);
  const evaluationLabel = formatEvalLabel((evaluation - 50) / 10);

  const gameLabel = `Game ${selectedRound}.${selectedBoard}`;
  const isWhitePerspective = orientation === "white";
  const top = isWhitePerspective
    ? { player: black, color: "black" as const, clock: BLACK_CLOCK }
    : { player: white, color: "white" as const, clock: WHITE_CLOCK };
  const bottom = isWhitePerspective
    ? { player: white, color: "white" as const, clock: WHITE_CLOCK }
    : { player: black, color: "black" as const, clock: BLACK_CLOCK };
  const orientationLabel = `Perspective: ${orientation}`;

  const handleSelectorChange = (roundValue: number, boardValue: number) => {
    console.log("[RoundBoardSelector] Selection changed", { round: roundValue, board: boardValue });
    setSelectedRound(roundValue);
    setSelectedBoard(boardValue);
  };

  return (
    <section className="mx-auto flex w-full max-w-[620px] flex-col gap-3 rounded-3xl border border-white/10 bg-slate-950/80 p-3 shadow-xl ring-1 ring-white/5">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Championship broadcast
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">{gameLabel}</h2>
        </div>
        <RoundBoardSelector
          initialRound={selectedRound}
          initialBoard={selectedBoard}
          maxRounds={9}
          boardsPerRound={20}
          onSelectionChange={handleSelectorChange}
        />
      </header>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-inner">
        <PlayerHeaderTop player={top.player} color={top.color} clock={top.clock} />

        <div className="flex items-stretch gap-3">
          {showEval ? (
            <div className="hidden min-h-[320px] md:flex">
              <EvalBar value={evaluation} scoreLabel={evaluationLabel} orientation={orientation} />
            </div>
          ) : null}

          <div className="relative flex-1">
            <BroadcastReactBoard
              boardId="cv-master-board"
              position={boardPosition}
              boardOrientation={orientation}
              draggable={false}
              showNotation
            />
          </div>
        </div>

        <PlayerHeaderBottom player={bottom.player} color={bottom.color} clock={bottom.clock} />

        <BoardControls
          onPrev={handlePrev}
          onLive={handleLive}
          onNext={handleNext}
          onFlip={handleFlip}
          showEval={showEval}
          toggleEval={handleToggleEval}
          canPrev={canPrev}
          canNext={canNext}
          liveActive={liveActive}
        />
        <p className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {orientationLabel}
        </p>
      </div>
    </section>
  );
};

export default BoardPane;

"use client";

import { Chessboard } from "react-chessboard";

type Orientation = "white" | "black";

type BroadcastReactBoardProps = {
  position: string;
  boardOrientation: Orientation;
  draggable?: boolean;
  boardId?: string;
  showNotation?: boolean;
};

const boardStyle = {
  borderRadius: "24px",
  boxShadow: "inset 0 0 24px rgba(0,0,0,0.45)",
};

export default function BroadcastReactBoard({
  position,
  boardOrientation,
  draggable = false,
  boardId = "cv-broadcast-board",
  showNotation = true,
}: BroadcastReactBoardProps) {
  console.log("BroadcastReactBoard render", { boardId, position, boardOrientation });

  return (
    <div className="mx-auto w-full max-w-[520px] overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black shadow-lg">
      <Chessboard
        id={boardId}
        position={position}
        boardOrientation={boardOrientation}
        arePiecesDraggable={draggable}
        animationDuration={250}
        customBoardStyle={boardStyle}
        customDarkSquareStyle={{ backgroundColor: "#b58863" }}
        customLightSquareStyle={{ backgroundColor: "#f0d9b5" }}
        showBoardNotation={showNotation}
      />
    </div>
  );
}

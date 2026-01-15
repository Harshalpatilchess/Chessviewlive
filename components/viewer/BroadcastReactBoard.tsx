"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";

type Orientation = "white" | "black";

type BroadcastReactBoardProps = {
  position: string;
  boardOrientation: Orientation;
  draggable?: boolean;
  boardId?: string;
  showNotation?: boolean;
  sizePx?: number;
  variant?: "standard" | "mini";
  miniSizePx?: number;
  autoSize?: boolean;
  autoSizeMode?: "contain" | "width";
  fallbackSize?: number;
  containerClassName?: string;
  squareCorners?: boolean;
  boardStyleOverrides?: CSSProperties;
  onPieceDrop?: (sourceSquare: string, targetSquare: string, piece: string) => boolean;
};

const boardStyle = {
  borderRadius: "24px",
  boxShadow: "inset 0 0 24px rgba(0,0,0,0.45)",
};

const miniBoardStyle = {
  borderRadius: "12px",
  boxShadow: "inset 0 0 18px rgba(0,0,0,0.45)",
};

export default function BroadcastReactBoard({
  position,
  boardOrientation,
  draggable = false,
  boardId = "cv-broadcast-board",
  showNotation = true,
  sizePx,
  variant = "standard",
  miniSizePx = 80,
  autoSize = false,
  autoSizeMode = "contain",
  fallbackSize = 320,
  containerClassName,
  squareCorners = false,
  boardStyleOverrides,
  onPieceDrop,
}: BroadcastReactBoardProps) {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const isVerbose = params?.get("debug") === "1" && params?.get("debugVerbose") === "1";
    if (isVerbose) {
      console.log("BroadcastReactBoard render", { boardId, position, boardOrientation });
    }
  }

  const isMini = variant === "mini";
  const resolvedAutoSize = autoSize;
  const resolvedShowNotation = isMini ? false : showNotation;
  const resolvedDraggable = isMini ? false : draggable;
  const resolvedOnPieceDrop = isMini ? undefined : onPieceDrop;
  const baseBoardStyle = isMini ? miniBoardStyle : boardStyle;
  const resolvedBoardStyle = squareCorners
    ? { ...baseBoardStyle, borderRadius: 0 }
    : baseBoardStyle;
  const finalBoardStyle = boardStyleOverrides
    ? { ...resolvedBoardStyle, ...boardStyleOverrides }
    : resolvedBoardStyle;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredSize, setMeasuredSize] = useState<number | null>(null);

  useEffect(() => {
    if (!resolvedAutoSize) return;
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!Number.isFinite(width) || width <= 0) return;
      const nextSize = Math.floor(
        autoSizeMode === "width" ? width : height > 0 ? Math.min(width, height) : width
      );
      if (!Number.isFinite(nextSize) || nextSize <= 0) return;
      setMeasuredSize(prev => (prev === nextSize ? prev : nextSize));
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(() => update());
    observer.observe(container);
    return () => observer.disconnect();
  }, [resolvedAutoSize, autoSizeMode]);

  const baseClassName = isMini
    ? "mx-auto w-full h-full overflow-hidden"
    : `mx-auto w-full ${
        resolvedAutoSize ? "max-w-full" : "max-w-[520px]"
      } max-h-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black shadow-lg`;
  const resolvedFallbackSize = isMini ? miniSizePx : fallbackSize;
  const resolvedSize =
    sizePx ??
    (resolvedAutoSize ? measuredSize ?? resolvedFallbackSize : isMini ? miniSizePx : undefined);
  const sizeStyle = resolvedSize ? { width: resolvedSize, height: resolvedSize } : undefined;
  const boardWidthProp = resolvedSize ?? undefined;

  const boardContent = (
    <div className={baseClassName} style={sizeStyle}>
      <Chessboard
        id={boardId}
        position={position}
        boardOrientation={boardOrientation}
        arePiecesDraggable={resolvedDraggable}
        onPieceDrop={resolvedOnPieceDrop}
        animationDuration={250}
        customBoardStyle={finalBoardStyle}
        customDarkSquareStyle={{ backgroundColor: "#b58863" }}
        customLightSquareStyle={{ backgroundColor: "#f0d9b5" }}
        showBoardNotation={resolvedShowNotation}
        boardWidth={boardWidthProp}
      />
    </div>
  );

  if (!resolvedAutoSize && !containerClassName) {
    return boardContent;
  }

  return (
    <div
      ref={containerRef}
      className={containerClassName ?? "flex h-full min-h-0 w-full items-center justify-center"}
    >
      {boardContent}
    </div>
  );
}

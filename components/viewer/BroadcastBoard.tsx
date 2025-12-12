'use client';

import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';

const INITIAL_FEN = 'start';

export default function BroadcastBoard() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const board = Chessground(containerRef.current, {
      fen: INITIAL_FEN,
      orientation: 'white',
      movable: { free: false, color: undefined, showDests: false },
      draggable: { enabled: false },
      selectable: { enabled: false },
      highlight: { lastMove: false, check: false },
      animation: { duration: 200 },
    });

    return () => {
      board.destroy();
    };
  }, []);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black shadow-lg">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

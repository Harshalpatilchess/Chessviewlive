"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type AnimatedBoardPaneProps = {
  boardKey: string;
  children: ReactNode;
};

export default function AnimatedBoardPane({ boardKey, children }: AnimatedBoardPaneProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger fade-in on mount and whenever the board changes.
    setVisible(false);
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [boardKey]);

  return (
    <div
      className={`transition-opacity duration-200 ease-out ${visible ? "opacity-100" : "opacity-0"}`}
      aria-live="polite"
    >
      {children}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

type Orientation = "white" | "black";

const ORIENTATION_STORAGE_KEY = "chessviewlive:viewer:orientation:v1";

const normalizeOrientation = (value: unknown): Orientation => (value === "black" ? "black" : "white");

export default function usePersistentBoardOrientation(defaultOrientation: Orientation = "white") {
  const [orientation, setOrientation] = useState<Orientation>(() => defaultOrientation);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(ORIENTATION_STORAGE_KEY);
      if (!saved) return;
      setOrientation(normalizeOrientation(saved));
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ORIENTATION_STORAGE_KEY, orientation);
    } catch {}
  }, [orientation]);

  const toggleOrientation = useCallback(() => {
    setOrientation(prev => (prev === "white" ? "black" : "white"));
  }, []);

  return { orientation, setOrientation, toggleOrientation };
}


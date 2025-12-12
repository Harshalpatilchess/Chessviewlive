"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Side = "white" | "black";

type UseMiniBoardClockParams = {
  status?: "live" | "finished" | "upcoming" | null;
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
  sideToMove?: Side | null;
  tickMs?: number;
  timeTroubleMs?: number;
};

type UseMiniBoardClockResult = {
  whiteTimeLabel: string | null;
  blackTimeLabel: string | null;
  isWhiteInTimeTrouble: boolean;
  isBlackInTimeTrouble: boolean;
};

const formatClock = (ms?: number | null): string | null => {
  if (!Number.isFinite(ms ?? NaN) || (ms ?? 0) < 0) return "00:00";
  const totalSeconds = Math.max(0, Math.floor((ms as number) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

export default function useMiniBoardClock({
  status,
  whiteTimeMs,
  blackTimeMs,
  sideToMove,
  tickMs = 1000,
  timeTroubleMs = 2 * 60 * 1000,
}: UseMiniBoardClockParams): UseMiniBoardClockResult {
  const [whiteMs, setWhiteMs] = useState<number | null>(
    Number.isFinite(whiteTimeMs ?? NaN) ? (whiteTimeMs as number) : null
  );
  const [blackMs, setBlackMs] = useState<number | null>(
    Number.isFinite(blackTimeMs ?? NaN) ? (blackTimeMs as number) : null
  );
  const sideRef = useRef<Side | null>(sideToMove ?? null);
  const statusRef = useRef(status ?? null);

  useEffect(() => {
    sideRef.current = sideToMove ?? null;
  }, [sideToMove]);

  useEffect(() => {
    statusRef.current = status ?? null;
  }, [status]);

  useEffect(() => {
    if (Number.isFinite(whiteTimeMs ?? NaN)) setWhiteMs(whiteTimeMs as number);
  }, [whiteTimeMs]);

  useEffect(() => {
    if (Number.isFinite(blackTimeMs ?? NaN)) setBlackMs(blackTimeMs as number);
  }, [blackTimeMs]);

  useEffect(() => {
    if (status !== "live" || !sideRef.current) return;
    const interval = window.setInterval(() => {
      if (statusRef.current !== "live") return;
      if (sideRef.current === "white") {
        setWhiteMs(prev => (prev == null || prev <= 0 ? 0 : prev - tickMs));
      } else if (sideRef.current === "black") {
        setBlackMs(prev => (prev == null || prev <= 0 ? 0 : prev - tickMs));
      }
    }, tickMs);
    return () => {
      window.clearInterval(interval);
    };
  }, [status, tickMs]);

  const whiteTimeLabel = useMemo(() => formatClock(whiteMs), [whiteMs]);
  const blackTimeLabel = useMemo(() => formatClock(blackMs), [blackMs]);
  const isLive = status === "live";
  const isWhiteInTimeTrouble = isLive && Number.isFinite(whiteMs ?? NaN) ? (whiteMs as number) <= timeTroubleMs : false;
  const isBlackInTimeTrouble = isLive && Number.isFinite(blackMs ?? NaN) ? (blackMs as number) <= timeTroubleMs : false;

  return { whiteTimeLabel, blackTimeLabel, isWhiteInTimeTrouble, isBlackInTimeTrouble };
}

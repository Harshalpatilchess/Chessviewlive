"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_TIME_TROUBLE_MS, formatChessClockMs, isTimeTrouble } from "@/lib/live/clockFormat";

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

export default function useMiniBoardClock({
  status,
  whiteTimeMs,
  blackTimeMs,
  sideToMove,
  tickMs = 1000,
  timeTroubleMs = DEFAULT_TIME_TROUBLE_MS,
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

  const whiteTimeLabel = useMemo(() => formatChessClockMs(whiteMs), [whiteMs]);
  const blackTimeLabel = useMemo(() => formatChessClockMs(blackMs), [blackMs]);
  const isLive = status === "live";
  const isWhiteInTimeTrouble = isTimeTrouble(whiteMs, { enabled: isLive, timeTroubleMs });
  const isBlackInTimeTrouble = isTimeTrouble(blackMs, { enabled: isLive, timeTroubleMs });

  return { whiteTimeLabel, blackTimeLabel, isWhiteInTimeTrouble, isBlackInTimeTrouble };
}

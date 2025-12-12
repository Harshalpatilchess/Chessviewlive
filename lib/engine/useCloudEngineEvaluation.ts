"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CURRENT_ENGINE_CONFIG,
  DEFAULT_ENGINE_PROFILE_ID,
  type CloudEngineLine,
  type CloudEngineRequest,
  type CloudEngineResponse,
  type EngineBackend,
  type EngineProfileConfig,
  type EngineProfileId,
  getEngineProfileConfig,
  isEngineProfileId,
} from "./config";
import { getSavedEngineProfileId, saveEngineProfileId } from "./persistence";
import type { StockfishEval, StockfishLine } from "./useStockfishEvaluation";

type UseCloudEngineEvaluationOptions = {
  enabled?: boolean;
  multiPv?: number;
  depthIndex?: number;
  profileId?: EngineProfileId;
  targetDepth?: number;
};

const ENGINE_CONFIG = CURRENT_ENGINE_CONFIG;
const DEFAULT_PROFILE_CONFIG = getEngineProfileConfig(DEFAULT_ENGINE_PROFILE_ID);
const CLOUD_ENGINE_NAME =
  (ENGINE_CONFIG.backends?.cloud as { engineName?: string } | undefined)?.engineName ?? "Stockfish (cloud)";
const ENGINE_BACKEND: EngineBackend = "cloud";

const clampLineCount = (value?: number | null) => {
  const fallback = ENGINE_CONFIG.defaults?.multiPv ?? DEFAULT_PROFILE_CONFIG.multiPv ?? 1;
  const normalized = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(3, Math.round(normalized)));
};

const clampDepthIndex = (value: number | undefined, steps: number[]): number => {
  const maxIndex = Math.max(steps.length - 1, 0);
  const normalized = Number.isFinite(value ?? NaN) ? Math.round(value as number) : 0;
  return Math.max(0, Math.min(maxIndex, normalized));
};

const resolveDepthSteps = (profile: EngineProfileConfig): number[] => {
  const profileSteps = Array.isArray(profile.depthSteps) ? profile.depthSteps.filter(step => Number.isFinite(step)) : [];
  const fallbackSteps =
    (Array.isArray(ENGINE_CONFIG.defaults?.depthSteps) && ENGINE_CONFIG.defaults?.depthSteps?.length
      ? ENGINE_CONFIG.defaults.depthSteps
      : []) || DEFAULT_PROFILE_CONFIG.depthSteps;
  return profileSteps.length ? profileSteps : fallbackSteps;
};

const mapCloudLineToStockfishLine = (line: CloudEngineLine): StockfishLine => {
  const multipv = Number.isFinite(line?.multipv) ? Number(line.multipv) : 1;
  const cp = Number.isFinite(line?.scoreCp ?? NaN) ? Number(line.scoreCp) : undefined;
  const mate = Number.isFinite(line?.scoreMate ?? NaN) ? Number(line.scoreMate) : undefined;
  const depth = Number.isFinite(line?.depth ?? NaN) ? Number(line.depth) : undefined;
  const pv = Array.isArray(line?.pvMoves) ? line.pvMoves.join(" ") : "";

  return { multipv, cp, mate, depth, pv };
};

const deriveEvalFromCloudLines = (lines: CloudEngineLine[]): StockfishEval => {
  if (!Array.isArray(lines) || !lines.length) return null;
  const [primary] = lines;
  if (typeof primary?.scoreMate === "number") return { mate: primary.scoreMate };
  if (typeof primary?.scoreCp === "number") return { cp: primary.scoreCp };
  return null;
};

export default function useCloudEngineEvaluation(
  fen: string | null,
  options: UseCloudEngineEvaluationOptions = {}
) {
  const enabled = options.enabled ?? true;
  const initialProfileId = (() => {
    const preferred = options.profileId ?? getSavedEngineProfileId();
    if (preferred && isEngineProfileId(preferred)) return preferred;
    return DEFAULT_ENGINE_PROFILE_ID;
  })();
  const initialProfileConfig = getEngineProfileConfig(initialProfileId);
  const initialDepthSteps = resolveDepthSteps(initialProfileConfig);

  const [activeProfileId, setActiveProfileIdState] = useState<EngineProfileId>(initialProfileId);
  const [depthIndex, setDepthIndexState] = useState<number>(() =>
    clampDepthIndex(options.depthIndex ?? initialProfileConfig.defaultDepthIndex, initialDepthSteps)
  );
  const [multiPv, setMultiPvState] = useState<number>(() =>
    clampLineCount(options.multiPv ?? initialProfileConfig.multiPv)
  );
  const [evalResult, setEvalResult] = useState<StockfishEval>(null);
  const [bestLines, setBestLines] = useState<StockfishLine[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [engineName, setEngineName] = useState<string | undefined>(CLOUD_ENGINE_NAME);
  const requestIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFenRef = useRef<string | null>(null);

  const activeProfileConfig = useMemo(
    () => getEngineProfileConfig(activeProfileId),
    [activeProfileId]
  );
  const depthSteps = useMemo(() => resolveDepthSteps(activeProfileConfig), [activeProfileConfig]);
  const effectiveDepthIndex = clampDepthIndex(depthIndex, depthSteps);
  const targetDepth = options.targetDepth ?? depthSteps[effectiveDepthIndex];
  const effectiveMultiPv = clampLineCount(multiPv);

  useEffect(() => {
    setDepthIndexState(prev => clampDepthIndex(prev, depthSteps));
    setMultiPvState(prev => clampLineCount(prev));
  }, [depthSteps]);

  useEffect(() => {
    if (options.profileId && isEngineProfileId(options.profileId) && options.profileId !== activeProfileId) {
      const profile = getEngineProfileConfig(options.profileId);
      const profileSteps = resolveDepthSteps(profile);
      setActiveProfileIdState(profile.id);
      setDepthIndexState(clampDepthIndex(profile.defaultDepthIndex, profileSteps));
      setMultiPvState(clampLineCount(profile.multiPv));
    }
  }, [activeProfileId, options.profileId]);

  useEffect(() => {
    if (!enabled || !fen) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setIsEvaluating(false);
      setLastError(null);
      requestIdRef.current = null;
      return;
    }

    const isNewPosition = fen !== lastFenRef.current;
    if (isNewPosition) {
      setEvalResult(null);
      setBestLines([]);
    }
    lastFenRef.current = fen;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    requestIdRef.current = requestId;
    setIsEvaluating(true);
    setLastError(null);

    const payload: CloudEngineRequest = {
      fen,
      movetimeMs: activeProfileConfig.movetimeMs ?? ENGINE_CONFIG.defaults?.movetimeMs,
      multiPv: effectiveMultiPv,
      requestId,
      searchMode: "depth",
      targetDepth: Number.isFinite(targetDepth) ? Math.max(1, Math.round(Number(targetDepth))) : undefined,
      threads: activeProfileConfig.threads ?? ENGINE_CONFIG.defaults?.threads,
      hashMb: activeProfileConfig.hashMb ?? ENGINE_CONFIG.defaults?.hashMb,
      skillLevel: activeProfileConfig.skillLevel,
      profileId: activeProfileId,
    };

    const run = async () => {
      try {
        const response = await fetch("/api/engine/eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}));
          throw new Error(
            `Cloud eval HTTP ${response.status}: ${errorPayload?.error ?? "Unknown error from cloud backend"}`
          );
        }
        const json = (await response.json()) as CloudEngineResponse;
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        const lines = Array.isArray(json.lines) ? json.lines : [];
        const mappedLines = lines.map(mapCloudLineToStockfishLine).sort((a, b) => a.multipv - b.multipv);
        setEngineName(json.engineName ?? CLOUD_ENGINE_NAME);
        setEvalResult(deriveEvalFromCloudLines(lines));
        setBestLines(mappedLines);
        setIsEvaluating(false);
        requestIdRef.current = null;
      } catch (error) {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        setIsEvaluating(false);
        setLastError(error instanceof Error ? error.message : String(error ?? "Unknown error"));
      }
    };

    run();

    return () => {
      controller.abort();
    };
  }, [
    activeProfileConfig.hashMb,
    activeProfileConfig.movetimeMs,
    activeProfileConfig.skillLevel,
    activeProfileConfig.threads,
    activeProfileId,
    depthSteps,
    effectiveDepthIndex,
    effectiveMultiPv,
    enabled,
    fen,
    targetDepth,
  ]);

  const setActiveProfileId = (next: EngineProfileId) => {
    if (!isEngineProfileId(next)) return;
    const profile = getEngineProfileConfig(next);
    const profileSteps = resolveDepthSteps(profile);
    setActiveProfileIdState(profile.id);
    setDepthIndexState(clampDepthIndex(profile.defaultDepthIndex, profileSteps));
    setMultiPvState(clampLineCount(profile.multiPv));
    saveEngineProfileId(profile.id);
  };

  const setDepthIndex = (value: number) => {
    setDepthIndexState(clampDepthIndex(value, depthSteps));
  };

  const setMultiPv = (value: number) => {
    setMultiPvState(clampLineCount(value));
  };

  return {
    eval: evalResult,
    bestLines,
    isEvaluating,
    engineName,
    engineBackend: ENGINE_BACKEND,
    setEngineBackend: undefined,
    activeProfileId,
    activeProfileConfig,
    multiPv: effectiveMultiPv,
    targetDepth,
    depthIndex: effectiveDepthIndex,
    depthSteps,
    setDepthIndex,
    setMultiPv,
    setActiveProfileId,
    lastError,
    lastFen: lastFenRef.current,
  };
}

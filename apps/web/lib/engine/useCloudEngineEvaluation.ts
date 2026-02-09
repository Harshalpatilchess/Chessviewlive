"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CURRENT_ENGINE_CONFIG,
  DEFAULT_ENGINE_PROFILE_ID,
  ENGINE_DISPLAY_NAME,
  type CloudEngineLine,
  type CloudEngineRequest,
  type CloudEngineResponse,
  type EngineBackend,
  type EngineProfileConfig,
  type EngineProfileId,
  getEngineProfileConfig,
  isEngineProfileId,
} from "./config";
import {
  getSavedEngineMultiPv,
  getSavedEngineProfileId,
  saveEngineMultiPv,
  saveEngineProfileId,
} from "./persistence";
import type { StockfishEval, StockfishLine } from "./useStockfishEvaluation";

type UseCloudEngineEvaluationOptions = {
  enabled?: boolean;
  multiPv?: number;
  depthIndex?: number;
  profileId?: EngineProfileId;
  targetDepth?: number;
  debounceMs?: number;
};

const ENGINE_CONFIG = CURRENT_ENGINE_CONFIG;
const DEFAULT_PROFILE_CONFIG = getEngineProfileConfig(DEFAULT_ENGINE_PROFILE_ID);
const CLOUD_ENGINE_NAME = ENGINE_DISPLAY_NAME;
const ENGINE_BACKEND: EngineBackend = "cloud";
const DEBUG_ENGINE = process.env.NODE_ENV === "development";

const getFenHash = (fen: string | null) => {
  if (typeof fen !== "string") return "--";
  const trimmed = fen.trim();
  if (!trimmed) return "--";
  return trimmed.slice(0, 12);
};

const clampLineCount = (value?: number | null) => {
  const fallback = 1;
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
  const multipvRaw = Number(line?.multipv);
  const multipv = Number.isFinite(multipvRaw) ? multipvRaw : 1;
  const cpRaw = Number((line as { scoreCp?: number | string }).scoreCp);
  const cp = Number.isFinite(cpRaw) ? cpRaw : undefined;
  const mateRaw = Number((line as { scoreMate?: number | string }).scoreMate);
  const mate = Number.isFinite(mateRaw) ? mateRaw : undefined;
  const depthRaw = Number(line?.depth);
  const depth = Number.isFinite(depthRaw) ? depthRaw : undefined;
  const pvValue = (line as { pv?: string }).pv;
  const pvRaw = typeof pvValue === "string" ? pvValue : "";
  const pv = Array.isArray(line?.pvMoves) ? line.pvMoves.join(" ") : pvRaw.trim();

  return { multipv, cp, mate, depth, pv };
};

const deriveEvalFromCloudLines = (lines: CloudEngineLine[]): StockfishEval => {
  if (!Array.isArray(lines) || !lines.length) return null;
  const [primary] = lines;
  const mateRaw = Number((primary as { scoreMate?: number | string }).scoreMate);
  if (Number.isFinite(mateRaw)) return { mate: mateRaw };
  const cpRaw = Number((primary as { scoreCp?: number | string }).scoreCp);
  if (Number.isFinite(cpRaw)) return { cp: cpRaw };
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
    clampLineCount(options.multiPv ?? getSavedEngineMultiPv() ?? initialProfileConfig.multiPv ?? 1)
  );
  const [evalResult, setEvalResult] = useState<StockfishEval>(null);
  const [bestLines, setBestLines] = useState<StockfishLine[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [engineName, setEngineName] = useState<string | undefined>(CLOUD_ENGINE_NAME);
  const [evaluatedFen, setEvaluatedFen] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFenRef = useRef<string | null>(null);
  const lastRequestKeyRef = useRef<string | null>(null);
  const inflightKeyRef = useRef<string | null>(null);
  const debounceTimeoutRef = useRef<number | null>(null);

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
    }
  }, [activeProfileId, options.profileId]);

  useEffect(() => {
    if (!enabled || !fen) {
      if (debounceTimeoutRef.current) {
        window.clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setIsEvaluating(false);
      setLastError(null);
      requestIdRef.current = null;
      return;
    }

    const normalizedFen = typeof fen === "string" ? fen.trim() : "";
    if (!normalizedFen) return;
    lastFenRef.current = normalizedFen;

    const requestKey = [
      normalizedFen,
      activeProfileId,
      effectiveMultiPv,
      Number.isFinite(targetDepth) ? Math.round(Number(targetDepth)) : "depth:auto",
      activeProfileConfig.movetimeMs ?? ENGINE_CONFIG.defaults?.movetimeMs ?? "movetime:auto",
      activeProfileConfig.threads ?? ENGINE_CONFIG.defaults?.threads ?? "threads:auto",
      activeProfileConfig.hashMb ?? ENGINE_CONFIG.defaults?.hashMb ?? "hash:auto",
      activeProfileConfig.skillLevel ?? "skill:auto",
    ].join("|");

    if (lastRequestKeyRef.current === requestKey || inflightKeyRef.current === requestKey) {
      return;
    }

    if (debounceTimeoutRef.current) {
      window.clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    const startRequest = () => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      requestIdRef.current = requestId;
      inflightKeyRef.current = requestKey;
      const fenHash = getFenHash(normalizedFen);
      if (DEBUG_ENGINE) {
        console.log("[engine] request start", { requestId, fenHash });
      }
      setIsEvaluating(true);
      setLastError(null);

      const payload: CloudEngineRequest = {
        fen: normalizedFen,
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

      const currentRequestKey = requestKey;
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
        if (controller.signal.aborted || requestIdRef.current !== requestId) {
          if (DEBUG_ENGINE) {
            console.log("[engine] ignored stale response", {
              requestId,
              fenHash,
              reason: controller.signal.aborted ? "aborted" : "superseded",
            });
          }
          return;
        }
        const lines = Array.isArray(json.lines) ? json.lines : [];
        const mappedLines = lines.map(mapCloudLineToStockfishLine).sort((a, b) => a.multipv - b.multipv);
        const nextEval = deriveEvalFromCloudLines(lines);
        if (DEBUG_ENGINE) {
          const scoreLabel =
            typeof nextEval?.mate === "number"
              ? `M${nextEval.mate}`
              : typeof nextEval?.cp === "number"
                ? `${Math.round(nextEval.cp)}`
                : "--";
          console.log("[engine] response", { requestId, fenHash, score: scoreLabel });
        }
        setEngineName(CLOUD_ENGINE_NAME);
        setEvalResult(nextEval);
        setBestLines(mappedLines);
        setEvaluatedFen(normalizedFen);
        setIsEvaluating(false);
        requestIdRef.current = null;
        lastRequestKeyRef.current = currentRequestKey;
      } catch (error) {
        if (controller.signal.aborted || requestIdRef.current !== requestId) {
          if (DEBUG_ENGINE) {
            console.log("[engine] ignored stale response", {
              requestId,
              fenHash,
              reason: controller.signal.aborted ? "aborted" : "superseded",
            });
          }
          return;
        }
        setIsEvaluating(false);
        setLastError(error instanceof Error ? error.message : String(error ?? "Unknown error"));
      } finally {
        if (inflightKeyRef.current === currentRequestKey) {
          inflightKeyRef.current = null;
        }
      }
    };

      run();
    };

    const debounceMs = Number.isFinite(options.debounceMs ?? NaN) ? Math.max(0, Math.round(options.debounceMs as number)) : 0;
    if (debounceMs > 0) {
      debounceTimeoutRef.current = window.setTimeout(startRequest, debounceMs);
    } else {
      startRequest();
    }

    return () => {
      if (debounceTimeoutRef.current) {
        window.clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
      abortControllerRef.current?.abort();
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
    options.debounceMs,
  ]);

  const setActiveProfileId = (next: EngineProfileId) => {
    if (!isEngineProfileId(next)) return;
    const profile = getEngineProfileConfig(next);
    const profileSteps = resolveDepthSteps(profile);
    setActiveProfileIdState(profile.id);
    setDepthIndexState(clampDepthIndex(profile.defaultDepthIndex, profileSteps));
    saveEngineProfileId(profile.id);
  };

  const setDepthIndex = (value: number) => {
    setDepthIndexState(clampDepthIndex(value, depthSteps));
  };

  const setMultiPv = (value: number) => {
    const next = clampLineCount(value);
    setMultiPvState(next);
    saveEngineMultiPv(next);
  };

  return {
    eval: evalResult,
    bestLines,
    isEvaluating,
    isUpdating: Boolean(enabled && fen && isEvaluating && evaluatedFen !== fen),
    evaluatedFen,
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

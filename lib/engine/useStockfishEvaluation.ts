"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  CURRENT_ENGINE_CONFIG,
  DEFAULT_ENGINE_PROFILE_ID,
  ENABLE_CLOUD_ENGINE,
  ENABLE_WASM_EXPERIMENT,
  ENABLE_WASM_NNUE_EXPERIMENT,
  DEBUG_ENGINE_SWITCHER,
  type CloudBackendConfig,
  type CloudEngineRequest,
  type CloudEngineResponse,
  type EngineBackend,
  type EngineProfileId,
  type EngineProfileConfig,
  getEngineProfileConfig,
} from "./config";
import { getSavedEngineProfileId, saveEngineProfileId } from "./persistence";

export type CloudEngineBackend = CloudEngineResponse["backend"];
export type CloudEngineLine = CloudEngineResponse["lines"][number];
export type CloudEngineResult = CloudEngineResponse;

export type StockfishEval = { cp?: number; mate?: number } | null;
export type StockfishLine = {
  multipv: number;
  cp?: number;
  mate?: number;
  pv?: string;
  depth?: number;
};

type StockfishEvalScore = { cp?: number; mate?: number } | null;
type StockfishMessageHandler = (event: MessageEvent<unknown>) => void;
type StockfishErrorHandler = (event: ErrorEvent) => void;
type EngineStatus = "idle" | "initializing" | "ready" | "error";

const ENGINE_CONFIG = CURRENT_ENGINE_CONFIG;
const DEFAULT_PROFILE_ID = DEFAULT_ENGINE_PROFILE_ID;
const DEFAULT_PROFILE_CONFIG = getEngineProfileConfig(DEFAULT_PROFILE_ID);

const CLOUD_BACKEND_CONFIG = ENGINE_CONFIG.backends?.cloud as CloudBackendConfig | undefined;
const CLOUD_ENABLED = Boolean(ENGINE_CONFIG.enableCloud ?? CLOUD_BACKEND_CONFIG?.enabled ?? ENABLE_CLOUD_ENGINE);
const CLOUD_BACKEND_ID: CloudEngineBackend = (CLOUD_BACKEND_CONFIG?.backendId as CloudEngineBackend | undefined) ?? "cloud";
const CLOUD_ENGINE_NAME = CLOUD_BACKEND_CONFIG?.engineName;

const WASM_ENABLED = Boolean(ENGINE_CONFIG.enableWasm && ENABLE_WASM_EXPERIMENT);
const WASM_NNUE_ENABLED = Boolean(ENGINE_CONFIG.enableWasmNnue && ENABLE_WASM_NNUE_EXPERIMENT);
const JS_WORKER_SCRIPT_PATH = "/engine/stockfish-asm.js";
const WASM_NNUE_WORKER_MODULE_URL = new URL("../../workers/stockfish-wasm-nnue.ts", import.meta.url);
const ENGINE_NAME_FALLBACK: Record<EngineBackend, string> = {
  "js-worker": "Stockfish 17.1",
  wasm: "Stockfish 17.1",
  "wasm-nnue": "Stockfish 17.1",
  cloud: "Stockfish 17.1",
};
const normalizeBackendSelection = (backend: EngineBackend | null | undefined): EngineBackend => {
  if (backend === "cloud") {
    return CLOUD_ENABLED ? "cloud" : "js-worker";
  }
  if (backend === "wasm") {
    return WASM_ENABLED ? "wasm" : "js-worker";
  }
  if (backend === "wasm-nnue") {
    return WASM_NNUE_ENABLED ? "wasm-nnue" : "js-worker";
  }
  return "js-worker";
};

let activeBackend: EngineBackend = normalizeBackendSelection(ENGINE_CONFIG.activeBackend);
if (activeBackend === "cloud" && !CLOUD_ENABLED) {
  console.warn("[useStockfishEvaluation] Cloud backend disabled; using js-worker instead");
  activeBackend = "js-worker";
}
if (!WASM_ENABLED && activeBackend === "wasm") {
  activeBackend = "js-worker";
}
if (activeBackend === "wasm-nnue" && !WASM_NNUE_ENABLED) {
  console.warn("[useStockfishEvaluation] WASM NNUE backend disabled; using js-worker instead");
  activeBackend = "js-worker";
}
let stockfishWorkerRef: Worker | null = null;
let currentWorkerBackend: EngineBackend | null = null;
let stockfishReady = false;
let hasLoggedEngineId = false;
const pendingMessages: string[] = [];
let jsWorkerRef: Worker | null = null;
let jsWorkerInstanceId: number | null = null;
let jsWorkerMessageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
let jsWorkerInstanceCounter = 0;
let jsHandshakeInstanceId: number | null = null;
let jsHandshakeSent = false;
let globalMessageHandlers: StockfishMessageHandler[] = [];
let globalErrorHandlers: StockfishErrorHandler[] = [];
let engineThreads = DEFAULT_PROFILE_CONFIG.threads ?? ENGINE_CONFIG.defaults?.threads ?? 1;
let engineHashMb = DEFAULT_PROFILE_CONFIG.hashMb ?? ENGINE_CONFIG.defaults?.hashMb ?? 32;
let engineSkillLevel = DEFAULT_PROFILE_CONFIG.skillLevel;
let hasConfiguredOptions = false;
let hasInitializedCloudStub = false;
const ENGINE_DEBUG_VERBOSE =
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_ENGINE_DEBUG_VERBOSE === "true" : false;
const ENGINE_DEBUG_ENABLED =
  typeof process !== "undefined" ? process.env.NODE_ENV !== "production" : true;
const DEV_ALLOW_DUMMY_EVAL = ENGINE_DEBUG_ENABLED && false; // flip to true for temporary UI wiring checks
const BACKEND_PREFERENCE_KEY = "cv:engine:backend";
let engineStatus: EngineStatus = activeBackend === "cloud" ? "ready" : "idle";
let engineStatusSubscribers: Array<(status: EngineStatus) => void> = [];
let engineNameCacheRefGlobal: MutableRefObject<Partial<Record<EngineBackend, string>>> | null = null;
let setEngineNameGlobal: Dispatch<SetStateAction<string>> | null = null;
const getEngineNameFallback = (backend: EngineBackend | null): string => {
  if (!backend) return "Stockfish";
  if (backend === "cloud") {
    return CLOUD_ENGINE_NAME ?? ENGINE_NAME_FALLBACK[backend] ?? "Stockfish";
  }
  return ENGINE_NAME_FALLBACK[backend] ?? "Stockfish";
};
const resolveBackendKey = (label: string | null | undefined): EngineBackend => {
  if (label === "wasm" || label === "wasm-nnue" || label === "cloud") return label as EngineBackend;
  if (typeof label === "string" && label.startsWith("cloud")) return "cloud";
  return "js-worker";
};
const toBackendLogLabel = (backend: EngineBackend | null | undefined): string => {
  if (backend === "js-worker") return "js";
  if (backend === "wasm" || backend === "wasm-nnue") return backend;
  if (backend === "cloud") return "cloud";
  return "js";
};
const debugLog = (message: string, payload?: unknown) => {
  if (!ENGINE_DEBUG_VERBOSE) return;
  console.log(`[ENGINE HOOK] ${message}`, payload ?? "");
};

const clampMultiPv = (value?: number | null): number => {
  const fallback = ENGINE_CONFIG.defaults?.multiPv ?? 1;
  const normalized = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const rounded = Math.round(normalized);
  return Math.max(1, Math.min(3, rounded));
};

const clampDepthIndex = (value: number, steps: number[]): number => {
  const maxIndex = Math.max(0, steps.length - 1);
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > maxIndex) return maxIndex;
  return rounded;
};

const resolveDepthSteps = (profile: EngineProfileConfig): number[] => {
  const profileSteps = Array.isArray(profile.depthSteps) ? profile.depthSteps.filter(step => Number.isFinite(step)) : [];
  const fallbackSteps =
    (Array.isArray(ENGINE_CONFIG.defaults?.depthSteps) && ENGINE_CONFIG.defaults?.depthSteps?.length
      ? ENGINE_CONFIG.defaults.depthSteps
      : []) || DEFAULT_PROFILE_CONFIG.depthSteps;
  return profileSteps.length ? profileSteps : fallbackSteps;
};

const notifyEngineStatus = (next: EngineStatus) => {
  if (engineStatus === next) return;
  engineStatus = next;
  debugLog("Engine status changed", { status: engineStatus });
  engineStatusSubscribers.forEach(subscriber => {
    try {
      subscriber(engineStatus);
    } catch (error) {
      console.warn("[ENGINE HOOK] Failed to notify engine status subscriber", error);
    }
  });
};

const getEngineStatus = () => engineStatus;

const subscribeEngineStatus = (subscriber: (status: EngineStatus) => void) => {
  engineStatusSubscribers.push(subscriber);
  subscriber(engineStatus);
  return () => {
    engineStatusSubscribers = engineStatusSubscribers.filter(cb => cb !== subscriber);
  };
};

function resetWorkerInstance(reason?: string) {
  debugLog("Resetting worker instance", { reason, activeBackend, currentWorkerBackend });
  console.log("[ENGINE CORE] worker reset", { reason, activeBackend, currentWorkerBackend });
  if (stockfishWorkerRef) {
    try {
      stockfishWorkerRef.terminate();
    } catch (error) {
      console.warn("[ENGINE HOOK] Failed to terminate worker during reset", error);
    }
  }
  stockfishWorkerRef = null;
  stockfishReady = false;
  hasConfiguredOptions = false;
  hasLoggedEngineId = false;
  pendingMessages.splice(0, pendingMessages.length);
  jsWorkerRef = null;
  jsWorkerInstanceId = null;
  jsWorkerMessageHandler = null;
  jsHandshakeInstanceId = null;
  jsHandshakeSent = false;
  currentWorkerBackend = null;
}

const applyActiveBackend = (next: EngineBackend, reason?: string) => {
  const normalized = normalizeBackendSelection(next);
  if (normalized === activeBackend) return;
  console.log("[ENGINE STATE] backend switch", { from: activeBackend, to: normalized, reason });
  activeBackend = normalized;
  resetWorkerInstance(reason ?? `backend-switch:${next}`);
  notifyEngineStatus("idle");
};

function fallbackToJsWorker(reason: string, options?: { startWorker?: boolean }) {
  if (activeBackend === "js-worker") return;
  console.warn("[useStockfishEvaluation] Falling back to JS worker backend", { reason });
  activeBackend = "js-worker";
  resetWorkerInstance(reason);
  notifyEngineStatus("error");
  if (options?.startWorker) {
    getStockfishWorker();
  }
}

function canUseSharedArrayBufferInPage() {
  if (typeof SharedArrayBuffer === "undefined") return false;
  if (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated) return false;
  return true;
}

function flushPendingMessages(worker: Worker) {
  if (!pendingMessages.length) return;
  const queued = pendingMessages.splice(0);
  queued.forEach(cmd => {
    dispatchCommandToWorker(worker, cmd, { source: "flush-pending" });
  });
}

function markEngineInitializing() {
  notifyEngineStatus("initializing");
}

function markEngineReady(worker: Worker, source?: string) {
  if (stockfishReady) return;
  stockfishReady = true;
  configureStockfishOptions(worker);
  notifyEngineStatus("ready");
  debugLog("Engine marked ready", { source, pendingCount: pendingMessages.length });
  flushPendingMessages(worker);
}

function handleWorkerErrorEvent(backend: EngineBackend, event: ErrorEvent) {
  const errorMessage = event?.message || "Worker error";
  const logPayload = {
    rawEvent: event,
    message: event?.message,
    filename: event?.filename,
    lineno: event?.lineno,
    colno: event?.colno,
    backend,
  };
  if (backend === "wasm" || backend === "wasm-nnue") {
    console.error(`[ENGINE CORE ERROR] ${backend} worker error: ${errorMessage}`, logPayload);
  } else {
    console.warn("[ENGINE HOOK] Worker error (onerror)", logPayload);
  }
  notifyEngineStatus("error");
  globalErrorHandlers.forEach(handler => handler(event));
  if (backend === "wasm" || backend === "wasm-nnue") {
    fallbackToJsWorker(`WASM worker error: ${errorMessage}`, { startWorker: true });
    return;
  }
  resetWorkerInstance(errorMessage);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractMessageText = (data: unknown): string | null => {
  if (typeof data === "string") return data;
  if (isPlainObject(data)) {
    const maybeLine =
      (data as Record<string, unknown>)["line"] ??
      (data as Record<string, unknown>)["uci"] ??
      (data as Record<string, unknown>)["data"] ??
      (data as Record<string, unknown>)["message"] ??
      (data as Record<string, unknown>)["payload"] ??
      (data as Record<string, unknown>)["stdout"];
    if (typeof maybeLine === "string") return maybeLine;
  }
  if (data == null) return null;
  return String(data);
};

const normalizeEvalScore = (score: unknown): StockfishEvalScore => {
  if (!isPlainObject(score)) return null;
  const mate = (score as Record<string, unknown>)["mate"];
  const cp = (score as Record<string, unknown>)["cp"];
  if (typeof mate === "number" && Number.isFinite(mate)) return { mate };
  if (typeof cp === "number" && Number.isFinite(cp)) return { cp };
  return null;
};

const normalizeLinePayload = (line: unknown, fallback: StockfishEvalScore = null): StockfishLine => {
  const record: Record<string, unknown> = isPlainObject(line) ? line : {};
  const multipvRaw = record["multipv"];
  const cpRaw = record["cp"];
  const mateRaw = record["mate"];
  const depthRaw = record["depth"];
  const pvRaw = record["pv"];

  const multipv = typeof multipvRaw === "number" && Number.isFinite(multipvRaw) ? multipvRaw : 1;
  const cp =
    typeof cpRaw === "number" && Number.isFinite(cpRaw)
      ? cpRaw
      : typeof fallback?.cp === "number"
        ? fallback.cp
        : undefined;
  const mate =
    typeof mateRaw === "number" && Number.isFinite(mateRaw)
      ? mateRaw
      : typeof fallback?.mate === "number"
        ? fallback.mate
        : undefined;
  const depth = typeof depthRaw === "number" && Number.isFinite(depthRaw) ? depthRaw : undefined;
  const pv = typeof pvRaw === "string" ? pvRaw : "";

  return { multipv, cp, mate, depth, pv };
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

function buildWorker(scriptPath: string | URL, backend: EngineBackend): Worker {
  const resolvedScriptPath =
    backend === "js-worker"
      ? JS_WORKER_SCRIPT_PATH
      : backend === "wasm-nnue"
        ? WASM_NNUE_WORKER_MODULE_URL
        : scriptPath;
  const workerOptions: WorkerOptions | undefined = backend === "wasm-nnue" ? { type: "module" } : undefined;
  debugLog("Creating worker", { scriptPath: resolvedScriptPath, backend });
  let worker: Worker;
  try {
    worker =
      backend === "wasm-nnue"
        ? new Worker(new URL("../../workers/stockfish-wasm-nnue.ts", import.meta.url), workerOptions)
        : new Worker(resolvedScriptPath, workerOptions);
    if (backend === "js-worker") {
      jsWorkerRef = worker;
      jsWorkerInstanceCounter += 1;
      jsWorkerInstanceId = jsWorkerInstanceCounter;
      jsHandshakeSent = false;
      console.log(
        `[ENGINE CORE] js-worker created from ${resolvedScriptPath} (instance ${jsWorkerInstanceId})`
      );
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (ENGINE_DEBUG_VERBOSE) {
          console.log("[ENGINE CORE] js-worker onmessage fired, typeof data:", typeof event.data);
          console.log("[ENGINE CORE] js-worker raw message:", event.data);
        }
        if (typeof event.data !== "string") return;
        if (ENGINE_DEBUG_VERBOSE) {
          console.log(`[ENGINE CORE] line from engine (js): ${event.data}`);
        }
        if (jsWorkerMessageHandler) {
          jsWorkerMessageHandler(event);
        }
      };
      worker.onerror = (errorEvent: ErrorEvent) => {
        console.error("[ENGINE CORE] js-worker ERROR:", errorEvent);
        handleWorkerErrorEvent(backend, errorEvent);
      };
    } else {
      worker.onerror = (event: ErrorEvent) => {
        handleWorkerErrorEvent(backend, event);
      };
    }
    debugLog("Worker constructed", { scriptPath: resolvedScriptPath, workerInstance: Boolean(worker), backend });
  } catch (error) {
    notifyEngineStatus("error");
    throw error;
  }

  return worker;
}

function scheduleJsHandshake(worker: Worker) {
  if (jsWorkerInstanceId == null) return;
  if (jsHandshakeInstanceId === jsWorkerInstanceId) return;
  jsHandshakeInstanceId = jsWorkerInstanceId;
  setTimeout(() => {
    const targetWorker = jsWorkerRef ?? worker;
    if (!targetWorker) {
      console.error("[ENGINE CORE] js-worker send ERROR: worker not initialized for auto-handshake");
      return;
    }
    dispatchCommandToWorker(targetWorker, "uci", { source: "auto-handshake" });
    dispatchCommandToWorker(targetWorker, "isready", { source: "auto-handshake" });
  }, 0);
}

function configureStockfishOptions(worker: Worker) {
  if (hasConfiguredOptions) return;
  hasConfiguredOptions = true;
  debugLog("Configuring worker options", { threads: engineThreads, hashMb: engineHashMb });
  dispatchCommandToWorker(worker, `setoption name Threads value ${engineThreads}`, { source: "configure" });
  dispatchCommandToWorker(worker, `setoption name Hash value ${engineHashMb}`, { source: "configure" });
  if (Number.isFinite(engineSkillLevel ?? NaN)) {
    dispatchCommandToWorker(worker, `setoption name Skill Level value ${engineSkillLevel}`, { source: "configure" });
  }
}

function createWorker(): { worker: Worker; backend: EngineBackend } {
  if (activeBackend === "wasm" && !WASM_ENABLED) {
    console.info("[useStockfishEvaluation] WASM backend disabled; using js-worker");
    activeBackend = "js-worker";
  }

  if (activeBackend === "wasm-nnue") {
    if (!WASM_NNUE_ENABLED) {
      console.info("[useStockfishEvaluation] WASM NNUE backend disabled; using js-worker");
      activeBackend = "js-worker";
    } else {
      const resolvedWasmNnueUrl = WASM_NNUE_WORKER_MODULE_URL;
      const resolvedPath = resolvedWasmNnueUrl.toString();
      const workerLogPayload =
        ENGINE_CONFIG.wasmNnueWorkerHint && ENGINE_CONFIG.wasmNnueWorkerHint !== resolvedPath
          ? { path: resolvedPath, hint: ENGINE_CONFIG.wasmNnueWorkerHint }
          : { path: resolvedPath };
      try {
        const worker = buildWorker(resolvedWasmNnueUrl, "wasm-nnue");
        console.log("[ENGINE CORE] wasm-nnue worker created", workerLogPayload);
        return { worker, backend: "wasm-nnue" };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error ?? "Unknown WASM NNUE worker error");
        console.error("[ENGINE CORE ERROR] wasm-nnue worker error:", errorMessage);
        fallbackToJsWorker(`WASM worker error: ${errorMessage}`, { startWorker: false });
      }
    }
  }

  if (activeBackend === "wasm") {
    const wasmPath = ENGINE_CONFIG.wasmWorkerScriptPath;
    if (!wasmPath) {
      console.warn("[useStockfishEvaluation] Missing wasmWorkerScriptPath; falling back to js-worker");
      activeBackend = "js-worker";
    } else {
      try {
        const worker = buildWorker(wasmPath, "wasm");
        return { worker, backend: "wasm" };
      } catch (error) {
        console.warn("[useStockfishEvaluation] Failed to create WASM worker, falling back to js-worker", error);
        fallbackToJsWorker("Failed to construct WASM worker", { startWorker: false });
      }
    }
  }

  if (activeBackend === "cloud") {
    throw new Error("[useStockfishEvaluation] Cloud backend not implemented yet");
  }

  if (activeBackend !== "js-worker" && activeBackend !== "wasm" && activeBackend !== "wasm-nnue") {
    throw new Error(`[useStockfishEvaluation] Unknown engine backend: ${activeBackend}`);
  }

  const workerScriptPath = JS_WORKER_SCRIPT_PATH;
  const worker = buildWorker(workerScriptPath, "js-worker");
  return { worker, backend: "js-worker" };
}

function dispatchCommandToWorker(worker: Worker, command: string, meta?: { source?: string }) {
  const backendLabel = currentWorkerBackend ?? activeBackend;
  const normalizedCommand = command.trim().toLowerCase();
  if (backendLabel === "js-worker") {
    const isHandshakeCommand =
      meta?.source === "auto-handshake" ||
      meta?.source === "auto-handshake-on-send" ||
      meta?.source === "uciok" ||
      normalizedCommand === "uci" ||
      normalizedCommand === "isready";
    if (!jsWorkerRef) {
      console.error(`[ENGINE CORE] js-worker send ERROR: worker not initialized for command: ${command}`);
      return;
    }
    if (worker !== jsWorkerRef) {
      worker = jsWorkerRef;
    }
    if (ENGINE_DEBUG_VERBOSE) {
      console.log("[ENGINE CORE] js-worker send using worker:", jsWorkerInstanceId ?? "[unknown]");
    }

    if (!jsHandshakeSent && isHandshakeCommand) {
      jsHandshakeSent = true;
    }

    if (!jsHandshakeSent && !isHandshakeCommand) {
      dispatchCommandToWorker(worker, "uci", { source: "auto-handshake-on-send" });
      dispatchCommandToWorker(worker, "isready", { source: "auto-handshake-on-send" });
      jsHandshakeSent = true;
    }

    if (jsHandshakeSent && meta?.source === "auto-handshake") {
      return;
    }
  }
  debugLog("Dispatching command to worker", {
    command,
    backend: backendLabel,
    source: meta?.source,
    ready: stockfishReady,
  });
  if (backendLabel === "js-worker") {
    let suffix = "";
    if (meta?.source === "auto-handshake") {
      suffix = " (auto-handshake)";
    } else if (meta?.source === "auto-handshake-on-send") {
      suffix = " (auto-handshake-on-send)";
    }
    console.log(`[ENGINE CORE] sending to engine (js): ${command}${suffix}`);
  }
  try {
    worker.postMessage(command);
  } catch (error) {
    console.warn("[ENGINE HOOK] Failed to send command to worker", { command, error, meta });
  }
}

function handleEngineErrorPayload(rawPayload: unknown, backend: EngineBackend) {
  if (!isPlainObject(rawPayload)) return;
  const payloadBackendRaw = (rawPayload as Record<string, unknown>)["backend"];
  const payloadBackend =
    payloadBackendRaw === "wasm" || payloadBackendRaw === "wasm-nnue" || payloadBackendRaw === "js-worker"
      ? (payloadBackendRaw as EngineBackend)
      : backend;
  const errorMessageRaw =
    (rawPayload as Record<string, unknown>)["error"] ??
    (rawPayload as Record<string, unknown>)["message"] ??
    (rawPayload as Record<string, unknown>)["details"];
  const errorMessage =
    typeof errorMessageRaw === "string" && errorMessageRaw.length
      ? errorMessageRaw
      : "Engine error reported by worker";
  const detailsRaw = (rawPayload as Record<string, unknown>)["details"];
  const details =
    typeof detailsRaw === "string" && detailsRaw.length
      ? detailsRaw
      : typeof detailsRaw === "number"
        ? String(detailsRaw)
        : null;

  console.warn("[useStockfishEvaluation] Engine error payload", {
    backend: payloadBackend,
    message: errorMessage,
    details,
  });
  notifyEngineStatus("error");
  if (payloadBackend === "wasm" || payloadBackend === "wasm-nnue") {
    fallbackToJsWorker(errorMessage, { startWorker: true });
  }
}

function handleEngineStatusPayload(rawPayload: unknown, worker: Worker, backend: EngineBackend) {
  if (!isPlainObject(rawPayload)) return;
  const statusRaw = (rawPayload as Record<string, unknown>)["status"];
  const status = typeof statusRaw === "string" ? statusRaw.toLowerCase() : "";
  if (!status) return;

  debugLog("Engine-status event received", { status, backend, rawPayload, currentStatus: engineStatus });

  if (status === "ready") {
    markEngineReady(worker, `engine-status:${backend}`);
    return;
  }

  if (status === "uciok" || status === "initializing") {
    markEngineInitializing();
    dispatchCommandToWorker(worker, "isready", { source: "status-handler" });
    return;
  }
}

function initializeWorker(worker: Worker, backend: EngineBackend) {
  const handleMessage = (event: MessageEvent<unknown>) => {
    const text =
      backend === "js-worker"
        ? String(event.data ?? "")
        : extractMessageText(event.data) ?? String(event.data ?? "");
    const rawPayload = event.data as unknown;
    const payloadType = isPlainObject(rawPayload)
      ? (rawPayload as Record<string, unknown>)["type"]
      : null;
    const backendLabel = currentWorkerBackend ?? backend;

    debugLog("[ENGINE HOOK RAW] message", { text, raw: rawPayload, payloadType });
    if (ENGINE_DEBUG_VERBOSE && backend === "js-worker" && typeof text === "string") {
      console.log(`[ENGINE CORE] line from engine (js): ${text}`);
    }

    if (text.startsWith("id name")) {
      const backendKey = resolveBackendKey(backendLabel);
      const parsedName = text.slice("id name".length).trim() || getEngineNameFallback(backendKey);
      const cacheRef = engineNameCacheRefGlobal;
      if (cacheRef) {
        cacheRef.current[backendKey] = parsedName;
      }
      setEngineNameGlobal?.(parsedName);
      if (!hasLoggedEngineId) {
        hasLoggedEngineId = true;
        console.log("[Stockfish] Engine ID:", text);
      }
    }

    if (payloadType === "engine-status") {
      handleEngineStatusPayload(rawPayload, worker, backend);
      return;
    }

    if (payloadType === "engine-error") {
      handleEngineErrorPayload(rawPayload, backend);
      return;
    }

    if (text.includes("uciok")) {
      configureStockfishOptions(worker);
      markEngineInitializing();
      debugLog("Engine reported uciok; awaiting readyok");
      dispatchCommandToWorker(worker, "isready", { source: "uciok" });
      return;
    }

    if (text.includes("readyok")) {
      markEngineReady(worker, "readyok-line");
      return;
    }

    if (ENGINE_DEBUG_VERBOSE && backend === "js-worker" && text.trimStart().toLowerCase().startsWith("bestmove")) {
      console.log(`[ENGINE CORE] BESTMOVE (js): ${text}`);
    }

    const forwardedEvent =
      backend === "js-worker" ? (new MessageEvent("message", { data: text }) as MessageEvent<unknown>) : event;
    globalMessageHandlers.forEach(handler => handler(forwardedEvent));
  };

  if (backend === "js-worker") {
    jsWorkerMessageHandler = handleMessage as unknown as (event: MessageEvent<unknown>) => void;
  } else {
    worker.onmessage = handleMessage as unknown as (event: MessageEvent<unknown>) => void;
  }

  notifyEngineStatus("initializing");
  if (backend === "js-worker") {
    scheduleJsHandshake(worker);
  } else {
    dispatchCommandToWorker(worker, "uci", { source: "auto-handshake" });
    dispatchCommandToWorker(worker, "isready", { source: "auto-handshake" });
  }
}

function getStockfishWorker(): Worker | null {
  if (typeof window === "undefined") return null;
  if (activeBackend === "cloud") {
    currentWorkerBackend = "cloud";
    if (!hasInitializedCloudStub) {
      console.log("[ENGINE CORE] (cloud stub) Skipping worker init; using cloud backend");
      hasInitializedCloudStub = true;
    }
    notifyEngineStatus("ready");
    return null;
  }
  if (stockfishWorkerRef) return stockfishWorkerRef;

  if ((activeBackend === "wasm" || activeBackend === "wasm-nnue") && !canUseSharedArrayBufferInPage()) {
    console.warn(
      "[useStockfishEvaluation] SharedArrayBuffer unavailable in this context; falling back to js-worker backend"
    );
    fallbackToJsWorker("SharedArrayBuffer unavailable", { startWorker: false });
  }

  try {
    const { worker, backend } = createWorker();
    stockfishWorkerRef = worker;
    currentWorkerBackend = backend;
    console.log("[ENGINE CORE] worker created", { backend });
    debugLog("Worker created", { backend });
    initializeWorker(worker, backend);
    return worker;
  } catch (error) {
    console.error("[useStockfishEvaluation] Failed to create Stockfish worker", error);
    notifyEngineStatus("error");
    stockfishWorkerRef = null;
    currentWorkerBackend = null;
    return null;
  }
}

function subscribeToStockfish(handler: StockfishMessageHandler) {
  globalMessageHandlers.push(handler);
  return () => {
    globalMessageHandlers = globalMessageHandlers.filter(h => h !== handler);
  };
}

function subscribeToStockfishErrors(handler: StockfishErrorHandler) {
  globalErrorHandlers.push(handler);
  return () => {
    globalErrorHandlers = globalErrorHandlers.filter(h => h !== handler);
  };
}

export function useStockfishEvaluation(
  fen: string | null,
  options?: {
    enabled?: boolean;
    profileId?: EngineProfileId;
    threads?: number;
    hashMb?: number;
  }
) {
  const requestedProfileId = options?.profileId;
  const [activeProfileId, setActiveProfileIdState] = useState<EngineProfileId>(() => requestedProfileId ?? DEFAULT_PROFILE_ID);
  const applyProfileSelection = useCallback(
    (next: EngineProfileId) => {
      setActiveProfileIdState(prev => (prev === next ? prev : next));
      saveEngineProfileId(next);
    },
    []
  );
  const [engineStatusState, setEngineStatusState] = useState<EngineStatus>(() => getEngineStatus());
  const [engineEval, setEngineEval] = useState<StockfishEval>(null);
  const [bestLines, setBestLines] = useState<StockfishLine[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const engineNameCacheRef = useRef<Partial<Record<EngineBackend, string>>>({});
  const [engineName, setEngineName] = useState<string>(() =>
    getEngineNameFallback(currentWorkerBackend ?? activeBackend ?? "js-worker")
  );
  const [engineBackend, setEngineBackend] = useState<EngineBackend>(() =>
    normalizeBackendSelection(resolveBackendKey(currentWorkerBackend ?? activeBackend))
  );
  const [lastFen, setLastFen] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const lastScoreRef = useRef<StockfishEvalScore>(null);
  const lineBufferRef = useRef<Record<number, StockfishLine>>({});
  const headlineLogRef = useRef<string | null>(null);
  const debugInjectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInjectedDebugEvalRef = useRef(false);
  const debugInjectionFenRef = useRef<string | null>(null);
  const enabled = options?.enabled ?? true;
  const activeProfileConfig = getEngineProfileConfig(activeProfileId);
  const depthSteps = useMemo(() => resolveDepthSteps(activeProfileConfig), [activeProfileConfig]);
  const [depthIndex, setDepthIndexState] = useState<number>(() =>
    clampDepthIndex(activeProfileConfig.defaultDepthIndex ?? ENGINE_CONFIG.defaults?.defaultDepthIndex ?? 0, depthSteps)
  );
  const targetDepth = depthSteps[clampDepthIndex(depthIndex, depthSteps)] ?? depthSteps[0] ?? 16;
  const effectiveTargetDepth = Number.isFinite(targetDepth) ? targetDepth : depthSteps[0] ?? 16;
  const [multiPv, setMultiPvState] = useState<number>(() =>
    clampMultiPv(activeProfileConfig.multiPv ?? ENGINE_CONFIG.defaults?.multiPv ?? 1)
  );
  const threads = options?.threads ?? activeProfileConfig.threads ?? ENGINE_CONFIG.defaults?.threads ?? 1;
  const hashMb = options?.hashMb ?? activeProfileConfig.hashMb ?? ENGINE_CONFIG.defaults?.hashMb ?? 32;
  const skillLevel = activeProfileConfig.skillLevel;
  useEffect(() => {
    engineNameCacheRefGlobal = engineNameCacheRef;
    setEngineNameGlobal = setEngineName;
    return () => {
      if (engineNameCacheRefGlobal === engineNameCacheRef) {
        engineNameCacheRefGlobal = null;
      }
      if (setEngineNameGlobal === setEngineName) {
        setEngineNameGlobal = null;
      }
    };
  }, [engineNameCacheRef, setEngineName]);
  const setMultiPv = useCallback(
    (value: number | ((prev: number) => number)) => {
      setMultiPvState(prev => {
        const next = typeof value === "function" ? (value as (arg: number) => number)(prev) : value;
        return clampMultiPv(next);
      });
    },
    []
  );
  const setDepthIndex = useCallback(
    (value: number | ((prev: number) => number)) => {
      setDepthIndexState(prev => {
        const next = typeof value === "function" ? (value as (arg: number) => number)(prev) : value;
        return clampDepthIndex(next, depthSteps);
      });
    },
    [depthSteps]
  );

  useEffect(() => {
    if (!requestedProfileId) return;
    if (requestedProfileId === activeProfileId) return;
    applyProfileSelection(requestedProfileId);
  }, [activeProfileId, applyProfileSelection, requestedProfileId]);

  useEffect(() => {
    const nextMultiPv = clampMultiPv(activeProfileConfig.multiPv ?? ENGINE_CONFIG.defaults?.multiPv ?? 1);
    const nextDepthIndex = clampDepthIndex(
      activeProfileConfig.defaultDepthIndex ?? ENGINE_CONFIG.defaults?.defaultDepthIndex ?? 0,
      depthSteps
    );
    setMultiPvState(prev => (prev === nextMultiPv ? prev : nextMultiPv));
    setDepthIndexState(prev => (prev === nextDepthIndex ? prev : nextDepthIndex));
  }, [activeProfileConfig.defaultDepthIndex, activeProfileConfig.multiPv, depthSteps]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = getSavedEngineProfileId();
    if (!saved || saved === activeProfileId) return;
    setActiveProfileIdState(saved);
  }, [activeProfileId]);

  useEffect(() => {
    console.log("[ENGINE STATE] profile selected", {
      profile: activeProfileId,
      targetDepth,
      depthSteps,
      multiPv,
    });
  }, [activeProfileId, depthSteps, multiPv, targetDepth]);

  useEffect(() => {
    const worker = getStockfishWorker();
    const backendKey = normalizeBackendSelection(resolveBackendKey(currentWorkerBackend ?? activeBackend));
    const isCloudBackend = backendKey === "cloud";
    if (!worker && !isCloudBackend) return;
    setEngineBackend(backendKey);
    const cachedEngineName = engineNameCacheRef.current[backendKey];
    const fallbackEngineName = getEngineNameFallback(backendKey);
    const effectiveName = cachedEngineName ?? fallbackEngineName;
    engineNameCacheRef.current[backendKey] = effectiveName;
    setEngineName(effectiveName);

    const processInfoPayload = (params: {
      score: StockfishEvalScore;
      depth?: number;
      multipv?: number;
      pv?: string;
      rawText?: string | null;
      treatedAs: string;
      backendLabel?: string | null;
    }) => {
      const backendLabel =
        params.backendLabel ?? toBackendLogLabel(resolveBackendKey(currentWorkerBackend ?? activeBackend));
      if (ENGINE_DEBUG_VERBOSE && params.rawText && params.rawText.includes("score")) {
        console.log(`[ENGINE HOOK RAW] info line (${backendLabel}): ${params.rawText}`);
      }

      const multipv = Number.isFinite(params.multipv ?? NaN) ? Number(params.multipv) : 1;
      const depth = Number.isFinite(params.depth ?? NaN) ? Number(params.depth) : undefined;
      const pv = typeof params.pv === "string" ? params.pv : "";
      const score = params.score;

      if (score) {
        lastScoreRef.current = score;
        if (requestIdRef.current) {
          if (backendLabel === "js") {
            console.log("[ENGINE STATE] eval updated (js info)", {
              eval: score,
              depth,
              multipv,
              pv,
              requestId: requestIdRef.current,
            });
          }
          setEngineEval(prev => {
            const hasChanged = !prev || prev.cp !== score?.cp || prev.mate !== score?.mate;
            if (hasChanged) {
              console.log("[ENGINE STATE] eval updated (info payload)", {
                raw: score,
                depth,
                multipv,
                requestId: requestIdRef.current,
              });
            }
            return score;
          });
        }
      }

      if (requestIdRef.current) {
        const currentBuffer = lineBufferRef.current;
        const prior = currentBuffer[multipv] ?? { multipv };
        const effectiveScore = score ?? lastScoreRef.current;
        const updated: StockfishLine = {
          multipv,
          cp: effectiveScore?.cp ?? prior.cp,
          mate: effectiveScore?.mate ?? prior.mate,
          depth: depth ?? prior.depth,
          pv: pv || prior.pv,
        };
        currentBuffer[multipv] = updated;
        const sortedLines = Object.values(currentBuffer).sort((a, b) => a.multipv - b.multipv);
        setBestLines(sortedLines);
        debugLog("Buffered info payload", {
          treatedAs: params.treatedAs,
          depth,
          multipv,
          pvPreview: pv ? pv.slice(0, 80) : null,
          parsedEval: effectiveScore,
          requestId: requestIdRef.current,
          bufferSize: sortedLines.length,
        });
      }
    };

    const parseInfoText = (line: string) => {
      const normalized = line.trim();
      if (!normalized.toLowerCase().startsWith("info")) return null;

      const depthMatch = normalized.match(/\bdepth\s+(\d+)/i);
      const multipvMatch = normalized.match(/\bmultipv\s+(\d+)/i);
      const scoreMatch = normalized.match(/\bscore\s+(cp|mate)\s+(-?\d+)/i);
      const pvMatch = normalized.match(/\bpv\s+(.+)$/i);

      if (!scoreMatch) return null;

      const scoreType = scoreMatch[1].toLowerCase();
      const scoreValue = parseInt(scoreMatch[2], 10);
      if (!Number.isFinite(scoreValue)) return null;

      const score = scoreType === "cp" ? { cp: scoreValue } : { mate: scoreValue };
      const depth = depthMatch ? parseInt(depthMatch[1], 10) || undefined : undefined;
      const multipv = multipvMatch ? parseInt(multipvMatch[1], 10) || 1 : 1;
      const pv = pvMatch ? pvMatch[1].trim() : "";

      return { score, depth, multipv, pv };
    };

    const handleMessage = (event: MessageEvent<unknown>) => {
      const rawPayload = event.data as unknown;
      const treatedAs =
        typeof rawPayload === "string" ? "string" : isPlainObject(rawPayload) ? "object" : typeof rawPayload;
      const payloadType = isPlainObject(rawPayload)
        ? (rawPayload as Record<string, unknown>)["type"]
        : null;
      const text = extractMessageText(rawPayload) ?? (rawPayload != null ? String(rawPayload) : null);
      const backendLabel = toBackendLogLabel(currentWorkerBackend ?? activeBackend);

      debugLog("Worker message received", {
        raw: rawPayload,
        treatedAs,
        payloadType,
        textPreview: text ? text.slice(0, 120) : null,
      });

      if (payloadType === "evaluation") {
        const payloadRecord = rawPayload as Record<string, unknown>;
        const payloadRequestId =
          typeof payloadRecord["requestId"] === "string" ? (payloadRecord["requestId"] as string) : null;
        if (payloadRequestId && requestIdRef.current && payloadRequestId !== requestIdRef.current) {
          debugLog("Ignoring evaluation payload for stale request", {
            payloadRequestId,
            current: requestIdRef.current,
          });
          return;
        }
        const structuredScore = normalizeEvalScore(payloadRecord["eval"]);
        const rawLines = Array.isArray(payloadRecord["lines"]) ? (payloadRecord["lines"] as unknown[]) : [];
        const structuredLines = rawLines.map(line => normalizeLinePayload(line, structuredScore ?? lastScoreRef.current ?? null));
        const sortedStructuredLines = structuredLines.sort((a, b) => a.multipv - b.multipv);

        if (requestIdRef.current) {
          debugLog("Storing structured evaluation", {
            eval: structuredScore,
            depth: sortedStructuredLines?.[0]?.depth,
            treatedAs,
            requestId: requestIdRef.current,
          });
          setEngineEval(structuredScore);
          setBestLines(sortedStructuredLines);
          setIsEvaluating(false);
        }

        lastScoreRef.current = structuredScore;
        return;
      }

      if (payloadType === "info" || payloadType === "engine-info") {
        const payloadRecord = rawPayload as Record<string, unknown>;
        const score = normalizeEvalScore(payloadRecord["eval"]);
        const depthRaw = payloadRecord["depth"];
        const multipvRaw = payloadRecord["multipv"] ?? payloadRecord["multiPvIndex"];
        const pvRaw = payloadRecord["pv"] ?? payloadRecord["line"];
        const backendLabelRaw =
          typeof payloadRecord["backend"] === "string" ? (payloadRecord["backend"] as string) : null;
        const backendLabel =
          backendLabelRaw === "js-worker" || backendLabelRaw === "js"
            ? "js"
            : backendLabelRaw === "wasm" || backendLabelRaw === "wasm-nnue"
              ? backendLabelRaw
              : typeof backendLabelRaw === "string" && backendLabelRaw.startsWith("cloud")
                ? "cloud"
                : null;
        const depth =
          typeof depthRaw === "number" && Number.isFinite(depthRaw) ? depthRaw : parseInt(String(depthRaw ?? ""), 10);
        const multipvParsed =
          typeof multipvRaw === "number" && Number.isFinite(multipvRaw)
            ? multipvRaw
            : parseInt(String(multipvRaw ?? ""), 10);
        const multipv = Number.isFinite(multipvParsed) && multipvParsed > 0 ? multipvParsed : 1;
        const pv = typeof pvRaw === "string" ? pvRaw : text ?? "";
        const rawText = typeof payloadRecord["raw"] === "string" ? (payloadRecord["raw"] as string) : text ?? null;

        processInfoPayload({
          score,
          depth: Number.isFinite(depth) ? depth : undefined,
          multipv,
          pv,
          rawText,
          treatedAs,
          backendLabel,
        });
        return;
      }

      if (!text) return;

      const parsedInfoText = parseInfoText(text);
      if (parsedInfoText) {
        processInfoPayload({
          score: parsedInfoText.score,
          depth: parsedInfoText.depth,
          multipv: parsedInfoText.multipv,
          pv: parsedInfoText.pv,
          rawText: text,
          treatedAs,
          backendLabel,
        });
        return;
      }

      if (text.startsWith("bestmove")) {
        if (backendLabel === "js") {
          console.log(`[ENGINE CORE] BESTMOVE (js): ${text}`);
        }
        if (!requestIdRef.current) return;

        const finalizedLines = Object.values(lineBufferRef.current).sort((a, b) => a.multipv - b.multipv);
        debugLog("Bestmove received; finalizing eval", {
          treatedAs,
          parsedEval: lastScoreRef.current,
          lines: finalizedLines,
          requestId: requestIdRef.current,
        });

        if (!Object.is(engineEval, lastScoreRef.current)) {
          console.log("[ENGINE STATE] eval updated (bestmove)", {
            raw: lastScoreRef.current,
            lines: finalizedLines,
            requestId: requestIdRef.current,
          });
        }
        setEngineEval(lastScoreRef.current);
        setBestLines(finalizedLines);
        setIsEvaluating(false);

        requestIdRef.current = null;
        lastScoreRef.current = null;
        lineBufferRef.current = {};
        return;
      }
    };

    const handleError = (event: ErrorEvent | unknown) => {
      const errorEvent = event instanceof ErrorEvent ? event : null;
      const errorObject = isPlainObject(event) ? (event as Record<string, unknown>) : null;
      console.warn("[useStockfishEvaluation] Worker error (from hook, non-fatal)", {
        rawEvent: event,
        message:
          errorEvent?.message ?? (typeof errorObject?.message === "string" ? (errorObject.message as string) : undefined),
        filename:
          errorEvent?.filename ??
          (typeof errorObject?.filename === "string" ? (errorObject.filename as string) : undefined),
        lineno:
          errorEvent?.lineno ??
          (typeof errorObject?.lineno === "number" ? (errorObject.lineno as number) : undefined),
        colno: errorEvent?.colno ?? (typeof errorObject?.colno === "number" ? (errorObject.colno as number) : undefined),
      });
      notifyEngineStatus("error");
    };

    const unsubscribeMessage = subscribeToStockfish(handleMessage);
    const unsubscribeError = subscribeToStockfishErrors(handleError);

    return () => {
      unsubscribeMessage();
      unsubscribeError();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeEngineStatus(setEngineStatusState);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!DEBUG_ENGINE_SWITCHER) return;
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(BACKEND_PREFERENCE_KEY);
      if (!stored) return;
      const candidate = resolveBackendKey(stored);
      const normalized = normalizeBackendSelection(candidate);
      if (normalized !== activeBackend) {
        applyActiveBackend(normalized, "load-preference");
        setEngineBackend(normalized);
        setEngineName(getEngineNameFallback(normalized));
      }
    } catch (error) {
      console.warn("[ENGINE HOOK] Failed to load backend preference", error);
    }
  }, []);

  useEffect(() => {
    engineThreads = threads;
    engineHashMb = hashMb;
    engineSkillLevel = typeof skillLevel === "number" ? skillLevel : undefined;
    const worker = getStockfishWorker();
    if (!worker || !stockfishReady) return;
    hasConfiguredOptions = false;
    configureStockfishOptions(worker);
  }, [threads, hashMb, skillLevel]);

  useEffect(() => {
    if (!DEV_ALLOW_DUMMY_EVAL) return;
    if (engineStatusState !== "ready") return;
    const clearDebugTimer = () => {
      if (debugInjectionTimeoutRef.current) {
        clearTimeout(debugInjectionTimeoutRef.current);
        debugInjectionTimeoutRef.current = null;
      }
    };

    if (!enabled) {
      clearDebugTimer();
      hasInjectedDebugEvalRef.current = false;
      debugInjectionFenRef.current = null;
      return;
    }

    if (!fen) {
      clearDebugTimer();
      return;
    }

    const fenKey = fen ?? "no-fen";
    if (debugInjectionFenRef.current !== fenKey) {
      hasInjectedDebugEvalRef.current = false;
      debugInjectionFenRef.current = fenKey;
    }

    const hasLiveEval =
      (engineEval && (typeof engineEval.cp === "number" || typeof engineEval.mate === "number")) ||
      bestLines.length > 0;

    if (hasLiveEval) {
      hasInjectedDebugEvalRef.current = true;
      clearDebugTimer();
      return;
    }

    if (hasInjectedDebugEvalRef.current) {
      clearDebugTimer();
      return;
    }

    clearDebugTimer();
    debugInjectionTimeoutRef.current = setTimeout(() => {
      if (!enabled || hasInjectedDebugEvalRef.current) return;
      const dummyEval: StockfishEval = { cp: 123 };
      const dummyLines: StockfishLine[] = [
        { multipv: 1, cp: dummyEval.cp, depth: 12, pv: "[debug] injected dummy line" },
      ];
      debugLog("Injecting TEMP debug eval (no engine signal yet)", { fen, dummyEval, dummyLines });
      setEngineEval(prev => prev ?? dummyEval);
      setBestLines(prev => (prev.length ? prev : dummyLines));
      setIsEvaluating(false);
      hasInjectedDebugEvalRef.current = true;
    }, 1200);

    return clearDebugTimer;
  }, [enabled, fen, engineEval, bestLines, engineStatusState, engineBackend]);

  useEffect(() => {
    const backendLabel = currentWorkerBackend ?? activeBackend;
    const isCloudBackend = backendLabel === "cloud";
    const worker = isCloudBackend ? null : getStockfishWorker();

    const backendLogLabel = toBackendLogLabel(backendLabel);
    const isJsBackend = backendLabel === "js-worker";

    if (!enabled) {
      requestIdRef.current = null;
      lastScoreRef.current = null;
      setEngineEval(null);
      setBestLines([]);
      setIsEvaluating(false);
      setLastFen(null);
      return;
    }

    if (!fen) {
      requestIdRef.current = null;
      lastScoreRef.current = null;
      setEngineEval(null);
      setBestLines([]);
      setIsEvaluating(false);
      setLastFen(null);
      lineBufferRef.current = {};
      return;
    }

    const isNewPosition = lastFen !== fen;
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    requestIdRef.current = requestId;
    lastScoreRef.current = null;
    setIsEvaluating(true);
    setLastFen(fen);
    lineBufferRef.current = {};

    if (isNewPosition) {
      setEngineEval(null);
      setBestLines([]);
    }

    const sideToMove = fen.split(/\s+/)[1] === "b" ? "b" : "w";
    const safeThreads = Math.max(1, Math.round(threads));
    const safeHashMb = Math.max(1, Math.round(hashMb));
    const safeTargetDepth = effectiveTargetDepth;
    debugLog("Starting analysis", {
      fen,
      multiPv,
      targetDepth: safeTargetDepth,
      requestId,
      profile: activeProfileId,
      sideToMove,
      searchMode: "depth",
      backend: backendLogLabel,
    });

    if (isCloudBackend) {
      notifyEngineStatus("ready");
      const effectiveEngineName = CLOUD_ENGINE_NAME ?? getEngineNameFallback("cloud");
      engineNameCacheRef.current.cloud = effectiveEngineName;
      setEngineName(effectiveEngineName);
      const cloudRequest: CloudEngineRequest = {
        fen,
        movetimeMs: activeProfileConfig.movetimeMs ?? ENGINE_CONFIG.defaults?.movetimeMs,
        multiPv,
        requestId,
        searchMode: "depth",
        targetDepth: safeTargetDepth,
        threads: safeThreads,
        hashMb: safeHashMb,
        skillLevel,
        profileId: activeProfileId,
      };

      console.log("[ENGINE CORE] (cloud http) Dispatching request", {
        requestId,
        fenPreview: fen.slice(0, 60),
        searchMode: cloudRequest.searchMode,
        targetDepth: cloudRequest.targetDepth,
        multiPv,
        threads: cloudRequest.threads,
        hashMb: cloudRequest.hashMb,
        skillLevel: cloudRequest.skillLevel,
        profileId: cloudRequest.profileId,
      });

      const runCloudRequest = async () => {
        try {
          const response = await fetch("/api/engine/eval", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cloudRequest),
          });
          if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(
              `Cloud eval HTTP ${response.status}: ${errorPayload?.error ?? "Unknown error from cloud backend"}`
            );
          }
          const payload = (await response.json()) as CloudEngineResponse;
          if (!payload || !Array.isArray(payload.lines)) {
            throw new Error("Invalid cloud eval response");
          }

          if (requestIdRef.current !== requestId) {
            console.log("[ENGINE CORE] (cloud http) Dropping stale response", {
              requestId,
              current: requestIdRef.current,
            });
            return;
          }

          const structuredLines = payload.lines.map(mapCloudLineToStockfishLine).sort((a, b) => a.multipv - b.multipv);
          const evalScore = deriveEvalFromCloudLines(payload.lines);
          console.log("[ENGINE CORE] (cloud http) Received response", {
            backend: payload.backend,
            requestId,
            eval: evalScore,
            depth: structuredLines?.[0]?.depth,
            lines: structuredLines,
          });
          setEngineEval(evalScore);
          setBestLines(structuredLines);
          setIsEvaluating(false);
          requestIdRef.current = null;
          lineBufferRef.current = {};
        } catch (error) {
          console.error("[ENGINE CORE] (cloud http) Request failed", { requestId, error });
          if (requestIdRef.current === requestId) {
            setIsEvaluating(false);
          }
        }
      };

      runCloudRequest();
      return;
    }

    let workerInstance = worker ?? getStockfishWorker();
    if (!workerInstance) {
      console.error("[ENGINE HOOK] Unable to start analysis: worker not available", {
        backend: backendLabel,
        fenPreview: fen.slice(0, 60),
      });
    }

    const sendWithContext = (command: string, label?: string) => {
      debugLog("Sending command", {
        command,
        label,
        fen,
        multiPv,
        targetDepth: safeTargetDepth,
        profile: activeProfileId,
        sideToMove,
        engineStatus: engineStatusState,
        searchMode: "depth",
      });
      if (label === "position" || label === "go") {
        console.log(`[ENGINE HOOK] Sending command (${backendLogLabel}): ${command}`);
      }
      workerInstance = workerInstance ?? getStockfishWorker();
      if (!workerInstance) {
        console.error("[ENGINE HOOK] Skipping command; worker unavailable", { command, label, backend: backendLogLabel });
        return;
      }
      dispatchCommandToWorker(workerInstance, command, { source: label ?? "analysis" });
    };

    sendWithContext("stop");
    sendWithContext("ucinewgame");
    sendWithContext(`setoption name Threads value ${safeThreads}`, "threads");
    sendWithContext(`setoption name Hash value ${safeHashMb}`, "hash");
    if (Number.isFinite(skillLevel ?? NaN)) {
      sendWithContext(`setoption name Skill Level value ${skillLevel}`, "skill-level");
    }
    sendWithContext(`setoption name MultiPV value ${multiPv}`, "multipv");
    sendWithContext("position fen " + fen, "position");
    const goCommand = Number.isFinite(safeTargetDepth)
      ? `go depth ${safeTargetDepth} multipv ${multiPv}`
      : `go movetime ${activeProfileConfig.movetimeMs ?? ENGINE_CONFIG.defaults?.movetimeMs ?? 1500} multipv ${multiPv}`;
    sendWithContext(goCommand, "go");
  }, [
    fen,
    enabled,
    effectiveTargetDepth,
    multiPv,
    threads,
    hashMb,
    skillLevel,
    activeProfileId,
    lastFen,
    engineStatusState,
    engineBackend,
  ]);

  useEffect(() => {
    const povMultiplier = (() => {
      if (!fen) return 1;
      const parts = fen.trim().split(/\s+/);
      return parts[1] === "b" ? -1 : 1;
    })();

    const toWhitePerspective = (score: StockfishEvalScore): StockfishEvalScore => {
      if (!score) return null;
      if (typeof score.mate === "number") return { mate: score.mate * povMultiplier };
      if (typeof score.cp === "number") return { cp: score.cp * povMultiplier };
      return null;
    };

    const formatEvalHeadline = (score: StockfishEvalScore): string => {
      if (!score) return "-";
      if (typeof score.mate === "number") {
        const sign = score.mate > 0 ? "+" : "-";
        return `${sign}M${Math.abs(score.mate)}`;
      }
      if (typeof score.cp === "number") {
        const pawns = score.cp / 100;
        const rounded = Math.abs(pawns) >= 1 ? pawns.toFixed(1) : pawns.toFixed(2);
        const prefix = pawns > 0 ? "+" : pawns < 0 ? "-" : "";
        return `${prefix}${Math.abs(Number(rounded))}`;
      }
      return "-";
    };

    const primaryLine = bestLines?.[0];
    const primaryScore = primaryLine
      ? {
          cp: typeof primaryLine.cp === "number" ? primaryLine.cp : undefined,
          mate: typeof primaryLine.mate === "number" ? primaryLine.mate : undefined,
        }
      : null;
    const adjustedPrimary = toWhitePerspective(primaryScore);
    const adjustedEval = toWhitePerspective(engineEval);
    const headlineSource =
      adjustedPrimary && (typeof adjustedPrimary.cp === "number" || typeof adjustedPrimary.mate === "number")
        ? adjustedPrimary
        : adjustedEval;
    const headlineEval = formatEvalHeadline(headlineSource);

    if (headlineEval !== headlineLogRef.current) {
      headlineLogRef.current = headlineEval;
      const backendLabel = currentWorkerBackend ?? activeBackend;
      const uiLabel =
        backendLabel === "js-worker" ? "[UI] Engine panel eval display (js)" : "[UI] Engine panel eval display";
      console.log(uiLabel, {
        headlineEval,
        rawEval: engineEval,
        primaryLine,
        fen,
      });
    }
  }, [bestLines, engineEval, fen]);

  const setEngineBackendOverride = (nextBackend: EngineBackend) => {
    const normalized = normalizeBackendSelection(nextBackend);
    if (DEBUG_ENGINE_SWITCHER && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(BACKEND_PREFERENCE_KEY, normalized);
      } catch (error) {
        console.warn("[ENGINE HOOK] Failed to persist backend preference", error);
      }
    }
    applyActiveBackend(normalized, "user-selection");
    setEngineBackend(normalized);
    setEngineName(getEngineNameFallback(normalized));
    if (normalized !== nextBackend) {
      console.warn("[ENGINE STATE] Requested backend not available; using fallback", {
        requested: nextBackend,
        applied: normalized,
      });
    }
  };

  return {
    eval: engineEval,
    bestLines,
    isEvaluating,
    lastFen,
    targetDepth: effectiveTargetDepth,
    depthIndex,
    depthSteps,
    setDepthIndex,
    multiPv,
    setMultiPv,
    activeProfileId,
    activeProfileConfig,
    setActiveProfileId: applyProfileSelection,
    engineStatus: engineStatusState,
    engineName,
    engineBackend,
    setEngineBackend: DEBUG_ENGINE_SWITCHER ? setEngineBackendOverride : undefined,
  };
}

export default useStockfishEvaluation;

export type EngineBackend = "js-worker" | "wasm" | "wasm-nnue" | "cloud";

export type EngineProfileId = "light" | "standard" | "pro";
export type AnalysisQuality = "light" | "standard" | "pro";

export const ANALYSIS_QUALITY_PRESETS: AnalysisQuality[] = ["light", "standard", "pro"];

export const ANALYSIS_QUALITY_PASSES_MS: Record<AnalysisQuality, number[]> = {
  light: [150, 300, 600],
  standard: [150, 300, 600, 1200],
  pro: [150, 300, 600, 1200, 2000, 4000],
};
export type EngineProfileConfig = {
  id: EngineProfileId;
  label: string;
  description?: string;
  movetimeMs?: number;
  multiPv: number;
  threads: number;
  hashMb: number;
  depthSteps: number[];
  defaultDepthIndex: number;
  skillLevel?: number;
};

export type EngineSearchMode = "time" | "depth";

export interface EngineConfigDefaults {
  threads?: number;
  hashMb?: number;
  multiPv?: number;
  movetimeMs?: number;
  searchMode?: EngineSearchMode;
  depthSteps?: number[];
  defaultDepthIndex?: number;
}

export type JsWorkerBackendConfig = {
  backend: "js-worker";
  workerScriptPath: string;
  label?: string;
};

export type WasmBackendConfig = {
  backend: "wasm";
  workerScriptPath: string;
  enabled?: boolean;
  label?: string;
};

export type WasmNnueBackendConfig = {
  backend: "wasm-nnue";
  workerModulePath?: string;
  workerScriptPath?: string;
  enabled?: boolean;
  hint?: string;
  label?: string;
};

export type CloudBackendConfig = {
  backend: "cloud";
  enabled?: boolean;
  backendId?: "cloud" | "cloud-nnue" | (string & {});
  engineName?: string;
  label?: string;
};

export type EngineBackendConfig =
  | JsWorkerBackendConfig
  | WasmBackendConfig
  | WasmNnueBackendConfig
  | CloudBackendConfig;

export type CloudEngineRequest = {
  fen: string;
  movetimeMs?: number;
  multiPv: number;
  requestId: string;
  searchMode?: EngineSearchMode;
  targetDepth?: number;
  refine?: boolean;
  refineTargetDepth?: number;
  threads?: number;
  hashMb?: number;
  skillLevel?: number;
  profileId?: EngineProfileId;
};

export type CloudEngineLine = {
  multipv: number;
  scoreCp?: number;
  scoreMate?: number;
  depth: number;
  selDepth?: number;
  pvMoves: string[];
  nodes?: number;
  nps?: number;
};

export type CloudEngineResponse = {
  id?: string;
  requestId?: string;
  backend: CloudBackendConfig["backend"] | "cloud-nnue" | (string & {});
  lines: CloudEngineLine[];
  nodes?: number;
  nps?: number;
  engineName?: string;
  error?: string;
};

export interface EngineConfig {
  activeBackend: EngineBackend;
  workerScriptPath?: string;
  wasmWorkerScriptPath?: string;
  enableWasm?: boolean;
  wasmNnueWorkerHint?: string;
  enableWasmNnue?: boolean;
  enableCloud?: boolean;
  backends?: Partial<Record<EngineBackend, EngineBackendConfig>>;
  defaults?: EngineConfigDefaults;
}

export const ENGINE_PROFILES: Record<EngineProfileId, EngineProfileConfig> = {
  light: {
    id: "light",
    label: "Light",
    description: "Fastest response, shallow search",
    movetimeMs: 1200,
    multiPv: 1,
    threads: 2,
    hashMb: 128,
    depthSteps: [16, 20, 24],
    defaultDepthIndex: 1,
  },
  standard: {
    id: "standard",
    label: "Standard",
    description: "Balanced depth and speed",
    movetimeMs: 4000,
    multiPv: 1,
    threads: 6,
    hashMb: 256,
    depthSteps: [24, 30, 36],
    defaultDepthIndex: 1,
  },
  pro: {
    id: "pro",
    label: "Pro",
    description: "Slower, deeper search",
    movetimeMs: 8000,
    multiPv: 1,
    threads: 8,
    hashMb: 512,
    depthSteps: [30, 38, 46],
    defaultDepthIndex: 1,
  },
};

export const ENGINE_PROFILE_IDS: EngineProfileId[] = ["light", "standard", "pro"];
export const DEFAULT_ENGINE_PROFILE_ID: EngineProfileId = "standard";

export const isEngineProfileId = (value: unknown): value is EngineProfileId =>
  value === "light" || value === "standard" || value === "pro";

export function getEngineProfileConfig(profile?: EngineProfileId | string | null): EngineProfileConfig {
  if (profile && isEngineProfileId(profile)) {
    return ENGINE_PROFILES[profile];
  }
  return ENGINE_PROFILES[DEFAULT_ENGINE_PROFILE_ID];
}

// Backwards-compatible aliases while refactoring callers.
export type EngineStrengthProfile = EngineProfileId;
export type EngineStrengthProfileConfig = EngineProfileConfig;
export const ENGINE_STRENGTH_PROFILES = ENGINE_PROFILES;
export const DEFAULT_STRENGTH_PROFILE = DEFAULT_ENGINE_PROFILE_ID;
export const getStrengthProfileConfig = getEngineProfileConfig;

export const ENABLE_WASM_EXPERIMENT =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_WASM_STOCKFISH === "true";
export const ENABLE_WASM_NNUE_EXPERIMENT =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_WASM_NNUE_STOCKFISH === "true";
export const ENABLE_CLOUD_ENGINE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_CLOUD_ENGINE === "true";
export const CLOUD_ENGINE_URL =
  typeof process !== "undefined" && typeof process.env.CLOUD_ENGINE_URL === "string"
    ? process.env.CLOUD_ENGINE_URL
    : undefined;
export const DEBUG_ENGINE_SWITCHER =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEBUG_ENGINE_SWITCHER === "true";

const REQUESTED_ENGINE_BACKEND =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_ENGINE_BACKEND
    ? (process.env.NEXT_PUBLIC_ENGINE_BACKEND as EngineBackend | string)
    : null;

const DEFAULT_ACTIVE_BACKEND: EngineBackend = ENABLE_WASM_NNUE_EXPERIMENT
  ? "wasm-nnue"
  : ENABLE_WASM_EXPERIMENT
    ? "wasm"
    : "js-worker";

const ACTIVE_BACKEND: EngineBackend = (() => {
  if (
    REQUESTED_ENGINE_BACKEND === "js-worker" ||
    REQUESTED_ENGINE_BACKEND === "wasm" ||
    REQUESTED_ENGINE_BACKEND === "wasm-nnue" ||
    REQUESTED_ENGINE_BACKEND === "cloud"
  ) {
    if (REQUESTED_ENGINE_BACKEND === "cloud" && !ENABLE_CLOUD_ENGINE) {
      console.warn("[engine/config] Cloud backend requested but disabled; using fallback backend");
      return DEFAULT_ACTIVE_BACKEND;
    }
    if (REQUESTED_ENGINE_BACKEND === "wasm" && !ENABLE_WASM_EXPERIMENT) {
      return DEFAULT_ACTIVE_BACKEND;
    }
    if (REQUESTED_ENGINE_BACKEND === "wasm-nnue" && !ENABLE_WASM_NNUE_EXPERIMENT) {
      return DEFAULT_ACTIVE_BACKEND;
    }
    return REQUESTED_ENGINE_BACKEND as EngineBackend;
  }
  if (ENABLE_CLOUD_ENGINE) return "cloud";
  return DEFAULT_ACTIVE_BACKEND;
})();

export const CURRENT_ENGINE_CONFIG: EngineConfig = {
  activeBackend: "cloud",
  enableCloud: ENABLE_CLOUD_ENGINE,
  backends: {
    cloud: {
      backend: "cloud",
      enabled: ENABLE_CLOUD_ENGINE,
      backendId: "cloud-nnue",
      engineName: "Stockfish (cloud)",
      label: "cloud",
    },
  },
  defaults: {
    threads: 2,
    hashMb: 256,
    multiPv: 1,
    movetimeMs: 1800,
    searchMode: "depth",
    depthSteps: ENGINE_PROFILES[DEFAULT_ENGINE_PROFILE_ID].depthSteps,
    defaultDepthIndex: ENGINE_PROFILES[DEFAULT_ENGINE_PROFILE_ID].defaultDepthIndex,
  },
};

export function formatEngineBackendLabel(
  backend: EngineBackend,
  options?: { engineName?: string | null }
): { short: string; full: string } {
  void backend;
  const name = (options?.engineName ?? "Stockfish 17.1").trim() || "Stockfish 17.1";
  const shorten = (value: string) => (value.length > 40 ? `${value.slice(0, 37)}...` : value);
  const full = "Stockfish 17.1";
  return { full, short: shorten(name || full) };
}

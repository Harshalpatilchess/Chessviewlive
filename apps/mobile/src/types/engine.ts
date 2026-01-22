// Mirrored from apps/web/lib/engine/config.ts

export type EngineBackend = "cloud";
export type EngineProfileId = "light" | "standard" | "pro";
export type EngineSearchMode = "time" | "depth";

export type CloudEngineLine = {
    multipv: number;
    scoreCp?: number;
    scoreMate?: number;
    depth: number;
    pvMoves: string[];
};

export type CloudEngineResponse = {
    id?: string;
    requestId?: string;
    backend: string;
    lines: CloudEngineLine[];
    engineName?: string;
    error?: string;
};

export type CloudEngineRequest = {
    fen: string;
    movetimeMs?: number;
    multiPv: number;
    requestId: string;
    searchMode?: EngineSearchMode;
    targetDepth?: number;
    profileId?: EngineProfileId;
};

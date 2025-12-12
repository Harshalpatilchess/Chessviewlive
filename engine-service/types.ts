export type CloudEngineRequest = {
  fen: string;
  movetimeMs?: number;
  multiPv: number;
  requestId: string;
  searchMode?: "time" | "depth";
  targetDepth?: number;
  threads?: number;
  hashMb?: number;
  skillLevel?: number;
  profileId?: "light" | "standard" | "pro" | (string & {});
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
  backend: "cloud" | "cloud-nnue" | (string & {});
  lines: CloudEngineLine[];
  nodes?: number;
  nps?: number;
  engineName?: string;
  error?: string;
};

export type ErrorResponse = { error: string } & Record<string, unknown>;

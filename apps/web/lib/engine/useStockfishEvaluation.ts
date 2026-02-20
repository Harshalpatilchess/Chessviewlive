"use client";

import useCloudEngineEvaluation from "./useCloudEngineEvaluation";
import type { EngineProfileId } from "./config";

export type StockfishEval = { cp?: number; mate?: number } | null;
export type StockfishLine = {
  multipv: number;
  cp?: number;
  mate?: number;
  pv?: string;
  depth?: number;
};

export type UseStockfishEvaluationOptions = {
  enabled?: boolean;
  profileId?: EngineProfileId;
  threads?: number;
  hashMb?: number;
  multiPv?: number;
  depthIndex?: number;
  targetDepth?: number;
};

export function useStockfishEvaluation(
  fen: string | null,
  options: UseStockfishEvaluationOptions = {}
) {
  const { threads: _threads, hashMb: _hashMb, ...cloudOptions } = options;
  const result = useCloudEngineEvaluation(fen, cloudOptions);

  return {
    ...result,
    engineStatus: "ready" as const,
  };
}

export default useStockfishEvaluation;

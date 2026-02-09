"use client";

const MINI_BOARD_EVAL_FEATURE_ENABLED =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_MINIBOARD_EVAL === "true";

let miniBoardEvalSessionBlocked = false;
let miniBoardEvalFailureLogged = false;

type MiniBoardEvalFailureOptions = {
  source?: "card" | "navigation" | string;
  status?: number | null;
  error?: unknown;
};

export const isMiniBoardEvalFeatureEnabled = () => MINI_BOARD_EVAL_FEATURE_ENABLED;

export const isMiniBoardEvalSessionBlocked = () => miniBoardEvalSessionBlocked;

export const canRunMiniBoardEvalRequests = () =>
  MINI_BOARD_EVAL_FEATURE_ENABLED && !miniBoardEvalSessionBlocked;

export const recordMiniBoardEvalFailure = (options?: MiniBoardEvalFailureOptions) => {
  miniBoardEvalSessionBlocked = true;
  if (miniBoardEvalFailureLogged) return;
  miniBoardEvalFailureLogged = true;
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
  const status = Number.isFinite(Number(options?.status ?? NaN)) ? Number(options?.status) : null;
  console.warn("[mini-board-eval] session disabled after eval failure", {
    source: options?.source ?? "unknown",
    status,
    error: options?.error instanceof Error ? options.error.message : null,
  });
};

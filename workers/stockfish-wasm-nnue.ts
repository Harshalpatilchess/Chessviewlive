/// <reference lib="webworker" />

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const BACKEND_LABEL = "wasm-nnue";

ctx.onmessage = event => {
  const payload = event?.data;
  console.log("[ENGINE CORE] (wasm-nnue stub) Received message", payload);
  try {
    ctx.postMessage({
      type: "engine-error",
      backend: BACKEND_LABEL,
      error: "wasm-nnue stub, not implemented",
    });
  } catch {
    // ignore postMessage errors in stub
  }
};

export {};

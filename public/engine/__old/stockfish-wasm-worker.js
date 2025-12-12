// public/engine/stockfish-wasm-worker.js
// WASM Stockfish worker that forwards raw UCI text to/from the engine.
// Expects NNUE assets at /engine/stockfish-wasm.js (+ .wasm).

/* eslint-disable no-restricted-globals */

const ctx = self;
let engine = null;
let engineReady = false;
let sawUciOk = false;
let sawReadyOk = false;
const pendingCommands = [];
const subscribers = [];
const emit = message => {
  try {
    ctx.postMessage(message);
  } catch (error) {
    // swallow to avoid worker crash
    console.error("[Engine] Failed to post message", error);
  }
};

function logError(prefix, error) {
  console.error(prefix, error);
}

function emitStatus(status) {
  console.log("[WASM ENGINE] posting engine-status", status);
  emit({ type: "engine-status", status, backend: "wasm" });
}

function flushPending() {
  if (!engine) return;
  const queued = pendingCommands.splice(0);
  queued.forEach(cmd => {
    try {
      console.log("[WASM ENGINE] flushing queued command:", cmd);
      engine.postMessage(cmd);
    } catch (error) {
      logError("[Engine] Failed to flush queued command to WASM engine", error);
    }
  });
}

function reportFatalInit(message, error) {
  logError(message, error);
  emit({
    type: "engine-error",
    backend: "wasm",
    error: message,
    details: error && typeof error === "object" ? error.message || String(error) : String(error ?? ""),
  });
  emit(message);
  throw error instanceof Error ? error : new Error(message);
}

function attachEngine(engineInstance) {
  engine = engineInstance;

  if (typeof engine.onmessage === "function") {
    // Some builds expose onmessage
    engine.onmessage = event => {
      const text = String(event?.data ?? "");
      if (text.startsWith("info")) console.log("[WASM ENGINE] received info:", text);
      if (text.startsWith("bestmove")) console.log("[WASM ENGINE] received bestmove:", text);
      if (text.includes("uciok")) console.log("[WASM ENGINE] received uciok");
      if (text.includes("readyok")) console.log("[WASM ENGINE] received readyok");
      emit(text);
      handleEngineLine(text);
    };
  } else if (typeof engine.addEventListener === "function") {
    engine.addEventListener("message", event => {
      const text = String(event?.data ?? "");
      if (text.startsWith("info")) console.log("[WASM ENGINE] received info:", text);
      if (text.startsWith("bestmove")) console.log("[WASM ENGINE] received bestmove:", text);
      if (text.includes("uciok")) console.log("[WASM ENGINE] received uciok");
      if (text.includes("readyok")) console.log("[WASM ENGINE] received readyok");
      emit(text);
      handleEngineLine(text);
    });
  }

  engineReady = true;
  emitStatus("initializing");
  try {
    console.log("[WASM ENGINE] sending: uci");
    engine.postMessage("uci");
  } catch (error) {
    logError("[Engine] Failed to send initial UCI command", error);
  }
  flushPending();
}

function handleEngineLine(text) {
  if (typeof text !== "string" || !text) return;
  if (!sawUciOk && text.includes("uciok")) {
    sawUciOk = true;
    emitStatus("uciok");
    try {
      console.log("[WASM ENGINE] sending: isready");
      engine.postMessage("isready");
    } catch (error) {
      logError("[Engine] Failed to send isready after uciok", error);
    }
  }
  if (!sawReadyOk && text.includes("readyok")) {
    sawReadyOk = true;
    emitStatus("ready");
    flushPending();
  }
}

function initEngine() {
  try {
    ctx.importScripts("/engine/stockfish-wasm.js");
  } catch (error) {
    reportFatalInit(
      "[Engine] Failed to load WASM backend; ensure Stockfish NNUE assets are present and SharedArrayBuffer is available (COOP/COEP).",
      error
    );
  }

  const factory = ctx.STOCKFISH || ctx.Stockfish;
  if (!factory) {
    reportFatalInit("[Engine] No Stockfish factory found in WASM worker", new Error("Missing Stockfish factory"));
  }

  try {
    const instance = typeof factory === "function" ? factory() : null;
    if (!instance || typeof instance.postMessage !== "function") {
      reportFatalInit("[Engine] Invalid Stockfish WASM instance", new Error("Invalid WASM instance"));
    }
    attachEngine(instance);
  } catch (error) {
    reportFatalInit(
      "[Engine] Failed to initialize Stockfish WASM instance; check COOP/COEP headers for SharedArrayBuffer access.",
      error
    );
  }
}

initEngine();

ctx.onmessage = event => {
  const command = event?.data;
  if (typeof command !== "string") return;
  try {
    if (command === "uci") console.log("[WASM ENGINE] sending: uci");
    if (command === "isready") console.log("[WASM ENGINE] sending: isready");
    if (command.startsWith("position")) console.log("[WASM ENGINE] sending position", command);
    if (command.startsWith("go")) console.log("[WASM ENGINE] sending go", command);
  } catch (error) {
    // ignore logging errors in worker
  }
  if (!engine || !engineReady) {
    pendingCommands.push(command);
    return;
  }

  try {
    engine.postMessage(command);
  } catch (error) {
    logError("[Engine] Failed to forward command to WASM engine", error);
  }
};

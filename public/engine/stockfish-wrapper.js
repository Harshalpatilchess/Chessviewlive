// Wrapper around asm.js Stockfish build to expose a simple postMessage bridge.
// Runs inside a dedicated Worker context.

/* eslint-disable no-restricted-globals */

const ctx = self;
const postToClient = ctx.postMessage.bind(ctx);
const ENGINE_SCRIPT = "/engine/stockfish-asm.js";
let engine = null;
let engineOnMessage = null;
let sawUciOk = false;
let sawReadyOk = false;
let engineReady = false;

function log(...args) {
  try {
    console.log("[ENGINE CORE]", ...args);
  } catch {
    // ignore logging failures in worker
  }
}

function emitStatus(status) {
  log("posting engine-status", status);
  try {
    postToClient({ type: "engine-status", status, backend: "js-worker" });
  } catch {
    // ignore postMessage errors
  }
}

function emitError(message, error) {
  log("[ENGINE CORE ERROR]", message, error);
  try {
    postToClient({
      type: "engine-error",
      backend: "js-worker",
      error: message,
      details: error && typeof error === "object" ? error.message || String(error) : String(error ?? ""),
    });
  } catch {
    // ignore postMessage errors
  }
}

function parseInfoLine(line) {
  if (typeof line !== "string") return null;
  if (!line.includes("info") || !line.includes("score")) return null;

  const depthMatch = line.match(/\bdepth\s+(\d+)/i);
  const multipvMatch = line.match(/\bmultipv\s+(\d+)/i);
  const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/i);
  const pvMatch = line.match(/\bpv\s+(.+)$/i);

  if (!scoreMatch) return null;

  const scoreType = scoreMatch[1].toLowerCase();
  const rawValue = parseInt(scoreMatch[2], 10);
  if (!Number.isFinite(rawValue)) return null;

  const evalScore = scoreType === "cp" ? { cp: rawValue } : { mate: rawValue };
  const depth = depthMatch ? parseInt(depthMatch[1], 10) || undefined : undefined;
  const multipv = multipvMatch ? parseInt(multipvMatch[1], 10) || 1 : 1;
  const pv = pvMatch ? pvMatch[1] : "";

  return {
    type: "info",
    backend: "js-worker",
    depth,
    multipv,
    pv,
    eval: evalScore,
    raw: line,
  };
}

function handleEngineLine(line) {
  log("line from engine (js):", line);
  try {
    postToClient(line);
  } catch {
    // ignore postMessage errors
  }

  const lower = typeof line === "string" ? line.toLowerCase() : "";
  if (lower.includes("info ")) {
    log("INFO (js):", line);
  }
  if (lower.includes("bestmove")) {
    log("BESTMOVE (js):", line);
  }

  const parsedInfo = parseInfoLine(line);
  if (parsedInfo) {
    log("INFO PAYLOAD (js):", JSON.stringify(parsedInfo));
    try {
      postToClient(parsedInfo);
    } catch {
      // ignore postMessage errors
    }
  }

  if (!sawUciOk && line.includes("uciok")) {
    sawUciOk = true;
    log("handshake: uciok received");
    emitStatus("uciok");
  }

  if (!sawReadyOk && line.includes("readyok")) {
    sawReadyOk = true;
    engineReady = true;
    log("handshake: readyok received; engine ready");
    emitStatus("ready");
  }
}

function instantiateEngine() {
  sawUciOk = false;
  sawReadyOk = false;
  engineReady = false;

  try {
    ctx.postMessage = message => {
      handleEngineLine(String(message ?? ""));
    };
    importScripts(ENGINE_SCRIPT);
  } catch (error) {
    log("[ENGINE CORE ERROR] Failed to import stockfish-asm engine script:", error?.message ?? error);
    emitStatus("failed");
    emitError("Failed to import stockfish-asm engine script", error);
    engine = null;
    engineOnMessage = null;
    return;
  }

  engineOnMessage = typeof ctx.onmessage === "function" ? ctx.onmessage : null;
  if (!engineOnMessage) {
    emitError("Stockfish asm handler not found after import", new Error("Missing onmessage handler"));
    emitStatus("failed");
    engine = null;
    return;
  }

  engine = {
    postMessage: command => engineOnMessage.call(ctx, { data: command }),
  };

  ctx.onmessage = event => {
    try {
      log("RAW message from engine (js):", JSON.stringify(event?.data ?? event));
    } catch {
      log("RAW message from engine (js): [unserializable]", event);
    }
    const command = event?.data;
    if (typeof command !== "string") {
      log("received non-string command; ignoring:", command);
      return;
    }

    sendToEngine(command, false);
  };

  emitStatus("initializing");
  sendToEngine("uci", true);
  sendToEngine("isready", true);
}

function sendToEngine(command, isAutoHandshake) {
  const suffix = isAutoHandshake ? " (auto-handshake)" : "";
  log(`sending to engine (js): ${command}${suffix}`);

  if (!engine) {
    log("engine not ready; command not sent:", command);
    return;
  }
  try {
    engine.postMessage(command);
  } catch (error) {
    emitError("Failed to send command to engine", error);
  }
}

instantiateEngine();

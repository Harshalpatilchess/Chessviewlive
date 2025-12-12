import http, { IncomingMessage, ServerResponse } from "http";
import { spawn } from "child_process";
import { URL } from "url";
import { CloudEngineRequest, CloudEngineResponse, ErrorResponse } from "./types";

const PORT = Number(process.env.PORT ?? 4000);
const STOCKFISH_PATH = process.env.STOCKFISH_PATH;
const ENGINE_BACKEND: CloudEngineResponse["backend"] = "cloud-nnue";
const DEFAULT_THREADS = Number(process.env.STOCKFISH_THREADS ?? 1);
const DEFAULT_HASH_MB = Number(process.env.STOCKFISH_HASH_MB ?? 256);

const LOG_PREFIX = "[ENGINE CORE] (nnue service)";
const LOG_TIMEOUT_PREFIX = "[ENGINE CORE] (nnue service timeout)";

type SelfTestStatus =
  | { status: "ok"; engineName?: string | null; depth?: number | null; pv?: string | null; timestamp: number }
  | { status: "error"; message: string; timestamp: number };

const SELF_TEST_FEN = "startpos";
const SELF_TEST_DEPTH = Number.isFinite(Number(process.env.SELF_TEST_DEPTH ?? NaN))
  ? Math.max(1, Number(process.env.SELF_TEST_DEPTH))
  : 4;
const SELF_TEST_MOVETIME_MS = (() => {
  const raw = Number(process.env.SELF_TEST_MOVETIME_MS ?? NaN);
  if (Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return 2000;
})();
const SELF_TEST_TIMEOUT_MS = Number.isFinite(Number(process.env.SELF_TEST_TIMEOUT_MS ?? NaN))
  ? Math.max(1000, Number(process.env.SELF_TEST_TIMEOUT_MS))
  : 10000;
let lastSelfTestStatus: SelfTestStatus | null = null;
type SelfTestResult = { status: "ok"; engineName?: string | null; depth?: number | null; pv?: string | null };

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const clampNumber = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const normalizeSearchMode = (payload: CloudEngineRequest): CloudEngineRequest["searchMode"] =>
  payload.searchMode === "depth" || (!payload.searchMode && Number.isFinite(Number(payload.targetDepth ?? NaN)))
    ? "depth"
    : "time";

function sendJson(res: ServerResponse, status: number, payload: CloudEngineResponse | ErrorResponse | Record<string, unknown>) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as T;
}

function validateRequest(payload: CloudEngineRequest): ErrorResponse | null {
  const fen = payload?.fen;
  const movetimeMs = Number(payload?.movetimeMs ?? NaN);
  const multiPv = Number(payload?.multiPv ?? NaN);
  const requestId = payload?.requestId;
  const searchMode = normalizeSearchMode(payload);
  const targetDepth = Number(payload?.targetDepth ?? NaN);

  if (!isNonEmptyString(fen)) return { error: "Invalid fen" };
  if (!Number.isFinite(multiPv) || multiPv < 1) return { error: "Invalid multiPv" };
  if (!isNonEmptyString(requestId)) return { error: "Invalid requestId" };
  if (searchMode === "depth") {
    if (!Number.isFinite(targetDepth) || targetDepth <= 0) return { error: "Invalid targetDepth" };
  } else if (!Number.isFinite(movetimeMs) || movetimeMs <= 0) {
    return { error: "Invalid movetimeMs" };
  }
  return null;
}

function parseInfoLine(line: string) {
  const normalized = line.trim();
  if (!normalized.startsWith("info")) return null;
  const depthMatch = normalized.match(/\bdepth\s+(\d+)/i);
  const selDepthMatch = normalized.match(/\bseldepth\s+(\d+)/i);
  const multipvMatch = normalized.match(/\bmultipv\s+(\d+)/i);
  const scoreMatch = normalized.match(/\bscore\s+(cp|mate)\s+(-?\d+)/i);
  const pvMatch = normalized.match(/\bpv\s+(.+)$/i);

  const depth = depthMatch ? parseInt(depthMatch[1], 10) : undefined;
  const selDepth = selDepthMatch ? parseInt(selDepthMatch[1], 10) : undefined;
  const multipv = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
  let scoreCp: number | undefined;
  let scoreMate: number | undefined;
  if (scoreMatch) {
    if (scoreMatch[1].toLowerCase() === "cp") {
      scoreCp = parseInt(scoreMatch[2], 10);
    } else {
      scoreMate = parseInt(scoreMatch[2], 10);
    }
  }
  const pvMoves = pvMatch ? pvMatch[1].trim().split(/\s+/).filter(Boolean) : [];

  return { depth, selDepth, multipv, scoreCp, scoreMate, pvMoves };
}

async function runEngineEval(payload: CloudEngineRequest): Promise<CloudEngineResponse> {
  if (!STOCKFISH_PATH) {
    const message = "STOCKFISH_PATH is not set";
    console.error(`${LOG_PREFIX} ${message}`, { requestId: payload.requestId });
    throw new Error(message);
  }

  const searchMode = normalizeSearchMode(payload);
  const movetimeMsRaw = Number.isFinite(Number(payload.movetimeMs ?? NaN))
    ? Math.max(1, Math.floor(Number(payload.movetimeMs)))
    : 0;
  const fallbackMovetimeMs = movetimeMsRaw > 0 ? movetimeMsRaw : 1500;
  const targetDepth =
    searchMode === "depth" && Number.isFinite(Number(payload.targetDepth ?? NaN))
      ? Math.max(1, Math.floor(Number(payload.targetDepth)))
      : undefined;
  const threads = Number.isFinite(Number(payload.threads ?? NaN))
    ? Math.max(1, Math.floor(Number(payload.threads)))
    : Math.max(1, DEFAULT_THREADS);
  const hashMb = Number.isFinite(Number(payload.hashMb ?? NaN))
    ? Math.max(1, Math.floor(Number(payload.hashMb)))
    : Math.max(1, DEFAULT_HASH_MB);
  const skillLevel = Number.isFinite(Number(payload.skillLevel ?? NaN))
    ? clampNumber(Math.floor(Number(payload.skillLevel)), 0, 20)
    : undefined;

  const engine = spawn(STOCKFISH_PATH, [], { stdio: ["pipe", "pipe", "pipe"] });

  const linesByPv = new Map<number, {
    multipv: number;
    depth?: number;
    selDepth?: number;
    scoreCp?: number;
    scoreMate?: number;
    pvMoves: string[];
  }>();

  const write = (text: string) => {
    engine.stdin.write(text + "\n");
  };

  const readyPromise = new Promise<void>((resolve, reject) => {
    const onStdout = (data: Buffer) => {
      const text = data.toString("utf8");
      text.split(/\r?\n/).forEach(line => {
        if (!line.trim()) return;
        if (line.includes("readyok")) {
          engine.stdout.off("data", onStdout);
          resolve();
        }
      });
    };
    engine.stdout.on("data", onStdout);
    engine.on("error", reject);
    write("uci");
    write("isready");
  });

  await readyPromise;

  write("ucinewgame");
  if (Number.isFinite(threads) && threads > 0) {
    write(`setoption name Threads value ${threads}`);
  }
  if (Number.isFinite(hashMb) && hashMb > 0) {
    write(`setoption name Hash value ${hashMb}`);
  }
  if (Number.isFinite(skillLevel ?? NaN)) {
    write(`setoption name Skill Level value ${skillLevel}`);
  }
  write(`position fen ${payload.fen}`);
  const safeMultiPv = clampNumber(Math.floor(payload.multiPv), 1, 8);
  write(`setoption name MultiPV value ${safeMultiPv}`);
  const goCommand =
    searchMode === "depth" && targetDepth
      ? `go depth ${targetDepth} multipv ${safeMultiPv}`
      : `go movetime ${fallbackMovetimeMs} multipv ${safeMultiPv}`;
  write(goCommand);

  let bestmoveSeen = false;

  const gatherPromise = new Promise<CloudEngineResponse>((resolve, reject) => {
    const timeoutMs =
      searchMode === "depth"
        ? Math.max(3000, (targetDepth ?? 12) * 500)
        : Math.max(1, fallbackMovetimeMs) + 2000;
    const timeout = setTimeout(() => {
      if (!bestmoveSeen) {
        console.error(`${LOG_TIMEOUT_PREFIX} timed out`, {
          requestId: payload.requestId,
          fenPreview: payload.fen.slice(0, 60),
          movetimeMs: payload.movetimeMs,
          targetDepth,
          searchMode,
        });
      }
      engine.kill();
      const response = buildResponse(payload.requestId, linesByPv);
      if (response.lines.length) {
        resolve(response);
      } else {
        reject(new Error("Engine timed out without lines"));
      }
    }, timeoutMs);

    const onStdout = (data: Buffer) => {
      const text = data.toString("utf8");
      text.split(/\r?\n/).forEach(line => {
        if (!line.trim()) return;
        if (line.startsWith("info")) {
          const parsed = parseInfoLine(line);
          if (parsed) {
            const existing = linesByPv.get(parsed.multipv) ?? { multipv: parsed.multipv, pvMoves: [] };
            linesByPv.set(parsed.multipv, {
              multipv: parsed.multipv,
              depth: parsed.depth ?? existing.depth,
              selDepth: parsed.selDepth ?? existing.selDepth,
              scoreCp: parsed.scoreCp ?? existing.scoreCp,
              scoreMate: parsed.scoreMate ?? existing.scoreMate,
              pvMoves: parsed.pvMoves.length ? parsed.pvMoves : existing.pvMoves,
            });
          }
        } else if (line.startsWith("bestmove")) {
          bestmoveSeen = true;
          clearTimeout(timeout);
          engine.kill();
          resolve(buildResponse(payload.requestId, linesByPv));
        }
      });
    };

    const onStderr = (data: Buffer) => {
      console.warn(`${LOG_PREFIX} stderr`, { requestId: payload.requestId, message: data.toString("utf8") });
    };

    engine.stdout.on("data", onStdout);
    engine.stderr.on("data", onStderr);
    engine.on("error", err => {
      clearTimeout(timeout);
      reject(err);
    });
    engine.on("close", code => {
      if (bestmoveSeen) return;
      clearTimeout(timeout);
      if (code && code !== 0) {
        reject(new Error(`Engine exited with code ${code}`));
      }
    });
  });

  return gatherPromise.finally(() => {
    engine.kill();
  });
}

async function runEngineSelfTest(): Promise<SelfTestResult> {
  if (!STOCKFISH_PATH) {
    throw new Error("STOCKFISH_PATH is not set");
  }

  const engine = spawn(STOCKFISH_PATH, [], { stdio: ["pipe", "pipe", "pipe"] });
  let engineName: string | null = null;
  let lastInfo: ReturnType<typeof parseInfoLine> | null = null;
  let searchStarted = false;
  const write = (text: string) => {
    engine.stdin.write(text + "\n");
  };

  return new Promise<SelfTestResult>((resolve, reject) => {
    let settled = false;
    const finish = (result: SelfTestResult | Error, isError: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        engine.kill();
      } catch (error) {
        console.warn(`${LOG_PREFIX} self-test cleanup error`, error);
      }
      if (isError) {
        reject(result instanceof Error ? result : new Error(String(result)));
      } else {
        resolve(result as SelfTestResult);
      }
    };

    const timeout = setTimeout(() => {
      finish(new Error(`Self-test timed out after ${SELF_TEST_TIMEOUT_MS}ms`), true);
    }, SELF_TEST_TIMEOUT_MS);

    engine.stdout.on("data", data => {
      const text = data.toString("utf8");
      text.split(/\r?\n/).forEach((line: string) => {
        if (!line.trim()) return;
        if (line.startsWith("id name")) {
          engineName = line.slice("id name".length).trim();
        }
        if (line.includes("uciok")) {
          write("isready");
        }
        if (line.includes("readyok") && !searchStarted) {
          searchStarted = true;
          write("ucinewgame");
          write(`setoption name Threads value ${DEFAULT_THREADS}`);
          write(`setoption name Hash value ${DEFAULT_HASH_MB}`);
          const positionCommand = SELF_TEST_FEN === "startpos" ? "position startpos" : `position fen ${SELF_TEST_FEN}`;
          write(positionCommand);
          const goCommand =
            SELF_TEST_MOVETIME_MS > 0 ? `go movetime ${SELF_TEST_MOVETIME_MS} multipv 1` : `go depth ${SELF_TEST_DEPTH} multipv 1`;
          write(goCommand);
        }
        if (line.startsWith("info")) {
          const parsed = parseInfoLine(line);
          if (parsed) {
            lastInfo = parsed;
          }
        }
        if (line.startsWith("bestmove")) {
          const pvText = lastInfo?.pvMoves?.length ? lastInfo.pvMoves.join(" ") : null;
          const depth = lastInfo?.depth ?? null;
          const result: SelfTestResult = {
            status: "ok",
            engineName: engineName ?? "Stockfish 17.1 NNUE",
            depth,
            pv: pvText,
          };
          finish(result, false);
        }
      });
    });

    engine.stderr.on("data", data => {
      console.warn(`${LOG_PREFIX} stderr (self-test)`, { message: data.toString("utf8") });
    });

    engine.on("error", err => {
      finish(err, true);
    });
    engine.on("close", code => {
      if (settled) return;
      if (code && code !== 0) {
        finish(new Error(`Engine exited with code ${code}`), true);
      } else {
        finish(new Error("Engine closed before bestmove"), true);
      }
    });

    write("uci");
  });
}

function buildResponse(requestId: string, linesByPv: Map<number, { multipv: number; depth?: number; selDepth?: number; scoreCp?: number; scoreMate?: number; pvMoves: string[] }>): CloudEngineResponse {
  const lines = Array.from(linesByPv.values())
    .sort((a, b) => a.multipv - b.multipv)
    .map(line => ({
      multipv: line.multipv,
      depth: line.depth ?? 0,
      selDepth: line.selDepth,
      scoreCp: line.scoreCp,
      scoreMate: line.scoreMate,
      pvMoves: line.pvMoves,
    }));

  return {
    requestId,
    id: requestId,
    backend: ENGINE_BACKEND,
    lines,
    engineName: "Stockfish 17.1 NNUE",
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
    if (!STOCKFISH_PATH) {
      console.warn(`${LOG_PREFIX} healthcheck failed (missing STOCKFISH_PATH)`);
      return sendJson(res, 500, { status: "error", error: "STOCKFISH_PATH not configured" });
    }
    const statusCode = lastSelfTestStatus?.status === "error" ? 503 : 200;
    const payload: Record<string, unknown> = {
      status: statusCode === 200 ? "ok" : "error",
      engine: "Stockfish 17.1 NNUE",
      mode: "ready",
      lastSelfTest: lastSelfTestStatus,
      error: lastSelfTestStatus?.status === "error" ? lastSelfTestStatus.message : undefined,
    };
    if (statusCode === 200) {
      console.log(`${LOG_PREFIX} healthcheck ok`, { lastSelfTest: lastSelfTestStatus?.status ?? "unknown" });
    } else {
      console.warn(`${LOG_PREFIX} healthcheck degraded`, { lastSelfTest: lastSelfTestStatus });
    }
    return sendJson(res, statusCode, payload);
  }

  if (req.method === "POST" && url.pathname === "/engine/self-test") {
    if (!STOCKFISH_PATH) {
      return sendJson(res, 500, { status: "error", error: "STOCKFISH_PATH not configured" });
    }
    try {
      const result = await runEngineSelfTest();
      lastSelfTestStatus = {
        status: "ok",
        engineName: result.engineName,
        depth: result.depth ?? null,
        pv: result.pv ?? null,
        timestamp: Date.now(),
      };
      console.log(`${LOG_PREFIX} self-test ok`, {
        engineName: result.engineName,
        depth: result.depth,
        pvPreview: result.pv ? result.pv.slice(0, 80) : null,
      });
      return sendJson(res, 200, {
        status: "ok",
        engine: result.engineName ?? "Stockfish 17.1 NNUE",
        depth: result.depth ?? null,
        pv: result.pv ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
      lastSelfTestStatus = { status: "error", message, timestamp: Date.now() };
      console.error(`${LOG_PREFIX} (self-test error)`, { error: message });
      return sendJson(res, 500, { status: "error", error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/engine/eval") {
    let payload: CloudEngineRequest;
    try {
      payload = await readJson<CloudEngineRequest>(req);
    } catch (error) {
      return sendJson(res, 400, { error: "Invalid JSON payload", details: error instanceof Error ? error.message : String(error ?? "Unknown error") });
    }

    const validationError = validateRequest(payload);
    if (validationError) {
      return sendJson(res, 400, validationError);
    }

    if (!STOCKFISH_PATH) {
      return sendJson(res, 500, { error: "STOCKFISH_PATH not configured" });
    }

    try {
      const response = await runEngineEval(payload);
      console.log(`${LOG_PREFIX} responded`, {
        requestId: payload.requestId,
        fenPreview: payload.fen.slice(0, 60),
        movetimeMs: payload.movetimeMs,
        searchMode: normalizeSearchMode(payload),
        targetDepth: payload.targetDepth,
        threads: payload.threads,
        hashMb: payload.hashMb,
        multiPv: payload.multiPv,
        depth: response.lines[0]?.depth,
        scoreCp: response.lines[0]?.scoreCp,
      });
      return sendJson(res, 200, response);
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to evaluate`, {
        requestId: payload.requestId,
        fenPreview: payload.fen.slice(0, 60),
        error: error instanceof Error ? error.message : String(error ?? "Unknown error"),
      });
      return sendJson(res, 500, { error: "Engine evaluation failed" });
    }
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`${LOG_PREFIX} listening on port ${PORT}`);
  if (!STOCKFISH_PATH) {
    console.warn(`${LOG_PREFIX} WARNING: STOCKFISH_PATH not set; requests will fail until configured.`);
  }
});

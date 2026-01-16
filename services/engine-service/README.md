# Chessviewlive NNUE Engine Service (prototype)

A minimal Node + TypeScript HTTP wrapper around a Stockfish 17.1 NNUE binary, intended to be the external service that the Next.js app proxies to via `/api/engine/eval` when `CLOUD_ENGINE_URL` is set.

## API
- `POST /engine/eval`
  - Body: `CloudEngineRequest` `{ fen: string; multiPv: number; requestId: string; searchMode?: "time" | "depth"; targetDepth?: number; movetimeMs?: number; threads?: number; hashMb?: number; skillLevel?: number; profileId?: "light" | "standard" | "pro" }`
  - Response: `CloudEngineResponse` matching the shapes used in the Next.js app (requestId, backend, lines[] with multipv/depth/selDepth/scoreCp|scoreMate/pvMoves, optional nodes/nps/engineName).
- `GET /health` (or `/healthz`)
  - Lightweight check that the HTTP service is up and `STOCKFISH_PATH` is configured.
  - Returns `{ status: "ok", engine: "Stockfish 17.1 NNUE", mode: "ready", lastSelfTest: {...} }` (503/500 with an error when misconfigured or the last self-test failed).
- `POST /engine/self-test`
  - Runs a short built-in test (startpos, depth 6, multipv 1) against a fresh Stockfish 17.1 NNUE process.
  - Returns `{ status: "ok", engine, depth, pv }` on success; `{ status: "error", error }` on failure. Heavier than `/health`, so use sparingly (e.g., deployment smoke test, periodic monitoring).

## Running locally
```bash
# Required
export STOCKFISH_PATH=/path/to/stockfish-17.1-nnue
# Optional
export PORT=4000
export STOCKFISH_THREADS=2
export STOCKFISH_HASH_MB=256

# Run (ts-node or ts-node-esm; adjust to your setup)
npx ts-node engine-service/server.ts
```

- The server logs with the prefix `[ENGINE CORE] (nnue service)` and starts listening on `PORT` (default 4000).
- If `STOCKFISH_PATH` is missing, requests return 500 with a JSON error.
- Timeout: `movetimeMs + 2000ms` grace; if `bestmove` is not seen, the engine is killed and the request fails with a JSON error (or partial lines if available).

## Relationship to the Next.js app
- Set `CLOUD_ENGINE_URL=http://localhost:4000/engine/eval` in the Next.js env to proxy cloud evaluations to this service.
- Request/response shapes are identical to the app’s `CloudEngineRequest` / `CloudEngineResponse`; this file can be copy-pasted into a standalone repo if we split the service later.

## Setup
1) Install dependencies
```bash
cd engine-service
npm install
```

2) Run in development (TypeScript via ts-node-dev)
```bash
npm run dev
```

3) Build and run production
```bash
npm run build
npm start
```

Environment: set `PORT` (default 4000) and `STOCKFISH_PATH` to your Stockfish 17.1 NNUE binary before starting the service.

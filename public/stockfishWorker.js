// public/stockfishWorker.js
// Classic Web Worker that runs Stockfish 17.1 lite-single from CDN.
// Pure JavaScript (no TypeScript, no imports/exports).

/* eslint-disable no-restricted-globals */

const ctx = self;

(function () {
  'use strict';

  // -------- Configure WASM path BEFORE loading Stockfish JS --------
  ctx.Module = {
    locateFile: function (path) {
      if (typeof path === 'string' && path.endsWith('.wasm')) {
        // Force the correct WASM URL
        return 'https://unpkg.com/stockfish@17.1.0/src/stockfish-17.1-lite-single-03e3232.wasm';
      }
      return path;
    },
  };

  try {
    ctx.importScripts(
      'https://unpkg.com/stockfish@17.1.0/src/stockfish-17.1-lite-single-03e3232.js'
    );
    // If this logs, JS was loaded (WASM will be loaded via Module.locateFile)
    console.log('[StockfishWorker] Loaded Stockfish 17.1 lite-single from CDN');
  } catch (e) {
    console.error('[StockfishWorker] Failed to import Stockfish', e);
    ctx.postMessage({ type: 'engine-error', error: String(e) });
    return;
  }

  // -------- Create engine instance from global factory --------
  var factory = ctx.STOCKFISH || ctx.Stockfish;
  if (!factory) {
    console.error('[StockfishWorker] No Stockfish factory after importScripts');
    ctx.postMessage({ type: 'engine-error', error: 'No Stockfish factory' });
    return;
  }

  var engine = factory();
  var engineReady = false;
  var pendingJob = null; // { fen, requestId, lastScore }

  function send(cmd) {
    // console.log('[StockfishWorker] >>>', cmd);
    engine.postMessage(cmd);
  }

  function parseScore(line) {
    // info ... score cp 23 ...  OR score mate -3
    var m = line.match(/\bscore (cp|mate) (-?\d+)/);
    if (!m) return null;
    var kind = m[1];
    var val = parseInt(m[2], 10);
    if (!isFinite(val)) return null;
    if (kind === 'cp') return { cp: val };
    return { mate: val };
  }

  engine.onmessage = function (event) {
    var text = String(event.data || '');
    // console.log('[StockfishWorker] <<<', text);

    if (text.indexOf('uciok') !== -1) {
      // nothing special
      return;
    }
    if (text.indexOf('readyok') !== -1) {
      engineReady = true;
      console.log('[StockfishWorker] Engine ready');
      if (pendingJob && !pendingJob.sent) {
        doEvaluate(pendingJob);
      }
      return;
    }

    if (!pendingJob) return;

    if (text.indexOf('info ') === 0) {
      var s = parseScore(text);
      if (s) pendingJob.lastScore = s;
      return;
    }

    if (text.indexOf('bestmove') === 0) {
      // Finish current evaluation
      var payload = {
        type: 'evaluation',
        requestId: pendingJob.requestId,
        eval: pendingJob.lastScore || null,
        lines: [], // single PV for now; we can extend to MultiPV later
      };
      ctx.postMessage(payload);
      pendingJob = null;
    }
  };

  function initEngine() {
    send('uci');
    send('isready');
  }

  function doEvaluate(job) {
    job.sent = true;
    pendingJob = job;
    send('ucinewgame');
    send('position fen ' + job.fen);
    send('go depth 15');
  }

  initEngine();

  // -------- Messages from main thread --------
  ctx.onmessage = function (event) {
    var data = event.data || {};
    if (!data || data.type !== 'evaluate-position') return;

    var fen = data.fen;
    var requestId = data.requestId || '';

    if (!fen) {
      ctx.postMessage({
        type: 'evaluation',
        requestId: requestId,
        eval: null,
        lines: [],
      });
      return;
    }

    var job = {
      fen: fen,
      requestId: requestId,
      lastScore: null,
      sent: false,
    };

    if (!engineReady) {
      pendingJob = job;
      return;
    }

    doEvaluate(job);
  };
})();

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/games.ts
var games_exports = {};
__export(games_exports, {
  getTournamentGames: () => getTournamentGames
});
function generateMockGames(tournamentSlug, count) {
  const games = [];
  const seed = tournamentSlug.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  for (let i = 0; i < count; i++) {
    const whiteIndex = (seed + i * 2) % PLAYER_POOL.length;
    const blackIndex = (seed + i * 2 + 1) % PLAYER_POOL.length;
    let isLive;
    if (tournamentSlug.includes("tata")) {
      isLive = (seed + i) % 5 !== 0;
    } else if (tournamentSlug.includes("armenian")) {
      isLive = false;
    } else {
      isLive = (seed + i) % 3 !== 0;
    }
    const fenIndex = (seed + i) % FEN_POOL.length;
    const titles = ["GM", "GM", "GM", "IM", "FM", "GM"];
    const whiteTitle = titles[(whiteIndex + i) % titles.length];
    const blackTitle = titles[(blackIndex + i) % titles.length];
    const federations = ["US", "RU", "IN", "CN", "NO", "FR", "DE", "ES", "NL", "AM"];
    const whiteFederation = federations[whiteIndex % federations.length];
    const blackFederation = federations[blackIndex % federations.length];
    const whiteRating = 2600 + (whiteIndex * 13 + i * 7) % 200;
    const blackRating = 2600 + (blackIndex * 11 + i * 5) % 200;
    let whiteResult;
    let blackResult;
    if (!isLive) {
      const resultType = (seed + i) % 3;
      if (resultType === 0) {
        whiteResult = "1";
        blackResult = "0";
      } else if (resultType === 1) {
        whiteResult = "0";
        blackResult = "1";
      } else {
        whiteResult = "\xBD";
        blackResult = "\xBD";
      }
    }
    const lastMoves = ["e2e4", "e7e5", "d2d4", "d7d5", "g1f3", "b8c6", "f1c4", "c7c5", "e1g1", "f8e7", "b1c3", "g8f6"];
    const lastMove = lastMoves[i % lastMoves.length];
    const scoreCp = (seed + i * 17) % 600 - 300;
    let round;
    if (i < 9) {
      round = i + 1;
    } else {
      if (isLive) {
        round = 7 + (seed + i) % 3;
      } else {
        round = 1 + (seed + i) % 6;
      }
    }
    games.push({
      gameId: `${tournamentSlug}-game-${i + 1}`,
      whiteName: PLAYER_POOL[whiteIndex],
      blackName: PLAYER_POOL[blackIndex],
      whiteTitle,
      blackTitle,
      whiteFederation,
      blackFederation,
      whiteRating,
      blackRating,
      isLive,
      whiteClock: isLive ? `${45 + i % 15}:${10 + i % 50}` : "0:00",
      blackClock: isLive ? `${38 + i % 20}:${5 + i % 55}` : "0:00",
      whiteResult,
      blackResult,
      fen: FEN_POOL[fenIndex],
      pgn: PGN_POOL[i % PGN_POOL.length],
      lastMove,
      scoreCp,
      round,
      lastUpdatedAt: new Date(Date.now() - i * 6e4).toISOString()
    });
  }
  return games;
}
function getTournamentGames(tournamentSlug) {
  return generateMockGames(tournamentSlug, 15);
}
var PLAYER_POOL, FEN_POOL, PGN_POOL;
var init_games = __esm({
  "src/games.ts"() {
    "use strict";
    PLAYER_POOL = [
      "Magnus Carlsen",
      "Hikaru Nakamura",
      "Fabiano Caruana",
      "Ding Liren",
      "Ian Nepomniachtchi",
      "Alireza Firouzja",
      "Wesley So",
      "Levon Aronian",
      "Anish Giri",
      "Maxime Vachier-Lagrave",
      "Viswanathan Anand",
      "Sergey Karjakin",
      "Shakhriyar Mamedyarov",
      "Teimour Radjabov",
      "Alexander Grischuk",
      "Richard Rapport",
      "Jan-Krzysztof Duda",
      "Pentala Harikrishna",
      "Vladislav Artemiev",
      "Sam Shankland"
    ];
    FEN_POOL = [
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      // Starting position
      "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3",
      // Italian opening
      "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3",
      // Scotch game
      "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R b KQkq - 0 5",
      // Queen's Gambit
      "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 6 5",
      // Giuoco Piano
      "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 4",
      // Two Knights Defense
      "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 3",
      // Ruy Lopez
      "rnbqkb1r/pp2pppp/3p1n2/2p5/2PP4/2N2N2/PP2PPPP/R1BQKB1R b KQkq - 0 5",
      // Caro-Kann
      "rnbqkb1r/pp3ppp/4pn2/2pp4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 6",
      // French Defense
      "r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 7",
      // Middlegame
      "r2qkb1r/ppp2ppp/2np1n2/4p1B1/2B1P3/2NP4/PPP2PPP/R2QK2R b KQkq - 0 8",
      // Middlegame
      "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 9",
      // Castled both sides
      "r2q1rk1/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 10",
      // Developed position
      "r1bqr1k1/ppp2ppp/2np1n2/4p3/1bB1P3/2NP1N2/PPP2PPP/R1BQR1K1 w - - 0 11",
      // Complex middlegame
      "r2q1rk1/1pp1bppp/p1np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQR1K1 w - - 0 12"
      // Advanced middlegame
    ];
    PGN_POOL = [
      // Italian Game
      "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O a6 7. Re1 Ba7 8. Nbd2 O-O 9. h3 h6 10. Nf1 Re8 11. Ng3 Be6 12. Bxe6 Rxe6 13. d4 d5 14. exd5 Qxd5 15. dxe5 Qxd1 16. Rxd1 Nxe5 17. Nxe5 Rxe5 18. Bf4 Re7 19. Kf1 c6 20. c4 Rae8",
      // Ruy Lopez
      "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. c4 c6 12. cxb5 axb5 13. Nc3 Bb7 14. Bg5 h6 15. Bh4 Re8 16. a3 Nh7 17. Bxe7 Qxe7 18. d5 Nc5 19. dxc6 Bxc6 20. Bd5",
      // Sicilian Najdorf
      "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 h5 9. Qd2 Nbd7 10. O-O-O Rc8 11. Kb1 Be7 12. Bd3 b5 13. Rhe1 Nb6 14. Qf2 Nc4 15. Bxc4 bxc4 16. Nc5 Qa5 17. Nxe6 fxe6 18. Ka1 Rc6 19. Rb1 O-O 20. Qd2",
      // Queen's Gambit Declined
      "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5 5. Bg5 c6 6. e3 Bf5 7. Qf3 Bg6 8. Bxf6 Qxf6 9. Qxf6 gxf6 10. h4 h5 11. Kd2 Nd7 12. Bd3 Nb6 13. Nge2 Bd6 14. g3 Ke7 15. Nf4 Bxf4 16. gxf4 Bxd3 17. Kxd3 f5 18. Rhg1 Rag8 19. Rg5 f6 20. Rxg8 Rxg8",
      // Indian Game
      "1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 Ba6 5. b3 Bb4+ 6. Bd2 Be7 7. Nc3 O-O 8. Rc1 c6 9. e4 d5 10. e5 Ne4 11. Bd3 Nxc3 12. Rxc3 c5 13. h4 h6 14. O-O Nc6 15. dxc5 bxc5 16. Bb1 f5 17. exf6 Bxf6 18. Qc2 Bxc3 19. Qh7+ Kf7 20. Bxc3 d4"
    ];
  }
});

// src/tournaments.ts
var REAL_TOURNAMENTS = [
  {
    id: "tata-steel-2026",
    slug: "tata-steel-2026",
    name: "Tata Steel Chess Tournament 2026",
    startDate: "2026-01-16",
    endDate: "2026-02-01",
    rounds: 13,
    location: "Wijk aan Zee",
    country: "Netherlands"
  },
  {
    id: "armenian-championship-2026",
    slug: "armenian-championship-2026",
    name: "Armenian Championship Highest League 2026",
    startDate: "2026-01-13",
    endDate: "2026-01-21",
    rounds: 9,
    location: "Yerevan",
    country: "Armenia"
  },
  {
    id: "prague-open-2026",
    slug: "prague-open-2026",
    name: "Prague Open 2026 IM open A",
    startDate: "2026-01-05",
    endDate: "2026-01-12",
    rounds: 9,
    location: "Prague",
    country: "Czech Republic"
  }
];
function getTournamentStatus(startDate, endDate) {
  const now = /* @__PURE__ */ new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  now.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (now >= start && now <= end) {
    return "ONGOING";
  } else if (now < start) {
    return "UPCOMING";
  } else {
    return "FINISHED";
  }
}
function formatDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} - ${endStr}`;
}
function computeTournamentActivity(slug, startDate, endDate) {
  const now = /* @__PURE__ */ new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  now.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (now < start) {
    return "UPCOMING";
  } else if (now > end) {
    return "FINISHED";
  }
  const { getTournamentGames: getTournamentGames2 } = (init_games(), __toCommonJS(games_exports));
  const games = getTournamentGames2(slug);
  const hasLiveGames = games.some((game) => game.isLive);
  return hasLiveGames ? "LIVE" : "ONGOING";
}
function getTournaments() {
  const tournaments = REAL_TOURNAMENTS.map((t) => {
    const status = getTournamentStatus(t.startDate, t.endDate);
    const activity = computeTournamentActivity(t.slug, t.startDate, t.endDate);
    return {
      ...t,
      status,
      isLive: activity === "LIVE",
      dateRange: formatDateRange(t.startDate, t.endDate)
    };
  });
  return tournaments.sort((a, b) => {
    const aActivity = computeTournamentActivity(a.slug, a.startDate, a.endDate);
    const bActivity = computeTournamentActivity(b.slug, b.startDate, b.endDate);
    const activityOrder = { LIVE: 0, ONGOING: 1, FINISHED: 2, UPCOMING: 3 };
    const orderDiff = activityOrder[aActivity] - activityOrder[bActivity];
    if (orderDiff !== 0) return orderDiff;
    if (aActivity === "LIVE" || aActivity === "ONGOING") {
      return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    } else if (aActivity === "FINISHED") {
      return new Date(b.endDate).getTime() - new Date(a.endDate).getTime();
    }
    return 0;
  });
}
function getLiveTournaments() {
  return getTournaments().filter((t) => t.isLive);
}

// src/index.ts
init_games();

// src/board-theme.ts
var BOARD_THEME = {
  lightSquare: "#f0d9b5",
  darkSquare: "#b58863",
  whitePiece: "#ffffff",
  blackPiece: "#444444"
};

// src/index.ts
var CORE_VERSION = "0.0.0";
function coreHello() {
  return "core-ok";
}
export {
  BOARD_THEME,
  CORE_VERSION,
  coreHello,
  getLiveTournaments,
  getTournamentGames,
  getTournaments
};

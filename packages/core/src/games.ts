export interface GameSummary {
    gameId: string;
    whiteName: string;
    blackName: string;
    whiteTitle?: string; // GM, IM, FM, WGM, etc.
    blackTitle?: string;
    whiteFederation?: string; // 2-letter country code
    blackFederation?: string;
    whiteRating?: number;
    blackRating?: number;
    isLive: boolean;
    whiteClock: string; // mm:ss format
    blackClock: string; // mm:ss format
    whiteResult?: string; // '1' (win), '0' (loss), '½' (draw)
    blackResult?: string;
    fen: string; // FEN string for board position
    lastMove?: string; // Last move in UCI format, e.g., 'e2e4' or 'e7e5'
    scoreCp?: number; // Engine evaluation in centipawns (canonical web field name)
    evalCp?: number; // Alias for backward compatibility (deprecated, use scoreCp)
    pgn: string; // Full game history in PGN format
    round?: number; // Tournament round number (1, 2, 3, etc.)
    lastUpdatedAt: string; // ISO timestamp
    previewFen?: string; // Deterministic final FEN for preview
    previewFenSource?: string; // 'pgn_final' | 'snapshot_fallback' etc
}

const PLAYER_POOL = [
    'Magnus Carlsen', 'Hikaru Nakamura', 'Fabiano Caruana', 'Ding Liren',
    'Ian Nepomniachtchi', 'Alireza Firouzja', 'Wesley So', 'Levon Aronian',
    'Anish Giri', 'Maxime Vachier-Lagrave', 'Viswanathan Anand', 'Sergey Karjakin',
    'Shakhriyar Mamedyarov', 'Teimour Radjabov', 'Alexander Grischuk', 'Richard Rapport',
    'Jan-Krzysztof Duda', 'Pentala Harikrishna', 'Vladislav Artemiev', 'Sam Shankland',
];

// Varied midgame positions for visual diversity
const FEN_POOL = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // Starting position
    'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3', // Italian opening
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3', // Scotch game
    'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R b KQkq - 0 5', // Queen's Gambit
    'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 6 5', // Giuoco Piano
    'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 4', // Two Knights Defense
    'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 3', // Ruy Lopez
    'rnbqkb1r/pp2pppp/3p1n2/2p5/2PP4/2N2N2/PP2PPPP/R1BQKB1R b KQkq - 0 5', // Caro-Kann
    'rnbqkb1r/pp3ppp/4pn2/2pp4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 6', // French Defense
    'r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 7', // Middlegame
    'r2qkb1r/ppp2ppp/2np1n2/4p1B1/2B1P3/2NP4/PPP2PPP/R2QK2R b KQkq - 0 8', // Middlegame
    'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 9', // Castled both sides
    'r2q1rk1/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 10', // Developed position
    'r1bqr1k1/ppp2ppp/2np1n2/4p3/1bB1P3/2NP1N2/PPP2PPP/R1BQR1K1 w - - 0 11', // Complex middlegame
    'r2q1rk1/1pp1bppp/p1np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQR1K1 w - - 0 12', // Advanced middlegame
];

const PGN_POOL = [
    // Italian Game
    '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O a6 7. Re1 Ba7 8. Nbd2 O-O 9. h3 h6 10. Nf1 Re8 11. Ng3 Be6 12. Bxe6 Rxe6 13. d4 d5 14. exd5 Qxd5 15. dxe5 Qxd1 16. Rxd1 Nxe5 17. Nxe5 Rxe5 18. Bf4 Re7 19. Kf1 c6 20. c4 Rae8',
    // Ruy Lopez
    '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. c4 c6 12. cxb5 axb5 13. Nc3 Bb7 14. Bg5 h6 15. Bh4 Re8 16. a3 Nh7 17. Bxe7 Qxe7 18. d5 Nc5 19. dxc6 Bxc6 20. Bd5',
    // Sicilian Najdorf
    '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 h5 9. Qd2 Nbd7 10. O-O-O Rc8 11. Kb1 Be7 12. Bd3 b5 13. Rhe1 Nb6 14. Qf2 Nc4 15. Bxc4 bxc4 16. Nc5 Qa5 17. Nxe6 fxe6 18. Ka1 Rc6 19. Rb1 O-O 20. Qd2',
    // Queen's Gambit Declined
    '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5 5. Bg5 c6 6. e3 Bf5 7. Qf3 Bg6 8. Bxf6 Qxf6 9. Qxf6 gxf6 10. h4 h5 11. Kd2 Nd7 12. Bd3 Nb6 13. Nge2 Bd6 14. g3 Ke7 15. Nf4 Bxf4 16. gxf4 Bxd3 17. Kxd3 f5 18. Rhg1 Rag8 19. Rg5 f6 20. Rxg8 Rxg8',
    // Indian Game
    '1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 Ba6 5. b3 Bb4+ 6. Bd2 Be7 7. Nc3 O-O 8. Rc1 c6 9. e4 d5 10. e5 Ne4 11. Bd3 Nxc3 12. Rxc3 c5 13. h4 h6 14. O-O Nc6 15. dxc5 bxc5 16. Bb1 f5 17. exf6 Bxf6 18. Qc2 Bxc3 19. Qh7+ Kf7 20. Bxc3 d4',
];

function generateMockGames(tournamentSlug: string, count: number): GameSummary[] {
    const games: GameSummary[] = [];
    const seed = tournamentSlug.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

    for (let i = 0; i < count; i++) {
        const whiteIndex = (seed + i * 2) % PLAYER_POOL.length;
        const blackIndex = (seed + i * 2 + 1) % PLAYER_POOL.length;

        // Different live game ratios per tournament to ensure variety
        // Tata Steel: mostly live games (LIVE status)
        // Armenian Championship: no live games (ONGOING status)
        // Prague Open: no games shown (FINISHED status)
        let isLive: boolean;
        if (tournamentSlug.includes('tata')) {
            isLive = (seed + i) % 5 !== 0; // ~80% live
        } else if (tournamentSlug.includes('armenian')) {
            isLive = false; // 0% live (ONGOING but not LIVE)
        } else {
            isLive = (seed + i) % 3 !== 0; // ~66% live (default)
        }

        const fenIndex = (seed + i) % FEN_POOL.length;

        // Mock titles (GM for most top players)
        const titles = ['GM', 'GM', 'GM', 'IM', 'FM', 'GM'];
        const whiteTitle = titles[(whiteIndex + i) % titles.length];
        const blackTitle = titles[(blackIndex + i) % titles.length];

        // Mock federations (common chess countries)
        const federations = ['US', 'RU', 'IN', 'CN', 'NO', 'FR', 'DE', 'ES', 'NL', 'AM'];
        const whiteFederation = federations[whiteIndex % federations.length];
        const blackFederation = federations[blackIndex % federations.length];

        // Mock ratings (2600-2800 range for elite players)
        const whiteRating = 2600 + ((whiteIndex * 13 + i * 7) % 200);
        const blackRating = 2600 + ((blackIndex * 11 + i * 5) % 200);

        // Results for finished games
        let whiteResult: string | undefined;
        let blackResult: string | undefined;
        if (!isLive) {
            const resultType = (seed + i) % 3;
            if (resultType === 0) { // White wins
                whiteResult = '1';
                blackResult = '0';
            } else if (resultType === 1) { // Black wins
                whiteResult = '0';
                blackResult = '1';
            } else { // Draw
                whiteResult = '½';
                blackResult = '½';
            }
        }

        // Generate a plausible last move based on game index
        const lastMoves = ['e2e4', 'e7e5', 'd2d4', 'd7d5', 'g1f3', 'b8c6', 'f1c4', 'c7c5', 'e1g1', 'f8e7', 'b1c3', 'g8f6'];
        const lastMove = lastMoves[i % lastMoves.length];

        // Generate a plausible eval (random between -300 and +300 cp)
        // Use scoreCp (canonical web field name)
        const scoreCp = ((seed + i * 17) % 600) - 300;

        // Assign round numbers: ensure all rounds 1-9 are represented
        // Distribute games across all rounds for proper testing
        let round: number;
        if (i < 9) {
            // First 9 games: one per round (1-9) to ensure full coverage
            round = i + 1;
        } else {
            // Remaining games: spread across rounds based on live status
            if (isLive) {
                // Live games favor recent rounds (7-9)
                round = 7 + ((seed + i) % 3);
            } else {
                // Finished games spread across earlier rounds (1-6)
                round = 1 + ((seed + i) % 6);
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
            whiteClock: isLive ? `${45 + (i % 15)}:${10 + (i % 50)}` : '0:00',
            blackClock: isLive ? `${38 + (i % 20)}:${5 + (i % 55)}` : '0:00',
            whiteResult,
            blackResult,
            fen: FEN_POOL[fenIndex],
            pgn: PGN_POOL[i % PGN_POOL.length],
            lastMove,
            scoreCp,
            round,
            lastUpdatedAt: new Date(Date.now() - i * 60000).toISOString(),
        });
    }

    return games;
}

export function getTournamentGames(tournamentSlug: string): GameSummary[] {
    return generateMockGames(tournamentSlug, 15);
}

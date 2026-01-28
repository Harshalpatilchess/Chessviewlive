import { useState, useEffect, useRef, useCallback } from 'react';
import { findLichessGameId, fetchSingleGamePgn, parsePgnFeed, DgtGame } from '../services/tataSteel';

export interface FastGameUpdate {
    pgn: string;
    whiteClock: string;
    blackClock: string;
    isLive: boolean; // Computed from result and moves
    lastUpdatedAt: string;
    feedAgeSec: number;
    source: string;
    moveCount: number;
    fen: string;
    whiteResult?: string;
    blackResult?: string;
    whiteName?: string;
    blackName?: string;
}

export function useFastGamePoller(
    round: number,
    whiteName: string,
    blackName: string,
    initialIsLive: boolean,
    gameKey: string // For logging context
) {
    const [fastUpdate, setFastUpdate] = useState<FastGameUpdate | null>(null);
    const [lichessGameId, setLichessGameId] = useState<string | null>(null);
    const [isPollingLive, setIsPollingLive] = useState(initialIsLive);
    const discoveryAttempted = useRef(false);

    // 1. Discovery: Find the Lichess ID
    useEffect(() => {
        let mounted = true;
        if (!lichessGameId && !discoveryAttempted.current && round && whiteName && blackName) {
            discoveryAttempted.current = true; // One shot

            const discover = async () => {
                if (__DEV__) console.log(`[FastPoll] Starting discovery for ${whiteName} vs ${blackName} (R${round})`);
                const id = await findLichessGameId(round, whiteName, blackName);
                if (mounted && id) {
                    if (__DEV__) console.log(`[FastPoll] Found Lichess ID: ${id}`);
                    setLichessGameId(id);
                } else if (mounted) {
                    if (__DEV__) console.log(`[FastPoll] Discovery failed (not found)`);
                }
            };
            discover();
        }
        return () => { mounted = false; };
    }, [lichessGameId, round, whiteName, blackName]);

    // 2. Poll Loop
    useEffect(() => {
        if (!lichessGameId) return;

        let mounted = true;
        let timer: NodeJS.Timeout;

        const poll = async () => {
            const start = Date.now();
            try {
                const pgnText = await fetchSingleGamePgn(lichessGameId);
                if (!mounted) return;

                if (pgnText) {
                    // Parse
                    const games = parsePgnFeed(pgnText);
                    if (games.length > 0) {
                        const game = games[0]; // Should be only one
                        const now = Date.now();
                        const updateTime = new Date().toISOString();

                        // Extract Clocks & State
                        // Logic reused from DgtGame structure
                        const isLive = game.status === 'Live';

                        // Convert result to mobile friendly format if needed, but DgtGame has generic string
                        // We map it in GameScreen usually, but let's provide helpers
                        const wRes = game.result === '1-0' ? '1' : game.result === '0-1' ? '0' : game.result === '1/2-1/2' ? '½' : undefined;
                        const bRes = game.result === '1-0' ? '0' : game.result === '0-1' ? '1' : game.result === '1/2-1/2' ? '½' : undefined;

                        const update: FastGameUpdate = {
                            pgn: game.moves.join(' '),
                            whiteClock: game.clock.white,
                            blackClock: game.clock.black,
                            isLive: isLive,
                            lastUpdatedAt: updateTime,
                            feedAgeSec: 0, // Since we just fetched from API which is effectively live
                            source: 'LICHESS_FAST',
                            moveCount: Math.ceil(game.moves.length / 2),
                            fen: game.fen,
                            whiteResult: wRes,
                            blackResult: bRes,
                            whiteName: game.white.name,
                            blackName: game.black.name
                        };

                        setFastUpdate(update);
                        setIsPollingLive(isLive);

                        // Logging (User req 4)
                        const parseMs = Date.now() - start;
                        if (__DEV__) {
                            console.log(`[FastPoll] Success: ${gameKey} src=LICHESS_FAST moves=${update.moveCount} age=0s parse=${parseMs}ms`);
                        }
                    } else {
                        // Parse success but no games (unlikely)
                    }
                }
            } catch (e: any) {
                if (__DEV__) console.warn(`[FastPoll] Error: stage=fetch/parse msg=${e.message}`);
            }

            // Schedule next
            const interval = isPollingLive ? 2000 : 8000;
            timer = setTimeout(poll, interval);
        };

        poll(); // Start immediately

        return () => {
            mounted = false;
            clearTimeout(timer);
        };
    }, [lichessGameId, gameKey, isPollingLive]);

    return { fastUpdate };
}

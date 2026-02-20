import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameSummary } from '@chessview/core';

export const PREVIEW_CACHE = new Map<string, { fen: string; lastMove?: string; updatedAt: number }>();

const CACHE_PREFIX = 'previewFenCache:';

function getCacheKey(tournamentKey: string, roundNum: number): string {
    return `${CACHE_PREFIX}${tournamentKey}:${roundNum}`;
}

// Generate a stable key for the game map
function getGameKey(g: GameSummary): string {
    if ((g as any).lichessGameId) return (g as any).lichessGameId;
    if (g.gameId) return g.gameId;
    const r = g.round ?? 'ur';
    const w = g.whiteName ? g.whiteName.toLowerCase().replace(/[.,-\s]+/g, '') : 'white';
    const b = g.blackName ? g.blackName.toLowerCase().replace(/[.,-\s]+/g, '') : 'black';
    return `${r}-${w}-${b}`;
}

export async function loadPreviewCache(tournamentKey: string, roundNum: number): Promise<void> {
    try {
        const key = getCacheKey(tournamentKey, roundNum);
        const json = await AsyncStorage.getItem(key);
        let hits = 0;
        let misses = 0; // Not really calculable without the game list, but we can track entries loaded

        if (json) {
            const data = JSON.parse(json);
            // Data shape: { [gameKey]: { previewFen, updatedAt } }

            Object.keys(data).forEach(gameKey => {
                const entry = data[gameKey];
                if (entry && entry.previewFen) {
                    PREVIEW_CACHE.set(gameKey, {
                        fen: entry.previewFen,
                        lastMove: entry.lastMove,
                        updatedAt: entry.updatedAt || Date.now()
                    });
                    hits++;
                }
            });

            console.log(`[PREVIEW_CACHE_LOAD] tournamentKey=${tournamentKey} roundNum=${roundNum} entriesLoaded=${hits}`);
        } else {
            console.log(`[PREVIEW_CACHE_LOAD] tournamentKey=${tournamentKey} roundNum=${roundNum} status=MISSING`);
        }
    } catch (e) {
        console.warn('[PreviewCache] Load failed', e);
    }
}

export async function savePreviewCache(tournamentKey: string, roundNum: number, games: GameSummary[]) {
    try {
        const key = getCacheKey(tournamentKey, roundNum);
        const cacheMap: Record<string, { previewFen: string, lastMove?: string, updatedAt: number }> = {};

        let savedCount = 0;

        games.forEach(g => {
            const previewFen = (g as any).previewFen || g.fen;
            if (previewFen) {
                const gameKey = getGameKey(g);
                cacheMap[gameKey] = {
                    previewFen,
                    lastMove: (g as any).previewLastMove || (g as any).lastMove,
                    updatedAt: Date.now()
                };

                // Keep memory cache in sync
                PREVIEW_CACHE.set(gameKey, {
                    fen: previewFen,
                    lastMove: (g as any).previewLastMove || (g as any).lastMove,
                    updatedAt: Date.now()
                });
                savedCount++;
            }
        });

        if (savedCount > 0) {
            await AsyncStorage.setItem(key, JSON.stringify(cacheMap));
            console.log(`[PREVIEW_CACHE_SAVE] tournamentKey=${tournamentKey} roundNum=${roundNum} saved=${savedCount}`);
        }
    } catch (e) {
        console.warn('[PreviewCache] Save failed', e);
    }
}

export function getCachedPreview(g: GameSummary): { fen: string, lastMove?: string } | undefined {
    const key = getGameKey(g);
    const entry = PREVIEW_CACHE.get(key);
    if (entry) return { fen: entry.fen, lastMove: entry.lastMove };
    return undefined;
}

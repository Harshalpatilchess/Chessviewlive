import AsyncStorage from '@react-native-async-storage/async-storage';

import { setTournamentPreview } from './previewMemory';
import { PreviewMap } from './previewStore';


/**
 * Tiny module-level in-memory cache for ultra-fast first paint.
 * These maps are populated during app-start prewarming.
 */

interface PreviewEntry {
    previewFen: string;
    lastMove?: string;
    result?: string; // Added result to match usage
    updatedAt: number;
}

interface RoundEntry {
    games: any[]; // Subset of GameSummary
    savedAt: number;
}

// Maps for synchronous access
const PREVIEW_MAP = new Map<string, PreviewEntry>();
const ROUND_UI_MAP = new Map<string, RoundEntry>();

const PREVIEW_PREFIX = 'previewFenCache:';
const ROUND_UI_PREFIX = 'ROUND_UI_CACHE:';

/**
 * Populate memory maps from AsyncStorage.
 * Should be called as early as possible (e.g., App root).
 */

export async function prewarmMemoryCache(tournamentKey: string) {
    try {
        const start = Date.now();
        console.log(`[MemoryCache] Prewarming for ${tournamentKey}...`);

        const stableKey = `preview:tournament:${tournamentKey}`;
        let items: Record<string, PreviewEntry> = {}; // using local definition or compatible shape
        let source = 'none';

        // 1. Try Stable Key
        const rawStable = await AsyncStorage.getItem(stableKey);
        if (rawStable) {
            try {
                const parsed = JSON.parse(rawStable);
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                    items = parsed;
                    source = 'stableKey';
                    console.log(`[PREWARM_SCAN_RESULT] slug=${tournamentKey} source=stableKey items=${Object.keys(items).length}`);
                }
            } catch (e) {
                // ignore
            }
        }

        // 2. Fallback Scan
        if (Object.keys(items).length === 0) {
            source = 'scan';
            const allKeys = await AsyncStorage.getAllKeys();
            const candidates = allKeys.filter(k => k.includes(tournamentKey) || k.toLowerCase().includes('preview'));

            let bestKey = 'none';
            let bestScore = -1;
            let bestData: any = {};

            if (candidates.length > 0) {
                const pairs = await AsyncStorage.multiGet(candidates);
                pairs.forEach(([key, val]) => {
                    if (!val) return;
                    try {
                        const parsed = JSON.parse(val);
                        if (typeof parsed !== 'object') return;

                        let score = 0;
                        let hasLatest = false;

                        Object.values(parsed).forEach((v: any) => {
                            if (v?.previewFen || v?.fen || v?.finalFen || v?.boardFen || v?.preview_fen) {
                                score++;
                            }
                            if (v?.lastMove) hasLatest = true;
                        });

                        // Prefer higher score, tie-break with lastMove
                        if (score > bestScore || (score === bestScore && hasLatest)) {
                            bestScore = score;
                            bestKey = key;
                            bestData = parsed;
                        }
                    } catch (e) { /* ignore */ }
                });
            }

            console.log(`[PREWARM_SCAN_RESULT] slug=${tournamentKey} source=scan bestKey=${bestKey} bestItems=${bestScore}`);

            if (bestScore > 0) {
                // Normalize and Populate
                const normalizedMap: Record<string, PreviewEntry> = {};
                Object.entries(bestData).forEach(([gameKey, entry]: [string, any]) => {
                    const pFen = entry.previewFen || entry.fen || entry.finalFen || entry.boardFen || entry.preview_fen;
                    if (pFen && typeof pFen === 'string' && pFen.length > 10) {
                        normalizedMap[gameKey] = {
                            previewFen: pFen,
                            lastMove: entry.lastMove || entry.previewLastMove,
                            result: entry.result,
                            updatedAt: entry.updatedAt || Date.now()
                        };
                    }
                });

                items = normalizedMap;

                // Write to stable key immediately
                if (Object.keys(items).length > 0) {
                    await AsyncStorage.setItem(stableKey, JSON.stringify(items));
                    console.log(`[PREVIEW_CACHE_WRITE] slug=${tournamentKey} source=scan_repair wroteItems=${Object.keys(items).length}`);
                }
            }
        }

        // 3. Set Memory (Always)
        const count = Object.keys(items).length;
        setTournamentPreview(tournamentKey, items);
        console.log(`[PREWARM_MEMORY_SET] slug=${tournamentKey} items=${count}`);

    } catch (e) {
        console.warn('[MemoryCache] Prewarm failed', e);
        // Ensure we print the result log even on failure
        console.log(`[PREWARM_SCAN_RESULT] slug=${tournamentKey} source=error items=0`);
        setTournamentPreview(tournamentKey, {});
        console.log(`[PREWARM_MEMORY_SET] slug=${tournamentKey} items=0`);
    }
}

/**
 * Synchronous getter for preview FEN.
 */
export function getSyncPreview(gameKey: string): PreviewEntry | undefined {
    return PREVIEW_MAP.get(gameKey);
}

/**
 * Synchronous getter for round games.
 */
export function getSyncRoundUi(tournamentKey: string, roundNum: number): any[] | null {
    const entry = ROUND_UI_MAP.get(`${tournamentKey}:${roundNum}`);
    return entry ? entry.games : null;
}

/**
 * Update memory maps (used by background refresh).
 */
export function updateSyncPreview(gameKey: string, entry: PreviewEntry) {
    PREVIEW_MAP.set(gameKey, entry);
}

export function updateSyncRoundUi(tournamentKey: string, roundNum: number, games: any[]) {
    ROUND_UI_MAP.set(`${tournamentKey}:${roundNum}`, {
        games,
        savedAt: Date.now()
    });
}

/**
 * Loads a combined object of preview and round data from AsyncStorage.
 * Used for prewarming before navigation.
 */
export async function getPrewarmBundle(tournamentKey: string, roundNum: number) {
    const previewKey = `${PREVIEW_PREFIX}${tournamentKey}:${roundNum}`;
    const roundKey = `${ROUND_UI_PREFIX}${tournamentKey}:${roundNum}`;

    const [previewRaw, roundRaw] = await Promise.all([
        AsyncStorage.getItem(previewKey),
        AsyncStorage.getItem(roundKey)
    ]);

    const bundle: Record<string, { previewFen: string; lastMove?: string; result?: string; updatedAt: number }> = {};

    if (previewRaw) {
        try {
            const data = JSON.parse(previewRaw);
            Object.keys(data).forEach(gameKey => {
                const entry = data[gameKey];
                if (entry && entry.previewFen) {
                    bundle[gameKey] = {
                        previewFen: entry.previewFen,
                        lastMove: entry.lastMove,
                        updatedAt: entry.updatedAt || Date.now()
                    };
                }
            });
        } catch (e) {
            console.warn(`[MemoryCache] Failed to parse preview for R${roundNum}`, e);
        }
    }

    if (roundRaw) {
        try {
            const data = JSON.parse(roundRaw);
            if (data && data.games) {
                data.games.forEach((g: any) => {
                    // Try to generate a key for mapping results back
                    // We need a stable key generator similar to the one used in TournamentBoardsScreen
                    const w = g.whiteName ? g.whiteName.toLowerCase().replace(/[.,-\s]+/g, '') : 'white';
                    const b = g.blackName ? g.blackName.toLowerCase().replace(/[.,-\s]+/g, '') : 'black';
                    const gameKey = (g as any).lichessGameId || g.gameId || `${roundNum}-${w}-${b}`;

                    if (bundle[gameKey]) {
                        bundle[gameKey].result = g.whiteResult && g.blackResult ? `${g.whiteResult}-${g.blackResult}` : undefined;
                    } else if (g.whiteResult && g.blackResult) {
                        bundle[gameKey] = {
                            previewFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // fallback
                            result: `${g.whiteResult}-${g.blackResult}`,
                            updatedAt: Date.now()
                        } as any;
                    }
                });
            }
        } catch (e) {
            console.warn(`[MemoryCache] Failed to parse round UI for R${roundNum}`, e);
        }
    }

    return bundle;
}

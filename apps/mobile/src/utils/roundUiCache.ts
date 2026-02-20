import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameSummary } from '@chessview/core';

const CACHE_PREFIX = 'ROUND_UI_CACHE';

// Module-level cache for synchronous access
const MEMORY_CACHE: Record<string, CachedGame[]> = {};

// Minimal fields needed for instant render
// Define manually to avoid Pick<> issues with optional/missing fields like 'status'
interface CachedGame {
    gameId: string;
    whiteName: string;
    blackName: string;
    whiteRating?: number | string;
    blackRating?: number | string;
    whiteResult?: string;
    blackResult?: string;
    lastMove?: string;
    whiteFederation?: string;
    blackFederation?: string;

    // Extra fields usually not in core GameSummary or optional
    status?: string | number; // sometimes number in some typed definitions, usually string
    previewFen?: string;
    previewLastMove?: string;
    isLive?: boolean;
}

interface RoundCacheData {
    savedAt: number;
    games: CachedGame[];
}


/**
 * Synchronous memory access for instant rendering.
 * Must be pre-warmed using `preloadRoundUiCache` or `getRoundUiCache`.
 */
export function getRoundUiCacheSync(tournamentSlug: string, roundNum: number): CachedGame[] | null {
    const key = `${tournamentSlug}:${roundNum}`;
    return MEMORY_CACHE[key] || null;
}

/**
 * Pre-warm the memory cache from disk.
 * Fire-and-forget this on app start or list screen.
 */
export async function preloadRoundUiCache(tournamentSlug: string, roundNum: number) {
    try {
        const key = `${CACHE_PREFIX}:${tournamentSlug}:${roundNum}`;
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
            const data: RoundCacheData = JSON.parse(raw);
            const memKey = `${tournamentSlug}:${roundNum}`;
            MEMORY_CACHE[memKey] = data.games;
            // if (__DEV__) console.log(`[RoundUiCache] Preloaded R${roundNum} into memory`);
        }
    } catch (e) {
        // silent fail
    }
}

export async function getRoundUiCache(tournamentSlug: string, roundNum: number): Promise<CachedGame[] | null> {
    const memKey = `${tournamentSlug}:${roundNum}`;
    if (MEMORY_CACHE[memKey]) return MEMORY_CACHE[memKey];

    try {
        const key = `${CACHE_PREFIX}:${tournamentSlug}:${roundNum}`;
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return null;

        const data: RoundCacheData = JSON.parse(raw);
        MEMORY_CACHE[memKey] = data.games; // Populate memory on read
        return data.games;
    } catch (e) {
        console.warn('[RoundUiCache] Read failed', e);
        return null;
    }
}

export async function saveRoundUiCache(tournamentSlug: string, roundNum: number, games: GameSummary[]) {
    try {
        const key = `${CACHE_PREFIX}:${tournamentSlug}:${roundNum}`;

        // Minimize data size
        const minimalGames: CachedGame[] = games.map(g => ({
            gameId: g.gameId,
            whiteName: g.whiteName,
            blackName: g.blackName,
            whiteRating: g.whiteRating,
            blackRating: g.blackRating,
            whiteResult: g.whiteResult,
            blackResult: g.blackResult,
            lastMove: g.lastMove,
            whiteFederation: g.whiteFederation,
            blackFederation: g.blackFederation,

            status: (g as any).status,
            previewFen: (g as any).previewFen,
            previewLastMove: (g as any).previewLastMove,
            isLive: g.isLive
        }));

        const data: RoundCacheData = {
            savedAt: Date.now(),
            games: minimalGames
        };

        // 1. Update Memory Immediately
        const memKey = `${tournamentSlug}:${roundNum}`;
        MEMORY_CACHE[memKey] = minimalGames;

        // 2. Persist Async
        await AsyncStorage.setItem(key, JSON.stringify(data));
        if (__DEV__) console.log(`[RoundUiCache] Saved ${minimalGames.length} games for R${roundNum}`);
    } catch (e) {
        console.warn('[RoundUiCache] Save failed', e);
    }
}

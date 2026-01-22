import { useState, useEffect, useCallback, useRef } from 'react';
import { getTournamentGames, type GameSummary } from '@chessview/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTataSteelGames, TATA_STEEL_2026_SLUG } from '../services/tataSteel';

const CACHE_KEY_PREFIX = 'tournament_games_cache_';

// MODULE-LEVEL MEMORY CACHE (Synchronous access)
const MEMORY_CACHE: Record<string, GameSummary[]> = {};

/**
 * Prefetch tournament data into memory cache.
 * 1. Load from Disk -> Memory (for instant load later)
 * 2. Fetch from Network -> Memory + Disk (silent update)
 */
export async function prefetchTournament(slug: string) {
    if (__DEV__) console.log(`[Prefetch] Starting for ${slug}`);

    // 1. Load from Disk if not in memory
    if (!MEMORY_CACHE[slug]) {
        try {
            const cacheKey = getCacheKey(slug);
            const cached = await AsyncStorage.getItem(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                MEMORY_CACHE[slug] = data;
                if (__DEV__) console.log(`[Prefetch] Loaded ${data.length} games from DISK into MEMORY`);
            }
        } catch (e) {
            console.warn('[Prefetch] Disk load failed', e);
        }
    }

    // 2. Network Fetch (Fire and forget from caller perspective, but we await here)
    if (slug === TATA_STEEL_2026_SLUG || slug === 'tata-steel-2026') {
        try {
            const freshGames = await fetchTataSteelGames();
            if (freshGames.length > 0) {
                MEMORY_CACHE[slug] = freshGames;
                await AsyncStorage.setItem(getCacheKey(slug), JSON.stringify(freshGames));
                if (__DEV__) console.log(`[Prefetch] Network update complete: ${freshGames.length} games`);
            }
        } catch (e) {
            console.warn('[Prefetch] Network fetch failed', e);
        }
    }
}


export function getCacheKey(slug: string) {
    // FORCE CACHE INVALIDATION: specific key v3
    // We strictly use the Tata Steel slug logic for now
    if (slug === TATA_STEEL_2026_SLUG || slug === 'tata-steel-2026') {
        return CACHE_KEY_PREFIX + TATA_STEEL_2026_SLUG + '_v3';
    }
    return CACHE_KEY_PREFIX + slug;
}

/**
 * Access the memory cache synchronously.
 * Useful for determining initial state before navigation.
 */
export function getCachedGames(slug: string): GameSummary[] {
    return MEMORY_CACHE[slug] || [];
}

export function usePollTournamentGames(tournamentSlug: string, pollIntervalMs = 15000) {
    const isTataSteel2026 = tournamentSlug === TATA_STEEL_2026_SLUG || tournamentSlug === 'tata-steel-2026';
    const initStart = useRef(performance.now());

    // 1. Initial State: Synchornous from Memory Cache
    const [games, setGames] = useState<GameSummary[]>(() => {
        if (MEMORY_CACHE[tournamentSlug]) {
            if (__DEV__) console.log(`[usePoll] Instant Render from MEMORY: ${MEMORY_CACHE[tournamentSlug].length} games. Time: ${(performance.now() - initStart.current).toFixed(1)}ms`);
            return MEMORY_CACHE[tournamentSlug];
        }
        // Fallback for sync mock or empty
        return isTataSteel2026 ? [] : getTournamentGames(tournamentSlug);
    });

    // START HYDRATION TRACKING
    // If we have games in memory (or it's not Tata Steel), we are effectively hydrated.
    // Otherwise, we are waiting for disk.
    const [isHydrated, setIsHydrated] = useState<boolean>(() => {
        if (!isTataSteel2026) return true; // Legacy/Mock behavior
        if (MEMORY_CACHE[tournamentSlug] && MEMORY_CACHE[tournamentSlug].length > 0) return true; // Already in memory
        return false; // Waiting for disk
    });

    const [isRefreshing, setIsRefreshing] = useState(false);
    const mountedRef = useRef(true);

    // 2. Hydrate from Disk (if memory was empty)
    useEffect(() => {
        if (isTataSteel2026 && games.length === 0 && !isHydrated) {
            const hydrate = async () => {
                const cacheKey = getCacheKey(tournamentSlug);
                const cached = await AsyncStorage.getItem(cacheKey);

                if (mountedRef.current) {
                    if (cached) {
                        const data = JSON.parse(cached);
                        MEMORY_CACHE[tournamentSlug] = data;
                        setGames(data);
                        if (__DEV__) console.log(`[usePoll] Hydrated from DISK: ${data.length} games`);
                    } else {
                        if (__DEV__) console.log(`[usePoll] Hydration complete (no data on disk)`);
                    }
                    setIsHydrated(true); // Hydration attempt finished
                }
            };
            hydrate();
        } else if (isTataSteel2026 && games.length > 0 && !isHydrated) {
            // Safety: if games appeared from elsewhere (e.g. network race), marks as hydrated
            setIsHydrated(true);
        }
    }, [tournamentSlug, isTataSteel2026, isHydrated, games.length]);

    // 3. Polling / Fetching
    const fetchData = useCallback(async (isManualRefresh = false) => {
        if (isTataSteel2026) {
            try {
                if (isManualRefresh) setIsRefreshing(true);

                const freshGames = await fetchTataSteelGames();

                if (freshGames.length > 0) {
                    // Update Memory
                    MEMORY_CACHE[tournamentSlug] = freshGames;

                    // Update State (if mounted)
                    if (mountedRef.current) {
                        setGames(freshGames);
                        setIsHydrated(true); // Network data definitely means hydrated
                    }

                    // Update Disk
                    const cacheKey = getCacheKey(tournamentSlug);
                    AsyncStorage.setItem(cacheKey, JSON.stringify(freshGames));

                    if (__DEV__ && isTataSteel2026) {
                        console.log(`[usePoll] Silent update: ${freshGames.length} games`);
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch Tata Steel games', e);
            } finally {
                if (mountedRef.current && isManualRefresh) setIsRefreshing(false);
            }
        } else {
            // Mock Logic
            const freshGames = getTournamentGames(tournamentSlug);
            if (mountedRef.current) {
                setGames(freshGames);
                setIsHydrated(true);
            }
            if (isManualRefresh && mountedRef.current) setIsRefreshing(false);
        }
    }, [tournamentSlug, isTataSteel2026]);

    useEffect(() => {
        mountedRef.current = true;
        // Trigger fetch immediately (silent cache-revalidation)
        fetchData(false);

        const interval = setInterval(() => {
            fetchData(false);
        }, pollIntervalMs);

        return () => {
            mountedRef.current = false;
            clearInterval(interval);
        };
    }, [fetchData, pollIntervalMs]);

    // Manual refresh
    const refresh = useCallback(async () => {
        await fetchData(true);
    }, [fetchData]);

    return { games, refresh, isRefreshing, isHydrated };
}

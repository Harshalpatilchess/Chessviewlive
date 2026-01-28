import { useState, useEffect, useCallback, useRef } from 'react';
import { getTournamentGames, type GameSummary } from '@chessview/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTataSteelGames, TATA_STEEL_2026_SLUG, loadArchivePgnOnce, getCacheKey } from '../services/tataSteel';
import { savePreviewCache } from '../utils/previewCache';

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

/**
 * Access the memory cache synchronously.
 * Useful for determining initial state before navigation.
 */
export function getCachedGames(slug: string): GameSummary[] {
    return MEMORY_CACHE[slug] || [];
}

// ... imports
import { useFocusEffect } from '@react-navigation/native';
import { FetchOptions } from '../services/tataSteel';

// HELPER: Generate stable key for game matching
function getGameKey(g: GameSummary): string {
    if ((g as any).lichessGameId) return (g as any).lichessGameId;
    if (g.gameId) return g.gameId;
    const r = g.round ?? 'ur';
    // Simple normalization
    const w = g.whiteName ? g.whiteName.toLowerCase().replace(/[.,-\s]+/g, '') : 'white';
    const b = g.blackName ? g.blackName.toLowerCase().replace(/[.,-\s]+/g, '') : 'black';
    return `${r}-${w}-${b}`;
}

// HELPER: Preserve previewFen from existing games
function mergePreservingPreview(fresh: GameSummary[], existing: GameSummary[]): GameSummary[] {
    const existingMap = new Map(existing.map(g => [getGameKey(g), g]));
    return fresh.map(f => {
        const key = getGameKey(f);
        const e = existingMap.get(key);

        // [CLOCK TICKER] Preserve timestamp if game state hasn't changed.
        // If we overwrite with new 'now', the clock resets to base time (erasing the seconds ticked down).
        if (e && (e as any).clockCapturedAt && (e.fen === f.fen)) {
            (f as any).clockCapturedAt = (e as any).clockCapturedAt;
            // Trust that base seconds are also identical if FEN is identical
        }

        // If existing has previewFen and fresh doesn't, keep it
        if (e && (e as any).previewFen && !(f as any).previewFen) {
            // Preserve FEN
            const preserved = { ...f, previewFen: (e as any).previewFen };
            // Preserve Last Move if available
            if ((e as any).previewLastMove || e.lastMove) {
                (preserved as any).previewLastMove = (e as any).previewLastMove || e.lastMove;
                // If fresh doesn't have lastMove, use preserved
                if (!preserved.lastMove) {
                    preserved.lastMove = (preserved as any).previewLastMove;
                }
            }
            return preserved;
        }
        return f;
    });
}

// HELPER: Log state updates
function logGamesSet(
    source: string,
    games: GameSummary[],
    tournamentKey: string,
    roundNum?: number | string
) {
    const totalGames = games.length;
    let withPreviewCount = 0;
    let missingPreviewKeysCount = 0; // Games that exist but missing preview? Or purely count?
    // User asked: "missingPreviewKeysCount". Let's assume count of games WITHOUT previewFen.

    games.forEach(g => {
        if ((g as any).previewFen) withPreviewCount++;
    });
    missingPreviewKeysCount = totalGames - withPreviewCount;

    console.log(`[ROUND_GAMES_STATE_SET] tournamentKey=${tournamentKey} roundNum=${roundNum ?? 'ALL'} source=${source} totalGames=${totalGames} withPreviewCount=${withPreviewCount} missingPreviewKeysCount=${missingPreviewKeysCount}`);
}


// ... 

export function usePollTournamentGames(
    tournamentSlug: string,
    defaultPollIntervalMs = 15000,
    options?: FetchOptions & { enabled?: boolean; selectedRound?: number | null; pollingEnabled?: boolean } // Add pollingEnabled
) {
    const isTataSteel2026 = tournamentSlug === TATA_STEEL_2026_SLUG || tournamentSlug === 'tata-steel-2026';
    const initStart = useRef(performance.now());
    const [isActiveScreen, setIsActiveScreen] = useState(false);

    // Track focus for polling override
    useFocusEffect(
        useCallback(() => {
            setIsActiveScreen(true);
            return () => setIsActiveScreen(false);
        }, [])
    );

    // Dynamic Interval:
    // If Tata Steel + Screen Focused + (forced or live implied?) -> Fast Poll
    const pollIntervalMs = (isActiveScreen && options?.forcePrimary) ? 2000 : defaultPollIntervalMs;

    // ... (State initialization same as before)
    const [games, setGames] = useState<GameSummary[]>(() => {
        if (MEMORY_CACHE[tournamentSlug]) return MEMORY_CACHE[tournamentSlug];
        return isTataSteel2026 ? [] : getTournamentGames(tournamentSlug);
    });

    // ... (Hydration same as before) ...
    // START HYDRATION TRACKING
    const [isHydrated, setIsHydrated] = useState<boolean>(() => {
        if (!isTataSteel2026) return true;
        if (MEMORY_CACHE[tournamentSlug] && MEMORY_CACHE[tournamentSlug].length > 0) return true;
        return false;
    });
    const [isRefreshing, setIsRefreshing] = useState(false);
    const mountedRef = useRef(true);

    // ... (Hydration Effect same as before) ...
    const [loadedRounds, setLoadedRounds] = useState<Set<number>>(new Set());
    const [loadingRound, setLoadingRound] = useState<number | null>(null);
    const [failedRounds, setFailedRounds] = useState<Set<number>>(new Set());

    const inFlightRequests = useRef(new Set<number>());
    const failedRoundCooldowns = useRef(new Map<number, number>());

    // Track if we have performed the initial round selection
    // (This seems to be UI logic, but let's keep it clean in the hook if possible? 
    // Actually no, stick to data fetching here)

    // ... (Hydration Effect same as before) ...
    // 2. Hydrate from Disk
    useEffect(() => {
        if (isTataSteel2026 && games.length === 0 && !isHydrated) {
            const hydrate = async () => {
                const cacheKey = getCacheKey(tournamentSlug);
                try {
                    const cached = await AsyncStorage.getItem(cacheKey);
                    if (mountedRef.current) {
                        if (cached) {
                            const data = JSON.parse(cached);
                            MEMORY_CACHE[tournamentSlug] = data;
                            setGames(data);

                            // Initialize loaded rounds from cached data
                            const loaded = new Set<number>();
                            data.forEach((g: GameSummary) => {
                                if (g.round) {
                                    const r = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
                                    loaded.add(r);
                                }
                            });
                            setLoadedRounds(loaded);

                            logGamesSet('hydrate_disk', data, tournamentSlug);
                        }
                        setIsHydrated(true);
                    }
                } catch (e) {
                    if (mountedRef.current) setIsHydrated(true);
                }
            };
            hydrate();
        } else if (isTataSteel2026 && games.length > 0 && !isHydrated) {
            // Memory Hit logic: populate loadedRounds
            const loaded = new Set<number>();
            games.forEach((g: GameSummary) => {
                if (g.round) {
                    const r = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
                    loaded.add(r);
                }
            });
            setLoadedRounds(loaded);
            setIsHydrated(true);
        }
    }, [tournamentSlug, isTataSteel2026, isHydrated, games.length]);

    // 2.5 Archive PGN / Full Baseline Load
    useEffect(() => {
        if (isTataSteel2026) {
            // Fire and forget, but it will populate memory cache which we pick up next render or via shared memory ref
            loadArchivePgnOnce(tournamentSlug)
                .then(() => {
                    if (mountedRef.current) {
                        if (__DEV__) console.log('[PollHook] Archive ready, invalidating round cache');
                        setLoadedRounds(new Set());
                        // Force immediate refresh to pick up enriched data
                        fetchData(false);
                    }
                })
                .catch(err => console.warn('[ArchivePGN] Hook trigger failed', err));
        }
    }, [isTataSteel2026, tournamentSlug]);

    // 3. Polling
    const fetchData = useCallback(async (isManualRefresh = false, specificRound?: number) => {
        if (isTataSteel2026 && (options?.enabled !== false)) {
            // Log Trigger
            const triggerReason = isManualRefresh ? 'manual' : (specificRound ? 'ensure' : 'poll');
            if (__DEV__ && triggerReason !== 'poll') {
                console.log(`[ROUNDLOAD_TRIGGER] roundId=${specificRound ?? options?.selectedRound ?? 'ALL'} reason=${triggerReason}`);
            } else if (__DEV__ && triggerReason === 'poll') {
                // For poll, we might want to be quieter unless debug is needed, but user requested explicit logs
                // console.log ... (Actually let's keep it quiet or log special event if needed)
                // User asked: [ROUNDLOAD_TRIGGER] roundId=... reason=initial|poll|manual
                // Let's log if not prevented by upper logic
                console.log(`[ROUNDLOAD_TRIGGER] roundId=${specificRound ?? options?.selectedRound ?? 'ALL'} reason=${triggerReason}`);
            }

            try {
                if (isManualRefresh && !specificRound) setIsRefreshing(true);
                if (specificRound) setLoadingRound(specificRound);

                // Use selectedRound from options if specificRound not set, to optimize polling
                const effectiveRound = specificRound ?? options?.selectedRound;

                const fetchOpts = { ...options };
                // If manually refreshing, force primary check
                if (isManualRefresh) fetchOpts.forcePrimary = true;

                // Override onlyRound if specific request OR if we are optimized for selectedRound
                if (effectiveRound) fetchOpts.onlyRound = effectiveRound;

                const freshGames = await fetchTataSteelGames(fetchOpts);

                if (freshGames.length > 0 && mountedRef.current) {
                    // Success -> Clear cooldown
                    if (fetchOpts.onlyRound) {
                        failedRoundCooldowns.current.delete(fetchOpts.onlyRound);
                        setFailedRounds(prev => {
                            if (!prev.has(fetchOpts.onlyRound!)) return prev;
                            const next = new Set(prev);
                            next.delete(fetchOpts.onlyRound!);
                            return next;
                        });
                    }

                    // Handling Partial Updates vs Global Cache
                    if (fetchOpts.onlyRound) {
                        // MERGE STRATEGY:
                        // Update only the games in this round, keep others from memory?
                        const existing = MEMORY_CACHE[tournamentSlug] || [];
                        const others = existing.filter(g => {
                            const gr = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
                            return gr !== fetchOpts.onlyRound
                        });

                        // FIX: Preserve previewFen in freshGames before merging
                        const gamesInRound = existing.filter(g => {
                            const gr = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
                            return gr === fetchOpts.onlyRound
                        });
                        const freshWithPreview = mergePreservingPreview(freshGames, gamesInRound);

                        const merged = [...others, ...freshWithPreview];

                        // DEEP EQUALITY CHECK to prevent no-op updates
                        const prevJson = JSON.stringify(MEMORY_CACHE[tournamentSlug] || []);
                        const nextJson = JSON.stringify(merged);

                        if (prevJson !== nextJson) {
                            MEMORY_CACHE[tournamentSlug] = merged;
                            setGames(merged);
                            logGamesSet('poll_partial', merged, tournamentSlug, fetchOpts.onlyRound);
                            if (__DEV__) console.log(`[RoundLoad] done round=${fetchOpts.onlyRound} games=${freshGames.length} (UPDATED)`);

                            // SAVE CACHE: Persist the preview FENs for this round
                            savePreviewCache(tournamentSlug, fetchOpts.onlyRound!, freshGames);

                        } else {
                            if (__DEV__) console.log(`[RoundLoad] done round=${fetchOpts.onlyRound} games=${freshGames.length} (NO_CHANGE)`);
                        }

                        // Mark as loaded
                        setLoadedRounds(prev => {
                            const next = new Set(prev);
                            next.add(fetchOpts.onlyRound!);
                            return next;
                        });

                    } else {
                        // Full Update

                        // FIX: Preserve previewFen
                        const existing = MEMORY_CACHE[tournamentSlug] || [];
                        const freshWithPreview = mergePreservingPreview(freshGames, existing);

                        const prevJson = JSON.stringify(MEMORY_CACHE[tournamentSlug] || []);
                        const nextJson = JSON.stringify(freshWithPreview);

                        if (prevJson !== nextJson) {
                            MEMORY_CACHE[tournamentSlug] = freshWithPreview;
                            setGames(freshWithPreview);
                            AsyncStorage.setItem(getCacheKey(tournamentSlug), JSON.stringify(freshWithPreview));
                            logGamesSet('poll_full', freshWithPreview, tournamentSlug);
                            if (fetchOpts.onlyRound) {
                                savePreviewCache(tournamentSlug, fetchOpts.onlyRound, freshGames);
                            }
                            if (__DEV__) console.log(`[RoundLoad] done ALL games=${freshGames.length} (UPDATED)`);

                        } else {
                            if (__DEV__) console.log(`[RoundLoad] done ALL games=${freshGames.length} (NO_CHANGE)`);
                        }

                        // Re-calc all loaded
                        const loaded = new Set<number>();
                        freshGames.forEach((g: GameSummary) => {
                            if (g.round) {
                                const r = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
                                loaded.add(r);
                            }
                        });
                        setLoadedRounds(loaded);
                    }

                    if (!isHydrated) setIsHydrated(true);
                } else if (specificRound && mountedRef.current) {
                    // 0 games found (maybe not started?)
                    if (__DEV__) console.log(`[RoundLoad] done round=${specificRound} games=0 - NOT caching empty result`);

                    // Set Cooldown
                    const COOLDOWN_MS = 15000;
                    failedRoundCooldowns.current.set(specificRound, Date.now() + COOLDOWN_MS);
                    console.log(`[RoundLoad] round=${specificRound} failed -> Cooldown ${COOLDOWN_MS}ms`);

                    setFailedRounds(prev => new Set(prev).add(specificRound));
                }
            } catch (e) {
                console.warn('Fetch failed', e);
            } finally {
                if (mountedRef.current) {
                    if (isManualRefresh) setIsRefreshing(false);
                    if (specificRound) setLoadingRound(null);
                }
            }
        } else if (!isTataSteel2026) {
            // Mock
            setGames(getTournamentGames(tournamentSlug));
            setIsHydrated(true);
            if (isManualRefresh) setIsRefreshing(false);
        }
    }, [tournamentSlug, isTataSteel2026, options]); // dependency on options including pollingEnabled

    useEffect(() => {
        mountedRef.current = true;

        // Perform Initial Fetch regardless of polling status (unless disabled completely)
        // But if we just want "pollingEnabled" to control interval, we separate logic.
        // Actually, if pollingEnabled=false, we might still want to load ONCE?
        // The options.enabled flag (renamed handling) usually controlled "load at all".
        // Let's assume options.enabled means "Can load at all", and options.pollingEnabled means "Should continue polling".

        // Initial Fetch (One-off)
        fetchData(false);

        // Polling Interval
        let interval: NodeJS.Timeout | null = null;

        // Only start polling if explicitly enabled (default to true if undefined for backward compat, or controlled by options)
        const shouldPoll = options?.pollingEnabled !== false;

        if (shouldPoll) {
            if (__DEV__) console.log(`[ROUND_POLL_START] roundId=${options?.selectedRound} intervalMs=${pollIntervalMs} reason=${isActiveScreen ? 'active' : 'background'}`);
            interval = setInterval(() => {
                fetchData(false);
            }, pollIntervalMs);
        } else {
            if (__DEV__) console.log(`[ROUND_POLL_STOP] roundId=${options?.selectedRound} reason=finished_or_disabled`);
        }

        return () => {
            mountedRef.current = false;
            if (interval) {
                clearInterval(interval);
                if (shouldPoll && __DEV__) console.log(`[ROUND_POLL_STOP_CLEANUP] roundId=${options?.selectedRound}`);
            }
        };
    }, [fetchData, pollIntervalMs, options?.pollingEnabled]); // Re-run if polling status changes

    const refresh = useCallback(async () => {
        await fetchData(true);
    }, [fetchData]);


    const ensureRoundLoaded = useCallback((round: number) => {
        if (!isTataSteel2026) return;

        // 1. Check if already loaded
        if (loadedRounds.has(round)) {
            // SILENT return to avoid spam
            // if (__DEV__) console.log(`[RoundLoad] request round=${round} cached=true`);
            return;
        }

        // 2. Check if games exist (redundancy) or if InFlight
        if (inFlightRequests.current.has(round)) return;

        // Stabilize: Check actual games array to avoid excessive setLoadedRounds calls if we missed a sync
        const hasGames = games.some(g => {
            const gr = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
            return gr === round;
        });

        if (hasGames) {
            setLoadedRounds(prev => {
                if (prev.has(round)) return prev;
                return new Set(prev).add(round);
            });
            return;
        }

        // 3. Cooldown Guard
        const cooldown = failedRoundCooldowns.current.get(round);
        if (cooldown && Date.now() < cooldown) {
            // if (__DEV__) console.log(`[RoundLoad] request round=${round} throttled`);
            return;
        }

        // 4. Fetch
        inFlightRequests.current.add(round);
        if (__DEV__) console.log(`[RoundLoad] request round=${round} inFlight=${inFlightRequests.current.size} cached=false`);

        fetchData(false, round).finally(() => {
            if (mountedRef.current) {
                inFlightRequests.current.delete(round);
            }
        });
    }, [isTataSteel2026, loadedRounds, games, fetchData]);

    return { games, refresh, isRefreshing, isHydrated, ensureRoundLoaded, loadingRound, failedRounds };
}

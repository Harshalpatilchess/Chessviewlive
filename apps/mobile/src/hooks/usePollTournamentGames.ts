import { useState, useEffect, useCallback, useRef } from 'react';
import { getTournamentGames, type GameSummary } from '@chessview/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTataSteelGames, TATA_STEEL_2026_SLUG } from '../services/tataSteel';

const CACHE_KEY_PREFIX = 'tournament_games_cache_';

export function usePollTournamentGames(tournamentSlug: string, pollIntervalMs = 15000) {
    const isTataSteel2026 = tournamentSlug === TATA_STEEL_2026_SLUG || tournamentSlug === 'tata-steel-2026';

    // Initial state: try to load from sync mock (legacy) or empty for async
    const [games, setGames] = useState<GameSummary[]>(() => {
        if (isTataSteel2026) {
            return []; // Will load from cache/fetch
        }
        return getTournamentGames(tournamentSlug);
    });

    const [isRefreshing, setIsRefreshing] = useState(false);
    const mountedRef = useRef(true);

    // Load cache for async tournaments immediately on mount
    useEffect(() => {
        if (isTataSteel2026) {
            const loadCache = async () => {
                try {
                    // FORCE CACHE INVALIDATION: specific key v3
                    const specificKey = CACHE_KEY_PREFIX + TATA_STEEL_2026_SLUG + '_v3';
                    const cached = await AsyncStorage.getItem(specificKey);
                    if (cached && mountedRef.current) {
                        setGames(JSON.parse(cached));
                    }
                } catch (e) {
                    console.warn('Failed to load tournament cache', e);
                }
            };
            loadCache();
        }
    }, [tournamentSlug, isTataSteel2026]);

    const fetchData = useCallback(async () => {
        if (isTataSteel2026) {
            try {
                const freshGames = await fetchTataSteelGames();
                if (__DEV__ && isTataSteel2026) {
                    console.log(`[usePollTournamentGames] Fetched ${freshGames.length} games`);
                }
                // Ensure list keys are stable (handled in service, but good to verify)
                if (freshGames.length > 0 && mountedRef.current) {
                    setGames(freshGames);
                    // FORCE CACHE INVALIDATION: specific key v3
                    const specificKey = CACHE_KEY_PREFIX + TATA_STEEL_2026_SLUG + '_v3';
                    AsyncStorage.setItem(specificKey, JSON.stringify(freshGames));
                }
            } catch (e) {
                console.warn('Failed to fetch Tata Steel games', e);
            }
        } else {
            // Existing sync mock logic
            const freshGames = getTournamentGames(tournamentSlug);
            if (mountedRef.current) {
                setGames(freshGames);
            }
        }
    }, [tournamentSlug, isTataSteel2026]);

    useEffect(() => {
        mountedRef.current = true;

        // Initial fetch
        fetchData();

        const interval = setInterval(() => {
            fetchData();
        }, pollIntervalMs);

        return () => {
            mountedRef.current = false;
            clearInterval(interval);
        };
    }, [fetchData, pollIntervalMs]);

    // Manual refresh (User Pull)
    const refresh = useCallback(async () => {
        if (!mountedRef.current) return;

        setIsRefreshing(true);

        if (isTataSteel2026) {
            await fetchData();
        } else {
            // Artificial delay for mock
            await new Promise(resolve => setTimeout(resolve, 800));
            const freshGames = getTournamentGames(tournamentSlug);
            if (mountedRef.current) {
                setGames(freshGames);
            }
        }

        if (mountedRef.current) {
            setIsRefreshing(false);
        }
    }, [tournamentSlug, fetchData, isTataSteel2026]);

    return { games, refresh, isRefreshing };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWebApiBaseUrl } from '../config/apiConfig';

const DISCOVERY_CACHE_KEY = 'discovery_live_cache_v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

export type DiscoveryRound = {
    id: string;
    slug: string;
    name: string;
};

export type DiscoveryItem = {
    tournament: {
        slug: string;
        name: string;
    };
    current: {
        kind: 'live';
        round: DiscoveryRound;
    };
};

export type DiscoveryResponse = {
    source: 'discovery';
    fetchedAt?: string;
    items: DiscoveryItem[];
    error: string | null;
};

type CachedDiscovery = {
    items: DiscoveryItem[];
    cachedAt: number;
};

/**
 * Fetch live broadcasts from the web discovery API
 * @param forceRefresh If true, bypass cache and always fetch from network
 */
export const fetchLiveBroadcasts = async (forceRefresh: boolean = false): Promise<DiscoveryItem[]> => {
    const baseUrl = getWebApiBaseUrl();

    if (!baseUrl) {
        if (__DEV__) {
            console.warn('[DiscoveryService] No API base URL configured. Set EXPO_PUBLIC_WEB_BASE_URL.');
        }
        return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(`${baseUrl}/api/discovery/live`, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            if (__DEV__) {
                console.warn(`[DiscoveryService] API returned ${response.status}`);
            }
            return [];
        }

        const data: DiscoveryResponse = await response.json();

        if (!data || !Array.isArray(data.items)) {
            if (__DEV__) {
                console.warn('[DiscoveryService] Invalid response format');
            }
            return [];
        }

        return data.items;
    } catch (error) {
        if (__DEV__) {
            const errorName = error instanceof Error ? error.name : 'Unknown';
            console.warn(`[DiscoveryService] Fetch failed: ${errorName}`);
        }
        return [];
    } finally {
        clearTimeout(timeoutId);
    }
};

/**
 * Save live broadcasts to AsyncStorage cache
 */
export const saveLiveCache = async (items: DiscoveryItem[]): Promise<void> => {
    try {
        const cached: CachedDiscovery = {
            items,
            cachedAt: Date.now(),
        };
        await AsyncStorage.setItem(DISCOVERY_CACHE_KEY, JSON.stringify(cached));
    } catch (error) {
        if (__DEV__) {
            console.warn('[DiscoveryService] Failed to save cache', error);
        }
    }
};

/**
 * Load live broadcasts from AsyncStorage cache
 * Returns cached items if fresh (within TTL), otherwise returns empty array
 */
export const loadLiveCache = async (): Promise<DiscoveryItem[]> => {
    try {
        const json = await AsyncStorage.getItem(DISCOVERY_CACHE_KEY);
        if (!json) return [];

        const cached: CachedDiscovery = JSON.parse(json);
        const age = Date.now() - cached.cachedAt;

        if (age < CACHE_TTL_MS && Array.isArray(cached.items)) {
            return cached.items;
        }

        return [];
    } catch (error) {
        if (__DEV__) {
            console.warn('[DiscoveryService] Failed to load cache', error);
        }
        return [];
    }
};

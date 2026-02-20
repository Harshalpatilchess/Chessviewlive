import type { CloudEngineLine, CloudEngineResponse } from '../types/engine';

interface EngineCacheEntry {
    payload: CloudEngineResponse;
    fetchedAt: number;
}

const CACHE_TTL_MS = 60000; // 1 minute cache for mobile session
const MAX_ENTRIES = 50;

class EngineCacheService {
    private cache = new Map<string, EngineCacheEntry>();

    get(fen: string): CloudEngineResponse | null {
        const key = this.normalizeFen(fen);
        const entry = this.cache.get(key);

        if (!entry) return null;

        const age = Date.now() - entry.fetchedAt;
        if (age > CACHE_TTL_MS) {
            this.cache.delete(key);
            return null;
        }

        return entry.payload;
    }

    set(fen: string, payload: CloudEngineResponse) {
        const key = this.normalizeFen(fen);

        // Prune if too large
        if (this.cache.size >= MAX_ENTRIES) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            payload,
            fetchedAt: Date.now(),
        });
    }

    private normalizeFen(fen: string): string {
        return fen.trim();
    }
}

export const engineCache = new EngineCacheService();

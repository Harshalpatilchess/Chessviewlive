import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PreviewEntry {
    previewFen: string;
    lastMove?: string;
    result?: string;
    updatedAt: number;
}

export type PreviewMap = Record<string, PreviewEntry>;

const CACHE_KEY_PREFIX = 'preview:tournament:';
const ROUND_KEY_PREFIX = 'previewFenByRound:';

export function getPreviewCacheKey(slug: string): string {
    return `${CACHE_KEY_PREFIX}${slug}`;
}

export function getRoundPreviewKey(roundId: string): string {
    return `${ROUND_KEY_PREFIX}${roundId}`;
}

/**
 * Loads the preview map for a tournament from persistent storage.
 * Normalizes legacy data shapes if encountered.
 */
export async function loadTournamentPreview(slug: string): Promise<PreviewMap | null> {
    try {
        const key = getPreviewCacheKey(slug);
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return null;

        return parsePreviewMap(raw);
    } catch (e) {
        console.warn(`[PreviewStore] Failed to load preview for ${slug}`, e);
        return null;
    }
}

/**
 * Loads preview map for a specific round ID.
 */
export async function loadRoundPreview(roundId: string): Promise<PreviewMap | null> {
    try {
        const key = getRoundPreviewKey(roundId);
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return null;
        return parsePreviewMap(raw);
    } catch (e) {
        console.warn(`[PreviewStore] Failed to load round preview ${roundId}`, e);
        return null;
    }
}

function parsePreviewMap(raw: string): PreviewMap {
    try {
        const data = JSON.parse(raw);
        const normalized: PreviewMap = {};

        Object.keys(data).forEach(gameKey => {
            const entry = data[gameKey];
            if (!entry) return;

            // Normalize shapes
            // Priority: previewFen > fen > finalFen > boardFen > preview_fen
            const previewFen = entry.previewFen || entry.fen || entry.finalFen || entry.boardFen || entry.preview_fen;

            if (previewFen) {
                normalized[gameKey] = {
                    previewFen,
                    lastMove: entry.lastMove,
                    result: entry.result,
                    updatedAt: entry.updatedAt || Date.now()
                };
            }
        });
        return normalized;
    } catch (e) {
        return {};
    }
}

/**
 * Saves the preview map for a tournament to persistent storage.
 */
export async function saveTournamentPreview(slug: string, map: PreviewMap): Promise<void> {
    try {
        const key = getPreviewCacheKey(slug);
        await AsyncStorage.setItem(key, JSON.stringify(map));
    } catch (e) {
        console.warn(`[PreviewStore] Failed to save preview for ${slug}`, e);
    }
}

/**
 * Saves the preview map for a round to persistent storage.
 */
export async function saveRoundPreview(roundId: string, map: PreviewMap): Promise<void> {
    try {
        const key = getRoundPreviewKey(roundId);
        await AsyncStorage.setItem(key, JSON.stringify(map));
    } catch (e) {
        console.warn(`[PreviewStore] Failed to save round preview ${roundId}`, e);
    }
}

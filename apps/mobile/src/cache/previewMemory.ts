import { PreviewMap, loadTournamentPreview, loadRoundPreview } from './previewStore';

// Singleton in-memory cache
const MEMORY_CACHE = new Map<string, PreviewMap>();

export const previewMemory = {
    /**
     * Check if we have preview data for this tournament in memory.
     */
    has(slug: string): boolean {
        return MEMORY_CACHE.has(slug);
    },

    /**
     * Get the preview map synchronously.
     */
    get(slug: string): PreviewMap | undefined {
        return MEMORY_CACHE.get(slug);
    },

    /**
     * Set the preview map in memory.
     */
    set(slug: string, map: PreviewMap) {
        MEMORY_CACHE.set(slug, map);
    },

    /**
     * Ensures preview data is in memory. Loads from disk if missing.
     * Call this before navigation.
     */
    async ensurePreviewInMemory(slug: string): Promise<void> {
        if (MEMORY_CACHE.has(slug)) return;

        console.log(`[PreviewMemory] Loading ${slug} from disk...`);
        const fromDisk = await loadTournamentPreview(slug);
        if (fromDisk) {
            MEMORY_CACHE.set(slug, fromDisk);
            console.log(`[PreviewMemory] Loaded ${Object.keys(fromDisk).length} items for ${slug}`);
        } else {
            // Initialize empty if nothing on disk, to prevent repeated disk hits
            MEMORY_CACHE.set(slug, {});
            console.log(`[PreviewMemory] No data on disk for ${slug}, initialized empty.`);
        }
    },

    async ensureRoundPreviewInMemory(roundId: string): Promise<void> {
        const key = `previewFenByRound:${roundId}`;
        if (MEMORY_CACHE.has(key)) return;

        // console.log(`[PreviewMemory] Loading Round ${roundId} from disk...`);
        const fromDisk = await loadRoundPreview(roundId);
        if (fromDisk) {
            MEMORY_CACHE.set(key, fromDisk);
            // console.log(`[PreviewMemory] Loaded ${Object.keys(fromDisk).length} items for Round ${roundId}`);
        } else {
            MEMORY_CACHE.set(key, {});
        }
    }
};

// Legacy support if needed, but new code should use imports
export const getTournamentPreview = previewMemory.get;
export const setTournamentPreview = previewMemory.set;

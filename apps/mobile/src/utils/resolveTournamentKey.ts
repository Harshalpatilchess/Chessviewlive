import { TATA_STEEL_2026_SLUG } from '../services/tataSteel';

/**
 * Resolves the canonical tournament key for caching and lookups.
 * Ensures that 'tata-steel-2026' and 'tata-steel-masters-2026' always resolve to the canonical slug.
 * 
 * Priority: 
 * 1. Explicit params override (if any)
 * 2. TATA_STEEL_2026_SLUG constant if matching ANY known alias
 * 3. Fallback to passed slug
 */
export function resolveTournamentKey(params: any): string {
    const raw = params?.tournamentSlug || params?.slug || params?.tournamentKey;

    if (!raw) return 'unknown';

    // Canonicalize Tata Steel
    if (raw === 'tata-steel-2026' || raw === 'tata-steel-masters-2026' || raw.includes('tata-steel')) {
        return TATA_STEEL_2026_SLUG;
    }

    return raw;
}

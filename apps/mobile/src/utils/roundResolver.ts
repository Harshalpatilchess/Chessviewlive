import { fetchBroadcastTournament } from '../services/lichessBroadcast';
import { LICHESS_MASTERS_BROADCAST_ID, TATA_STEEL_2026_SLUG } from '../services/tataSteel';

// In-memory cache: broadcastId -> roundNum -> roundId
const ROUND_ID_CACHE: Record<string, Record<number, string>> = {};

// Promise cache to dedupe inflight requests
const PENDING_RESOLVES: Record<string, Promise<any>> = {};

const LOGGED_KEYS = new Set<string>();

function extractRoundNumber(name: string, slug?: string): number {
    const m = name.match(/Round\s+(\d+)/i);
    if (m) return parseInt(m[1], 10);
    if (slug) {
        const sm = slug.match(/(\d+)/);
        if (sm) return parseInt(sm[1], 10);
    }
    return 0;
}

function logOneTimeSuccess(tKey: string, round: number, bId: string, rId: string, ms: string) {
    const key = `OK:${tKey}:${round}`;
    if (!LOGGED_KEYS.has(key)) {
        LOGGED_KEYS.add(key);
        console.log(`[ROUNDID_RESOLVED] tKey=${tKey} round=${round} broadcastId=${bId} roundId=${rId} ms=${ms}ms`);
    }
}

function logOneTimeFail(tKey: string, round: number, bId: string, reason: string) {
    const key = `FAIL:${tKey}:${round}`;
    if (!LOGGED_KEYS.has(key)) {
        LOGGED_KEYS.add(key);
        console.log(`[ROUNDID_RESOLVE_FAIL] tKey=${tKey} round=${round} broadcastId=${bId} reason=${reason}`);
    }
}

export async function resolveRoundId(
    tournamentSlug: string,
    roundNum: number,
    forceRefresh = false
): Promise<string | null> {
    const start = Date.now();

    // 1. Determine Broadcast ID
    // Heuristic: For Tata Steel we have a manual override constant.
    // For universal tournaments, we assume the slug passed IS the broadcast ID (or close enough for Lichess API).
    let broadcastId = tournamentSlug;
    if (tournamentSlug === TATA_STEEL_2026_SLUG || tournamentSlug.includes('tata-steel')) {
        broadcastId = LICHESS_MASTERS_BROADCAST_ID;
    }

    // 2. Check Cache
    if (!forceRefresh && ROUND_ID_CACHE[broadcastId]?.[roundNum]) {
        return ROUND_ID_CACHE[broadcastId][roundNum];
    }

    // 3. De-dupe fetch
    const cacheKey = broadcastId;
    if (!PENDING_RESOLVES[cacheKey]) {
        PENDING_RESOLVES[cacheKey] = (async () => {
            const data = await fetchBroadcastTournament(broadcastId);
            if (data && data.rounds) {
                if (!ROUND_ID_CACHE[broadcastId]) ROUND_ID_CACHE[broadcastId] = {};
                data.rounds.forEach((r: any) => {
                    const rNum = extractRoundNumber(r.name, r.slug);
                    // Allow r.id to be used
                    if (rNum > 0 && r.id) {
                        ROUND_ID_CACHE[broadcastId][rNum] = r.id;
                    }
                });
                return ROUND_ID_CACHE[broadcastId];
            }
            return null;
        })();
    }

    try {
        await PENDING_RESOLVES[cacheKey];
    } catch (e) {
        console.warn('[RoundResolver] Fetch failed', e);
    } finally {
        // Clear promise after short delay to allow retries later if failed, 
        // but keep it long enough to handle burst requests
        setTimeout(() => { delete PENDING_RESOLVES[cacheKey]; }, 5000);
    }

    const result = ROUND_ID_CACHE[broadcastId]?.[roundNum] || null;
    const elapsed = (Date.now() - start).toFixed(0);

    // 4. Log
    if (result) {
        logOneTimeSuccess(tournamentSlug, roundNum, broadcastId, result, elapsed);
    } else {
        logOneTimeFail(tournamentSlug, roundNum, broadcastId, 'not_found_in_rounds');
    }

    return result;
}

// Accessor to get all known rounds for a tournament (populates dropdowns etc)
export function getCachedRoundMap(tournamentSlug: string): Record<number, string> | null {
    let broadcastId = tournamentSlug;
    if (tournamentSlug === TATA_STEEL_2026_SLUG || tournamentSlug.includes('tata-steel')) {
        broadcastId = LICHESS_MASTERS_BROADCAST_ID;
    }
    return ROUND_ID_CACHE[broadcastId] || null;
}

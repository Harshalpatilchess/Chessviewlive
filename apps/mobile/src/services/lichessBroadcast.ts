import { GameSummary } from '@chessview/core';

export interface BroadcastRoundMeta {
    id: string; // "slug" or ID
    name: string; // "Round 1"
    slug: string;
    url: string;
    startsAt?: number; // timestamp
    finished?: boolean;
}

export interface BroadcastTournamentData {
    id: string;
    name: string;
    description: string;
    rounds: BroadcastRoundMeta[];
}

export interface BroadcastGame {
    id: string;
    white: { name: string; title?: string; rating?: number; fed?: string; };
    black: { name: string; title?: string; rating?: number; fed?: string; };
    fen: string;
    lastMove?: string;
    status: string; // "created", "started", "mate", "draw", "resign", "outtime"
    result?: string; // "1-0", "0-1", "1/2-1/2", "*"
    players: {
        white: { clock?: number; }; // centiseconds sometimes, or seconds? Usually Lichess API gives moves/clocks in stream, but round JSON gives specific struct.
        black: { clock?: number; };
    };
    moves: string; // PGN string or spacer-separated
}

// Lichess API Types
interface LichessBroadcastResponse {
    tournament: {
        id: string;
        name: string;
        slug: string;
        description: string;
    };
    rounds: Array<{
        id: string;
        name: string;
        slug: string;
        url: string;
        startsAt?: number;
        finished?: boolean;
    }>;
}

interface LichessRoundResponse {
    round: {
        id: string;
        name: string;
        slug: string;
        url: string;
        startsAt?: number;
        finished?: boolean;
    };
    study: {
        players: Array<{
            user: { name: string; title?: string; };
            rating?: number;
            role: 'white' | 'black';
        }>;
    };
    games: Array<{
        id: string;
        fen: string;
        lastMove?: string;
        status: string; // "started", "mate", "draw", ...
        players: {
            white: { user: { name: string; title?: string; }; rating?: number; fed?: string; clock?: number; };
            black: { user: { name: string; title?: string; }; rating?: number; fed?: string; clock?: number; };
        };
        winner?: 'white' | 'black';
        opening?: { name: string; eco: string; };
    }>;
    // Note: The specific per-game clock might require the stream endpoint or check if round JSON includes it.
    // Lichess Broadcast Round JSON (/-/-/{id}) often has 'games' array.
}

const LICHESS_API_BASE = 'https://lichess.org/api/broadcast';

// Request Deduplication Cache (TTL could be added, but per-session/short-lived is fine for now)
const BROADCAST_FETCH_CACHE = new Map<string, Promise<BroadcastTournamentData | null>>();

/**
 * Fetch Tournament Metadata (Rounds, Status)
 */
export async function fetchBroadcastTournament(broadcastId: string): Promise<BroadcastTournamentData | null> {
    if (BROADCAST_FETCH_CACHE.has(broadcastId)) {
        return BROADCAST_FETCH_CACHE.get(broadcastId)!;
    }

    const promise = (async () => {
        try {
            const url = `${LICHESS_API_BASE}/${broadcastId}`;
            if (__DEV__) console.log(`[LichessBroadcast] Fetching ${url}`);

            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!res.ok) {
                console.warn(`[LichessBroadcast] Fetch Tournament failed: ${res.status}`);
                return null;
            }

            const text = await res.text();
            let data: any;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.warn(`[LichessBroadcast] JSON Parse Error`, e);
                return null;
            }

            if (Array.isArray(data)) {
                console.warn(`[LichessBroadcast] Received array instead of object. Length: ${data.length}`);
                return null;
            }

            const tour = data.tour || data.tournament;
            if (!tour || !tour.id) {
                console.warn(`[LichessBroadcast] Missing tour/tournament.id in response. Keys: ${Object.keys(data).join(',')}`);
                return null;
            }

            const roundsRaw = data.rounds || [];
            const rounds = roundsRaw.map((r: any) => {
                let startsAtMs = r.startsAt;
                if (typeof startsAtMs === 'number' && startsAtMs < 100000000000) {
                    startsAtMs *= 1000;
                }
                return {
                    id: r.id,
                    name: r.name,
                    slug: r.slug,
                    url: r.url,
                    startsAt: startsAtMs,
                    finished: !!r.finished
                };
            });

            if (__DEV__) {
                const sample = rounds.length > 0
                    ? `R${extractRoundNumber(rounds[0].name)} start=${rounds[0].startsAt} fin=${rounds[0].finished}`
                    : 'No rounds';
                console.log(`[LB_SNAPSHOT_OK] tourId=${tour.id}, roundsLen=${rounds.length}, ${sample}`);
            }

            return {
                id: tour.id,
                name: tour.name,
                description: tour.description,
                rounds
            };
        } catch (e) {
            console.warn(`[LichessBroadcast] Error fetching tournament ${broadcastId}:`, e);
            return null;
        } finally {
            // Optional: Clear cache after some time?
            // For now, let's keep it to ensure stability within session.
            // Or render invalidation will re-fetch?
            // If we want updates, we need to clear it.
            // Let's clear it after 60 seconds?
            // setTimeout(() => BROADCAST_FETCH_CACHE.delete(broadcastId), 60000);
        }
    })();

    BROADCAST_FETCH_CACHE.set(broadcastId, promise);

    // Clear cache on failure to allow retry
    promise.then(res => {
        if (!res) BROADCAST_FETCH_CACHE.delete(broadcastId);
        else {
            // Basic TTL of 60s to allow refreshing status
            setTimeout(() => BROADCAST_FETCH_CACHE.delete(broadcastId), 60000);
        }
    });

    return promise;
}

/**
 * Fetch Games for a specific Round
 * Note: Lichess Broadcast Round API URL is typically /broadcast/-/-/{roundId} if we don't know the slug.
 * Or /api/broadcast/round/{roundId}.
 */
export async function fetchBroadcastRound(roundId: string): Promise<GameSummary[]> {
    try {
        // Use the direct round API endpoint if available, or the generic one
        // Check https://lichess.org/api#tag/Broadcasts
        // GET /api/broadcast/round/{id}
        const url = `${LICHESS_API_BASE}/round/${roundId}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
            console.warn(`[LichessBroadcast] Fetch Round failed: ${res.status}`);
            return [];
        }

        const data = await res.json() as LichessRoundResponse;

        if (!data.games) return [];

        return data.games.map(g => {
            const wName = g.players.white.user.name;
            const bName = g.players.black.user.name;
            const wTitle = g.players.white.user.title;
            const bTitle = g.players.black.user.title;

            // Map status/result
            let result = '*';
            let whiteResult = undefined;
            let blackResult = undefined;
            let isLive = false;

            if (['mate', 'resign', 'outtime', 'draw', 'stalemate', 'variantEnd'].includes(g.status)) {
                if (g.winner === 'white') { result = '1-0'; whiteResult = '1'; blackResult = '0'; }
                else if (g.winner === 'black') { result = '0-1'; whiteResult = '0'; blackResult = '1'; }
                else { result = '1/2-1/2'; whiteResult = '½'; blackResult = '½'; }
            } else if (g.status === 'started' || g.status === 'created') {
                isLive = g.status === 'started'; // created means not started yet
            }

            // Clocks
            // Lichess sends clocks in centiseconds usually in streams, but here?
            // Need to verify units. Usually JSON returns seconds or null.
            // If missing, we default to 0:00 or leave undefined.
            const wClock = formatLichessClock(g.players.white.clock);
            const bClock = formatLichessClock(g.players.black.clock);

            return {
                gameId: g.id,
                whiteName: wName,
                blackName: bName,
                whiteTitle: wTitle,
                blackTitle: bTitle,
                whiteRating: g.players.white.rating,
                blackRating: g.players.black.rating,
                // whiteFederation: g.players.white.fed, // Lichess often doesn't give fed in this JSON
                // blackFederation: g.players.black.fed,
                fen: g.fen,
                isLive,
                whiteResult,
                blackResult,
                whiteClock: wClock,
                blackClock: bClock,
                lastMove: g.lastMove,
                round: extractRoundNumber(data.round.name), // Extract number from "Round 5"
                lastUpdatedAt: new Date().toISOString(),
                pgn: '', // Required by GameSummary
                source: 'lichess-broadcast-api'
            } as GameSummary;
        });

    } catch (e) {
        console.warn(`[LichessBroadcast] Error fetching round ${roundId}:`, e);
        return [];
    }
}

function formatLichessClock(seconds?: number): string {
    if (seconds === undefined || seconds === null) return '0:00';
    // Lichess clock might be in centiseconds or seconds.
    // If > 10000, likely centiseconds? Or if < 10000 maybe seconds?
    // Standard logic: try seconds. 
    const totalSeconds = typeof seconds === 'number' ? seconds : 0;

    // Safety limit: if > 24 hours, maybe it's milliseconds/centiseconds?
    // 5h = 18000s.

    // Formatting mm:ss or h:mm:ss
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);

    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}


// --- PGN CACHE ---
const ROUND_PGN_CACHE = new Map<string, string>(); // roundId -> pgnText

export async function fetchRoundPgn(roundId: string, force = false): Promise<string> {
    if (!force && ROUND_PGN_CACHE.has(roundId)) {
        return ROUND_PGN_CACHE.get(roundId)!;
    }

    try {
        const url = `${LICHESS_API_BASE}/round/${roundId}.pgn`;
        // Cache busting for force
        const fetchUrl = force ? `${url}?_=${Date.now()}` : url;

        const res = await fetch(fetchUrl);
        if (res.ok) {
            const text = await res.text();
            if (text && text.length > 50) { // arbitrary min length check
                ROUND_PGN_CACHE.set(roundId, text);
                return text;
            }
        }
    } catch (e) {
        console.warn(`[fetchRoundPgn] Error ${roundId}`, e);
    }
    return '';
}


// Lightweight PGN Splitter
// Returns map of "WhiteName-BlackName" -> PGN
// Returns map of "GameID" (canonical) -> PGN
export function parsePgnForRound(fullPgn: string): Map<string, string> {
    const map = new Map<string, string>();
    // Matches standard PGN structure.
    const games = fullPgn.split(/(?=\[Event\s+)/g).filter(x => x.includes('[White '));

    games.forEach(g => {
        // 1. Try to extract Canonical Game ID from Site tag
        // Example: [Site "https://lichess.org/ABC123xy"] -> ABC123xy
        const siteMatch = g.match(/\[Site\s+"https?:\/\/lichess\.org\/([a-zA-Z0-9]{8,12})"/);
        if (siteMatch && siteMatch[1]) {
            map.set(siteMatch[1], g);
            return;
        }

        // 2. Fallback: Name-Name Key (Legacy/Safety)
        const white = g.match(/\[White\s+"([^"]+)"\]/)?.[1];
        const black = g.match(/\[Black\s+"([^"]+)"\]/)?.[1];
        if (white && black) {
            const key = `${white.toLowerCase()}-${black.toLowerCase()}`;
            map.set(key, g);
        }
    });

    return map;
}

function extractRoundNumber(name: string): number {
    const m = name.match(/Round\s+(\d+)/i);
    return m ? parseInt(m[1], 10) : 0;
}

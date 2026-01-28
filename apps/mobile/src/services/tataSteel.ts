import { GameSummary } from '@chessview/core';
import { OfficialSourceRegistry } from '../config/OfficialSourceRegistry';
import { Chess } from 'chess.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parsePgnToMainlineMoves, extractClocks, getTurnFromFen } from '../utils/pgnUtils';
import { previewMemory } from '../cache/previewMemory';
import { saveTournamentPreview, saveRoundPreview, PreviewMap } from '../cache/previewStore';

export const TATA_STEEL_2026_SLUG = 'tata-steel-masters-2026';

export function getCacheKey(slug: string) {
    const prefix = 'tournament_games_cache_';
    if (slug === TATA_STEEL_2026_SLUG || slug === 'tata-steel-2026') {
        return prefix + TATA_STEEL_2026_SLUG + '_v3';
    }
    return prefix + slug;
}

const CACHE_KEY_PREFIX = 'tournament_games_cache_'; // Preserving if needed by other logic, though we just inlined it above for safety

// 1. HARDCODED CONFIG (Highest Priority)
// If you know the specific DGT/LiveChessCloud UUID or URL for 2026, put it here.
// e.g. "https://view.livechesscloud.com/..."
const LCC_TOURNAMENT_URL = '';

// Fallback configuration if discovery fails
const DGT_MASTERS_URL_FALLBACK = 'https://view.livechesscloud.com/12345678-1234-1234-1234-123456789012';

// Safe Utils
import { fetchBroadcastTournament } from './lichessBroadcast';
const safeLength = (arr: any) => Array.isArray(arr) ? arr.length : 0;
function extractRoundNumber(name: string): number {
    const m = name.match(/Round\s+(\d+)/i);
    return m ? parseInt(m[1], 10) : 0;
}


const TATA_SITE_URL = 'https://tatasteelchess.com';
const MASTERS_ROSTER_URL = 'https://tatasteelchess.com/masters';
// Lichess Masters 2026 Broadcast ID
export const LICHESS_MASTERS_BROADCAST_ID = '3COxSfdj'; // Tata Steel Masters 2026 (Broadcast ID)

// In-memory cache for fast-path lookups
const LICHESS_ID_CACHE: Record<string, string> = {}; // keys: "R{r}", "R{r}-{w}-{b}"

// In-memory cache
let dgtUrlCache: string | null = null;

interface PlayerInfo {
    name: string;
    title: string;
    rating: number;
    federation: string;
}

// Canonical Roster for 2026 Masters
const MASTERS_ROSTER_2026: PlayerInfo[] = [
    { name: 'Vincent Keymer', title: 'GM', rating: 2776, federation: 'DE' },
    { name: 'Arjun Erigaisi', title: 'GM', rating: 2775, federation: 'IN' },
    { name: 'Anish Giri', title: 'GM', rating: 2760, federation: 'NL' },
    { name: 'Rameshbabu Praggnanandhaa', title: 'GM', rating: 2758, federation: 'IN' },
    { name: 'Dommaraju Gukesh', title: 'GM', rating: 2754, federation: 'IN' },
    { name: 'Nodirbek Abdusattorov', title: 'GM', rating: 2751, federation: 'UZ' },
    { name: 'Javokhir Sindarov', title: 'GM', rating: 2726, federation: 'UZ' },
    { name: 'Hans Niemann', title: 'GM', rating: 2725, federation: 'US' },
    { name: 'Vladimir Fedoseev', title: 'GM', rating: 2705, federation: 'SI' },
    { name: 'Jorden van Foreest', title: 'GM', rating: 2703, federation: 'NL' },
    { name: 'Aravindh Chithambaram', title: 'GM', rating: 2700, federation: 'IN' },
    { name: 'Matthias Bluebaum', title: 'GM', rating: 2679, federation: 'DE' },
    { name: 'Yagiz Kaan Erdogmus', title: 'GM', rating: 2658, federation: 'TR' },
    { name: 'Thai Dai Van Nguyen', title: 'GM', rating: 2656, federation: 'CZ' },
];

export interface DgtGame {
    white: { name: string; title?: string; rating?: number; fed?: string; };
    black: { name: string; title?: string; rating?: number; fed?: string; };
    result: string;
    moves: string[];
    round: number;
    board: number;
    clock: { white: string; black: string; };
    status: string;
    fen: string;
    lastMove: string;
    pgn?: string;
}

// --- SCHEDULE & BASELINE ---
// Hardcoded pairings for robustness. 
// If specific round pairings are here, they take precedence over everything.
const TATA_STEEL_PAIRINGS: Record<number, Array<{ white: string, black: string }>> = {
    // Example format:
    // 1: [{ white: 'Player A', black: 'Player B' }, ...],
    // If we find the official pairings we can paste them here.
    // For now we rely on the "Learned Baseline" (persisted).
};

const CACHE_KEY_SCHEDULE = 'tata_steel_2026_schedule_v1';
let MEMORY_SCHEDULE_CACHE: Record<number, GameSummary[]> = {};

/**
 * Returns a baseline list of games for a round.
 * 1. Hardcoded Pairings (if available)
 * 2. Learned/Persisted Schedule (if available)
 * 3. Empty (if first time)
 */
async function getBaselineGames(round: number): Promise<GameSummary[]> {
    // 1. InMemory
    if (MEMORY_SCHEDULE_CACHE[round]) {
        return cloneGames(MEMORY_SCHEDULE_CACHE[round]);
    }

    // 2. Hardcoded
    if (TATA_STEEL_PAIRINGS[round]) {
        return buildGamesFromPairings(round, TATA_STEEL_PAIRINGS[round]);
    }

    // 3. Disk
    try {
        const stored = await AsyncStorage.getItem(CACHE_KEY_SCHEDULE);
        if (stored) {
            const fullSchedule = JSON.parse(stored);
            if (fullSchedule[round]) {
                MEMORY_SCHEDULE_CACHE[round] = fullSchedule[round];
                return cloneGames(fullSchedule[round]);
            }
        }
    } catch (e) { /* ignore */ }

    // 4. Fallback (Empty, will be populated by first fetch)
    return [];
}

async function getAllBaselines(): Promise<GameSummary[]> {
    let all: GameSummary[] = [];
    for (let r = 1; r <= 13; r++) {
        const games = await getBaselineGames(r);
        all = all.concat(games);
    }
    return all;
}

// Save games to baseline (Intelligently splits by round)
async function saveBaselineGames(games: GameSummary[]) {
    // Group by round
    const byRound: Record<number, GameSummary[]> = {};
    games.forEach(g => {
        if (g.round) {
            if (!byRound[g.round]) byRound[g.round] = [];
            byRound[g.round].push(g);
        }
    });

    const rounds = Object.keys(byRound).map(Number);
    let schedulerUpdated = false;

    // Load full schedule from disk once to avoid race/overhead
    let fullSchedule: Record<number, GameSummary[]> = {};
    try {
        const stored = await AsyncStorage.getItem(CACHE_KEY_SCHEDULE);
        if (stored) fullSchedule = JSON.parse(stored);
    } catch (e) { }

    for (const r of rounds) {
        const roundGames = byRound[r];
        // Only save if it looks like a full round (expecting 7 games)
        if (roundGames.length < 7) continue;

        // If we don't have this round or cached version is partial
        if (!MEMORY_SCHEDULE_CACHE[r] || MEMORY_SCHEDULE_CACHE[r].length < 7) {
            // Create Baseline (Persist game state, default to Scheduled if missing)
            const baseline = roundGames.map(g => ({
                // Defaults
                whiteResult: undefined,
                blackResult: undefined,
                moves: [],
                lastMove: '',
                status: 'Scheduled',

                // Overlay actual game data (preserves FEN/PGN/Result if present)
                ...g,

                // Tag source
                source: 'baseline_learned'
            }));

            MEMORY_SCHEDULE_CACHE[r] = baseline;
            fullSchedule[r] = baseline;
            schedulerUpdated = true;
        }
    }

    if (schedulerUpdated) {
        try {
            await AsyncStorage.setItem(CACHE_KEY_SCHEDULE, JSON.stringify(fullSchedule));
        } catch (e) { /* ignore */ }
    }
}

function buildGamesFromPairings(round: number, pairings: Array<{ white: string, black: string }>): GameSummary[] {
    return pairings.map((p, idx) => {
        const wInfo = reconciliatePlayer(p.white);
        const bInfo = reconciliatePlayer(p.black);
        return {
            gameId: `tata-2026-${round}-${idx + 1}-${wInfo.name}-${bInfo.name}`.replace(/\s+/g, '-').toLowerCase(),
            whiteName: wInfo.name,
            blackName: bInfo.name,
            whiteTitle: wInfo.title,
            blackTitle: bInfo.title,
            whiteFederation: wInfo.federation,
            blackFederation: bInfo.federation,
            whiteRating: wInfo.rating,
            blackRating: bInfo.rating,
            round,
            board: idx + 1,
            isLive: false,
            whiteClock: '1:40', // Default Standard Time
            blackClock: '1:40',
            pgn: '',
            fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            source: 'baseline',
            lastUpdatedAt: new Date().toISOString()
        } as GameSummary;
    });
}

function cloneGames(games: GameSummary[]): GameSummary[] {
    return JSON.parse(JSON.stringify(games));
}

// State Machine for Source Selection
type SourceMode = 'PRIMARY' | 'FALLBACK';
let currentMode: SourceMode = 'PRIMARY';
let primaryConsecutiveFails = 0;
let lastPrimaryProbe = 0;
const PRIMARY_PROBE_INTERVAL = 60000; // 60s
const MAX_PRIMARY_FAILS = 2;

// ... imports

// OPTIONS Interface
export interface FetchOptions {
    onlyRound?: number; // Optimization: Only parse games for this round
    forcePrimary?: boolean; // Attempt primary even if backend says fallback
}

// ... 

// Helper type for Arbitration
interface FeedResult {
    games: GameSummary[];
    source: string;
    serverAsOf: number; // Time in ms (server time or reception time)
    moveCountB1: number; // Board 1 moves for tie-breaking
    rawGames?: any[];
    bytes?: number;
}

// Global State
let lastParsedGames: GameSummary[] = [];
let lastFullBroadcastPgn: string | null = null;
let broadcastBaselinePromise: Promise<void> | null = null;
let broadcastBaselineLoaded = false;
let broadcastIdDerived = false;


// 95: let lastParsedGames... (kept above)

export let archiveVersion = 0;

// --- ARCHIVE ENRICHMENT CACHE ---
const ARCHIVE_CACHE = new Map<string, GameSummary>();

function normalizeName(name: string): string {
    // 1. Lowercase, remove common punctuation, collapse spaces
    const clean = name.toLowerCase().replace(/[.,-]/g, ' ').replace(/\s+/g, ' ').trim();
    // 2. Sort parts to handle "Last, First" vs "First Last" order independence
    // e.g. "carlsen magnus" -> "carlsen magnus" (sorted) 
    //      "magnus carlsen" -> "carlsen magnus" (sorted)
    return clean.split(' ').sort().join(' ');
}

function getGameKey(round: number | string, white: string, black: string): string {
    return `${round}|${normalizeName(white)}|${normalizeName(black)}`;
}

export async function fetchTataSteelLiveSnapshot(): Promise<{ liveRound: number | null, isLive: boolean, latestFinished: number | null, nextRound: { round: number, startsAt: number } | null }> {
    try {
        const data = await fetchBroadcastTournament(LICHESS_MASTERS_BROADCAST_ID);
        // Ensure data.rounds is valid
        if (!data || !data.rounds || !Array.isArray(data.rounds)) {
            return { liveRound: null, isLive: false, latestFinished: null, nextRound: null };
        }

        const now = Date.now();
        const rounds = data.rounds;

        if (__DEV__) {
            const r7 = rounds[7];
            const r8 = rounds[8];
            const logObj = (prefix: string, obj: any) => {
                if (!obj) return `${prefix}=undefined`;
                const keys = Object.keys(obj).slice(0, 10).join(',');
                const tsFields: Record<string, any> = {};
                ['startsAt', 'startAt', 'startTime', 'startsAtMs', 'scheduledAt', 'time', 'finished', 'isFinished'].forEach(k => {
                    if (obj[k] !== undefined) tsFields[k] = obj[k];
                });
                return `${prefix} keys=[${keys}...] vals=${JSON.stringify(tsFields)}`;
            };
            console.log(`[RAW_SHAPE_DEBUG] ${logObj('Rounds[7]', r7)} | ${logObj('Rounds[8]', r8)}`);
        }

        // Parse Round Numbers
        const parsedRounds = rounds.map(r => {
            // Fix: Parse "round-8" from slug or name
            let rNum = 0;
            const slugNum = r.slug?.match(/(\d+)/)?.[1];
            const nameNum = r.name?.match(/(\d+)/)?.[1];

            if (slugNum) rNum = parseInt(slugNum, 10);
            else if (nameNum) rNum = parseInt(nameNum, 10);

            // Normalize timestamp
            let startMs = r.startsAt;
            if (typeof startMs === 'number' && startMs < 100000000000) {
                startMs *= 1000;
            }

            // Finished: Use schema. Derive from games if we had them (we don't here).
            // Fallback for "finished" is to trust the API metadata.
            const finished = r.finished === true;

            return {
                ...r,
                rNum,
                startsAt: startMs,
                finished
            };
        }).filter(r => r.rNum > 0);

        // 1. Live Round: Highest round where startsAt <= now AND !finished
        const liveCandidates = parsedRounds.filter(r =>
            (r.startsAt && r.startsAt <= now) && !r.finished
        );
        const liveRoundObj = liveCandidates.length > 0
            ? liveCandidates.reduce((max, r) => r.rNum > max.rNum ? r : max)
            : null;

        // 2. Latest Finished: Highest round where finished === true
        const finishedCandidates = parsedRounds.filter(r => r.finished);
        const latestFinishedObj = finishedCandidates.length > 0
            ? finishedCandidates.reduce((max, r) => r.rNum > max.rNum ? r : max)
            : null;

        // 3. Next Round: Lowest round where startsAt > now
        const nextCandidates = parsedRounds.filter(r => r.startsAt && r.startsAt > now);
        const nextRoundObj = nextCandidates.length > 0
            ? nextCandidates.reduce((min, r) => r.rNum < min.rNum ? r : min)
            : null;

        const liveRound = liveRoundObj ? liveRoundObj.rNum : null;
        const latestFinished = latestFinishedObj ? latestFinishedObj.rNum : null;
        const nextRound = nextRoundObj ? { round: nextRoundObj.rNum, startsAt: nextRoundObj.startsAt! } : null;

        if (__DEV__) {
            const r8 = parsedRounds.find(r => r.rNum === 8);
            const r9 = parsedRounds.find(r => r.rNum === 9);
            console.log(`[HOME_R89] r8 start=${r8?.startsAt} fin=${r8?.finished} | r9 start=${r9?.startsAt} fin=${r9?.finished}`);
            console.log(`[TataSnapshot] live=${liveRound}, finished=${latestFinished}, next=${nextRound?.round}@${nextRound?.startsAt}`);
        }

        return {
            liveRound,
            isLive: liveRound !== null,
            latestFinished,
            nextRound
        };
    } catch (e) {
        console.warn('[TataSnapshot] Failed', e);
        return { liveRound: null, isLive: false, latestFinished: null, nextRound: null };
    }
}

// --- PGN SOURCE RESOLVER ---
interface PgnSourceCandidate {
    source: 'OFFICIAL' | 'LICHESS';
    url?: string;
    fetcher: () => Promise<FeedResult | null>;
}

async function resolvePgnSources(tournamentKey: string, options?: FetchOptions): Promise<PgnSourceCandidate[]> {
    const candidates: PgnSourceCandidate[] = [];
    const config = OfficialSourceRegistry[tournamentKey];
    const targetRound = options?.onlyRound;

    let hasOfficial = false;

    // 1. Official Source (Priority)
    if (config?.officialRoundPgnUrlTemplate && targetRound) {
        const url = config.officialRoundPgnUrlTemplate.replace('{round}', targetRound.toString());
        hasOfficial = true;
        candidates.push({
            source: 'OFFICIAL',
            url,
            fetcher: async () => {
                if (__DEV__) console.log(`[PGN_SOURCE_TRY] source=OFFICIAL url=${url}`);
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`Status ${res.status}`);
                    const text = await res.text();
                    if (text.trim().startsWith('<')) throw new Error('HTML response');

                    const games = parsePgnFeed(text, options);
                    const mapped = mapDgtToGameSummary(games, Date.now());

                    if (options?.onlyRound && mapped.length === 0) {
                        // Empty PGN is a fail for specific round fetch
                        throw new Error('No games found in source');
                    }

                    return {
                        games: mapped,
                        source: 'OFFICIAL',
                        serverAsOf: Date.now(),
                        moveCountB1: getBoard1MoveCount(games),
                        rawGames: games,
                        bytes: text.length
                    };
                } catch (e: any) {
                    console.warn(`[PGN_SOURCE_FAIL] source=OFFICIAL status=${e.message}`);
                    return null;
                }
            }
        });
        console.log(`[PGN_SOURCE_PICK] tournamentKey=${tournamentKey} roundNum=${targetRound} source=official reason=config_present`);
    }

    // 2. Fallback: Lichess (Always available)
    candidates.push({
        source: 'LICHESS',
        fetcher: async () => {
            const urlGuess = targetRound ? `lichess_round_${targetRound}` : 'lichess_broadcast';
            if (__DEV__) console.log(`[PGN_SOURCE_TRY] source=LICHESS url=${urlGuess}`);
            // Wrap existing lichess fetcher
            try {
                const res = await fetchLichessFallback(options);
                if (res && res.games && res.games.length > 0) {
                    return {
                        games: res.games,
                        source: 'action_lichess', // internal tag
                        serverAsOf: res.serverAsOf,
                        moveCountB1: getBoard1MoveCount(res.rawGames),
                        rawGames: res.rawGames,
                        bytes: res.bytes
                    };
                }
                throw new Error('No games from Lichess');
            } catch (e: any) {
                console.warn(`[PGN_SOURCE_FAIL] source=LICHESS status=${e.message}`);
                return null;
            }
        }
    });

    if (!hasOfficial) {
        console.log(`[OFFICIAL_SOURCE_MISSING] tournamentKey=${tournamentKey} action=using_lichess_fallback`);
        console.log(`[PGN_SOURCE_PICK] tournamentKey=${tournamentKey} roundNum=${targetRound} source=lichess reason=no_official_config`);
    }

    return candidates;
}

// ROUND ID CACHE
let ROUND_ID_MAP_CACHE: Map<number, string> | null = null;
async function getTataSteelRoundIds(): Promise<Map<number, string>> {
    if (ROUND_ID_MAP_CACHE) return ROUND_ID_MAP_CACHE;

    // Fetch
    const data = await fetchBroadcastTournament(LICHESS_MASTERS_BROADCAST_ID);
    const map = new Map<number, string>();
    if (data && data.rounds) {
        data.rounds.forEach(r => {
            const rNum = extractRoundNumber(r.name) || parseInt(r.slug?.match(/(\d+)/)?.[1] || '0', 10);
            if (rNum > 0 && r.id) {
                map.set(rNum, r.id);
            }
        });
    }
    ROUND_ID_MAP_CACHE = map;
    return map;
}

export async function fetchTataSteelGames(options?: FetchOptions): Promise<GameSummary[]> {
    const start = performance.now();
    const targetRound = options?.onlyRound;
    // Enhanced Key: includes forcePrimary to separate manual refreshes from automatic ones if needed
    // And simple differentiates if targetRound is undefined ('ALL').
    const cacheKey = `${TATA_STEEL_2026_SLUG}_R${targetRound ?? 'ALL'}_${options?.forcePrimary ? 'FORCE' : 'AUTO'}`;

    // DEDUPE: Return existing promise if in-flight
    if (IN_FLIGHT_PROMISES.has(cacheKey)) {
        console.log(`[PGN_SOURCE_DEDUPE] key=${cacheKey} reused=true`);
        return IN_FLIGHT_PROMISES.get(cacheKey)!;
    }

    console.log(`[PGN_SOURCE_DEDUPE] key=${cacheKey} reused=false`);

    const promise = (async () => {
        // --- STEP 1: GET BASELINE ---
        let baseline: GameSummary[] = [];
        if (targetRound) {
            baseline = await getBaselineGames(targetRound);
        } else {
            baseline = await getAllBaselines();
        }

        // Default to fallback if nothing works
        let chosen: FeedResult = { games: [], source: 'NONE', serverAsOf: 0, moveCountB1: 0, bytes: 0 };

        // --- RESOLVER STRATEGY ---
        try {
            const candidates = await resolvePgnSources(TATA_STEEL_2026_SLUG, options);
            let successResult: FeedResult | null = null;
            let cacheHit = false;

            for (const candidate of candidates) {
                const result = await candidate.fetcher();
                if (result && result.games.length > 0) {
                    successResult = result;
                    successResult.source = candidate.source === 'OFFICIAL' ? 'official' : 'lichess';

                    const bytesVal = result.bytes ?? 0;
                    const bytesLog = bytesVal > 0 ? bytesVal : 'N/A';

                    if (bytesVal === 0 && result.games.length > 0) {
                        cacheHit = true;
                    }

                    console.log(`[PGN_SOURCE_OK] source=${candidate.source.toLowerCase()} bytes=${bytesLog} gamesParsed=${result.games.length} cacheHit=${cacheHit}`);
                    break;
                }
            }

            if (successResult) {
                chosen = successResult;
            }

            // 5. MERGE WITH BASELINE
            let finalGames = chosen.games;

            if (chosen.games.length >= 7) {
                saveBaselineGames(chosen.games);
            }

            if (baseline.length > 0) {
                const prevLen = finalGames.length;
                finalGames = mergeLiveToBaseline(baseline, chosen.games);
            }

            // --- STEP 6: EXPLICIT ENRICHMENT FROM ARCHIVE ---
            if (finalGames.length > 0 && ARCHIVE_CACHE.size > 0) {
                finalGames.forEach(g => {
                    if (!g.round) return;
                    const k1 = getGameKey(g.round, g.whiteName, g.blackName);
                    const k2 = getGameKey(g.round, g.blackName, g.whiteName);
                    const archive = ARCHIVE_CACHE.get(k1) || ARCHIVE_CACHE.get(k2);

                    if (archive) {
                        const anyG = g as any;
                        const anyArch = archive as any;

                        if (!g.pgn || g.pgn.length === 0) g.pgn = archive.pgn;
                        if ((!anyG.moves || anyG.moves.length === 0) && (anyArch.moves && anyArch.moves.length > 0)) {
                            anyG.moves = anyArch.moves;
                            if (!g.lastMove && archive.lastMove) g.lastMove = archive.lastMove;
                        }

                        if (!g.whiteTitle) g.whiteTitle = archive.whiteTitle;
                        if (!g.blackTitle) g.blackTitle = archive.blackTitle;
                        if (!g.whiteRating) g.whiteRating = archive.whiteRating;
                        if (!g.blackRating) g.blackRating = archive.blackRating;
                        if (!g.whiteFederation) g.whiteFederation = archive.whiteFederation;
                        if (!g.blackFederation) g.blackFederation = archive.blackFederation;

                        if ((!g.whiteResult && !g.blackResult) || anyG.status === 'Scheduled') {
                            if (archive.whiteResult !== undefined) {
                                g.whiteResult = archive.whiteResult;
                                g.blackResult = archive.blackResult;
                            }
                        }
                    }
                });
            }

            if (__DEV__) {
                // Debug logs...
            }

            lastDebugStats.source = chosen.source;

            if (finalGames.length > 0) {
                lastParsedGames = finalGames;

                // [PREVIEW_STORE_SYNC]
                // Parse games into map and save to updated store
                const previewMap: Record<string, any> = {};
                finalGames.forEach(g => {
                    // Normalize FEN
                    // If game has previewFen, use it. Else fall back.
                    // BUT we only want to save if we have meaningful state?
                    // Or just save latest known state?
                    const pFen = (g as any).previewFen || g.fen;
                    const lMove = (g as any).previewLastMove || g.lastMove;

                    if (pFen || lMove) { // Only save if we have data
                        // Key needs to match getUniqueRowKey logic: `${game.whiteName}-${game.blackName}` or similar?
                        // In tataSteel.ts we didn't import getUniqueRowKey, need to replicate or match.
                        // getUniqueRowKey uses whiteName-blackName usually.
                        // Let's assume standard key.
                        const key = `${g.whiteName}-${g.blackName}`;
                        previewMap[key] = {
                            previewFen: pFen,
                            lastMove: lMove,
                            result: (g.whiteResult && g.blackResult) ? `${g.whiteResult}-${g.blackResult}` : undefined,
                            updatedAt: Date.now()
                        };
                    }
                });

                // Fire and forget save
                saveTournamentPreview(TATA_STEEL_2026_SLUG, previewMap).catch(err => console.warn('[TataSteel] Preview save failed', err));

            } else if (baseline.length > 0) {
                console.log('[TataSteel] Fetch failed, returning BASELINE');
                return baseline;
            }

            // SUMMARY LOG (Once per hydration/execution, driven by the unique promise execution)
            console.log(`[PGN_SOURCE_SUMMARY] tournamentKey=${TATA_STEEL_2026_SLUG} roundNum=${targetRound ?? 'ALL'} picked=${chosen.source} cacheHit=${cacheHit} bytes=${chosen.bytes ?? 'N/A'} gamesParsed=${chosen.games.length}`);

            return finalGames;

        } catch (e: any) {
            console.error('[TataSteel] Fetch Exception', e);
            if (lastParsedGames && lastParsedGames.length > 0) return lastParsedGames;
            return [];
        } finally {
            IN_FLIGHT_PROMISES.delete(cacheKey);
        }
    })();
    // ... (imports removed from here)

    IN_FLIGHT_PROMISES.set(cacheKey, promise);

    // Side Effect: Update Unified Preview Cache when promise resolves
    // Side Effect: Update Unified Preview Cache when promise resolves
    promise.then(async games => {
        if (games && games.length > 0) {
            const previewMap: PreviewMap = {};
            const byRound: Record<number, PreviewMap> = {};

            games.forEach(g => {
                const pFen = (g as any).previewFen || g.fen;
                const lastMove = (g as any).previewLastMove || g.lastMove;
                const result = (g.whiteResult && g.blackResult) ? `${g.whiteResult}-${g.blackResult}` : undefined;

                // Construct a stable key (Must match getUniqueRowKey in TournamentBoardsScreen)
                let key = (g as any).lichessGameId;
                if (!key && g.gameId) key = g.gameId;
                if (!key) {
                    const w = g.whiteName ? normalizeName(g.whiteName) : 'white';
                    const b = g.blackName ? normalizeName(g.blackName) : 'black';
                    const r = g.round ?? 'ur';
                    key = `${r}-${w}-${b}`;
                }

                if (key && pFen && pFen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
                    const entry = {
                        previewFen: pFen,
                        lastMove: lastMove,
                        result: result,
                        updatedAt: Date.now()
                    };

                    previewMap[key] = entry;

                    // Group by round
                    const rNum = (g.round && typeof g.round === 'string' ? parseInt(g.round, 10) : g.round) || 0;
                    if (rNum > 0) {
                        if (!byRound[rNum]) byRound[rNum] = {};
                        byRound[rNum][key] = entry;
                    }
                }
            });

            if (Object.keys(previewMap).length > 0) {
                // 1. Update Memory immediately (Global Slug)
                previewMemory.set(TATA_STEEL_2026_SLUG, previewMap);
                // 2. Persist to Disk (Global Slug - Legacy/Fallback)
                saveTournamentPreview(TATA_STEEL_2026_SLUG, previewMap);

                // 3. Universal Round-Based Cache
                try {
                    // We need round IDs. Fetch them if not cached.
                    // This is a detached promise, so awaiting here is fine.
                    const roundIdMap = await getTataSteelRoundIds();

                    Object.entries(byRound).forEach(([rNumStr, map]) => {
                        const rNum = parseInt(rNumStr, 10);
                        const roundId = roundIdMap.get(rNum);
                        if (roundId) {
                            const cacheKey = `previewFenByRound:${roundId}`;
                            // Update Memory
                            previewMemory.set(cacheKey, map);
                            // Update Disk
                            saveRoundPreview(roundId, map);
                            console.log(`[PREVIEW_CACHE_WRITE] roundId=${roundId} (R${rNum}) items=${Object.keys(map).length}`);
                        }
                    });
                } catch (e) {
                    console.warn('[PreviewSystem] Failed to update round-based cache', e);
                }

                if (__DEV__) console.log(`[PreviewSystem] Auto-saved ${Object.keys(previewMap).length} previews for Tata Steel`);
            }
        }
    });

    return promise;
}

// --- RICHNESS SCORE ---
function calculateGameRichness(g: GameSummary): number {
    let score = 0;
    const anyG = g as any;

    // PGN Data
    if (g.pgn && g.pgn.length > 5) score += 100;
    if (anyG.moves && anyG.moves.length > 0) score += 50;

    // Metadata
    if (g.whiteRating || g.blackRating) score += 20;
    if (g.whiteTitle || g.blackTitle) score += 10;
    if (g.whiteFederation || g.blackFederation) score += 10;

    // Status
    if (anyG.status && anyG.status !== 'Scheduled') score += 10;
    if (g.whiteResult !== undefined) score += 5;

    return score;
}

// --- MERGE HELPER ---
function mergeLiveToBaseline(baseline: GameSummary[], liveParams: GameSummary[]): GameSummary[] {
    // Map live games for fast lookup
    const liveMap = new Map<string, GameSummary>();
    liveParams.forEach(g => {
        if (g.gameId) liveMap.set(g.gameId, g);
    });

    return baseline.map(base => {
        // Try matching
        let match = liveMap.get(base.gameId);

        if (!match) {
            // Fuzzy match fallback
            match = liveParams.find(l => {
                const sameRound = l.round === base.round;
                const sameWhite = normalizeNameForMatching(l.whiteName) === normalizeNameForMatching(base.whiteName);
                const sameBlack = normalizeNameForMatching(l.blackName) === normalizeNameForMatching(base.blackName);
                return sameRound && sameWhite && sameBlack;
            });
        }

        if (match) {
            // MERGE STRATEGY:
            // 1. Base (Archive) usually has better Metadata (Title, Rating, correct Names).
            // 2. Match (Live) has dynamic Moves, Clock, Status.
            // 3. We want Rich properties from Base, but Live properties from Match.

            const merged: GameSummary = { ...base };

            // Overwrite live fields if match has them
            if (match.isLive) merged.isLive = true;
            if (match.whiteClock && match.whiteClock !== '0:00') merged.whiteClock = match.whiteClock;
            if (match.blackClock && match.blackClock !== '0:00') merged.blackClock = match.blackClock;

            const matchMoves = (match as any).moves || [];
            const baseMoves = (base as any).moves || [];

            // Moves: Prefer match if it has more moves or is live
            if (matchMoves.length >= baseMoves.length) {
                (merged as any).moves = matchMoves;
                merged.lastMove = match.lastMove;
                if (match.pgn && match.pgn.length > (base.pgn || '').length) {
                    merged.pgn = match.pgn;
                }
            }

            // FEN: Prefer match if live
            if (match.fen && match.fen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
                merged.fen = match.fen;
            }

            // [FIX] Ensure previewFen is carried over from the fresh match to the merged object
            if ((match as any).previewFen) {
                (merged as any).previewFen = (match as any).previewFen;
            }
            if ((match as any).previewFenSource) {
                (merged as any).previewFenSource = (match as any).previewFenSource;
            }
            // Transfer previewLastMove if captured
            if ((match as any).previewLastMove) {
                (merged as any).previewLastMove = (match as any).previewLastMove;
            }
            if ((match as any).startFen) {
                (merged as any).startFen = (match as any).startFen;
            }

            // Results: If match says finished with result, take it.
            if (match.whiteResult && match.whiteResult !== '*') {
                merged.whiteResult = match.whiteResult;
                merged.blackResult = match.blackResult;
                (merged as any).status = 'Finished';
                merged.isLive = false;
            } else if (match.isLive) {
                // If live, trust live status and clear conflicting result
                merged.whiteResult = undefined;
                merged.blackResult = undefined;
                (merged as any).status = 'Live';
            }

            return merged;

        } else {
            // No update from live feed -> Return Baseline
            return base;
        }
    });
}

function getBoard1MoveCount(games: DgtGame[]): number {
    if (!Array.isArray(games)) return 0;
    const b1 = games.find(g => g.board === 1);
    return b1 && Array.isArray(b1.moves) ? b1.moves.length : 0;
}

// Stub for typing, real logic embedded in helpers below
function getBoard1MoveCountDgt(games: any[]): number {
    if (!Array.isArray(games)) return 0;
    const b1 = games.find((g: any) => g.board === 1);
    return b1 && Array.isArray(b1.moves) ? b1.moves.length : 0;
}


// ... 

async function fetchDgtFeed(baseDgtUrl: string, options?: FetchOptions): Promise<{ games: DgtGame[], serverMod: number }> {
    // ... PGN URL discovery ...
    // Assume we got PGN URL
    let pgnUrl = '';
    // (Discovery logic reused from existing code...)
    // ... Copying existing discovery briefly ...
    try {
        const viewHtml = await fetchText(baseDgtUrl);
        const match = viewHtml.match(/href=["']([^"']+\.pgn)["']/i);
        if (match && match[1]) {
            pgnUrl = match[1];
            if (!pgnUrl.startsWith('http')) {
                const url = new URL(baseDgtUrl);
                pgnUrl = `${url.protocol}//${url.host}${pgnUrl.startsWith('/') ? '' : '/'}${pgnUrl}`;
            }
        } else {
            const cleanBase = baseDgtUrl.replace(/\/$/, '').replace(/\/(index|live)\.(html|php)$/, '');
            pgnUrl = `${cleanBase}/games.pgn`;
        }

        if (pgnUrl) {
            const res = await fetch(pgnUrl);
            if (res.ok) {
                const pgnText = await res.text();
                // Normalized PGN Feed
                const games = parsePgnFeed(pgnText, options);
                return { games, serverMod: Date.now() }; // Capture timestamp
            }
        }
    } catch (e) {
        console.warn('DGT Fetch Error', e);
    }
    return { games: [], serverMod: 0 };
}

// ...

// Cache for Round ID lookup
const LICHESS_ROUND_INDEX = new Map<number, string>(); // roundNum -> roundId
let roundIndexFailed = false;
let lastLoggedRoundForLoad: number | undefined = undefined;

async function fetchRoundIndex(): Promise<void> {
    if (LICHESS_ROUND_INDEX.size > 0 || roundIndexFailed) return; // Already loaded or failed permanently

    try {
        if (__DEV__) console.log('[RoundIndex] Loading...');
        // Correct API for broadcast definition is simply the broadcast URL with Accept: application/json or just .json suffix?
        // Lichess API: GET /api/broadcast/{id} returns JSON definition including rounds.
        // We use the simpler ID-only URL which is standard Lichess API.
        const url = `https://lichess.org/api/broadcast/${LICHESS_MASTERS_BROADCAST_ID}`
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });

        if (!res.ok) throw new Error('Status ' + res.status);

        const data = await res.json();

        if (data.rounds && Array.isArray(data.rounds)) {
            data.rounds.forEach((r: any) => {
                // Try to parse "Round X" from name
                let rNum = -1;
                if (r.name) {
                    const match = r.name.match(/Round\s+(\d+)/i);
                    if (match) rNum = parseInt(match[1], 10);
                }

                // If name parsing fails, rely on ordering if pure?
                // No, safer to just log warning and skip? Or assume index+1 if clean.

                if (rNum > 0 && r.id) {
                    LICHESS_ROUND_INDEX.set(rNum, r.id);
                }
            });
            console.log(`[RoundIndex] Loaded rounds=${LICHESS_ROUND_INDEX.size}`);
        }
    } catch (e) {
        console.warn('[RoundIndex] Failed to load index', e);
        roundIndexFailed = true; // Stop retrying
    }
}

export async function getLichessRoundId(roundNum: number): Promise<string | undefined> {
    if (LICHESS_ROUND_INDEX.size === 0) await fetchRoundIndex();
    return LICHESS_ROUND_INDEX.get(roundNum);
}

async function fetchLichessFallback(options?: FetchOptions): Promise<{ games: GameSummary[], serverAsOf: number, rawGames: DgtGame[], bytes: number }> {
    // Determine URL: Default to full broadcast PGN
    let url = `https://lichess.org/api/broadcast/tata-steel-masters-2026/${LICHESS_MASTERS_BROADCAST_ID}.pgn`;
    let sourceMeta = 'LICHESS_FALLBACK';

    // Optimization: If specific round requested, try to use Round Index
    if (options?.onlyRound) {
        await fetchRoundIndex();
        const roundId = LICHESS_ROUND_INDEX.get(options.onlyRound);
        if (roundId) {
            // Specific Round PGN
            url = `https://lichess.org/api/broadcast/round/${roundId}.pgn`;
            sourceMeta = `LICHESS_ROUND_${options.onlyRound}`;
            if (__DEV__) console.log(`[RoundLoad] Fetching specific round ${options.onlyRound} from URL ${url}`);
        } else {
            console.warn(`[RoundLoad] Could not find Round ID for R${options.onlyRound}, falling back to full PGN`);
        }
    }

    if (__DEV__) console.log(`[RoundLoad] url=${url} roundNo=${options?.onlyRound ?? 'ALL'} start...`);

    try {
        const res = await fetch(url);
        const contentType = res.headers.get('content-type');

        // Instrumentation Log
        // Note: we don't know games count yet, will log after parse.

        if (contentType && (contentType.includes('text/html') || contentType.startsWith('text/html'))) {
            if (__DEV__) console.log(`[RoundLoad] url=${url} status=${res.status} ct=${contentType} games=0 (HTML detected)`);
            throw new Error('Received HTML response (blocked or wrong URL)');
        }

        const pgnText = await res.text();
        const pgnBytes = pgnText.length;

        // Robustness: Double check body start
        if (pgnText.trim().startsWith('<')) {
            if (__DEV__) console.log(`[RoundLoad] url=${url} status=${res.status} ct=${contentType} games=0 (HTML Body)`);
            throw new Error('Received HTML body');
        }

        const dgtGames = parsePgnFeed(pgnText, options);

        if (__DEV__) console.log(`[RoundLoad] url=${url} status=${res.status} ct=${contentType} games=${dgtGames.length}`);

        // If we fetched a specific round but got 0 games, log it
        if (options?.onlyRound && dgtGames.length === 0) {
            console.warn(`[RoundLoad] Fetched specific URL but got 0 games. URL: ${url}`);

            // --- BACKFILL STRATEGY (V2: Full Baseline) ---
            // If individual round PGN is empty, we fetch the FULL broadcast PGN
            // and populate the baseline for ALL rounds (fixing R1-R6 etc).
            if (options.onlyRound) {
                // Check if we already have it in baseline (avoid re-fetching if racing)
                const currentBaseline = await getBaselineGames(options.onlyRound);
                if (currentBaseline.length > 0) {
                    console.log(`[RoundLoad] Baseline already has R${options.onlyRound}, returning it.`);
                    return {
                        games: currentBaseline.map(g => ({ ...g, source: 'archive-pgn-baseline' })),
                        serverAsOf: Date.now(),
                        rawGames: [],
                        bytes: 0 // Baseline hit, effectively 0 network bytes (or unknown)
                    };
                }

                console.log(`[RoundBackfill] Triggering full baseline fetch for missing R${options.onlyRound}`);

                // Fire and await the baseline builder
                await fetchAndBuildBroadcastBaseline();

                // Now re-fetch from baseline
                const baselineGames = await getBaselineGames(options.onlyRound);
                if (baselineGames.length > 0) {
                    console.log(`[RoundBackfill] Recovered ${baselineGames.length} games from baseline for R${options.onlyRound}`);
                    const marked = baselineGames.map(g => ({ ...g, source: 'archive-pgn-baseline' }));
                    return {
                        games: marked,
                        serverAsOf: Date.now(),
                        rawGames: [],
                        bytes: 0
                    };
                } else {
                    console.warn(`[RoundBackfill] Baseline build complete but still no games for R${options.onlyRound}`);
                }
            }
        } else if (options?.onlyRound) {
            // Guard: Log only if round changed or it's the first time
            if (__DEV__ && lastLoggedRoundForLoad !== options.onlyRound) {
                console.log(`[RoundLoad] done round=${options.onlyRound} games=${dgtGames.length} source=${sourceMeta}`);
                lastLoggedRoundForLoad = options.onlyRound;
            }
        }

        const mapped = mapDgtToGameSummary(dgtGames);
        const marked = mapped.map(g => ({ ...g, source: 'fallback-lichess' }));
        return {
            games: marked,
            serverAsOf: Date.now(),
            rawGames: dgtGames,
            bytes: pgnBytes
        };
    } catch (e: any) {
        console.warn(`[RoundLoad] fail round=${options?.onlyRound || 'ALL'} reason=${e.message} url=${url}`);
        return { games: [], serverAsOf: 0, rawGames: [], bytes: 0 };
    }
}

export function parsePgnFeed(pgnText: string, options?: FetchOptions): DgtGame[] {
    const startParse = performance.now();
    if (!pgnText || typeof pgnText !== 'string') return [];

    // Safety check for empty HTML responses being passed as PGN
    if (pgnText.trim().startsWith('<!DOCTYPE html') || pgnText.includes('<html')) {
        console.warn('[TataSteel] Received HTML instead of PGN, aborting parse');
        return [];
    }

    const games: DgtGame[] = [];

    // ROBUST LINE-BASED PARSER (V2)
    // Iterates line by line to support arbitrary spacing between games
    const lines = pgnText.replace(/\r/g, '').split('\n');
    const rawGames: string[] = [];
    let currentBuffer: string[] = [];

    for (const line of lines) {
        // Check for Event start tag at beginning of line
        if (line.trim().startsWith('[Event "')) {
            if (currentBuffer.length > 0) {
                rawGames.push(currentBuffer.join('\n'));
            }
            currentBuffer = [line];
        } else {
            // Only append if we are inside a game buffer
            if (currentBuffer.length > 0) {
                currentBuffer.push(line);
            }
        }
    }
    // Push the last game
    if (currentBuffer.length > 0) {
        rawGames.push(currentBuffer.join('\n'));
    }

    if (__DEV__) {
        const firstHeader = rawGames.length > 0 ? rawGames[0].split('\n').slice(0, 4).join('|') : 'NONE';
        const lastHeader = rawGames.length > 0 ? rawGames[rawGames.length - 1].split('\n').slice(0, 4).join('|') : 'NONE';
        console.log(`[ARCHIVE_CHUNKS] detectedChunks=${rawGames.length} firstChunkHeaderLines=${firstHeader} lastChunkHeaderLines=${lastHeader}`);
    }

    let skippedCount = 0;

    // Stats for Parse Recovery
    let recoveredCount = 0;
    let failedButIncludedCount = 0;
    const dropReasons: Record<string, number> = {};

    for (const raw of rawGames) {
        if (!raw.trim()) continue;

        // CRITICAL OPTIMIZATION: Filter before parse
        if (options?.onlyRound) {
            const roundMatch = raw.match(/\[Round\s+"(\d+)(\.\d+)?"\]/i);
            if (roundMatch) {
                const r = parseInt(roundMatch[1], 10);
                if (r !== options.onlyRound) {
                    skippedCount++;
                    continue; // SKIP this block
                }
            }
        }

        let pgnBlock = raw.trim();
        pgnBlock = pgnBlock.replace(/;.*$/gm, '');

        // --- STAGE 1: SAFE TAG EXTRACTION (Regex Only) ---
        const getTag = (name: string) => {
            const m = pgnBlock.match(new RegExp(`\\[${name}\\s+"([^"]+)"\\]`));
            return m ? m[1] : undefined;
        };

        const whiteName = getTag('White') || 'Unknown';
        const blackName = getTag('Black') || 'Unknown';
        const result = getTag('Result') || '*';
        const roundStr = getTag('Round');
        const round = roundStr ? parseInt(roundStr, 10) || 1 : 1;
        const board = parseInt(getTag('Board') || '0', 10) || 0;
        const fenTag = getTag('FEN'); // Usually missing in standard PGN unless resumed

        // OPTIMIZATION: Skip Heavy Parsing (Chess.js loadPgn)
        // We defer move parsing to the individual game screen.
        // We just store the PGN block string.
        // NOTE: This means 'moves' array is empty, and 'fen' is start position (unless tag exists).
        // The user accepts this trade-off for speed, provided the UI handles it.
        // BUT: If the user wants "Last Position immediately", and Archive PGNs don't have FEN tags...
        // We are stuck. However, prompt says: "Stop pre-parsing moves... Store pgn... Leave moves undefined".
        // This implies we DO NOT compute final FEN here.

        games.push({
            white: {
                name: whiteName,
                title: getTag('WhiteTitle'),
                rating: parseInt(getTag('WhiteElo') || '0') || undefined,
                fed: getTag('WhiteFideId') ? undefined : undefined // mapping issue, fed is usually implied or separate
            },
            black: {
                name: blackName,
                title: getTag('BlackTitle'),
                rating: parseInt(getTag('BlackElo') || '0') || undefined,
                fed: undefined
            },
            result,
            round,
            board,
            status: result === '*' ? 'Live' : 'Finished',
            fen: fenTag || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            clock: { white: '0:00', black: '0:00' },
            moves: [], // LAZY: Empty for now
            lastMove: '',
            pgn: pgnBlock // IMPORTANT: Store full PGN for lazy parse
        } as DgtGame);
    }

    if (__DEV__) {
        // Log optimization stats
        const parseDuration = performance.now() - startParse;
        console.log(`[PERF_ARCHIVE2] ms=${parseDuration.toFixed(1)} games=${games.length}`);
    }

    return games.sort((a, b) => b.board - a.board);
}

let archivePgnPromise: Promise<void> | null = null;
let archivePgnLoaded = false;

/**
 * ARCHIVE PGN LOADER
 * Fetches the full tournament PGN (all rounds) once.
 * Populates the baseline cache so R1..R13 are available instantly.
 */
// --- ROBUST ARCHIVE PGN FETCHING ---
const FAILED_IDS_CACHE = new Set<string>();

/**
 * Returns a prioritized list of Tournament IDs to try for the "All Rounds PGN".
 * Candidates:
 * 1. Hardcoded Override (e.g. 3COxSfdj for Tata Steel 2026)
 * 2. Lichess Broadcast Meta lookup (finding the Tournament/Group ID)
 * 3. Fallback to existing constants if not failed
 */
async function resolveTournamentPgnId(tournamentKey: string): Promise<string[]> {
    console.log(`[ArchivePGN] resolve input tournamentKey=${tournamentKey}`);

    const candidates: string[] = [];

    // 1. HARDCODED OVERRIDE (Temporary Fix)
    // Unblock Tata Steel immediately by mapping to the Tournament ID (not Round ID)
    if (
        tournamentKey === 'tata-steel-masters-2026' ||
        tournamentKey === TATA_STEEL_2026_SLUG ||
        tournamentKey === 'tata-steel-2026'
    ) {
        candidates.push('3COxSfdj');
    }

    // 2. DYNAMIC LOOKUP (Future robustness)
    // If we have a stored meta or can quickly fetch the slug...

    // 3. LEGACY/CONSTANT FALLBACK
    const legacyId = LICHESS_MASTERS_BROADCAST_ID;
    const isRoundId = (legacyId as string) === 'pdNmUOnu'; // Known round ID

    if (!candidates.includes(legacyId) && !isRoundId) {
        candidates.push(legacyId);
    }

    // Safety: If empty, and looking like Tata, force the ID
    if (candidates.length === 0 && tournamentKey.includes('tata')) {
        candidates.push('3COxSfdj');
    }

    // Filter out known failed IDs
    return candidates.filter(id => !FAILED_IDS_CACHE.has(id));
}

export async function loadArchivePgnOnce(tournamentKey: string = TATA_STEEL_2026_SLUG) {
    // Singleton guard
    if (archivePgnPromise) return archivePgnPromise;
    if (archivePgnLoaded) return;

    archivePgnPromise = (async () => {
        const candidates = await resolveTournamentPgnId(tournamentKey);
        console.log(`[ArchivePGN] start tournamentId resolution candidates=${JSON.stringify(candidates)}`);

        let success = false;

        for (const bId of candidates) {
            console.log(`[ArchivePGN] trying tournamentId=${bId}`);
            const start = performance.now();
            const fetchUrl = `https://lichess.org/api/broadcast/${bId}.pgn`;

            try {
                const res = await fetch(fetchUrl);
                const contentType = res.headers.get('content-type');
                const status = res.status;

                // Peek
                const text = await res.text();
                const firstChar = text.trim().substring(0, 1);

                console.log(`[ArchivePGN] resp status=${status} ct=${contentType} firstChar=${firstChar}`);

                // Validation
                if (!res.ok || status !== 200 || firstChar === '<') {
                    console.warn(`[ArchivePGN] invalidId=${bId} status=${status} firstChar=${firstChar}`);
                    FAILED_IDS_CACHE.add(bId);
                    continue; // Try next candidate
                }

                // --- DIAGNOSTICS START --- 
                if (__DEV__) {
                    const eventCount = (text.match(/\[Event "/g) || []).length;
                    const whiteCount = (text.match(/\[White "/g) || []).length;
                    const blackCount = (text.match(/\[Black "/g) || []).length;
                    const normText = text.toLowerCase();
                    const hasBlue = normText.includes('bluebaum');
                    const hasErig = normText.includes('erigaisi');
                    console.log(`[ARCHIVE_RAW2] len=${text.length} eventTags=${eventCount} whiteTags=${whiteCount} blackTags=${blackCount} rawHasBluebaum=${hasBlue} rawHasErigaisi=${hasErig}`);
                }
                // --- DIAGNOSTICS END ---

                // Success! Parse with full enrichment (using same logic as live feed)
                // This ensures we get moves/FEN/clocks and proceed to roster enrichment
                const dgtGames = parsePgnFeed(text);

                // --- POST-PARSE DIAGNOSTICS START ---
                if (__DEV__) {
                    const rounds = new Map<number, number>();
                    dgtGames.forEach(g => rounds.set(g.round, (rounds.get(g.round) || 0) + 1));
                    const r6Count = rounds.get(6) || 0;
                    const roundStr = Array.from(rounds.entries()).map(([r, c]) => `R${r}=${c}`).join(', ');

                    const matthiasArjun = dgtGames.find(g => {
                        const n = normalizeNameForMatching(g.white.name) + '|' + normalizeNameForMatching(g.black.name);
                        // "matthias bluebaum" and "arjun erigaisi"
                        return (n.includes('matthias') && n.includes('erigaisi')) || (n.includes('bluebaum') && n.includes('arjun'));
                    });

                    console.log(`[ARCHIVE_PARSED3] parsedGames=${dgtGames.length} rounds={${roundStr}} r6Count=${r6Count}`);
                    console.log(`[ARCHIVE_FIND3] bluebaum_vs_erigaisi found=${!!matthiasArjun} movesLen=${matthiasArjun?.moves?.length}`);
                }
                // --- POST-PARSE DIAGNOSTICS END ---

                const allGames = mapDgtToGameSummary(dgtGames, Date.now());

                const roundsFound = new Set(allGames.map(g => g.round));
                const ms = (performance.now() - start).toFixed(0);

                // Validation Log
                // Check sample enrichment
                const sampleR6 = allGames.find(g => g.round === 6);
                if (sampleR6) {
                    console.log(`[ArchivePGN] enriched sample round=6 gameKey=${sampleR6.gameId} hasFlag=${!!sampleR6.whiteFederation} hasRating=${!!sampleR6.whiteRating} hasFEN=${!!sampleR6.fen} len=${sampleR6.pgn?.length}`);
                }

                const enrichedCount = allGames.filter(g => g.whiteFederation || g.whiteRating).length;
                console.log(`[ArchivePGN] enrichedGamesWithRoster=${enrichedCount} / total=${allGames.length}`);
                console.log(`[ArchivePGN] success tournamentId=${bId} parsedGames=${allGames.length} rounds=${roundsFound.size} ms=${ms}ms`);
                if (__DEV__) logGameShape('ArchivePGN:Load', allGames);

                if (allGames.length > 0) {
                    // Populate Archive Cache
                    allGames.forEach(g => {
                        if (g.round) {
                            const k1 = getGameKey(g.round, g.whiteName, g.blackName);
                            // Flipped key just in case
                            const k2 = getGameKey(g.round, g.blackName, g.whiteName);
                            ARCHIVE_CACHE.set(k1, g);
                            ARCHIVE_CACHE.set(k2, g);
                        }
                    });

                    await saveBaselineGames(allGames);
                    archivePgnLoaded = true;
                    archiveVersion++;
                    success = true;
                    break; // Stop trying candidates
                } else {
                    console.warn(`[ArchivePGN] empty pgn for id=${bId}`);
                    // If empty, maybe valid but useless? Let's mark failed to try others if any.
                    FAILED_IDS_CACHE.add(bId);
                }

            } catch (e: any) {
                console.warn(`[ArchivePGN] error id=${bId}: ${e.message}`);
                FAILED_IDS_CACHE.add(bId);
            }
        }

        if (!success) {
            console.warn('[ArchivePGN] All candidates failed or returned 0 games.');
        }

    })();

    return archivePgnPromise;
}

// Alias for old calls if any
export const fetchAndBuildBroadcastBaseline = loadArchivePgnOnce;

/**
 * Lightweight Header-Only Parser
 * Extracts Round, White, Black, Result, Board.
 */
function parsePgnHeadersOnly(pgnText: string): GameSummary[] {
    const rawEvents = pgnText.split('[Event "');
    const games: GameSummary[] = [];

    // Skip first empty split if exists
    for (let i = 0; i < rawEvents.length; i++) {
        const raw = rawEvents[i];
        if (!raw || raw.length < 10) continue;

        const block = '[Event "' + raw; // Restore event tag

        // Helper to extract tag value quickly
        const getTag = (name: string) => {
            // Match: [Name "Value"]
            const m = block.match(new RegExp(`\\[${name}\\s+"([^"]+)"\\]`));
            return m ? m[1] : undefined;
        };

        const roundStr = getTag('Round');
        if (!roundStr) continue;

        // Normalize Round (handle '1.1' etc if needed, but usually '1')
        const round = parseInt(roundStr, 10);
        if (!round) continue;

        const white = getTag('White') || 'Unknown';
        const black = getTag('Black') || 'Unknown';
        const result = getTag('Result') || '*';
        const boardStr = getTag('Board');
        const board = boardStr ? parseInt(boardStr, 10) : 0;

        // Build GameSummary for Baseline
        // gameId generation must match `buildGamesFromPairings` style if possible 
        // to ensure merge consistency.
        // `tata-2026-${round}-${idx + 1}-${wInfo.name}-${bInfo.name}`
        const idBase = `tata-2026-${round}-${white}-${black}`.replace(/\s+/g, '-').toLowerCase();

        games.push({
            gameId: idBase,
            whiteName: white,
            blackName: black,
            round,
            board: board || (games.length + 1), // Fallback board
            isLive: result === '*',
            result: result === '*' ? undefined : result,
            whiteResult: result === '*' ? undefined : result.split('-')[0],
            blackResult: result === '*' ? undefined : result.split('-')[1],
            status: result === '*' ? 'Scheduled' : 'Finished',
            // Defaults
            whiteClock: '1:40',
            blackClock: '1:40',
            pgn: '',
            fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            moves: [],
            lastMove: '',
            source: 'baseline_broadcast',
            lastUpdatedAt: new Date().toISOString()
        } as GameSummary);
    }

    return games;
}

// Debug Stats Storage
export const lastDebugStats = {
    slug: '',
    dgtUrl: '',
    source: '',
    matchCount: 0,
    totalPlayers: 0,
    unmatched: [] as string[],
    sampleMapping: ''
};

async function getDgtUrl(): Promise<string | null> {
    // 0. Check Hardcoded Config
    if (LCC_TOURNAMENT_URL) return LCC_TOURNAMENT_URL;

    if (dgtUrlCache) return dgtUrlCache;

    try {
        // Attempt discovery
        // 1. Fetch main page or masters page
        const html = await fetchText(MASTERS_ROSTER_URL) || await fetchText(TATA_SITE_URL);

        // 2. Look for iframe or livechesscloud links on Official Site
        // Regex: src="(https?:\/\/(?:view\.)?livechesscloud\.com\/[^"]+)"
        const match = html.match(/src=["'](https?:\/\/(?:view\.)?livechesscloud\.com\/[^"']+)["']/i) ||
            html.match(/href=["'](https?:\/\/(?:view\.)?livechesscloud\.com\/[^"']+)["']/i);

        if (match && match[1]) {
            console.log('Discovered LCC URL via Official Site');
            dgtUrlCache = match[1];
            return dgtUrlCache;
        }

        // 3. Look for LCC inside Lichess Broadcast Metadata (Discovery Helper)
        // Only do this if we want to extract the DGT URL from it.
        // We will skip this complex fetch if we have a hardcoded fallback plan ready.
        // But for "Primary" it might be useful. Let's keep it simple: 
        // If official site fail, we just go to fallback logic which is now robust.
    } catch (e) {
        console.log('Discovery failed, using fallback logic');
    }

    // Check if fallback is a valid URL (not the placeholder)
    if (DGT_MASTERS_URL_FALLBACK && !DGT_MASTERS_URL_FALLBACK.includes('12345678')) {
        return DGT_MASTERS_URL_FALLBACK;
    }

    return null;
}



// Globals for conditional fetching
let lastEtag: string | null = null;
let lastModified: string | null = null;
let lastPgnText: string | null = null;
// lastParsedGames moved to top


const CACHE_KEY_GAMES = 'tata_steel_2026_games';

async function saveCachedGames(games: GameSummary[]) {
    if (games.length === 0) return;
    try {
        await AsyncStorage.setItem(CACHE_KEY_GAMES, JSON.stringify(games));
    } catch (e) {
        console.warn('Failed to save games to cache', e);
    }
}

async function loadCachedGames(): Promise<GameSummary[]> {
    try {
        const json = await AsyncStorage.getItem(CACHE_KEY_GAMES);
        if (json) {
            return JSON.parse(json);
        }
    } catch (e) {
        console.warn('Failed to load games from cache', e);
    }
    return [];
}

// Lichess Fallback Logic (PGN)
// Lichess Fallback Logic (PGN)

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
    // Target: "Gukesh Dommaraju"
    'Dommaraju Gukesh': 'Gukesh Dommaraju',
    'Gukesh D': 'Gukesh Dommaraju',
    'D. Gukesh': 'Gukesh Dommaraju',
    'Gukesh Dommaraju': 'Gukesh Dommaraju', // Identity

    // Target: "Praggnanandhaa Rameshbabu"
    'Rameshbabu Praggnanandhaa': 'Praggnanandhaa Rameshbabu',
    'R. Praggnanandhaa': 'Praggnanandhaa Rameshbabu',
    'Praggnanandhaa R': 'Praggnanandhaa Rameshbabu',
    'Praggnanandhaa Rameshbabu': 'Praggnanandhaa Rameshbabu', // Identity
};


function mapDgtToGameSummary(dgtGames: DgtGame[], serverTimestamp?: number): GameSummary[] {
    const totalGames = dgtGames.length;
    let withPreviewCount = 0;
    let previewDiffStartCount = 0;
    const missingPreviewIds: string[] = [];

    // Failure Stats
    let failCount = 0;
    let lastFailReason = '';
    const MAX_FAIL_LOGS = 5;

    const mapped = dgtGames.map(g => {
        const whiteInfo = reconciliatePlayer(g.white.name);
        const blackInfo = reconciliatePlayer(g.black.name);
        const whiteDisplayName = DISPLAY_NAME_OVERRIDES[whiteInfo.name] || whiteInfo.name;
        const blackDisplayName = DISPLAY_NAME_OVERRIDES[blackInfo.name] || blackInfo.name;

        // Use server timestamp if available, else receive time
        // This is crucial for drift correction
        const updateTime = serverTimestamp ? new Date(serverTimestamp).toISOString() : new Date().toISOString();

        // --- PREVIEW FEN COMPUTATION ---
        let previewFen: string | undefined;
        let previewLastMove: string | undefined;
        let previewFenSource: string | undefined;

        try {
            // Use Robust Parser from Utils
            const parseRes = parsePgnToMainlineMoves(g.pgn || '');

            if (parseRes.ok && parseRes.finalFen) {
                previewFen = parseRes.finalFen;
                // Capture last move (UCI)
                if (parseRes.lastMove) {
                    previewLastMove = parseRes.lastMove;
                }
                previewFenSource = 'pgn_parsed_robust';
            } else if (g.moves && g.moves.length > 0) {
                // Fallback: Reconstruct from moves line
                // This handles the case where PGN string might be empty but moves array exists
                const quickChess = new Chess();
                for (const m of g.moves) {
                    quickChess.move(m);
                }
                previewFen = quickChess.fen();
                // Extract last move from moves array fallback
                const historyVerbose = quickChess.history({ verbose: true });
                const lastMoveObj = historyVerbose.length > 0 ? historyVerbose[historyVerbose.length - 1] : undefined;
                if (lastMoveObj) {
                    previewLastMove = lastMoveObj.from + lastMoveObj.to;
                }
                previewFenSource = 'moves_array_recons';
            }

        } catch (e: any) {
            // Computation Failed
            failCount++;
            lastFailReason = e.message;
        }

        // Fallback: Snapshot FEN
        if (!previewFen && g.fen && g.fen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
            previewFen = g.fen;
            previewFenSource = 'snapshot_fallback';
        }

        // Final check
        if (previewFen) {
            withPreviewCount++;
            if (previewFen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
                previewDiffStartCount++;
            }
        } else {
            const gid = `tata-2026-${g.round}-${g.board}-${whiteInfo.name}-${blackInfo.name}`;
            missingPreviewIds.push(gid);
        }

        // [CLOCK FIX] Extract real clocks
        let finalWhiteClock = g.clock.white;
        let finalBlackClock = g.clock.black;
        let whiteSeconds = 0;
        let blackSeconds = 0;

        // Helper to parse "H:MM:SS" or "MM:SS" or "SS" to seconds
        const parseClockToSeconds = (c: string): number => {
            if (!c) return 0;
            const parts = c.split(':').map(Number);
            if (parts.some(isNaN)) return 0;
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            if (parts.length === 1) return parts[0];
            return 0;
        };

        try {
            // Use previewFen if available (most accurate state), else raw fen from feed
            const turn = getTurnFromFen(previewFen || g.fen);
            const extracted = extractClocks(g.pgn || '', turn);
            if (extracted.white) finalWhiteClock = extracted.white;
            if (extracted.black) finalBlackClock = extracted.black;

            whiteSeconds = parseClockToSeconds(finalWhiteClock);
            blackSeconds = parseClockToSeconds(finalBlackClock);
        } catch (e) { /* safe */ }

        return {
            gameId: `tata-2026-${g.round}-${g.board}-${whiteInfo.name}-${blackInfo.name}`.replace(/\s+/g, '-').toLowerCase(),
            board: g.board, // [SORT FIX] Expose board number for sorting
            whiteName: whiteDisplayName,
            blackName: blackDisplayName,
            whiteTitle: whiteInfo.title || g.white.title || undefined,
            blackTitle: blackInfo.title || g.black.title || undefined,
            whiteFederation: whiteInfo.federation || g.white.fed,
            blackFederation: blackInfo.federation || g.black.fed,
            whiteRating: whiteInfo.rating || g.white.rating,
            blackRating: blackInfo.rating || g.black.rating,
            isLive: g.status === 'Live',
            whiteClock: finalWhiteClock,
            blackClock: finalBlackClock,
            whiteSeconds, // [CLOCK FIX]
            blackSeconds, // [CLOCK FIX]
            clockCapturedAt: updateTime, // [CLOCK FIX]
            whiteResult: g.result === '1-0' ? '1' : g.result === '0-1' ? '0' : g.result === '1/2-1/2' ? '½' : undefined,
            blackResult: g.result === '1-0' ? '0' : g.result === '0-1' ? '1' : g.result === '1/2-1/2' ? '½' : undefined,
            fen: g.fen,
            pgn: g.pgn || g.moves.join(' '),
            source: 'tata-steel-2026',
            lastMove: previewLastMove || g.lastMove,
            previewLastMove, // Explicitly attach for cache
            round: g.round,
            turn: g.fen.split(' ')[1] as 'w' | 'b',
            lastUpdatedAt: updateTime,
            previewFen,
            previewFenSource,
            startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' // [FIX] Attach explicit startFen
        } as GameSummary;
    });

    // Summary Log [USER REQUESTED]
    const missingCount = totalGames - withPreviewCount;
    if (totalGames > 0) {
        console.log(`[ROUND_PGN_PREVIEW_ATTACHED] tournamentKey=${TATA_STEEL_2026_SLUG} roundNum=${dgtGames[0]?.round ?? 'ALL'} total=${totalGames} withPreview=${withPreviewCount} missing=${missingCount}`);

        // Keep existing diagnostic logs too
        const missingStr = missingPreviewIds.length > 0 ? missingPreviewIds.slice(0, 3).join(',') + (missingPreviewIds.length > 3 ? '...' : '') : 'none';
        console.log(`[ROUND_PREVIEW_FEN_SUMMARY] tournamentKey=${TATA_STEEL_2026_SLUG} total=${totalGames} withPreview=${withPreviewCount} missingIds=${missingStr}`);
    }

    return mapped;
}


// --- PGN SANITIZER ---
/**
 * Removes comments, variations, NAGs, and annotations from PGN movetext
 * to ensure successful parsing by lightweight chess libraries.
 */
function sanitizePgnForPreview(pgn: string): string {
    if (!pgn) return '';
    let clean = pgn;

    // 1. Remove brace comments { ... }
    // Handles non-nested braces. Nested braces are rare in PGN but regex is simple.
    clean = clean.replace(/\{[^}]*\}/g, '');

    // 2. Remove parenthesis variations ( ... )
    // Simple regex for non-nested.
    clean = clean.replace(/\([^)]*\)/g, '');

    // 3. Remove NAGs ($1, $20, etc)
    clean = clean.replace(/\$\d+/g, '');

    // 4. Remove suffixes (!, ?, !?, etc) attached to moves
    // But be careful not to break standard tokens if any.
    // Usually safe to remove ! and ? globally in movetext.
    clean = clean.replace(/[!?]+/g, '');

    // 5. Remove Result tokens (1-0, 0-1, 1/2-1/2, *) if they are trailing or inline
    // (chess.js might handle them, but safer to strip if embedded)

    return clean;
}


function normalizeNameForMatching(name: string): string {
    return name.toLowerCase().replace(/[,\.]/g, '').replace(/\s+/g, ' ').trim();
}

// Manual Aliases for Tricky Names (Key must be normalized: lowercase, no dots/commas)
const PLAYER_ALIASES: Record<string, string> = {
    // Gukesh
    'gukesh d': 'Dommaraju Gukesh',
    'd gukesh': 'Dommaraju Gukesh',
    'gukesh dommaraju': 'Dommaraju Gukesh', // Feed might use this
    'gukesh': 'Dommaraju Gukesh',

    // Pragg
    'praggnanandhaa r': 'Rameshbabu Praggnanandhaa',
    'r praggnanandhaa': 'Rameshbabu Praggnanandhaa',
    'praggnanandhaa rameshbabu': 'Rameshbabu Praggnanandhaa', // Feed might use this
    'praggnanandhaa': 'Rameshbabu Praggnanandhaa',
    'rameshbabu praggnanandhaa': 'Rameshbabu Praggnanandhaa',

    // Others
    'yi wei': 'Wei Yi',
};

const SHOW_ROSTER_MATCH_LOGS = __DEV__ && false;
const ROSTER_MATCH_LOG_CACHE = new Set<string>();

function reconciliatePlayer(feedName: string): PlayerInfo {
    const normalizedFeedName = normalizeNameForMatching(feedName);

    // 0. CHECK ALIASES FIRST
    if (PLAYER_ALIASES[normalizedFeedName]) {
        const canonicalName = PLAYER_ALIASES[normalizedFeedName];
        const aliasMatch = MASTERS_ROSTER_2026.find(p => p.name === canonicalName);
        if (aliasMatch) {
            if (SHOW_ROSTER_MATCH_LOGS) {
                const logKey = `${feedName}->${canonicalName}`;
                if (!ROSTER_MATCH_LOG_CACHE.has(logKey)) {
                    ROSTER_MATCH_LOG_CACHE.add(logKey);
                    console.log(`[RosterMatch] Alias used: "${feedName}" -> "${canonicalName}"`);
                }
            }
            return aliasMatch;
        }
    }

    // 1. Exact Full Name Match
    const exactMatch = MASTERS_ROSTER_2026.find(p => normalizeNameForMatching(p.name) === normalizedFeedName);
    if (exactMatch) return exactMatch;

    // 2. Last Name + First Name Match (handling "Surname, Firstname" or "Firstname Surname")
    // Split feed name into parts
    const parts = normalizedFeedName.split(' ');

    // Find matching player 
    const partialMatches = MASTERS_ROSTER_2026.filter(p => {
        const rosterNameNormal = normalizeNameForMatching(p.name);
        const rosterParts = rosterNameNormal.split(' ');
        const rosterLastName = rosterParts[rosterParts.length - 1];

        // Basic heuristic: check if last name is present in feed name parts
        // and at least one other part matches
        const lastNameMatch = parts.includes(rosterLastName);
        if (!lastNameMatch) return false;

        // Check for first name or initial
        const feedFirstInitial = parts[0][0];
        const rosterFirstInitial = rosterParts[0][0];

        return feedFirstInitial === rosterFirstInitial;
    });

    if (partialMatches.length === 1) {
        return partialMatches[0];
    }

    // Prefer exact full-name match if multiple found (already covered by step 1), 
    // but if we are here we might have ambiguous matches or no matches.

    // 2b. Try "Surname, Firstname" structure explicitly if comma was present (normalized removed it but order remains)
    // Actually, normalizeNameForMatching removes commas.
    // If we have "Niemann Hans Moke", we want to match "Hans Niemann".
    // Let's try to see if all parts of the roster name are in the feed name?
    const fuzzyMatch = MASTERS_ROSTER_2026.find(p => {
        const rosterNameNormal = normalizeNameForMatching(p.name);
        const rosterParts = rosterNameNormal.split(' ');
        return rosterParts.every(part => normalizedFeedName.includes(part));
    });
    if (fuzzyMatch) return fuzzyMatch;

    // 3. Fallback: unmatched
    if (__DEV__) {
        console.log(`[Flags] Missing federation for: "${feedName}" (No match found)`);
    }

    // Return a constructed PlayerInfo preserving the feed name but without enhanced stats
    return {
        name: feedName.trim(), // Keep original casing/spacing or simple trim
        title: '',
        rating: 0,
        federation: ''
    };
}

async function fetchText(url: string): Promise<string> {
    try {
        const res = await fetch(url);
        return await res.text();
    } catch {
        return '';
    }
}

// --- FAST PATH HELPERS ---

/**
 * Finds the Lichess Game ID for a specific game in the broadcast.
 * Uses a caching strategy to avoid re-fetching round lists.
 */
export async function findLichessGameId(
    round: number,
    whiteName: string,
    blackName: string
): Promise<string | null> {
    const cacheKey = `R${round}-${normalizeNameForMatching(whiteName)}-${normalizeNameForMatching(blackName)}`;
    if (LICHESS_ID_CACHE[cacheKey]) {
        return LICHESS_ID_CACHE[cacheKey];
    }

    try {
        // 1. Get Round ID (Cache check first)
        let roundId = LICHESS_ID_CACHE[`R${round}`];
        if (!roundId) {
            // Fetch Broadcast Index to find round ID
            const broadcastUrl = `https://lichess.org/api/broadcast/${LICHESS_MASTERS_BROADCAST_ID}`;
            const res = await fetch(broadcastUrl);
            const data = await res.json();

            // Lichess Broadcast structure: { rounds: [{ id, name, slug, ... }] }
            // Round names usually "Round 1", "Round 2", etc.
            if (data && data.rounds && Array.isArray(data.rounds)) {
                const match = data.rounds.find((r: any) =>
                    r.name.includes(`Round ${round}`) ||
                    (r.slug && r.slug.endsWith(`round-${round}`))
                );
                if (match) {
                    roundId = match.id;
                    LICHESS_ID_CACHE[`R${round}`] = roundId;
                }
            }
        }

        if (!roundId) return null;

        // 2. Fetch Round Games to find Game ID
        // Note: We use the /api/broadcast/round/{id} endpoint which returns JSON info about games
        const roundUrl = `https://lichess.org/api/broadcast/round/${roundId}`;
        const res = await fetch(roundUrl);
        const data = await res.json();

        if (data && data.games && Array.isArray(data.games)) {
            // 3. Match Players
            // Need to match normalized names.
            const wNorm = normalizeNameForMatching(whiteName);
            const bNorm = normalizeNameForMatching(blackName);

            const gameMatch = data.games.find((g: any) => {
                // g.players.white.name, g.players.black.name
                const gw = normalizeNameForMatching(g.players?.white?.name || '');
                const gb = normalizeNameForMatching(g.players?.black?.name || '');

                // Flexible matching: check inclusion or specific aliases
                // We use our reconciliatePlayer helper logic implicitly by just fuzzy matching parts
                return (gw.includes(wNorm) || wNorm.includes(gw)) &&
                    (gb.includes(bNorm) || bNorm.includes(gb));
            });

            if (gameMatch) {
                LICHESS_ID_CACHE[cacheKey] = gameMatch.id;
                return gameMatch.id;
            }
        }

    } catch (e) {
        console.warn('[FastPath] Discovery failed', e);
    }
    return null;
}

/**
 * Fetches a single game PGN from Lichess.
 * Optimized for size/speed.
 */
export async function fetchSingleGamePgn(lichessGameId: string): Promise<string | null> {
    try {
        const url = `https://lichess.org/game/export/${lichessGameId}?clocks=true&moves=true&evals=false`;
        const res = await fetch(url);
        if (res.ok) {
            return await res.text();
        }
    } catch (e) {
        // silent fail
    }
    return null;
}

function logGameShape(label: string, games: GameSummary[], reqRound?: number) {
    if (!games || games.length === 0) {
        console.log(`[${label}] games=0 reqRound=${reqRound}`);
        return;
    }
    const g = games[0];
    const anyG = g as any;
    const shape = {
        round: g.round,
        reqRound,
        count: games.length,
        white: { n: g.whiteName, t: g.whiteTitle, r: g.whiteRating, f: g.whiteFederation },
        black: { n: g.blackName, t: g.blackTitle, r: g.blackRating, f: g.blackFederation },
        res: (g.whiteResult !== undefined) ? `${g.whiteResult}-${g.blackResult}` : '?',
        pgnLen: g.pgn?.length,
        fen: !!g.fen,
        id: g.gameId,
        source: anyG.source,
        keys: Object.keys(g).join(',')
    };
    console.log(`[${label}] SHAPE: ${JSON.stringify(shape)}`);
}

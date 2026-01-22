import { GameSummary } from '@chessview/core';
import { Chess } from 'chess.js';

export const TATA_STEEL_2026_SLUG = 'tata-steel-masters-2026';

// 1. HARDCODED CONFIG (Highest Priority)
// If you know the specific DGT/LiveChessCloud UUID or URL for 2026, put it here.
// e.g. "https://view.livechesscloud.com/..."
const LCC_TOURNAMENT_URL = '';

// Fallback configuration if discovery fails
const DGT_MASTERS_URL_FALLBACK = 'https://view.livechesscloud.com/12345678-1234-1234-1234-123456789012';

const TATA_SITE_URL = 'https://tatasteelchess.com';
const MASTERS_ROSTER_URL = 'https://tatasteelchess.com/masters';
// Lichess Masters 2026 Broadcast ID
const LICHESS_MASTERS_BROADCAST_ID = '3COxSfdj'; // https://lichess.org/broadcast/tata-steel-masters-2026/3COxSfdj

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

interface DgtGame {
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
}

// State Machine for Source Selection
type SourceMode = 'PRIMARY' | 'FALLBACK';
let currentMode: SourceMode = 'PRIMARY';
let primaryConsecutiveFails = 0;
let lastPrimaryProbe = 0;
const PRIMARY_PROBE_INTERVAL = 60000; // 60s
const MAX_PRIMARY_FAILS = 2;

export async function fetchTataSteelGames(): Promise<GameSummary[]> {
    const start = performance.now();
    let games: GameSummary[] = [];
    let source = 'NONE';
    let primaryStatus = 'skipped';
    let fallbackStatus = 'skipped';

    try {
        const now = Date.now();
        let tryPrimary = false;

        // Deciding whether to attempt Primary (DGT / Official)
        if (currentMode === 'PRIMARY') {
            tryPrimary = true;
        } else {
            // In Fallback mode, probe periodically
            if (now - lastPrimaryProbe > PRIMARY_PROBE_INTERVAL) {
                tryPrimary = true;
                lastPrimaryProbe = now;
                primaryStatus = 'probing';
            }
        }

        if (tryPrimary) {
            try {
                const dgtUrl = await getDgtUrl();
                if (dgtUrl) {
                    const dgtData = await fetchDgtFeed(dgtUrl);
                    if (dgtData && dgtData.length > 0) {
                        games = mapDgtToGameSummary(dgtData);
                        source = 'LCC_PRIMARY';
                        primaryStatus = 'success';

                        // Recovery / Maintenance
                        currentMode = 'PRIMARY';
                        primaryConsecutiveFails = 0;
                    } else {
                        throw new Error('No data');
                    }
                } else {
                    throw new Error('No URL');
                }
            } catch (e) {
                primaryStatus = 'failed';
                primaryConsecutiveFails++;
                if (currentMode === 'PRIMARY' && primaryConsecutiveFails >= MAX_PRIMARY_FAILS) {
                    currentMode = 'FALLBACK';
                    if (__DEV__) console.log('[TataSteel] Primary failing (discovery/fetch). Switching to FALLBACK mode.');
                }
            }
        }

        // If Primary failed or was skipped, use Fallback
        if (games.length === 0) {
            // Note: We don't log "Attempting..." here anymore to reduce spam.
            const fallbackGames = await fetchLichessFallback();
            if (fallbackGames.length > 0) {
                games = fallbackGames;
                source = 'LICHESS_FALLBACK';
                fallbackStatus = 'success';
            } else {
                // Could be 304 or actually empty
                fallbackStatus = 'empty_or_304';
            }
        }

        // Update debug stats
        lastDebugStats.slug = TATA_STEEL_2026_SLUG;
        lastDebugStats.source = source;
        const totalTime = (performance.now() - start).toFixed(0);

        // DEV-ONLY Consolidated Summary (One line per cycle)
        if (__DEV__) {
            const summary = `[TataSteel] Mode:${currentMode} | Prim:${primaryStatus} | FB:${fallbackStatus} | Games:${games.length} | Time:${totalTime}ms`;
            // Only log if something interesting happened or if we are verifying
            // To be silent-ish, maybe only log if state changed or periodically?
            // User requested "DEV-only single-line summary per cycle".
            console.log(summary);
        }

        return games;
    } catch (e) {
        console.error('Failed to fetch Tata Steel games:', e);
        return [];
    }
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

async function fetchDgtFeed(baseDgtUrl: string): Promise<DgtGame[]> {
    let pgnUrl = '';

    try {
        const viewHtml = await fetchText(baseDgtUrl);
        // Look for .pgn link
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
                return parsePgnFeed(pgnText);
            }
        }
    } catch (e) {
        console.warn('Failed to fetch/parse PGN feed', e);
    }

    return [];
}

// Globals for conditional fetching
let lastEtag: string | null = null;
let lastModified: string | null = null;
let lastPgnText: string | null = null;
let lastParsedGames: GameSummary[] = [];

// Lichess Fallback Logic (PGN)
async function fetchLichessFallback(): Promise<GameSummary[]> {
    const broadcastId = LICHESS_MASTERS_BROADCAST_ID;
    const url = `https://lichess.org/api/broadcast/${broadcastId}.pgn`;

    try {
        const headers: HeadersInit = {};
        if (lastEtag) headers['If-None-Match'] = lastEtag;
        if (lastModified) headers['If-Modified-Since'] = lastModified;

        if (__DEV__) {
            // Quiet log
            // console.log(`[Lichess Fallback] Checking...`);
        }

        const pgnRes = await fetch(url, { headers });

        if (pgnRes.status === 304) {
            if (__DEV__) console.log(`[Lichess Fallback] 304 Not Modified. Skipped.`);
            return lastParsedGames.length > 0 ? [] : []; // Return empty to prevent re-render, or return cached?
            // "usePollTournamentGames" ignores empty array updates.
            // If we return [], state is preserved.
        }

        if (!pgnRes.ok) throw new Error(`Status ${pgnRes.status}`);

        const newEtag = pgnRes.headers.get('Etag');
        const newModified = pgnRes.headers.get('Last-Modified');
        const pgnText = await pgnRes.text();

        // 2. Content Hash/Equality Check
        if (pgnText === lastPgnText) {
            if (__DEV__) console.log(`[Lichess Fallback] Content identical (200 OK). Skipped parse.`);
            // Update headers anyway
            lastEtag = newEtag;
            lastModified = newModified;
            return []; // No update needed
        }

        lastPgnText = pgnText;
        lastEtag = newEtag;
        lastModified = newModified;

        if (__DEV__) {
            console.log(`[Lichess Fallback] New content (${pgnText.length} bytes). Parsing deferred...`);
        }

        // 3. Defer Parsing to avoid blocking interactions
        return new Promise<GameSummary[]>((resolve) => {
            // We can use InteractionManager from react-native, but since this is a pure TS file
            // we need to make sure we import it.
            // If this was a node script, it would fail. But this is "apps/mobile".
            const { InteractionManager } = require('react-native');

            InteractionManager.runAfterInteractions(() => {
                const startTime = performance.now();

                const dgtGames = parsePgnFeed(pgnText);
                const mapped = mapDgtToGameSummary(dgtGames);
                const marked = mapped.map(g => ({ ...g, source: 'fallback-lichess' }));

                lastParsedGames = marked;

                if (__DEV__) {
                    console.log(`[Lichess Fallback] Parsed ${marked.length} games in ${(performance.now() - startTime).toFixed(1)}ms`);
                }

                resolve(marked);
            });
        });

    } catch (e) {
        console.warn('Lichess Fallback Failed', e);
        return [];
    }
}

function parsePgnFeed(pgnText: string): DgtGame[] {
    const games: DgtGame[] = [];
    // Split PGN into individual games.
    const rawGames = pgnText.split('[Event "');

    if (__DEV__) {
        console.log(`[TataSteel:Parser] Detected ${rawGames.length} raw PGN blocks`);
        // Log first few chars of each block to see if they are distinct
        rawGames.slice(0, 3).forEach((r, i) => console.log(`[TataSteel:Parser] Block ${i} preview: ${r.slice(0, 30)}...`));
    }

    let successCount = 0;
    let failCount = 0;

    for (const raw of rawGames) {
        if (!raw.trim()) continue;
        let pgnBlock = '[Event "' + raw;

        // SANITIZE: Strip comments that might choke chess.js
        // 1. Remove { ... } blocks (including multiline)
        pgnBlock = pgnBlock.replace(/\{[\s\S]*?\}/g, '');
        // 2. Remove ; ... line comments
        pgnBlock = pgnBlock.replace(/;.*$/gm, '');

        try {
            const chess = new Chess();
            chess.loadPgn(pgnBlock);

            const header = chess.header();
            const moves = chess.history();
            const verboseMoves = chess.history({ verbose: true });
            const fen = chess.fen();

            const whiteName = header['White'] || 'Unknown';
            const blackName = header['Black'] || 'Unknown';
            const result = header['Result'] || '*';

            // Handle round as number or string
            // header['Round'] might be "4.1" or "1"
            let round = 1;
            if (header['Round']) {
                const parsed = parseFloat(header['Round']);
                if (!isNaN(parsed)) round = Math.floor(parsed);
            }

            // If board is missing or 0, use the loop index (assuming PGN is ordered)
            const board = parseInt(header['Board'] || '0', 10) || (successCount + 1);

            const isLive = result === '*' && moves.length > 0;

            games.push({
                white: { name: whiteName, title: header['WhiteTitle'] || undefined, rating: parseInt(header['WhiteElo'] || '0') },
                black: { name: blackName, title: header['BlackTitle'] || undefined, rating: parseInt(header['BlackElo'] || '0') },
                result,
                moves,
                round,
                board,
                clock: { white: '0:00', black: '0:00' },
                status: isLive ? 'Live' : 'Finished',
                fen,
                lastMove: verboseMoves.length > 0 ? (verboseMoves[verboseMoves.length - 1].from + verboseMoves[verboseMoves.length - 1].to) : '',
            });
            successCount++;
        } catch (e) {
            failCount++;
            if (__DEV__) console.warn(`[TataSteel:Parser] Failed to parse PGN block for Event: ${raw.slice(0, 50)}...`, e);
        }
    }

    if (__DEV__) {
        console.log(`[TataSteel:Parser] Parsing Complete. Success: ${successCount}, Failed: ${failCount}`);

        // Log counts per round
        const roundCounts: Record<number, number> = {};
        games.forEach(g => {
            roundCounts[g.round] = (roundCounts[g.round] || 0) + 1;
        });
        console.log('[TataSteel:Parser] Counts per Round:', roundCounts);
    }

    return games.sort((a, b) => {
        if (a.round !== b.round) return b.round - a.round;
        return a.board - b.board;
    });
}

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

function mapDgtToGameSummary(dgtGames: DgtGame[]): GameSummary[] {
    return dgtGames.map(g => {
        const whiteInfo = reconciliatePlayer(g.white.name);
        const blackInfo = reconciliatePlayer(g.black.name);

        // Apply display overrides if applicable, otherwise use canonical name
        const whiteDisplayName = DISPLAY_NAME_OVERRIDES[whiteInfo.name] || whiteInfo.name;
        const blackDisplayName = DISPLAY_NAME_OVERRIDES[blackInfo.name] || blackInfo.name;

        // DEV-ONLY check to ensure mapping triggers
        if (__DEV__) {
            if (whiteInfo.name === 'Dommaraju Gukesh' || whiteInfo.name === 'Rameshbabu Praggnanandhaa') {
                console.log(`[NameFmt] "${g.white.name}" -> Info:"${whiteInfo.name}" -> Disp:"${whiteDisplayName}"`);
            }
        }

        return {
            // ID must use stable canonical names for consistent deduplication/pairing keys
            gameId: `tata-2026-${g.round}-${g.board}-${whiteInfo.name}-${blackInfo.name}`.replace(/\s+/g, '-').toLowerCase(),
            whiteName: whiteDisplayName,
            blackName: blackDisplayName,
            whiteTitle: whiteInfo.title || g.white.title,
            blackTitle: blackInfo.title || g.black.title,
            whiteFederation: whiteInfo.federation || g.white.fed,
            blackFederation: blackInfo.federation || g.black.fed,
            whiteRating: whiteInfo.rating || g.white.rating,
            blackRating: blackInfo.rating || g.black.rating,
            isLive: g.status === 'Live',
            whiteClock: g.clock.white,
            blackClock: g.clock.black,
            whiteResult: g.result === '1-0' ? '1' : g.result === '0-1' ? '0' : g.result === '1/2-1/2' ? '½' : undefined,
            blackResult: g.result === '1-0' ? '0' : g.result === '0-1' ? '1' : g.result === '1/2-1/2' ? '½' : undefined,
            fen: g.fen,
            pgn: g.moves.join(' '),
            source: 'tata-steel-2026', // Generic source identifier
            lastMove: g.lastMove,
            round: g.round,
            lastUpdatedAt: new Date().toISOString(),
        } as GameSummary;
    });
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

function reconciliatePlayer(feedName: string): PlayerInfo {
    const normalizedFeedName = normalizeNameForMatching(feedName);

    // 0. CHECK ALIASES FIRST
    if (PLAYER_ALIASES[normalizedFeedName]) {
        const canonicalName = PLAYER_ALIASES[normalizedFeedName];
        const aliasMatch = MASTERS_ROSTER_2026.find(p => p.name === canonicalName);
        if (aliasMatch) {
            if (__DEV__) console.log(`[RosterMatch] Alias used: "${feedName}" -> "${canonicalName}"`);
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

import { type GameSummary, type Tournament } from '@chessview/core';
import { getTournamentSchedule } from '../services/tournamentSchedule';
import { colors } from '../theme/colors';

// --- Type Definitions ---

export interface RoundState {
    status: 'active' | 'finished' | 'upcoming';
    // If upcoming, when does it start?
    startTime?: number;
    // Games in this round
    games: GameSummary[];
}

export interface TournamentStateResult {
    primaryText: string;
    secondaryText: string;
    statusColor: string;
    debugSource: string;
    // The "best" round to show the user
    selectedRound: number;
    // Explicitly for navigation consistency
    preferredOpenRoundNumber: number | null;
}

// --- Helpers ---

export function getMoveCount(g: GameSummary): number {
    // 1. Array check
    if ((g as any).moves && Array.isArray((g as any).moves)) return (g as any).moves.length;
    // 2. PlyCount
    if ((g as any).plyCount !== undefined) return (g as any).plyCount;
    // 3. PGN parsing
    if (g.pgn && g.pgn.length > 0) {
        let text = g.pgn.replace(/\{[^}]*\}/g, '').replace(/\([^)]*\)/g, '');
        text = text.replace(/(1-0|0-1|1\/2-1\/2|½-½|draw|\*)\s*$/, '').trim();
        text = text.replace(/\d+\.+/g, '');
        const tokens = text.split(/\s+/).filter(x => x.length > 0);
        return tokens.length;
    }
    // 4. FEN check
    if (g.fen) {
        const startFenPrefix = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
        const currentPos = g.fen.split(' ')[0];
        if (currentPos !== startFenPrefix) return 1;
    }
    return 0;
}

/**
 * Robust check if a game is TRULY live.
 * User Heuristics:
 *  - Explicit status 'live'/'playing' overrides all.
 *  - OR Result is '*' AND (Has moves OR Has clocks) AND (Recent update < 15 mins).
 */
export function isGameLive(g: GameSummary): boolean {
    // 1. Explicit Status
    const s = ((g as any).status || (g as any).state || '').toLowerCase();
    if (s === 'live' || s === 'playing' || s === 'ongoing' || s === 'started' || s === 'in_progress') {
        return true;
    }
    if (g.isLive === true) return true;

    // 2. Result Check
    const result = g.whiteResult || ((g as any).result);
    // If result is finished, it's definitely NOT live
    const isResultFinished = result && ['1-0', '0-1', '1/2-1/2', '½-½', 'draw', '1', '0', '½', '0.5'].includes(result);
    if (isResultFinished) return false;

    // 3. Activity Check
    const hasMoves = getMoveCount(g) > 0;
    const hasClock = (g.whiteClock && g.whiteClock !== '0:00') || (g.blackClock && g.blackClock !== '0:00');

    // 4. Freshness Check (Optional but good for "stale live")
    // If we have lastUpdatedAt, check age. If > 20 mins, probably not live anymore (stale cache).
    let isFresh = true;
    if (g.lastUpdatedAt) {
        const ageMs = Date.now() - new Date(g.lastUpdatedAt).getTime();
        if (ageMs > 20 * 60 * 1000) isFresh = false;
    }

    if ((hasMoves || hasClock) && isFresh) {
        return true;
    }

    return false;
}

// Backward compatibility alias
export const isGameOngoing = isGameLive;

export function isGameFinished(g: GameSummary): boolean {
    const validResults = ['1-0', '0-1', '1/2-1/2', '½-½', 'draw'];
    const result = g.whiteResult || ((g as any).result);
    return !!result && validResults.includes(result);
}

// --- Computation Logic ---

/**
 * Determine the logic state of a specific round.
 */
export function computeRoundState(games: GameSummary[], scheduledStartTime?: string): RoundState {
    if (games.length === 0) {
        // If no games, usage schedule to guess
        if (scheduledStartTime) {
            const now = Date.now();
            const start = new Date(scheduledStartTime).getTime();
            if (now < start) return { status: 'upcoming', startTime: start, games };
        }
        return { status: 'upcoming', games }; // Default fallback
    }

    // Check for ANY active game
    const hasActive = games.some(isGameLive);
    if (hasActive) return { status: 'active', games };

    // Check if ALL finished
    const allFinished = games.every(g => {
        const res = g.whiteResult || (g as any).result;
        return res && res !== '*';
    });

    // If all finished -> finished
    // If some finished, some '*', but none 'active' -> likely "Ongoing/Paused" or "Finished but result missing"
    // We'll treat as 'finished' if we have significant completion, else 'active' if we want to be safe?
    // Actually, if games exist but none active, and not all finished... it's a grey area.
    // Let's stick to strict: if not active, are they all finished?
    if (allFinished) return { status: 'finished', games };

    // If we have games, they are not active, but not all finished (e.g. paused, adjourned, or just pre-match populated?)
    // If pre-match populated (0 moves), it's upcoming.
    const hasMoves = games.some(g => getMoveCount(g) > 0);
    if (!hasMoves) {
        // Populated pairings, but no moves yet.
        return { status: 'upcoming', games };
    }

    // Has moves, not active, not finished -> Adjourned? 
    // Treat as active to be safe (so user sees them), or finished?
    // Let's treat as 'finished' (waiting for result) to avoid "LIVE" label when nothing is moving.
    return { status: 'finished', games };
}


/**
 * Core Logic: Default Round Selection
 * 1. ACTIVE round? -> Select it.
 * 2. Next round starting < 60 mins? -> Select it.
 * 3. Latest FINISHED round? -> Select it.
 * 4. Fallback -> Round 1.
 */
export function getDefaultRound(
    games: GameSummary[],
    tournamentTotalRounds: number = 13,
    now: number = Date.now()
): number {
    // 1. Group games by round
    const roundMap = new Map<number, GameSummary[]>();
    games.forEach(g => {
        const r = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
        if (r && r > 0) {
            if (!roundMap.has(r)) roundMap.set(r, []);
            roundMap.get(r)?.push(g);
        }
    });

    // 2. Schedule Check (for "Upcoming soon")
    // We don't have tournament slug here easily unless passed, but we can rely on games/heuristics mostly.
    // Ideally we need schedule. If we don't have it, we skip step 2.
    // Actually, let's just look at the games state first.

    // A. Check for ACTIVE rounds
    const activeRounds: number[] = [];
    roundMap.forEach((gs, r) => {
        if (gs.some(isGameLive)) activeRounds.push(r);
    });

    if (activeRounds.length > 0) {
        // Return latest active round
        return Math.max(...activeRounds);
    }

    // B. Check for "Upcoming Soon" (needs schedule or heuristics)
    // We can't easily do "In X min" check without schedule passed in. 
    // But this function is used in context where maybe we don't have schedule. 
    // Let's assume the caller primarily relies on this for "Active vs Finished".
    // If we want "Upcoming Soon", we might need to handle that in the caller/UI logic or pass schedule.
    // For now, let's stick to Game Data:

    // C. Latest Finished
    const finishedRounds: number[] = [];
    roundMap.forEach((gs, r) => {
        // Round is considered finished if it has content and no active games (already checked above)
        // AND checks if it "looks" started (has moves).
        const started = gs.some(g => getMoveCount(g) > 0);
        if (started) finishedRounds.push(r);
    });

    if (finishedRounds.length > 0) {
        return Math.max(...finishedRounds);
    }

    // D. Fallback
    return 1;
}

// Always show hours/minutes, never days
function formatDuration(ms: number): string {
    const absMs = Math.abs(ms);
    const mins = Math.ceil(absMs / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const m = mins % 60;
    return `${hours}h${m > 0 ? ` ${m}m` : ''}`;
}

/**
 * Master Status Logic for Home Screen & Round Selection
 */
export function computeTournamentState(
    tournament: Tournament,
    cachedGames: GameSummary[],
    now: number,
    liveOverride?: {
        isLive: boolean | null;
        round?: number;
        lastUpdated?: number;
        nextRound?: { round: number, startsAt: number };
        latestFinished?: number;
    },
    isChecking?: boolean
): TournamentStateResult {
    const total = tournament.rounds || 13;
    const schedule = getTournamentSchedule(tournament.slug);

    // --- 1. Consolidate State from Sources ---

    // A. Round & Live Status from Override (Highest Priority)
    let probeLiveRound: number | null = null;
    let probeLatestFinished: number | null = null;
    let probeNextRound: { round: number, startsAt: number } | null = null;
    let isLive = false;
    let probeActive = false;

    if (liveOverride) {
        probeActive = true;
        isLive = liveOverride.isLive === true; // Strict true check
        if (isLive) probeLiveRound = liveOverride.round ?? null;
        probeLatestFinished = liveOverride.latestFinished ?? null;
        // Sometimes override.round IS the latest finished if not live?
        // Logic in TournamentsScreen says: round = snapshot.isLive ? liveRound : latestFinished.
        // So if !isLive, liveOverride.round might be latestFinished.
        if (!isLive && !probeLatestFinished && liveOverride.round) {
            probeLatestFinished = liveOverride.round;
        }
        probeNextRound = liveOverride.nextRound ?? null;
    }

    // DYNAMIC TIMESTAMP NORMALIZATION
    // If < 1e12 (approx year 2001), treat as seconds -> *1000.
    const normalizeTs = (ts: number): number => {
        if (!ts) return 0;
        return ts < 100000000000 ? ts * 1000 : ts;
    };

    if (probeNextRound?.startsAt) {
        probeNextRound.startsAt = normalizeTs(probeNextRound.startsAt);
    }

    // B. Calculated from Cache (Fallback)
    const cachedLive = cachedGames.some(isGameLive);
    if (!probeActive) {
        // Only use cache for 'Live' if no probe info
        isLive = cachedLive;
    }

    // Calculate Latest Finished from Cache
    // (We also use this to fill gaps if probe is partial)
    let cachedLatestFinished = 1; // Default
    const finishedRounds: number[] = [];
    // Group by round
    const roundMap = new Map<number, GameSummary[]>();
    cachedGames.forEach(g => {
        const r = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
        if (r && r > 0) {
            if (!roundMap.has(r)) roundMap.set(r, []);
            roundMap.get(r)?.push(g);
        }
    });
    roundMap.forEach((gs, r) => {
        // Round has moves -> Started. Round has no live games -> Finished?
        // Rough heuristic: if it has moves, we consider it candidate for "latest finished" 
        // unless we know it's live?
        const hasMoves = gs.some(g => getMoveCount(g) > 0);
        const hasLive = gs.some(isGameLive);
        if (hasMoves && !hasLive) finishedRounds.push(r);
    });
    if (finishedRounds.length > 0) cachedLatestFinished = Math.max(...finishedRounds);

    // Final "Latest Finished" determination - favor Snapshot info
    const latestFinished = probeLatestFinished ?? cachedLatestFinished;

    // C. Next Round Info
    let nextRoundNum = -1;
    let nextRoundStartMs = 0;

    if (probeNextRound) {
        nextRoundNum = probeNextRound.round;
        nextRoundStartMs = normalizeTs(probeNextRound.startsAt);
    } else if (schedule.length > 0) {
        // Fallback to static schedule
        const nextScheduled = schedule.find(s => {
            const startStr = s.startTime; // assuming IS0 string or similar?
            const startMs = new Date(startStr).getTime(); // normalize?
            return startMs > now;
        });

        if (nextScheduled) {
            nextRoundNum = nextScheduled.round;
            nextRoundStartMs = new Date(nextScheduled.startTime).getTime();
        } else if (latestFinished && latestFinished < total) {
            // Implicit next cycle: latestFinished + 1
            // We don't have start time though...
            nextRoundNum = latestFinished + 1;
            // Can't show "In X min" without start time.
        }
    } else {
        // No schedule, but we have latestFinished
        if (latestFinished && latestFinished < total) {
            nextRoundNum = latestFinished + 1;
        }
    }

    // Calc Diff (only if valid next round time)
    let diffMs = 0;
    let diffMin = 0;
    let startsSoon = false;

    if (nextRoundStartMs > 0) {
        diffMs = nextRoundStartMs - now;
        diffMin = Math.ceil(diffMs / 60000); // can be negative if passed
        startsSoon = nextRoundNum > 0 && diffMin <= 60 && diffMin > 0;
    }

    // [HOME_CALC2] Log
    if (__DEV__ && (tournament.slug.includes('tata') || tournament.slug.includes('steel'))) {
        const pref = isLive ? (probeLiveRound ?? latestFinished + 1) : latestFinished;
        console.log(`[HOME_CALC2] now=${now} latest=${latestFinished} next=${nextRoundNum} hrsToNext=${(diffMs / 3600000).toFixed(2)} pref=${pref}`);
        if (diffMs > 0) {
            console.log(`[HOME_FORMAT_DEBUG] diffMs=${diffMs} output="${formatDuration(diffMs)}"`);
        }
    }

    // --- 2. Construct Label & Navigation Data ---

    // CASE 0: UPDATING (Probe in flight)
    if (isChecking) {
        return {
            primaryText: 'Updating…',
            secondaryText: '',
            statusColor: colors.textSecondary,
            debugSource: 'updating_probe',
            selectedRound: cachedLatestFinished || 1,
            preferredOpenRoundNumber: cachedLatestFinished || 1
        };
    }

    // CASE 1: LIVE
    if (isLive) {
        const r = probeLiveRound ?? (cachedLive ? getDefaultRound(cachedGames, total, now) : latestFinished + 1);

        if (__DEV__ && (tournament.slug.includes('tata') || tournament.slug.includes('steel'))) {
            console.log(`[HOME_CALC] ${tournament.slug} | liveOverride=${!!liveOverride} liveRound=${probeLiveRound} | roundsLen=${tournament.rounds} | now=${now} | OUT: liveRound=${r} latest=${latestFinished} next=${nextRoundNum} minToNext=${diffMin} pref=${r} label="LIVE"`);
        }

        return {
            primaryText: 'LIVE',
            secondaryText: ` • Round ${r}`,
            statusColor: colors.live, // Red
            debugSource: 'live_active',
            selectedRound: r,
            preferredOpenRoundNumber: r
        };
    }

    // CASE 2: STARTS SOON (< 60m)
    if (startsSoon) {
        if (__DEV__ && (tournament.slug.includes('tata') || tournament.slug.includes('steel'))) {
            console.log(`[HOME_CALC] ${tournament.slug} | liveOverride=${!!liveOverride} liveRound=${probeLiveRound} | roundsLen=${tournament.rounds} | now=${now} | OUT: liveRound=null latest=${latestFinished} next=${nextRoundNum} minToNext=${diffMin} pref=${latestFinished} label="In X min"`);
        }

        return {
            primaryText: `In ${diffMin} min`,
            secondaryText: ` • Round ${nextRoundNum}`,
            statusColor: colors.live, // Red emphasis
            debugSource: 'starts_soon',
            selectedRound: nextRoundNum,
            preferredOpenRoundNumber: latestFinished
        };
    }

    // CASE 3: ONGOING (Between Rounds)
    if (tournament.status === 'ONGOING' || probeActive) {
        if (nextRoundNum > 0 && diffMs > 0) {

            if (__DEV__ && (tournament.slug.includes('tata') || tournament.slug.includes('steel'))) {
                console.log(`[HOME_CALC] ${tournament.slug} | liveOverride=${!!liveOverride} liveRound=${probeLiveRound} | roundsLen=${tournament.rounds} | now=${now} | OUT: liveRound=null latest=${latestFinished} next=${nextRoundNum} minToNext=${diffMin} pref=${latestFinished} label="Ongoing Scheduled"`);
            }

            // "Ongoing • RD{nextRound} in {X}h {Y}m" (orange)
            return {
                primaryText: 'Ongoing',
                secondaryText: ` • Round ${nextRoundNum} in ${formatDuration(diffMs)}`,
                statusColor: colors.ongoing, // Orange
                debugSource: 'ongoing_scheduled',
                selectedRound: nextRoundNum,
                preferredOpenRoundNumber: latestFinished
            };
        }

        if (__DEV__ && (tournament.slug.includes('tata') || tournament.slug.includes('steel'))) {
            console.log(`[HOME_CALC] ${tournament.slug} | liveOverride=${!!liveOverride} liveRound=${probeLiveRound} | roundsLen=${tournament.rounds} | now=${now} | OUT: liveRound=null latest=${latestFinished} next=${nextRoundNum} minToNext=${diffMin} pref=${latestFinished} label="Ongoing Generic"`);
        }

        // Generic Ongoing (No schedule info)
        return {
            primaryText: 'Ongoing',
            secondaryText: ` • Round ${latestFinished}`,
            statusColor: colors.ongoing,
            debugSource: 'ongoing_generic',
            selectedRound: latestFinished,
            preferredOpenRoundNumber: latestFinished
        };
    }

    // CASE 4: FINISHED / COMPLETED
    if (tournament.status === 'FINISHED' || (probeLatestFinished && probeLatestFinished >= total)) {
        return {
            primaryText: 'Completed',
            secondaryText: '',
            statusColor: colors.completed,
            debugSource: 'finished',
            selectedRound: latestFinished,
            preferredOpenRoundNumber: latestFinished
        };
    }

    // CASE 5: UPCOMING
    const timeToStart = nextRoundNum > 0 ? ` • Starts in ${formatDuration(diffMs)}` : '';
    return {
        primaryText: 'Upcoming',
        secondaryText: timeToStart,
        statusColor: colors.upcoming,
        debugSource: 'upcoming_future',
        selectedRound: 1,
        preferredOpenRoundNumber: 1
    };
}


// --- Bridge for Existing Components (Deprecation wrapper) ---

export function computeHomeRoundAndStatus(
    tournament: Tournament,
    cachedGames: GameSummary[],
    now: number,
    liveOverride?: {
        isLive: boolean | null;
        round?: number;
        lastUpdated?: number;
        nextRound?: { round: number, startsAt: number };
        latestFinished?: number;
    },
    isChecking?: boolean
) {
    return computeTournamentState(tournament, cachedGames, now, liveOverride, isChecking);
}

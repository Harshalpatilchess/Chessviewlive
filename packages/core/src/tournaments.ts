export interface Tournament {
    id: string;
    slug: string;
    name: string;
    dateRange: string;
    rounds?: number;
    location?: string;
    country?: string;
    isLive: boolean;
    status: 'ONGOING' | 'UPCOMING' | 'FINISHED';
    startDate: string; // ISO date
    endDate: string; // ISO date
}

// Real verified tournaments only
const REAL_TOURNAMENTS = [
    {
        id: 'tata-steel-masters-2026',
        slug: 'tata-steel-masters-2026',
        name: 'Tata Steel Chess 2026 Masters',
        startDate: '2026-01-16',
        endDate: '2026-02-01',
        rounds: 13,
        location: 'Wijk aan Zee',
        country: 'Netherlands',
    },
    {
        id: 'armenian-championship-2026',
        slug: 'armenian-championship-2026',
        name: 'Armenian Championship Highest League 2026',
        startDate: '2026-01-13',
        endDate: '2026-01-21',
        rounds: 9,
        location: 'Yerevan',
        country: 'Armenia',
    },
    {
        id: 'prague-open-2026',
        slug: 'prague-open-2026',
        name: 'Prague Open 2026 IM open A',
        startDate: '2026-01-05',
        endDate: '2026-01-12',
        rounds: 9,
        location: 'Prague',
        country: 'Czech Republic',
    },
];

function getTournamentStatus(startDate: string, endDate: string): 'ONGOING' | 'UPCOMING' | 'FINISHED' {
    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Set to start of day for fair comparison
    now.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    if (now >= start && now <= end) {
        return 'ONGOING';
    } else if (now < start) {
        return 'UPCOMING';
    } else {
        return 'FINISHED';
    }
}

function formatDateRange(startDate: string, endDate: string): string {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return `${startStr} - ${endStr}`;
}

export type TournamentActivity = 'LIVE' | 'ONGOING' | 'FINISHED' | 'UPCOMING';

function computeTournamentActivity(
    slug: string,
    startDate: string,
    endDate: string
): TournamentActivity {
    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Set to start of day for fair comparison
    now.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    // Check date-based status first
    if (now < start) {
        return 'UPCOMING';
    } else if (now > end) {
        return 'FINISHED';
    }

    // Tournament is within date window - check if games are in progress
    // Import lazily to avoid circular dependency
    const { getTournamentGames } = require('./games');
    const games = getTournamentGames(slug);
    const hasLiveGames = games.some((game: any) => game.isLive);

    return hasLiveGames ? 'LIVE' : 'ONGOING';
}

export function getTournaments(): Tournament[] {
    const tournaments = REAL_TOURNAMENTS.map(t => {
        const status = getTournamentStatus(t.startDate, t.endDate);
        const activity = computeTournamentActivity(t.slug, t.startDate, t.endDate);
        return {
            ...t,
            status,
            isLive: activity === 'LIVE',
            dateRange: formatDateRange(t.startDate, t.endDate),
        };
    });

    // Sort: LIVE first, then ONGOING, then FINISHED, then UPCOMING
    return tournaments.sort((a, b) => {
        const aActivity = computeTournamentActivity(a.slug, a.startDate, a.endDate);
        const bActivity = computeTournamentActivity(b.slug, b.startDate, b.endDate);

        const activityOrder = { LIVE: 0, ONGOING: 1, FINISHED: 2, UPCOMING: 3 };
        const orderDiff = activityOrder[aActivity] - activityOrder[bActivity];

        if (orderDiff !== 0) return orderDiff;

        // Secondary sort within same bucket
        if (aActivity === 'LIVE' || aActivity === 'ONGOING') {
            // For active tournaments, sort by soonest end date first
            return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
        } else if (aActivity === 'FINISHED') {
            // For finished tournaments, most recently finished first
            return new Date(b.endDate).getTime() - new Date(a.endDate).getTime();
        }

        return 0;
    });
}

export function getLiveTournaments(): Tournament[] {
    return getTournaments().filter(t => t.isLive);
}

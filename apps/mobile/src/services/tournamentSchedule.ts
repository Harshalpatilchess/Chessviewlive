import { TATA_STEEL_2026_SLUG } from './tataSteel';

export interface RoundSchedule {
    round: number;
    startTime: string; // ISO string
}

const TATA_STEEL_2026_SCHEDULE: RoundSchedule[] = [
    { round: 1, startTime: '2026-01-17T13:00:00Z' }, // 14:00 CET
    { round: 2, startTime: '2026-01-18T13:00:00Z' },
    { round: 3, startTime: '2026-01-19T13:00:00Z' },
    { round: 4, startTime: '2026-01-20T13:00:00Z' },
    // Jan 21 Rest
    { round: 5, startTime: '2026-01-22T13:00:00Z' },
    { round: 6, startTime: '2026-01-23T13:00:00Z' },
    { round: 7, startTime: '2026-01-24T13:00:00Z' },
    { round: 8, startTime: '2026-01-25T13:00:00Z' },
    // Jan 26 Rest
    { round: 9, startTime: '2026-01-27T13:00:00Z' },
    { round: 10, startTime: '2026-01-28T13:00:00Z' },
    { round: 11, startTime: '2026-01-30T13:00:00Z' }, // Jan 29 Rest? Usually 3 rest days.
    { round: 12, startTime: '2026-01-31T13:00:00Z' },
    { round: 13, startTime: '2026-02-01T11:00:00Z' }, // Final round usually earlier (12:00 CET => 11:00 UTC)
];

export function getTournamentSchedule(slug: string): RoundSchedule[] {
    if (slug === TATA_STEEL_2026_SLUG) {
        return TATA_STEEL_2026_SCHEDULE;
    }
    return [];
}

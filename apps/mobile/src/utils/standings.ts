import type { GameSummary } from '@chessview/core';

export interface PlayerStanding {
    rank: number;
    name: string;
    title?: string;
    federation?: string;
    rating?: number;
    points: number;
    wins: number; // Tie-breaker
    gamesPlayed: number;
}

/**
 * Computes standings from a list of games.
 * Scoring: Win = 1, Draw = 0.5, Loss = 0
 * Tie-breakers:
 * 1. Points (desc)
 * 2. Wins (desc)
 * 3. Name (asc)
 */
export function computeStandingsFromGames(games: GameSummary[]): PlayerStanding[] {
    const playerStats = new Map<string, {
        points: number;
        wins: number;
        gamesPlayed: number;
        title?: string;
        federation?: string;
        rating?: number;
    }>();

    // Helper to init or get player stats
    const getStats = (name: string, title?: string, federation?: string, rating?: number) => {
        if (!playerStats.has(name)) {
            playerStats.set(name, {
                points: 0,
                wins: 0,
                gamesPlayed: 0,
                title,
                federation,
                rating,
            });
        }
        return playerStats.get(name)!;
    };

    games.forEach(game => {
        // Skip games that are not finished or don't have results effectively
        // Note: The prompt implies using all games data but focusing on finished results.
        // Derived points rely on '1', '½', '0'.

        // --- White ---
        const white = getStats(game.whiteName, game.whiteTitle, game.whiteFederation, game.whiteRating);
        if (game.whiteResult === '1') {
            white.points += 1;
            white.wins += 1;
            white.gamesPlayed += 1;
        } else if (game.whiteResult === '½') {
            white.points += 0.5;
            white.gamesPlayed += 1;
        } else if (game.whiteResult === '0') {
            white.gamesPlayed += 1;
        }

        // --- Black ---
        const black = getStats(game.blackName, game.blackTitle, game.blackFederation, game.blackRating);
        if (game.blackResult === '1') {
            black.points += 1;
            black.wins += 1;
            black.gamesPlayed += 1;
        } else if (game.blackResult === '½') {
            black.points += 0.5;
            black.gamesPlayed += 1;
        } else if (game.blackResult === '0') {
            black.gamesPlayed += 1;
        }
    });

    // Convert to array
    const standings = Array.from(playerStats.entries()).map(([name, stats]) => ({
        name,
        title: stats.title,
        federation: stats.federation,
        rating: stats.rating,
        points: stats.points,
        wins: stats.wins,
        gamesPlayed: stats.gamesPlayed,
        rank: 0, // Placeholder
    }));

    // Sort
    standings.sort((a, b) => {
        // 1. Points desc
        if (b.points !== a.points) return b.points - a.points;
        // 2. Wins desc
        if (b.wins !== a.wins) return b.wins - a.wins;
        // 3. Name asc
        return a.name.localeCompare(b.name);
    });

    // Assign ranks (handle ties visually if needed, but for now simple 1..N)
    // Detailed rank sharing (e.g. T-1) isn't requested, just "rank".
    // We will just iterate 1..N.
    standings.forEach((p, i) => {
        p.rank = i + 1;
    });

    return standings;
}

interface Tournament {
    id: string;
    slug: string;
    name: string;
    dateRange: string;
    rounds?: number;
    location?: string;
    country?: string;
    isLive: boolean;
    status: 'ONGOING' | 'UPCOMING' | 'FINISHED';
    startDate: string;
    endDate: string;
}
declare function getTournaments(): Tournament[];
declare function getLiveTournaments(): Tournament[];

interface GameSummary {
    gameId: string;
    whiteName: string;
    blackName: string;
    whiteTitle?: string;
    blackTitle?: string;
    whiteFederation?: string;
    blackFederation?: string;
    whiteRating?: number;
    blackRating?: number;
    isLive: boolean;
    whiteClock: string;
    blackClock: string;
    whiteResult?: string;
    blackResult?: string;
    fen: string;
    lastMove?: string;
    scoreCp?: number;
    evalCp?: number;
    pgn: string;
    round?: number;
    lastUpdatedAt: string;
}
declare function getTournamentGames(tournamentSlug: string): GameSummary[];

declare const BOARD_THEME: {
    readonly lightSquare: "#f0d9b5";
    readonly darkSquare: "#b58863";
    readonly whitePiece: "#ffffff";
    readonly blackPiece: "#444444";
};

declare const CORE_VERSION = "0.0.0";
declare function coreHello(): string;

export { BOARD_THEME, CORE_VERSION, type GameSummary, type Tournament, coreHello, getLiveTournaments, getTournamentGames, getTournaments };

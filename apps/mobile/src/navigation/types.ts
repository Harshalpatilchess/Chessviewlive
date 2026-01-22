export type RootStackParamList = {
    Tournaments: undefined;
    TournamentBoards: {
        tournamentSlug: string;
        tournamentName: string;
    };
    TournamentLeaderboard: {
        tournamentSlug: string;
        tournamentName: string;
    };
    Game: {
        gameId: string;
        tournamentSlug: string;
        tournamentName: string;
        round: number;
        whiteName: string;
        blackName: string;
        whiteTitle?: string;
        blackTitle?: string;
        whiteFederation?: string;
        blackFederation?: string;
        whiteRating?: number;
        blackRating?: number;
        whiteClock: string;
        blackClock: string;
        whiteResult?: string;
        blackResult?: string;
        isLive: boolean;
        fen: string;
        pgn: string;
        lastMove?: string;
        boardNumber?: number;
        evalCp?: number; // Evaluation in centipawns (optional)
    };
    Settings: undefined;
    FavouritePlayers: undefined;
    ChooseCountry: undefined;
    BoardDesign: undefined;
    Help: undefined;
};

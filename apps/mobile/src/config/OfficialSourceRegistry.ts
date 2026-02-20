export interface OfficialSourceConfig {
    officialRoundPgnUrlTemplate?: string;
    officialTournamentPgnUrl?: string;
    liveChessCloudEventId?: string;
}

export const OfficialSourceRegistry: Record<string, OfficialSourceConfig> = {
    // Example:
    // 'tata-steel-masters-2026': { 
    //     officialRoundPgnUrlTemplate: 'https://tatasteelchess.com/.../round-{round}.pgn' 
    // }
};

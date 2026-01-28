export const CORE_VERSION = "0.0.0";

export function coreHello() {
  return "core-ok";
}

// Tournament registry
export { getTournaments, getLiveTournaments } from './tournaments';
export type { Tournament } from './tournaments';

// Game data
export { getTournamentGames } from './games';
export type { GameSummary } from './games';

// Board theme
export { BOARD_THEME } from './board-theme';


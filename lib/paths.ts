export function buildBoardPaths(boardId: string, tournamentId?: string) {
  const base = tournamentId ? `/t/${encodeURIComponent(tournamentId)}` : "";
  return {
    live: `${base}/live/${encodeURIComponent(boardId)}`,
    organizer: `${base}/organizer/${encodeURIComponent(boardId)}`,
    replay: `${base}/replay/${encodeURIComponent(boardId)}`,
  };
}

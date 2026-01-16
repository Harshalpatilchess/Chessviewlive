export function formatBoardLabel(boardId?: string | null): string {
  const raw = (boardId ?? "").trim();
  if (!raw) {
    return "Board";
  }
  if (/^board\b/i.test(raw)) {
    return raw;
  }
  if (/^\d+$/.test(raw)) {
    return `Board ${Number(raw)}`;
  }
  return `Board ${raw}`;
}

export function formatBoardContextLabel(boardId?: string | null, tournamentId?: string | null) {
  const boardLabel = formatBoardLabel(boardId);
  const tournamentRaw = (tournamentId ?? "").trim();
  if (tournamentRaw) {
    return `${tournamentRaw} • ${boardLabel}`;
  }
  return boardLabel;
}

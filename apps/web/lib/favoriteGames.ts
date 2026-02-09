import { normalizeTournamentSlug } from "@/lib/boardId";
import { getBroadcastTournament } from "@/lib/broadcasts/catalog";
import { getTournamentConfig } from "@/lib/tournamentCatalog";

export type FavoriteGameEntry = {
  id: string;
  tournamentSlug: string;
  tournamentName: string;
  round: number;
  roundLabel: string;
  boardId: string;
  boardLabel: string;
  whitePlayer?: string | null;
  blackPlayer?: string | null;
  fen?: string | null;
  pane?: "notation" | "live" | "boards" | "engine";
  mode: "live" | "replay";
  updatedAt: number;
};

export const FAVORITES_UPDATED_EVENT = "favorite-games-updated";

const STORAGE_KEY = "chessviewlive.favoriteGames";

const normalizeDashes = (value: string) => value.replace(/[–—]/g, " - ");

export const resolveTournamentName = (slug: string) => {
  const normalizedSlug = normalizeTournamentSlug(slug);
  const configName = getTournamentConfig(normalizedSlug)?.name;
  if (configName) return normalizeDashes(configName);
  const broadcastName = getBroadcastTournament(normalizedSlug)?.title;
  if (broadcastName) return normalizeDashes(broadcastName);
  return normalizedSlug.replace(/-/g, " ");
};

const emitFavoritesUpdated = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FAVORITES_UPDATED_EVENT));
};

const isFavoriteEntry = (value: unknown): value is FavoriteGameEntry => {
  if (!value || typeof value !== "object") return false;
  const record = value as FavoriteGameEntry;
  return (
    typeof record.id === "string" &&
    typeof record.boardId === "string" &&
    typeof record.tournamentSlug === "string" &&
    typeof record.tournamentName === "string" &&
    typeof record.round === "number" &&
    typeof record.roundLabel === "string" &&
    typeof record.boardLabel === "string" &&
    typeof record.mode === "string" &&
    typeof record.updatedAt === "number"
  );
};

const readFavorites = (): FavoriteGameEntry[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFavoriteEntry);
  } catch {
    return [];
  }
};

const writeFavorites = (entries: FavoriteGameEntry[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    emitFavoritesUpdated();
  } catch {
    // ignore storage errors
  }
};

export function listFavorites(): FavoriteGameEntry[] {
  const entries = readFavorites();
  const deduped = new Map<string, FavoriteGameEntry>();
  for (const entry of entries) {
    const existing = deduped.get(entry.id);
    if (!existing || entry.updatedAt > existing.updatedAt) {
      deduped.set(entry.id, entry);
    }
  }
  return Array.from(deduped.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function isFavorite(id: string): boolean {
  if (!id) return false;
  return listFavorites().some(entry => entry.id === id);
}

export function toggleFavorite(entry: FavoriteGameEntry): boolean {
  if (typeof window === "undefined") return false;
  const entries = readFavorites();
  const exists = entries.some(item => item.id === entry.id);
  if (exists) {
    writeFavorites(entries.filter(item => item.id !== entry.id));
    return false;
  }
  const nextEntry = { ...entry, updatedAt: Date.now() };
  const filtered = entries.filter(item => item.id !== entry.id);
  writeFavorites([nextEntry, ...filtered]);
  return true;
}

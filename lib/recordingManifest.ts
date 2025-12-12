export type RecordingManifest = {
  boardId: string;
  roomId: string;
  egressId?: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  mp4Key?: string;
  mp4SizeBytes?: number;
  tournamentId?: string;
  publisherIdentity?: string;
  notes?: string;
  version: 1;
};

export const MANIFEST_EXT = ".json";

export function manifestKey(prefix: string, boardId: string, stamp: string) {
  const cleanPrefix = prefix.replace(/\/?$/, "/");
  const encodedBoard = encodeURIComponent(boardId).replace(/%2F/gi, "/");
  return `${cleanPrefix}${encodedBoard}/${stamp}${MANIFEST_EXT}`;
}

export function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function manifestKeyForStamp(boardId: string, stamp: string) {
  const encodedBoard = encodeURIComponent(boardId).replace(/%2F/gi, "/");
  return `${encodedBoard}/${stamp}${MANIFEST_EXT}`;
}

export function isManifestKey(key: string) {
  return key.toLowerCase().endsWith(MANIFEST_EXT.toLowerCase());
}

export function isMp4Key(key: string) {
  return key.toLowerCase().endsWith(".mp4");
}

export function stampFromKey(key: string): string | null {
  if (!key) return null;
  const last = key.split("/").pop() || key;
  if (isManifestKey(last)) {
    return last.slice(0, -MANIFEST_EXT.length);
  }
  if (isMp4Key(last)) {
    return last.replace(/\.mp4$/i, "");
  }
  return null;
}

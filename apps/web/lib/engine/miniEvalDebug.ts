"use client";

type ForceEvalEntry = {
  fenHash: string;
  nonce: string;
};

const forceEvalQueue = new Map<string, ForceEvalEntry>();
const requestedKeys = new Set<string>();

const buildKey = (boardId: string, fenHash: string) => `${boardId}::${fenHash}`;

export const queueForceEval = (boardId: string, fenHash: string): string => {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  forceEvalQueue.set(boardId, { fenHash, nonce });
  requestedKeys.delete(buildKey(boardId, fenHash));
  return nonce;
};

export const peekForceEval = (boardId: string, fenHash: string): string | null => {
  const key = buildKey(boardId, fenHash);
  if (requestedKeys.has(key)) return null;
  const entry = forceEvalQueue.get(boardId);
  if (!entry || entry.fenHash !== fenHash) return null;
  return entry.nonce;
};

export const consumeForceEval = (boardId: string, fenHash: string): string | null => {
  const key = buildKey(boardId, fenHash);
  if (requestedKeys.has(key)) return null;
  const entry = forceEvalQueue.get(boardId);
  if (!entry || entry.fenHash !== fenHash) return null;
  requestedKeys.add(key);
  forceEvalQueue.delete(boardId);
  return entry.nonce;
};

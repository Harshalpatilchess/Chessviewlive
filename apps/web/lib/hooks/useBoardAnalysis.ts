"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { pliesToFenAt, type Ply } from "@/lib/chess/pgn";
import { DEFAULT_TOURNAMENT_SLUG, normalizeBoardIdentifier, normalizeTournamentSlug } from "@/lib/boardId";

const ANALYSIS_STORAGE_VERSION = 1;
const ANALYSIS_STORAGE_KEY_PREFIX = "chessviewlive:analysis:v1:";

export type AnalysisNode = {
  id: string;
  san: string;
  fenAfter: string;
  parentId: string | null;
  children: string[];
  mainChildId: string | null;
};

export type AnalysisBranch = {
  anchorPly: number;
  anchorFullmoveNumber: number;
  anchorTurn: "w" | "b";
  startFen: string;
  rootChildren: string[];
  rootMainChildId: string | null;
  nodesById: Record<string, AnalysisNode>;
};

type AnalysisStoragePayloadV1 = {
  version: number;
  savedAt?: number;
  analysisBranches: AnalysisBranch[];
  activeAnalysisAnchorPly: number | null;
  analysisCursorNodeId: string | null;
  analysisViewActive?: boolean;
};

type UseBoardAnalysisOptions = {
  boardId: string;
  tournamentId?: string | null;
  plies: Ply[];
  currentMoveIndex: number;
  officialFen: string;
  onOfficialPrev: () => void;
  onOfficialNext: () => void;
};

type UseBoardAnalysisResult = {
  analysisViewActive: boolean;
  analysisBranches: AnalysisBranch[];
  activeAnalysisAnchorPly: number | null;
  analysisCursorNodeId: string | null;
  displayFen: string;
  exitAnalysisView: () => void;
  selectAnalysisMove: (anchorPly: number, nodeId: string | null) => void;
  promoteAnalysisNode: (anchorPly: number, nodeId: string) => void;
  deleteAnalysisLine: (anchorPly: number, nodeId: string) => void;
  deleteAnalysisFromHere: (anchorPly: number, nodeId: string) => void;
  onPieceDrop: (sourceSquare: string, targetSquare: string, piece: string) => boolean;
};

const parseFenStartMeta = (fen: string): { fullmoveNumber: number; turn: "w" | "b" } | null => {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const turn = parts[1] === "b" ? "b" : "w";
  const fullmoveRaw = Number.parseInt(parts[5] ?? "1", 10);
  const fullmoveNumber = Number.isFinite(fullmoveRaw) && fullmoveRaw > 0 ? fullmoveRaw : 1;
  return { fullmoveNumber, turn };
};

const normalizeFen = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeBoardIdForStorage = (rawId: string, tournamentId?: string | null): string => {
  if (typeof rawId !== "string") return "unknown";
  const trimmed = rawId.trim();
  if (!trimmed) return "unknown";
  if (!/^[a-z0-9-]+-board\\d+\\.\\d+$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const fallbackSlug = normalizeTournamentSlug(tournamentId ?? undefined, DEFAULT_TOURNAMENT_SLUG);
  return normalizeBoardIdentifier(trimmed, fallbackSlug).normalizedBoardId;
};

const buildAnalysisNodeId = (anchorPly: number, parentId: string | null, san: string): string => {
  const anchorKey = Number.isFinite(anchorPly) ? String(anchorPly) : "0";
  const parentKey = parentId ?? "root";
  const sanKey = typeof san === "string" ? san : String(san);
  return `analysis:${anchorKey}:${parentKey}:${encodeURIComponent(sanKey)}`;
};

const isNodeInSubtree = (
  nodesById: Record<string, AnalysisNode> | null | undefined,
  candidateId: string,
  subtreeRootId: string
): boolean => {
  if (!nodesById || typeof candidateId !== "string" || typeof subtreeRootId !== "string") return false;
  let currentId: string | null = candidateId;
  const safetyLimit = 512;
  for (let safety = 0; safety < safetyLimit && currentId; safety += 1) {
    if (currentId === subtreeRootId) return true;
    const node: AnalysisNode | undefined = nodesById[currentId];
    currentId = node?.parentId ?? null;
  }
  return false;
};

const collectSubtreeNodeIds = (
  nodesById: Record<string, AnalysisNode> | null | undefined,
  rootId: string
): Set<string> => {
  const visited = new Set<string>();
  if (!nodesById || typeof rootId !== "string" || rootId.length === 0) return visited;
  const stack: string[] = [rootId];
  const safetyLimit = 2048;
  for (let safety = 0; safety < safetyLimit && stack.length > 0; safety += 1) {
    const current = stack.pop();
    if (!current) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = nodesById[current];
    const children = Array.isArray(node?.children) ? node.children : [];
    children.forEach(childId => {
      if (typeof childId === "string" && childId.length > 0 && !visited.has(childId)) {
        stack.push(childId);
      }
    });
  }
  return visited;
};

const collectDescendantNodeIds = (
  nodesById: Record<string, AnalysisNode> | null | undefined,
  rootId: string
): Set<string> => {
  const visited = new Set<string>();
  if (!nodesById || typeof rootId !== "string" || rootId.length === 0) return visited;
  const root = nodesById[rootId];
  const stack: string[] = Array.isArray(root?.children) ? [...root.children] : [];
  const safetyLimit = 2048;
  for (let safety = 0; safety < safetyLimit && stack.length > 0; safety += 1) {
    const current = stack.pop();
    if (!current) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = nodesById[current];
    const children = Array.isArray(node?.children) ? node.children : [];
    children.forEach(childId => {
      if (typeof childId === "string" && childId.length > 0 && !visited.has(childId)) {
        stack.push(childId);
      }
    });
  }
  return visited;
};

const inferPromotion = (piece: string, targetSquare: string): "q" | undefined => {
  if (typeof piece !== "string" || piece.length < 2) return undefined;
  if (piece[1] !== "P") return undefined;
  const rank = targetSquare?.[1];
  if (!rank) return undefined;
  if (piece.startsWith("w") && rank === "8") return "q";
  if (piece.startsWith("b") && rank === "1") return "q";
  return undefined;
};

export default function useBoardAnalysis({
  boardId,
  tournamentId,
  plies,
  currentMoveIndex,
  officialFen,
  onOfficialPrev,
  onOfficialNext,
}: UseBoardAnalysisOptions): UseBoardAnalysisResult {
  const [analysisViewActive, setAnalysisViewActive] = useState(false);
  const [analysisBranches, setAnalysisBranches] = useState<AnalysisBranch[]>([]);
  const [activeAnalysisAnchorPly, setActiveAnalysisAnchorPly] = useState<number | null>(null);
  const [analysisCursorNodeId, setAnalysisCursorNodeId] = useState<string | null>(null);
  const [analysisStorageHydrated, setAnalysisStorageHydrated] = useState(false);
  const analysisSaveTimeoutRef = useRef<number | null>(null);

  const analysisStorageKey = useMemo(() => {
    const normalizedBoardId = normalizeBoardIdForStorage(boardId, tournamentId);
    return `${ANALYSIS_STORAGE_KEY_PREFIX}${normalizedBoardId}`;
  }, [boardId, tournamentId]);

  const clearAnalysisForBoard = useCallback(() => {
    setAnalysisViewActive(false);
    setActiveAnalysisAnchorPly(null);
    setAnalysisCursorNodeId(null);
    setAnalysisBranches([]);
  }, []);

  useEffect(() => {
    setAnalysisStorageHydrated(false);
    clearAnalysisForBoard();
    if (typeof window === "undefined") return;

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value);
    const isStringArray = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every(item => typeof item === "string");
    const isAnalysisNodeLike = (value: unknown): value is AnalysisNode => {
      if (!isRecord(value)) return false;
      return (
        typeof value.id === "string" &&
        typeof value.san === "string" &&
        typeof value.fenAfter === "string" &&
        (typeof value.parentId === "string" || value.parentId === null) &&
        isStringArray(value.children) &&
        (typeof value.mainChildId === "string" || value.mainChildId === null)
      );
    };
    const isNodesByIdLike = (value: unknown): value is Record<string, AnalysisNode> => {
      if (!isRecord(value)) return false;
      for (const node of Object.values(value)) {
        if (!isAnalysisNodeLike(node)) return false;
      }
      return true;
    };
    const isAnalysisBranchLike = (value: unknown): value is AnalysisBranch => {
      if (!isRecord(value)) return false;
      return (
        typeof value.anchorPly === "number" &&
        Number.isFinite(value.anchorPly) &&
        typeof value.anchorFullmoveNumber === "number" &&
        Number.isFinite(value.anchorFullmoveNumber) &&
        (value.anchorTurn === "w" || value.anchorTurn === "b") &&
        typeof value.startFen === "string" &&
        isStringArray(value.rootChildren) &&
        (typeof value.rootMainChildId === "string" || value.rootMainChildId === null) &&
        isNodesByIdLike(value.nodesById)
      );
    };

    const removeInvalidPayload = () => {
      try {
        window.localStorage.removeItem(analysisStorageKey);
      } catch {}
    };

    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(analysisStorageKey);
    } catch {
      setAnalysisStorageHydrated(true);
      return;
    }

    if (!raw) {
      setAnalysisStorageHydrated(true);
      return;
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      removeInvalidPayload();
      setAnalysisStorageHydrated(true);
      return;
    }

    if (!isRecord(parsed) || parsed.version !== ANALYSIS_STORAGE_VERSION || !Array.isArray(parsed.analysisBranches)) {
      removeInvalidPayload();
      setAnalysisStorageHydrated(true);
      return;
    }

    const payload = parsed as unknown as AnalysisStoragePayloadV1;
    const branchesCandidate = payload.analysisBranches;
    if (!Array.isArray(branchesCandidate) || !branchesCandidate.every(isAnalysisBranchLike)) {
      removeInvalidPayload();
      setAnalysisStorageHydrated(true);
      return;
    }

    const nextBranches = branchesCandidate;
    const anchorCandidate = payload.activeAnalysisAnchorPly;
    const nextAnchor =
      typeof anchorCandidate === "number" && nextBranches.some(branch => branch.anchorPly === anchorCandidate)
        ? anchorCandidate
        : null;
    const activeBranch = nextAnchor == null ? null : nextBranches.find(branch => branch.anchorPly === nextAnchor) ?? null;
    const cursorCandidate = payload.analysisCursorNodeId;
    const nextCursor =
      typeof cursorCandidate === "string" && cursorCandidate.length > 0 && activeBranch?.nodesById?.[cursorCandidate]
        ? cursorCandidate
        : null;

    const restoreAnalysisView =
      payload.analysisViewActive === true && Boolean(activeBranch) && (nextCursor != null || nextAnchor != null);

    setAnalysisBranches(nextBranches);
    setActiveAnalysisAnchorPly(nextAnchor);
    setAnalysisCursorNodeId(nextCursor);
    setAnalysisViewActive(restoreAnalysisView);
    setAnalysisStorageHydrated(true);
  }, [analysisStorageKey, clearAnalysisForBoard, tournamentId]);

  useEffect(() => {
    if (!analysisStorageHydrated) return;
    if (typeof window === "undefined") return;

    if (analysisSaveTimeoutRef.current) {
      window.clearTimeout(analysisSaveTimeoutRef.current);
      analysisSaveTimeoutRef.current = null;
    }

    analysisSaveTimeoutRef.current = window.setTimeout(() => {
      const payload: AnalysisStoragePayloadV1 = {
        version: ANALYSIS_STORAGE_VERSION,
        savedAt: Date.now(),
        analysisBranches,
        activeAnalysisAnchorPly,
        analysisCursorNodeId,
        analysisViewActive,
      };
      try {
        if (!analysisBranches.length) {
          window.localStorage.removeItem(analysisStorageKey);
          return;
        }
        window.localStorage.setItem(analysisStorageKey, JSON.stringify(payload));
      } catch {}
    }, 300);

    return () => {
      if (analysisSaveTimeoutRef.current) {
        window.clearTimeout(analysisSaveTimeoutRef.current);
        analysisSaveTimeoutRef.current = null;
      }
    };
  }, [activeAnalysisAnchorPly, analysisBranches, analysisCursorNodeId, analysisStorageHydrated, analysisStorageKey, analysisViewActive]);

  const activeAnalysisBranch = useMemo(() => {
    if (activeAnalysisAnchorPly == null) return null;
    return analysisBranches.find(branch => branch.anchorPly === activeAnalysisAnchorPly) ?? null;
  }, [activeAnalysisAnchorPly, analysisBranches]);

  const displayFen = useMemo(() => {
    if (!analysisViewActive || !activeAnalysisBranch) return officialFen;
    if (!analysisCursorNodeId) return activeAnalysisBranch.startFen;
    const node = activeAnalysisBranch.nodesById?.[analysisCursorNodeId];
    return node?.fenAfter ?? activeAnalysisBranch.startFen;
  }, [activeAnalysisBranch, analysisCursorNodeId, analysisViewActive, officialFen]);
  const isOnOfficialMainline = useMemo(() => {
    const normalizedDisplayFen = normalizeFen(displayFen);
    const normalizedOfficialFen = normalizeFen(officialFen);
    return (
      normalizedDisplayFen !== null &&
      normalizedOfficialFen !== null &&
      normalizedDisplayFen === normalizedOfficialFen
    );
  }, [displayFen, officialFen]);

  const exitAnalysisView = useCallback(() => {
    setAnalysisViewActive(false);
    setAnalysisCursorNodeId(null);
  }, []);

  const selectAnalysisMove = useCallback((anchorPly: number, nodeId: string | null) => {
    setActiveAnalysisAnchorPly(anchorPly);
    setAnalysisCursorNodeId(nodeId);
    setAnalysisViewActive(true);
  }, []);

  const promoteAnalysisNode = useCallback((anchorPly: number, nodeId: string) => {
    if (typeof nodeId !== "string" || nodeId.trim().length === 0) return;
    setAnalysisBranches(prev =>
      prev.map(branch => {
        if (branch.anchorPly !== anchorPly) return branch;
        const node = branch.nodesById?.[nodeId];
        if (!node) return branch;
        const parentId = node.parentId;
        if (!parentId) {
          const rootChildren = Array.isArray(branch.rootChildren) ? branch.rootChildren : [];
          const nextRootChildren = [nodeId, ...rootChildren.filter(id => id !== nodeId)];
          return {
            ...branch,
            rootChildren: nextRootChildren,
            rootMainChildId: nodeId,
          };
        }
        const parentNode = branch.nodesById?.[parentId];
        if (!parentNode) return branch;
        const children = Array.isArray(parentNode.children) ? parentNode.children : [];
        const nextChildren = [nodeId, ...children.filter(id => id !== nodeId)];
        return {
          ...branch,
          nodesById: {
            ...branch.nodesById,
            [parentId]: { ...parentNode, children: nextChildren, mainChildId: nodeId },
          },
        };
      })
    );
  }, []);

  const deleteAnalysisLine = useCallback(
    (anchorPly: number, nodeId: string) => {
      if (typeof nodeId !== "string" || nodeId.trim().length === 0) return;
      const branch = analysisBranches.find(item => item.anchorPly === anchorPly) ?? null;
      const targetNode = branch?.nodesById?.[nodeId] ?? null;
      if (!branch || !targetNode) return;

      if (
        typeof activeAnalysisAnchorPly === "number" &&
        activeAnalysisAnchorPly === anchorPly &&
        typeof analysisCursorNodeId === "string" &&
        analysisCursorNodeId.length > 0 &&
        isNodeInSubtree(branch.nodesById, analysisCursorNodeId, nodeId)
      ) {
        setAnalysisCursorNodeId(targetNode.parentId ?? null);
      }

      setAnalysisBranches(prev =>
        prev.map(item => {
          if (item.anchorPly !== anchorPly) return item;
          const nodesById = item.nodesById ?? {};
          const node = nodesById[nodeId];
          if (!node) return item;
          const deleted = collectSubtreeNodeIds(nodesById, nodeId);
          if (deleted.size === 0) return item;

          const nextNodesById = Object.fromEntries(
            Object.entries(nodesById).filter(([id]) => !deleted.has(id))
          ) as Record<string, AnalysisNode>;

          if (!node.parentId) {
            const rootChildren = Array.isArray(item.rootChildren) ? item.rootChildren : [];
            const nextRootChildren = rootChildren.filter(id => !deleted.has(id));
            const nextRootMainChildId =
              item.rootMainChildId && !deleted.has(item.rootMainChildId)
                ? item.rootMainChildId
                : nextRootChildren[0] ?? null;
            return {
              ...item,
              rootChildren: nextRootChildren,
              rootMainChildId: nextRootMainChildId,
              nodesById: nextNodesById,
            };
          }

          const parentId = node.parentId;
          const parentNode = nextNodesById[parentId];
          if (!parentNode) {
            return { ...item, nodesById: nextNodesById };
          }
          const parentChildren = Array.isArray(parentNode.children) ? parentNode.children : [];
          const nextChildren = parentChildren.filter(childId => !deleted.has(childId));
          const nextMainChildId =
            parentNode.mainChildId && !deleted.has(parentNode.mainChildId)
              ? parentNode.mainChildId
              : nextChildren[0] ?? null;
          return {
            ...item,
            nodesById: {
              ...nextNodesById,
              [parentId]: { ...parentNode, children: nextChildren, mainChildId: nextMainChildId },
            },
          };
        })
      );
    },
    [activeAnalysisAnchorPly, analysisBranches, analysisCursorNodeId]
  );

  const deleteAnalysisFromHere = useCallback(
    (anchorPly: number, nodeId: string) => {
      if (typeof nodeId !== "string" || nodeId.trim().length === 0) return;
      const branch = analysisBranches.find(item => item.anchorPly === anchorPly) ?? null;
      const targetNode = branch?.nodesById?.[nodeId] ?? null;
      if (!branch || !targetNode) return;

      if (
        typeof activeAnalysisAnchorPly === "number" &&
        activeAnalysisAnchorPly === anchorPly &&
        typeof analysisCursorNodeId === "string" &&
        analysisCursorNodeId.length > 0 &&
        analysisCursorNodeId !== nodeId &&
        isNodeInSubtree(branch.nodesById, analysisCursorNodeId, nodeId)
      ) {
        setAnalysisCursorNodeId(nodeId);
      }

      setAnalysisBranches(prev =>
        prev.map(item => {
          if (item.anchorPly !== anchorPly) return item;
          const nodesById = item.nodesById ?? {};
          const node = nodesById[nodeId];
          if (!node) return item;
          const deleted = collectDescendantNodeIds(nodesById, nodeId);
          const nextNodesById = Object.fromEntries(
            Object.entries(nodesById).filter(([id]) => !deleted.has(id))
          ) as Record<string, AnalysisNode>;
          const updatedNode = nextNodesById[nodeId];
          if (!updatedNode) return item;
          nextNodesById[nodeId] = { ...updatedNode, children: [], mainChildId: null };
          return { ...item, nodesById: nextNodesById };
        })
      );
    },
    [activeAnalysisAnchorPly, analysisBranches, analysisCursorNodeId]
  );

  const onPieceDrop = useCallback(
    (sourceSquare: string, targetSquare: string, piece: string) => {
      const baseFen = displayFen;
      const game = (() => {
        try {
          return new Chess(baseFen);
        } catch {
          return null;
        }
      })();
      if (!game) return false;

      const promotion = inferPromotion(piece, targetSquare);
      const move = (() => {
        try {
          return game.move({ from: sourceSquare, to: targetSquare, promotion });
        } catch {
          return null;
        }
      })();

      if (!move) return false;
      if (
        (!move.san || typeof move.san !== "string") &&
        typeof process !== "undefined" &&
        process.env.NODE_ENV !== "production"
      ) {
        console.warn("[drag-to-analyze] missing SAN for legal move", {
          sourceSquare,
          targetSquare,
          piece,
          move,
          baseFen,
        });
      }

      const nextFen = game.fen();

      if (isOnOfficialMainline) {
        const nextPlyIndex = currentMoveIndex + 1;
        const officialNextFen = nextPlyIndex >= 0 && nextPlyIndex < plies.length ? plies[nextPlyIndex].fen : null;
        const normalizedOfficialNextFen = normalizeFen(officialNextFen);
        const normalizedNextFen = normalizeFen(nextFen);
        if (
          normalizedOfficialNextFen !== null &&
          normalizedNextFen !== null &&
          normalizedOfficialNextFen === normalizedNextFen
        ) {
          exitAnalysisView();
          onOfficialNext();
          return true;
        }
      }

      const analysisBranchUsable = analysisViewActive && !isOnOfficialMainline;
      const anchorPly =
        analysisBranchUsable && typeof activeAnalysisAnchorPly === "number" ? activeAnalysisAnchorPly : currentMoveIndex;
      const anchorOfficialFen = pliesToFenAt(plies, anchorPly);
      const meta = parseFenStartMeta(anchorOfficialFen) ?? { fullmoveNumber: 1, turn: "w" as const };
      const san =
        typeof move.san === "string" && move.san.trim().length > 0 ? move.san.trim() : `${sourceSquare}-${targetSquare}`;
      const isEditingActiveBranch =
        analysisBranchUsable &&
        typeof activeAnalysisAnchorPly === "number" &&
        activeAnalysisAnchorPly === anchorPly &&
        Boolean(activeAnalysisBranch);
      const parentIdCandidate = isEditingActiveBranch ? analysisCursorNodeId : null;
      const parentId =
        parentIdCandidate && activeAnalysisBranch?.nodesById?.[parentIdCandidate] ? parentIdCandidate : null;
      const nodeId = buildAnalysisNodeId(anchorPly, parentId, san);

      setAnalysisBranches(prev => {
        const existingIndex = prev.findIndex(branch => branch.anchorPly === anchorPly);
        if (existingIndex >= 0) {
          const existing = prev[existingIndex];
          const existingNodesById =
            existing.nodesById && typeof existing.nodesById === "object" ? existing.nodesById : {};
          const nextNodesById: Record<string, AnalysisNode> = { ...existingNodesById };
          if (!nextNodesById[nodeId]) {
            nextNodesById[nodeId] = {
              id: nodeId,
              san,
              fenAfter: nextFen,
              parentId,
              children: [],
              mainChildId: null,
            };
          }

          let nextRootChildren = Array.isArray(existing.rootChildren) ? existing.rootChildren : [];
          let nextRootMainChildId = existing.rootMainChildId ?? null;

          if (!parentId) {
            if (!nextRootChildren.includes(nodeId)) {
              nextRootChildren = [...nextRootChildren, nodeId];
            }
            if (!nextRootMainChildId) {
              nextRootMainChildId = nodeId;
            }
          } else {
            const parentNode = nextNodesById[parentId];
            if (parentNode) {
              const parentChildren = Array.isArray(parentNode.children) ? parentNode.children : [];
              const nextChildren = parentChildren.includes(nodeId) ? parentChildren : [...parentChildren, nodeId];
              const nextMainChildId = parentNode.mainChildId ?? nodeId;
              if (nextChildren !== parentChildren || nextMainChildId !== parentNode.mainChildId) {
                nextNodesById[parentId] = { ...parentNode, children: nextChildren, mainChildId: nextMainChildId };
              }
            }
          }

          const updated: AnalysisBranch = {
            ...existing,
            startFen: existing.startFen ?? anchorOfficialFen,
            anchorFullmoveNumber: existing.anchorFullmoveNumber ?? meta.fullmoveNumber,
            anchorTurn: existing.anchorTurn ?? meta.turn,
            rootChildren: nextRootChildren,
            rootMainChildId: nextRootMainChildId,
            nodesById: nextNodesById,
          };
          const next = [...prev];
          next[existingIndex] = updated;
          return next;
        }

        return [
          ...prev,
          {
            anchorPly,
            anchorFullmoveNumber: meta.fullmoveNumber,
            anchorTurn: meta.turn,
            startFen: anchorOfficialFen,
            rootChildren: [nodeId],
            rootMainChildId: nodeId,
            nodesById: {
              [nodeId]: {
                id: nodeId,
                san,
                fenAfter: nextFen,
                parentId: null,
                children: [],
                mainChildId: null,
              },
            },
          },
        ];
      });

      setActiveAnalysisAnchorPly(anchorPly);
      setAnalysisCursorNodeId(nodeId);
      setAnalysisViewActive(true);
      return true;
    },
    [
      activeAnalysisAnchorPly,
      activeAnalysisBranch,
      analysisCursorNodeId,
      analysisViewActive,
      currentMoveIndex,
      displayFen,
      exitAnalysisView,
      isOnOfficialMainline,
      onOfficialNext,
      plies,
    ]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const branch = activeAnalysisBranch;
      const analysisPositionActive = analysisViewActive && Boolean(branch) && !isOnOfficialMainline;
      const shouldClearStaleAnalysisState = analysisViewActive && isOnOfficialMainline;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        if (shouldClearStaleAnalysisState) {
          exitAnalysisView();
        }
        if (analysisPositionActive && branch) {
          setAnalysisCursorNodeId(prevCursorId => {
            const nodesById = branch.nodesById ?? {};
            if (!prevCursorId) {
              const rootMainChildId = branch.rootMainChildId;
              return rootMainChildId && nodesById[rootMainChildId] ? rootMainChildId : prevCursorId;
            }
            const node = nodesById[prevCursorId];
            if (!node) {
              const rootMainChildId = branch.rootMainChildId;
              return rootMainChildId && nodesById[rootMainChildId] ? rootMainChildId : prevCursorId;
            }
            const mainChildId = node.mainChildId;
            return mainChildId && nodesById[mainChildId] ? mainChildId : prevCursorId;
          });
          return;
        }
        onOfficialNext();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        if (shouldClearStaleAnalysisState) {
          exitAnalysisView();
        }
        if (analysisPositionActive && branch) {
          setAnalysisCursorNodeId(prevCursorId => {
            if (!prevCursorId) return prevCursorId;
            const node = branch.nodesById?.[prevCursorId];
            return node?.parentId ?? null;
          });
          return;
        }
        onOfficialPrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeAnalysisBranch, analysisViewActive, exitAnalysisView, isOnOfficialMainline, onOfficialNext, onOfficialPrev]);

  return {
    analysisViewActive,
    analysisBranches,
    activeAnalysisAnchorPly,
    analysisCursorNodeId,
    displayFen,
    exitAnalysisView,
    selectAnalysisMove,
    promoteAnalysisNode,
    deleteAnalysisLine,
    deleteAnalysisFromHere,
    onPieceDrop,
  };
}

import { useState, useEffect, useRef } from 'react';
import { engineCache } from '../services/engineCache';
import type { CloudEngineResponse, CloudEngineRequest, CloudEngineLine } from '../types/engine';

const API_URL = 'https://chessview.live/api/engine/eval';

// Default config matching "standard" profile from web
const DEFAULT_CONFIG = {
    movetimeMs: 2000, // Slightly conservative for mobile
    multiPv: 1,
    targetDepth: 20,
};

interface UseMobileEngineEvaluationOptions {
    enabled: boolean;
    fen: string;
}

export function useMobileEngineEvaluation({ enabled, fen }: UseMobileEngineEvaluationOptions) {
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [evalResult, setEvalResult] = useState<CloudEngineResponse | null>(null);
    const [bestLines, setBestLines] = useState<CloudEngineLine[]>([]);

    // Refs for debouncing and preventing race conditions
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const lastRequestFenRef = useRef<string | null>(null);

    useEffect(() => {
        // Cleanup previous requests/timers
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        if (abortControllerRef.current) abortControllerRef.current.abort();

        if (!enabled || !fen) {
            setIsEvaluating(false);
            setEvalResult(null);
            setBestLines([]);
            return;
        }

        // Check cache first
        const cached = engineCache.get(fen);
        if (cached) {
            setEvalResult(cached);
            setBestLines(cached.lines || []);
            setIsEvaluating(false);
            return;
        }

        setIsEvaluating(true);

        // Debounce network request
        debounceTimerRef.current = setTimeout(() => {
            fetchEvaluation(fen);
        }, 500); // 500ms debounce

        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, [enabled, fen]);

    const fetchEvaluation = async (fenToEval: string) => {
        abortControllerRef.current = new AbortController();
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const payload: CloudEngineRequest = {
            fen: fenToEval,
            requestId,
            multiPv: DEFAULT_CONFIG.multiPv,
            movetimeMs: DEFAULT_CONFIG.movetimeMs,
            targetDepth: DEFAULT_CONFIG.targetDepth,
            searchMode: 'time', // safer default for fast response
            profileId: 'standard',
        };

        try {
            lastRequestFenRef.current = fenToEval;

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                console.warn('[Engine] Eval request failed', response.status);
                setIsEvaluating(false);
                return;
            }

            const data: CloudEngineResponse = await response.json();

            // Ignore if we've moved on to another FEN substantially or aborted
            if (lastRequestFenRef.current !== fenToEval) return;

            // Update state
            setEvalResult(data);
            setBestLines(data.lines || []);
            setIsEvaluating(false);

            // Cache it
            engineCache.set(fenToEval, data);

        } catch (error: any) {
            if (error.name !== 'AbortError') {
                console.warn('[Engine] Error fetching eval:', error);
                setIsEvaluating(false);
            }
        }
    };

    return {
        isEvaluating,
        evalResult,
        bestLines,
    };
}

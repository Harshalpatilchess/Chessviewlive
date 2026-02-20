import { Chess } from 'chess.js';

export interface PgnParseResult {
    ok: boolean;
    sanMoves: string[];
    finalFen?: string;
    lastMove?: string; // UCI format e.g. "e2e4"
    error?: string;
}

/**
 * Robustly parses a PGN string to extract the mainline moves.
 * Handles variations, comments, NAGs, and other common PGN noise.
 */
export function parsePgnToMainlineMoves(pgn: string): PgnParseResult {
    if (!pgn || !pgn.trim()) {
        return { ok: false, sanMoves: [], error: 'Empty PGN' };
    }

    // 1. First try: Direct parse (Fast path)
    try {
        const chess = new Chess();
        chess.loadPgn(pgn);
        const historyVerbose = chess.history({ verbose: true });
        const lastMoveObj = historyVerbose.length > 0 ? historyVerbose[historyVerbose.length - 1] : undefined;
        if (chess.history().length > 0) {
            return {
                ok: true,
                sanMoves: chess.history(),
                finalFen: chess.fen(),
                lastMove: lastMoveObj ? (lastMoveObj.from + lastMoveObj.to) : undefined,
            };
        }
    } catch (e) {
        // Fall through to sanitization if direct parse fails
    }

    // 2. Sanitization Path (Robust path)
    try {
        const sanitizedMoves = sanitizePgnMoves(pgn);

        // If sanitization resulted in empty string, it means headers existed but no moves
        // This is valid! It's a game that hasn't started or just has headers.
        if (!sanitizedMoves.trim()) {
            return { ok: true, sanMoves: [], finalFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' };
        }

        const chess = new Chess();
        // Load with headers stripped, just moves
        chess.loadPgn(sanitizedMoves);

        const historyVerbose = chess.history({ verbose: true });
        const lastMoveObj = historyVerbose.length > 0 ? historyVerbose[historyVerbose.length - 1] : undefined;

        if (historyVerbose.length > 0) {
            return {
                ok: true,
                sanMoves: chess.history(), // Use plain history
                finalFen: chess.fen(),
                lastMove: lastMoveObj ? (lastMoveObj.from + lastMoveObj.to) : undefined,
            };
        } else {
            // If loadPgn worked but history is empty, that's also valid (no moves)
            return { ok: true, sanMoves: [], finalFen: chess.fen() };
        }
    } catch (e: any) {
        return { ok: false, sanMoves: [], error: e.message || 'Unknown error' };
    }
}

/**
 * Extracts and cleans the move text from a PGN, removing headers, comments, variations, etc.
 */
function sanitizePgnMoves(pgn: string): string {
    // 1. Normalize line endings
    let text = pgn.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 2. Strip BOM
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }

    // 3. Separate headers from moves
    const lines = text.split('\n');
    let moveStartIndex = 0;
    let inHeaders = true;

    // Naively look for first blank line or first line not starting with bracket
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (inHeaders) {
            if (line === '') {
                inHeaders = false;
                moveStartIndex = i + 1;
            } else if (!line.startsWith('[')) {
                // Found a non-header line without preceding gap
                inHeaders = false;
                moveStartIndex = i;
            }
        }
    }

    // 4. Process move lines: remove line comments (;)
    const contentLines = lines.slice(moveStartIndex).map(l => {
        const idx = l.indexOf(';');
        return idx !== -1 ? l.substring(0, idx) : l;
    });

    let moveText = contentLines.join(' ');

    // 5. Remove { ... } comments (Simple regex for non-nested)
    // Note: Replaces with space to avoid merging tokens
    moveText = moveText.replace(/\{[^}]*\}/g, ' ');

    // 6. Remove NAGs ($1, $20, etc)
    moveText = moveText.replace(/\$\d+/g, ' ');

    // 7. Remove recursive variations (...)
    moveText = removeParentheses(moveText);

    // 8. Remove score like 1-0, 0-1, 1/2-1/2, * at the end
    // (chess.js sometimes handles this, but safer to remove for pure move list)
    moveText = moveText.replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, '');

    // 9. Trim and normalize whitespace
    moveText = moveText.replace(/\s+/g, ' ').trim();

    return moveText;
}

/**
 * Recursively removes parenthesized content (variations)
 */
function removeParentheses(str: string): string {
    let result = '';
    let depth = 0;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            if (depth > 0) depth--;
        } else {
            if (depth === 0) {
                result += char;
            }
        }
    }

    // If parentheses were unbalanced (more ( than )), we might have stripped too much or weirdness.
    // Ideally we assume valid nesting or at least matching.
    return result;
}

/**
 * Extracts clock times from PGN move comments like [%clk 1:30:05]
 * Returns undefined for missing clocks.
 */
export function extractClocks(pgn: string, turn: 'w' | 'b'): { white?: string; black?: string } {
    if (!pgn) return {};

    // Find all matches of [%clk value]
    const matches = Array.from(pgn.matchAll(/\[%clk\s+([\d:.]+)(?:\.\d+)?\]/g));

    if (matches.length === 0) return {};

    // Logic:
    // If it is White's turn to move (turn === 'w'), it means Black just moved.
    // So the LAST clock timestamp belongs to Black.
    // The match BEFORE that belongs to White.
    // Conversely, if turn === 'b', White just moved => Last clock is White, Prev is Black.

    // However, PGN structure is: 1. e4 { [%clk 0:05] } e5 { [%clk 0:05] }
    // The timestamp appears AFTER the move.

    // Case 1: Game just started (no moves). Matches = 0. Handled.
    // Case 2: 1 move (White moved). Turn = 'b'. Matches = 1. That match is White's clock.
    // Case 3: 2 moves (White then Black). Turn = 'w'. Matches = 2. Last is Black, Prev is White.

    const lastMatch = matches[matches.length - 1][1];
    const prevMatch = matches.length > 1 ? matches[matches.length - 2][1] : undefined;

    // Format helper: ensure "h:mm:ss" or "mm:ss"
    const fmt = (t: string) => {
        // Lichess sometimes sends 0:05:00. Convert to canonical if needed.
        // For now, trust the string, but maybe strip milliseconds?
        // Our regex (?:\\.\\d+)? already ignored the milliseconds group capture, 
        // but `[\d:.]+` includes them? Ah, regex above is `([\d:.]+)(?:\.\d+)?`
        // Wait, `[\d:.]` matches dots too. 
        // Standard format: 1:00:00 or 15:00.
        return t;
    };

    if (turn === 'b') {
        // White just moved. Last clock is White.
        // Black hasn't moved yet in this ply, or moved in previous ply.
        // If only 1 match exists, Black clock is unknown (or start time).
        return {
            white: fmt(lastMatch),
            black: prevMatch ? fmt(prevMatch) : undefined
        };
    } else {
        // Turn = 'w'. Black just moved. Last clock is Black.
        // White moved previously.
        return {
            white: prevMatch ? fmt(prevMatch) : undefined,
            black: fmt(lastMatch)
        };
    }
}

/**
 * Helper to get active color from FEN
 */
export function getTurnFromFen(fen: string): 'w' | 'b' {
    if (!fen) return 'w';
    const parts = fen.split(' ');
    // fen: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
    // part[1] is 'w' or 'b'
    return (parts[1] === 'b') ? 'b' : 'w';
}

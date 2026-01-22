import type { MoveType } from './soundManager';

/**
 * Classifies a chess move into one of three types: normal, capture, or castle
 * 
 * Classification priority:
 * 1. Check for castling from UCI notation (king moves)
 * 2. Check for captures (requires SAN or FEN comparison)
 * 3. Default to normal move
 * 
 * @param lastMove - UCI format move (e.g., "e2e4", "e1g1")
 * @param san - Optional SAN notation (e.g., "Nf3", "exd5", "O-O")
 * @returns Move type for sound selection
 */
export function classifyMoveType(
    lastMove: string,
    san?: string
): MoveType {
    // Priority 1: Check SAN if available
    if (san) {
        // Castling: O-O (kingside) or O-O-O (queenside)
        if (san.includes('O-O')) {
            return 'castle';
        }
        // Capture: contains 'x'
        if (san.includes('x')) {
            return 'capture';
        }
        return 'normal';
    }

    // Priority 2: Check UCI for castling patterns
    // King moving two squares horizontally indicates castling
    const castlingMoves = ['e1g1', 'e1c1', 'e8g8', 'e8c8'];
    if (castlingMoves.includes(lastMove.toLowerCase())) {
        return 'castle';
    }

    // Priority 3: For captures, we would need:
    // - Previous FEN to check if destination had a piece
    // - Or explicit capture metadata
    // Without these, we can't reliably detect captures from UCI alone

    // TODO: Add capture detection when SAN is available or FEN comparison is implemented

    return 'normal';
}

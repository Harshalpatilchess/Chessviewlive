import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface ArrowOverlayProps {
    fromSquare: string; // UCI format: e.g., 'e2'
    toSquare: string; // UCI format: e.g., 'e4'
    squareSize: number;
    flipped: boolean;
}

// Convert UCI square (e.g., 'e2') to board coordinates
function uciToCoords(square: string, flipped: boolean): { rank: number; file: number } | null {
    if (square.length !== 2) return null;
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0-7
    const rank = 8 - parseInt(square[1]); // Convert 1-8 to 0-7 (inverted for display)
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;

    // If flipped, reverse both rank and file
    if (flipped) {
        return { rank: 7 - rank, file: 7 - file };
    }

    return { rank, file };
}

const ArrowOverlay: React.FC<ArrowOverlayProps> = ({ fromSquare, toSquare, squareSize, flipped }) => {
    const fromCoords = uciToCoords(fromSquare, flipped);
    const toCoords = uciToCoords(toSquare, flipped);

    if (!fromCoords || !toCoords) return null;

    // Calculate center points of squares
    const fromX = fromCoords.file * squareSize + squareSize / 2;
    const fromY = fromCoords.rank * squareSize + squareSize / 2;
    const toX = toCoords.file * squareSize + squareSize / 2;
    const toY = toCoords.rank * squareSize + squareSize / 2;

    // Calculate arrow geometry
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const length = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);

    // Arrow dimensions (relative to square size) - EXTRA LARGE for maximum visibility
    const headLength = squareSize * 0.45;
    const headWidth = squareSize * 0.4;
    const bodyWidth = squareSize * 0.28;

    // Shorten arrow to avoid overlapping piece centers
    const padding = squareSize * 0.25;
    const adjustedLength = Math.max(0, length - padding * 2);
    const startX = fromX + Math.cos(angle) * padding;
    const startY = fromY + Math.sin(angle) * padding;
    const endX = startX + Math.cos(angle) * adjustedLength;
    const endY = startY + Math.sin(angle) * adjustedLength;

    // Arrow path points
    const arrowPath = `
        M ${startX} ${startY - bodyWidth / 2}
        L ${endX - headLength} ${endY - bodyWidth / 2}
        L ${endX - headLength} ${endY - headWidth / 2}
        L ${endX} ${endY}
        L ${endX - headLength} ${endY + headWidth / 2}
        L ${endX - headLength} ${endY + bodyWidth / 2}
        L ${startX} ${startY + bodyWidth / 2}
        Z
    `;

    const boardSize = squareSize * 8;

    return (
        <View style={{ position: 'absolute', top: 0, left: 0, width: boardSize, height: boardSize, zIndex: 100 }} pointerEvents="none">
            <Svg width={boardSize} height={boardSize}>
                {/* Outer dark halo for maximum visibility */}
                <Path
                    d={arrowPath}
                    fill="rgba(0, 0, 0, 0.7)"
                    stroke="rgba(0, 0, 0, 0.8)"
                    strokeWidth={8}
                />
                {/* Inner shadow layer */}
                <Path
                    d={arrowPath}
                    fill="rgba(80, 20, 20, 0.6)"
                    stroke="rgba(40, 10, 10, 0.7)"
                    strokeWidth={6}
                />
                {/* Main bright red arrow - FollowChess style */}
                <Path
                    d={arrowPath}
                    fill="rgba(220, 50, 50, 0.85)"
                    stroke="rgba(180, 30, 30, 0.95)"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </Svg>
        </View>
    );
};

export default ArrowOverlay;

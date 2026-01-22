import React, { memo, useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Image, PixelRatio, Text as RNText, PanResponder, Animated } from 'react-native';
import { BOARD_THEME } from '@chessview/core';
import { useSettings } from '../contexts/SettingsContext';
import { getBoardTheme } from '../config/boardConfig';
import soundManager from '../utils/soundManager';
import { classifyMoveType } from '../utils/moveClassifier';

// Static piece asset mapping (Metro requires static requires)
const PIECE_ASSETS = {
    classic: {
        wK: require('../../assets/pieces/classic/wK.png'),
        wQ: require('../../assets/pieces/classic/wQ.png'),
        wR: require('../../assets/pieces/classic/wR.png'),
        wB: require('../../assets/pieces/classic/wB.png'),
        wN: require('../../assets/pieces/classic/wN.png'),
        wP: require('../../assets/pieces/classic/wP.png'),
        bK: require('../../assets/pieces/classic/bK.png'),
        bQ: require('../../assets/pieces/classic/bQ.png'),
        bR: require('../../assets/pieces/classic/bR.png'),
        bB: require('../../assets/pieces/classic/bB.png'),
        bN: require('../../assets/pieces/classic/bN.png'),
        bP: require('../../assets/pieces/classic/bP.png'),
    },
    cburnett: {
        wK: require('../../assets/pieces/classic/wK.png'), // Fallback
        wQ: require('../../assets/pieces/classic/wQ.png'),
        wR: require('../../assets/pieces/classic/wR.png'),
        wB: require('../../assets/pieces/classic/wB.png'),
        wN: require('../../assets/pieces/classic/wN.png'),
        wP: require('../../assets/pieces/classic/wP.png'),
        bK: require('../../assets/pieces/classic/bK.png'),
        bQ: require('../../assets/pieces/classic/bQ.png'),
        bR: require('../../assets/pieces/classic/bR.png'),
        bB: require('../../assets/pieces/classic/bB.png'),
        bN: require('../../assets/pieces/classic/bN.png'),
        bP: require('../../assets/pieces/classic/bP.png'),
    },
    premium: {
        wK: require('../../assets/pieces/premium/wK.png'),
        wQ: require('../../assets/pieces/premium/wQ.png'),
        wR: require('../../assets/pieces/premium/wR.png'),
        wB: require('../../assets/pieces/premium/wB.png'),
        wN: require('../../assets/pieces/premium/wN.png'),
        wP: require('../../assets/pieces/premium/wP.png'),
        bK: require('../../assets/pieces/premium/bK.png'),
        bQ: require('../../assets/pieces/premium/bQ.png'),
        bR: require('../../assets/pieces/premium/bR.png'),
        bB: require('../../assets/pieces/premium/bB.png'),
        bN: require('../../assets/pieces/premium/bN.png'),
        bP: require('../../assets/pieces/premium/bP.png'),
    },
} as const;

// Helper to safely get piece asset with fallback
const getPieceAsset = (piece: string, pieceSetId: string) => {
    const pieceSet = PIECE_ASSETS[pieceSetId as keyof typeof PIECE_ASSETS] || PIECE_ASSETS.classic;
    return pieceSet[piece as keyof typeof pieceSet] || PIECE_ASSETS.classic[piece as keyof typeof PIECE_ASSETS.classic];
};

interface MiniBoardProps {
    fen: string;
    size?: number;
    lastMove?: string; // UCI format: e.g., 'e2e4'
    flipped?: boolean; // If true, show board from Black's perspective
    onSquarePress?: (square: string) => void;
    onMove?: (from: string, to: string) => void;
    selectedSquare?: string | null;
    validMoves?: string[]; // Squares to highlight as valid destinations
}

// Convert UCI square (e.g., 'e2') to board coordinates
function uciToCoords(square: string, flipped: boolean = false): { rank: number; file: number } | null {
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

function parseFen(fen: string): (string | null)[][] {
    const board: (string | null)[][] = [];
    const position = fen.split(' ')[0]; // Get just the piece placement part
    const ranks = position.split('/');

    for (const rank of ranks) {
        const row: (string | null)[] = [];
        for (const char of rank) {
            if (char >= '1' && char <= '8') {
                // Empty squares
                const emptyCount = parseInt(char, 10);
                for (let i = 0; i < emptyCount; i++) {
                    row.push(null);
                }
            } else {
                // Piece
                row.push(char);
            }
        }
        board.push(row);
    }
    return board;
}

// Coordinate helper
const getSquareFromCoords = (x: number, y: number, squareSize: number, flipped: boolean): string | null => {
    const fileIndex = Math.floor(x / squareSize);
    const rankIndex = Math.floor(y / squareSize);

    if (fileIndex < 0 || fileIndex > 7 || rankIndex < 0 || rankIndex > 7) return null;

    // Visual to Logical mapping
    const logicalFileIndex = flipped ? 7 - fileIndex : fileIndex;
    const logicalRankIndex = flipped ? 7 - rankIndex : rankIndex;

    const rankLabel = flipped ? (1 + rankIndex) : (8 - rankIndex);
    const fileLabel = String.fromCharCode('a'.charCodeAt(0) + logicalFileIndex);

    return `${fileLabel}${rankLabel}`;
};

const MiniBoard: React.FC<MiniBoardProps> = ({
    fen,
    size = 160,
    lastMove,
    flipped = false,
    onSquarePress,
    onMove,
    selectedSquare,
    validMoves
}) => {
    const board = parseFen(fen);
    const { settings } = useSettings();

    // Use settings from context with defaults
    const boardTheme = settings ? getBoardTheme(settings.boardThemeId) : getBoardTheme('brown');
    const pieceSetId = 'classic'; // Force Classic pieces everywhere
    const showCoordinates = settings?.showCoordinates ?? false;

    // Ensure pixel-perfect square size
    const squareSize = PixelRatio.roundToNearestPixel(size / 8);
    const boardSize = squareSize * 8; // Exact board size

    // Parse lastMove to get highlighted squares
    let fromCoords: { rank: number; file: number } | null = null;
    let toCoords: { rank: number; file: number } | null = null;

    if (lastMove && lastMove.length >= 4) {
        const fromSquare = lastMove.substring(0, 2);
        const toSquare = lastMove.substring(2, 4);
        fromCoords = uciToCoords(fromSquare, false);
        toCoords = uciToCoords(toSquare, false);
    }

    // Helper to get square name (e.g., "e4") from indices
    const getSquareName = (rankIndex: number, fileIndex: number) => {
        const fileChar = String.fromCharCode('a'.charCodeAt(0) + fileIndex);
        const rankChar = String(8 - rankIndex);
        return `${fileChar}${rankChar}`;
    };

    // Coordinate labels
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];

    // Track previous move for sound playback
    const prevMoveRef = useRef<string | null>(null);
    const newMoveSound = settings?.newMoveSound ?? true;

    // Sync sound setting with soundManager
    useEffect(() => {
        soundManager.setEnabled(newMoveSound);
    }, [newMoveSound]);

    // Play sound on new move
    useEffect(() => {
        // Don't play on initial render or if sound is disabled
        if (!lastMove || lastMove === prevMoveRef.current || !newMoveSound) {
            prevMoveRef.current = lastMove || null;
            return;
        }

        prevMoveRef.current = lastMove;

        // Classify move type and play appropriate sound
        const moveType = classifyMoveType(lastMove);

        // Dev logging for verification
        if (__DEV__) {
            console.log(`[Chess Sound] Move: ${lastMove} → Type: ${moveType.toUpperCase()}`);
        }

        soundManager.playMove(moveType);
    }, [lastMove, newMoveSound]);

    // -- Drag & Drop Logic --
    const boardRef = useRef<View>(null);

    const [draggingPiece, setDraggingPiece] = useState<{ piece: string, x: number, y: number } | null>(null);
    const pan = useRef(new Animated.ValueXY()).current;

    const pendingGestureRef = useRef<{
        state: 'MEASURING' | 'DRAGGING' | 'RELEASED';
        pageX: number;
        pageY: number;
        totalDx: number;
        totalDy: number;
        pendingTapSquare?: string | null;
    } | null>(null);

    const dragStartRef = useRef<{
        square: string;
        piece: string;
        startX: number;
        startY: number;
    } | null>(null);

    // Track props for PanResponder to avoid stale closures
    const propsRef = useRef({ onSquarePress, onMove, squareSize, flipped, board, pieceSetId });
    useEffect(() => {
        propsRef.current = { onSquarePress, onMove, squareSize, flipped, board, pieceSetId };
    }, [onSquarePress, onMove, squareSize, flipped, board, pieceSetId]);

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onStartShouldSetPanResponderCapture: () => true,

            onPanResponderGrant: (evt, _) => {
                const { pageX, pageY } = evt.nativeEvent;

                // Initialize pending gesture
                pendingGestureRef.current = {
                    state: 'MEASURING',
                    pageX,
                    pageY,
                    totalDx: 0,
                    totalDy: 0,
                    pendingTapSquare: null // New field
                };

                // Measure board position to ensure accurate local coordinates
                boardRef.current?.measure((_x, _y, width, height, px, py) => {
                    const pending = pendingGestureRef.current;
                    if (!pending) return;

                    const { squareSize, flipped, board, onSquarePress, onMove } = propsRef.current;

                    // Calculate Local Coordinates
                    const localX = pending.pageX - px;
                    const localY = pending.pageY - py;

                    // Safety Bounds Check
                    if (localX < 0 || localX > width || localY < 0 || localY > height) {
                        return;
                    }

                    const square = getSquareFromCoords(localX, localY, squareSize, flipped);
                    if (!square) return;

                    // Check content
                    const fileIdx = square.charCodeAt(0) - 'a'.charCodeAt(0);
                    const rankIdx = parseInt(square[1]) - 1;
                    const boardRow = 7 - rankIdx;
                    const boardCol = fileIdx;
                    const piece = board[boardRow][boardCol];

                    const isTap = Math.abs(pending.totalDx) < 10 && Math.abs(pending.totalDy) < 10;
                    const hasReleased = pending.state === 'RELEASED';

                    if (!piece) {
                        // EMPTY SQUARE
                        if (hasReleased) {
                            if (isTap) {
                                onSquarePress?.(square);
                            }
                        } else {
                            // Measure finished BEFORE release.
                            // Store this square so onPanResponderRelease can handle it.
                            pending.pendingTapSquare = square;
                        }
                        return;
                    }

                    // HAS PIECE -> Start Drag
                    const displayPiece = piece.toUpperCase() === piece ? `w${piece}` : `b${piece.toUpperCase()}`;

                    dragStartRef.current = {
                        square,
                        piece: displayPiece,
                        startX: localX,
                        startY: localY
                    };

                    // If we haven't released yet, start visualizing drag
                    if (!hasReleased) {
                        pending.state = 'DRAGGING';

                        // Apply any accumulated movement that happened while measuring
                        const currentX = localX + pending.totalDx;
                        const currentY = localY + pending.totalDy;

                        pan.setValue({ x: currentX - squareSize / 2, y: currentY - squareSize / 2 });
                        setDraggingPiece({
                            piece: displayPiece,
                            x: currentX - squareSize / 2,
                            y: currentY - squareSize / 2
                        });

                    } else {
                        // We released while measuring
                        // If it was a tap, treat as tap.
                        if (isTap) {
                            onSquarePress?.(square);
                        } else {
                            // Quick drag
                            const endX = localX + pending.totalDx;
                            const endY = localY + pending.totalDy;
                            const endSquare = getSquareFromCoords(endX, endY, squareSize, flipped);
                            if (endSquare && endSquare !== square) {
                                onMove?.(square, endSquare);
                            }
                        }
                        // Cleanup
                        setDraggingPiece(null);

                        dragStartRef.current = null;
                        pendingGestureRef.current = null;
                    }
                });
            },

            onPanResponderMove: (_, gestureState) => {
                if (pendingGestureRef.current) {
                    pendingGestureRef.current.totalDx = gestureState.dx;
                    pendingGestureRef.current.totalDy = gestureState.dy;

                    if (pendingGestureRef.current.state === 'DRAGGING' && dragStartRef.current) {
                        const start = dragStartRef.current;
                        const { squareSize } = propsRef.current;
                        const newX = start.startX + gestureState.dx - squareSize / 2;
                        const newY = start.startY + gestureState.dy - squareSize / 2;
                        pan.setValue({ x: newX, y: newY });
                    }
                }
            },

            onPanResponderRelease: (_, gestureState) => {
                if (pendingGestureRef.current) {
                    const wasDragging = pendingGestureRef.current.state === 'DRAGGING';
                    const pendingTap = pendingGestureRef.current.pendingTapSquare;
                    pendingGestureRef.current.state = 'RELEASED';

                    if (wasDragging && dragStartRef.current) {
                        const start = dragStartRef.current;
                        const { squareSize, flipped, onMove, onSquarePress } = propsRef.current;

                        setDraggingPiece(null);

                        dragStartRef.current = null;
                        pendingGestureRef.current = null;

                        // Check tap threshold
                        if (Math.abs(gestureState.dx) < 10 && Math.abs(gestureState.dy) < 10) {
                            onSquarePress?.(start.square);
                        } else {
                            // Drop
                            const endX = start.startX + gestureState.dx;
                            const endY = start.startY + gestureState.dy;
                            const endSquare = getSquareFromCoords(endX, endY, squareSize, flipped);

                            if (endSquare && endSquare !== start.square) {
                                onMove?.(start.square, endSquare);
                            }
                        }
                    } else if (pendingTap) {
                        // It was an empty square tap waiting for release
                        const { onSquarePress } = propsRef.current;
                        if (Math.abs(gestureState.dx) < 10 && Math.abs(gestureState.dy) < 10) {
                            onSquarePress?.(pendingTap);
                        }
                        pendingGestureRef.current = null;
                    }
                }
            },
            onPanResponderTerminate: () => {
                setDraggingPiece(null);

                dragStartRef.current = null;
                pendingGestureRef.current = null;
            }
        })
    ).current;

    const panHandlers = (onSquarePress || onMove) ? panResponder.panHandlers : {};

    return (
        <View
            ref={boardRef}
            style={[styles.board, {
                width: boardSize,
                height: boardSize,
                backgroundColor: boardTheme.lightSquare
            }]}
            {...panHandlers}
        >

            {board.map((rank, rankIndex) => {
                const displayRankIndex = flipped ? 7 - rankIndex : rankIndex;
                const displayRank = board[displayRankIndex];

                return (
                    <View key={rankIndex} style={styles.rank}>
                        {displayRank.map((piece, fileIndex) => {
                            const displayFileIndex = flipped ? 7 - fileIndex : fileIndex;
                            const displayPiece = displayRank[displayFileIndex];
                            const realSquareName = getSquareName(displayRankIndex, displayFileIndex);

                            const isLightSquare = (displayRankIndex + displayFileIndex) % 2 === 0;
                            const squareColor = isLightSquare ? boardTheme.lightSquare : boardTheme.darkSquare;

                            const isLastMoveHighlight = (
                                (fromCoords && fromCoords.rank === displayRankIndex && fromCoords.file === displayFileIndex) ||
                                (toCoords && toCoords.rank === displayRankIndex && toCoords.file === displayFileIndex)
                            );

                            const isSelected = selectedSquare === realSquareName;
                            const isValidDest = validMoves?.includes(realSquareName);

                            return (
                                <View
                                    key={fileIndex}
                                    style={[
                                        styles.square,
                                        {
                                            width: squareSize,
                                            height: squareSize,
                                            backgroundColor: squareColor
                                        }
                                    ]}
                                >
                                    {isLastMoveHighlight && (
                                        <View style={styles.highlightOverlay} pointerEvents="none" />
                                    )}
                                    {isSelected && (
                                        <View style={styles.selectionOverlay} pointerEvents="none" />
                                    )}
                                    {isValidDest && (
                                        <View
                                            style={!displayPiece ? styles.validMoveDot : styles.validCaptureRing}
                                            pointerEvents="none"
                                        />
                                    )}

                                    {displayPiece && (
                                        <Image
                                            source={getPieceAsset(
                                                displayPiece.toUpperCase() === displayPiece ? `w${displayPiece}` : `b${displayPiece.toUpperCase()}`,
                                                pieceSetId
                                            )}
                                            style={{
                                                width: squareSize,
                                                height: squareSize,
                                                position: 'absolute',
                                                opacity: (draggingPiece && draggingPiece.piece === (displayPiece.toUpperCase() === displayPiece ? `w${displayPiece}` : `b${displayPiece.toUpperCase()}`) && dragStartRef.current?.square === realSquareName) ? 0 : 1
                                            }}
                                            resizeMode="contain"
                                        />
                                    )}

                                    {showCoordinates && (
                                        <>
                                            {rankIndex === 7 && (
                                                <RNText style={[
                                                    styles.coordinateText,
                                                    {
                                                        position: 'absolute',
                                                        bottom: 1,
                                                        right: 2,
                                                        fontSize: Math.max(8, squareSize * 0.12),
                                                    }
                                                ]}>
                                                    {flipped ? files[7 - fileIndex] : files[fileIndex]}
                                                </RNText>
                                            )}
                                            {fileIndex === 0 && (
                                                <RNText style={[
                                                    styles.coordinateText,
                                                    {
                                                        position: 'absolute',
                                                        bottom: 1,
                                                        left: 2,
                                                        fontSize: Math.max(8, squareSize * 0.12),
                                                    }
                                                ]}>
                                                    {flipped ? ranks[rankIndex] : ranks[7 - rankIndex]}
                                                </RNText>
                                            )}
                                        </>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                );
            })}

            {draggingPiece && (
                <Animated.View
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: squareSize,
                        height: squareSize,
                        transform: [
                            { translateX: pan.x },
                            { translateY: pan.y }
                        ],
                        zIndex: 100,
                        pointerEvents: 'none',
                    }}
                >
                    <Image
                        source={getPieceAsset(draggingPiece.piece, pieceSetId)}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="contain"
                    />
                </Animated.View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    board: {
        aspectRatio: 1,
        borderRadius: 0,
        overflow: 'hidden',
    },
    rank: {
        flexDirection: 'row',
    },
    square: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    highlightOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255, 255, 0, 0.25)',
    },
    coordinateText: {
        color: 'rgba(255, 255, 255, 0.5)',
        fontWeight: '600' as '600',
        textShadowColor: 'rgba(0, 0, 0, 0.5)',
        textShadowOffset: { width: 0.5, height: 0.5 },
        textShadowRadius: 1,
    },
    selectionOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(20, 83, 45, 0.5)',
    },
    validMoveDot: {
        position: 'absolute',
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        zIndex: 10,
    },
    validCaptureRing: {
        ...StyleSheet.absoluteFillObject,
        borderWidth: 4,
        borderColor: 'rgba(0, 0, 0, 0.2)',
        borderRadius: 999,
        zIndex: 10,
    },
});

export default memo(MiniBoard);

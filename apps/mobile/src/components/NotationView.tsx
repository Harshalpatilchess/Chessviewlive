import React, { useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Platform } from 'react-native';
import { premiumTheme } from '../theme/premiumTheme';

// Centralized notation styling using shared premium theme
const notationTheme = {
    colors: {
        // Highlight: Gold/Amber tint + Subtle Border
        highlight: premiumTheme.colors.highlightBg,
        highlightBorder: 'rgba(234, 179, 8, 0.40)', // Keep local tweak if needed, or move to theme if reused

        highlightText: '#ffffff',
        rowActiveBg: 'rgba(255, 255, 255, 0.04)',
        rowBorder: premiumTheme.colors.textTertiary, // Gold/Amber-400

        textDim: premiumTheme.colors.textSecondary,
        textNormal: premiumTheme.colors.textPrimary,

        // Interaction
        pressedBg: premiumTheme.colors.pressedBg,
        pressedVariation: 'rgba(255, 255, 255, 0.1)',
    },
    layout: {
        cellRadius: 4,
        cellPaddingHorizontal: 6,
        cellPaddingVertical: 2,
    }
};

export interface Move {
    ply: number;
    san: string;
    fen: string;
    from: string;
    to: string;
    color: 'w' | 'b';
    moveNumber: number;
}

interface NotationViewProps {
    moves: Move[]; // Full history
    currentPly: number; // Current board ply (0 = start)
    onJumpToMove: (ply: number) => void;
    // New Props for Manual Moves
    // Variation Props matching GameScreen types
    variation: { anchorPly: number; activeLineId: string; lines: { id: string; moves: Move[] }[] } | null;
    onClearVariation: () => void;
    onJumpToVariationMove: (lineId: string, ply: number) => void;
}

export default React.memo(function NotationView({ moves, currentPly, onJumpToMove, variation, onClearVariation, onJumpToVariationMove }: NotationViewProps) {
    const listRef = useRef<FlatList>(null);

    // Prepare data for FlatList: group by full moves (white + black)
    // AND insert the variation object into the list if it exists.
    const movePairs = React.useMemo(() => {
        const pairs: { type: 'move' | 'variation'; moveNumber: number; white?: Move; black?: Move; variationData?: any }[] = [];
        for (const move of moves) {
            // Check if we need to insert variation BEFORE this move?
            // "Anchor ply" is the LAST move played before variation start.
            // e.g. played 24. Bb2 (ply 47). anchorPly=47. Variation starts at 48.
            // We want to show variation row AFTER the row containing ply 47.
            // Row 24 contains ply 47 (white) or ply 48 (black).

            if (move.color === 'w') {
                pairs.push({ type: 'move', moveNumber: move.moveNumber, white: move });
            } else {
                let pair = pairs.find(p => p.type === 'move' && p.moveNumber === move.moveNumber);
                if (!pair) {
                    pair = { type: 'move', moveNumber: move.moveNumber };
                    pairs.push(pair);
                }
                pair.black = move;
            }
        }

        // Insert Variation Row if active
        if (variation) {
            const anchorPly = variation.anchorPly;

            if (anchorPly > 0) {
                const pairIndex = pairs.findIndex(p =>
                    (p.white && p.white.ply === anchorPly) ||
                    (p.black && p.black.ply === anchorPly)
                );

                if (pairIndex !== -1) {
                    // Start splice AFTER this pair
                    const insertIndex = pairIndex + 1;

                    // Create Variation Row Item
                    const variationItem = {
                        type: 'variation',
                        moveNumber: -1, // Special
                        variationData: variation
                    };
                    // @ts-ignore - union type complexity
                    pairs.splice(insertIndex, 0, variationItem);
                }
            }

        }

        return pairs;
    }, [moves, variation]);

    // Auto-scroll to active ply
    useEffect(() => {
        if (!listRef.current || movePairs.length === 0) return;

        // Find index of the row containing currentPly
        const index = movePairs.findIndex(item => {
            if (item.type === 'variation') {
                return item.variationData && currentPly > item.variationData.anchorPly;
            }
            // Regular move row
            return (item.white && item.white.ply === currentPly) ||
                (item.black && item.black.ply === currentPly);
        });

        if (index !== -1) {
            // Scroll to center
            listRef.current.scrollToIndex({
                index,
                animated: true,
                viewPosition: 0.5
            });
        }
    }, [currentPly, movePairs]);

    // Handle scroll failure (e.g. layout not measured yet)
    const handleScrollToIndexFailed = useCallback((info: {
        index: number;
        highestMeasuredFrameIndex: number;
        averageItemLength: number;
    }) => {
        const wait = new Promise(resolve => setTimeout(resolve, 50));
        wait.then(() => {
            listRef.current?.scrollToIndex({
                index: info.index,
                animated: true,
                viewPosition: 0.5
            });
        });
    }, []);

    const renderItem = ({ item }: { item: any }) => {
        if (item.type === 'variation') {
            const { lines, anchorPly, activeLineId } = item.variationData as { anchorPly: number; activeLineId: string; lines: { id: string; moves: Move[] }[] };

            // Render all lines
            return (
                <View style={styles.variationContainer}>
                    {lines.map((line, index) => {
                        const isMainLine = index === 0;
                        const isLineActive = line.id === activeLineId;

                        return (
                            <View key={line.id} style={styles.variationRow}>
                                <View style={styles.variationIconContainer}>
                                    {isMainLine && <Text style={styles.variationIcon}>↳</Text>}
                                    {!isMainLine && <View style={styles.variationBranchLine} />}
                                </View>

                                <View style={[
                                    styles.variationBox,
                                    !isMainLine && styles.variationBoxIndented,
                                    isLineActive && styles.variationBoxActive
                                ]}>
                                    <FlatList
                                        data={line.moves}
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        keyExtractor={(m) => m.ply.toString()}
                                        contentContainerStyle={{ alignItems: 'center', paddingRight: 40 }}
                                        renderItem={({ item: m }) => {
                                            const isActive = currentPly === m.ply && isLineActive;
                                            return (
                                                <Pressable
                                                    onPress={() => onJumpToVariationMove && onJumpToVariationMove(line.id, m.ply)}
                                                    hitSlop={4}
                                                    style={({ pressed }) => [
                                                        styles.paramMove,
                                                        isActive && styles.paramMoveActive,
                                                        pressed && !isActive && styles.paramMovePressed
                                                    ]}
                                                >
                                                    <Text style={[styles.paramText, isActive && styles.paramTextActive]}>
                                                        {m.color === 'w' ? `${m.moveNumber}. ${m.san.trim()}` : m.san.trim()}
                                                    </Text>
                                                </Pressable>
                                            );
                                        }}
                                    />
                                    {isMainLine && (
                                        <Pressable style={styles.liveBtnSmall} onPress={onClearVariation}>
                                            <Text style={styles.liveBtnText}>LIVE</Text>
                                        </Pressable>
                                    )}
                                </View>
                            </View>
                        );
                    })}
                </View>
            );
        }

        const isWhiteActive = item.white?.ply === currentPly;
        const isBlackActive = item.black?.ply === currentPly;
        const isRowActive = isWhiteActive || isBlackActive;

        return (
            <View style={[styles.moveRow, isRowActive && styles.activeRow]}>
                {/* Move Number */}
                <Text style={styles.moveNumber} numberOfLines={1}>{item.moveNumber}.</Text>

                {/* White Move */}
                <Pressable
                    style={styles.moveCell}
                    onPress={() => item.white && onJumpToMove(item.white.ply)}
                    disabled={!item.white}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                    {({ pressed }) => (
                        <View style={[
                            styles.moveBtn,
                            isWhiteActive && styles.activeMove,
                            pressed && !isWhiteActive && styles.pressedMove
                        ]}>
                            {item.white && (
                                <Text
                                    style={[styles.moveText, isWhiteActive && styles.activeMoveText]}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                >
                                    {item.white.san}
                                </Text>
                            )}
                        </View>
                    )}
                </Pressable>

                {/* Black Move */}
                <Pressable
                    style={styles.moveCell}
                    onPress={() => item.black && onJumpToMove(item.black.ply)}
                    disabled={!item.black}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                    {({ pressed }) => (
                        <View style={[
                            styles.moveBtn,
                            isBlackActive && styles.activeMove,
                            pressed && !isBlackActive && styles.pressedMove
                        ]}>
                            {item.black && (
                                <Text
                                    style={[styles.moveText, isBlackActive && styles.activeMoveText]}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                >
                                    {item.black.san}
                                </Text>
                            )}
                        </View>
                    )}
                </Pressable>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            {/* Header Row */}
            <View style={styles.headerRow}>
                <Text style={styles.headerIndex}>#</Text>
                <Text style={styles.headerText}>White</Text>
                <Text style={styles.headerText}>Black</Text>
            </View>

            <FlatList
                ref={listRef}
                data={movePairs}
                keyExtractor={(item: any) => item.type === 'variation' ? 'var' : item.moveNumber.toString()}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                onScrollToIndexFailed={handleScrollToIndexFailed}
            />
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
        backgroundColor: premiumTheme.colors.bg,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        gap: 6,
        height: 36,
        backgroundColor: premiumTheme.colors.bgHeader,
        borderBottomWidth: 1,
        borderBottomColor: premiumTheme.colors.border,
    },
    headerIndex: {
        width: 48,
        fontSize: 11,
        color: premiumTheme.colors.textSecondary,
        fontWeight: '500',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    headerText: {
        flex: 1,
        fontSize: 11,
        color: premiumTheme.colors.textSecondary,
        fontWeight: '500',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    listContent: {
        paddingBottom: 24,
    },
    moveRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 48,
        paddingHorizontal: 12,
        gap: 8,
        width: '100%',
        borderLeftWidth: 3,
        borderLeftColor: 'transparent',
    },
    activeRow: {
        backgroundColor: notationTheme.colors.rowActiveBg,
        borderLeftWidth: 3,
        borderLeftColor: notationTheme.colors.rowBorder,
        borderBottomWidth: 1,
        borderBottomColor: notationTheme.colors.rowBorder,
    },
    moveNumber: {
        width: 48,
        fontSize: 14,
        color: notationTheme.colors.textDim,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    moveCell: {
        flex: 1,
        height: '100%',
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    moveBtn: {
        paddingVertical: notationTheme.layout.cellPaddingVertical,
        paddingHorizontal: notationTheme.layout.cellPaddingHorizontal,
        borderRadius: notationTheme.layout.cellRadius,
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: 'transparent', // Prepare for border
    },
    activeMove: {
        backgroundColor: notationTheme.colors.highlight,
        borderColor: notationTheme.colors.highlightBorder,
    },
    pressedMove: {
        backgroundColor: notationTheme.colors.pressedBg,
    },
    moveText: {
        fontSize: 14,
        color: notationTheme.colors.textNormal,
        fontWeight: '400',
    },
    activeMoveText: {
        color: notationTheme.colors.highlightText,
        fontWeight: '600',
    },
    variationRow: {
        flexDirection: 'row',
        paddingVertical: 4,
        paddingHorizontal: 12,
        backgroundColor: 'transparent',
    },
    variationIconContainer: {
        paddingRight: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    variationIcon: {
        color: premiumTheme.colors.textSecondary,
        fontSize: 16,
    },
    variationBox: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: premiumTheme.colors.bgHeader, // boxed variations
        borderRadius: 8,
        borderWidth: 1,
        borderColor: premiumTheme.colors.border,
        height: 40,
        paddingHorizontal: 8,
        position: 'relative',
    },
    paramMove: {
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: 4,
        marginRight: 4,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    paramMoveActive: {
        backgroundColor: notationTheme.colors.highlight,
        borderColor: notationTheme.colors.highlightBorder,
    },
    paramMovePressed: {
        backgroundColor: notationTheme.colors.pressedVariation,
    },
    paramText: {
        fontSize: 14,
        color: notationTheme.colors.textNormal,
        fontWeight: '400',
    },
    paramTextActive: {
        color: notationTheme.colors.highlightText,
        fontWeight: '600',
    },
    liveBtnSmall: {
        position: 'absolute',
        right: 4,
        backgroundColor: premiumTheme.colors.bg,
        borderWidth: 1,
        borderColor: premiumTheme.colors.border,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 12,
    },
    liveBtnText: {
        fontSize: 10,
        fontWeight: '700',
        color: premiumTheme.colors.textSecondary,
    },
    variationContainer: {
        width: '100%',
    },
    variationBranchLine: {
        width: 1,
        height: '100%',
        backgroundColor: premiumTheme.colors.border,
        marginLeft: 6,
        marginRight: 10,
    },
    variationBoxIndented: {
        marginTop: 4,
        borderColor: 'transparent',
        backgroundColor: premiumTheme.colors.bgSubtle, // inclusive neutral 850
    },
    variationBoxActive: {
        borderColor: notationTheme.colors.rowBorder,
        backgroundColor: premiumTheme.colors.bgHeader, // back to neutral 800
    }
});

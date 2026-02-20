import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface EvalBarProps {
    evalCp?: number; // Evaluation in centipawns (positive = white advantage)
    height: number; // Height to match the board
    flipped?: boolean; // Board orientation
    showLabel?: boolean; // Show eval score label
}

export default function EvalBar({ evalCp, height, flipped = false, showLabel = true }: EvalBarProps) {
    // If no eval, show neutral (50/50)
    const evaluation = evalCp ?? 0;

    // Clamp eval to reasonable range (-500 to +500 cp) and convert to percentage
    // Positive eval = white advantage (bottom when not flipped)
    // Negative eval = black advantage (top when not flipped)
    const clampedEval = Math.max(-500, Math.min(500, evaluation));
    const whitePercentage = 50 + (clampedEval / 500) * 50; // Maps -500..+500 to 0..100

    // Determine advantage
    const advantage = whitePercentage > 50 ? 'white' : whitePercentage < 50 ? 'black' : 'equal';

    // Format label without brackets (user requested format)
    // Show absolute value - placement indicates advantage
    const evalInPawns = Math.abs(evaluation / 100);
    const evalLabel = evalInPawns.toFixed(1);

    // Determine label position based on advantage and flip
    const isWhiteAtBottom = !flipped;
    const labelPosition = advantage === 'equal'
        ? 'center'
        : advantage === 'white'
            ? (isWhiteAtBottom ? 'bottom' : 'top')
            : (isWhiteAtBottom ? 'top' : 'bottom');

    return (
        <View style={[styles.container, { height }]}>
            {/* Background rail */}
            <View style={styles.rail}>
                {/* Midline at 50% */}
                <View style={styles.midline} />

                {/* White advantage fill (grows from bottom) */}
                <View
                    style={[
                        styles.fill,
                        {
                            height: `${whitePercentage}%`,
                            bottom: 0,
                        }
                    ]}
                />
            </View>

            {/* Labels - rendered as overlays OUTSIDE rail to prevent clipping */}
            {showLabel && (
                <>
                    {advantage === 'equal' ? (
                        <>
                            <View style={[styles.labelContainer, styles.labelTop]}>
                                <Text style={styles.labelText} numberOfLines={1}>0.0</Text>
                            </View>
                            <View style={[styles.labelContainer, styles.labelBottom]}>
                                <Text style={styles.labelText} numberOfLines={1}>0.0</Text>
                            </View>
                        </>
                    ) : (
                        <View
                            style={[
                                styles.labelContainer,
                                labelPosition === 'top' && styles.labelTop,
                                labelPosition === 'bottom' && styles.labelBottom,
                                labelPosition === 'center' && styles.labelCenter,
                            ]}
                        >
                            <Text style={styles.labelText} numberOfLines={1}>{evalLabel}</Text>
                        </View>
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: 34, // Increased width to fully contain the label
        justifyContent: 'center',
    },
    rail: {
        width: 14, // Keep visible bar slim
        flex: 1,
        backgroundColor: 'rgba(30, 41, 59, 0.7)', // slate-800/70
        borderRadius: 999, // rounded-full
        overflow: 'hidden',
        position: 'relative',
        alignSelf: 'center', // Center rail within wider container
    },
    midline: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        height: 1,
        backgroundColor: 'rgba(251, 191, 36, 0.7)', // amber-300/70
        zIndex: 1,
    },
    fill: {
        position: 'absolute',
        left: 0,
        right: 0,
        backgroundColor: '#34d399', // emerald-400
        borderRadius: 999,
    },
    label: {
        position: 'absolute',
        left: '50%',
        transform: [{ translateX: -50 }],
        fontSize: 10,
        fontWeight: '600',
        color: '#f1f5f9', // slate-50
        backgroundColor: 'rgba(0, 0, 0, 0.25)',
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: 2,
        zIndex: 2,
        textShadowColor: 'rgba(0, 0, 0, 0.9)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    labelContainer: {
        position: 'absolute',
        width: '100%', // Fill the container
        left: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        // Background/Border removed for minimal look
        paddingHorizontal: 0,
        paddingVertical: 1,
        borderRadius: 0,
        zIndex: 10,
        // Elevation removed
    },
    labelText: {
        fontSize: 7.5, // Reduced by 5% (from 8)
        fontWeight: '700',
        color: '#ffffff',
        textShadowColor: 'rgba(0, 0, 0, 1)', // Strong shadow for contrast without background
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
        includeFontPadding: false,
        textAlignVertical: 'center',
        textAlign: 'center',
    },
    labelTop: {
        top: 8,
    },
    labelBottom: {
        bottom: 8,
    },
    labelCenter: {
        top: '50%',
        marginTop: -10,
    },
});

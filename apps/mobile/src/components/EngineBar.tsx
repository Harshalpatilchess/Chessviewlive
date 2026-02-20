import React from 'react';
import { View, StyleSheet } from 'react-native';
import { broadcastTheme } from '../theme/broadcastTheme';

interface EngineBarProps {
    evalCp?: number; // Evaluation in centipawns (positive = white advantage)
    height: number; // Height to match the board
}

export default function EngineBar({ evalCp, height }: EngineBarProps) {
    // If no eval, show neutral (50/50)
    const evaluation = evalCp ?? 0;

    // Clamp eval to reasonable range (-500 to +500 cp) and convert to percentage
    // Positive eval = white advantage (bottom)
    // Negative eval = black advantage (top)
    const clampedEval = Math.max(-500, Math.min(500, evaluation));
    const whitePercentage = 50 + (clampedEval / 500) * 50; // Maps -500..+500 to 0..100

    return (
        <View style={[styles.container, { height }]}>
            {/* Black advantage section (top) */}
            <View style={[styles.section, styles.blackSection, { flex: 100 - whitePercentage }]} />
            {/* White advantage section (bottom) */}
            <View style={[styles.section, styles.whiteSection, { flex: whitePercentage }]} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: 8,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: 'rgba(30, 41, 59, 0.7)', // slate-800/70 - matches web rail
        borderWidth: 0, // Web has no border
    },
    section: {
        width: '100%',
    },
    blackSection: {
        backgroundColor: 'rgba(30, 41, 59, 0.7)', // slate-800/70 - same as background for black side
    },
    whiteSection: {
        backgroundColor: '#34d399', // emerald-400 - matches web fill color
    },
});

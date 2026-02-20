import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import WQ from '../../assets/pieces/cburnett/wQ.svg';

/**
 * Diagnostic component to test SVG rendering pipeline.
 * Renders a single chess piece at large size to verify:
 * 1. SVG transformer is working correctly
 * 2. viewBox handling is correct
 * 3. No clipping or scaling issues
 */
export default function PieceRenderTest() {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>SVG Render Test</Text>
            <Text style={styles.subtitle}>White Queen - 200x200px</Text>

            <View style={styles.testBox}>
                <WQ
                    width={200}
                    height={200}
                    preserveAspectRatio="xMidYMid meet"
                />
            </View>

            <Text style={styles.note}>
                Should show full white queen piece, centered and scaled correctly.
                If showing clipped fragments, issue is in SVG pipeline/viewBox.
                If showing correctly, issue is in MiniBoard layout.
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1f2937',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#ffffff',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#9ca3af',
        marginBottom: 32,
    },
    testBox: {
        width: 240,
        height: 240,
        backgroundColor: '#374151',
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#4b5563',
    },
    note: {
        marginTop: 32,
        fontSize: 14,
        color: '#9ca3af',
        textAlign: 'center',
        lineHeight: 20,
    },
});

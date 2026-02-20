import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';

interface RoundSelectorCapsuleProps {
    round: number;
    onPress: () => void;
}

export default function RoundSelectorCapsule({ round, onPress }: RoundSelectorCapsuleProps) {
    return (
        <TouchableOpacity
            style={styles.capsule}
            onPress={onPress}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
            <Text style={styles.text}>Round {round}</Text>
            <Ionicons
                name="chevron-down"
                size={12}
                color={broadcastTheme.colors.sky400}
                style={styles.icon}
            />
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    capsule: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 3,
        paddingHorizontal: 10,
        backgroundColor: 'rgba(56, 189, 248, 0.12)', // sky-400 with 12% opacity
        borderRadius: 12, // Slimmer pill
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.35)', // sky-400 with 35% opacity
        gap: 4,
        minHeight: 24, // Slim visual height
        // Premium shadow with blue tint
        shadowColor: 'rgba(56, 189, 248, 0.4)',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.25,
        shadowRadius: 3,
        elevation: 2,
    },
    text: {
        fontSize: 11,
        fontWeight: '600',
        color: broadcastTheme.colors.sky400,
        letterSpacing: 0.2,
    },
    icon: {
        marginTop: 0.5, // Fine-tune vertical alignment
    },
});

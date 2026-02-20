import React from 'react';
import { Text, View, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { broadcastTheme } from '../theme/broadcastTheme';

type CapsuleVariant = 'title' | 'accent' | 'neutral' | 'subtle' | 'outline';

interface CapsuleProps {
    children: string | React.ReactNode;
    variant?: CapsuleVariant;
    style?: ViewStyle;
    textStyle?: TextStyle;
}

export default function Capsule({ children, variant = 'neutral', style, textStyle }: CapsuleProps) {
    const containerStyle = [styles.base, styles[variant], style];
    const textStyles = [styles.text, styles[`${variant}Text`], textStyle];

    return (
        <View style={containerStyle}>
            <Text style={textStyles}>{children}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: broadcastTheme.radii.md,
        borderWidth: 1,
    },
    text: {
        fontSize: 9,
        fontWeight: broadcastTheme.typography.bold,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        lineHeight: 11,
    },

    // Title variant (amber/yellow for player titles like GM, IM)
    title: {
        backgroundColor: 'rgba(253, 230, 138, 0.1)', // amber-200/10
        borderColor: 'rgba(253, 230, 138, 0.5)', // amber-200/50
    },
    titleText: {
        color: broadcastTheme.colors.amber100, // amber-100
    },

    // Accent variant (emerald for active/selected states)
    accent: {
        backgroundColor: 'rgba(52, 211, 153, 0.15)', // emerald-400/15
        borderColor: 'rgba(52, 211, 153, 0.6)', // emerald-400/60
    },
    accentText: {
        color: broadcastTheme.colors.foreground,
    },

    // Neutral variant (default slate styling)
    neutral: {
        backgroundColor: broadcastTheme.colors.whiteOverlay5,
        borderColor: broadcastTheme.colors.borderDefault,
    },
    neutralText: {
        color: broadcastTheme.colors.slate300,
    },

    // Subtle variant (minimal styling)
    subtle: {
        backgroundColor: 'transparent',
        borderColor: broadcastTheme.colors.borderDefault,
    },
    subtleText: {
        color: broadcastTheme.colors.slate400,
    },

    // Outline variant (no background)
    outline: {
        backgroundColor: 'transparent',
        borderColor: broadcastTheme.colors.borderHover,
    },
    outlineText: {
        color: broadcastTheme.colors.slate200,
    },
});

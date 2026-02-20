/**
 * Premium Neutral Dark Theme (Mobile)
 * Shared palette for consistency across Engine, Notation, and Commentary tabs.
 */
export const premiumTheme = {
    colors: {
        bg: '#171717',        // Neutral-900 (Main BG)
        bgHeader: '#262626',  // Neutral-800 (Card/Header BG)
        bgSubtle: '#202020',  // Neutral-850 (Subtle backgrounds)

        border: '#404040',    // Neutral-700 (Separators)
        borderSubtle: 'rgba(255, 255, 255, 0.05)',

        textPrimary: '#f5f5f5',   // Neutral-100 (Primary Text)
        textSecondary: '#a3a3a3', // Neutral-400 (Secondary/Dim Text)
        textTertiary: '#fbbf24',  // Amber-400 (Accents/Highlights - Gold)

        // Interaction
        activeTabIndicator: '#fbbf24', // Gold underline
        highlightBg: 'rgba(234, 179, 8, 0.20)', // Yellow-500 at 20%
        pressedBg: 'rgba(255, 255, 255, 0.08)',
    },
    spacing: {
        padding: 16,
        borderRadius: 12,
    },
    typography: {
        fontFamilyWithVariant: ['tabular-nums'],
    }
} as const;

export type PremiumTheme = typeof premiumTheme;

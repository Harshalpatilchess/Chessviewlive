/**
 * Broadcast Theme - Matching web broadcast UI exactly
 * Extracted from apps/web theme tokens
 */

export const broadcastTheme = {
    colors: {
        // Base colors
        background: '#0a0a0a',
        foreground: '#ededed',

        // Surface colors (cards, panels)
        slate950: '#020617',
        slate900: '#0f172a',
        slate800: '#1e293b',
        slate700: '#334155',
        slate600: '#475569',
        slate500: '#64748b',

        // Text colors
        slate50: '#f8fafc',
        slate100: '#f1f5f9',
        slate200: '#e2e8f0',
        slate300: '#cbd5e1',
        slate400: '#94a3b8',

        // Border colors
        borderDefault: 'rgba(255, 255, 255, 0.1)', // white/10
        borderHover: 'rgba(255, 255, 255, 0.3)', // white/30
        borderAccent: 'rgba(56, 189, 248, 0.7)', // sky-400/70

        // Amber (for title badges)
        amber50: '#fffbeb',
        amber100: '#fef3c7',
        amber200: '#fde68a',

        // Accent colors
        emerald400: '#34d399',
        sky400: '#38bdf8',

        // Overlays
        whiteOverlay5: 'rgba(255, 255, 255, 0.05)',
        whiteOverlay10: 'rgba(255, 255, 255, 0.1)',
        whiteOverlay15: 'rgba(255, 255, 255, 0.15)',
        blackOverlay70: 'rgba(2, 6, 23, 0.7)', // slate-950 at 70%
    },

    radii: {
        // Capsule/pill radii
        full: 9999,
        pill: 9999,
        md: 6,
        lg: 8,
        xl: 12,
        '2xl': 16,
        '3xl': 24,
    },

    spacing: {
        // Common capsule padding
        capsulePaddingX: 6,
        capsulePaddingY: 2,
        chipPaddingX: 12,
        chipPaddingY: 8,
    },

    typography: {
        // Font weights
        semibold: '600' as '600',
        bold: '700' as '700',

        // Font sizes for broadcast UI
        xs: 10,
        sm: 11,
        base: 12,
        md: 13,
        lg: 14,
    },
} as const;

export type BroadcastTheme = typeof broadcastTheme;

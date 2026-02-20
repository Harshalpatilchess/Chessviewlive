// Central configuration for board customization options

export interface BoardTheme {
    lightSquare: string;
    darkSquare: string;
}

export const BOARD_THEMES: Record<string, BoardTheme> = {
    brown: {
        lightSquare: '#F0D9B5',
        darkSquare: '#B58863',
    },
    blue: {
        lightSquare: '#DEE3E6',
        darkSquare: '#8CA2AD',
    },
    green: {
        lightSquare: '#FFFFDD',
        darkSquare: '#86A666',
    },
    gray: {
        lightSquare: '#E8E8E8',
        darkSquare: '#B0B0B0',
    },
    walnut: {
        lightSquare: '#F0D9B5',
        darkSquare: '#946F51',
    },
    // New themes
    purple: {
        lightSquare: '#E8D5F2',
        darkSquare: '#9B6FB0',
    },
    ocean: {
        lightSquare: '#C3E4ED',
        darkSquare: '#4A90A4',
    },
    coral: {
        lightSquare: '#FFE5D9',
        darkSquare: '#D4896C',
    },
    sunset: {
        lightSquare: '#FFD6A5',
        darkSquare: '#CB7C42',
    },
    forest: {
        lightSquare: '#D4E9D7',
        darkSquare: '#4D7C5D',
    },
    marble: {
        lightSquare: '#FFFFFF',
        darkSquare: '#B0BEC5',
    },
    cherry: {
        lightSquare: '#FFE0E6',
        darkSquare: '#C25B6D',
    },
    sand: {
        lightSquare: '#F5E6D3',
        darkSquare: '#C4A676',
    },
    slate: {
        lightSquare: '#D6DBE0',
        darkSquare: '#5D6D7E',
    },
    olive: {
        lightSquare: '#E8EFCE',
        darkSquare: '#8B956D',
    },
};

export type BoardThemeId = keyof typeof BOARD_THEMES;

// Piece set IDs map to asset directory names under assets/pieces/
export const PIECE_SETS = {
    classic: 'classic',
    cburnett: 'cburnett',
    premium: 'premium',
} as const;

export type PieceSetId = keyof typeof PIECE_SETS;

// Helper to get theme by ID with fallback
export function getBoardTheme(themeId: string): BoardTheme {
    return BOARD_THEMES[themeId] || BOARD_THEMES.brown;
}

// Helper to get piece set directory with fallback
export function getPieceSetDirectory(pieceSetId: string): string {
    return PIECE_SETS[pieceSetId as PieceSetId] || PIECE_SETS.classic;
}

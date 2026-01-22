import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = '@chessview_settings';

export interface AppSettings {
    // Country section
    selectedCountry: string; // ISO 2-letter code, default 'IN'

    // Board section
    boardDesign: 'classic' | 'wood' | 'blue';
    boardThemeId: string; // 'brown', 'blue', 'green', 'gray', 'walnut'
    showCoordinates: boolean;
    newMoveSound: boolean;

    // Notifications section
    newTournamentNotifications: boolean;
    notificationSounds: boolean;

    // Volume Navigation
    volumeNavigationEnabled: boolean;
    volumeNavigationAsked: boolean;
}

const defaultSettings: AppSettings = {
    selectedCountry: 'IN', // Default to India
    boardDesign: 'classic',
    boardThemeId: 'brown',
    showCoordinates: false,
    newMoveSound: true,
    newTournamentNotifications: true,
    notificationSounds: true,
    volumeNavigationEnabled: false,
    volumeNavigationAsked: false,
};

export async function getSettings(): Promise<AppSettings> {
    try {
        const json = await AsyncStorage.getItem(SETTINGS_KEY);
        if (json) {
            const stored = JSON.parse(json);
            return { ...defaultSettings, ...stored };
        }
        return defaultSettings;
    } catch (error) {
        console.error('Failed to load settings:', error);
        return defaultSettings;
    }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
    try {
        const current = await getSettings();
        const updated = { ...current, ...settings };
        await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

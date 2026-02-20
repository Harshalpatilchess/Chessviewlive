import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getSettings, saveSettings, type AppSettings } from '../utils/settingsStorage';

interface SettingsContextValue {
    settings: AppSettings | null;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
    updateBoardTheme: (themeId: string) => void;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<AppSettings | null>(null);

    // Load settings on mount
    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        const loaded = await getSettings();
        setSettings(loaded);
    };

    const updateSetting = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        if (!settings) return;

        // Update in-memory state immediately
        const updated = { ...settings, [key]: value };
        setSettings(updated);

        // Persist to AsyncStorage
        await saveSettings({ [key]: value });
    };

    const updateBoardTheme = async (themeId: string) => {
        await updateSetting('boardThemeId', themeId);
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSetting, updateBoardTheme }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
}

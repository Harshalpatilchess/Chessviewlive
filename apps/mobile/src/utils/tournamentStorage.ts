import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@chessview_tournament_uuids';

/**
 * Get all stored tournament UUIDs
 */
export async function getStoredTournamentUuids(): Promise<string[]> {
    try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Failed to load tournament UUIDs:', error);
        return [];
    }
}

/**
 * Add a tournament UUID to storage (if not already present)
 */
export async function addTournamentUuid(uuid: string): Promise<void> {
    try {
        const uuids = await getStoredTournamentUuids();
        if (!uuids.includes(uuid)) {
            uuids.push(uuid);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(uuids));
        }
    } catch (error) {
        console.error('Failed to save tournament UUID:', error);
        throw error;
    }
}

/**
 * Remove a tournament UUID from storage
 */
export async function removeTournamentUuid(uuid: string): Promise<void> {
    try {
        const uuids = await getStoredTournamentUuids();
        const filtered = uuids.filter(id => id !== uuid);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (error) {
        console.error('Failed to remove tournament UUID:', error);
        throw error;
    }
}

/**
 * Clear all stored tournament UUIDs
 */
export async function clearTournamentUuids(): Promise<void> {
    try {
        await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
        console.error('Failed to clear tournament UUIDs:', error);
        throw error;
    }
}

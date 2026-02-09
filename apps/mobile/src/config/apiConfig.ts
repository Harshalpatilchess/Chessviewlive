import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Get the base URL for the web API server.
 * 
 * Priority:
 * 1. EXPO_PUBLIC_WEB_BASE_URL env var (e.g., http://192.168.1.5:3000)
 * 2. For iOS simulator only: fallback to http://localhost:3000
 * 3. For real devices without env var: return null (requires configuration)
 */
export const getWebApiBaseUrl = (): string | null => {
    const envBaseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL?.trim();

    if (envBaseUrl) {
        return envBaseUrl;
    }

    // iOS simulator detection
    if (Platform.OS === 'ios') {
        const model = Constants.platform?.ios?.model;
        // Simulator models typically include "Simulator" in the name
        const isSimulator = model?.toLowerCase().includes('simulator') ?? false;

        if (isSimulator) {
            return 'http://localhost:3000';
        }
    }

    // For real devices, require explicit configuration
    return null;
};

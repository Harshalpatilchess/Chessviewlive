import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
// import { VolumeManager } from 'react-native-volume-manager'; // Unsafe import

interface UseVolumeNavigationProps {
    enabled: boolean;
    onNext: () => void;
    onPrev: () => void;
}

export function useVolumeNavigation({ enabled, onNext, onPrev }: UseVolumeNavigationProps) {
    const initialVolumeRef = useRef<number | null>(null);
    const isRestoringRef = useRef(false);

    useEffect(() => {
        if (!enabled) return;

        let VolumeManager: any;
        try {
            VolumeManager = require('react-native-volume-manager').VolumeManager;
        } catch (e) {
            if (__DEV__) console.log("[VolumeNav] Module not available, skipping.");
            return;
        }

        let lastVolume = 0;
        let listener: any;

        // Initialize volume and listener
        const init = async () => {
            try {
                // Get current volume to start with
                const vol = await VolumeManager.getVolume();
                const currentVol = typeof vol === 'number' ? vol : (vol as any).volume;
                lastVolume = currentVol;
                initialVolumeRef.current = currentVol;

                // Suppress the native volume UI (hud)
                await VolumeManager.showNativeVolumeUI({ enabled: false });
            } catch (e) {
                console.warn('[VolumeNav] Init error:', e);
            }
        };

        init();

        listener = VolumeManager.addVolumeListener((result: any) => {
            // Guard: If we are currently restoring volume, ignore this event
            if (isRestoringRef.current) {
                isRestoringRef.current = false;
                return;
            }

            const newVolume = result.volume;

            // Detect Direction
            if (newVolume > lastVolume) {
                // Up -> Next
                if (__DEV__) console.log('[VolumeNav] Up detected');
                onNext();
            } else if (newVolume < lastVolume) {
                // Down -> Prev
                if (__DEV__) console.log('[VolumeNav] Down detected');
                onPrev();
            }

            // Restore Volume logic
            isRestoringRef.current = true;
            VolumeManager.setVolume(lastVolume).catch(() => {
                isRestoringRef.current = false;
            });
        });

        return () => {
            if (listener) listener.remove();
            try {
                VolumeManager.showNativeVolumeUI({ enabled: true }).catch(() => { });
            } catch { }
        };
    }, [enabled, onNext, onPrev]);
}

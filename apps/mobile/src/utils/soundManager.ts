import { Audio } from 'expo-av';

export type MoveType = 'normal' | 'capture' | 'castle';

class SoundManager {
    private sounds: Record<MoveType, Audio.Sound | null> = {
        normal: null,
        capture: null,
        castle: null,
    };
    private initialized = false;
    private isEnabled = true;

    async init() {
        if (this.initialized) return;

        try {
            // Set audio mode for sound effects
            await Audio.setAudioModeAsync({
                playsInSilentModeIOS: false,
                staysActiveInBackground: false,
                shouldDuckAndroid: true,
            });

            // Preload all sounds
            const [normalSound, captureSound, castleSound] = await Promise.all([
                Audio.Sound.createAsync(require('../../assets/sounds/move.mp3')),
                Audio.Sound.createAsync(require('../../assets/sounds/capture.mp3')),
                Audio.Sound.createAsync(require('../../assets/sounds/castle.mp3')),
            ]);

            this.sounds.normal = normalSound.sound;
            this.sounds.capture = captureSound.sound;
            this.sounds.castle = castleSound.sound;

            this.initialized = true;
        } catch (error) {
            console.warn('Failed to initialize chess sounds:', error);
            this.initialized = false;
        }
    }

    async playMove(type: MoveType) {
        if (!this.isEnabled) return;

        try {
            // Initialize on first use if not already done
            if (!this.initialized) {
                await this.init();
            }

            const sound = this.sounds[type];
            if (sound) {
                // Rewind to start and play
                await sound.setPositionAsync(0);
                await sound.playAsync();
            }
        } catch (error) {
            console.warn(`Failed to play ${type} sound:`, error);
        }
    }

    setEnabled(enabled: boolean) {
        this.isEnabled = enabled;
    }

    async cleanup() {
        try {
            await Promise.all([
                this.sounds.normal?.unloadAsync(),
                this.sounds.capture?.unloadAsync(),
                this.sounds.castle?.unloadAsync(),
            ]);
            this.sounds = { normal: null, capture: null, castle: null };
            this.initialized = false;
        } catch (error) {
            console.warn('Failed to cleanup sounds:', error);
        }
    }
}

export default new SoundManager();

import * as THREE from 'three';

/**
 * SoundManager
 * 
 * Centralized audio controller for situational SFX (Fire, Run, etc).
 * Uses THREE.AudioListener and THREE.AudioLoader.
 */
export class SoundManager {
    constructor(camera) {
        this.listener = new THREE.AudioListener();
        camera.add(this.listener);

        this.audioLoader = new THREE.AudioLoader();
        this.sounds = {}; // { name: THREE.Audio }
    }

    /**
     * Load a sound file and store it.
     */
    async loadSound(name, url, loop = false, volume = 0.5) {
        return new Promise((resolve) => {
            this.audioLoader.load(url, (buffer) => {
                const sound = new THREE.Audio(this.listener);
                sound.setBuffer(buffer);
                sound.setLoop(loop);
                sound.setVolume(volume);
                this.sounds[name] = sound;
                resolve(sound);
            }, undefined, (err) => {
                console.warn(`Failed to load sound: ${url}`, err);
                resolve(null);
            });
        });
    }

    /**
     * Play a pre-loaded sound.
     */
    playSound(name) {
        const sound = this.sounds[name];
        if (sound) {
            // Only play if not already playing (prevents "stuttering")
            if (!sound.isPlaying) {
                sound.play();
            }
        }
    }

    /**
     * Stop a sound.
     */
    stopSound(name) {
        const sound = this.sounds[name];
        if (sound && sound.isPlaying) {
            sound.stop();
        }
    }

    /**
     * Set volume for a sound.
     */
    setVolume(name, volume) {
        if (this.sounds[name]) {
            this.sounds[name].setVolume(volume);
        }
    }
}

/**
 * InputManager Class
 * Listens for keyboard input and keeps track of which keys are currently held down.
 */
export class InputManager {
    constructor() {
        this.keys = {};

        // Attach event listeners to the window
        window.addEventListener('keydown', this.onKeyDown.bind(this), false);
        window.addEventListener('keyup', this.onKeyUp.bind(this), false);
    }

    onKeyDown(event) {
        this.keys[event.key.toLowerCase()] = true;
    }

    onKeyUp(event) {
        this.keys[event.key.toLowerCase()] = false;
    }

    /**
     * Checks if a specific key is currently held down.
     * @param {string} key - The key string to check (e.g., 'w', 'a', 's', 'd')
     * @returns {boolean}
     */
    isKeyDown(key) {
        return this.keys[key.toLowerCase()] === true;
    }
}

/**
 * InputManager Class
 * Listens for keyboard input and keeps track of which keys are currently held down.
 * Also supports virtual input from touch joystick & buttons.
 */
export class InputManager {
    constructor() {
        this.keys = {};
        this.isSprinting = false; // toggled by Run button

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
     * Programmatically set a key state (used by virtual joystick).
     * @param {string} key
     * @param {boolean} down
     */
    setKey(key, down) {
        this.keys[key.toLowerCase()] = down;
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

/**
 * InputManager Class
 * Listens for keyboard input and keeps track of which keys are currently held down.
 * Also supports virtual input from touch joystick & buttons.
 *
 * Phase 12 Fix: keyboard state (`keys`) and virtual/joystick state (`_virtualKeys`)
 * are stored SEPARATELY. `isKeyDown()` returns true if EITHER source is active.
 * This prevents the old bug where releasing the joystick couldn't clear a key
 * because the keyboard dict still thought it was held.
 */
export class InputManager {
    constructor() {
        this.keys = {};           // Physical keyboard state (set by keydown/keyup events)
        this._virtualKeys = {};   // Virtual joystick state (set by setVirtualKey)
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
     * Set a virtual key state from the joystick / touch buttons.
     * This is stored separately from the physical keyboard state so that
     * releasing the joystick does NOT clear a physically-held keyboard key,
     * and vice versa.
     * @param {string} key
     * @param {boolean} down
     */
    setVirtualKey(key, down) {
        this._virtualKeys[key.toLowerCase()] = down;
    }

    /**
     * Legacy setter — updates keyboard state directly.
     * Prefer setVirtualKey() for joystick input.
     * @param {string} key
     * @param {boolean} down
     */
    setKey(key, down) {
        this.keys[key.toLowerCase()] = down;
    }

    /**
     * Checks if a specific key is currently held down via EITHER
     * the physical keyboard OR the virtual joystick.
     * @param {string} key - The key string to check (e.g., 'w', 'a', 's', 'd')
     * @returns {boolean}
     */
    isKeyDown(key) {
        const k = key.toLowerCase();
        return this.keys[k] === true || this._virtualKeys[k] === true;
    }
}

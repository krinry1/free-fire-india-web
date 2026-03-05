/**
 * InputManager
 *
 * Unified input handling for Keyboard + Virtual Joystick + Mobile Buttons.
 * Provides clean, high-level getters for the game to query:
 *
 *   getMovementVector()  →  { x, y, magnitude }  combined WASD + joystick
 *   isJumpPressed()      →  boolean  (spacebar or mobile Jump button)
 *   isSitJustPressed()   →  boolean  (C key toggle, fires once per press)
 *   isMoving()           →  boolean  (any directional input active?)
 *   isSprinting          →  boolean  (Run button toggle)
 *
 * Call update() once per frame BEFORE reading any of the above.
 *
 * Phase 14: Refactored to own all input logic. Keyboard and joystick
 * state are stored in separate dictionaries so they never corrupt each other.
 */
export class InputManager {
    constructor() {
        // ── Raw state stores ──
        this.keys = {};           // Physical keyboard (set by keydown/keyup)
        this._virtualKeys = {};   // Virtual joystick (synced each frame)

        // ── Sprint ──
        this.isSprinting = false;

        // ── Jump button ──
        this._jumpBtnPressed = false;

        // ── Sit toggle tracking (C key — one-shot) ──
        this._cKeyWasDown = false;
        this._sitJustPressed = false;

        // ── Cached movement vector (recomputed each frame in update()) ──
        this._movement = { x: 0, y: 0, magnitude: 0 };

        // ── Keyboard listeners ──
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
        }, false);
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        }, false);

        // ── Mobile button bindings ──
        this._bindMobileButtons();
    }

    /**
     * Bind the Jump button on the HTML UI.
     * (Sit button is bound by Player.js because it triggers a game-state action.)
     */
    _bindMobileButtons() {
        const jumpBtn = document.getElementById('btn-jump');
        if (jumpBtn) {
            jumpBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this._jumpBtnPressed = true;
            });
            jumpBtn.addEventListener('pointerup', () => {
                this._jumpBtnPressed = false;
            });
        }
    }

    // ----------------------------------------------------------------
    // Per-frame sync — call ONCE at the start of each frame
    // ----------------------------------------------------------------

    /**
     * Syncs joystick globals, detects toggles, caches movement vector.
     * Must be called once per frame before any getter is read.
     */
    update() {
        // Sync joystick booleans → virtual key layer
        this._virtualKeys['w'] = !!window._joystickW;
        this._virtualKeys['s'] = !!window._joystickS;
        this._virtualKeys['a'] = !!window._joystickA;
        this._virtualKeys['d'] = !!window._joystickD;

        // Sprint toggle
        this.isSprinting = !!window._isSprinting;

        // Sit toggle detection (C key — fires only on the frame it's first pressed)
        const cDown = this.keys['c'] === true;
        this._sitJustPressed = cDown && !this._cKeyWasDown;
        this._cKeyWasDown = cDown;

        // Cache the movement vector so getMovementVector() is O(1)
        this._movement = this._computeMovement();
    }

    // ----------------------------------------------------------------
    // Public getters
    // ----------------------------------------------------------------

    /**
     * Is a key currently held (keyboard OR virtual joystick)?
     */
    isKeyDown(key) {
        const k = key.toLowerCase();
        return this.keys[k] === true || this._virtualKeys[k] === true;
    }

    /**
     * Combined movement vector from keyboard + analog joystick.
     * Returns { x, y, magnitude } with x/y in [-1, 1].
     *   x: right = +1, left = -1
     *   y: forward = +1, backward = -1
     *   magnitude: 0…1 (analog; keyboard always yields ~1)
     */
    getMovementVector() {
        return this._movement;
    }

    /** Is any directional input active? */
    isMoving() {
        return this._movement.magnitude > 0.01;
    }

    /** Is jump input active? (spacebar OR mobile Jump button) */
    isJumpPressed() {
        return this.isKeyDown(' ') || this._jumpBtnPressed;
    }

    /** Was the Sit key (C) just pressed THIS frame? (one-shot toggle) */
    isSitJustPressed() {
        return this._sitJustPressed;
    }

    // ----------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------

    /**
     * Computes a unified 2D movement vector from both input sources.
     * Picks whichever source (keyboard or joystick) has stronger magnitude
     * to prevent double-speed when both are active.
     */
    _computeMovement() {
        // Keyboard → {-1, 0, +1} grid
        let kx = 0, ky = 0;
        if (this.isKeyDown('w')) ky += 1;
        if (this.isKeyDown('s')) ky -= 1;
        if (this.isKeyDown('d')) kx += 1;
        if (this.isKeyDown('a')) kx -= 1;

        // Analog joystick → continuous [-1, 1]
        const jx = window._joystickX || 0;
        const jy = window._joystickY || 0;

        const jMag = Math.sqrt(jx * jx + jy * jy);
        const kMag = Math.sqrt(kx * kx + ky * ky);

        let x, y;
        if (jMag > 0.01 && jMag >= kMag) {
            x = jx; y = jy;          // Joystick wins (analog, more precise)
        } else if (kMag > 0) {
            x = kx; y = ky;          // Keyboard wins
        } else {
            return { x: 0, y: 0, magnitude: 0 };
        }

        // Cap magnitude at 1
        const mag = Math.sqrt(x * x + y * y);
        if (mag > 1) { x /= mag; y /= mag; }

        return { x, y, magnitude: Math.min(mag, 1) };
    }
}

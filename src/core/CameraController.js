import * as THREE from 'three';

/**
 * CameraController Class  — Third-Person Shooter style
 *
 * Architecture:
 *   - A THREE.Object3D "anchor" sits at the player's chest height.
 *   - The PerspectiveCamera is a child of the anchor, offset to the RIGHT
 *     and BEHIND the player (over-the-shoulder, like Free Fire / PUBG).
 *   - YAW (horizontal) is applied to the anchor AND synced to the player
 *     model by Game.js, so the character always faces where the camera looks.
 *   - PITCH (vertical) is applied ONLY to the anchor (camera tilts, character stays upright).
 *
 * Input modes:
 *   PC   → Middle-mouse click activates Pointer Lock for FPS-style mouse look.
 *   Mobile → Touch drag on the right side of the screen (handled by pointer events).
 */
export class CameraController {
    /**
     * @param {THREE.PerspectiveCamera} camera
     * @param {HTMLElement} domElement - The renderer's canvas
     * @param {THREE.Scene} scene
     */
    constructor(camera, domElement, scene) {
        this.camera = camera;
        this.domElement = domElement;

        // -------------------------------------------------------
        // CAMERA BOOM / OFFSET SETUP (Over-the-Shoulder)
        // -------------------------------------------------------

        this.anchor = new THREE.Object3D();
        this.anchor.name = 'CameraAnchor';
        scene.add(this.anchor);

        // Camera local offset from the anchor:
        //   x > 0 → shifted to the RIGHT  (over-the-shoulder)
        //   y > 0 → above the pivot
        //   z > 0 → behind the character
        // ── TWEAK THESE for the perfect TPS feel ──
        this.cameraLocalOffset = new THREE.Vector3(0.8, 1.5, 3.5);

        // Place the camera as a child of the anchor
        this.anchor.add(this.camera);
        this.camera.position.copy(this.cameraLocalOffset);

        // -------------------------------------------------------
        // ROTATION STATE
        // -------------------------------------------------------

        this.yaw = 0;     // Horizontal (around Y)
        this.pitch = 0;     // Vertical   (around X)

        // Pitch clamp (radians)
        this.pitchMin = -0.6;   // Can look slightly below horizon
        this.pitchMax = 1.0;   // Can look up but not flip

        // Sensitivity for Pointer Lock (raw movementX / movementY pixels)
        this.sensitivity = 0.002;

        // -------------------------------------------------------
        // POINTER LOCK STATE (PC)
        // -------------------------------------------------------

        this.isPointerLocked = false;

        // Listen for middle-mouse click to request Pointer Lock
        this.domElement.addEventListener('mousedown', (e) => {
            if (e.button === 1) {
                // Middle-mouse button → request Pointer Lock
                e.preventDefault();
                this.domElement.requestPointerLock();
            }
        });

        // Also allow left-click to request Pointer Lock for convenience
        this.domElement.addEventListener('click', () => {
            if (!this.isPointerLocked) {
                this.domElement.requestPointerLock();
            }
        });

        // Listen for pointer lock changes
        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = (document.pointerLockElement === this.domElement);
            console.log('Pointer Lock:', this.isPointerLocked ? 'ACTIVE' : 'RELEASED');
        });

        // Mouse movement (only effective when pointer is locked)
        document.addEventListener('mousemove', (e) => {
            if (!this.isPointerLocked) return;

            // movementX / movementY give raw pixel deltas (no need to track prev position)
            this.yaw -= e.movementX * this.sensitivity;
            this.pitch -= e.movementY * this.sensitivity;
            this.pitch = Math.max(this.pitchMin, Math.min(this.pitchMax, this.pitch));
        });

        // -------------------------------------------------------
        // TOUCH DRAG STATE (Mobile fallback)
        // -------------------------------------------------------

        this.isTouchDragging = false;
        this.prevTouchX = 0;
        this.prevTouchY = 0;

        // Use pointer events for touch (they unify mouse + touch)
        this.domElement.addEventListener('pointerdown', (e) => {
            // Only start touch-drag if pointer lock is NOT active (mobile)
            if (this.isPointerLocked) return;
            if (e.pointerType !== 'touch') return;

            this.isTouchDragging = true;
            this.prevTouchX = e.clientX;
            this.prevTouchY = e.clientY;
            this.domElement.setPointerCapture(e.pointerId);
        });

        this.domElement.addEventListener('pointermove', (e) => {
            if (!this.isTouchDragging) return;

            const dx = e.clientX - this.prevTouchX;
            const dy = e.clientY - this.prevTouchY;
            this.prevTouchX = e.clientX;
            this.prevTouchY = e.clientY;

            this.yaw -= dx * this.sensitivity;
            this.pitch -= dy * this.sensitivity;
            this.pitch = Math.max(this.pitchMin, Math.min(this.pitchMax, this.pitch));
        });

        this.domElement.addEventListener('pointerup', () => {
            this.isTouchDragging = false;
        });
        this.domElement.addEventListener('pointerleave', () => {
            this.isTouchDragging = false;
        });

        // Prevent context menu and touch browser gestures
        this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
        this.domElement.style.touchAction = 'none';

        // Prevent middle-mouse scroll-wheel click from opening auto-scroll
        this.domElement.addEventListener('auxclick', (e) => {
            if (e.button === 1) e.preventDefault();
        });
    }

    // ----------------------------------------------------------------
    // Per-frame update
    // ----------------------------------------------------------------

    /**
     * Call every frame AFTER the player has moved and been ground-clamped.
     * @param {THREE.Vector3} targetPosition - The player model's world position
     */
    update(targetPosition) {
        // 1. Position the anchor at the player, raised to chest height
        this.anchor.position.copy(targetPosition);
        this.anchor.position.y += 1.2;

        // 2. Apply yaw (Y) and pitch (X) to the anchor
        //    Euler order 'YXZ' ensures yaw is applied first
        this.anchor.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // 3. Camera looks at the anchor (the player's chest)
        this.camera.lookAt(this.anchor.getWorldPosition(new THREE.Vector3()));
    }

    /**
     * Returns the current yaw (horizontal rotation) in radians.
     * Game.js uses this to rotate the player model to face where the camera looks.
     */
    getYaw() {
        return this.yaw;
    }

    /**
     * Cleanup
     */
    dispose() {
        document.exitPointerLock();
    }
}

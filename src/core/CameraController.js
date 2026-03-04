import * as THREE from 'three';

/**
 * CameraController Class — Third-Person Shooter style (Free Fire / PUBG)
 *
 * Architecture:
 *   - An invisible "anchor" Object3D sits at the player's chest.
 *   - YAW rotates the anchor around Y (horizontal look).
 *   - PITCH rotates the anchor around X (vertical look), clamped.
 *   - The camera is NOT a child of the anchor.  Instead, we compute the
 *     camera's ideal world position each frame by transforming a local offset
 *     through the anchor's world matrix.  This avoids the broken lookAt()
 *     issue that occurs when the camera is a child of a rotating parent.
 *
 * Input:
 *   PC     → Click canvas to activate Pointer Lock. Mouse drives yaw/pitch.
 *   Mobile → Touch-drag drives yaw/pitch (pointer events fallback).
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
        this.scene = scene;

        // -------------------------------------------------------
        // CAMERA BOOM / OFFSET  (Over-the-Shoulder)
        // -------------------------------------------------------

        // Invisible pivot placed at the player's chest each frame
        this.anchor = new THREE.Object3D();
        this.anchor.name = 'CameraAnchor';
        scene.add(this.anchor);

        // The camera's position relative to the anchor, in the anchor's LOCAL space.
        //   x > 0  → shifted RIGHT  (over-the-shoulder)
        //   y > 0  → above the pivot
        //   z > 0  → behind the character
        // ── TWEAK THESE for the perfect TPS feel ──
        this.localOffset = new THREE.Vector3(1, 2, 4);

        // How high above the player's feet we place the anchor pivot
        // (roughly chest / shoulder height of the scaled character)
        this.pivotHeight = 1.5;

        // -------------------------------------------------------
        // ROTATION STATE
        // -------------------------------------------------------

        this.yaw = 0;
        this.pitch = 0;

        // Pitch clamp (radians)
        this.pitchMin = -0.4;   // slightly below horizon
        this.pitchMax = 0.8;   // looking up, but not flipping

        // Sensitivity (radians per pixel of mouse / touch movement)
        this.sensitivity = 0.002;

        // -------------------------------------------------------
        // Reusable math objects (avoid allocation per frame)
        // -------------------------------------------------------
        this._idealPos = new THREE.Vector3();
        this._lookTarget = new THREE.Vector3();

        // -------------------------------------------------------
        // POINTER LOCK (PC)
        // -------------------------------------------------------

        this.isPointerLocked = false;

        // Click canvas → request Pointer Lock
        this.domElement.addEventListener('click', () => {
            if (!this.isPointerLocked) {
                this.domElement.requestPointerLock();
            }
        });

        // Middle-mouse also requests lock
        this.domElement.addEventListener('mousedown', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                this.domElement.requestPointerLock();
            }
        });

        // Track lock state
        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = (document.pointerLockElement === this.domElement);
        });

        // Raw mouse movement while locked
        document.addEventListener('mousemove', (e) => {
            if (!this.isPointerLocked) return;
            this.yaw -= e.movementX * this.sensitivity;
            this.pitch -= e.movementY * this.sensitivity;
            this.pitch = Math.max(this.pitchMin, Math.min(this.pitchMax, this.pitch));
        });

        // -------------------------------------------------------
        // TOUCH DRAG (Mobile fallback)
        // -------------------------------------------------------
        this.isTouchDragging = false;
        this.prevTouchX = 0;
        this.prevTouchY = 0;

        this.domElement.addEventListener('pointerdown', (e) => {
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

        this.domElement.addEventListener('pointerup', () => { this.isTouchDragging = false; });
        this.domElement.addEventListener('pointerleave', () => { this.isTouchDragging = false; });

        // Misc browser niceties
        this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
        this.domElement.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
        this.domElement.style.touchAction = 'none';
    }

    // ----------------------------------------------------------------
    // Per-frame update
    // ----------------------------------------------------------------

    /**
     * Call every frame AFTER the player has moved and been ground-clamped.
     * @param {THREE.Vector3} targetPosition - The player model's world position (feet)
     */
    update(targetPosition) {
        // 1. Place the anchor at the player's chest height
        this.anchor.position.set(
            targetPosition.x,
            targetPosition.y + this.pivotHeight,
            targetPosition.z
        );

        // 2. Apply yaw + pitch to the anchor (Euler order 'YXZ')
        this.anchor.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // 3. Force the anchor's world matrix to update immediately
        this.anchor.updateMatrixWorld(true);

        // 4. Compute the camera's ideal WORLD position by transforming
        //    localOffset through the anchor's world matrix.
        this._idealPos.copy(this.localOffset);
        this.anchor.localToWorld(this._idealPos);

        // 5. Smoothly interpolate the camera toward the ideal position
        this.camera.position.lerp(this._idealPos, 0.25);

        // 6. The camera must look at the anchor's world position (the player's chest)
        this.anchor.getWorldPosition(this._lookTarget);
        this.camera.lookAt(this._lookTarget);
    }

    /**
     * Returns the current yaw (horizontal) in radians.
     */
    getYaw() {
        return this.yaw;
    }

    dispose() {
        document.exitPointerLock();
    }
}

import * as THREE from 'three';

/**
 * CameraController — Free Fire / PUBG style Third-Person Shooter Camera
 *
 * Architecture (NO lookAt — avoids child-of-rotating-parent bugs):
 *
 *   cameraGroup  (positioned at player neck each frame)
 *     └─ rotation.y = yaw   (horizontal mouse)
 *     └─ rotation.x = pitch (vertical mouse, clamped)
 *          └─ camera (child, local position = shoulder offset)
 *
 *   Because the camera is a child of the group, rotating the group
 *   naturally orbits the camera around the player. The camera's default
 *   -Z look direction points FROM behind the player INTO the distance,
 *   giving a correct over-the-shoulder third-person view.
 *
 * Input:
 *   PC     → Click to activate Pointer Lock. Mouse drives yaw/pitch.
 *   Mobile → Touch drag (pointer events fallback).
 *   Right-click → Aim (zoom FOV + tighter offset).
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
        // CAMERA GROUP (the invisible pivot at the player's neck)
        // -------------------------------------------------------
        this.cameraGroup = new THREE.Object3D();
        this.cameraGroup.name = 'CameraGroup';
        scene.add(this.cameraGroup);

        // Parent the camera to the group
        this.cameraGroup.add(this.camera);

        // ── CAMERA OFFSETS ──
        // Normal (hip-fire): right shoulder, above head, behind player
        //   x > 0 = right,  y > 0 = above pivot,  z > 0 = behind player
        // Character is ~11.5 units tall (scale 2.5 × 4.6 raw height)
        this.normalOffset = new THREE.Vector3(1.5, 2.0, 10.0);
        // Aiming (right-click): tighter, closer
        this.aimOffset = new THREE.Vector3(2.0, 1.0, 6.0);

        // Set camera to the normal offset initially
        this.camera.position.copy(this.normalOffset);

        // Height above the player's FEET where we place the pivot.
        // Set ABOVE the player's head so the crosshair (screen center)
        // is above the character — exactly like Free Fire.
        // Character height ≈ 11.5 → pivot at 13.0 = above head
        this.pivotHeight = 7.0;

        // -------------------------------------------------------
        // ROTATION STATE
        // -------------------------------------------------------
        this.yaw = 0;    // Horizontal (mouse X)
        this.pitch = 0;    // Vertical   (mouse Y)

        // Pitch clamp (radians)
        //   positive = looking up,  negative = looking down
        this.pitchMin = -0.4;
        this.pitchMax = 0.8;

        this.sensitivity = 0.002;

        // -------------------------------------------------------
        // AIMING STATE (Right-click zoom)
        // -------------------------------------------------------
        this.isAiming = false;
        this.normalFOV = 75;
        this.aimFOV = 45;

        // -------------------------------------------------------
        // POINTER LOCK (PC)
        // -------------------------------------------------------
        this.isPointerLocked = false;

        // Click to lock
        this.domElement.addEventListener('click', () => {
            if (!this.isPointerLocked) {
                this.domElement.requestPointerLock();
            }
        });

        // Middle-mouse also locks
        this.domElement.addEventListener('mousedown', (e) => {
            if (e.button === 1) { e.preventDefault(); this.domElement.requestPointerLock(); }
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
        // RIGHT-CLICK AIM
        // -------------------------------------------------------
        this.domElement.addEventListener('mousedown', (e) => {
            if (e.button === 2) this.isAiming = true;    // Right-click down → aim
        });
        this.domElement.addEventListener('mouseup', (e) => {
            if (e.button === 2) this.isAiming = false;   // Right-click up   → stop aiming
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

        // Browser niceties
        this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
        this.domElement.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
        this.domElement.style.touchAction = 'none';
    }

    // ----------------------------------------------------------------
    // Per-frame update
    // ----------------------------------------------------------------

    /**
     * Call every frame AFTER the player has moved and been ground-clamped.
     * @param {THREE.Vector3} playerFeetPos - The player model's world position (feet)
     */
    update(playerFeetPos) {
        // 1. Position the group at the player's neck/shoulder height
        this.cameraGroup.position.set(
            playerFeetPos.x,
            playerFeetPos.y + this.pivotHeight,
            playerFeetPos.z
        );

        // 2. Apply yaw + pitch to the group.
        //    Euler order YXZ: yaw (Y) applied first in world, then pitch (X) in local.
        this.cameraGroup.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // 3. Smoothly interpolate the camera's local offset for aiming
        const targetOffset = this.isAiming ? this.aimOffset : this.normalOffset;
        this.camera.position.lerp(targetOffset, 0.15);

        // 4. Smoothly interpolate FOV for aiming zoom
        const targetFOV = this.isAiming ? this.aimFOV : this.normalFOV;
        this.camera.fov += (targetFOV - this.camera.fov) * 0.15;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Returns the current yaw (horizontal rotation) in radians.
     */
    getYaw() {
        return this.yaw;
    }

    dispose() {
        document.exitPointerLock();
    }
}

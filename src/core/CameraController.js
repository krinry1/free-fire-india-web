import * as THREE from 'three';

/**
 * CameraController Class
 * Implements a third-person "camera boom" that orbits around a target (the player).
 *
 * Architecture:
 *   - A THREE.Object3D called `anchor` is placed at the player's position every frame.
 *   - The anchor's Y-rotation controls YAW  (horizontal look — left/right).
 *   - The anchor's X-rotation controls PITCH (vertical look — up/down), clamped.
 *   - The actual THREE.PerspectiveCamera is a child of the anchor, offset along
 *     the local Z axis (behind) and Y axis (above).
 *
 * Input:
 *   Uses the Pointer Events API (pointerdown / pointermove / pointerup) which
 *   automatically unifies Mouse + Touch on both Desktop and Mobile.
 */
export class CameraController {
    /**
     * @param {THREE.PerspectiveCamera} camera - The main rendering camera
     * @param {HTMLElement} domElement - The renderer's canvas (used for pointer events)
     * @param {THREE.Scene} scene - The main scene (we add the anchor to it)
     */
    constructor(camera, domElement, scene) {
        this.camera = camera;
        this.domElement = domElement;

        // -------------------------------------------------------
        // CAMERA BOOM SETUP
        // -------------------------------------------------------

        // The anchor is an invisible pivot that sits at the player's position.
        // Rotating this pivot rotates the camera around the player.
        this.anchor = new THREE.Object3D();
        this.anchor.name = 'CameraAnchor';
        scene.add(this.anchor);

        // Offset from anchor → where the camera actually sits.
        // Local space: x=0 (centered), y=2.5 (above), z=6 (behind)
        // ── TWEAK THESE to change how far / close the camera feels ──
        this.boomLength = 6;      // Distance behind the player
        this.boomHeight = 2.5;    // Height above the player pivot

        // Place the camera as a child of the anchor at the boom offset
        this.anchor.add(this.camera);
        this.camera.position.set(0, this.boomHeight, this.boomLength);

        // -------------------------------------------------------
        // ROTATION STATE
        // -------------------------------------------------------

        // Current yaw/pitch in radians
        this.yaw = 0;              // Horizontal rotation (around Y axis)
        this.pitch = 0;            // Vertical rotation (around X axis)

        // Pitch clamp limits (in radians)
        // -0.5 ≈ looking slightly down,  1.2 ≈ looking steeply up
        this.pitchMin = -0.5;      // Cannot look below the ground
        this.pitchMax = 1.2;       // Cannot flip over the character's head

        // Sensitivity — how many radians per pixel of pointer drag
        this.sensitivity = 0.003;

        // -------------------------------------------------------
        // POINTER TRACKING STATE
        // -------------------------------------------------------

        this.isPointerDown = false;
        this.prevPointerX = 0;
        this.prevPointerY = 0;

        // Bind event handlers
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);

        // Attach unified pointer events on the canvas
        this.domElement.addEventListener('pointerdown', this.onPointerDown);
        this.domElement.addEventListener('pointermove', this.onPointerMove);
        this.domElement.addEventListener('pointerup', this.onPointerUp);
        this.domElement.addEventListener('pointerleave', this.onPointerUp);

        // Prevent the context menu on right-click drag
        this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

        // Make sure touch-action is set so mobile browsers don't hijack gestures
        this.domElement.style.touchAction = 'none';
    }

    // ----------------------------------------------------------------
    // Pointer Event Handlers (unified Mouse + Touch)
    // ----------------------------------------------------------------

    onPointerDown(event) {
        this.isPointerDown = true;
        this.prevPointerX = event.clientX;
        this.prevPointerY = event.clientY;

        // Capture the pointer so we get events even outside the canvas
        this.domElement.setPointerCapture(event.pointerId);
    }

    onPointerMove(event) {
        if (!this.isPointerDown) return;

        // Compute how far the pointer moved since last frame
        const deltaX = event.clientX - this.prevPointerX;
        const deltaY = event.clientY - this.prevPointerY;

        // Update stored position
        this.prevPointerX = event.clientX;
        this.prevPointerY = event.clientY;

        // Apply rotation deltas
        // Horizontal drag → yaw (rotate around world Y axis)
        this.yaw -= deltaX * this.sensitivity;

        // Vertical drag → pitch (rotate around local X axis), clamped
        this.pitch -= deltaY * this.sensitivity;
        this.pitch = Math.max(this.pitchMin, Math.min(this.pitchMax, this.pitch));
    }

    onPointerUp(event) {
        this.isPointerDown = false;
    }

    // ----------------------------------------------------------------
    // Per-frame update
    // ----------------------------------------------------------------

    /**
     * Call this every frame AFTER the player has moved.
     * @param {THREE.Vector3} targetPosition - The player model's current world position
     */
    update(targetPosition) {
        // 1. Move the anchor to the player's position
        this.anchor.position.copy(targetPosition);
        // Slightly raise the pivot so the camera orbits around the character's chest,
        // not their feet
        this.anchor.position.y += 1.0;

        // 2. Apply yaw + pitch rotations to the anchor
        // We use Euler order 'YXZ' so yaw (Y) is applied first, then pitch (X)
        this.anchor.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // 3. Tell the camera to look at the anchor's world position (the player)
        // Because the camera is a child of the anchor, its local position
        // (0, boomHeight, boomLength) is automatically transformed.
        // We just need it to face the anchor.
        this.camera.lookAt(this.anchor.getWorldPosition(new THREE.Vector3()));
    }

    /**
     * Returns the current yaw angle in radians.
     * Player.js can use this to rotate the character to face the camera direction
     * when moving forward.
     */
    getYaw() {
        return this.yaw;
    }

    /**
     * Clean up all event listeners (call if you ever dispose of this controller).
     */
    dispose() {
        this.domElement.removeEventListener('pointerdown', this.onPointerDown);
        this.domElement.removeEventListener('pointermove', this.onPointerMove);
        this.domElement.removeEventListener('pointerup', this.onPointerUp);
        this.domElement.removeEventListener('pointerleave', this.onPointerUp);
    }
}

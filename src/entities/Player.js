import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Player Class
 * Handles the 3D character model (static mesh, NO animations),
 * and directional WASD movement relative to the camera's yaw.
 *
 * Movement scheme (TPS — move where you look):
 *   W → Move forward   (the direction the camera faces horizontally)
 *   S → Move backward
 *   A → Strafe left
 *   D → Strafe right
 *
 * The player's Y-rotation is synced to the camera yaw externally by Game.js,
 * so the character always faces where the camera is looking.
 *
 * Camera is handled entirely by CameraController.
 * Ground clamping is handled externally by Game.js via Raycaster.
 */
export class Player {
    /**
     * @param {THREE.Scene} scene
     * @param {CANNON.World} physicsWorld
     * @param {InputManager} inputManager
     */
    constructor(scene, physicsWorld, inputManager) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.inputManager = inputManager;

        // The loaded 3D model root node
        this.model = null;
        // Cannon-es body (created but NOT driving movement yet)
        this.body = null;

        // =====================================================
        // MOVEMENT SPEED — Tweak this to change how fast the player moves
        // Units per second.
        // =====================================================
        this.moveSpeed = 30.0;

        // Reusable vectors (avoid allocations per frame)
        this.moveDirection = new THREE.Vector3();

        // =====================================================
        // JUMP / GRAVITY  — Simple manual simulation
        // =====================================================
        this.velocityY = 0;       // Current vertical velocity
        this.gravity = 40.0;    // Gravity acceleration (units/s²) — pulls down
        this.jumpForce = 25.0;    // Upward impulse when space is pressed (increased for stairs/obstacles)
        this.isGrounded = false;   // Set to true by Game.js ground clamping

        // =====================================================
        // PLAYER SCALE — Tweak this value to resize the character!
        // The raw character.glb is ~4.6 units tall.
        // scale 1.5 → ~6.9m  |  scale 2.0 → ~9.2m  |  scale 2.5 → ~11.5m
        // =====================================================
        this.playerScale = 2.5;

        // Small AxesHelper attached to the player so you can see facing direction
        this.axesHelper = null;
    }

    // ----------------------------------------------------------------
    // Initialization
    // ----------------------------------------------------------------

    async init() {
        this.setupPhysics();
        await this.loadModel('/models/character.glb');
    }

    /**
     * Create the Cannon-es body (not driving movement yet).
     */
    setupPhysics() {
        const hw = 0.3 * this.playerScale;
        const hh = 0.9 * this.playerScale;
        const hd = 0.3 * this.playerScale;
        const halfExtents = new CANNON.Vec3(hw, hh, hd);
        const playerShape = new CANNON.Box(halfExtents);

        this.body = new CANNON.Body({
            mass: 75,
            shape: playerShape,
            fixedRotation: true,
            position: new CANNON.Vec3(0, 100, 0)
        });

        this.body.linearDamping = 0.9;
        this.physicsWorld.addBody(this.body);
    }

    /**
     * Load the character.glb mesh, scale it, and attach a debug AxesHelper.
     */
    loadModel(url) {
        return new Promise((resolve) => {
            const loader = new GLTFLoader();

            loader.load(
                url,
                (gltf) => {
                    this.model = gltf.scene;

                    // --- Apply the player scale ---
                    this.model.scale.set(this.playerScale, this.playerScale, this.playerScale);

                    // Debug: log the SCALED bounding box
                    const charBox = new THREE.Box3().setFromObject(this.model);
                    const charSize = new THREE.Vector3();
                    charBox.getSize(charSize);
                    console.log('=== CHARACTER (after scaling) ===');
                    console.log('  Scale  :', this.playerScale);
                    console.log('  Size   :', charSize);
                    console.log('  Height :', charSize.y.toFixed(2), 'units');

                    // Enable shadow casting / receiving
                    this.model.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });

                    // Place the character at world origin
                    // Spawn high up — gravity + ground clamping will drop them onto terrain
                    this.model.position.set(0, 100, 0);

                    // --- Attach a small AxesHelper so we can see facing direction ---
                    this.axesHelper = new THREE.AxesHelper(2);
                    this.model.add(this.axesHelper);

                    this.scene.add(this.model);
                    console.log('Player model loaded & scaled successfully:', url);
                    resolve();
                },
                (xhr) => {
                    if (xhr.total) {
                        console.log(`Loading player... ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
                    }
                },
                (error) => {
                    console.error('Player model load error:', error);
                    resolve();
                }
            );
        });
    }

    // ----------------------------------------------------------------
    // Per-frame update
    // ----------------------------------------------------------------

    /**
     * Called every frame from Game.animate().
     * @param {number} delta - seconds since last frame
     * @param {number} cameraYaw - the current horizontal rotation of the camera (radians)
     */
    update(delta, cameraYaw) {
        if (!this.model) return;

        // 1. Horizontal WASD movement
        this.handleMovement(delta, cameraYaw);

        // 2. Jump & Gravity (vertical axis)
        this.handleJump(delta);
    }

    /**
     * Spacebar jump + gravity simulation.
     * Game.js ground-clamping sets this.isGrounded = true and floors the Y.
     */
    handleJump(delta) {
        const input = this.inputManager;

        // Trigger jump only when grounded and Space is pressed
        if (input.isKeyDown(' ') && this.isGrounded) {
            this.velocityY = this.jumpForce;   // Apply upward impulse
            this.isGrounded = false;             // We are now airborne
        }

        // Apply gravity every frame (even when grounded, clampPlayerToGround fixes it)
        this.velocityY -= this.gravity * delta;

        // Move the player vertically
        this.model.position.y += this.velocityY * delta;
    }

    /**
     * Directional WASD movement relative to the camera's yaw.
     *
     * Math:
     *   Forward = ( -sin(yaw),  0,  -cos(yaw) )
     *   Right   = (  cos(yaw),  0,  -sin(yaw) )
     */
    handleMovement(delta, cameraYaw) {
        const input = this.inputManager;

        const w = input.isKeyDown('w');
        const s = input.isKeyDown('s');
        const a = input.isKeyDown('a');
        const d = input.isKeyDown('d');

        const isMoving = w || s || a || d;
        if (!isMoving) return;

        // Build the forward and right unit vectors from the camera yaw
        const forwardX = -Math.sin(cameraYaw);
        const forwardZ = -Math.cos(cameraYaw);

        const rightX = Math.cos(cameraYaw);
        const rightZ = -Math.sin(cameraYaw);

        // Accumulate direction
        let dx = 0;
        let dz = 0;

        if (w) { dx += forwardX; dz += forwardZ; }  // Forward
        if (s) { dx -= forwardX; dz -= forwardZ; }  // Backward
        if (d) { dx += rightX; dz += rightZ; }  // Strafe right
        if (a) { dx -= rightX; dz -= rightZ; }  // Strafe left

        // Normalize so diagonal movement isn't faster
        this.moveDirection.set(dx, 0, dz).normalize();

        // Apply speed * delta
        this.model.position.addScaledVector(this.moveDirection, this.moveSpeed * delta);

        // Rotate the character model to face the movement direction
        if (this.moveDirection.lengthSq() > 0.001) {
            const targetAngle = Math.atan2(-this.moveDirection.x, -this.moveDirection.z);
            this.model.rotation.y = targetAngle;
        }
    }
}


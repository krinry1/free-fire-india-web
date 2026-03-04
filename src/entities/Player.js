import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Player Class
 * Handles the 3D character model (static mesh, NO animations),
 * and basic WASD "tank-style" movement.
 *
 * Movement scheme:
 *   W / S  → Move forward / backward along the character's facing direction
 *   A / D  → Rotate the character left / right
 *
 * Camera is now handled entirely by CameraController — Player no longer touches it.
 * Ground clamping is handled externally by Game.js via Raycaster.
 */
export class Player {
    /**
     * @param {THREE.Scene} scene - The main Three.js scene
     * @param {CANNON.World} physicsWorld - The Cannon-es physics world (kept for later phases)
     * @param {InputManager} inputManager - Handles keyboard states
     */
    constructor(scene, physicsWorld, inputManager) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.inputManager = inputManager;

        // The loaded 3D model root node
        this.model = null;
        // Cannon-es body (created but NOT driving movement yet)
        this.body = null;

        // --- Movement tuning ---
        this.moveSpeed = 8.0;      // Units per second (forward / backward)
        this.turnSpeed = 2.5;      // Radians per second (left / right rotation)

        // Reusable vectors so we don't allocate every frame
        this.forwardDir = new THREE.Vector3();

        // =====================================================
        // PLAYER SCALE — Tweak this value to resize the character!
        // The raw character.glb is ~4.6 units tall.
        // scale 0.4 → ~1.84m  |  scale 1.0 → 4.6m  |  scale 1.5 → ~6.9m
        // Increase until the character looks right next to the map buildings.
        // =====================================================
        this.playerScale = 1.5;

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
     * Create the Cannon-es body.
     * NOTE: Physics body exists but does NOT drive movement yet.
     */
    setupPhysics() {
        // Scale physics half-extents to roughly match the visual scale
        const hw = 0.3 * this.playerScale;
        const hh = 0.9 * this.playerScale;
        const hd = 0.3 * this.playerScale;
        const halfExtents = new CANNON.Vec3(hw, hh, hd);
        const playerShape = new CANNON.Box(halfExtents);

        this.body = new CANNON.Body({
            mass: 75,
            shape: playerShape,
            fixedRotation: true,
            position: new CANNON.Vec3(0, 5, 0)
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
                    this.model.position.set(0, 0, 0);

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
     * Camera is no longer managed here — see CameraController.
     * @param {number} delta - seconds since last frame
     */
    update(delta) {
        if (!this.model) return;
        this.handleMovement(delta);
    }

    /**
     * Tank-style WASD movement:
     *   W → move forward (the direction the character faces)
     *   S → move backward
     *   A → rotate left
     *   D → rotate right
     */
    handleMovement(delta) {
        const input = this.inputManager;

        // --- Rotation (A / D) ---
        if (input.isKeyDown('a')) {
            this.model.rotation.y += this.turnSpeed * delta;
        }
        if (input.isKeyDown('d')) {
            this.model.rotation.y -= this.turnSpeed * delta;
        }

        // --- Translation (W / S) ---
        this.model.getWorldDirection(this.forwardDir);

        if (input.isKeyDown('w')) {
            this.model.position.addScaledVector(this.forwardDir, this.moveSpeed * delta);
        }
        if (input.isKeyDown('s')) {
            this.model.position.addScaledVector(this.forwardDir, -this.moveSpeed * delta);
        }
    }
}

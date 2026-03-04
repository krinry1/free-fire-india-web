import * as THREE from 'three';
import { World } from './World.js';
import { Physics } from './Physics.js';
import { Player } from '../entities/Player.js';
import { InputManager } from './InputManager.js';
import { CameraController } from './CameraController.js';

/**
 * Game Class
 * Orchestrates the Scene, Camera, Renderer, and the Main Loop.
 * Handles ground-clamping and wall collision via Raycasters.
 */
export class Game {
    constructor(container) {
        this.container = container;

        // 1. Scene
        this.scene = new THREE.Scene();
        const skyColor = new THREE.Color(0x87CEEB);
        this.scene.background = skyColor;
        this.scene.fog = new THREE.Fog(skyColor, 50, 500);

        // 2. Camera
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

        // 3. Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // 4. Resize
        window.addEventListener('resize', this.onWindowResize.bind(this), false);

        // 5. Game Systems
        this.physics = new Physics();
        this.world = new World(this.scene);
        this.inputManager = new InputManager();
        this.player = new Player(this.scene, this.physics.world, this.inputManager);

        // 6. Camera Controller (TPS over-the-shoulder)
        this.cameraController = new CameraController(
            this.camera,
            this.renderer.domElement,
            this.scene
        );

        // DEBUG: AxesHelper at world origin
        this.scene.add(new THREE.AxesHelper(10));

        // -------------------------------------------------------
        // GROUND RAYCASTER
        // Starts slightly above the player's head and casts DOWN.
        // This prevents teleporting to rooftops when entering buildings.
        // -------------------------------------------------------
        this.groundRaycaster = new THREE.Raycaster();
        this.groundRayOrigin = new THREE.Vector3();
        this.groundRayDir = new THREE.Vector3(0, -1, 0);

        // -------------------------------------------------------
        // WALL COLLISION RAYCASTER
        // Casts short horizontal rays in 4 cardinal directions.
        // If a wall is too close, push the player away.
        // -------------------------------------------------------
        this.wallRaycaster = new THREE.Raycaster();
        this.wallRayOrigin = new THREE.Vector3();

        // Pre-defined horizontal directions (+X, -X, +Z, -Z)
        this.wallDirections = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, -1),
        ];
        // Also add diagonals for better corner handling
        const d = Math.SQRT1_2; // ~0.707
        this.wallDirections.push(
            new THREE.Vector3(d, 0, d),
            new THREE.Vector3(-d, 0, d),
            new THREE.Vector3(d, 0, -d),
            new THREE.Vector3(-d, 0, -d),
        );

        // How far to check for walls, and the minimum allowed distance
        this.wallCheckDist = 1.2;
        this.wallMinDist = 0.8;

        // Timing
        this.clock = new THREE.Clock();
    }

    async init() {
        await this.world.init().catch(err => console.error("Map Load Err:", err));
        await this.player.init().catch(err => console.error("Player Load Err:", err));
    }

    start() {
        this.renderer.setAnimationLoop(this.animate.bind(this));
    }

    // ----------------------------------------------------------------
    // MAIN GAME LOOP
    // ----------------------------------------------------------------
    animate() {
        const delta = Math.min(this.clock.getDelta(), 0.1);

        // 1. Physics tick (Cannon-es, not driving visuals yet)
        this.physics.update(delta);

        // 2. Camera yaw → player movement is relative to look direction
        const cameraYaw = this.cameraController.getYaw();

        // 3. Player movement (WASD + Jump/Gravity)
        this.player.update(delta, cameraYaw);

        // 4. Ground-clamp the player onto the map terrain
        this.clampPlayerToGround();

        // 5. Wall collision (push player away from walls)
        this.resolveWallCollision();

        // 6. Camera follows the player
        if (this.player.model) {
            this.cameraController.update(this.player.model.position);
        }

        // 7. World tick
        this.world.update(delta);

        // 8. Render
        this.renderer.render(this.scene, this.camera);
    }

    // ----------------------------------------------------------------
    // GROUND CLAMPING
    // ----------------------------------------------------------------
    /**
     * Casts a ray DOWNWARD from slightly above the player's head.
     * Starting from player.y + 3 (not Y=500!) ensures that when the player
     * walks into a building, the ray starts INSIDE the building and
     * hits the floor — NOT the roof.
     *
     * Works with the jump system:
     *   - Only clamps when the player is at or below the ground (falling/standing).
     *   - Resets velocityY and isGrounded on landing.
     */
    clampPlayerToGround() {
        const player = this.player;
        const playerModel = player.model;
        if (!playerModel) return;

        const mapMeshes = this.world.mapMeshes;
        if (!mapMeshes || mapMeshes.length === 0) return;

        // Start the ray a few units above the player's current position.
        // This is the KEY FIX: using player.y + 3 instead of 500
        // prevents teleporting to rooftops.
        const rayStartY = playerModel.position.y + 3;
        this.groundRayOrigin.set(playerModel.position.x, rayStartY, playerModel.position.z);
        this.groundRaycaster.set(this.groundRayOrigin, this.groundRayDir);

        const intersects = this.groundRaycaster.intersectObjects(mapMeshes, false);

        if (intersects.length > 0) {
            const groundY = intersects[0].point.y;

            // Only clamp when the player is at or below the ground surface
            if (playerModel.position.y <= groundY) {
                playerModel.position.y = groundY;
                player.velocityY = 0;
                player.isGrounded = true;
            }
        }
    }

    // ----------------------------------------------------------------
    // WALL COLLISION
    // ----------------------------------------------------------------
    /**
     * Casts short horizontal rays from the player's chest in 8 directions.
     * If any ray hits a wall closer than wallMinDist, push the player away.
     * This prevents walking through walls and creates a "sliding" effect.
     */
    resolveWallCollision() {
        const playerModel = this.player.model;
        if (!playerModel) return;

        const mapMeshes = this.world.mapMeshes;
        if (!mapMeshes || mapMeshes.length === 0) return;

        const pos = playerModel.position;
        // Cast from the player's chest height (not feet — avoids hitting floor edges)
        const chestY = pos.y + 1.0;

        for (const dir of this.wallDirections) {
            this.wallRayOrigin.set(pos.x, chestY, pos.z);
            this.wallRaycaster.set(this.wallRayOrigin, dir);
            this.wallRaycaster.far = this.wallCheckDist;

            const hits = this.wallRaycaster.intersectObjects(mapMeshes, false);

            if (hits.length > 0 && hits[0].distance < this.wallMinDist) {
                // Push the player away from this surface
                const pushAmount = this.wallMinDist - hits[0].distance;
                pos.x -= dir.x * pushAmount;
                pos.z -= dir.z * pushAmount;
            }
        }
    }

    // ----------------------------------------------------------------
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

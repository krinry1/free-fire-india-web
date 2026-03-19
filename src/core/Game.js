import * as THREE from 'three';
import { World } from './World.js';
import { Physics } from './Physics.js';
import { Player } from '../entities/Player.js';
import { InputManager } from './InputManager.js';
import { CameraController } from './CameraController.js';
import { NPC } from '../entities/NPC.js';
import { SoundManager } from './SoundManager.js';

// Reusable screen-center vector for raycasting (avoids per-frame allocation)
const _screenCenter = new THREE.Vector2(0, 0);

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
        this.scene.fog = new THREE.Fog(skyColor, 50, 300);

        // 2. Camera
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

        // 3. Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
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

        // 7. Sound Manager
        this.soundManager = new SoundManager(this.camera);

        // Reusable raycaster for shooting
        this.shootRaycaster = new THREE.Raycaster();

        // -------------------------------------------------------
        // NPC Manager
        // -------------------------------------------------------
        this.npcs = [];
        this.npcSpawnTimer = 0;
        this.maxNpcs = 5;

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

        // Load sounds from user-provided paths (public/models/)
        this.soundManager.loadSound('fire', '/models/fire.mp3');
        this.soundManager.loadSound('footsteps', '/models/footsteps.mp3', true, 0.3);
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
        this.player.update(delta, cameraYaw, this.soundManager);

        // 4. Ground-clamp the player onto the map terrain
        this.clampPlayerToGround();

        // 5. Wall collision (push player away from walls)
        this.resolveWallCollision();

        // 6. Camera follows the player (use playerGroup — the logical entity)
        if (this.player.playerGroup) {
            this.cameraController.update(this.player.playerGroup.position);

            // Handle Player Attacking (Shooting)
            if (this.inputManager.isAttackJustPressed()) {
                this.shootGun();
            }
        }

        // 7. World tick
        this.world.update(delta);

        // 8. NPC tick
        this.updateNPCs(delta);

        // 9. Render
        this.renderer.render(this.scene, this.camera);
    }

    // ----------------------------------------------------------------
    // NPC Management
    // ----------------------------------------------------------------
    updateNPCs(delta) {
        // Spawn NPCs randomly
        this.npcSpawnTimer += delta;
        if (this.npcSpawnTimer > 5.0 && this.npcs.length < this.maxNpcs) {
            this.npcSpawnTimer = 0;
            const x = (Math.random() - 0.5) * 80;
            const z = (Math.random() - 0.5) * 80;
            const npc = new NPC(this.scene, this.physics.world, new THREE.Vector3(x, 100, z));
            this.npcs.push(npc);
        }

        const now = this.clock.getElapsedTime();
        // Update each NPC
        for (let i = this.npcs.length - 1; i >= 0; i--) {
            const npc = this.npcs[i];
            npc.update(delta, this.player, now);

            // Ground clamping for NPC
            if (!npc.isDead && this.world.mapMeshes && this.world.mapMeshes.length > 0) {
                const npcModel = npc.npcGroup;
                const rayStartY = npcModel.position.y + 3;
                this.groundRayOrigin.set(npcModel.position.x, rayStartY, npcModel.position.z);
                this.groundRaycaster.set(this.groundRayOrigin, this.groundRayDir);

                const intersects = this.groundRaycaster.intersectObjects(this.world.mapMeshes, false);
                if (intersects.length > 0) {
                    const groundY = intersects[0].point.y;
                    if (npcModel.position.y <= groundY + 0.5) { // offset for cylinder
                        npcModel.position.y = groundY;
                    } else {
                        // basic gravity manually for now
                        npcModel.position.y -= 10 * delta;
                    }
                }
            }

            // Cleanup dead NPCs from array
            if (npc.hp <= 0 && npc.isDead) { // Check if properly died
                // we can keep them in array if we want dead bodies to stay a bit,
                // but let's remove from array shortly after they die.
                // The NPC class handles its own removal from scene.
                setTimeout(() => {
                    const idx = this.npcs.indexOf(npc);
                    if (idx > -1) this.npcs.splice(idx, 1);
                }, 3000);
                npc.hp = -1; // Hack to ensure timeout only runs once
            }
        }
    }

    // ----------------------------------------------------------------
    // Player Shooting
    // ----------------------------------------------------------------
    shootGun() {
        if (!this.player.playerGroup || this.player.isDead) return;

        // Visual/Audio cue
        this.soundManager.playSound('fire');

        // Reuse the pre-allocated raycaster
        this.shootRaycaster.setFromCamera(_screenCenter, this.camera);

        const targetMeshes = [];
        for (let i = 0; i < this.npcs.length; i++) {
            const npc = this.npcs[i];
            if (!npc.isDead && npc.mesh) {
                targetMeshes.push(npc.mesh);
                npc.mesh.userData.npc = npc;
            }
        }

        // Add map to check if we hit a wall first
        const allTargets = targetMeshes.concat(this.world.mapMeshes);
        const intersects = this.shootRaycaster.intersectObjects(allTargets, true);

        if (intersects.length > 0) {
            const hit = intersects[0];
            let current = hit.object;
            while (current) {
                if (current.userData && current.userData.npc) {
                    current.userData.npc.takeDamage(25);
                    break;
                }
                current = current.parent;
            }
        }
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
        const playerModel = player.playerGroup; // ★ use the group, not the visual model
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

            // Only clamp when the player is NOT jumping up (velocityY <= 0)
            // and is at or below the ground surface.
            if (player.velocityY <= 0 && playerModel.position.y <= groundY + 0.01) {
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
        const playerModel = this.player.playerGroup; // ★ use the group, not the visual model
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

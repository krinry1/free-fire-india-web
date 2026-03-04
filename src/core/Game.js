import * as THREE from 'three';
import { World } from './World.js';
import { Physics } from './Physics.js';
import { Player } from '../entities/Player.js';
import { InputManager } from './InputManager.js';
import { CameraController } from './CameraController.js';

/**
 * Game Class
 * Handles the core Three.js setup: Scene, Camera, Renderer, and the Main Loop.
 * Owns the CameraController and performs ground-clamping via Raycaster each frame.
 */
export class Game {
    /**
     * @param {HTMLElement} container - The DOM element to attach the canvas to.
     */
    constructor(container) {
        this.container = container;

        // 1. Initialize Scene
        this.scene = new THREE.Scene();

        // Sky-blue background + distance fog
        const skyColor = new THREE.Color(0x87CEEB);
        this.scene.background = skyColor;
        this.scene.fog = new THREE.Fog(skyColor, 50, 500);

        // 2. Initialize Camera
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

        // 3. Initialize WebGLRenderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Enable shadows
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Append the renderer's canvas to the DOM
        this.container.appendChild(this.renderer.domElement);

        // 4. Handle Window Resizing
        window.addEventListener('resize', this.onWindowResize.bind(this), false);

        // 5. Initialize Game Systems
        this.physics = new Physics();
        this.world = new World(this.scene);
        this.inputManager = new InputManager();

        // Player no longer receives the camera — CameraController handles that
        this.player = new Player(this.scene, this.physics.world, this.inputManager);

        // 6. Camera Controller (boom / orbit around the player)
        // Needs the renderer's DOM element for pointer events
        this.cameraController = new CameraController(
            this.camera,
            this.renderer.domElement,
            this.scene
        );

        // --- DEBUG: Small AxesHelper at world origin ---
        const axesHelper = new THREE.AxesHelper(10);
        this.scene.add(axesHelper);

        // --- RAYCASTER for ground clamping ---
        this.groundRaycaster = new THREE.Raycaster();
        this.rayOrigin = new THREE.Vector3();
        this.rayDirection = new THREE.Vector3(0, -1, 0);

        // Timing
        this.clock = new THREE.Clock();
    }

    /**
     * Asynchronously initialize game assets.
     */
    async init() {
        await this.world.init().catch(err => console.error("Map Load Err:", err));
        await this.player.init().catch(err => console.error("Player Load Err:", err));
    }

    /**
     * Start the render loop
     */
    start() {
        this.renderer.setAnimationLoop(this.animate.bind(this));
    }

    /**
     * The main game loop.
     */
    animate() {
        const delta = Math.min(this.clock.getDelta(), 0.1);

        // 1. Physics tick (unused visually for now)
        this.physics.update(delta);

        // 2. Get the camera's current yaw (horizontal look direction)
        const cameraYaw = this.cameraController.getYaw();

        // 3. Player movement (WASD, relative to camera yaw)
        this.player.update(delta, cameraYaw);

        // 4. Ground-clamp the player onto the map terrain
        this.clampPlayerToGround();

        // 5. Update the camera boom to follow the player's new position
        if (this.player.model) {
            this.cameraController.update(this.player.model.position);
        }

        // 6. World tick
        this.world.update(delta);

        // 7. Render
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Downward Raycaster — snaps the player's Y to the terrain surface.
     */
    clampPlayerToGround() {
        const playerModel = this.player.model;
        if (!playerModel) return;

        const mapMeshes = this.world.mapMeshes;
        if (!mapMeshes || mapMeshes.length === 0) return;

        this.rayOrigin.set(playerModel.position.x, 500, playerModel.position.z);
        this.groundRaycaster.set(this.rayOrigin, this.rayDirection);

        const intersects = this.groundRaycaster.intersectObjects(mapMeshes, false);

        if (intersects.length > 0) {
            playerModel.position.y = intersects[0].point.y;
        }
    }

    /**
     * Window resize handler.
     */
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

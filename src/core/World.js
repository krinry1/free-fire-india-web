import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * World Class
 * Manages the scene environment: Lighting, Loading Map/Props, and Sky.
 */
export class World {
    /**
     * @param {THREE.Scene} scene - The main Three.js scene object
     */
    constructor(scene) {
        this.scene = scene;
        this.mapModel = null;

        // Array of all map meshes — used by the Raycaster for ground clamping
        this.mapMeshes = [];

        // This array will hold animated objects/characters later down the road
        this.updatables = [];

        // Basic lighting setup
        this.setupLights();
    }

    /**
     * Initializes the environment loading
     */
    async init() {
        try {
            // Wait for map load before resolving
            await this.loadMap('/models/map.glb');
        } catch (error) {
            console.error("Failed to load map:", error);
            throw error;
        }
    }

    /**
     * Set up basic lighting needed for outdoor environments.
     */
    setupLights() {
        // 1. Hemisphere Light
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemiLight.position.set(0, 200, 0);
        this.scene.add(hemiLight);

        // 2. Directional Light (Acts like the Sun)
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(50, 200, 50);

        // Shadow config
        dirLight.castShadow = true;
        dirLight.shadow.camera.top = 200;
        dirLight.shadow.camera.bottom = -200;
        dirLight.shadow.camera.left = -200;
        dirLight.shadow.camera.right = 200;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;

        this.scene.add(dirLight);
    }

    /**
     * Asynchronously load the custom map glb model into the scene.
     * After loading, center it at world origin (0,0,0) so the player spawns on top.
     * @param {string} url - the path to the model relative to "public" folder.
     * @returns {Promise<void>}
     */
    loadMap(url) {
        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader();

            loader.load(
                url,

                // OnLoad callback
                (gltf) => {
                    this.mapModel = gltf.scene;

                    // Traverse every mesh: configure shadows AND collect for raycasting
                    this.mapModel.traverse((child) => {
                        if (child.isMesh) {
                            child.receiveShadow = true;
                            child.castShadow = true;
                            // Store reference for ground-clamping raycasts
                            this.mapMeshes.push(child);
                        }
                    });

                    // Add the map into the scene FIRST (so bounding box is in world space)
                    this.scene.add(this.mapModel);

                    // --- Compute the bounding box BEFORE centering ---
                    const mapBox = new THREE.Box3().setFromObject(this.mapModel);
                    const mapSize = new THREE.Vector3();
                    const mapCenter = new THREE.Vector3();
                    mapBox.getSize(mapSize);
                    mapBox.getCenter(mapCenter);

                    console.log('=== MAP BOUNDING BOX (before centering) ===');
                    console.log('  Min    :', mapBox.min);
                    console.log('  Max    :', mapBox.max);
                    console.log('  Size   :', mapSize);
                    console.log('  Center :', mapCenter);

                    // --- CENTER THE MAP AT WORLD ORIGIN ---
                    // Subtract the bounding-box center from the model's position.
                    // This shifts the entire map so its geometric center sits at (0, 0, 0).
                    this.mapModel.position.sub(mapCenter);

                    // Re-compute to verify
                    const verifyBox = new THREE.Box3().setFromObject(this.mapModel);
                    const verifyCenter = new THREE.Vector3();
                    verifyBox.getCenter(verifyCenter);
                    console.log('  Center (after centering):', verifyCenter);
                    console.log('========================');
                    console.log('Map loaded and centered successfully:', url);
                    resolve();
                },

                // OnProgress callback
                (xhr) => {
                    const percent = (xhr.loaded / xhr.total * 100);
                    console.log(`Loading map... ${percent.toFixed(2)}%`);
                },

                // OnError callback
                (error) => {
                    console.error('An error occurred during map loading:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Executes once per frame
     * @param {number} delta - the time difference since the last frame
     */
    update(delta) {
        // Iterate over anything within the world that needs an update (animations, character physics, etc.)
        for (const element of this.updatables) {
            element.update(delta);
        }
    }
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * AnimationController
 *
 * Handles GLTF model loading, AnimationMixer, animation state transitions,
 * and crossfading. Owns the 3D model hierarchy.
 *
 * ════════════════════════════════════════════════════════════════════
 * DOUBLE WRAPPER HIERARCHY  (Phase 14 — Foolproof Mixamo Rotation Fix)
 * ════════════════════════════════════════════════════════════════════
 *
 *   playerGroup             ← Player.js moves/rotates THIS (position, yaw)
 *     └─ rotationOffsetGroup  ← permanent counter-rotation (rotation.x)
 *          └─ model           ← gltf.scene — AnimationMixer targets THIS
 *               └─ Armature     ← Mixamo bakes -90°X here via animation tracks
 *                    └─ mixamorigHips → bones…
 *
 * WHY IT WORKS:
 *   The AnimationMixer can only write to nodes it finds by traversing `model`
 *   and its children. `rotationOffsetGroup` is a PARENT of `model` — the mixer
 *   has zero knowledge of it and cannot overwrite its rotation.
 *
 *   So even though animations rotate the Armature -90° on X every frame,
 *   `rotationOffsetGroup.rotation.x = -Math.PI / 2` (or +PI/2) stays permanent,
 *   and the two cancel out → character stands upright.
 * ════════════════════════════════════════════════════════════════════
 */
export class AnimationController {
    /**
     * @param {THREE.Scene} scene
     * @param {number} [playerScale=2.5]
     */
    constructor(scene, playerScale = 2.5) {
        this.scene = scene;
        this.playerScale = playerScale;

        // ── Double Wrapper nodes ──
        this.playerGroup = null;           // Logical entity (position + yaw)
        this.rotationOffsetGroup = null;   // Counter-rotation (never touched by mixer)
        this.model = null;                 // Visual mesh (mixer root)

        // ── Animation ──
        this.mixer = null;
        this.actions = {};        // { Idle, Run, Jump, Sit }
        this.currentAction = null;
        this.fadeTime = 0.25;     // Default crossfade duration (seconds)

        // ── Finished callback ──
        this._onFinishedCallback = null;

        // ── Retargeting ──
        this._bonePathMap = {};
    }

    /** Is the model loaded and hierarchy ready? */
    get isReady() {
        return !!this.playerGroup && !!this.model;
    }

    // ----------------------------------------------------------------
    // Init
    // ----------------------------------------------------------------

    async init() {
        await this.loadPrimaryModel('/models/idle.glb');
        await this.loadExtraAnimations();
    }

    // ----------------------------------------------------------------
    // Model Loading — Double Wrapper
    // ----------------------------------------------------------------

    loadPrimaryModel(url) {
        return new Promise((resolve) => {
            const loader = new GLTFLoader();
            loader.load(
                url,
                (gltf) => {
                    // ═══ 1. playerGroup — the logical entity ═══
                    this.playerGroup = new THREE.Group();
                    this.playerGroup.name = 'PlayerGroup';

                    // ═══ 2. rotationOffsetGroup — counter-rotation ═══
                    this.rotationOffsetGroup = new THREE.Group();
                    this.rotationOffsetGroup.name = 'RotationOffset';

                    // Mixamo FBX→GLTF bakes -90° X into the Armature node.
                    // We counter it here. The mixer CANNOT reach this node.
                    //
                    // ★ If the character appears UPSIDE-DOWN, flip the sign:
                    //   try  Math.PI / 2  instead of  -Math.PI / 2
                    this.rotationOffsetGroup.rotation.x = -Math.PI / 2;

                    // ═══ 3. model — the visual mesh ═══
                    this.model = gltf.scene;
                    this.model.scale.set(
                        this.playerScale,
                        this.playerScale,
                        this.playerScale
                    );

                    // ═══ 4. Build the hierarchy ═══
                    // playerGroup → rotationOffsetGroup → model
                    this.rotationOffsetGroup.add(this.model);
                    this.playerGroup.add(this.rotationOffsetGroup);
                    this.scene.add(this.playerGroup);

                    // Spawn position (on the GROUP)
                    this.playerGroup.position.set(0, 100, 0);

                    // ── Shadows ──
                    this.model.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });

                    // ── Debug info ──
                    const box = new THREE.Box3().setFromObject(this.model);
                    const size = new THREE.Vector3();
                    box.getSize(size);
                    let nodeCount = 0;
                    this.model.traverse(() => nodeCount++);

                    console.log('=== CHARACTER (Double Wrapper) ===');
                    console.log('  Scale  :', this.playerScale);
                    console.log('  Height :', size.y.toFixed(2), 'units');
                    console.log('  Nodes  :', nodeCount, nodeCount > 30 ? '✓ Skeleton' : '✗ No skeleton');

                    // Debug axes on playerGroup (stays upright)
                    this.playerGroup.add(new THREE.AxesHelper(2));

                    // ═══ 5. AnimationMixer — targets `model` (inside offset group) ═══
                    this.mixer = new THREE.AnimationMixer(this.model);

                    // Forward 'finished' events (for one-shot animations like Jump)
                    this.mixer.addEventListener('finished', (e) => {
                        if (this._onFinishedCallback) {
                            this._onFinishedCallback(e.action);
                        }
                    });

                    // ═══ 6. Idle animation from this file ═══
                    if (gltf.animations && gltf.animations.length > 0) {
                        const clip = gltf.animations[0];
                        this.actions['Idle'] = this.mixer.clipAction(clip);
                        this.actions['Idle'].loop = THREE.LoopRepeat;
                        this.actions['Idle'].play();
                        this.currentAction = this.actions['Idle'];
                        console.log(`  Idle   : "${clip.name}" (${clip.tracks.length} tracks) ▶`);
                    }

                    // Build bone path map for retargeting extra animations
                    this._buildBonePathMap();

                    console.log('  ★ rotationOffsetGroup.rotation.x =',
                        this.rotationOffsetGroup.rotation.x.toFixed(4), 'rad');
                    console.log('  Primary model loaded ✓');
                    resolve();
                },
                null,
                (err) => { console.error('Model load error:', err); resolve(); }
            );
        });
    }

    // ----------------------------------------------------------------
    // Extra Animation Loading
    // ----------------------------------------------------------------

    async loadExtraAnimations() {
        if (!this.mixer) {
            console.warn('Mixer not ready — cannot load animations.');
            return;
        }

        const loader = new GLTFLoader();

        const loadClip = (url, clipName) => new Promise((resolve) => {
            loader.load(
                url,
                (gltf) => {
                    if (gltf.animations && gltf.animations.length > 0) {
                        const clip = gltf.animations[0];
                        this._retargetClip(clip, clipName);
                        console.log(`  ✓ "${clip.name}" from ${url} (${clip.tracks.length} tracks)`);
                        resolve(clip);
                    } else {
                        console.warn(`  ✗ No animations in ${url}`);
                        resolve(null);
                    }
                },
                null,
                (err) => { console.warn(`  ✗ Failed: ${url}`, err); resolve(null); }
            );
        });

        console.log('=== LOADING EXTRA ANIMATIONS ===');

        const [runClip, jumpClip, sitClip] = await Promise.all([
            loadClip('/models/run.glb', 'Run'),
            loadClip('/models/jump.glb', 'Jump'),
            loadClip('/models/sit.glb', 'Sit'),
        ]);

        if (runClip) {
            this.actions['Run'] = this.mixer.clipAction(runClip);
            this.actions['Run'].loop = THREE.LoopRepeat;
        }
        if (jumpClip) {
            this.actions['Jump'] = this.mixer.clipAction(jumpClip);
            this.actions['Jump'].loop = THREE.LoopOnce;
            this.actions['Jump'].clampWhenFinished = true;
        }
        if (sitClip) {
            this.actions['Sit'] = this.mixer.clipAction(sitClip);
            this.actions['Sit'].loop = THREE.LoopRepeat;
        }

        console.log('  Actions ready:', Object.keys(this.actions).join(', '));
    }

    // ----------------------------------------------------------------
    // Bone Retargeting
    // ----------------------------------------------------------------

    /** Build { boneName → full path from mixer root } map. */
    _buildBonePathMap() {
        this._bonePathMap = {};
        this.model.traverse((node) => {
            const segments = [];
            let current = node;
            while (current && current !== this.model) {
                segments.unshift(current.name);
                current = current.parent;
            }
            this._bonePathMap[node.name] = segments.join('/');
        });
        console.log(`  Bone paths: ${Object.keys(this._bonePathMap).length} nodes`);
    }

    /** Remap track node-paths to match the primary model's hierarchy. */
    _retargetClip(clip, clipName) {
        let remapped = 0;
        const newTracks = [];

        clip.tracks.forEach((track) => {
            const lastDot = track.name.lastIndexOf('.');
            const nodePath = track.name.substring(0, lastDot);
            const property = track.name.substring(lastDot);

            const parts = nodePath.split('/');
            const boneName = parts[parts.length - 1];
            const bName = boneName.toLowerCase();

            // Jump: lock hips X/Z position (prevent forward flying)
            if (clipName === 'Jump' && bName.includes('hips') && property === '.position') {
                const startX = track.values[0];
                const startZ = track.values[2];
                for (let i = 0; i < track.values.length; i += 3) {
                    track.values[i] = startX;
                    track.values[i + 2] = startZ;
                }
            }

            if (this._bonePathMap[boneName]) {
                const newName = this._bonePathMap[boneName] + property;
                if (track.name !== newName) {
                    track.name = newName;
                    remapped++;
                }
                newTracks.push(track);
            }
        });

        clip.tracks = newTracks;
        if (remapped > 0) {
            console.log(`    ↳ Retargeted ${remapped}/${clip.tracks.length} tracks for ${clipName}`);
        }
    }

    // ----------------------------------------------------------------
    // Animation Crossfading
    // ----------------------------------------------------------------

    /**
     * Smoothly crossfade from the current animation to a new one.
     * @param {string} name  - 'Idle', 'Run', 'Jump', or 'Sit'
     * @param {number} [duration] - override crossfade time (seconds)
     */
    fadeToAction(name, duration) {
        const newAction = this.actions[name];
        if (!newAction) return;
        if (newAction === this.currentAction) {
            newAction.timeScale = 1; // Un-pause if it was paused
            return;
        }

        const fadeDur = duration !== undefined ? duration : this.fadeTime;
        const oldAction = this.currentAction;

        newAction.reset();
        newAction.timeScale = 1;
        newAction.play();

        if (oldAction) {
            newAction.crossFadeFrom(oldAction, fadeDur, true);
        }

        this.currentAction = newAction;
    }

    /**
     * Set the timeScale of a specific action (e.g., pause Sit when stationary).
     */
    setActionTimeScale(name, scale) {
        if (this.actions[name]) {
            this.actions[name].timeScale = scale;
        }
    }

    /**
     * Register a callback for when a one-shot animation finishes.
     * @param {function(THREE.AnimationAction)} callback
     */
    onAnimationFinished(callback) {
        this._onFinishedCallback = callback;
    }

    // ----------------------------------------------------------------
    // Per-frame update
    // ----------------------------------------------------------------

    /** Tick the AnimationMixer. Call once per frame. */
    update(delta) {
        if (this.mixer) {
            this.mixer.update(delta);
        }
    }
}

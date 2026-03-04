import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Player Class
 * Handles the 3D character model with SEPARATE animation files,
 * directional WASD movement, jump, sit/crouch, and smooth crossfading.
 *
 * Animation files (loaded separately, NOT embedded in character.glb):
 *   /models/idle.glb   → default standing pose
 *   /models/run.glb    → walking / running
 *   /models/jump.glb   → jump (plays once)
 *   /models/sit.glb    → sit / crouch (toggle with C key or UI button)
 *
 * Movement:
 *   W/A/S/D → directional movement relative to camera yaw
 *   Space   → jump
 *   C       → toggle sit/crouch
 */
export class Player {
    constructor(scene, physicsWorld, inputManager) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.inputManager = inputManager;

        this.model = null;
        this.body = null;

        // =====================================================
        // MOVEMENT
        // =====================================================
        this.moveSpeed = 30.0;   // Normal speed (units/sec)
        this.crouchSpeed = 10.0;   // Speed while sitting/crouching
        this.moveDirection = new THREE.Vector3();

        // =====================================================
        // JUMP / GRAVITY
        // =====================================================
        this.velocityY = 0;
        this.gravity = 40.0;
        this.jumpForce = 25.0;
        this.isGrounded = false;

        // =====================================================
        // PLAYER SCALE
        // =====================================================
        this.playerScale = 2.5;

        // =====================================================
        // ANIMATION SYSTEM
        // =====================================================
        this.mixer = null;    // THREE.AnimationMixer
        this.actions = {};      // { Idle, Run, Jump, Sit }
        this.currentAction = null;
        this.isJumping = false;
        this.isSitting = false;   // Sit/crouch toggle state
        this.fadeTime = 0.25;   // Crossfade duration (seconds)

        // Track C key to detect toggle (only trigger once per press)
        this._cKeyWasDown = false;

        // =====================================================
        // HTML BUTTON BINDING (Sit button)
        // =====================================================
        this._setupSitButton();

        this.axesHelper = null;
    }

    // ----------------------------------------------------------------
    // HTML Button Setup
    // ----------------------------------------------------------------

    _setupSitButton() {
        const sitBtn = document.getElementById('btn-sit');
        if (sitBtn) {
            sitBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.toggleSit();
            });
        }

        // Also bind the Jump button for mobile
        const jumpBtn = document.getElementById('btn-jump');
        if (jumpBtn) {
            jumpBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this._jumpRequested = true;
            });
            jumpBtn.addEventListener('pointerup', () => {
                this._jumpRequested = false;
            });
        }
    }

    // ----------------------------------------------------------------
    // Initialization
    // ----------------------------------------------------------------

    async init() {
        this.setupPhysics();
        // Load idle.glb as the PRIMARY model — it has both the Mixamo
        // rigged mesh (skeleton + skin) AND the idle animation clip.
        // character.glb is a static mesh with NO skeleton, so animations
        // can never work on it.
        await this.loadPrimaryModel('/models/idle.glb');
        // Then load the remaining animation clips from separate files
        await this.loadExtraAnimations();
    }

    setupPhysics() {
        const hw = 0.3 * this.playerScale;
        const hh = 0.9 * this.playerScale;
        const hd = 0.3 * this.playerScale;
        const playerShape = new CANNON.Box(new CANNON.Vec3(hw, hh, hd));

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
     * Load idle.glb as the PRIMARY model.
     * Why idle.glb? Because Mixamo animation exports include:
     *   - The full character mesh (skin)
     *   - The complete skeleton (65+ bones with names like mixamorigHips)
     *   - The animation clip itself
     * So idle.glb gives us everything we need as the base model.
     */
    loadPrimaryModel(url) {
        return new Promise((resolve) => {
            const loader = new GLTFLoader();
            loader.load(
                url,
                (gltf) => {
                    this.model = gltf.scene;

                    // Scale
                    this.model.scale.set(this.playerScale, this.playerScale, this.playerScale);

                    // Debug
                    const box = new THREE.Box3().setFromObject(this.model);
                    const size = new THREE.Vector3();
                    box.getSize(size);
                    console.log('=== CHARACTER (from idle.glb) ===');
                    console.log('  Scale :', this.playerScale);
                    console.log('  Height:', size.y.toFixed(2), 'units');

                    // Count nodes to confirm skeleton is present
                    let nodeCount = 0;
                    this.model.traverse(() => nodeCount++);
                    console.log('  Nodes :', nodeCount, nodeCount > 30 ? '✓ Skeleton found!' : '✗ No skeleton!');

                    // Shadows
                    this.model.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });

                    // Spawn high — gravity drops to terrain
                    this.model.position.set(0, 100, 0);

                    // Debug axes
                    this.axesHelper = new THREE.AxesHelper(2);
                    this.model.add(this.axesHelper);

                    this.scene.add(this.model);

                    // Create the mixer on this model (which HAS the skeleton)
                    this.mixer = new THREE.AnimationMixer(this.model);

                    // Listen for 'finished' event (for Jump animation)
                    this.mixer.addEventListener('finished', (e) => {
                        if (e.action === this.actions['Jump']) {
                            this.isJumping = false;
                            const isMoving = this._isMoving();
                            this.fadeToAction(isMoving ? 'Run' : 'Idle');
                        }
                    });

                    // ★ Extract the IDLE animation clip from this same file ★
                    if (gltf.animations && gltf.animations.length > 0) {
                        const idleClip = gltf.animations[0];
                        this.actions['Idle'] = this.mixer.clipAction(idleClip);
                        this.actions['Idle'].loop = THREE.LoopRepeat;
                        this.actions['Idle'].play();
                        this.currentAction = this.actions['Idle'];
                        console.log(`  Idle clip: "${idleClip.name}" (${idleClip.tracks.length} tracks) ▶`);
                    }

                    // Build bone path map for retargeting other animation files
                    this._buildBonePathMap();

                    console.log('Primary model loaded:', url);
                    resolve();
                },
                null,
                (err) => { console.error('Model load error:', err); resolve(); }
            );
        });
    }

    /**
     * Load remaining animation clips from separate .glb files.
     * Since they come from Mixamo too, their bone names should match
     * the skeleton in our primary model (idle.glb). We retarget just in
     * case the path structure differs slightly between exports.
     */
    async loadExtraAnimations() {
        if (!this.mixer) {
            console.warn('Mixer not ready — cannot load animations.');
            return;
        }

        const loader = new GLTFLoader();

        const loadClip = (url) => {
            return new Promise((resolve) => {
                loader.load(
                    url,
                    (gltf) => {
                        if (gltf.animations && gltf.animations.length > 0) {
                            const clip = gltf.animations[0];
                            this._retargetClip(clip);
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
        };

        console.log('=== LOADING EXTRA ANIMATIONS ===');

        const [runClip, jumpClip, sitClip] = await Promise.all([
            loadClip('/models/run.glb'),
            loadClip('/models/jump.glb'),
            loadClip('/models/sit.glb'),
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

        console.log('All actions ready:', Object.keys(this.actions).join(', '));
    }

    /**
     * Build a map of { boneName → full path from mixer root }.
     */
    _buildBonePathMap() {
        this._bonePathMap = {};

        this.model.traverse((node) => {
            const segments = [];
            let current = node;
            while (current && current !== this.model) {
                segments.unshift(current.name);
                current = current.parent;
            }
            const fullPath = segments.join('/');
            this._bonePathMap[node.name] = fullPath;
        });

        console.log(`  Bone path map: ${Object.keys(this._bonePathMap).length} nodes`);
    }

    /**
     * Retarget a clip's track names to match our main model's bone paths.
     */
    _retargetClip(clip) {
        let remapped = 0;

        clip.tracks.forEach((track) => {
            const lastDot = track.name.lastIndexOf('.');
            const nodePath = track.name.substring(0, lastDot);
            const property = track.name.substring(lastDot);

            const parts = nodePath.split('/');
            const boneName = parts[parts.length - 1];

            if (this._bonePathMap[boneName]) {
                const newName = this._bonePathMap[boneName] + property;
                if (track.name !== newName) {
                    track.name = newName;
                    remapped++;
                }
            }
        });

        if (remapped > 0) {
            console.log(`    ↳ Retargeted ${remapped}/${clip.tracks.length} tracks`);
        }
    }

    // ----------------------------------------------------------------
    // Animation Crossfading
    // ----------------------------------------------------------------

    /**
     * Smoothly crossfade from current animation to a new one.
     * @param {string} name - 'Idle', 'Run', 'Jump', or 'Sit'
     * @param {number} [duration] - override crossfade time (seconds)
     */
    fadeToAction(name, duration) {
        const newAction = this.actions[name];
        if (!newAction) return;
        if (newAction === this.currentAction) return;

        const fadeDur = duration !== undefined ? duration : this.fadeTime;
        const oldAction = this.currentAction;

        newAction.reset();
        newAction.play();

        if (oldAction) {
            newAction.crossFadeFrom(oldAction, fadeDur, true);
        }

        this.currentAction = newAction;
    }

    // ----------------------------------------------------------------
    // Sit / Crouch Toggle
    // ----------------------------------------------------------------

    toggleSit() {
        this.isSitting = !this.isSitting;

        // Update the UI button visual
        const sitBtn = document.getElementById('btn-sit');
        if (sitBtn) {
            sitBtn.classList.toggle('active', this.isSitting);
            sitBtn.textContent = this.isSitting ? 'Stand' : 'Sit';
        }

        if (this.isSitting) {
            this.fadeToAction('Sit');
        } else {
            // Return to idle or run based on movement
            this.fadeToAction(this._isMoving() ? 'Run' : 'Idle');
        }
    }

    // ----------------------------------------------------------------
    // Per-frame update
    // ----------------------------------------------------------------

    update(delta, cameraYaw) {
        if (!this.model) return;

        // 1. Check for C key toggle (sit/crouch)
        this.handleSitToggle();

        // 2. Horizontal WASD movement
        this.handleMovement(delta, cameraYaw);

        // 3. Jump & Gravity
        this.handleJump(delta);

        // 4. Animation state machine
        this.updateAnimationState();

        // 5. Tick the mixer
        if (this.mixer) {
            this.mixer.update(delta);
        }
    }

    /**
     * Detect C key press as a TOGGLE (only fires once per keypress).
     */
    handleSitToggle() {
        const cDown = this.inputManager.isKeyDown('c');

        if (cDown && !this._cKeyWasDown) {
            // C was just pressed this frame
            this.toggleSit();
        }

        this._cKeyWasDown = cDown;
    }

    /**
     * Animation state machine: decides which animation to play.
     */
    updateAnimationState() {
        if (this.isJumping) return;   // Don't interrupt jump
        if (this.isSitting) return;   // Don't interrupt sit (user must toggle off)

        if (this._isMoving()) {
            this.fadeToAction('Run');
        } else {
            this.fadeToAction('Idle');
        }
    }

    /** Helper: are any WASD keys held? */
    _isMoving() {
        const i = this.inputManager;
        return i.isKeyDown('w') || i.isKeyDown('a') || i.isKeyDown('s') || i.isKeyDown('d');
    }

    /**
     * Spacebar / mobile button jump + gravity.
     */
    handleJump(delta) {
        const input = this.inputManager;
        const spacePressed = input.isKeyDown(' ') || this._jumpRequested;

        if (spacePressed && this.isGrounded) {
            this.velocityY = this.jumpForce;
            this.isGrounded = false;
            this._jumpRequested = false;

            // Cancel sit if jumping
            if (this.isSitting) {
                this.isSitting = false;
                const sitBtn = document.getElementById('btn-sit');
                if (sitBtn) { sitBtn.classList.remove('active'); sitBtn.textContent = 'Sit'; }
            }

            if (this.actions['Jump']) {
                this.isJumping = true;
                this.fadeToAction('Jump');
            }
        }

        // Gravity
        this.velocityY -= this.gravity * delta;
        this.model.position.y += this.velocityY * delta;
    }

    /**
     * Directional WASD movement relative to camera yaw.
     * Speed is reduced while crouching/sitting.
     */
    handleMovement(delta, cameraYaw) {
        const input = this.inputManager;

        const w = input.isKeyDown('w');
        const s = input.isKeyDown('s');
        const a = input.isKeyDown('a');
        const d = input.isKeyDown('d');

        if (!w && !s && !a && !d) return;

        const forwardX = -Math.sin(cameraYaw);
        const forwardZ = -Math.cos(cameraYaw);
        const rightX = Math.cos(cameraYaw);
        const rightZ = -Math.sin(cameraYaw);

        let dx = 0, dz = 0;
        if (w) { dx += forwardX; dz += forwardZ; }
        if (s) { dx -= forwardX; dz -= forwardZ; }
        if (d) { dx += rightX; dz += rightZ; }
        if (a) { dx -= rightX; dz -= rightZ; }

        this.moveDirection.set(dx, 0, dz).normalize();

        // Use reduced speed while sitting
        const speed = this.isSitting ? this.crouchSpeed : this.moveSpeed;
        this.model.position.addScaledVector(this.moveDirection, speed * delta);

        // Rotate character to face movement direction
        if (this.moveDirection.lengthSq() > 0.001) {
            const angle = Math.atan2(-this.moveDirection.x, -this.moveDirection.z);
            this.model.rotation.y = angle;
        }
    }
}

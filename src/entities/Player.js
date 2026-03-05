import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Player Class
 * Handles the 3D character model with SEPARATE animation files,
 * camera-relative movement (both WASD & analog joystick),
 * jump, sit/crouch, and smooth crossfading.
 *
 * Phase 13 — Wrapper Group Architecture:
 *
 *   scene
 *     └─ playerGroup  (THREE.Group — owns position & Y-rotation)
 *          └─ model   (gltf.scene — counter-rotated on X to fix Mixamo offset)
 *               └─ Armature  (animations play here naturally)
 *                    └─ mixamorigHips → bones…
 *
 *   The Mixamo FBX→GLTF pipeline bakes a -90° X rotation into the Armature.
 *   Instead of hacking the animation tracks, we let them play naturally and
 *   apply a permanent +90° X-rotation on `model` (the visual child).
 *   `playerGroup` is the logical entity: all movement, positioning,
 *   raycasting, and camera-syncing reference `playerGroup.position`.
 */
export class Player {
    constructor(scene, physicsWorld, inputManager) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.inputManager = inputManager;

        this.playerGroup = null;  // ★ Logical container — owns position & yaw
        this.model = null;        // Visual child — plays animations

        this.body = null;

        // =====================================================
        // MOVEMENT
        // =====================================================
        this.moveSpeed = 30.0;   // Normal speed (units/sec)
        this.sprintSpeed = 50.0; // Sprint speed when Run button held
        this.crouchSpeed = 10.0;   // Speed while sitting/crouching
        this.moveDirection = new THREE.Vector3();

        // =====================================================
        // SMOOTH ROTATION
        // =====================================================
        this.targetYaw = 0;       // The desired facing angle (radians)
        this.rotationSmoothing = 10.0; // Higher = snappier turning (lerp speed)

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
        await this.loadPrimaryModel('/models/idle.glb');
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
     *
     * Phase 13 — Wrapper Group:
     *   1. Create `playerGroup` (THREE.Group) — the logical entity.
     *   2. Load gltf.scene as `model` — the visual mesh with skeleton.
     *   3. Apply counter-rotation: `model.rotation.x = Math.PI / 2`
     *      to permanently cancel the -90° X that Mixamo animations bake
     *      into the Armature node. (If character ends up upside-down,
     *      flip to -Math.PI / 2.)
     *   4. Parent: scene → playerGroup → model.
     *   5. All position/movement goes on playerGroup, NOT model.
     */
    loadPrimaryModel(url) {
        return new Promise((resolve) => {
            const loader = new GLTFLoader();
            loader.load(
                url,
                (gltf) => {
                    // ── 1. Create the wrapper group ──
                    this.playerGroup = new THREE.Group();
                    this.playerGroup.name = 'PlayerGroup';

                    // ── 2. Store the visual model ──
                    this.model = gltf.scene;

                    // Scale the model
                    this.model.scale.set(this.playerScale, this.playerScale, this.playerScale);

                    // ── 3. Counter-rotation fix for Mixamo ──
                    // Mixamo FBX→GLTF bakes -90° X into the Armature.
                    // We counter it with +90° X on the model container.
                    // If the character appears upside-down, change to -Math.PI / 2.
                    this.model.rotation.x = -Math.PI / 2;

                    // ── 4. Parent model INTO the group ──
                    this.playerGroup.add(this.model);

                    // ── 5. Add group to scene ──
                    this.scene.add(this.playerGroup);

                    // ── Spawn position (on the GROUP, not the model) ──
                    this.playerGroup.position.set(0, 100, 0);

                    // Debug
                    const box = new THREE.Box3().setFromObject(this.model);
                    const size = new THREE.Vector3();
                    box.getSize(size);
                    console.log('=== CHARACTER (from idle.glb) ===');
                    console.log('  Scale :', this.playerScale);
                    console.log('  Height:', size.y.toFixed(2), 'units');

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

                    // Debug axes on the GROUP (so they stay upright)
                    this.playerGroup.add(new THREE.AxesHelper(2));

                    // Create the mixer on the MODEL (which HAS the skeleton)
                    this.mixer = new THREE.AnimationMixer(this.model);

                    // Listen for 'finished' event (for Jump animation)
                    this.mixer.addEventListener('finished', (e) => {
                        if (e.action === this.actions['Jump']) {
                            this.isJumping = false;
                            const isMoving = this._isMoving();
                            this.fadeToAction(isMoving ? 'Run' : 'Idle');
                        }
                    });

                    // ★ Extract the IDLE animation clip — NO track splicing needed ★
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
                    console.log('  ★ Wrapper Group active — counter-rotation: model.rotation.x =', this.model.rotation.x.toFixed(4));
                    resolve();
                },
                null,
                (err) => { console.error('Model load error:', err); resolve(); }
            );
        });
    }

    /**
     * Load remaining animation clips from separate .glb files.
     * NO track splicing — animations play naturally. The counter-rotation
     * on the model inside the wrapper group handles the Mixamo offset.
     */
    async loadExtraAnimations() {
        if (!this.mixer) {
            console.warn('Mixer not ready — cannot load animations.');
            return;
        }

        const loader = new GLTFLoader();

        const loadClip = (url, clipName) => {
            return new Promise((resolve) => {
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
        };

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
     * No track splicing — the wrapper group handles the Mixamo rotation offset.
     */
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

            // For the Jump animation ONLY: lock the hips X/Z position to prevent
            // forward flying, but KEEP the Y (vertical arc).
            if (clipName === 'Jump' && bName.includes('hips') && property === '.position') {
                const startX = track.values[0];
                const startZ = track.values[2];
                for (let i = 0; i < track.values.length; i += 3) {
                    track.values[i] = startX;       // lock X
                    track.values[i + 2] = startZ;   // lock Z
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
     * Smoothly crossfade from current animation to a new one.
     * @param {string} name - 'Idle', 'Run', 'Jump', or 'Sit'
     * @param {number} [duration] - override crossfade time (seconds)
     */
    fadeToAction(name, duration) {
        const newAction = this.actions[name];
        if (!newAction) return;
        if (newAction === this.currentAction) {
            newAction.timeScale = 1;
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

    // ----------------------------------------------------------------
    // Sit / Crouch Toggle
    // ----------------------------------------------------------------

    toggleSit() {
        this.isSitting = !this.isSitting;

        const sitBtn = document.getElementById('btn-sit');
        if (sitBtn) {
            sitBtn.classList.toggle('active', this.isSitting);
            sitBtn.textContent = this.isSitting ? 'Stand' : 'Sit';
        }

        if (this.isSitting) {
            this.fadeToAction('Sit');
        } else {
            this.fadeToAction(this._isMoving() ? 'Run' : 'Idle');
        }
    }

    // ----------------------------------------------------------------
    // Per-frame update
    // ----------------------------------------------------------------

    update(delta, cameraYaw) {
        if (!this.playerGroup) return;

        // 0. Sync virtual joystick + sprint globals into InputManager
        this._syncVirtualInputs();

        // 1. Check for C key toggle (sit/crouch)
        this.handleSitToggle();

        // 2. Movement (WASD + analog joystick, camera-relative)
        this.handleMovement(delta, cameraYaw);

        // 3. Jump & Gravity
        this.handleJump(delta);

        // 4. Animation state machine
        this.updateAnimationState();

        // 5. Tick the animation mixer
        if (this.mixer) {
            this.mixer.update(delta);
        }

        // ★ Phase 13: NO rotation lock needed on model!
        // The model's rotation.x stays at Math.PI/2 permanently (counter-rotation).
        // The animation can do whatever it wants to the Armature inside —
        // the wrapper group architecture handles it structurally.
    }

    /**
     * Merge virtual joystick + sprint button state into InputManager.
     * Uses setVirtualKey() for separated keyboard/joystick state (Phase 12 fix).
     */
    _syncVirtualInputs() {
        const im = this.inputManager;

        im.setVirtualKey('w', !!window._joystickW);
        im.setVirtualKey('s', !!window._joystickS);
        im.setVirtualKey('a', !!window._joystickA);
        im.setVirtualKey('d', !!window._joystickD);

        im.isSprinting = !!window._isSprinting;
    }

    /**
     * Detect C key press as a TOGGLE (only fires once per keypress).
     */
    handleSitToggle() {
        const cDown = this.inputManager.isKeyDown('c');

        if (cDown && !this._cKeyWasDown) {
            this.toggleSit();
        }

        this._cKeyWasDown = cDown;
    }

    /**
     * Animation state machine: decides which animation to play.
     */
    updateAnimationState() {
        if (this.isJumping) return;

        const moving = this._isMoving();

        if (this.isSitting) {
            this.fadeToAction('Sit');
            if (this.actions['Sit']) {
                this.actions['Sit'].timeScale = moving ? 1 : 0;
            }
            return;
        }

        if (moving) {
            this.fadeToAction('Run');
        } else {
            this.fadeToAction('Idle');
        }
    }

    /**
     * Helper: are any WASD keys held OR is the analog joystick active?
     */
    _isMoving() {
        const i = this.inputManager;
        const hasKeys = i.isKeyDown('w') || i.isKeyDown('a') || i.isKeyDown('s') || i.isKeyDown('d');
        const hasJoystick = (window._joystickX !== undefined && window._joystickY !== undefined)
            && (Math.abs(window._joystickX) > 0.01 || Math.abs(window._joystickY) > 0.01);
        return hasKeys || hasJoystick;
    }

    /**
     * Spacebar / mobile button jump + gravity.
     * ★ Position is on playerGroup, NOT model.
     */
    handleJump(delta) {
        const input = this.inputManager;
        const spacePressed = input.isKeyDown(' ') || this._jumpRequested;

        if (spacePressed && this.isGrounded) {
            this.velocityY = this.jumpForce;
            this.isGrounded = false;
            this._jumpRequested = false;

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

        // Gravity — applied to the GROUP
        this.velocityY -= this.gravity * delta;
        this.playerGroup.position.y += this.velocityY * delta;
    }

    /**
     * Camera-relative movement supporting both WASD (keyboard) and analog joystick.
     *
     * ★ All position and rotation changes go to playerGroup, NOT model.
     *   model is just a visual child with a fixed counter-rotation.
     */
    handleMovement(delta, cameraYaw) {
        const input = this.inputManager;

        // ── Build an input vector from both sources ──
        let kx = 0, ky = 0;
        if (input.isKeyDown('w')) ky += 1;
        if (input.isKeyDown('s')) ky -= 1;
        if (input.isKeyDown('d')) kx += 1;
        if (input.isKeyDown('a')) kx -= 1;

        const jx = window._joystickX || 0;
        const jy = window._joystickY || 0;

        let ix, iy;
        const jMag = Math.sqrt(jx * jx + jy * jy);
        const kMag = Math.sqrt(kx * kx + ky * ky);

        if (jMag > 0.01 && jMag >= kMag) {
            ix = jx;
            iy = jy;
        } else if (kMag > 0) {
            ix = kx;
            iy = ky;
        } else {
            return;
        }

        const inputMag = Math.sqrt(ix * ix + iy * iy);
        if (inputMag > 1) { ix /= inputMag; iy /= inputMag; }

        // ── Camera-relative direction ──
        const inputAngle = Math.atan2(ix, iy);
        const targetYaw = cameraYaw + inputAngle;

        const dx = -Math.sin(targetYaw);
        const dz = -Math.cos(targetYaw);

        this.moveDirection.set(dx, 0, dz).normalize();

        // ── Speed ──
        let speed = this.moveSpeed;
        if (this.isSitting) speed = this.crouchSpeed;
        else if (this.inputManager.isSprinting) speed = this.sprintSpeed;

        const speedMul = Math.min(inputMag, 1.0);

        // ★ Move the GROUP (not the model)
        this.playerGroup.position.addScaledVector(this.moveDirection, speed * speedMul * delta);

        // ── Smooth rotation to face movement direction ──
        // ★ Rotate the GROUP's Y (not the model — model.rotation.x is the counter-rotation)
        if (this.moveDirection.lengthSq() > 0.001) {
            const faceAngle = Math.atan2(this.moveDirection.x, this.moveDirection.z);

            let diff = faceAngle - this.playerGroup.rotation.y;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;

            this.playerGroup.rotation.y += diff * Math.min(1, this.rotationSmoothing * delta);
        }
    }
}

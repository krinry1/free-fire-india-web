import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Player Class
 * Handles the 3D character model with SEPARATE animation files,
 * camera-relative movement (both WASD & analog joystick),
 * jump, sit/crouch, and smooth crossfading.
 *
 * Animation files (loaded separately, NOT embedded in character.glb):
 *   /models/idle.glb   → default standing pose
 *   /models/run.glb    → walking / running
 *   /models/jump.glb   → jump (plays once)
 *   /models/sit.glb    → sit / crouch (toggle with C key or UI button)
 *
 * Movement:
 *   W/A/S/D → directional movement relative to camera yaw
 *   Joystick → analog 360° camera-relative movement
 *   Space   → jump
 *   C       → toggle sit/crouch
 *
 * Phase 11 Fixes:
 *   1. FBX Animation Rotation Fix — strips root bone rotation offsets
 *      from Mixamo exports and locks model X/Z rotation in the update loop.
 *   2. Camera-Relative Joystick — uses analog joystick vector + camera yaw
 *      to compute a true 360° movement direction & smooth model facing.
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
                        // Strip root rotation from idle too, just in case
                        this._stripRootRotationFromClip(idleClip, 'Idle');
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

    // ----------------------------------------------------------------
    // FBX Animation Rotation Fix (Phase 11)
    // ----------------------------------------------------------------

    /**
     * Strips or neutralises root-bone rotation offsets from Mixamo FBX→GLTF clips.
     *
     * The problem: Mixamo FBX exports bake a -90° X-axis rotation into root
     * nodes (Armature, Scene, or the Hips bone) because FBX uses Y-up while
     * the original rig was Z-up. When those clips play on our GLTF model
     * (which is already Y-up), the character lies flat on the ground.
     *
     * Fix: For every quaternion track whose target node is a root-level node
     * (Armature, Scene, or empty-named), we replace ALL keyframe values with
     * the identity quaternion (0,0,0,1). For the Hips bone, we neutralise
     * only the X and Z components of the quaternion to strip tilt while
     * preserving the Y-axis turn the animation may contain.
     */
    _stripRootRotationFromClip(clip, clipName) {
        const rootNames = ['armature', 'scene', ''];
        let stripped = 0;

        clip.tracks.forEach((track) => {
            const lastDot = track.name.lastIndexOf('.');
            const nodePath = track.name.substring(0, lastDot);
            const property = track.name.substring(lastDot); // e.g. '.quaternion'

            // Only act on quaternion (rotation) tracks
            if (property !== '.quaternion') return;

            const parts = nodePath.split('/');
            const boneName = parts[parts.length - 1];
            const bNameL = boneName.toLowerCase();

            // Root-level containers (Armature, Scene, empty) → force identity
            if (rootNames.includes(bNameL)) {
                for (let i = 0; i < track.values.length; i += 4) {
                    track.values[i] = 0; // x
                    track.values[i + 1] = 0; // y
                    track.values[i + 2] = 0; // z
                    track.values[i + 3] = 1; // w
                }
                stripped++;
                console.log(`    ↳ [${clipName}] Zeroed root quaternion for "${boneName}"`);
            }

            // Hips bone — neutralise tilt (X,Z) but keep Y rotation
            if (bNameL.includes('hips')) {
                for (let i = 0; i < track.values.length; i += 4) {
                    // Keep only the Y-axis component of the quaternion
                    // A pure Y rotation quaternion has x=0, z=0
                    track.values[i] = 0; // x → no tilt
                    track.values[i + 2] = 0; // z → no roll
                    // Re-normalise the remaining (0, y, 0, w)
                    const y = track.values[i + 1];
                    const w = track.values[i + 3];
                    const len = Math.sqrt(y * y + w * w) || 1;
                    track.values[i + 1] = y / len;
                    track.values[i + 3] = w / len;
                }
                stripped++;
                console.log(`    ↳ [${clipName}] Neutralised hips tilt for "${boneName}"`);
            }
        });

        return stripped;
    }

    /**
     * Retarget a clip's track names to match our main model's bone paths.
     * Also applies root rotation stripping.
     */
    _retargetClip(clip, clipName) {
        // ★ Phase 11: Strip root bone rotation BEFORE retargeting
        this._stripRootRotationFromClip(clip, clipName);

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
            newAction.timeScale = 1; // Ensure it runs in case it was paused
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

        // 5. Tick the mixer
        if (this.mixer) {
            this.mixer.update(delta);
        }

        // ★ Phase 11 Fix: Force-lock model X and Z rotation every frame.
        // This acts as a safety net — even if an animation track tries to
        // tilt the model, we slam it back to upright.  Only Y (yaw) is
        // allowed to change (set by handleMovement).
        this.model.rotation.x = 0;
        this.model.rotation.z = 0;
    }

    /**
     * Merge virtual joystick + sprint button state into InputManager keys.
     * The joystick sets window._joystickW/A/S/D booleans.
     * We OR them with real keyboard so both work simultaneously.
     */
    _syncVirtualInputs() {
        const im = this.inputManager;
        // Joystick: set key if joystick active,
        // but don't clear if real keyboard is holding the key
        if (window._joystickW) im.setKey('w', true);
        else if (!im.keys['w']) im.setKey('w', false);

        if (window._joystickS) im.setKey('s', true);
        else if (!im.keys['s']) im.setKey('s', false);

        if (window._joystickA) im.setKey('a', true);
        else if (!im.keys['a']) im.setKey('a', false);

        if (window._joystickD) im.setKey('d', true);
        else if (!im.keys['d']) im.setKey('d', false);

        // Sprint
        im.isSprinting = !!window._isSprinting;
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

        const moving = this._isMoving();

        if (this.isSitting) {
            this.fadeToAction('Sit');
            // Pause the 'Sit' animation if the player stops moving
            if (this.actions['Sit']) {
                this.actions['Sit'].timeScale = moving ? 1 : 0;
            }
            return;   // Don't interrupt sit (user must toggle off)
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
     * Camera-relative movement supporting both WASD (keyboard) and analog joystick.
     *
     * Phase 11 Fix: Instead of only using boolean WASD, we now also read
     * the analog joystick vector (window._joystickX, window._joystickY).
     * The joystick gives us a 2D input vector that we rotate by the
     * camera's yaw to get a world-space movement direction. This makes
     * movement feel exactly like Free Fire — push the stick forward and the
     * character moves AWAY from the camera, regardless of which direction
     * the camera is facing.
     *
     * Math:
     *   inputAngle = atan2(joystickX, joystickY)
     *   targetYaw  = cameraYaw + inputAngle
     *   moveDir    = (sin(targetYaw), 0, cos(targetYaw))
     *
     * The character model then smoothly rotates to face targetYaw using lerp.
     */
    handleMovement(delta, cameraYaw) {
        const input = this.inputManager;

        // ── Build an input vector from both sources ──

        // Source 1: WASD keyboard → {-1, 0, +1} grid
        let kx = 0, ky = 0;
        if (input.isKeyDown('w')) ky += 1;
        if (input.isKeyDown('s')) ky -= 1;
        if (input.isKeyDown('d')) kx += 1;
        if (input.isKeyDown('a')) kx -= 1;

        // Source 2: Analog joystick → continuous [-1, 1]
        const jx = window._joystickX || 0;
        const jy = window._joystickY || 0;

        // Combine: prefer joystick if it has stronger input, otherwise use keys.
        // This prevents double-speed when both are active simultaneously.
        let ix, iy;
        const jMag = Math.sqrt(jx * jx + jy * jy);
        const kMag = Math.sqrt(kx * kx + ky * ky);

        if (jMag > 0.01 && jMag >= kMag) {
            // Joystick takes priority (analog, more precise)
            ix = jx;
            iy = jy;
        } else if (kMag > 0) {
            // Keyboard
            ix = kx;
            iy = ky;
        } else {
            return; // No input → no movement
        }

        // Normalise the input vector (cap magnitude at 1)
        const inputMag = Math.sqrt(ix * ix + iy * iy);
        if (inputMag > 1) { ix /= inputMag; iy /= inputMag; }

        // ── Camera-relative direction ──
        // inputAngle: angle of the input stick relative to "forward" (0° = up on screen)
        //   atan2(x, y) gives 0 when pointing forward, positive CW
        const inputAngle = Math.atan2(ix, iy);

        // targetYaw: world-space direction = camera's yaw + input angle
        // CameraController.yaw grows when looking LEFT (negative mouse),
        // so adding the input angle rotates relative to where the camera faces.
        const targetYaw = cameraYaw + inputAngle;

        // World-space movement direction from targetYaw
        // -sin and -cos because Three.js default forward is -Z
        const dx = -Math.sin(targetYaw);
        const dz = -Math.cos(targetYaw);

        this.moveDirection.set(dx, 0, dz).normalize();

        // ── Speed selection ──
        let speed = this.moveSpeed;
        if (this.isSitting) speed = this.crouchSpeed;
        else if (this.inputManager.isSprinting) speed = this.sprintSpeed;

        // Scale speed by input magnitude (analog joystick = proportional speed)
        const speedMul = Math.min(inputMag, 1.0);
        this.model.position.addScaledVector(this.moveDirection, speed * speedMul * delta);

        // ── Smooth model rotation to face movement direction ──
        // We want the character to smoothly turn to face `targetYaw`
        if (this.moveDirection.lengthSq() > 0.001) {
            // The model's forward is along its local -Z, which corresponds to
            // rotation.y = atan2(moveDir.x, moveDir.z) + PI
            // But since moveDir is already (-sin(θ), 0, -cos(θ)), let's use:
            const faceAngle = Math.atan2(this.moveDirection.x, this.moveDirection.z);

            // Smooth rotation via shortest-path lerp
            let diff = faceAngle - this.model.rotation.y;
            // Wrap to [-PI, PI]
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;

            this.model.rotation.y += diff * Math.min(1, this.rotationSmoothing * delta);
        }
    }
}

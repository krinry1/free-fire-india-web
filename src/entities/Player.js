import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { AnimationController } from './AnimationController.js';

/**
 * Player
 *
 * The main entity class. Coordinates:
 *   - InputManager   → reads movement, jump, sit inputs
 *   - AnimationController → loads model, plays animations
 *   - Physics (Cannon-es) → physics body
 *   - Movement logic → camera-relative WASD + analog joystick
 *
 * Phase 14 — Clean Architecture:
 *   Player.js is now a slim coordinator. Model loading and animation
 *   logic live in AnimationController.js. Input logic lives in
 *   InputManager.js (src/core/). Player just wires them together.
 *
 * The `playerGroup` (exposed via getter) is the logical entity that
 * Game.js uses for camera following, ground clamping, and wall collision.
 */
export class Player {
    constructor(scene, physicsWorld, inputManager) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.inputManager = inputManager;

        // ── AnimationController (owns the model + double-wrapper hierarchy) ──
        this.animController = new AnimationController(scene);

        // ── Physics ──
        this.body = null;

        // ── Movement ──
        this.moveSpeed = 30.0;
        this.sprintSpeed = 50.0;
        this.crouchSpeed = 10.0;
        this.moveDirection = new THREE.Vector3();
        this.rotationSmoothing = 10.0;

        // ── Jump / Gravity ──
        this.velocityY = 0;
        this.gravity = 40.0;
        this.jumpForce = 25.0;
        this.isGrounded = false;

        // ── State ──
        this.isJumping = false;
        this.isSitting = false;

        // ── Bind UI buttons ──
        this._setupSitButton();
    }

    /**
     * Exposes the playerGroup for Game.js (camera, raycasting, collision).
     * Delegates to AnimationController which owns the hierarchy.
     */
    get playerGroup() {
        return this.animController.playerGroup;
    }

    // ----------------------------------------------------------------
    // Init
    // ----------------------------------------------------------------

    async init() {
        this.setupPhysics();

        // Load model + all animations (Double Wrapper created inside)
        await this.animController.init();

        // Register callback: when Jump animation finishes → transition back
        this.animController.onAnimationFinished((action) => {
            if (action === this.animController.actions['Jump']) {
                this.isJumping = false;
                this.animController.fadeToAction(
                    this.inputManager.isMoving() ? 'Run' : 'Idle'
                );
            }
        });
    }

    // ----------------------------------------------------------------
    // Physics
    // ----------------------------------------------------------------

    setupPhysics() {
        const scale = this.animController.playerScale;
        const hw = 0.3 * scale;
        const hh = 0.9 * scale;
        const hd = 0.3 * scale;
        const playerShape = new CANNON.Box(new CANNON.Vec3(hw, hh, hd));

        this.body = new CANNON.Body({
            mass: 75,
            shape: playerShape,
            fixedRotation: true,
            position: new CANNON.Vec3(0, 5, 0) // Character ab zameen ke paas se start hoga
        });

        this.body.linearDamping = 0.9;
        this.physicsWorld.addBody(this.body);
    }

    // ----------------------------------------------------------------
    // UI Button Bindings
    // ----------------------------------------------------------------

    _setupSitButton() {
        const sitBtn = document.getElementById('btn-sit');
        if (sitBtn) {
            sitBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.toggleSit();
            });
        }
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
            this.animController.fadeToAction('Sit');
        } else {
            this.animController.fadeToAction(
                this.inputManager.isMoving() ? 'Run' : 'Idle'
            );
        }
    }

    // ----------------------------------------------------------------
    // Per-frame Update
    // ----------------------------------------------------------------

    update(delta, cameraYaw) {
        if (!this.animController.isReady) return;

        // 1. Sync all inputs (joystick, toggles, cache movement vector)
        this.inputManager.update();

        // 2. Sit toggle (C key — one-shot detection is in InputManager)
        if (this.inputManager.isSitJustPressed()) {
            this.toggleSit();
        }

        // 3. Camera-relative movement
        this.handleMovement(delta, cameraYaw);

        // 4. Jump & Gravity
        this.handleJump(delta);

        // 5. Animation state machine
        this.updateAnimationState();

        // 6. Tick the animation mixer
        this.animController.update(delta);
    }

    // ----------------------------------------------------------------
    // Animation State Machine
    // ----------------------------------------------------------------

    updateAnimationState() {
        if (this.isJumping) return;   // Don't interrupt jump

        const moving = this.inputManager.isMoving();

        if (this.isSitting) {
            this.animController.fadeToAction('Sit');
            // Pause Sit animation when not moving
            this.animController.setActionTimeScale('Sit', moving ? 1 : 0);
            return;
        }

        this.animController.fadeToAction(moving ? 'Run' : 'Idle');
    }

    // ----------------------------------------------------------------
    // Jump & Gravity
    // ----------------------------------------------------------------

    handleJump(delta) {
        const group = this.playerGroup;

        // Ground check ka simple jugad (Jab tak Raycasting nahi lagate)
        // Agar body ki velocity Y axis pe 0 ke karib hai, matlab wo zameen pe hai
        if (Math.abs(this.body.velocity.y) < 0.1) {
            this.isGrounded = true;
            if (this.isJumping) {
                this.isJumping = false;
                // Idle ya Run pe wapas jao
                this.animController.fadeToAction(this.inputManager.isMoving() ? 'Run' : 'Idle');
            }
        }

        if (this.inputManager.isJumpPressed() && this.isGrounded) {
            // Apply impulse to the CANNON body, not manual position!
            this.body.applyImpulse(new CANNON.Vec3(0, this.jumpForce, 0), this.body.position);
            this.isGrounded = false;

            if (this.isSitting) {
                this.toggleSit(); // Stand up if jumping
            }

            this.isJumping = true;
            this.animController.fadeToAction('Jump');
        }

        // IMPORTANT: Mesh (Visual) ko Physics Body ki jagah par chipkao
        group.position.copy(this.body.position);
        
        // Character ki height offset (taaki pao zameen ke andar na ghusein)
        group.position.y -= 0.9 * this.animController.playerScale; 
    }

    // ----------------------------------------------------------------
    // Camera-Relative Movement
    // ----------------------------------------------------------------

    /**
     * Reads the unified movement vector from InputManager, rotates it
     * by the camera yaw, and applies it to playerGroup.
     *
     * Math:
     *   inputAngle = atan2(input.x, input.y)
     *   targetYaw  = cameraYaw + inputAngle
     *   moveDir    = (-sin(targetYaw), 0, -cos(targetYaw))
     */
    handleMovement(delta, cameraYaw) {
        const mv = this.inputManager.getMovementVector();
        if (mv.magnitude < 0.01) return;

        const group = this.playerGroup;

        // Camera-relative direction
        const inputAngle = Math.atan2(mv.x, mv.y);
        const targetYaw = cameraYaw + inputAngle;

        const dx = -Math.sin(targetYaw);
        const dz = -Math.cos(targetYaw);
        this.moveDirection.set(dx, 0, dz).normalize();

        // Speed: crouch < normal < sprint
        let speed = this.moveSpeed;
        if (this.isSitting) speed = this.crouchSpeed;
        else if (this.inputManager.isSprinting) speed = this.sprintSpeed;

        // Move the GROUP (proportional to joystick magnitude)
        group.position.addScaledVector(this.moveDirection, speed * mv.magnitude * delta);

        // Smooth facing rotation on the GROUP
        if (this.moveDirection.lengthSq() > 0.001) {
            const faceAngle = Math.atan2(this.moveDirection.x, this.moveDirection.z);

            let diff = faceAngle - group.rotation.y;
            // Wrap to [-PI, PI] for shortest-path rotation
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;

            group.rotation.y += diff * Math.min(1, this.rotationSmoothing * delta);
        }
    }
}

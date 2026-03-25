import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationController } from './AnimationController.js';

export class Bot {
    constructor(scene, physicsWorld) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;

        // ── Health System ──
        this.maxHp = 200;
        this.hp = this.maxHp;
        this.isDead = false;

        // ── Visuals & Animation ──
        this.botGroup = new THREE.Group();
        this.botGroup.name = 'BotGroup';
        this.scene.add(this.botGroup);

        this.animController = new AnimationController(scene);
        
        // ── Combat & Movement AI ──
        this.shootInterval = 1500; // 1.5 seconds
        this._lastShootTime = 0;
        this.damage = 15;
        this.speed = 12; // Forward run speed
        this.state = 'IDLE'; 
        this.strafeDir = 1;
        this.lastStrafeChange = 0;

        // ── Hitbox (Invisible for raycasting performance) ──
        const hbGeo = new THREE.CylinderGeometry(1.2, 1.2, 11, 8);
        const hbMat = new THREE.MeshBasicMaterial({ 
            color: 0xff0000, 
            transparent: true, 
            opacity: 0.2, // Keep slightly visible for debugging, change to 0 later
            visible: false 
        });
        this.hitbox = new THREE.Mesh(hbGeo, hbMat);
        this.hitbox.position.y = 5.5; // Center height
        this.hitbox.name = 'BotHitbox';
        this.botGroup.add(this.hitbox);

        this._dirToPlayer = new THREE.Vector3();
    }

    async init(player) {
        const playerModel = player.animController.model;
        if (!playerModel) return;

        // Use SkeletonUtils to clone the player model for the bot
        const clonedModel = SkeletonUtils.clone(playerModel);
        
        // Setup AnimationController properties manually for the bot
        // This avoids calling init() which would reload the model from disk
        this.animController.model = clonedModel;
        this.animController.playerGroup = new THREE.Group();
        this.animController.rotationOffsetGroup = new THREE.Group();
        
        this.animController.rotationOffsetGroup.add(clonedModel);
        this.animController.playerGroup.add(this.animController.rotationOffsetGroup);
        
        // Setup Mixer for the cloned model
        this.animController.mixer = new THREE.AnimationMixer(clonedModel);
        
        // Setup actions from player's clips
        const playerActions = player.animController.actions;
        for (const [name, action] of Object.entries(playerActions)) {
            const clip = action.getClip();
            this.animController.actions[name] = this.animController.mixer.clipAction(clip);
            if (name === 'Jump') {
                this.animController.actions[name].loop = THREE.LoopOnce;
                this.animController.actions[name].clampWhenFinished = true;
            } else {
                this.animController.actions[name].loop = THREE.LoopRepeat;
            }
        }

        // Initialize armature lock reference for the bot
        this.animController._armatureNode = null;
        clonedModel.traverse((node) => {
            if (!this.animController._armatureNode && node.name &&
                node.name.toLowerCase().startsWith('armature')) {
                this.animController._armatureNode = node;
                this.animController._armatureRestQuat.copy(node.quaternion);
            }
        });

        this.animController.fadeToAction('Idle');
        
        // Add to botGroup
        this.botGroup.add(this.animController.playerGroup);
        
        console.log('Bot initialized via SkeletonUtils ✓');
    }

    reset(position) {
        this.hp = this.maxHp;
        this.isDead = false;
        this.botGroup.position.copy(position);
        this.botGroup.rotation.set(0, 0, 0);
        
        if (this.animController) {
            this.animController.fadeToAction('Idle');
        }
    }

    takeDamage(amount) {
        if (this.isDead) return;
        this.hp -= amount;
        console.log(`Bot took ${amount} damage. HP: ${this.hp}`);
        
        if (this.hp <= 0) {
            this.die();
        }
    }

    die() {
        this.isDead = true;
        this.hp = 0;
        if (this.animController) {
            // No specific death animation exported usually, just pause or play something
            this.animController.playerGroup.rotation.x = Math.PI / 2;
        }
        
        // Signal GameManager? (Handled in Game.js loop)
    }

    update(delta, player, time, gameManager) {
        if (this.isDead || !player || player.isDead) return;

        const playerPos = player.playerGroup.position;
        const myPos = this.botGroup.position;

        // 1. Look at player
        this._dirToPlayer.subVectors(playerPos, myPos);
        this._dirToPlayer.y = 0;
        const dist = this._dirToPlayer.length();
        this._dirToPlayer.normalize();

        const targetYaw = Math.atan2(this._dirToPlayer.x, this._dirToPlayer.z);
        this.botGroup.rotation.y = THREE.MathUtils.lerp(this.botGroup.rotation.y, targetYaw, delta * 8);

        // 2. Movement AI
        let currentAnim = 'Idle';
        
        if (dist > 18) {
            // Chase player
            this.state = 'CHASE';
            myPos.add(this._dirToPlayer.clone().multiplyScalar(this.speed * delta));
            currentAnim = 'Run';
        } else {
            // Strafe and combat distance
            this.state = 'STRAFE';
            if (time - this.lastStrafeChange > 1.5) { // Change strafe direction randomly
                this.strafeDir = Math.random() > 0.5 ? 1 : -1;
                this.lastStrafeChange = time;
                
                // 30% chance to jump while strafing to dodge bullets
                if (Math.random() > 0.7 && this.animController) {
                    this.animController.fadeToAction('Jump');
                }
            }
            
            // Move sideways (strafe)
            const rightVector = new THREE.Vector3(-this._dirToPlayer.z, 0, this._dirToPlayer.x);
            myPos.add(rightVector.multiplyScalar(this.speed * 0.7 * this.strafeDir * delta));
            
            // Maintain a minimum distance (back up if too close)
            if (dist < 10) {
               myPos.sub(this._dirToPlayer.clone().multiplyScalar(this.speed * 0.5 * delta));
            }

            currentAnim = 'Run';
        }
        
        // 3. Animation Update (Only override if not jumping)
        if (this.animController && this.animController.activeActionName !== 'Jump') {
           this.animController.fadeToAction(currentAnim);
        }

        // 4. Shooting Logic
        if (time - this._lastShootTime > this.shootInterval && dist < 45) {
            this._lastShootTime = time;
            this.shoot(player);
        }

        this.animController.update(delta);
    }

    shoot(player) {
        // Simple probability hit for bot
        const hitChance = 0.6;
        if (Math.random() < hitChance) {
            player.takeDamage(this.damage);
            
            // Visual Tracer
            this.createTracer(player.playerGroup.position.clone().add(new THREE.Vector3(0, 5, 0)));
        }
    }

    createTracer(targetPos) {
        // Start from bot's approximate gun position
        const startPos = this.botGroup.position.clone().add(new THREE.Vector3(0, 5, 0));
        
        const geometry = new THREE.BufferGeometry().setFromPoints([startPos, targetPos]);
        const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const line = new THREE.Line(geometry, material);
        
        this.scene.add(line);
        setTimeout(() => this.scene.remove(line), 50);
    }
}

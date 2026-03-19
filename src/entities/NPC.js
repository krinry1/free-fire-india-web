import * as THREE from 'three';

export class NPC {
    constructor(scene, physicsWorld, position = new THREE.Vector3(0, 100, 0)) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;

        // ── Health System ──
        this.maxHp = 200;
        this.hp = this.maxHp;
        this.isDead = false;

        // ── Visuals ──
        this.npcGroup = new THREE.Group();
        this.npcGroup.position.copy(position);

        // Simple red cylinder for now
        const geometry = new THREE.CylinderGeometry(1, 1, 4, 16);
        const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.y = 2; // Center it
        this.mesh.castShadow = true;
        this.npcGroup.add(this.mesh);

        // HP Bar Display (UI in 3D or just console logging)

        this.scene.add(this.npcGroup);

        // ── Behavior ──
        this.moveSpeed = 8.0;
        this.attackRange = 4.0;
        this.attackDamage = 10;
        this.attackCooldown = 1.0;
        this._lastAttackTime = 0;

        // Pre-allocated vectors (avoid per-frame allocation)
        this._dirToPlayer = new THREE.Vector3();
    }

    takeDamage(amount) {
        if (this.isDead) return;

        this.hp -= amount;

        // Visual flash (turn white briefly)
        this.mesh.material.color.setHex(0xffffff);
        setTimeout(() => {
            if (!this.isDead && this.mesh) {
                this.mesh.material.color.setHex(0xff0000);
            }
        }, 150);

        if (this.hp <= 0) {
            this.hp = 0;
            this.die();
        }
    }

    die() {
        this.isDead = true;

        // Visual death (fall over and disappear after a bit)
        this.npcGroup.rotation.x = Math.PI / 2;
        this.npcGroup.position.y -= 1;
        this.mesh.material.color.setHex(0x555555); // Grey out

        // Remove from scene after 3 seconds
        setTimeout(() => {
            if (this.scene && this.npcGroup) {
                this.scene.remove(this.npcGroup);
            }
        }, 3000);
    }

    update(delta, player, time) {
        if (this.isDead || !player || player.isDead || !player.playerGroup) return;

        const playerPos = player.playerGroup.position;
        const myPos = this.npcGroup.position;

        // Distance to player
        const dist = myPos.distanceTo(playerPos);

        // Direction to player (reuse pre-allocated vector)
        const dir = this._dirToPlayer.subVectors(playerPos, myPos);
        dir.y = 0;
        dir.normalize();

        // 1. Move towards player if outside attack range
        if (dist > this.attackRange) {
            this.npcGroup.position.addScaledVector(dir, this.moveSpeed * delta);

            // Look at player
            const targetYaw = Math.atan2(dir.x, dir.z);
            this.npcGroup.rotation.y = targetYaw;
        }
        // 2. Attack player if close enough
        else {
            if (time - this._lastAttackTime > this.attackCooldown) {
                this._lastAttackTime = time;
                player.takeDamage(this.attackDamage);
            }
        }
    }
}

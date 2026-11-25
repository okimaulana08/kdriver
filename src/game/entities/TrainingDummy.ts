import * as THREE from 'three';
import { HitboxSystem } from '../combat/HitboxSystem';
import { STATUS_DEFAULT_DURATIONS } from '../combat/ReactionSystem';
import { getEnemyConfig } from '../data/enemies';
import type {
  ActiveStatusSnapshot,
  EnemyConfig,
  HurtboxTarget,
  StatusEffectId,
  Vec3Snapshot,
} from '../types/schema';

export type DummyAttackPhase = 'IDLE' | 'TELEGRAPH' | 'ACTIVE' | 'RECOVERY' | 'RESPAWNING';

const ATTACK_RADIUS = 4.6;
const ATTACK_ACTIVE_DURATION = 0.16;
const ATTACK_RECOVERY_DURATION = 0.85;
const AUTO_ATTACK_COOLDOWN = 4.6;
const AUTO_ATTACK_TRIGGER_DIST = 6.8;
const RESPAWN_DURATION = 1.8;
const BURN_TICK_INTERVAL = 1.0;
const BURN_TICK_DAMAGE = 12;

export interface DummyUpdateEvents {
  startedTelegraph: boolean;
  hitPlayerThisStep: boolean;
  respawned: boolean;
  burnTickDamage: number;
  microExplosionDamage: number;
}

const STATUS_AURA_COLORS: Readonly<Record<StatusEffectId, number>> = {
  BURN: 0xff5722,
  SHOCK: 0xfacc15,
  WET: 0x22d3ee,
  ROOT: 0x22c55e,
  MARK: 0xa855f7,
};

/**
 * Stylized Kaijin Training Dummy with active Elemental Status tracking (BURN DoT, SHOCK crit vulnerability,
 * WET slow), Overload micro-explosions, 3D Lock-On reticle, and 0.65s telegraphed shockwave.
 */
export class TrainingDummy implements HurtboxTarget {
  public readonly id = 'training_dummy_01';
  public readonly radius = 0.82;
  public readonly root = new THREE.Group();
  public readonly config: EnemyConfig;

  private hp: number;
  private phase: DummyAttackPhase = 'IDLE';
  private phaseTimer = 0;
  private attackCooldown = 3.2;
  private attackSwingId = 0;
  private lockedOn = false;

  // Elemental Status Tracking
  private readonly activeStatuses = new Map<StatusEffectId, number>();
  private burnTickTimer = 0;
  private pendingMicroExplosions = 0;
  private microExplosionTimer = 0;
  private microExplosionDamagePerBlast = 0;

  private hitFlashTimer = 0;
  private wobbleTime = 0;
  private wobbleDirX = 0;
  private wobbleDirZ = 0;
  private animTime = 0;

  private readonly attackHitbox = new HitboxSystem();
  private readonly visualPivot = new THREE.Group();
  private readonly coreCrystal: THREE.Mesh;
  private readonly lockOnReticle: THREE.Group;
  private readonly statusAuraRing: THREE.Mesh;
  private readonly statusAuraMat: THREE.MeshBasicMaterial;
  private readonly telegraphFillMesh: THREE.Mesh;
  private readonly telegraphBorderMesh: THREE.Mesh;
  private readonly shockwaveRingMesh: THREE.Mesh;

  private readonly bodyMat: THREE.MeshToonMaterial;
  private readonly trimMat: THREE.MeshToonMaterial;
  private readonly eyeMat: THREE.MeshStandardMaterial;
  private readonly telegraphFillMat: THREE.MeshBasicMaterial;
  private readonly telegraphBorderMat: THREE.MeshBasicMaterial;
  private readonly shockwaveMat: THREE.MeshBasicMaterial;

  // Reusable scratch objects (Zero-Allocation Hot Path)
  private readonly scratchOrigin: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  private readonly scratchPlayerTargets: HurtboxTarget[] = [];
  private readonly scratchHits: HurtboxTarget[] = [];
  private readonly events: DummyUpdateEvents = {
    startedTelegraph: false,
    hitPlayerThisStep: false,
    respawned: false,
    burnTickDamage: 0,
    microExplosionDamage: 0,
  };

  constructor(toonGradientMap: THREE.DataTexture, spawnX = 0, spawnZ = -5.5) {
    this.config = getEnemyConfig('training_dummy');
    this.hp = this.config.maxHp;

    this.bodyMat = new THREE.MeshToonMaterial({
      color: new THREE.Color(this.config.color),
      gradientMap: toonGradientMap,
    });
    this.trimMat = new THREE.MeshToonMaterial({
      color: 0x1e1b4b,
      gradientMap: toonGradientMap,
    });
    this.eyeMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xf43f5e,
      emissiveIntensity: 1.8,
      roughness: 0.25,
    });

    this.root.position.set(spawnX, 0, spawnZ);
    this.root.add(this.visualPivot);

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 0.24, 8), this.trimMat);
    pedestal.position.y = 0.12;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    this.visualPivot.add(pedestal);

    const lowerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.46, 0.85, 8), this.trimMat);
    lowerBody.position.y = 0.65;
    lowerBody.castShadow = true;
    this.visualPivot.add(lowerBody);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.78, 0.56), this.bodyMat);
    torso.position.y = 1.42;
    torso.castShadow = true;
    this.visualPivot.add(torso);

    const shoulderGeo = new THREE.ConeGeometry(0.28, 0.52, 5);
    const leftShoulder = new THREE.Mesh(shoulderGeo, this.bodyMat);
    leftShoulder.position.set(-0.62, 1.72, 0);
    leftShoulder.rotation.z = 0.75;
    leftShoulder.castShadow = true;
    this.visualPivot.add(leftShoulder);

    const rightShoulder = new THREE.Mesh(shoulderGeo, this.bodyMat);
    rightShoulder.position.set(0.62, 1.72, 0);
    rightShoulder.rotation.z = -0.75;
    rightShoulder.castShadow = true;
    this.visualPivot.add(rightShoulder);

    this.coreCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), this.eyeMat);
    this.coreCrystal.position.set(0, 1.44, 0.34);
    this.visualPivot.add(this.coreCrystal);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.44), this.trimMat);
    head.position.set(0, 2.04, 0.02);
    head.castShadow = true;
    this.visualPivot.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.12), this.eyeMat);
    visor.position.set(0, 2.07, 0.22);
    this.visualPivot.add(visor);

    const hornGeo = new THREE.ConeGeometry(0.06, 0.44, 5);
    const leftHorn = new THREE.Mesh(hornGeo, this.bodyMat);
    leftHorn.position.set(-0.22, 2.34, 0.04);
    leftHorn.rotation.z = 0.5;
    this.visualPivot.add(leftHorn);

    const rightHorn = new THREE.Mesh(hornGeo, this.bodyMat);
    rightHorn.position.set(0.22, 2.34, 0.04);
    rightHorn.rotation.z = -0.5;
    this.visualPivot.add(rightHorn);

    // Glowing Elemental Status Aura Ring at Dummy Base
    this.statusAuraMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.statusAuraRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.18, 32),
      this.statusAuraMat
    );
    this.statusAuraRing.rotation.x = -Math.PI / 2;
    this.statusAuraRing.position.y = 0.05;
    this.statusAuraRing.visible = false;
    this.root.add(this.statusAuraRing);

    // 3D Lock-On Diamond Reticle
    this.lockOnReticle = new THREE.Group();
    const reticleOuter = new THREE.Mesh(
      new THREE.RingGeometry(0.68, 0.78, 4),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    const reticleInner = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.44, 4),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    this.lockOnReticle.add(reticleOuter, reticleInner);
    this.lockOnReticle.position.set(0, 1.45, 0);
    this.lockOnReticle.visible = false;
    this.root.add(this.lockOnReticle);

    // Telegraph Ground Danger Zone
    this.telegraphBorderMat = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.telegraphBorderMesh = new THREE.Mesh(
      new THREE.RingGeometry(ATTACK_RADIUS - 0.12, ATTACK_RADIUS, 48),
      this.telegraphBorderMat
    );
    this.telegraphBorderMesh.rotation.x = -Math.PI / 2;
    this.telegraphBorderMesh.position.y = 0.04;
    this.telegraphBorderMesh.visible = false;
    this.root.add(this.telegraphBorderMesh);

    this.telegraphFillMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.telegraphFillMesh = new THREE.Mesh(
      new THREE.CircleGeometry(ATTACK_RADIUS, 48),
      this.telegraphFillMat
    );
    this.telegraphFillMesh.rotation.x = -Math.PI / 2;
    this.telegraphFillMesh.position.y = 0.035;
    this.telegraphFillMesh.scale.setScalar(0.01);
    this.telegraphFillMesh.visible = false;
    this.root.add(this.telegraphFillMesh);

    // Active Shockwave Burst Ring
    this.shockwaveMat = new THREE.MeshBasicMaterial({
      color: 0xff2e63,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.shockwaveRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 1.0, 40),
      this.shockwaveMat
    );
    this.shockwaveRingMesh.rotation.x = -Math.PI / 2;
    this.shockwaveRingMesh.position.y = 0.35;
    this.shockwaveRingMesh.visible = false;
    this.root.add(this.shockwaveRingMesh);
  }

  public get isAlive(): boolean {
    return this.hp > 0 && this.phase !== 'RESPAWNING';
  }

  public get currentHp(): number {
    return this.hp;
  }

  public get maxHp(): number {
    return this.config.maxHp;
  }

  public get currentPhase(): DummyAttackPhase {
    return this.phase;
  }

  public getActiveStatusIds(): StatusEffectId[] {
    return Array.from(this.activeStatuses.keys());
  }

  public getActiveStatusSnapshots(): ActiveStatusSnapshot[] {
    const out: ActiveStatusSnapshot[] = [];
    for (const [id, remainingSec] of this.activeStatuses) {
      out.push({
        id,
        remainingSec,
        durationSec: STATUS_DEFAULT_DURATIONS[id],
      });
    }
    return out;
  }

  public applyStatus(status: StatusEffectId): void {
    if (!this.isAlive) return;
    this.activeStatuses.set(status, STATUS_DEFAULT_DURATIONS[status]);
    if (status === 'BURN' && this.burnTickTimer <= 0) {
      this.burnTickTimer = BURN_TICK_INTERVAL;
    }
  }

  public consumeStatus(status: StatusEffectId): void {
    this.activeStatuses.delete(status);
  }

  public queueMicroExplosions(count: number, damagePerBlast: number): void {
    if (count <= 0 || !this.isAlive) return;
    this.pendingMicroExplosions = Math.max(this.pendingMicroExplosions, count);
    this.microExplosionDamagePerBlast = damagePerBlast;
    this.microExplosionTimer = 0.13;
  }

  public getPosition(out: Vec3Snapshot): Vec3Snapshot {
    out.x = this.root.position.x;
    out.y = this.root.position.y + 1.1;
    out.z = this.root.position.z;
    return out;
  }

  public setLockedOn(locked: boolean): void {
    this.lockedOn = locked;
    this.lockOnReticle.visible = locked && this.isAlive;
  }

  public triggerTelegraphAttack(): boolean {
    if (!this.isAlive || this.phase !== 'IDLE') return false;
    this.enterTelegraph();
    return true;
  }

  public applyDamage(damage: number, hitFromX: number, hitFromZ: number): boolean {
    if (!this.isAlive) return false;
    this.hp = Math.max(0, this.hp - Math.max(1, Math.floor(damage)));
    this.hitFlashTimer = 0.12;
    this.wobbleTime = 0.24;

    const dx = this.root.position.x - hitFromX;
    const dz = this.root.position.z - hitFromZ;
    const len = Math.hypot(dx, dz);
    if (len > 0.001) {
      this.wobbleDirX = dx / len;
      this.wobbleDirZ = dz / len;
    } else {
      this.wobbleDirX = 0;
      this.wobbleDirZ = -1;
    }

    if (this.hp === 0) {
      this.phase = 'RESPAWNING';
      this.phaseTimer = 0;
      this.activeStatuses.clear();
      this.pendingMicroExplosions = 0;
      this.attackHitbox.endSwing();
      this.hideTelegraphVisuals();
      return true;
    }

    return false;
  }

  public fixedUpdate(dt: number, player: HurtboxTarget): DummyUpdateEvents {
    this.events.startedTelegraph = false;
    this.events.hitPlayerThisStep = false;
    this.events.respawned = false;
    this.events.burnTickDamage = 0;
    this.events.microExplosionDamage = 0;

    this.phaseTimer += dt;
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    if (this.wobbleTime > 0) this.wobbleTime = Math.max(0, this.wobbleTime - dt);

    if (this.phase === 'RESPAWNING') {
      if (this.phaseTimer >= RESPAWN_DURATION) {
        this.hp = this.config.maxHp;
        this.phase = 'IDLE';
        this.phaseTimer = 0;
        this.attackCooldown = 2.6;
        this.events.respawned = true;
      }
      return this.events;
    }

    // Tick Elemental Status Durations & BURN DoT
    for (const [status, rem] of this.activeStatuses) {
      const nextRem = rem - dt;
      if (nextRem <= 0) {
        this.activeStatuses.delete(status);
      } else {
        this.activeStatuses.set(status, nextRem);
      }
    }

    if (this.activeStatuses.has('BURN')) {
      this.burnTickTimer -= dt;
      if (this.burnTickTimer <= 0) {
        this.burnTickTimer = BURN_TICK_INTERVAL;
        this.applyDamage(BURN_TICK_DAMAGE, this.root.position.x, this.root.position.z);
        this.events.burnTickDamage = BURN_TICK_DAMAGE;
        if (!this.isAlive) return this.events;
      }
    }

    // Tick Overload staggered micro-explosions
    if (this.pendingMicroExplosions > 0) {
      this.microExplosionTimer -= dt;
      if (this.microExplosionTimer <= 0) {
        this.pendingMicroExplosions--;
        this.microExplosionTimer = 0.14;
        const dmg = Math.max(1, Math.floor(this.microExplosionDamagePerBlast));
        this.applyDamage(dmg, this.root.position.x, this.root.position.z);
        this.events.microExplosionDamage = dmg;
        if (!this.isAlive) return this.events;
      }
    }

    // Face the player gently while active
    player.getPosition(this.scratchOrigin);
    const toPlayerX = this.scratchOrigin.x - this.root.position.x;
    const toPlayerZ = this.scratchOrigin.z - this.root.position.z;
    const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);
    if (distToPlayer > 0.1) {
      this.root.rotation.y = Math.atan2(toPlayerX, toPlayerZ);
    }

    // WET slows enemy attack cadence by 40%
    const cadenceRate = this.activeStatuses.has('WET') ? 0.6 : 1.0;

    if (this.phase === 'IDLE') {
      this.attackCooldown -= dt * cadenceRate;
      if (this.attackCooldown <= 0 && distToPlayer <= AUTO_ATTACK_TRIGGER_DIST) {
        this.enterTelegraph();
        this.events.startedTelegraph = true;
      }
    } else if (this.phase === 'TELEGRAPH') {
      if (this.phaseTimer >= this.config.telegraphDurationSec) {
        this.phase = 'ACTIVE';
        this.phaseTimer = 0;
        this.attackSwingId++;
        this.attackHitbox.beginSwing(this.attackSwingId);
        this.telegraphBorderMesh.visible = false;
        this.telegraphFillMesh.visible = false;
        this.shockwaveRingMesh.visible = true;
      }
    } else if (this.phase === 'ACTIVE') {
      this.scratchOrigin.x = this.root.position.x;
      this.scratchOrigin.y = this.root.position.y + 1.0;
      this.scratchOrigin.z = this.root.position.z;
      this.scratchPlayerTargets.length = 1;
      this.scratchPlayerTargets[0] = player;

      this.attackHitbox.checkSphere(
        this.scratchOrigin,
        ATTACK_RADIUS,
        this.scratchPlayerTargets,
        this.scratchHits
      );

      if (this.scratchHits.length > 0) {
        this.events.hitPlayerThisStep = true;
      }

      if (this.phaseTimer >= ATTACK_ACTIVE_DURATION) {
        this.phase = 'RECOVERY';
        this.phaseTimer = 0;
        this.attackHitbox.endSwing();
      }
    } else if (this.phase === 'RECOVERY') {
      if (this.phaseTimer >= ATTACK_RECOVERY_DURATION) {
        this.phase = 'IDLE';
        this.phaseTimer = 0;
        this.attackCooldown = AUTO_ATTACK_COOLDOWN;
        this.shockwaveRingMesh.visible = false;
      }
    }

    return this.events;
  }

  public updateVisuals(renderDt: number, camera: THREE.Camera): void {
    this.animTime += renderDt;

    if (this.phase === 'RESPAWNING') {
      const t = Math.min(1, this.phaseTimer / RESPAWN_DURATION);
      const scale = t < 0.25 ? 1 - t * 3.4 : 0.15;
      this.visualPivot.scale.set(1, Math.max(0.1, scale), 1);
      this.lockOnReticle.visible = false;
      this.statusAuraRing.visible = false;
      return;
    }

    this.visualPivot.scale.set(1, 1, 1);

    this.coreCrystal.rotation.y = this.animTime * 2.2;
    this.coreCrystal.rotation.x = Math.sin(this.animTime * 1.6) * 0.35;

    if (this.wobbleTime > 0) {
      const k = (this.wobbleTime / 0.24) * 0.28;
      this.visualPivot.rotation.x = this.wobbleDirZ * k;
      this.visualPivot.rotation.z = -this.wobbleDirX * k;
    } else {
      this.visualPivot.rotation.x = 0;
      this.visualPivot.rotation.z = 0;
    }

    // Elemental Status Aura Ring visualization
    const primaryStatus = this.activeStatuses.keys().next().value as StatusEffectId | undefined;
    if (primaryStatus) {
      this.statusAuraRing.visible = true;
      this.statusAuraMat.color.setHex(STATUS_AURA_COLORS[primaryStatus]);
      const auraPulse = 1 + Math.sin(this.animTime * 8) * 0.12;
      this.statusAuraRing.scale.setScalar(auraPulse);
      this.statusAuraRing.rotation.z = this.animTime * 2.2;
    } else {
      this.statusAuraRing.visible = false;
    }

    if (this.hitFlashTimer > 0) {
      this.bodyMat.color.setHex(0xffffff);
      this.eyeMat.emissiveIntensity = 3.5;
    } else if (this.phase === 'TELEGRAPH') {
      const t = Math.min(1, this.phaseTimer / this.config.telegraphDurationSec);
      const pulse = 0.5 + 0.5 * Math.sin(this.phaseTimer * 36);
      this.bodyMat.color.setHex(pulse > 0.4 ? 0xef4444 : 0x991b1b);
      this.eyeMat.emissiveIntensity = 3.2 + pulse * 1.4;

      this.telegraphBorderMesh.visible = true;
      this.telegraphFillMesh.visible = true;
      this.telegraphFillMesh.scale.setScalar(Math.max(0.05, t));
      this.telegraphFillMat.opacity = 0.18 + t * 0.38;
      this.visualPivot.position.y = Math.sin(t * Math.PI) * 0.16;
    } else {
      this.bodyMat.color.set(this.config.color);
      this.eyeMat.emissiveIntensity = 1.8;
      this.visualPivot.position.y = Math.sin(this.animTime * 2.5) * 0.04;
    }

    if (this.phase === 'ACTIVE' || (this.phase === 'RECOVERY' && this.phaseTimer < 0.22)) {
      const totalBurst = ATTACK_ACTIVE_DURATION + 0.22;
      const elapsed =
        this.phase === 'ACTIVE' ? this.phaseTimer : ATTACK_ACTIVE_DURATION + this.phaseTimer;
      const t = Math.min(1, elapsed / totalBurst);
      this.shockwaveRingMesh.visible = true;
      this.shockwaveRingMesh.scale.setScalar(0.6 + t * ATTACK_RADIUS);
      this.shockwaveMat.opacity = (1 - t) * 0.92;
    } else {
      this.shockwaveRingMesh.visible = false;
    }

    if (this.lockedOn && this.isAlive) {
      this.lockOnReticle.visible = true;
      this.lockOnReticle.lookAt(camera.position);
      this.lockOnReticle.children[0]!.rotation.z = this.animTime * 1.8;
      this.lockOnReticle.children[1]!.rotation.z = -this.animTime * 2.6;
    } else {
      this.lockOnReticle.visible = false;
    }
  }

  public dispose(): void {
    this.attackHitbox.dispose();
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) {
          for (let i = 0; i < mat.length; i++) {
            mat[i]?.dispose();
          }
        } else {
          mat.dispose();
        }
      }
    });
  }

  private enterTelegraph(): void {
    this.phase = 'TELEGRAPH';
    this.phaseTimer = 0;
    this.telegraphBorderMesh.visible = true;
    this.telegraphFillMesh.visible = true;
    this.telegraphFillMesh.scale.setScalar(0.05);
  }

  private hideTelegraphVisuals(): void {
    this.telegraphBorderMesh.visible = false;
    this.telegraphFillMesh.visible = false;
    this.shockwaveRingMesh.visible = false;
  }
}

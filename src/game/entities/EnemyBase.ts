import * as THREE from 'three';
import type { AssetKey, AssetLoader } from '../../engine/AssetLoader';
import { HumanoidBoneDriver } from '../../engine/HumanoidBoneDriver';
import {
  bindPbrMaterials,
  createCompoundEyeMaterial,
  createKaijinCarapaceMaterial,
  createUndersuitMaterial,
  type PbrTextureSet,
} from '../../engine/PbrMaterialSystem';
import { ARENA_RADIUS } from '../../engine/PhysicsWorld';
import { SkeletalAnimator } from '../../engine/SkeletalAnimator';
import { HitboxSystem } from '../combat/HitboxSystem';
import { STATUS_DEFAULT_DURATIONS } from '../combat/ReactionSystem';
import type {
  ActiveStatusSnapshot,
  EnemyConfig,
  EnemyHudSnapshot,
  HurtboxTarget,
  StatusEffectId,
  Vec3Snapshot,
} from '../types/schema';

export type EnemyAIState =
  | 'CHASE'
  | 'TELEGRAPH'
  | 'ATTACK_ACTIVE'
  | 'RECOVERY'
  | 'HITSTUN'
  | 'STAGGERED'
  | 'DEAD';

const BURN_TICK_INTERVAL = 1.0;
const BURN_TICK_DAMAGE = 12;
const STAGGER_DURATION_SEC = 5.0;
const HITSTUN_DURATION_SEC = 0.28;
const DEATH_ANIM_DURATION_SEC = 0.65;

const STATUS_AURA_COLORS: Readonly<Record<StatusEffectId, number>> = {
  BURN: 0xff5722,
  SHOCK: 0xfacc15,
  WET: 0x22d3ee,
  ROOT: 0x22c55e,
  MARK: 0xa855f7,
};

export interface EnemyHitResult {
  killed: boolean;
  guardBroken: boolean;
}

export interface EnemyFixedUpdateEvents {
  startedTelegraph: boolean;
  hitPlayerDamage: number;
  hitPlayerHeavy: boolean;
  burnTickDamage: number;
  microExplosionDamage: number;
  enteredPhase2: boolean;
  fireProjectileSpread: boolean;
  diedThisFrame: boolean;
}

/**
 * Base 3D Enemy Entity supporting Minion, Elite (Guard Bar / Super Armor + Stagger),
 * and Boss subclassing. Enforces >= 0.45s crimson telegraph before hitbox activation,
 * Elemental Status effects, Hit Registry, zero-allocation hot path, and clean dispose().
 */
export class EnemyBase implements HurtboxTarget {
  public readonly id: string;
  public readonly config: EnemyConfig;
  public readonly radius: number;
  public readonly root = new THREE.Group();

  protected hp: number;
  protected guard: number;
  protected aiState: EnemyAIState = 'CHASE';
  protected stateTimer = 0;
  protected attackCooldown = 1.2;
  protected attackRange: number;
  protected activeAttackRadius: number;
  protected currentTelegraphDuration: number;
  protected currentAttackHeavy = false;
  protected attackSwingId = 0;
  protected bossPhase: 1 | 2 = 1;
  protected readyForDisposal = false;

  protected lockedOn = false;
  protected hitFlashTimer = 0;
  protected animTime = 0;
  protected knockVelX = 0;
  protected knockVelZ = 0;

  protected readonly activeStatuses = new Map<StatusEffectId, number>();
  protected burnTickTimer = 0;
  protected pendingMicroExplosions = 0;
  protected microExplosionTimer = 0;
  protected microExplosionDamagePerBlast = 0;

  protected readonly attackHitbox = new HitboxSystem();
  protected readonly visualPivot = new THREE.Group();
  protected readonly lockOnReticle: THREE.Group;
  protected readonly statusAuraRing: THREE.Mesh;
  protected readonly statusAuraMat: THREE.MeshBasicMaterial;
  protected readonly guardShieldRing: THREE.Mesh;
  protected readonly guardShieldMat: THREE.MeshBasicMaterial;
  protected readonly phase2HaloMesh: THREE.Mesh;
  protected readonly telegraphBorderMesh: THREE.Mesh;
  protected readonly telegraphFillMesh: THREE.Mesh;
  protected readonly shockwaveMesh: THREE.Mesh;

  protected readonly bodyMat: THREE.MeshPhysicalMaterial;
  protected readonly trimMat: THREE.MeshStandardMaterial;
  protected readonly eyeMat: THREE.MeshPhysicalMaterial;
  protected readonly externalMaterials: THREE.MeshStandardMaterial[] = [];
  protected readonly skeletalAnimator: SkeletalAnimator;
  protected readonly boneDriver: HumanoidBoneDriver;
  protected readonly baseVisualScale: number;
  protected readonly telegraphFillMat: THREE.MeshBasicMaterial;
  protected readonly shockwaveMat: THREE.MeshBasicMaterial;
  protected readonly ownedMaterials: THREE.Material[] = [];

  // Reusable scratch objects (Zero-Allocation Hot Path)
  protected readonly scratchPlayerPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  protected readonly scratchSelfPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  protected readonly scratchTargets: HurtboxTarget[] = [];
  protected readonly scratchHits: HurtboxTarget[] = [];
  protected readonly events: EnemyFixedUpdateEvents = {
    startedTelegraph: false,
    hitPlayerDamage: 0,
    hitPlayerHeavy: false,
    burnTickDamage: 0,
    microExplosionDamage: 0,
    enteredPhase2: false,
    fireProjectileSpread: false,
    diedThisFrame: false,
  };

  constructor(
    id: string,
    config: EnemyConfig,
    assetLoader: AssetLoader,
    pbrTextures: PbrTextureSet,
    spawnX: number,
    spawnZ: number
  ) {
    this.id = id;
    this.config = config;
    this.hp = config.maxHp;
    this.guard = config.maxGuard;
    this.radius = config.tier === 'BOSS' ? 1.05 : config.tier === 'ELITE' ? 0.85 : 0.56;
    this.attackRange = config.tier === 'BOSS' ? 4.2 : config.tier === 'ELITE' ? 3.5 : 2.3;
    this.activeAttackRadius = config.tier === 'BOSS' ? 4.6 : config.tier === 'ELITE' ? 4.1 : 2.4;
    this.currentTelegraphDuration = Math.max(0.45, config.telegraphDurationSec);
    this.attackCooldown = 0.9 + Math.random() * 1.1;

    this.bodyMat = createKaijinCarapaceMaterial(config.color, pbrTextures, config.tier === 'BOSS');
    this.trimMat = createUndersuitMaterial(pbrTextures);
    this.eyeMat = createCompoundEyeMaterial(0xf43f5e, pbrTextures, 2.0);

    this.root.position.set(spawnX, 0, spawnZ);
    this.root.add(this.visualPivot);

    // Clone .glb monster rig (uses SkeletonUtils.clone automatically for Mixamo SkinnedMeshes!)
    const assetKey: AssetKey =
      config.tier === 'BOSS'
        ? 'enemy_boss'
        : config.tier === 'ELITE'
          ? 'enemy_brute'
          : 'enemy_grunt';
    const cloned = assetLoader.cloneRig(assetKey);
    const enemyModel = cloned.scene;
    this.baseVisualScale = cloned.isCustomExternal ? 1.0 : config.scale;
    if (!cloned.isCustomExternal) {
      this.visualPivot.scale.setScalar(config.scale);
    }

    const externalMats = bindPbrMaterials(
      enemyModel,
      {
        enemy_body: this.bodyMat,
        enemy_trim: this.trimMat,
        enemy_eye: this.eyeMat,
      },
      { preserveExternalPbr: true, envMapIntensity: 1.35 }
    );
    this.externalMaterials.push(...externalMats);
    this.skeletalAnimator = new SkeletalAnimator(enemyModel, cloned.animations);
    this.boneDriver = new HumanoidBoneDriver(enemyModel);
    if (this.skeletalAnimator.hasClips) {
      this.skeletalAnimator.playState('CHASE', { loop: true });
    }

    this.visualPivot.add(enemyModel);
    this.ownedMaterials.push(this.bodyMat, this.trimMat, this.eyeMat, ...externalMats);

    // Elemental Status Aura Ring
    this.statusAuraMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.statusAuraRing = new THREE.Mesh(
      new THREE.RingGeometry(this.radius + 0.14, this.radius + 0.36, 28),
      this.statusAuraMat
    );
    this.statusAuraRing.rotation.x = -Math.PI / 2;
    this.statusAuraRing.position.y = 0.05;
    this.statusAuraRing.visible = false;
    this.root.add(this.statusAuraRing);

    // Golden Super-Armor Guard Shield Ring (visible while guard > 0)
    this.guardShieldMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.guardShieldRing = new THREE.Mesh(
      new THREE.RingGeometry(this.radius + 0.02, this.radius + 0.15, 6),
      this.guardShieldMat
    );
    this.guardShieldRing.rotation.x = -Math.PI / 2;
    this.guardShieldRing.position.y = 0.09;
    this.guardShieldRing.visible = this.guard > 0;
    this.root.add(this.guardShieldRing);

    // Phase 2 Crimson-Obsidian Halo (ignites on Boss Phase 2)
    this.phase2HaloMesh = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.06, 8, 28),
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
      })
    );
    this.phase2HaloMesh.position.set(0, config.tier === 'BOSS' ? 2.45 : 2.35, -0.38);
    this.phase2HaloMesh.visible = false;
    this.root.add(this.phase2HaloMesh);

    // 3D Lock-On Diamond Reticle
    this.lockOnReticle = new THREE.Group();
    const outerReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.72, 4),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    const innerReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.4, 4),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    this.lockOnReticle.add(outerReticle, innerReticle);
    const reticleY = config.tier === 'BOSS' ? 1.95 : config.tier === 'ELITE' ? 1.65 : 1.25;
    this.lockOnReticle.position.set(0, reticleY, 0);
    this.lockOnReticle.visible = false;
    this.root.add(this.lockOnReticle);

    // Telegraph Crimson Danger Ring (unit radius scaled dynamically to activeAttackRadius)
    this.telegraphBorderMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1.0, 40),
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.telegraphBorderMesh.rotation.x = -Math.PI / 2;
    this.telegraphBorderMesh.position.y = 0.04;
    this.telegraphBorderMesh.visible = false;
    this.root.add(this.telegraphBorderMesh);

    this.telegraphFillMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.telegraphFillMesh = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 40),
      this.telegraphFillMat
    );
    this.telegraphFillMesh.rotation.x = -Math.PI / 2;
    this.telegraphFillMesh.position.y = 0.035;
    this.telegraphFillMesh.visible = false;
    this.root.add(this.telegraphFillMesh);

    this.shockwaveMat = new THREE.MeshBasicMaterial({
      color: 0xff2e63,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.shockwaveMesh = new THREE.Mesh(new THREE.RingGeometry(0.68, 1.0, 36), this.shockwaveMat);
    this.shockwaveMesh.rotation.x = -Math.PI / 2;
    this.shockwaveMesh.position.y = 0.3;
    this.shockwaveMesh.visible = false;
    this.root.add(this.shockwaveMesh);
  }

  public get isAlive(): boolean {
    return this.hp > 0 && this.aiState !== 'DEAD';
  }

  public get canBeDisposed(): boolean {
    return this.readyForDisposal;
  }

  public get currentHp(): number {
    return this.hp;
  }

  public get currentGuard(): number {
    return this.guard;
  }

  public get isStaggered(): boolean {
    return this.aiState === 'STAGGERED';
  }

  public get isTelegraphing(): boolean {
    return this.aiState === 'TELEGRAPH';
  }

  public get currentBossPhase(): 1 | 2 {
    return this.bossPhase;
  }

  public getPosition(out: Vec3Snapshot): Vec3Snapshot {
    out.x = this.root.position.x;
    out.y = this.root.position.y + 1.0 * this.config.scale;
    out.z = this.root.position.z;
    return out;
  }

  public setLockedOn(locked: boolean): void {
    this.lockedOn = locked;
    this.lockOnReticle.visible = locked && this.isAlive;
  }

  public getActiveStatusIds(): StatusEffectId[] {
    return Array.from(this.activeStatuses.keys());
  }

  public getActiveStatusSnapshots(): ActiveStatusSnapshot[] {
    const out: ActiveStatusSnapshot[] = [];
    for (const [id, remainingSec] of this.activeStatuses) {
      out.push({ id, remainingSec, durationSec: STATUS_DEFAULT_DURATIONS[id] });
    }
    return out;
  }

  public getHudSnapshot(): EnemyHudSnapshot {
    return {
      id: this.id,
      name: this.config.name,
      tier: this.config.tier,
      hp: this.hp,
      maxHp: this.config.maxHp,
      guard: Math.round(this.guard),
      maxGuard: this.config.maxGuard,
      isStaggered: this.isStaggered,
      isTelegraphing: this.isTelegraphing,
      bossPhase: this.bossPhase,
      statuses: this.getActiveStatusSnapshots(),
    };
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

  public applyKnockback(dirX: number, dirZ: number, force: number): void {
    if (!this.isAlive) return;
    const resist = this.guard > 0 ? 0.25 : this.config.tier === 'BOSS' ? 0.45 : 1.0;
    this.knockVelX += dirX * force * resist;
    this.knockVelZ += dirZ * force * resist;
  }

  public applyDamage(
    damage: number,
    guardDamage: number,
    hitFromX: number,
    hitFromZ: number,
    knockbackForce = 4.0
  ): EnemyHitResult {
    if (!this.isAlive) return { killed: false, guardBroken: false };

    this.hp = Math.max(0, this.hp - Math.max(1, Math.floor(damage)));
    this.hitFlashTimer = 0.11;

    const dx = this.root.position.x - hitFromX;
    const dz = this.root.position.z - hitFromZ;
    const len = Math.hypot(dx, dz);
    const nx = len > 0.001 ? dx / len : 0;
    const nz = len > 0.001 ? dz / len : -1;
    this.applyKnockback(nx, nz, knockbackForce);

    let guardBroken = false;
    if (this.config.maxGuard > 0 && this.guard > 0 && this.aiState !== 'STAGGERED') {
      this.guard = Math.max(0, this.guard - Math.max(0, guardDamage));
      if (this.guard === 0) {
        guardBroken = true;
        this.enterStaggered();
      }
    }

    if (this.hp === 0) {
      this.enterDead();
      return { killed: true, guardBroken };
    }

    // Super Armor: Enemies with active Guard > 0 do not flinch into HITSTUN
    if (
      !guardBroken &&
      this.guard <= 0 &&
      this.aiState !== 'STAGGERED' &&
      this.aiState !== 'ATTACK_ACTIVE'
    ) {
      if (this.config.tier === 'MINION') {
        this.aiState = 'HITSTUN';
        this.stateTimer = 0;
        this.hideTelegraph();
      }
    }

    return { killed: false, guardBroken };
  }

  public fixedUpdate(
    dt: number,
    player: HurtboxTarget,
    siblings: readonly EnemyBase[],
    freezeAI = false
  ): EnemyFixedUpdateEvents {
    this.events.startedTelegraph = false;
    this.events.hitPlayerDamage = 0;
    this.events.hitPlayerHeavy = false;
    this.events.burnTickDamage = 0;
    this.events.microExplosionDamage = 0;
    this.events.enteredPhase2 = false;
    this.events.fireProjectileSpread = false;
    this.events.diedThisFrame = false;

    this.stateTimer += dt;
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

    if (this.aiState === 'DEAD') {
      if (this.stateTimer >= DEATH_ANIM_DURATION_SEC) {
        this.readyForDisposal = true;
      }
      return this.events;
    }

    // Decay knockback & clamp inside octagonal arena
    if (Math.abs(this.knockVelX) > 0.05 || Math.abs(this.knockVelZ) > 0.05) {
      this.root.position.x += this.knockVelX * dt;
      this.root.position.z += this.knockVelZ * dt;
      const damp = Math.exp(-9 * dt);
      this.knockVelX *= damp;
      this.knockVelZ *= damp;
      this.clampToArena();
    }

    if (freezeAI) {
      return this.events;
    }

    // Tick Elemental Statuses & BURN DoT
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
        const res = this.applyDamage(BURN_TICK_DAMAGE, 4, this.root.position.x, this.root.position.z, 0.5);
        this.events.burnTickDamage = BURN_TICK_DAMAGE;
        if (res.killed) {
          this.events.diedThisFrame = true;
          return this.events;
        }
      }
    }

    if (this.pendingMicroExplosions > 0) {
      this.microExplosionTimer -= dt;
      if (this.microExplosionTimer <= 0) {
        this.pendingMicroExplosions--;
        this.microExplosionTimer = 0.14;
        const dmg = Math.max(1, Math.floor(this.microExplosionDamagePerBlast));
        const res = this.applyDamage(dmg, dmg * 0.4, this.root.position.x, this.root.position.z, 2.0);
        this.events.microExplosionDamage = dmg;
        if (res.killed) {
          this.events.diedThisFrame = true;
          return this.events;
        }
      }
    }

    // Hook for Boss Phase 2 transition
    this.onBeforeAIStep(dt);

    // Soft separation from other alive enemies so swarms fan out organically
    this.applySiblingSeparation(dt, siblings);

    player.getPosition(this.scratchPlayerPos);
    const toPlayerX = this.scratchPlayerPos.x - this.root.position.x;
    const toPlayerZ = this.scratchPlayerPos.z - this.root.position.z;
    const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);

    const wetScale = this.activeStatuses.has('WET') ? 0.6 : 1.0;
    const rootScale = this.activeStatuses.has('ROOT') ? 0.15 : 1.0;
    const moveStatusScale = Math.min(wetScale, rootScale);

    if (this.aiState === 'STAGGERED') {
      if (this.stateTimer >= STAGGER_DURATION_SEC) {
        this.guard = this.config.maxGuard;
        this.aiState = 'CHASE';
        this.stateTimer = 0;
        this.attackCooldown = 1.0;
      }
      return this.events;
    }

    if (this.aiState === 'HITSTUN') {
      if (this.stateTimer >= HITSTUN_DURATION_SEC) {
        this.aiState = 'CHASE';
        this.stateTimer = 0;
      }
      return this.events;
    }

    if (this.aiState === 'CHASE') {
      this.attackCooldown = Math.max(0, this.attackCooldown - dt * wetScale);
      if (distToPlayer > 0.05) {
        this.root.rotation.y = Math.atan2(toPlayerX, toPlayerZ);
      }

      if (this.shouldStartAttack(distToPlayer)) {
        this.beginConfiguredAttack(distToPlayer);
        this.events.startedTelegraph = true;
      } else if (distToPlayer > this.radius + 1.05) {
        const speed = this.config.moveSpeed * moveStatusScale * (this.bossPhase === 2 ? 1.2 : 1.0);
        const inv = 1 / Math.max(0.001, distToPlayer);
        this.root.position.x += toPlayerX * inv * speed * dt;
        this.root.position.z += toPlayerZ * inv * speed * dt;
        this.clampToArena();
      }
    } else if (this.aiState === 'TELEGRAPH') {
      if (distToPlayer > 0.1 && this.stateTimer < this.currentTelegraphDuration * 0.65) {
        this.root.rotation.y = Math.atan2(toPlayerX, toPlayerZ);
      }
      this.onTelegraphTick(dt, toPlayerX, toPlayerZ, distToPlayer);

      if (this.stateTimer >= this.currentTelegraphDuration) {
        this.aiState = 'ATTACK_ACTIVE';
        this.stateTimer = 0;
        this.attackSwingId++;
        this.attackHitbox.beginSwing(this.attackSwingId);
        this.telegraphBorderMesh.visible = false;
        this.telegraphFillMesh.visible = false;
        this.onAttackActivated();
      }
    } else if (this.aiState === 'ATTACK_ACTIVE') {
      this.evaluateActiveAttackHitbox(player);
      if (this.stateTimer >= 0.16) {
        this.aiState = 'RECOVERY';
        this.stateTimer = 0;
        this.attackHitbox.endSwing();
      }
    } else if (this.aiState === 'RECOVERY') {
      const recoveryDur = this.config.tier === 'BOSS' ? (this.bossPhase === 2 ? 0.62 : 0.85) : 0.95;
      if (this.stateTimer >= recoveryDur) {
        this.aiState = 'CHASE';
        this.stateTimer = 0;
        this.attackCooldown =
          this.config.tier === 'BOSS'
            ? this.bossPhase === 2
              ? 0.9
              : 1.45
            : this.config.tier === 'ELITE'
              ? 1.85
              : 1.4 + Math.random() * 0.6;
        this.shockwaveMesh.visible = false;
      }
    }

    return this.events;
  }

  public updateVisuals(renderDt: number, camera: THREE.Camera): void {
    this.animTime += renderDt;

    const usesSkeletalDriver = this.skeletalAnimator.hasClipForState(this.aiState) || this.boneDriver.isActive;
    if (this.skeletalAnimator.hasClipForState(this.aiState)) {
      const loopAnim =
        this.aiState === 'CHASE' ||
        this.aiState === 'STAGGERED' ||
        this.aiState === 'RECOVERY' ||
        this.aiState === 'TELEGRAPH';
      this.skeletalAnimator.playState(this.aiState, { loop: loopAnim });
      this.skeletalAnimator.update(renderDt);
    } else if (this.boneDriver.isActive) {
      this.skeletalAnimator.pauseForProceduralBlend();
      this.boneDriver.applyKaijinPose(
        this.aiState,
        this.stateTimer,
        this.currentTelegraphDuration,
        this.animTime,
        renderDt
      );
    } else {
      this.visualPivot.position.set(0, 0, 0);
      this.visualPivot.rotation.set(0, 0, 0);
    }

    if (this.aiState === 'DEAD') {
      if (!usesSkeletalDriver) {
        const t = Math.min(1, this.stateTimer / DEATH_ANIM_DURATION_SEC);
        const s = Math.max(0.05, 1 - t) * this.baseVisualScale;
        this.visualPivot.scale.set(s, s * 0.45, s);
        this.visualPivot.rotation.x = t * 1.1;
      }
      this.lockOnReticle.visible = false;
      this.statusAuraRing.visible = false;
      this.guardShieldRing.visible = false;
      this.phase2HaloMesh.visible = false;
      this.hideTelegraph();
      return;
    }

    // Guard ring & Phase 2 halo animations
    this.guardShieldRing.visible = this.guard > 0 && !this.isStaggered;
    if (this.guardShieldRing.visible) {
      this.guardShieldRing.rotation.z = this.animTime * 1.6;
    }

    this.phase2HaloMesh.visible = this.bossPhase === 2;
    if (this.phase2HaloMesh.visible) {
      this.phase2HaloMesh.rotation.z = this.animTime * 2.5;
      this.phase2HaloMesh.scale.setScalar(1 + Math.sin(this.animTime * 7) * 0.08);
    }

    // Elemental status aura ring
    const firstStatus = this.activeStatuses.keys().next().value as StatusEffectId | undefined;
    if (firstStatus) {
      this.statusAuraRing.visible = true;
      this.statusAuraMat.color.setHex(STATUS_AURA_COLORS[firstStatus]);
      this.statusAuraRing.scale.setScalar(1 + Math.sin(this.animTime * 8) * 0.1);
    } else {
      this.statusAuraRing.visible = false;
    }

    // Body pose & material feedback per AI state (supports both procedural PBR & external UV-textured rigs)
    if (this.hitFlashTimer > 0) {
      this.bodyMat.color.setHex(0xffffff);
      this.bodyMat.emissive.setHex(0xffffff);
      this.bodyMat.emissiveIntensity = 0.65;
      this.eyeMat.emissiveIntensity = 3.2;
      for (let i = 0; i < this.externalMaterials.length; i++) {
        const m = this.externalMaterials[i]!;
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.36;
      }
      if (!usesSkeletalDriver && this.aiState === 'HITSTUN') {
        this.visualPivot.rotation.x = -0.32;
        this.visualPivot.rotation.z = 0.12;
      }
    } else if (this.aiState === 'STAGGERED') {
      const blink = 0.5 + 0.5 * Math.sin(this.animTime * 16);
      this.bodyMat.color.setHex(blink > 0.5 ? 0xfacc15 : 0x64748b);
      this.bodyMat.emissive.setHex(0xf59e0b);
      this.bodyMat.emissiveIntensity = blink > 0.5 ? 0.35 : 0;
      for (let i = 0; i < this.externalMaterials.length; i++) {
        const m = this.externalMaterials[i]!;
        m.emissive.setHex(0xf59e0b);
        m.emissiveIntensity = blink > 0.5 ? 0.28 : 0;
      }
      if (!usesSkeletalDriver) {
        this.visualPivot.rotation.x = 0.34;
        this.visualPivot.rotation.z = Math.sin(this.animTime * 6) * 0.1;
        this.visualPivot.position.y = -0.16;
      }
    } else if (this.aiState === 'TELEGRAPH') {
      const t = Math.min(1, this.stateTimer / this.currentTelegraphDuration);
      const flash = 0.5 + 0.5 * Math.sin(this.stateTimer * 38);
      this.bodyMat.color.set(this.bossPhase === 2 ? '#b91c1c' : this.config.color);
      this.bodyMat.emissive.setHex(0xef4444);
      this.bodyMat.emissiveIntensity = 0.25 + flash * 0.55;
      this.eyeMat.emissiveIntensity = 3.0 + flash * 1.2;
      for (let i = 0; i < this.externalMaterials.length; i++) {
        const m = this.externalMaterials[i]!;
        m.emissive.setHex(0xef4444);
        m.emissiveIntensity = 0.16 + flash * 0.36;
      }
      if (!usesSkeletalDriver) {
        this.visualPivot.rotation.x = -0.26 * t;
        this.visualPivot.rotation.y = -0.32 * t;
        this.visualPivot.position.y = Math.sin(t * Math.PI) * 0.24;
      }

      this.telegraphBorderMesh.visible = true;
      this.telegraphBorderMesh.scale.setScalar(this.activeAttackRadius);
      this.telegraphFillMesh.visible = true;
      this.telegraphFillMesh.scale.setScalar(Math.max(0.05, t) * this.activeAttackRadius);
      this.telegraphFillMat.opacity = 0.16 + t * 0.38;
    } else {
      this.bodyMat.color.set(this.bossPhase === 2 ? '#991b1b' : this.config.color);
      this.bodyMat.emissive.setHex(this.bossPhase === 2 ? 0x7f1d1d : 0x000000);
      this.bodyMat.emissiveIntensity = this.bossPhase === 2 ? 0.28 : 0;
      this.eyeMat.emissiveIntensity = this.bossPhase === 2 ? 2.6 : 1.85;
      for (let i = 0; i < this.externalMaterials.length; i++) {
        const m = this.externalMaterials[i]!;
        m.emissive.setHex(this.bossPhase === 2 ? 0x7f1d1d : 0x000000);
        m.emissiveIntensity = this.bossPhase === 2 ? 0.16 : 0;
      }
      if (!usesSkeletalDriver) {
        if (this.aiState === 'ATTACK_ACTIVE') {
          this.visualPivot.position.set(0, 0.08, 0.32);
          this.visualPivot.rotation.set(0.32, 0.44, 0);
        } else if (this.aiState === 'CHASE') {
          const freq = this.config.tier === 'BOSS' ? 6.5 : 9.2;
          this.visualPivot.position.y = Math.abs(Math.sin(this.animTime * freq)) * 0.09;
          this.visualPivot.rotation.x = 0.12;
          this.visualPivot.rotation.z = Math.sin(this.animTime * freq) * 0.07;
        } else if (this.aiState === 'HITSTUN') {
          this.visualPivot.rotation.x = -0.32;
        } else {
          this.visualPivot.position.y = Math.sin(this.animTime * 2.4) * 0.02;
          this.visualPivot.rotation.x = 0.05;
        }
      }
    }

    // Active attack shockwave burst
    if (this.aiState === 'ATTACK_ACTIVE' || (this.aiState === 'RECOVERY' && this.stateTimer < 0.22)) {
      const elapsed = this.aiState === 'ATTACK_ACTIVE' ? this.stateTimer : 0.16 + this.stateTimer;
      const t = Math.min(1, elapsed / 0.38);
      this.shockwaveMesh.visible = true;
      this.shockwaveMesh.scale.setScalar(0.5 + t * this.activeAttackRadius);
      this.shockwaveMat.opacity = (1 - t) * 0.9;
    } else {
      this.shockwaveMesh.visible = false;
    }

    // 3D Lock-On reticle billboard
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
    this.skeletalAnimator.dispose();
    // Dispose only entity-owned ring/reticle geometries & materials; preserve shared cached .glb geometries!
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (obj.geometry && !obj.geometry.userData.sharedAssetGeometry) {
          obj.geometry.dispose();
        }
        if (!obj.userData.isOutlineMesh) {
          const mat = obj.material;
          if (Array.isArray(mat)) {
            for (let i = 0; i < mat.length; i++) {
              mat[i]?.dispose();
            }
          } else {
            mat.dispose();
          }
        }
      }
    });
    this.ownedMaterials.length = 0;
    this.externalMaterials.length = 0;
  }

  protected shouldStartAttack(distToPlayer: number): boolean {
    return this.attackCooldown <= 0 && distToPlayer <= this.attackRange;
  }

  protected beginConfiguredAttack(_distToPlayer: number): void {
    this.aiState = 'TELEGRAPH';
    this.stateTimer = 0;
    this.currentTelegraphDuration = Math.max(0.45, this.config.telegraphDurationSec);
    this.activeAttackRadius = this.config.tier === 'ELITE' ? 4.1 : 2.5;
    this.currentAttackHeavy = this.config.tier !== 'MINION';
  }

  protected onBeforeAIStep(_dt: number): void {
    // Overridden by BossKaijin for 2-phase transitions
  }

  protected onTelegraphTick(
    _dt: number,
    _toPlayerX: number,
    _toPlayerZ: number,
    _distToPlayer: number
  ): void {
    // Overridden by BossKaijin for Leap Slam lunge
  }

  protected onAttackActivated(): void {
    // Overridden by BossKaijin for Phase 2 projectiles
  }

  protected evaluateActiveAttackHitbox(player: HurtboxTarget): void {
    this.scratchSelfPos.x = this.root.position.x;
    this.scratchSelfPos.y = this.root.position.y + 1.0;
    this.scratchSelfPos.z = this.root.position.z;
    this.scratchTargets.length = 1;
    this.scratchTargets[0] = player;

    this.attackHitbox.checkSphere(
      this.scratchSelfPos,
      this.activeAttackRadius,
      this.scratchTargets,
      this.scratchHits
    );

    if (this.scratchHits.length > 0) {
      this.events.hitPlayerDamage = this.config.attackDamage;
      this.events.hitPlayerHeavy = this.currentAttackHeavy;
    }
  }

  protected enterStaggered(): void {
    this.aiState = 'STAGGERED';
    this.stateTimer = 0;
    this.attackHitbox.endSwing();
    this.hideTelegraph();
  }

  protected enterDead(): void {
    this.aiState = 'DEAD';
    this.stateTimer = 0;
    this.activeStatuses.clear();
    this.pendingMicroExplosions = 0;
    this.attackHitbox.endSwing();
    this.hideTelegraph();
  }

  protected hideTelegraph(): void {
    this.telegraphBorderMesh.visible = false;
    this.telegraphFillMesh.visible = false;
    this.shockwaveMesh.visible = false;
  }

  protected clampToArena(): void {
    const maxDist = ARENA_RADIUS - this.radius - 0.55;
    const dist = Math.hypot(this.root.position.x, this.root.position.z);
    if (dist > maxDist && dist > 0.001) {
      const s = maxDist / dist;
      this.root.position.x *= s;
      this.root.position.z *= s;
    }
  }

  private applySiblingSeparation(dt: number, siblings: readonly EnemyBase[]): void {
    let pushX = 0;
    let pushZ = 0;
    for (let i = 0; i < siblings.length; i++) {
      const other = siblings[i]!;
      if (other === this || !other.isAlive) continue;
      const dx = this.root.position.x - other.root.position.x;
      const dz = this.root.position.z - other.root.position.z;
      const minDist = this.radius + other.radius + 0.55;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const strength = (minDist - dist) / minDist;
        pushX += (dx / dist) * strength;
        pushZ += (dz / dist) * strength;
      }
    }
    if (pushX !== 0 || pushZ !== 0) {
      this.root.position.x += pushX * 3.8 * dt;
      this.root.position.z += pushZ * 3.8 * dt;
      this.clampToArena();
    }
  }
}

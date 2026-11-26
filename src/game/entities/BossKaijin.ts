import * as THREE from 'three';
import type { AssetLoader } from '../../engine/AssetLoader';
import type { PbrTextureSet } from '../../engine/PbrMaterialSystem';
import { ARENA_RADIUS } from '../../engine/PhysicsWorld';
import type { ElementId, EnemyConfig, HurtboxTarget, Vec3Snapshot } from '../types/schema';
import { EnemyBase } from './EnemyBase';

export type BossAttackPattern =
  | 'CLEAVE_2HIT'
  | 'LEAP_SLAM'
  | 'DARK_PROJECTILES'
  | 'FURY_3HIT'
  | 'MAGMA_FISSURES'
  | 'MOLTEN_RING'
  | 'BRIAR_SURGE'
  | 'SANCTUARY_MEND';

export interface BossSignatureProfile {
  phase1Patterns: readonly BossAttackPattern[];
  phase2FarPatterns: readonly BossAttackPattern[];
  phase2ClosePatterns: readonly BossAttackPattern[];
  projectileColorHex: number;
  projectileEmissiveHex: number;
  hazardColorHex: number;
  hazardElement: ElementId;
  phase2Title: string;
  phase2Subtitle: string;
  phase2BannerColor: string;
}

export const BOSS_SIGNATURE_PROFILES: Readonly<Record<string, BossSignatureProfile>> = {
  obsidian_kaijin: {
    phase1Patterns: ['CLEAVE_2HIT', 'LEAP_SLAM'],
    phase2FarPatterns: ['DARK_PROJECTILES', 'LEAP_SLAM', 'FURY_3HIT'],
    phase2ClosePatterns: ['FURY_3HIT', 'DARK_PROJECTILES', 'LEAP_SLAM'],
    projectileColorHex: 0xff2e63,
    projectileEmissiveHex: 0xf43f5e,
    hazardColorHex: 0xf43f5e,
    hazardElement: 'umbra',
    phase2Title: 'PHASE 2 — OBSIDIAN OVERDRIVE!',
    phase2Subtitle: 'DARK ENERGY UNLEASHED',
    phase2BannerColor: '#f43f5e',
  },
  magma_overlord: {
    phase1Patterns: ['MAGMA_FISSURES', 'LEAP_SLAM', 'CLEAVE_2HIT'],
    phase2FarPatterns: ['MAGMA_FISSURES', 'MOLTEN_RING', 'LEAP_SLAM'],
    phase2ClosePatterns: ['MOLTEN_RING', 'MAGMA_FISSURES', 'FURY_3HIT'],
    projectileColorHex: 0xff6b00,
    projectileEmissiveHex: 0xfb923c,
    hazardColorHex: 0xf97316,
    hazardElement: 'pyro',
    phase2Title: 'PHASE 2 — VOLCANIC CATACLYSM!',
    phase2Subtitle: 'LAVA FISSURES & MOLTEN SALVO',
    phase2BannerColor: '#f97316',
  },
  sylvan_sovereign: {
    phase1Patterns: ['BRIAR_SURGE', 'CLEAVE_2HIT', 'DARK_PROJECTILES'],
    phase2FarPatterns: ['BRIAR_SURGE', 'SANCTUARY_MEND', 'DARK_PROJECTILES'],
    phase2ClosePatterns: ['SANCTUARY_MEND', 'BRIAR_SURGE', 'FURY_3HIT'],
    projectileColorHex: 0x10b981,
    projectileEmissiveHex: 0x34d399,
    hazardColorHex: 0x10b981,
    hazardElement: 'flora',
    phase2Title: 'PHASE 2 — SYLVAN SOVEREIGNTY!',
    phase2Subtitle: 'BRIAR SURGE & SANCTUARY MEND',
    phase2BannerColor: '#10b981',
  },
};

export function getBossSignatureProfile(bossId: string): BossSignatureProfile {
  return BOSS_SIGNATURE_PROFILES[bossId] ?? BOSS_SIGNATURE_PROFILES.obsidian_kaijin!;
}

interface PooledProjectile {
  active: boolean;
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  age: number;
  damage: number;
}

interface PooledHazardZone {
  phase: 'IDLE' | 'TELEGRAPH' | 'ERUPTING';
  root: THREE.Group;
  borderMesh: THREE.Mesh;
  fillMesh: THREE.Mesh;
  pillarMesh: THREE.Mesh;
  borderMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  pillarMat: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  radius: number;
  timer: number;
  telegraphDuration: number;
  eruptionDuration: number;
  damage: number;
  isHeavy: boolean;
  hitPlayer: boolean;
}

export interface BossProjectileHitResult {
  damage: number;
  dirX: number;
  dirZ: number;
}

export interface BossHazardStepResult {
  damage: number;
  dirX: number;
  dirZ: number;
  isHeavy: boolean;
  eruptedCount: number;
  lastEruptX: number;
  lastEruptZ: number;
  healedBossAmount: number;
  channelInterrupted: boolean;
}

const MAX_BOSS_PROJECTILES = 14;
const MAX_BOSS_HAZARDS = 6;
const PROJECTILE_SPEED = 11.8;
const PROJECTILE_LIFETIME = 2.6;
const PROJECTILE_RADIUS = 0.48;
const HAZARD_ERUPTION_DURATION = 0.5;

/**
 * Tier 4 Stage Boss Entity supporting Sector 01 Obsidian Kaijin,
 * Sector 02 Magma Overlord (Volcanic Lava Fissures & Molten Ring),
 * and Sector 03 Sylvan Sovereign (Briar Surge Waves & Interruptible Sanctuary Mend).
 * Strictly enforces >= 0.45s telegraphs, zero-allocation hot paths, and clean dispose().
 */
export class BossKaijin extends EnemyBase {
  public readonly projectileGroup = new THREE.Group();
  public readonly hazardGroup = new THREE.Group();

  private readonly profile: BossSignatureProfile;
  private patternIndex = 0;
  private activePattern: BossAttackPattern = 'CLEAVE_2HIT';
  private pendingBossHealAmount = 0;
  private pendingChannelInterrupted = false;

  private readonly projectiles: PooledProjectile[] = [];
  private readonly projectileGeo: THREE.OctahedronGeometry;
  private readonly projectileMat: THREE.MeshStandardMaterial;

  private readonly hazards: PooledHazardZone[] = [];
  private readonly hazardBorderGeo: THREE.RingGeometry;
  private readonly hazardFillGeo: THREE.CircleGeometry;
  private readonly hazardPillarGeo: THREE.CylinderGeometry;

  // Reusable scratch objects (Zero-Allocation Hot Path)
  private readonly scratchProjPlayerPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  private readonly scratchProjectileResult: BossProjectileHitResult = {
    damage: 0,
    dirX: 0,
    dirZ: 1,
  };
  private readonly scratchHazardResult: BossHazardStepResult = {
    damage: 0,
    dirX: 0,
    dirZ: 1,
    isHeavy: true,
    eruptedCount: 0,
    lastEruptX: 0,
    lastEruptZ: 0,
    healedBossAmount: 0,
    channelInterrupted: false,
  };

  constructor(
    id: string,
    config: EnemyConfig,
    assetLoader: AssetLoader,
    pbrTextures: PbrTextureSet,
    spawnX: number,
    spawnZ: number
  ) {
    super(id, config, assetLoader, pbrTextures, spawnX, spawnZ);
    this.profile = getBossSignatureProfile(config.id);

    this.projectileGeo = new THREE.OctahedronGeometry(0.36, 1);
    this.projectileMat = new THREE.MeshStandardMaterial({
      color: this.profile.projectileColorHex,
      emissive: this.profile.projectileEmissiveHex,
      emissiveIntensity: 3.1,
      roughness: 0.2,
    });

    for (let i = 0; i < MAX_BOSS_PROJECTILES; i++) {
      const mesh = new THREE.Mesh(this.projectileGeo, this.projectileMat);
      mesh.visible = false;
      this.projectileGroup.add(mesh);
      this.projectiles.push({
        active: false,
        mesh,
        x: 0,
        y: 1.2,
        z: 0,
        vx: 0,
        vz: 0,
        age: 0,
        damage: Math.round(config.attackDamage * 0.72),
      });
    }

    // Pooled 3D Floor Hazard Zones (Volcanic Magma Fissures / Sylvan Briar Spires)
    this.hazardBorderGeo = new THREE.RingGeometry(0.86, 1.0, 28);
    this.hazardFillGeo = new THREE.CircleGeometry(1.0, 28);
    const isBriar = config.id === 'sylvan_sovereign';
    this.hazardPillarGeo = isBriar
      ? new THREE.CylinderGeometry(0.06, 0.72, 3.8, 7, 1)
      : new THREE.CylinderGeometry(0.56, 0.85, 4.4, 14, 1);

    for (let i = 0; i < MAX_BOSS_HAZARDS; i++) {
      const zoneRoot = new THREE.Group();
      zoneRoot.visible = false;

      const borderMat = new THREE.MeshBasicMaterial({
        color: this.profile.hazardColorHex,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const borderMesh = new THREE.Mesh(this.hazardBorderGeo, borderMat);
      borderMesh.rotation.x = -Math.PI / 2;
      borderMesh.position.y = 0.055;

      const fillMat = new THREE.MeshBasicMaterial({
        color: this.profile.hazardColorHex,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const fillMesh = new THREE.Mesh(this.hazardFillGeo, fillMat);
      fillMesh.rotation.x = -Math.PI / 2;
      fillMesh.position.y = 0.045;

      const pillarMat = new THREE.MeshBasicMaterial({
        color: isBriar ? 0x34d399 : 0xffa726,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const pillarMesh = new THREE.Mesh(this.hazardPillarGeo, pillarMat);
      pillarMesh.position.y = isBriar ? 1.85 : 2.15;
      pillarMesh.visible = false;

      zoneRoot.add(borderMesh, fillMesh, pillarMesh);
      this.hazardGroup.add(zoneRoot);

      this.hazards.push({
        phase: 'IDLE',
        root: zoneRoot,
        borderMesh,
        fillMesh,
        pillarMesh,
        borderMat,
        fillMat,
        pillarMat,
        x: 0,
        z: 0,
        radius: 2.2,
        timer: 0,
        telegraphDuration: 0.85,
        eruptionDuration: HAZARD_ERUPTION_DURATION,
        damage: Math.round(config.attackDamage * 0.92),
        isHeavy: true,
        hitPlayer: false,
      });
    }
  }

  public get signatureProfile(): BossSignatureProfile {
    return this.profile;
  }

  public get currentBossPattern(): BossAttackPattern {
    return this.activePattern;
  }

  /**
   * Advances pooled Boss projectiles and tests collision against the Rider (Zero-Allocation).
   */
  public stepProjectiles(dt: number, player: HurtboxTarget): BossProjectileHitResult {
    player.getPosition(this.scratchProjPlayerPos);
    this.scratchProjectileResult.damage = 0;
    this.scratchProjectileResult.dirX = 0;
    this.scratchProjectileResult.dirZ = 1;

    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i]!;
      if (!p.active) continue;

      p.age += dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.y += dt * 7;
      p.mesh.rotation.x += dt * 5;

      const radial = Math.hypot(p.x, p.z);
      if (p.age >= PROJECTILE_LIFETIME || radial > ARENA_RADIUS + 1.5) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }

      const dx = this.scratchProjPlayerPos.x - p.x;
      const dz = this.scratchProjPlayerPos.z - p.z;
      const hitDist = PROJECTILE_RADIUS + player.radius;
      if (dx * dx + dz * dz <= hitDist * hitDist) {
        p.active = false;
        p.mesh.visible = false;
        const speed = Math.hypot(p.vx, p.vz) || 1;
        this.scratchProjectileResult.damage = p.damage;
        this.scratchProjectileResult.dirX = p.vx / speed;
        this.scratchProjectileResult.dirZ = p.vz / speed;
      }
    }

    return this.scratchProjectileResult;
  }

  /**
   * Advances pooled Boss floor hazard zones (Magma Fissures / Briar Spires) & Sanctuary Mend events (Zero-Allocation).
   */
  public stepHazards(dt: number, player: HurtboxTarget): BossHazardStepResult {
    player.getPosition(this.scratchProjPlayerPos);
    const out = this.scratchHazardResult;
    out.damage = 0;
    out.dirX = 0;
    out.dirZ = 1;
    out.isHeavy = true;
    out.eruptedCount = 0;
    out.lastEruptX = 0;
    out.lastEruptZ = 0;
    out.healedBossAmount = this.pendingBossHealAmount;
    out.channelInterrupted = this.pendingChannelInterrupted;
    this.pendingBossHealAmount = 0;
    this.pendingChannelInterrupted = false;

    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i]!;
      if (h.phase === 'IDLE') continue;

      h.timer += dt;
      if (h.phase === 'TELEGRAPH') {
        const frac = Math.min(1, h.timer / Math.max(0.45, h.telegraphDuration));
        h.fillMesh.scale.setScalar(Math.max(0.06, frac) * h.radius);
        h.fillMat.opacity = 0.16 + frac * 0.44;
        h.borderMat.opacity = 0.55 + Math.sin(h.timer * 24) * 0.35;

        if (h.timer >= h.telegraphDuration) {
          h.phase = 'ERUPTING';
          h.timer = 0;
          h.hitPlayer = false;
          h.pillarMesh.visible = true;
          h.pillarMesh.scale.set(h.radius * 0.58, 0.25, h.radius * 0.58);
          h.pillarMat.opacity = 0.92;
          out.eruptedCount++;
          out.lastEruptX = h.x;
          out.lastEruptZ = h.z;
        }
      } else if (h.phase === 'ERUPTING') {
        const frac = Math.min(1, h.timer / h.eruptionDuration);
        const rise = frac < 0.25 ? frac / 0.25 : 1 - (frac - 0.25) / 0.75;
        h.pillarMesh.scale.set(
          h.radius * (0.58 + frac * 0.24),
          Math.max(0.08, rise * 1.25),
          h.radius * (0.58 + frac * 0.24)
        );
        h.pillarMat.opacity = Math.max(0, (1 - frac) * 0.95);
        h.borderMat.opacity = Math.max(0, (1 - frac) * 0.7);
        h.fillMat.opacity = Math.max(0, (1 - frac) * 0.4);

        // Active damage window during early peak eruption (respects Perfect Dodge!)
        if (!h.hitPlayer && frac <= 0.42) {
          const dx = this.scratchProjPlayerPos.x - h.x;
          const dz = this.scratchProjPlayerPos.z - h.z;
          const hitDist = h.radius + player.radius * 0.65;
          if (dx * dx + dz * dz <= hitDist * hitDist) {
            h.hitPlayer = true;
            const len = Math.hypot(dx, dz) || 1;
            out.damage = h.damage;
            out.dirX = dx / len;
            out.dirZ = dz / len;
            out.isHeavy = h.isHeavy;
          }
        }

        if (h.timer >= h.eruptionDuration) {
          h.phase = 'IDLE';
          h.root.visible = false;
          h.pillarMesh.visible = false;
        }
      }
    }

    return out;
  }

  public clearProjectiles(): void {
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i]!;
      p.active = false;
      p.mesh.visible = false;
    }
  }

  public clearHazards(): void {
    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i]!;
      h.phase = 'IDLE';
      h.root.visible = false;
      h.pillarMesh.visible = false;
    }
  }

  public override dispose(): void {
    this.clearProjectiles();
    this.clearHazards();
    this.projectileGeo.dispose();
    this.projectileMat.dispose();
    this.hazardBorderGeo.dispose();
    this.hazardFillGeo.dispose();
    this.hazardPillarGeo.dispose();
    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i]!;
      h.borderMat.dispose();
      h.fillMat.dispose();
      h.pillarMat.dispose();
    }
    super.dispose();
  }

  protected override onBeforeAIStep(_dt: number): void {
    if (this.bossPhase === 1 && this.hp > 0 && this.hp < this.config.maxHp * 0.5) {
      this.bossPhase = 2;
      this.guard = Math.min(this.config.maxGuard, this.guard + Math.round(this.config.maxGuard * 0.4));
      this.events.enteredPhase2 = true;
    }
  }

  protected override onStaggerEntered(): void {
    if (this.activePattern === 'SANCTUARY_MEND') {
      this.pendingChannelInterrupted = true;
    }
    this.clearHazards();
  }

  protected override shouldStartAttack(distToPlayer: number): boolean {
    if (this.attackCooldown > 0) return false;
    const isHazardBoss =
      this.config.id === 'magma_overlord' || this.config.id === 'sylvan_sovereign';
    const maxEngageDist = this.bossPhase === 2 ? 10.5 : isHazardBoss ? 8.2 : 5.4;
    return distToPlayer <= maxEngageDist;
  }

  protected override beginConfiguredAttack(distToPlayer: number): void {
    this.aiState = 'TELEGRAPH';
    this.stateTimer = 0;

    const patterns =
      this.bossPhase === 1
        ? this.profile.phase1Patterns
        : distToPlayer > 5.5
          ? this.profile.phase2FarPatterns
          : this.profile.phase2ClosePatterns;
    this.activePattern = patterns[this.patternIndex % patterns.length]!;
    this.patternIndex++;

    // Restore standard crimson telegraph color unless channeling Sanctuary Mend
    this.telegraphFillMat.color.setHex(
      this.activePattern === 'SANCTUARY_MEND'
        ? 0x10b981
        : this.activePattern === 'MAGMA_FISSURES' || this.activePattern === 'MOLTEN_RING'
          ? 0xf97316
          : 0xef4444
    );

    if (this.activePattern === 'LEAP_SLAM') {
      this.currentTelegraphDuration = this.bossPhase === 2 ? 0.62 : 0.72;
      this.activeAttackRadius = 5.4;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'DARK_PROJECTILES') {
      this.currentTelegraphDuration = 0.6;
      this.activeAttackRadius = 2.8;
      this.currentAttackHeavy = false;
    } else if (this.activePattern === 'MOLTEN_RING') {
      this.currentTelegraphDuration = 0.68;
      this.activeAttackRadius = 3.4;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'MAGMA_FISSURES') {
      this.currentTelegraphDuration = 0.65;
      this.activeAttackRadius = 3.6;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'BRIAR_SURGE') {
      this.currentTelegraphDuration = 0.62;
      this.activeAttackRadius = 3.4;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'SANCTUARY_MEND') {
      this.currentTelegraphDuration = 1.45;
      this.activeAttackRadius = 5.2;
      this.currentAttackHeavy = false;
    } else if (this.activePattern === 'FURY_3HIT') {
      this.currentTelegraphDuration = 0.52;
      this.activeAttackRadius = 4.6;
      this.currentAttackHeavy = true;
    } else {
      this.currentTelegraphDuration = 0.58;
      this.activeAttackRadius = 4.3;
      this.currentAttackHeavy = true;
    }
  }

  protected override onTelegraphTick(
    dt: number,
    toPlayerX: number,
    toPlayerZ: number,
    distToPlayer: number
  ): void {
    if (this.activePattern === 'LEAP_SLAM' && distToPlayer > 2.2) {
      const inv = 1 / distToPlayer;
      const leapSpeed = this.bossPhase === 2 ? 7.4 : 6.0;
      this.root.position.x += toPlayerX * inv * leapSpeed * dt;
      this.root.position.z += toPlayerZ * inv * leapSpeed * dt;
      this.clampToArena();
    }
  }

  protected override onAttackActivated(): void {
    if (this.activePattern === 'DARK_PROJECTILES') {
      const angles =
        this.config.id === 'sylvan_sovereign' && this.bossPhase === 2
          ? [-0.5, -0.25, 0, 0.25, 0.5]
          : [-0.36, 0, 0.36];
      this.spawnProjectileSpread(angles);
      this.events.fireProjectileSpread = true;
    } else if (this.activePattern === 'MOLTEN_RING') {
      this.spawnProjectileSpread([-0.6, -0.3, 0, 0.3, 0.6]);
      this.events.fireProjectileSpread = true;
    } else if (this.activePattern === 'MAGMA_FISSURES') {
      this.spawnMagmaFissures();
    } else if (this.activePattern === 'BRIAR_SURGE') {
      this.spawnBriarSurge();
    } else if (this.activePattern === 'SANCTUARY_MEND') {
      // Uninterrupted Sanctuary Mend heals 8% HP and restores 15% Guard!
      const healed = this.healHp(Math.round(this.config.maxHp * 0.08));
      this.guard = Math.min(
        this.config.maxGuard,
        this.guard + Math.round(this.config.maxGuard * 0.15)
      );
      this.pendingBossHealAmount = healed;
    }
  }

  private spawnProjectileSpread(spreadAngles: readonly number[]): void {
    const baseYaw = this.root.rotation.y;
    for (let a = 0; a < spreadAngles.length; a++) {
      let slot: PooledProjectile | null = null;
      for (let i = 0; i < this.projectiles.length; i++) {
        if (!this.projectiles[i]!.active) {
          slot = this.projectiles[i]!;
          break;
        }
      }
      if (!slot) break;
      const angle = baseYaw + spreadAngles[a]!;
      slot.active = true;
      slot.age = 0;
      slot.x = this.root.position.x + Math.sin(angle) * 1.15;
      slot.y = 1.25;
      slot.z = this.root.position.z + Math.cos(angle) * 1.15;
      slot.vx = Math.sin(angle) * PROJECTILE_SPEED;
      slot.vz = Math.cos(angle) * PROJECTILE_SPEED;
      slot.mesh.position.set(slot.x, slot.y, slot.z);
      slot.mesh.visible = true;
    }
  }

  private spawnHazardZone(
    x: number,
    z: number,
    radius: number,
    telegraphDuration: number,
    damageMultiplier: number
  ): void {
    let slot: PooledHazardZone | null = null;
    for (let i = 0; i < this.hazards.length; i++) {
      if (this.hazards[i]!.phase === 'IDLE') {
        slot = this.hazards[i]!;
        break;
      }
    }
    if (!slot) return;

    const maxR = ARENA_RADIUS - radius - 0.5;
    const radial = Math.hypot(x, z);
    let clampedX = x;
    let clampedZ = z;
    if (radial > maxR && radial > 0.001) {
      const s = maxR / radial;
      clampedX *= s;
      clampedZ *= s;
    }

    slot.phase = 'TELEGRAPH';
    slot.x = clampedX;
    slot.z = clampedZ;
    slot.radius = radius;
    slot.timer = 0;
    slot.telegraphDuration = Math.max(0.55, telegraphDuration);
    slot.eruptionDuration = HAZARD_ERUPTION_DURATION;
    slot.damage = Math.round(this.config.attackDamage * damageMultiplier);
    slot.isHeavy = true;
    slot.hitPlayer = false;

    slot.root.position.set(clampedX, 0, clampedZ);
    slot.root.visible = true;
    slot.borderMesh.scale.setScalar(radius);
    slot.fillMesh.scale.setScalar(0.1 * radius);
    slot.pillarMesh.visible = false;
  }

  private spawnMagmaFissures(): void {
    // Target Rider's live position + surrounding volcanic fissure ring!
    const px = this.scratchPlayerPos.x;
    const pz = this.scratchPlayerPos.z;
    const count = this.bossPhase === 2 ? 4 : 3;
    this.spawnHazardZone(px, pz, 2.35, 0.88, 0.95);
    const orbitR = 3.85;
    const baseAngle = this.root.rotation.y + 0.4;
    for (let i = 1; i < count; i++) {
      const ang = baseAngle + ((i - 1) * Math.PI * 2) / Math.max(1, count - 1);
      this.spawnHazardZone(
        px + Math.sin(ang) * orbitR,
        pz + Math.cos(ang) * orbitR,
        2.2,
        0.92 + i * 0.08,
        0.88
      );
    }
  }

  private spawnBriarSurge(): void {
    // Sweeping domino line of erupting emerald briar spires from Boss toward Rider!
    const dx = this.scratchPlayerPos.x - this.root.position.x;
    const dz = this.scratchPlayerPos.z - this.root.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const count = this.bossPhase === 2 ? 5 : 4;

    for (let i = 0; i < count; i++) {
      const stepDist = 2.6 + i * 2.55;
      const hx = this.root.position.x + dirX * stepDist;
      const hz = this.root.position.z + dirZ * stepDist;
      this.spawnHazardZone(hx, hz, 2.05, 0.78 + i * 0.14, 0.85);
    }
  }
}

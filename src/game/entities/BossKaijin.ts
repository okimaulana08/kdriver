import * as THREE from 'three';
import type { AssetLoader } from '../../engine/AssetLoader';
import type { PbrTextureSet } from '../../engine/PbrMaterialSystem';
import { ARENA_RADIUS } from '../../engine/PhysicsWorld';
import type { EnemyConfig, HurtboxTarget, Vec3Snapshot } from '../types/schema';
import { EnemyBase } from './EnemyBase';

type BossAttackPattern = 'CLEAVE_2HIT' | 'LEAP_SLAM' | 'DARK_PROJECTILES' | 'FURY_3HIT';

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

const MAX_BOSS_PROJECTILES = 12;
const PROJECTILE_SPEED = 11.5;
const PROJECTILE_LIFETIME = 2.6;
const PROJECTILE_RADIUS = 0.48;

/**
 * Tier 4 Stage Boss: Obsidian Kaijin.
 * Phase 1 (HP >= 50%): 2-hit cleave + area Leap Slam.
 * Phase 2 (HP < 50%): Crimson Overdrive eruption, 3-orb dark energy spread projectiles, and 3-hit fury combo.
 */
export class BossKaijin extends EnemyBase {
  public readonly projectileGroup = new THREE.Group();

  private patternIndex = 0;
  private activePattern: BossAttackPattern = 'CLEAVE_2HIT';
  private readonly projectiles: PooledProjectile[] = [];
  private readonly projectileGeo: THREE.OctahedronGeometry;
  private readonly projectileMat: THREE.MeshStandardMaterial;

  private readonly scratchProjPlayerPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };

  constructor(
    id: string,
    config: EnemyConfig,
    assetLoader: AssetLoader,
    pbrTextures: PbrTextureSet,
    spawnX: number,
    spawnZ: number
  ) {
    super(id, config, assetLoader, pbrTextures, spawnX, spawnZ);

    this.projectileGeo = new THREE.OctahedronGeometry(0.36, 1);
    this.projectileMat = new THREE.MeshStandardMaterial({
      color: 0xff2e63,
      emissive: 0xf43f5e,
      emissiveIntensity: 3.0,
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
  }

  /**
   * Advances pooled Phase 2 dark projectiles and tests collision against the Rider.
   * Returns hit damage (> 0) if an orb strikes the Rider this step.
   */
  public stepProjectiles(dt: number, player: HurtboxTarget): { damage: number; dirX: number; dirZ: number } {
    player.getPosition(this.scratchProjPlayerPos);
    let hitDamage = 0;
    let hitDirX = 0;
    let hitDirZ = 1;

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
        hitDamage = p.damage;
        hitDirX = p.vx / speed;
        hitDirZ = p.vz / speed;
      }
    }

    return { damage: hitDamage, dirX: hitDirX, dirZ: hitDirZ };
  }

  public clearProjectiles(): void {
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i]!;
      p.active = false;
      p.mesh.visible = false;
    }
  }

  public override dispose(): void {
    this.clearProjectiles();
    this.projectileGeo.dispose();
    this.projectileMat.dispose();
    super.dispose();
  }

  protected override onBeforeAIStep(_dt: number): void {
    if (this.bossPhase === 1 && this.hp > 0 && this.hp < this.config.maxHp * 0.5) {
      this.bossPhase = 2;
      this.guard = Math.min(this.config.maxGuard, this.guard + Math.round(this.config.maxGuard * 0.4));
      this.events.enteredPhase2 = true;
    }
  }

  protected override shouldStartAttack(distToPlayer: number): boolean {
    if (this.attackCooldown > 0) return false;
    // Phase 2 Boss can initiate ranged dark energy spread from further away
    const maxEngageDist = this.bossPhase === 2 ? 9.5 : 5.4;
    return distToPlayer <= maxEngageDist;
  }

  protected override beginConfiguredAttack(distToPlayer: number): void {
    this.aiState = 'TELEGRAPH';
    this.stateTimer = 0;

    if (this.bossPhase === 1) {
      const patterns: readonly BossAttackPattern[] = ['CLEAVE_2HIT', 'LEAP_SLAM'];
      this.activePattern = patterns[this.patternIndex % patterns.length]!;
    } else {
      const patterns: readonly BossAttackPattern[] =
        distToPlayer > 5.5
          ? ['DARK_PROJECTILES', 'LEAP_SLAM', 'FURY_3HIT']
          : ['FURY_3HIT', 'DARK_PROJECTILES', 'LEAP_SLAM'];
      this.activePattern = patterns[this.patternIndex % patterns.length]!;
    }
    this.patternIndex++;

    if (this.activePattern === 'LEAP_SLAM') {
      this.currentTelegraphDuration = this.bossPhase === 2 ? 0.62 : 0.72;
      this.activeAttackRadius = 5.4;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'DARK_PROJECTILES') {
      this.currentTelegraphDuration = 0.6;
      this.activeAttackRadius = 2.8;
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
      // Boss leaps aggressively toward player during Leap Slam telegraph
      const inv = 1 / distToPlayer;
      const leapSpeed = this.bossPhase === 2 ? 7.4 : 6.0;
      this.root.position.x += toPlayerX * inv * leapSpeed * dt;
      this.root.position.z += toPlayerZ * inv * leapSpeed * dt;
      this.clampToArena();
    }
  }

  protected override onAttackActivated(): void {
    if (this.activePattern === 'DARK_PROJECTILES') {
      this.spawnProjectileSpread();
      this.events.fireProjectileSpread = true;
    }
  }

  private spawnProjectileSpread(): void {
    const baseYaw = this.root.rotation.y;
    const spreadAngles = [-0.36, 0, 0.36];

    for (let a = 0; a < spreadAngles.length; a++) {
      const slot = this.projectiles.find((p) => !p.active);
      if (!slot) break;
      const angle = baseYaw + spreadAngles[a]!;
      slot.active = true;
      slot.age = 0;
      slot.x = this.root.position.x + Math.sin(angle) * 1.1;
      slot.y = 1.25;
      slot.z = this.root.position.z + Math.cos(angle) * 1.1;
      slot.vx = Math.sin(angle) * PROJECTILE_SPEED;
      slot.vz = Math.cos(angle) * PROJECTILE_SPEED;
      slot.mesh.position.set(slot.x, slot.y, slot.z);
      slot.mesh.visible = true;
    }
  }
}

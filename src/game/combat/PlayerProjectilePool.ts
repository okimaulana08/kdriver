import * as THREE from 'three';
import { ARENA_RADIUS } from '../../engine/PhysicsWorld';
import type { ElementId, HurtboxTarget, Vec3Snapshot } from '../types/schema';

const MAX_PLAYER_PROJECTILES = 36;
const PROJECTILE_LIFETIME_SEC = 1.45;
const PROJECTILE_HIT_RADIUS = 0.62;

export type ProjectileSource = 'PLAYER' | 'PET';

export interface PlayerProjectileHitEvent {
  target: HurtboxTarget;
  element: ElementId;
  comboStep: 1 | 2 | 3;
  source: ProjectileSource;
  x: number;
  y: number;
  z: number;
}

interface PooledBolt {
  active: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  element: ElementId;
  comboStep: 1 | 2 | 3;
  source: ProjectileSource;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
}

/**
 * Zero-allocation object-pooled projectile system powering Phase 5 `RANGED` weapons
 * (`flora` Verdant Longbow arrow volleys & `umbra` Nightfall Dual Guns shadow bolts).
 */
export class PlayerProjectilePool {
  public readonly root = new THREE.Group();

  private readonly bolts: PooledBolt[] = [];
  private readonly boltGeo: THREE.CylinderGeometry;
  private readonly scratchTargetPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  private readonly hitEvents: PlayerProjectileHitEvent[] = [];

  constructor() {
    // Sleek glowing arrow/energy-bolt shaft aligned along +Z forward
    this.boltGeo = new THREE.CylinderGeometry(0.045, 0.095, 0.92, 6);
    this.boltGeo.rotateX(Math.PI / 2);

    for (let i = 0; i < MAX_PLAYER_PROJECTILES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.boltGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);

      this.bolts.push({
        active: false,
        mesh,
        mat,
        element: 'flora',
        comboStep: 1,
        source: 'PLAYER',
        x: 0,
        y: 1.25,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
      });
    }
  }

  /**
   * Fires 1 (Attack 1), 2 (Attack 2), or 3-way fan salvo (Attack 3) of elemental bolts.
   */
  public fireVolley(
    element: ElementId,
    comboStep: 1 | 2 | 3,
    originX: number,
    originY: number,
    originZ: number,
    baseYaw: number,
    colorHex: number
  ): void {
    const speed = element === 'umbra' ? 24.0 : 21.0;
    const spreadAngles: readonly number[] =
      comboStep === 3
        ? [-0.22, 0, 0.22]
        : comboStep === 2
          ? [-0.075, 0.075]
          : [0];

    for (let s = 0; s < spreadAngles.length; s++) {
      const slot = this.acquireSlot();
      if (!slot) break;
      const angle = baseYaw + spreadAngles[s]!;
      const fx = Math.sin(angle);
      const fz = Math.cos(angle);

      slot.active = true;
      slot.element = element;
      slot.comboStep = comboStep;
      slot.source = 'PLAYER';
      slot.age = 0;
      slot.x = originX + fx * 0.75;
      slot.y = originY;
      slot.z = originZ + fz * 0.75;
      slot.vx = fx * speed;
      slot.vy = 0;
      slot.vz = fz * speed;

      slot.mat.color.setHex(colorHex);
      slot.mesh.position.set(slot.x, slot.y, slot.z);
      slot.mesh.rotation.set(0, angle, 0);
      slot.mesh.scale.set(
        comboStep === 3 ? 1.35 : 1.0,
        comboStep === 3 ? 1.35 : 1.0,
        element === 'flora' ? 1.35 : 0.9
      );
      slot.mesh.visible = true;
    }
  }

  /**
   * Fires a glowing 3D Elemental Shot directly from an active Companion Pet toward a monster!
   */
  public firePetShot(
    element: ElementId,
    originX: number,
    originY: number,
    originZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    colorHex: number
  ): void {
    const slot = this.acquireSlot();
    if (!slot) return;

    const dx = targetX - originX;
    const dy = targetY - originY;
    const dz = targetZ - originZ;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const speed = 19.5;
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    const yaw = Math.atan2(dx, dz);
    const horiz = Math.hypot(dx, dz) || 0.001;
    const pitch = -Math.atan2(dy, horiz);

    slot.active = true;
    slot.element = element;
    slot.comboStep = 1;
    slot.source = 'PET';
    slot.age = 0;
    slot.x = originX + nx * 0.55;
    slot.y = originY + ny * 0.55;
    slot.z = originZ + nz * 0.55;
    slot.vx = nx * speed;
    slot.vy = ny * speed;
    slot.vz = nz * speed;

    slot.mat.color.setHex(colorHex);
    slot.mesh.position.set(slot.x, slot.y, slot.z);
    slot.mesh.rotation.set(pitch, yaw, 0, 'YXZ');
    slot.mesh.scale.set(1.75, 1.75, 1.45);
    slot.mesh.visible = true;
  }

  /**
   * Steps active projectiles and returns hits against alive enemies (reusing internal array).
   */
  public fixedUpdate(
    dt: number,
    targets: readonly HurtboxTarget[]
  ): readonly PlayerProjectileHitEvent[] {
    this.hitEvents.length = 0;

    for (let i = 0; i < this.bolts.length; i++) {
      const b = this.bolts[i]!;
      if (!b.active) continue;

      b.age += dt;
      b.x += b.vx * dt;
      b.y = Math.max(0.25, b.y + b.vy * dt);
      b.z += b.vz * dt;
      b.mesh.position.set(b.x, b.y, b.z);

      const radial = Math.hypot(b.x, b.z);
      if (b.age >= PROJECTILE_LIFETIME_SEC || radial > ARENA_RADIUS + 2.5) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }

      for (let t = 0; t < targets.length; t++) {
        const target = targets[t]!;
        if (!target.isAlive) continue;
        target.getPosition(this.scratchTargetPos);
        const dx = this.scratchTargetPos.x - b.x;
        const dz = this.scratchTargetPos.z - b.z;
        const hitDist = PROJECTILE_HIT_RADIUS + target.radius;
        if (dx * dx + dz * dz <= hitDist * hitDist) {
          b.active = false;
          b.mesh.visible = false;
          this.hitEvents.push({
            target,
            element: b.element,
            comboStep: b.comboStep,
            source: b.source,
            x: b.x,
            y: b.y,
            z: b.z,
          });
          break;
        }
      }
    }

    return this.hitEvents;
  }

  public clearAll(): void {
    this.hitEvents.length = 0;
    for (let i = 0; i < this.bolts.length; i++) {
      const b = this.bolts[i]!;
      b.active = false;
      b.mesh.visible = false;
    }
  }

  public dispose(): void {
    this.clearAll();
    this.boltGeo.dispose();
    for (let i = 0; i < this.bolts.length; i++) {
      this.bolts[i]!.mat.dispose();
    }
  }

  private acquireSlot(): PooledBolt | null {
    for (let i = 0; i < this.bolts.length; i++) {
      if (!this.bolts[i]!.active) return this.bolts[i]!;
    }
    return this.bolts[0] ?? null;
  }
}

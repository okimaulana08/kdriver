import * as THREE from 'three';
import type { Vec3Snapshot } from '../types/schema';

const MAX_SHARDS = 24;
const MAGNET_RADIUS = 4.4;
const COLLECT_RADIUS = 0.95;

interface ShardSlot {
  active: boolean;
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  age: number;
  hpBonus: number;
  gaugeBonus: number;
}

export interface ShardCollectResult {
  collectedCount: number;
  hpRestored: number;
  gaugeAdded: number;
}

/**
 * Object-pooled floating Gem Shards dropped by defeated enemies.
 * Magnetically pull toward the Rider to sustain HP and build Driver/Overdrive Gauge.
 */
export class GemShardPool {
  public readonly root = new THREE.Group();

  private readonly geometry: THREE.OctahedronGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly slots: ShardSlot[] = [];
  private readonly collectResult: ShardCollectResult = {
    collectedCount: 0,
    hpRestored: 0,
    gaugeAdded: 0,
  };

  constructor() {
    this.geometry = new THREE.OctahedronGeometry(0.24, 0);
    this.material = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x22d3ee,
      emissiveIntensity: 2.4,
      roughness: 0.15,
      metalness: 0.3,
    });

    for (let i = 0; i < MAX_SHARDS; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.visible = false;
      this.root.add(mesh);
      this.slots.push({
        active: false,
        mesh,
        x: 0,
        y: 0.6,
        z: 0,
        age: 0,
        hpBonus: 14,
        gaugeBonus: 10,
      });
    }
  }

  public spawn(x: number, z: number, count = 1, hpBonus = 14, gaugeBonus = 10): void {
    for (let n = 0; n < count; n++) {
      const slot = this.slots.find((s) => !s.active);
      if (!slot) return;
      const offsetAngle = (n / Math.max(1, count)) * Math.PI * 2;
      const offsetDist = count > 1 ? 0.75 : 0;
      slot.active = true;
      slot.x = x + Math.cos(offsetAngle) * offsetDist;
      slot.y = 0.75;
      slot.z = z + Math.sin(offsetAngle) * offsetDist;
      slot.age = 0;
      slot.hpBonus = hpBonus;
      slot.gaugeBonus = gaugeBonus;
      slot.mesh.position.set(slot.x, slot.y, slot.z);
      slot.mesh.visible = true;
    }
  }

  public fixedUpdate(dt: number, playerPos: Readonly<Vec3Snapshot>): ShardCollectResult {
    this.collectResult.collectedCount = 0;
    this.collectResult.hpRestored = 0;
    this.collectResult.gaugeAdded = 0;

    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (!s.active) continue;

      s.age += dt;
      const dx = playerPos.x - s.x;
      const dz = playerPos.z - s.z;
      const dist = Math.hypot(dx, dz);

      if (dist <= COLLECT_RADIUS) {
        s.active = false;
        s.mesh.visible = false;
        this.collectResult.collectedCount++;
        this.collectResult.hpRestored += s.hpBonus;
        this.collectResult.gaugeAdded += s.gaugeBonus;
        continue;
      }

      if (dist <= MAGNET_RADIUS && dist > 0.01) {
        const pullSpeed = 12.5;
        s.x += (dx / dist) * pullSpeed * dt;
        s.z += (dz / dist) * pullSpeed * dt;
      }

      s.y = 0.72 + Math.sin(s.age * 5.2) * 0.16;
      s.mesh.position.set(s.x, s.y, s.z);
      s.mesh.rotation.y = s.age * 3.2;
      s.mesh.rotation.x = Math.sin(s.age * 2.5) * 0.3;
    }

    return this.collectResult;
  }

  public clearAll(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      s.active = false;
      s.mesh.visible = false;
    }
  }

  public dispose(): void {
    this.clearAll();
    this.geometry.dispose();
    this.material.dispose();
  }
}

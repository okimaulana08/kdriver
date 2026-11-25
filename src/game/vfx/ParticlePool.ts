import * as THREE from 'three';
import { getElementConfig } from '../data/elements';
import type { ElementId, ReactionId } from '../types/schema';

const MAX_SPARKS = 240;
const MAX_SMOKE = 96;

interface SparkSlot {
  active: boolean;
  age: number;
  lifetime: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  baseScale: number;
  lengthStretch: number;
}

interface SmokeSlot {
  active: boolean;
  age: number;
  lifetime: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  startScale: number;
  endScale: number;
  spinSpeed: number;
}

/**
 * Dual-channel live-action Tokusatsu VFX pool (Pyrotechnic Sparks + Impact Dust/Smoke).
 * Uses two single-draw-call InstancedMeshes with concrete floor bounce physics and
 * zero allocations during update/emit.
 */
export class ParticlePool {
  public readonly root = new THREE.Group();
  public readonly mesh: THREE.InstancedMesh;
  private readonly smokeMesh: THREE.InstancedMesh;

  private readonly sparkGeo: THREE.BoxGeometry;
  private readonly sparkMat: THREE.MeshBasicMaterial;
  private readonly smokeGeo: THREE.DodecahedronGeometry;
  private readonly smokeMat: THREE.MeshStandardMaterial;

  private readonly sparkSlots: SparkSlot[] = [];
  private readonly smokeSlots: SmokeSlot[] = [];
  private sparkCursor = 0;
  private smokeCursor = 0;

  // Reusable scratch objects (Zero-Allocation Hot Path)
  private readonly scratchDummy = new THREE.Object3D();
  private readonly scratchLookTarget = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();

  constructor() {
    // Channel 1: Elongated hot welding/pyrotechnic metal sparks (signature Toei combat sparks!)
    this.sparkGeo = new THREE.BoxGeometry(0.036, 0.036, 0.32);
    this.sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(this.sparkGeo, this.sparkMat, MAX_SPARKS);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Channel 2: Soft concrete dust & explosion smoke plumes
    this.smokeGeo = new THREE.DodecahedronGeometry(0.28, 1);
    this.smokeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0.0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(this.smokeGeo, this.smokeMat, MAX_SMOKE);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.root.add(this.mesh, this.smokeMesh);

    this.scratchDummy.scale.set(0, 0, 0);
    this.scratchDummy.updateMatrix();
    this.scratchColor.setHex(0xffffff);

    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparkSlots.push({
        active: false,
        age: 0,
        lifetime: 0.4,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: -16,
        baseScale: 1,
        lengthStretch: 1,
      });
      this.mesh.setMatrixAt(i, this.scratchDummy.matrix);
      this.mesh.setColorAt(i, this.scratchColor);
    }

    for (let i = 0; i < MAX_SMOKE; i++) {
      this.smokeSlots.push({
        active: false,
        age: 0,
        lifetime: 0.7,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        startScale: 0.4,
        endScale: 1.8,
        spinSpeed: 1.5,
      });
      this.smokeMesh.setMatrixAt(i, this.scratchDummy.matrix);
      this.smokeMesh.setColorAt(i, this.scratchColor);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
  }

  public emitBeltSwitchBurst(x: number, y: number, z: number, colorHex: number): void {
    this.scratchColor.setHex(colorHex);
    const count = 22;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 4.2 + (i % 3) * 1.4;
      const bright = i % 3 === 0 ? 0xfff7ed : colorHex;
      this.scratchColor.setHex(bright);
      this.spawnSpark(
        x,
        y,
        z,
        Math.cos(angle) * speed,
        1.1 + Math.random() * 2.2,
        Math.sin(angle) * speed,
        -11.0,
        0.34,
        0.95 + Math.random() * 0.4,
        1.25,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }
    this.emitDustRing(x, 0.2, z, 6, 0xcbd5e1, 1.4);
  }

  public emitElementBurst(
    element: ElementId,
    x: number,
    y: number,
    z: number,
    count = 28,
    spreadScale = 1.0
  ): void {
    const cfg = getElementConfig(element);
    this.scratchColor.set(cfg.primaryColor);
    const primaryHex = this.scratchColor.getHex();
    this.scratchColor.set(cfg.emissiveColor);
    const emissiveHex = this.scratchColor.getHex();

    const isFast = element === 'volt' || element === 'aero' || element === 'umbra';
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (3.4 + Math.random() * 6.8) * spreadScale;
      const hex = i % 4 === 0 ? 0xffffff : i % 2 === 0 ? emissiveHex : primaryHex;
      this.scratchColor.setHex(hex);

      this.spawnSpark(
        x + (Math.random() - 0.5) * 0.7,
        y + (isFast ? 0.3 : 0.2) + Math.random() * 0.5,
        z + (Math.random() - 0.5) * 0.7,
        Math.cos(angle) * speed * (isFast ? 1.45 : 1.1),
        (isFast ? 1.4 : 2.6) + Math.random() * 4.6,
        Math.sin(angle) * speed * (isFast ? 1.45 : 1.1),
        isFast ? -8.5 : -14.8,
        (isFast ? 0.28 : 0.44) + Math.random() * 0.22,
        0.92 + Math.random() * 0.6,
        isFast ? 1.95 : 1.35,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }

    const smokeHex =
      element === 'pyro' || element === 'terra' || element === 'umbra'
        ? 0x475569
        : element === 'flora'
          ? 0x86efac
          : 0xcbd5e1;
    this.emitDustRing(
      x,
      Math.max(0.25, y * 0.45),
      z,
      Math.min(12, Math.max(5, Math.floor(count / 4))),
      smokeHex,
      1.6 * spreadScale
    );
  }

  public emitReactionBurst(reactionId: ReactionId, x: number, y: number, z: number): void {
    const count = 44;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const speed = 5.2 + Math.random() * 8.5;
      let hex = 0xfde047;

      if (reactionId === 'ELECTRO_SURGE') {
        hex = i % 3 === 0 ? 0xffffff : i % 2 === 0 ? 0x38bdf8 : 0xfacc15;
      } else if (reactionId === 'STEAM_BURST') {
        hex = i % 3 === 0 ? 0xf8fafc : i % 2 === 0 ? 0xfb923c : 0x38bdf8;
      } else if (reactionId === 'OVERLOAD') {
        hex = i % 3 === 0 ? 0xfffbeb : i % 2 === 0 ? 0xf97316 : 0xe11d48;
      } else if (reactionId === 'WILDFIRE') {
        hex = i % 3 === 0 ? 0x4ade80 : i % 2 === 0 ? 0xf97316 : 0xfacc15;
      } else if (reactionId === 'ECLIPSE') {
        hex = i % 3 === 0 ? 0xffffff : i % 2 === 0 ? 0xc084fc : 0xfef08a;
      }

      this.scratchColor.setHex(hex);
      this.spawnSpark(
        x + (Math.random() - 0.5) * 0.7,
        y + 0.4 + Math.random() * 0.7,
        z + (Math.random() - 0.5) * 0.7,
        Math.cos(angle) * speed,
        3.2 + Math.random() * 6.0,
        Math.sin(angle) * speed,
        -15.0,
        0.52 + Math.random() * 0.35,
        1.15 + Math.random() * 0.75,
        1.75,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }

    // Authentic Tokusatsu quarry explosion plume!
    const smokeColor =
      reactionId === 'STEAM_BURST' ? 0xe2e8f0 : reactionId === 'OVERLOAD' ? 0x334155 : 0x64748b;
    this.emitDustRing(x, 0.35, z, 14, smokeColor, 2.4);
  }

  public emitHitSparks(x: number, y: number, z: number, colorHex: number, isCrit: boolean): void {
    const count = isCrit ? 22 : 12;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4.2 + Math.random() * 6.8;
      // Realistic Toei steel-clash sparks: hot white-yellow core mixed with elemental hue
      const sparkHex = i % 3 === 0 ? 0xffffff : i % 2 === 0 ? 0xfde047 : isCrit ? 0xfb923c : colorHex;
      this.scratchColor.setHex(sparkHex);
      this.spawnSpark(
        x,
        y,
        z,
        Math.cos(angle) * speed,
        2.0 + Math.random() * 4.8,
        Math.sin(angle) * speed,
        -18.5,
        0.3 + Math.random() * 0.22,
        isCrit ? 1.05 : 0.75,
        isCrit ? 1.8 : 1.45,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }
    this.emitDustRing(x, Math.max(0.2, y - 0.35), z, isCrit ? 4 : 2, 0x94a3b8, isCrit ? 1.2 : 0.75);
  }

  public emitDustRing(
    x: number,
    y: number,
    z: number,
    count: number,
    colorHex: number,
    spread = 1.4
  ): void {
    this.scratchColor.setHex(colorHex);
    for (let i = 0; i < count; i++) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.4;
      const speed = (0.7 + Math.random() * 1.9) * spread;
      this.spawnSmoke(
        x + (Math.random() - 0.5) * 0.5,
        y + Math.random() * 0.25,
        z + (Math.random() - 0.5) * 0.5,
        Math.cos(angle) * speed,
        0.8 + Math.random() * 1.4,
        Math.sin(angle) * speed,
        0.55 + Math.random() * 0.4,
        0.55 * spread,
        2.1 * spread,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }
  }

  public update(dt: number): void {
    let sparkDirty = false;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const p = this.sparkSlots[i]!;
      if (!p.active) continue;

      sparkDirty = true;
      p.age += dt;
      if (p.age >= p.lifetime) {
        p.active = false;
        this.scratchDummy.position.set(0, -100, 0);
        this.scratchDummy.scale.set(0, 0, 0);
        this.scratchDummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.scratchDummy.matrix);
        continue;
      }

      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Realistic concrete floor bounce with spark friction!
      if (p.y < 0.05) {
        p.y = 0.05;
        if (p.vy < -0.5) {
          p.vy = -p.vy * 0.42;
          p.vx *= 0.72;
          p.vz *= 0.72;
        } else {
          p.vy = 0;
          p.vx *= 0.85;
          p.vz *= 0.85;
        }
      }

      const t = p.age / p.lifetime;
      const scale = p.baseScale * (1 - t * t);
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      const streak = Math.max(0.45, Math.min(2.6, speed * 0.16 * p.lengthStretch));

      this.scratchDummy.position.set(p.x, p.y, p.z);
      if (speed > 0.05) {
        this.scratchLookTarget.set(p.x + p.vx, p.y + p.vy, p.z + p.vz);
        this.scratchDummy.lookAt(this.scratchLookTarget);
      }
      this.scratchDummy.scale.set(scale, scale, scale * streak);
      this.scratchDummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.scratchDummy.matrix);
    }

    if (sparkDirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }

    let smokeDirty = false;
    for (let i = 0; i < MAX_SMOKE; i++) {
      const s = this.smokeSlots[i]!;
      if (!s.active) continue;

      smokeDirty = true;
      s.age += dt;
      if (s.age >= s.lifetime) {
        s.active = false;
        this.scratchDummy.position.set(0, -100, 0);
        this.scratchDummy.scale.set(0, 0, 0);
        this.scratchDummy.updateMatrix();
        this.smokeMesh.setMatrixAt(i, this.scratchDummy.matrix);
        continue;
      }

      const drag = Math.exp(-2.8 * dt);
      s.vx *= drag;
      s.vz *= drag;
      s.vy = s.vy * drag + 0.45 * dt;
      s.x += s.vx * dt;
      s.y = Math.max(0.15, s.y + s.vy * dt);
      s.z += s.vz * dt;

      const t = s.age / s.lifetime;
      const fadeEnvelope = t < 0.72 ? 1.0 : Math.max(0, 1 - (t - 0.72) / 0.28);
      const sc = (s.startScale + (s.endScale - s.startScale) * Math.sqrt(t)) * fadeEnvelope;

      this.scratchDummy.position.set(s.x, s.y, s.z);
      this.scratchDummy.rotation.set(s.age * s.spinSpeed, s.age * s.spinSpeed * 0.7, 0);
      this.scratchDummy.scale.set(sc, sc * 0.82, sc);
      this.scratchDummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this.scratchDummy.matrix);
    }

    if (smokeDirty) {
      this.smokeMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.sparkGeo.dispose();
    this.sparkMat.dispose();
    this.smokeGeo.dispose();
    this.smokeMat.dispose();
  }

  private spawnSpark(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    gravity: number,
    lifetime: number,
    baseScale: number,
    lengthStretch: number,
    r: number,
    g: number,
    b: number
  ): void {
    const idx = this.sparkCursor;
    this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;

    const slot = this.sparkSlots[idx]!;
    slot.active = true;
    slot.age = 0;
    slot.lifetime = lifetime;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.gravity = gravity;
    slot.baseScale = baseScale;
    slot.lengthStretch = lengthStretch;

    this.scratchColor.setRGB(r, g, b);
    this.mesh.setColorAt(idx, this.scratchColor);
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  private spawnSmoke(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    lifetime: number,
    startScale: number,
    endScale: number,
    r: number,
    g: number,
    b: number
  ): void {
    const idx = this.smokeCursor;
    this.smokeCursor = (this.smokeCursor + 1) % MAX_SMOKE;

    const slot = this.smokeSlots[idx]!;
    slot.active = true;
    slot.age = 0;
    slot.lifetime = lifetime;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.startScale = startScale;
    slot.endScale = endScale;
    slot.spinSpeed = 0.8 + Math.random() * 1.4;

    this.scratchColor.setRGB(r, g, b);
    this.smokeMesh.setColorAt(idx, this.scratchColor);
    if (this.smokeMesh.instanceColor) {
      this.smokeMesh.instanceColor.needsUpdate = true;
    }
  }
}

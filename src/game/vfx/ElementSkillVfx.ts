import * as THREE from 'three';
import { getElementConfig } from '../data/elements';
import type { ElementId } from '../types/schema';

type SkillVfxKind =
  | 'DOME_NOVA'
  | 'SKY_PILLAR'
  | 'CRESCENT_VORTEX'
  | 'CYCLONE_FUNNEL'
  | 'SPIKE_RING'
  | 'VOID_SINGULARITY'
  | 'FINISHER_CLIMAX'
  | 'EXPLOSION_PILLAR';

const ELEMENT_SKILL_KIND: Readonly<Record<ElementId, SkillVfxKind>> = {
  pyro: 'DOME_NOVA',
  solar: 'DOME_NOVA',
  volt: 'SKY_PILLAR',
  lux: 'SKY_PILLAR',
  aqua: 'CRESCENT_VORTEX',
  lunar: 'CRESCENT_VORTEX',
  aero: 'CYCLONE_FUNNEL',
  terra: 'SPIKE_RING',
  flora: 'SPIKE_RING',
  umbra: 'VOID_SINGULARITY',
};

const POOL_SIZE = 10;

interface PooledVfxSlot {
  active: boolean;
  kind: SkillVfxKind;
  elapsed: number;
  duration: number;
  baseRadius: number;
  baseYaw: number;
  group: THREE.Group;
  domeMesh: THREE.Mesh;
  pillarMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  ringOuterMesh: THREE.Mesh;
  crescentMeshA: THREE.Mesh;
  crescentMeshB: THREE.Mesh;
  cycloneMesh: THREE.Mesh;
  spikeRingMesh: THREE.Mesh;
  voidCoreMesh: THREE.Mesh;
  uniforms: {
    uTime: { value: number };
    uProgress: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
    uOpacity: { value: number };
    uMode: { value: number };
  };
  material: THREE.ShaderMaterial;
  ringMaterial: THREE.ShaderMaterial;
  ringUniforms: {
    uTime: { value: number };
    uProgress: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
    uOpacity: { value: number };
  };
}

function buildSpikeRingGeometry(spikeCount = 10): THREE.BufferGeometry {
  const segsPerSpike = 5;
  const cone = new THREE.ConeGeometry(0.32, 2.25, segsPerSpike, 1, false);
  cone.translate(0, 1.05, 0);

  const srcPos = cone.attributes.position!;
  const srcUv = cone.attributes.uv!;
  const srcIdx = cone.index!;
  const vertCount = srcPos.count;
  const idxCount = srcIdx.count;

  const positions = new Float32Array(vertCount * spikeCount * 3);
  const uvs = new Float32Array(vertCount * spikeCount * 2);
  const indices = new Uint16Array(idxCount * spikeCount);

  const tmp = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();

  for (let s = 0; s < spikeCount; s++) {
    const angle = (s / spikeCount) * Math.PI * 2;
    const radialDist = 0.72 + (s % 2) * 0.24;
    pos.set(Math.sin(angle) * radialDist, -0.05, Math.cos(angle) * radialDist);
    // Outward dramatic eruption tilt
    euler.set(0.34, angle, 0, 'YXZ');
    quat.setFromEuler(euler);
    const hScale = 0.85 + ((s * 37) % 10) * 0.045;
    scale.set(0.9 + (s % 3) * 0.14, hScale, 0.9 + (s % 3) * 0.14);
    mat.compose(pos, quat, scale);

    const vOffset = s * vertCount;
    for (let v = 0; v < vertCount; v++) {
      tmp.set(srcPos.getX(v), srcPos.getY(v), srcPos.getZ(v)).applyMatrix4(mat);
      positions[(vOffset + v) * 3] = tmp.x;
      positions[(vOffset + v) * 3 + 1] = tmp.y;
      positions[(vOffset + v) * 3 + 2] = tmp.z;
      uvs[(vOffset + v) * 2] = srcUv.getX(v);
      uvs[(vOffset + v) * 2 + 1] = srcUv.getY(v);
    }

    const iOffset = s * idxCount;
    for (let i = 0; i < idxCount; i++) {
      indices[iOffset + i] = srcIdx.getX(i) + vOffset;
    }
  }

  cone.dispose();

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeVertexNormals();
  return merged;
}

const ENERGY_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const ENERGY_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  uniform float uMode;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vViewDir))), 1.75);
    float pattern = 0.0;
    float edgeMask = 1.0;

    if (uMode < 0.5) {
      // DOME_NOVA: turbulent swirling magma/plasma dome with sharp rim glow
      vec2 p = vec2(vUv.x * 10.0 + uTime * 1.4, vUv.y * 6.0 - uTime * 2.8);
      float n = noise(p) * 0.65 + noise(p * 2.1 - uTime * 2.0) * 0.35;
      pattern = mix(n, 1.0, fresnel * 0.85);
      edgeMask = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.68, vUv.y);
    } else if (uMode < 1.5) {
      // SKY_PILLAR / FINISHER BEAM: blazing vertical plasma streaks + crackling bands
      float streaks = sin(vUv.x * 37.699 + uTime * 14.0 + noise(vec2(vUv.x * 6.0, vUv.y * 8.0 - uTime * 6.0)) * 4.5);
      float bolt = smoothstep(0.15, 0.92, streaks * 0.5 + 0.5);
      float core = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vViewDir))), 0.65);
      pattern = clamp(bolt * 0.72 + (1.0 - core) * 0.68, 0.0, 1.35);
      edgeMask = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.76, vUv.y);
    } else if (uMode < 2.5) {
      // CRESCENT_VORTEX / CYCLONE_FUNNEL: sweeping helical energy ribbons
      float helix = sin((vUv.x * 18.849 + vUv.y * 12.566) - uTime * 16.0);
      float ribbon = smoothstep(-0.15, 0.85, helix);
      float n = noise(vec2(vUv.x * 12.0 - uTime * 4.5, vUv.y * 8.0 - uTime * 3.0));
      pattern = clamp(ribbon * 0.75 + n * 0.45 + fresnel * 0.4, 0.0, 1.25);
      edgeMask = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
    } else if (uMode < 3.5) {
      // SPIKE_RING: faceted crystal/stone energy glow rising from base to hot tip
      float veins = noise(vec2(vUv.x * 8.0, vUv.y * 10.0 - uTime * 3.2));
      pattern = clamp(0.45 + vUv.y * 0.65 + veins * 0.35 + fresnel * 0.5, 0.0, 1.4);
      edgeMask = smoothstep(0.0, 0.12, vUv.y);
    } else {
      // VOID_SINGULARITY: dark violet center with intense glowing event-horizon corona
      float swirl = noise(vec2(vUv.x * 12.0 + uTime * 3.5, vUv.y * 8.0 - uTime * 2.5));
      pattern = clamp(fresnel * 1.45 + swirl * 0.35, 0.0, 1.5);
      edgeMask = 1.0;
    }

    vec3 col = mix(uColorA, uColorB, clamp(pattern * 0.85, 0.0, 1.0));
    // Hot white core boost for selective UnrealBloomPass pop
    col += vec3(0.95, 0.96, 1.0) * smoothstep(0.88, 1.35, pattern) * 0.9;

    float alpha = clamp(pattern * edgeMask * uOpacity, 0.0, 1.0);
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(col * 1.45, alpha);
  }
`;

const RING_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;

  varying vec2 vUv;

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float r = length(centered);
    if (r > 1.0 || r < 0.18) discard;

    float angle = atan(centered.y, centered.x);
    float outerBand = exp(-pow((r - 0.86) * 9.5, 2.0));
    float innerBand = exp(-pow((r - 0.56) * 14.0, 2.0)) * 0.72;
    float runeTicks = smoothstep(0.2, 0.85, sin(angle * 16.0 + uTime * 6.0) * 0.5 + 0.5);
    float spokes = smoothstep(0.55, 0.98, sin(angle * 8.0 - uTime * 4.5) * 0.5 + 0.5) * exp(-pow((r - 0.72) * 8.0, 2.0));

    float glow = outerBand * (0.72 + 0.35 * runeTicks) + innerBand * runeTicks + spokes * 0.65;
    vec3 col = mix(uColorA, uColorB, clamp(outerBand + spokes * 0.5, 0.0, 1.0));
    col += vec3(1.0) * smoothstep(0.9, 1.3, glow) * 0.75;

    float alpha = clamp(glow * uOpacity, 0.0, 1.0);
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(col * 1.5, alpha);
  }
`;

/**
 * Zero-allocation, object-pooled 3D Procedural Shader Mesh VFX system powering:
 * - All 10 Element Skills (Q) with 6 distinct animated 3D geometries + custom GLSL energy shaders
 * - Ultimate Finisher Beat 2 Mega-Climax skybeam + shockwave dome + double rune rings
 * - Ultimate Finisher Beat 3 chained back-turned explosion pillars
 */
export class ElementSkillVfx {
  public readonly root = new THREE.Group();

  private readonly sharedGeometries: THREE.BufferGeometry[] = [];
  private readonly slots: PooledVfxSlot[] = [];
  private readonly scratchPrimaryColor = new THREE.Color();
  private readonly scratchEmissiveColor = new THREE.Color();
  private cursor = 0;

  constructor() {
    this.root.name = 'ElementSkillVfxRoot';

    const domeGeo = new THREE.SphereGeometry(1.0, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const pillarGeo = new THREE.CylinderGeometry(0.75, 1.05, 12.0, 24, 1, true);
    pillarGeo.translate(0, 6.0, 0);
    const ringGeo = new THREE.PlaneGeometry(2.0, 2.0);
    ringGeo.rotateX(-Math.PI / 2);
    const crescentGeo = new THREE.TorusGeometry(1.0, 0.2, 8, 32, Math.PI * 1.38);
    crescentGeo.rotateX(Math.PI / 2);
    const cycloneGeo = new THREE.CylinderGeometry(1.45, 0.3, 4.6, 26, 1, true);
    cycloneGeo.translate(0, 2.3, 0);
    const spikeRingGeo = buildSpikeRingGeometry(10);
    const voidCoreGeo = new THREE.SphereGeometry(0.72, 18, 12);

    this.sharedGeometries.push(
      domeGeo,
      pillarGeo,
      ringGeo,
      crescentGeo,
      cycloneGeo,
      spikeRingGeo,
      voidCoreGeo
    );

    for (let i = 0; i < POOL_SIZE; i++) {
      const uniforms = {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uColorA: { value: new THREE.Color(0xe11d48) },
        uColorB: { value: new THREE.Color(0xff5722) },
        uOpacity: { value: 1 },
        uMode: { value: 0 },
      };
      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: ENERGY_VERTEX_SHADER,
        fragmentShader: ENERGY_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const ringUniforms = {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uColorA: { value: new THREE.Color(0xe11d48) },
        uColorB: { value: new THREE.Color(0xff5722) },
        uOpacity: { value: 1 },
      };
      const ringMaterial = new THREE.ShaderMaterial({
        uniforms: ringUniforms,
        vertexShader: RING_VERTEX_SHADER,
        fragmentShader: RING_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const group = new THREE.Group();
      group.visible = false;

      const domeMesh = new THREE.Mesh(domeGeo, material);
      const pillarMesh = new THREE.Mesh(pillarGeo, material);
      const ringMesh = new THREE.Mesh(ringGeo, ringMaterial);
      ringMesh.position.y = 0.08;
      const ringOuterMesh = new THREE.Mesh(ringGeo, ringMaterial);
      ringOuterMesh.position.y = 0.14;
      const crescentMeshA = new THREE.Mesh(crescentGeo, material);
      crescentMeshA.position.y = 1.1;
      const crescentMeshB = new THREE.Mesh(crescentGeo, material);
      crescentMeshB.position.y = 1.8;
      const cycloneMesh = new THREE.Mesh(cycloneGeo, material);
      const spikeRingMesh = new THREE.Mesh(spikeRingGeo, material);
      const voidCoreMesh = new THREE.Mesh(voidCoreGeo, material);
      voidCoreMesh.position.y = 1.35;

      domeMesh.frustumCulled = false;
      pillarMesh.frustumCulled = false;
      ringMesh.frustumCulled = false;
      ringOuterMesh.frustumCulled = false;
      crescentMeshA.frustumCulled = false;
      crescentMeshB.frustumCulled = false;
      cycloneMesh.frustumCulled = false;
      spikeRingMesh.frustumCulled = false;
      voidCoreMesh.frustumCulled = false;

      group.add(
        domeMesh,
        pillarMesh,
        ringMesh,
        ringOuterMesh,
        crescentMeshA,
        crescentMeshB,
        cycloneMesh,
        spikeRingMesh,
        voidCoreMesh
      );
      this.root.add(group);

      this.slots.push({
        active: false,
        kind: 'DOME_NOVA',
        elapsed: 0,
        duration: 0.75,
        baseRadius: 4.5,
        baseYaw: 0,
        group,
        domeMesh,
        pillarMesh,
        ringMesh,
        ringOuterMesh,
        crescentMeshA,
        crescentMeshB,
        cycloneMesh,
        spikeRingMesh,
        voidCoreMesh,
        uniforms,
        material,
        ringMaterial,
        ringUniforms,
      });
    }
  }

  public spawnSkillVfx(
    elementId: ElementId,
    x: number,
    z: number,
    yaw: number,
    radius: number,
    isSuper: boolean
  ): void {
    const kind = ELEMENT_SKILL_KIND[elementId];
    const duration = isSuper ? 0.92 : 0.76;
    this.activateSlot(elementId, kind, x, z, yaw, radius, duration);
  }

  public spawnFinisherClimax(elementId: ElementId, x: number, z: number, radius = 11.5): void {
    this.activateSlot(elementId, 'FINISHER_CLIMAX', x, z, 0, radius, 1.35);
  }

  public spawnExplosionPillar(elementId: ElementId, x: number, z: number, scale = 3.2): void {
    this.activateSlot(elementId, 'EXPLOSION_PILLAR', x, z, 0, scale, 0.95);
  }

  public clearAll(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.active = false;
      slot.group.visible = false;
    }
  }

  public update(dt: number): void {
    if (dt <= 0) return;

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (!slot.active) continue;

      slot.elapsed += dt;
      if (slot.elapsed >= slot.duration) {
        slot.active = false;
        slot.group.visible = false;
        continue;
      }

      const p = slot.elapsed / slot.duration;
      const easeOut = 1 - Math.pow(1 - Math.min(1, p * 1.45), 3);
      const fade = p < 0.14 ? p / 0.14 : Math.max(0, 1 - (p - 0.14) / 0.86);
      const r = slot.baseRadius;

      slot.uniforms.uTime.value = slot.elapsed;
      slot.uniforms.uProgress.value = p;
      slot.uniforms.uOpacity.value = fade;
      slot.ringUniforms.uTime.value = slot.elapsed;
      slot.ringUniforms.uProgress.value = p;
      slot.ringUniforms.uOpacity.value = fade;

      const ringScale = r * (0.35 + easeOut * 0.95);
      slot.ringMesh.scale.set(ringScale, 1, ringScale);
      slot.ringMesh.rotation.y = slot.elapsed * 2.2;

      switch (slot.kind) {
        case 'DOME_NOVA': {
          const domeScale = r * (0.28 + easeOut * 0.78);
          slot.domeMesh.scale.set(domeScale, domeScale * (0.78 - p * 0.16), domeScale);
          slot.domeMesh.rotation.y = slot.elapsed * 2.8;
          slot.ringOuterMesh.scale.set(ringScale * 1.24, 1, ringScale * 1.24);
          slot.ringOuterMesh.rotation.y = -slot.elapsed * 3.1;
          break;
        }
        case 'SKY_PILLAR': {
          const beamWidth = r * 0.34 * (1.15 - p * 0.45);
          const beamHeight = 0.4 + Math.min(1, p * 4.5) * 1.15;
          slot.pillarMesh.scale.set(beamWidth, beamHeight, beamWidth);
          slot.pillarMesh.rotation.y = slot.elapsed * 8.5;
          slot.ringOuterMesh.position.y = 0.4 + p * 5.2;
          slot.ringOuterMesh.scale.set(r * 0.65, 1, r * 0.65);
          slot.ringOuterMesh.rotation.y = -slot.elapsed * 6.0;
          break;
        }
        case 'CRESCENT_VORTEX': {
          const arcScale = r * (0.45 + easeOut * 0.62);
          slot.crescentMeshA.scale.set(arcScale, 1.35, arcScale);
          slot.crescentMeshA.rotation.set(0.24, slot.baseYaw + slot.elapsed * 11.5, 0.12);
          slot.crescentMeshB.scale.set(arcScale * 0.82, 1.1, arcScale * 0.82);
          slot.crescentMeshB.rotation.set(-0.28, slot.baseYaw - slot.elapsed * 9.5 + 1.8, -0.18);
          break;
        }
        case 'CYCLONE_FUNNEL': {
          const funnelW = r * (0.36 + easeOut * 0.42);
          const funnelH = 0.45 + easeOut * 0.95;
          slot.cycloneMesh.scale.set(funnelW, funnelH, funnelW);
          slot.cycloneMesh.rotation.y = slot.elapsed * 13.0;
          slot.ringOuterMesh.position.y = 1.6 + p * 2.2;
          slot.ringOuterMesh.scale.set(funnelW * 1.1, 1, funnelW * 1.1);
          slot.ringOuterMesh.rotation.y = slot.elapsed * 9.0;
          break;
        }
        case 'SPIKE_RING': {
          const spikeRadial = r * 0.68;
          const riseT = Math.min(1, p * 4.2);
          const spikeY = (1 - Math.pow(1 - riseT, 3)) * (1.2 + r * 0.18);
          slot.spikeRingMesh.scale.set(spikeRadial, spikeY, spikeRadial);
          slot.spikeRingMesh.rotation.y = slot.baseYaw + p * 0.35;
          break;
        }
        case 'VOID_SINGULARITY': {
          const corePulse = r * 0.34 * (0.55 + Math.sin(p * Math.PI) * 0.8);
          slot.voidCoreMesh.scale.setScalar(corePulse);
          slot.voidCoreMesh.rotation.y = slot.elapsed * 4.5;
          const orbitScale = r * (0.42 + easeOut * 0.56);
          slot.crescentMeshA.position.y = 1.35;
          slot.crescentMeshA.scale.set(orbitScale, 1.2, orbitScale);
          slot.crescentMeshA.rotation.set(0.65, slot.elapsed * 8.5, 0.45);
          slot.crescentMeshB.position.y = 1.35;
          slot.crescentMeshB.scale.set(orbitScale * 0.88, 1.2, orbitScale * 0.88);
          slot.crescentMeshB.rotation.set(-0.72, -slot.elapsed * 7.2, -0.35);
          break;
        }
        case 'FINISHER_CLIMAX': {
          const beamW = r * 0.32 * (1.35 - p * 0.55);
          slot.pillarMesh.scale.set(beamW, 1.65, beamW);
          slot.pillarMesh.rotation.y = slot.elapsed * 10.0;
          const domeS = r * (0.24 + easeOut * 0.92);
          slot.domeMesh.scale.set(domeS, domeS * 0.68, domeS);
          slot.domeMesh.rotation.y = -slot.elapsed * 3.2;
          slot.ringMesh.scale.set(r * (0.5 + easeOut * 0.85), 1, r * (0.5 + easeOut * 0.85));
          slot.ringOuterMesh.position.y = 0.22;
          slot.ringOuterMesh.scale.set(r * (0.75 + easeOut * 0.72), 1, r * (0.75 + easeOut * 0.72));
          slot.ringOuterMesh.rotation.y = -slot.elapsed * 4.2;
          break;
        }
        case 'EXPLOSION_PILLAR': {
          const colW = r * (0.45 + easeOut * 0.52);
          const colH = 0.25 + easeOut * 0.75;
          slot.pillarMesh.scale.set(colW, colH, colW);
          slot.pillarMesh.rotation.y = slot.elapsed * 6.5;
          const blastDome = r * (0.35 + easeOut * 0.85);
          slot.domeMesh.scale.set(blastDome, blastDome * 0.9, blastDome);
          break;
        }
      }
    }
  }

  public dispose(): void {
    this.clearAll();
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.material.dispose();
      slot.ringMaterial.dispose();
    }
    for (let i = 0; i < this.sharedGeometries.length; i++) {
      this.sharedGeometries[i]!.dispose();
    }
    this.sharedGeometries.length = 0;
  }

  private activateSlot(
    elementId: ElementId,
    kind: SkillVfxKind,
    x: number,
    z: number,
    yaw: number,
    radius: number,
    duration: number
  ): void {
    let chosen: PooledVfxSlot | null = null;
    for (let i = 0; i < this.slots.length; i++) {
      const candidate = this.slots[i]!;
      if (!candidate.active) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      chosen = this.slots[this.cursor % this.slots.length]!;
      this.cursor++;
    }

    const cfg = getElementConfig(elementId);
    this.scratchPrimaryColor.set(cfg.primaryColor);
    this.scratchEmissiveColor.set(cfg.emissiveColor);

    chosen.active = true;
    chosen.kind = kind;
    chosen.elapsed = 0;
    chosen.duration = duration;
    chosen.baseRadius = radius;
    chosen.baseYaw = yaw;
    chosen.group.position.set(x, 0.02, z);
    chosen.group.visible = true;

    chosen.uniforms.uColorA.value.copy(this.scratchPrimaryColor);
    chosen.uniforms.uColorB.value.copy(this.scratchEmissiveColor);
    chosen.uniforms.uTime.value = 0;
    chosen.uniforms.uProgress.value = 0;
    chosen.uniforms.uOpacity.value = 1;

    chosen.ringUniforms.uColorA.value.copy(this.scratchPrimaryColor);
    chosen.ringUniforms.uColorB.value.copy(this.scratchEmissiveColor);
    chosen.ringUniforms.uTime.value = 0;
    chosen.ringUniforms.uProgress.value = 0;
    chosen.ringUniforms.uOpacity.value = 1;

    chosen.domeMesh.visible = false;
    chosen.pillarMesh.visible = false;
    chosen.ringMesh.visible = true;
    chosen.ringOuterMesh.visible = false;
    chosen.crescentMeshA.visible = false;
    chosen.crescentMeshB.visible = false;
    chosen.cycloneMesh.visible = false;
    chosen.spikeRingMesh.visible = false;
    chosen.voidCoreMesh.visible = false;

    chosen.ringOuterMesh.position.y = 0.14;
    chosen.crescentMeshA.position.y = 1.1;
    chosen.crescentMeshB.position.y = 1.8;

    switch (kind) {
      case 'DOME_NOVA':
        chosen.uniforms.uMode.value = 0;
        chosen.domeMesh.visible = true;
        chosen.ringOuterMesh.visible = true;
        break;
      case 'SKY_PILLAR':
        chosen.uniforms.uMode.value = 1;
        chosen.pillarMesh.visible = true;
        chosen.ringOuterMesh.visible = true;
        break;
      case 'CRESCENT_VORTEX':
        chosen.uniforms.uMode.value = 2;
        chosen.crescentMeshA.visible = true;
        chosen.crescentMeshB.visible = true;
        break;
      case 'CYCLONE_FUNNEL':
        chosen.uniforms.uMode.value = 2;
        chosen.cycloneMesh.visible = true;
        chosen.ringOuterMesh.visible = true;
        break;
      case 'SPIKE_RING':
        chosen.uniforms.uMode.value = 3;
        chosen.spikeRingMesh.visible = true;
        break;
      case 'VOID_SINGULARITY':
        chosen.uniforms.uMode.value = 4;
        chosen.voidCoreMesh.visible = true;
        chosen.crescentMeshA.visible = true;
        chosen.crescentMeshB.visible = true;
        break;
      case 'FINISHER_CLIMAX':
        chosen.uniforms.uMode.value = 1;
        chosen.pillarMesh.visible = true;
        chosen.domeMesh.visible = true;
        chosen.ringOuterMesh.visible = true;
        break;
      case 'EXPLOSION_PILLAR':
        chosen.uniforms.uMode.value = 1;
        chosen.pillarMesh.visible = true;
        chosen.domeMesh.visible = true;
        break;
    }
  }
}

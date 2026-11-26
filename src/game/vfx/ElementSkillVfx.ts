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
  | 'GRAND_ULTIMATE_CLIMAX'
  | 'PYRO_EXPLOSION'
  | 'HENSHIN_SUPER'
  | 'HENSHIN_ULTIMATE';

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

const POOL_SIZE = 12;
const FLASH_LIGHT_POOL_SIZE = 2;

interface PooledFlashLight {
  light: THREE.PointLight;
  elapsed: number;
  duration: number;
  peakIntensity: number;
  active: boolean;
}

interface PooledVfxSlot {
  active: boolean;
  kind: SkillVfxKind;
  elapsed: number;
  duration: number;
  baseRadius: number;
  baseYaw: number;
  group: THREE.Group;

  // Multi-lobe vertex-displaced volumetric 3D fireball meshes (replaces stiff cones/domes!)
  fireballMain: THREE.Mesh;
  fireballCrown: THREE.Mesh;
  fireballSide: THREE.Mesh;
  fireballUniforms: {
    uTime: { value: number };
    uProgress: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
    uOpacity: { value: number };
    uElementTint: { value: number };
    uSeed: { value: number };
  };
  fireballMaterial: THREE.ShaderMaterial;

  // Vertex-displaced organic energy meshes (vortex column, helixes, cyclone, blades, spires, wings, void)
  vortexColumnMesh: THREE.Mesh;
  helixMeshA: THREE.Mesh;
  helixMeshB: THREE.Mesh;
  cycloneMesh: THREE.Mesh;
  crescentMeshA: THREE.Mesh;
  crescentMeshB: THREE.Mesh;
  spireClusterMesh: THREE.Mesh;
  voidCoreMesh: THREE.Mesh;
  wingLeftMesh: THREE.Mesh;
  wingRightMesh: THREE.Mesh;
  energyUniforms: {
    uTime: { value: number };
    uProgress: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
    uOpacity: { value: number };
    uMode: { value: number };
    uDisplaceAmp: { value: number };
  };
  energyMaterial: THREE.ShaderMaterial;

  // Precision K-Driver holographic seals & gyroscopic Henshin rings
  ringGroundMesh: THREE.Mesh;
  ringUpperMesh: THREE.Mesh;
  ringGyroAMesh: THREE.Mesh;
  ringGyroBMesh: THREE.Mesh;
  ringUniforms: {
    uTime: { value: number };
    uProgress: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
    uOpacity: { value: number };
    uRingStyle: { value: number };
  };
  ringMaterial: THREE.ShaderMaterial;

  // Glowing Voronoi ground fracture/scorch decal
  scorchMesh: THREE.Mesh;
  scorchUniforms: {
    uTime: { value: number };
    uProgress: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
    uOpacity: { value: number };
  };
  scorchMaterial: THREE.ShaderMaterial;

  // Incandescent flashbang / belt core sphere
  flashCoreMesh: THREE.Mesh;
  flashUniforms: {
    uColor: { value: THREE.Color };
    uOpacity: { value: number };
  };
  flashMaterial: THREE.ShaderMaterial;
}

/**
 * Builds a high-resolution organic flared hourglass plasma vortex column (32 vertical x 36 radial)
 * that smoothly flares at floor & sky — zero hard cylinder silhouettes!
 */
function buildFlaredVortexColumnGeometry(height = 11.5): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = t * height;
    // Wide flared energy root at ground -> cinched waist -> flaring roaring crown into sky
    const baseFlare = Math.exp(-t * 5.2) * 0.85;
    const upperFlare = Math.pow(t, 1.8) * 0.92;
    const radius = 0.62 + baseFlare + upperFlare;
    pts.push(new THREE.Vector2(radius, y));
  }
  return new THREE.LatheGeometry(pts, 36);
}

/**
 * Builds a sleek twisting vertical helical ribbon spiraling upward from ground to height.
 */
function buildVerticalHelixRibbonGeometry(
  phaseOffset: number,
  turns = 2.6,
  height = 10.5,
  baseRadius = 1.05,
  width = 0.34
): THREE.BufferGeometry {
  const segs = 56;
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const uvs = new Float32Array((segs + 1) * 2 * 2);
  const indices = new Uint16Array(segs * 6);

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const angle = phaseOffset + t * turns * Math.PI * 2;
    const radius = baseRadius * (0.78 + Math.sin(t * Math.PI * 0.85) * 0.48 + t * 0.35);
    const y = t * height;
    const taper = Math.sin(t * Math.PI) * 0.88 + 0.12;
    const halfW = width * 0.5 * taper;

    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const nx = Math.cos(angle) * halfW;
    const nz = Math.sin(angle) * halfW;

    const v0 = i * 2;
    const v1 = v0 + 1;
    positions[v0 * 3] = cx - nx;
    positions[v0 * 3 + 1] = y - halfW * 0.45;
    positions[v0 * 3 + 2] = cz - nz;
    uvs[v0 * 2] = 0;
    uvs[v0 * 2 + 1] = t;

    positions[v1 * 3] = cx + nx;
    positions[v1 * 3 + 1] = y + halfW * 0.45;
    positions[v1 * 3 + 2] = cz + nz;
    uvs[v1 * 2] = 1;
    uvs[v1 * 2 + 1] = t;

    if (i < segs) {
      const idx = i * 6;
      indices[idx] = v0;
      indices[idx + 1] = v1;
      indices[idx + 2] = v0 + 2;
      indices[idx + 3] = v1;
      indices[idx + 4] = v1 + 2;
      indices[idx + 5] = v0 + 2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an organic curved wind-shear tornado profile (dense vertical rings for GLSL vertex sway).
 */
function buildOrganicCycloneGeometry(height = 5.4): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = t * height;
    const r = 0.28 + Math.pow(t, 1.35) * 1.48 + Math.sin(t * Math.PI * 2.0) * 0.1;
    pts.push(new THREE.Vector2(r, y));
  }
  return new THREE.LatheGeometry(pts, 32);
}

/**
 * Builds a razor-sharp curved crescent energy slash blade (replaces chunky TorusGeometry donuts!).
 */
function buildTaperedCrescentBladeGeometry(
  arcSpan = Math.PI * 1.38,
  innerRadius = 0.52,
  outerRadius = 1.18
): THREE.BufferGeometry {
  const segs = 36;
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const uvs = new Float32Array((segs + 1) * 2 * 2);
  const indices = new Uint16Array(segs * 6);

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const angle = (t - 0.5) * arcSpan;
    const pinch = Math.sin(t * Math.PI);
    const rOut = innerRadius + (outerRadius - innerRadius) * (0.25 + 0.75 * Math.pow(pinch, 0.7));
    const rIn = innerRadius + (outerRadius - innerRadius) * 0.14 * (1 - pinch);
    const lift = Math.sin(t * Math.PI) * 0.16;

    const v0 = i * 2;
    const v1 = v0 + 1;
    positions[v0 * 3] = Math.cos(angle) * rIn;
    positions[v0 * 3 + 1] = -lift * 0.35;
    positions[v0 * 3 + 2] = Math.sin(angle) * rIn;
    uvs[v0 * 2] = t;
    uvs[v0 * 2 + 1] = 0;

    positions[v1 * 3] = Math.cos(angle) * rOut;
    positions[v1 * 3 + 1] = lift;
    positions[v1 * 3 + 2] = Math.sin(angle) * rOut;
    uvs[v1 * 2] = t;
    uvs[v1 * 2 + 1] = 1;

    if (i < segs) {
      const idx = i * 6;
      indices[idx] = v0;
      indices[idx + 1] = v1;
      indices[idx + 2] = v0 + 2;
      indices[idx + 3] = v1;
      indices[idx + 4] = v1 + 2;
      indices[idx + 5] = v0 + 2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an organic jagged cluster of curved crystal/briar spires (replaces raw 5-sided ConeGeometry!).
 * Each spire bends organically along its spine with twisted natural rock/thorn ridges.
 */
function buildOrganicSpireClusterGeometry(spireCount = 12): THREE.BufferGeometry {
  const rings = 7;
  const radialSegs = 8;
  const vertsPerSpire = (rings + 1) * (radialSegs + 1);
  const trisPerSpire = rings * radialSegs * 2;

  const positions = new Float32Array(spireCount * vertsPerSpire * 3);
  const uvs = new Float32Array(spireCount * vertsPerSpire * 2);
  const indices = new Uint16Array(spireCount * trisPerSpire * 3);

  let vCursor = 0;
  let iCursor = 0;

  for (let s = 0; s < spireCount; s++) {
    const baseAngle = (s / spireCount) * Math.PI * 2 + Math.sin(s * 3.7) * 0.14;
    const isOuter = s % 2 === 0;
    const radialDist = isOuter ? 0.88 + (s % 3) * 0.14 : 0.44 + (s % 3) * 0.1;
    const rootX = Math.sin(baseAngle) * radialDist;
    const rootZ = Math.cos(baseAngle) * radialDist;
    const height = (isOuter ? 2.35 : 1.75) + ((s * 29) % 10) * 0.09;
    const baseThick = isOuter ? 0.28 : 0.22;
    const tiltOut = isOuter ? 0.56 : 0.24;
    const curveSide = ((s % 2 === 0 ? 1 : -1) * 0.26);
    const twistRate = (s % 2 === 0 ? 1 : -1) * 1.15;

    const dirX = Math.sin(baseAngle);
    const dirZ = Math.cos(baseAngle);
    const tanX = Math.cos(baseAngle);
    const tanZ = -Math.sin(baseAngle);

    const startVert = vCursor;

    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      // Curved organic spine bending outward and slightly sideways
      const bend = Math.pow(t, 1.55);
      const spineX = rootX + dirX * bend * tiltOut + tanX * Math.sin(t * Math.PI) * curveSide;
      const spineY = -0.06 + t * height;
      const spineZ = rootZ + dirZ * bend * tiltOut + tanZ * Math.sin(t * Math.PI) * curveSide;

      // Tapered organic profile with bulged mineral/root base and sharp hooked tip
      const profile = Math.pow(1 - t, 0.82) * (1.0 + Math.exp(-t * 6.0) * 0.45);
      const ringRadius = Math.max(0.012, baseThick * profile);

      for (let k = 0; k <= radialSegs; k++) {
        const u = k / radialSegs;
        const phi = u * Math.PI * 2 + t * twistRate + s * 0.9;
        // Organic crystalline/thorny ridge irregularity (no uniform cone cross-section!)
        const ridge = 0.78 + 0.32 * Math.sin(phi * 3.0 + t * 4.5) + 0.16 * Math.cos(phi * 5.0 - s);
        const rr = ringRadius * ridge;

        positions[vCursor * 3] = spineX + Math.cos(phi) * rr;
        positions[vCursor * 3 + 1] = spineY;
        positions[vCursor * 3 + 2] = spineZ + Math.sin(phi) * rr;
        uvs[vCursor * 2] = u;
        uvs[vCursor * 2 + 1] = t;
        vCursor++;
      }
    }

    const rowStride = radialSegs + 1;
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < radialSegs; k++) {
        const a = startVert + r * rowStride + k;
        const b = a + 1;
        const c = a + rowStride;
        const d = c + 1;
        indices[iCursor++] = a;
        indices[iCursor++] = c;
        indices[iCursor++] = b;
        indices[iCursor++] = b;
        indices[iCursor++] = c;
        indices[iCursor++] = d;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds one sweeping feathered Tokusatsu plasma wing fan (mirrored for left/right Ultimate Awakening wings!).
 */
function buildPlasmaWingGeometry(side: 1 | -1): THREE.BufferGeometry {
  const segsX = 18;
  const segsY = 10;
  const verts = (segsX + 1) * (segsY + 1);
  const positions = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const indices = new Uint16Array(segsX * segsY * 6);

  let vc = 0;
  for (let iy = 0; iy <= segsY; iy++) {
    const v = iy / segsY; // 0 = lower trailing edge, 1 = upper leading spine
    for (let ix = 0; ix <= segsX; ix++) {
      const u = ix / segsX; // 0 = shoulder root, 1 = sweeping wingtip
      const span = u * 3.15;
      const archY = Math.sin(u * Math.PI * 0.78) * 1.45 + u * 0.72;
      const chord = (0.35 + Math.sin(u * Math.PI * 0.85) * 1.15) * (1.0 - u * 0.35);
      const y = archY - (1.0 - v) * chord;
      const sweepBack = -0.35 - u * u * 1.35 - (1.0 - v) * 0.35;
      const cup = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.22;

      positions[vc * 3] = side * (0.28 + span);
      positions[vc * 3 + 1] = 1.25 + y;
      positions[vc * 3 + 2] = sweepBack + cup;
      uvs[vc * 2] = u;
      uvs[vc * 2 + 1] = v;
      vc++;
    }
  }

  let ic = 0;
  const stride = segsX + 1;
  for (let iy = 0; iy < segsY; iy++) {
    for (let ix = 0; ix < segsX; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[ic++] = a;
      indices[ic++] = b;
      indices[ic++] = c;
      indices[ic++] = b;
      indices[ic++] = d;
      indices[ic++] = c;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// SHADER 1: Vertex-Displaced 3D Volumetric Pyrotechnic Fireball (Boiling Fire -> Soot!)
// ---------------------------------------------------------------------------
const FIREBALL_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uSeed;

  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying vec3 vObjDir;
  varying float vHeightNorm;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }

  void main() {
    vec3 sphereDir = normalize(position);
    // Low-frequency smooth volumetric silhouette billowing (zero spiky triangle folding!)
    float macroBillow =
      noise3(sphereDir * 1.9 + vec3(uSeed, -uTime * 2.1, uSeed * 0.63)) * 0.7 +
      noise3(sphereDir * 3.4 + vec3(uTime * 1.1, -uTime * 3.2, uSeed)) * 0.3;

    float displace = (macroBillow - 0.38) * (0.34 + uProgress * 0.22);
    vec3 displaced = position + sphereDir * displace;
    displaced.y += max(0.0, sphereDir.y) * 0.18 * uProgress;

    vObjDir = sphereDir;
    vHeightNorm = clamp(sphereDir.y * 0.5 + 0.5, 0.0, 1.0);

    vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
    vNormalView = normalize(normalMatrix * sphereDir);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const FIREBALL_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uSeed;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  uniform float uElementTint;

  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying vec3 vObjDir;
  varying float vHeightNorm;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }

  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.54;
    for (int i = 0; i < 4; i++) {
      v += a * noise3(p);
      p = p * 2.05 + vec3(3.1, 1.7, 5.3);
      a *= 0.48;
    }
    return v;
  }

  void main() {
    float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    // Soft feathered outer edge so volumetric fireball has zero hard polygon border
    float edgeSoft = smoothstep(0.08, 0.52, ndv);

    // Sub-pixel 4-octave 3D FBM boiling fire & rolling smoke detail (100% ZERO triangle facets!)
    vec3 dir = normalize(vObjDir);
    float pxNoise = fbm3(dir * 2.75 + vec3(uSeed, -uTime * 2.85, uSeed * 0.63));

    // Pyrotechnic cooling curve: scorching gold-orange crevices wrapped in dark rolling charcoal soot!
    float tempCool = 1.0 - smoothstep(0.14, 0.8, uProgress);
    float creviceHeat = clamp(pow(max(0.0, 1.0 - pxNoise), 1.32) * 1.52 + ndv * 0.28, 0.0, 1.35) * (0.28 + 0.92 * tempCool);

    vec3 sootDark = vec3(0.032, 0.028, 0.034);
    vec3 sootLit = vec3(0.16, 0.14, 0.135);
    vec3 smokeCol = mix(sootDark, sootLit, clamp(vHeightNorm * 0.6 + (1.0 - ndv) * 0.4, 0.0, 1.0));

    // Authentic Tokusatsu gasoline fireball blackbody palette subtly infused with Rider element hue
    vec3 fieryRed = mix(vec3(0.86, 0.11, 0.015), uColorA * 0.85, uElementTint * 0.45);
    vec3 fieryOrange = mix(vec3(1.0, 0.44, 0.05), uColorB * 1.05, uElementTint * 0.4);
    vec3 whiteHot = vec3(1.0, 0.92, 0.72);

    vec3 fireCol = mix(fieryRed, fieryOrange, smoothstep(0.24, 0.62, creviceHeat));
    fireCol = mix(fireCol, whiteHot, smoothstep(0.76, 1.12, creviceHeat));

    float fireMask = smoothstep(0.26 + uProgress * 0.42, 0.68, creviceHeat);
    vec3 col = mix(smokeCol, fireCol * 1.58, fireMask);

    // Erode billowing clouds organically at the end of explosion
    float erosion = smoothstep(uProgress * 0.82 - 0.12, uProgress * 0.82 + 0.26, pxNoise + 0.18);
    float alpha = edgeSoft * erosion * uOpacity * mix(0.84, 0.96, fireMask);
    if (alpha < 0.02) discard;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
  }
`;

// ---------------------------------------------------------------------------
// SHADER 2: Vertex-Displaced Organic Energy Shader (Vortex, Ribbons, Cyclone, Spires, Wings, Void)
// ---------------------------------------------------------------------------
const ORGANIC_ENERGY_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uMode;
  uniform float uDisplaceAmp;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vNoiseBias;

  void main() {
    vUv = uv;
    vec3 pos = position;
    float wave = 0.0;

    if (uDisplaceAmp > 0.001) {
      if (uMode < 1.5 && uMode > 0.5) {
        // Organic roaring sky-vortex / ascension shroud: twisting helical billows + upward surge
        float angle = atan(pos.z, pos.x);
        wave =
          sin(pos.y * 1.45 - uTime * 11.5 + angle * 3.0) * 0.55 +
          cos(pos.y * 2.8 - uTime * 17.0 - angle * 5.0) * 0.35;
        vec2 radialDir = normalize(pos.xz + vec2(0.0001));
        pos.xz += radialDir * wave * uDisplaceAmp;
      } else if (uMode < 2.5 && uMode > 1.5) {
        // Wind-shear cyclone / fluid crescent: swaying tornado spine + fluttering edge turbulence
        float sway = pos.y * 0.08 * uDisplaceAmp;
        pos.x += sin(pos.y * 1.4 - uTime * 12.0) * sway;
        pos.z += cos(pos.y * 1.4 - uTime * 12.0) * sway;
        wave = sin(uv.x * 18.84 + uv.y * 12.0 - uTime * 15.0) * 0.5;
        pos += normal * wave * uDisplaceAmp * 0.38;
      } else if (uMode > 4.5) {
        // Ultimate Plasma Wings: roaring fiery wingtip flutter!
        wave = sin(uv.x * 9.0 - uTime * 14.0 + uv.y * 4.5) * uv.x;
        pos.z += wave * uDisplaceAmp * 0.42;
        pos.y += cos(uv.x * 7.0 - uTime * 11.0) * uv.x * uDisplaceAmp * 0.22;
      } else {
        // General organic surface boil (Plasma Nova / Void / Crystal pulse)
        wave =
          sin(pos.x * 4.2 + uTime * 8.0) * cos(pos.y * 4.2 - uTime * 9.5) +
          sin(pos.z * 5.5 + uTime * 7.0) * 0.5;
        pos += normal * wave * uDisplaceAmp * 0.22;
      }
    }

    vNoiseBias = wave;
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const ORGANIC_ENERGY_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  uniform float uMode;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vNoiseBias;

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

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = p * 2.05 + vec2(2.3, 4.1);
      a *= 0.48;
    }
    return v;
  }

  void main() {
    float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float fresnel = pow(1.0 - ndv, 1.85);
    float pattern = 0.0;
    float edgeMask = 1.0;

    if (uMode < 0.5) {
      // 0: Plasma Dome Nova
      vec2 p = vec2(vUv.x * 9.0 + uTime * 1.8, vUv.y * 6.0 - uTime * 3.4);
      float n = fbm(p);
      pattern = mix(n * 1.1, 1.25, fresnel * 0.85);
      edgeMask = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
    } else if (uMode < 1.5) {
      // 1: Organic Sky-Vortex / Henshin Ascension Shroud / High-Voltage Pillar
      vec2 p = vec2(vUv.x * 10.0 + uTime * 2.4, vUv.y * 5.0 - uTime * 5.6);
      float flow = fbm(p);
      float streaks = sin(vUv.x * 31.416 + vUv.y * 8.0 - uTime * 13.5 + flow * 5.0) * 0.5 + 0.5;
      float bolt = smoothstep(0.28, 0.94, streaks);
      // Soft radial silhouette falloff so edges NEVER look like a crisp cylinder edge!
      float softSilhouette = smoothstep(0.05, 0.65, ndv);
      pattern = clamp(bolt * 0.78 + flow * 0.65 + (1.0 - ndv) * 0.35, 0.0, 1.4);
      edgeMask = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.42, vUv.y) * softSilhouette;
    } else if (uMode < 2.5) {
      // 2: Sweeping Helical Ribbons / Aero Cyclone / Razor Crescent Slash
      float flow = fbm(vec2(vUv.x * 10.0 - uTime * 5.2, vUv.y * 6.0 - uTime * 4.5));
      float ribbon = smoothstep(0.18, 0.88, sin((vUv.x * 12.56 + vUv.y * 16.0) - uTime * 16.0) * 0.5 + 0.5);
      pattern = clamp(ribbon * 0.72 + flow * 0.62 + fresnel * 0.35, 0.0, 1.38);
      edgeMask = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.76, vUv.y) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    } else if (uMode < 3.5) {
      // 3: Organic Jagged Crystal / Briar Spires with glowing mineral/magma veins
      float veins = fbm(vec2(vUv.x * 7.0, vUv.y * 9.0 - uTime * 3.0));
      float cracks = smoothstep(0.45, 0.82, veins);
      pattern = clamp(0.42 + vUv.y * 0.62 + cracks * 0.55 + fresnel * 0.55, 0.0, 1.45);
      edgeMask = smoothstep(0.0, 0.1, vUv.y);
    } else if (uMode < 4.5) {
      // 4: Void Singularity Event-Horizon
      float swirl = fbm(vec2(vUv.x * 10.0 + uTime * 3.8, vUv.y * 8.0 - uTime * 2.8));
      pattern = clamp(fresnel * 1.55 + swirl * 0.42, 0.0, 1.55);
      edgeMask = 1.0;
    } else {
      // 5: Roaring Ultimate Awakening Plasma Wing-Flare!
      float plume = fbm(vec2(vUv.x * 5.5 - uTime * 5.2, vUv.y * 7.5 - uTime * 2.4));
      float feathers = sin(vUv.y * 24.0 + plume * 4.5 - vUv.x * 6.0) * 0.5 + 0.5;
      float edgeFade = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.32, vUv.x) *
                       smoothstep(0.0, 0.24, vUv.y) * smoothstep(1.0, 0.78, vUv.y);
      pattern = clamp(plume * 0.85 + feathers * 0.55 + (1.0 - vUv.x) * 0.45, 0.0, 1.5);
      edgeMask = edgeFade;
    }

    vec3 col = mix(uColorA, uColorB, clamp(pattern * 0.82 + vNoiseBias * 0.12, 0.0, 1.0));
    col += vec3(1.0, 0.98, 0.94) * smoothstep(0.86, 1.38, pattern) * 1.05;

    float alpha = clamp(pattern * edgeMask * uOpacity, 0.0, 1.0);
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(col * 1.55, alpha);
  }
`;

// ---------------------------------------------------------------------------
// SHADER 3: Precision K-Driver Holographic Seals, Gyro Rings & Shockwaves
// ---------------------------------------------------------------------------
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
  uniform float uRingStyle; // 0 = K-Driver rune seal, 1 = crisp gyroscopic Henshin tech ring, 2 = shockwave blast ring

  varying vec2 vUv;

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float r = length(centered);
    if (r > 1.0 || r < 0.12) discard;

    float angle = atan(centered.y, centered.x);
    float glow = 0.0;

    if (uRingStyle < 0.5) {
      // K-Driver Geometric Seal
      float outerBand = exp(-pow((r - 0.87) * 11.0, 2.0));
      float innerBand = exp(-pow((r - 0.58) * 15.0, 2.0)) * 0.75;
      float hexMask = abs(cos(angle * 3.0 + uTime * 1.8));
      float hexRing = exp(-pow((r - (0.68 + hexMask * 0.08)) * 18.0, 2.0)) * 0.65;
      float runeTicks = smoothstep(0.25, 0.88, sin(angle * 18.0 + uTime * 6.5) * 0.5 + 0.5);
      float spokes = smoothstep(0.65, 0.98, sin(angle * 6.0 - uTime * 4.5) * 0.5 + 0.5) *
                     exp(-pow((r - 0.72) * 9.0, 2.0));
      glow = outerBand * (0.72 + 0.35 * runeTicks) + innerBand * runeTicks + hexRing + spokes * 0.75;
    } else if (uRingStyle < 1.5) {
      // Gyroscopic Henshin Armor Lock-On Ring (razor-thin hi-tech light arcs!)
      float thinBand = exp(-pow((r - 0.88) * 26.0, 2.0));
      float secondBand = exp(-pow((r - 0.76) * 32.0, 2.0)) * 0.6;
      float arcSweep = smoothstep(-0.35, 0.85, sin(angle * 3.0 - uTime * 11.0));
      float ticks = smoothstep(0.55, 0.95, sin(angle * 36.0 + uTime * 9.0));
      glow = thinBand * (0.55 + 0.7 * arcSweep) + secondBand * (0.35 + 0.65 * ticks);
    } else {
      // Fast expanding pyrotechnic ground shockwave wave!
      float front = exp(-pow((r - 0.86) * 12.0, 2.0));
      float trail = smoothstep(0.45, 0.86, r) * smoothstep(1.0, 0.86, r) * 0.45;
      float streaks = 0.75 + 0.25 * sin(angle * 22.0 + r * 14.0 - uTime * 10.0);
      glow = (front + trail) * streaks;
    }

    vec3 col = mix(uColorA, uColorB, clamp(glow * 0.7, 0.0, 1.0));
    col += vec3(1.0, 0.98, 0.92) * smoothstep(0.85, 1.35, glow) * 0.9;

    float alpha = clamp(glow * uOpacity, 0.0, 1.0);
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(col * 1.65, alpha);
  }
`;

// ---------------------------------------------------------------------------
// SHADER 4: Glowing Voronoi Ground Scorch & Cracked Floor Rupture
// ---------------------------------------------------------------------------
const SCORCH_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;

  varying vec2 vUv;

  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  float voronoiCrack(vec2 x) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash22(n + g);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
    return sqrt(d2) - sqrt(d1);
  }

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float dist = length(centered);
    if (dist > 1.0) discard;

    float radialMask = smoothstep(1.0, 0.18, dist);
    float crackDist = voronoiCrack(centered * 4.4);
    float crackGlow = smoothstep(0.16, 0.015, crackDist) * radialMask;
    float hotCenter = exp(-dist * dist * 4.5) * (1.0 - uProgress * 0.65);

    float pulse = 0.85 + 0.15 * sin(uTime * 11.0 - dist * 8.0);
    vec3 col = mix(uColorA, uColorB, clamp(crackGlow + hotCenter, 0.0, 1.0));
    col += vec3(1.0, 0.96, 0.85) * smoothstep(0.65, 1.15, crackGlow + hotCenter) * 0.85;

    float alpha = clamp((crackGlow * 1.15 + hotCenter * 0.72) * pulse * uOpacity, 0.0, 1.0);
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(col * 1.75, alpha);
  }
`;

// ---------------------------------------------------------------------------
// SHADER 5: Radial Incandescent Flashbang / Driver Core Flash
// ---------------------------------------------------------------------------
const FLASH_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const FLASH_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float core = pow(ndv, 1.85);
    float alpha = core * uOpacity;
    if (alpha < 0.015) discard;
    vec3 col = mix(uColor * 1.8, vec3(1.0, 0.99, 0.95) * 3.0, pow(ndv, 1.1));
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/**
 * Zero-allocation, object-pooled Live-Action Tokusatsu 3D Volumetric Shader VFX engine powering:
 * - Dedicated Super Form Henshin (Belt Core Flash + Gyroscopic Armor Rings + Organic Ascension Shroud)
 * - Dedicated Ultimate Form Awakening (3-Tier Rising Seals + Roaring Plasma Wings + Voronoi Ground Cracks)
 * - Multi-Lobe Vertex-Displaced Volumetric 3D Pyrotechnic Fireballs (After-Rider-Kick & Beat 3 Explosions)
 * - Vertex-Displaced Organic Ultimate Finisher Sky-Vortex + Twin Helical Filaments + Impact Fireball
 * - All 10 Upgraded Element Skills (zero raw cones or rigid cylinders!) + Pooled Dynamic Flash Lights
 */
export class ElementSkillVfx {
  public readonly root = new THREE.Group();

  private readonly sharedGeometries: THREE.BufferGeometry[] = [];
  private readonly slots: PooledVfxSlot[] = [];
  private readonly flashLights: PooledFlashLight[] = [];
  private readonly scratchPrimaryColor = new THREE.Color();
  private readonly scratchEmissiveColor = new THREE.Color();
  private readonly scratchFlashColor = new THREE.Color();
  private cursor = 0;
  private lightCursor = 0;

  constructor() {
    this.root.name = 'ElementSkillVfxRoot';

    // Shared high-resolution organic procedural geometries (indexed smooth spheres — zero flat-shaded cracks, zero cones!)
    const fireballLobeGeo = new THREE.SphereGeometry(1.0, 36, 24);
    const vortexColumnGeo = buildFlaredVortexColumnGeometry(11.5);
    const helixGeoA = buildVerticalHelixRibbonGeometry(0, 2.75, 10.8, 1.05, 0.36);
    const helixGeoB = buildVerticalHelixRibbonGeometry(Math.PI, 2.5, 10.4, 1.32, 0.28);
    const cycloneGeo = buildOrganicCycloneGeometry(5.4);
    const crescentGeo = buildTaperedCrescentBladeGeometry(Math.PI * 1.42, 0.48, 1.24);
    const spireClusterGeo = buildOrganicSpireClusterGeometry(12);
    const voidCoreGeo = new THREE.SphereGeometry(0.84, 28, 18);
    const wingLeftGeo = buildPlasmaWingGeometry(-1);
    const wingRightGeo = buildPlasmaWingGeometry(1);
    const ringPlaneGeo = new THREE.PlaneGeometry(2.0, 2.0);
    ringPlaneGeo.rotateX(-Math.PI / 2);
    const gyroRingPlaneGeo = new THREE.PlaneGeometry(2.0, 2.0);
    const flashCoreGeo = new THREE.SphereGeometry(1.0, 20, 14);

    this.sharedGeometries.push(
      fireballLobeGeo,
      vortexColumnGeo,
      helixGeoA,
      helixGeoB,
      cycloneGeo,
      crescentGeo,
      spireClusterGeo,
      voidCoreGeo,
      wingLeftGeo,
      wingRightGeo,
      ringPlaneGeo,
      gyroRingPlaneGeo,
      flashCoreGeo
    );

    // Pooled Dynamic PointLights for genuine live-action explosion/Henshin flash lighting!
    for (let i = 0; i < FLASH_LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xff8a3d, 0, 18, 1.7);
      light.position.set(0, -100, 0);
      this.root.add(light);
      this.flashLights.push({
        light,
        elapsed: 0,
        duration: 0.4,
        peakIntensity: 0,
        active: false,
      });
    }

    for (let i = 0; i < POOL_SIZE; i++) {
      const fireballUniforms = {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uColorA: { value: new THREE.Color(0xe11d48) },
        uColorB: { value: new THREE.Color(0xff5722) },
        uOpacity: { value: 1 },
        uElementTint: { value: 0.35 },
        uSeed: { value: i * 11.37 },
      };
      const fireballMaterial = new THREE.ShaderMaterial({
        uniforms: fireballUniforms,
        vertexShader: FIREBALL_VERTEX_SHADER,
        fragmentShader: FIREBALL_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.FrontSide,
      });

      const energyUniforms = {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uColorA: { value: new THREE.Color(0xe11d48) },
        uColorB: { value: new THREE.Color(0xff5722) },
        uOpacity: { value: 1 },
        uMode: { value: 0 },
        uDisplaceAmp: { value: 0.2 },
      };
      const energyMaterial = new THREE.ShaderMaterial({
        uniforms: energyUniforms,
        vertexShader: ORGANIC_ENERGY_VERTEX_SHADER,
        fragmentShader: ORGANIC_ENERGY_FRAGMENT_SHADER,
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
        uRingStyle: { value: 0 },
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

      const scorchUniforms = {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uColorA: { value: new THREE.Color(0xf97316) },
        uColorB: { value: new THREE.Color(0xfde047) },
        uOpacity: { value: 1 },
      };
      const scorchMaterial = new THREE.ShaderMaterial({
        uniforms: scorchUniforms,
        vertexShader: RING_VERTEX_SHADER,
        fragmentShader: SCORCH_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const flashUniforms = {
        uColor: { value: new THREE.Color(0xfff7ed) },
        uOpacity: { value: 0 },
      };
      const flashMaterial = new THREE.ShaderMaterial({
        uniforms: flashUniforms,
        vertexShader: FLASH_VERTEX_SHADER,
        fragmentShader: FLASH_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
      });

      const group = new THREE.Group();
      group.visible = false;

      const fireballMain = new THREE.Mesh(fireballLobeGeo, fireballMaterial);
      const fireballCrown = new THREE.Mesh(fireballLobeGeo, fireballMaterial);
      const fireballSide = new THREE.Mesh(fireballLobeGeo, fireballMaterial);
      fireballMain.renderOrder = 3;
      fireballCrown.renderOrder = 3;
      fireballSide.renderOrder = 3;

      const vortexColumnMesh = new THREE.Mesh(vortexColumnGeo, energyMaterial);
      const helixMeshA = new THREE.Mesh(helixGeoA, energyMaterial);
      const helixMeshB = new THREE.Mesh(helixGeoB, energyMaterial);
      const cycloneMesh = new THREE.Mesh(cycloneGeo, energyMaterial);
      const crescentMeshA = new THREE.Mesh(crescentGeo, energyMaterial);
      const crescentMeshB = new THREE.Mesh(crescentGeo, energyMaterial);
      const spireClusterMesh = new THREE.Mesh(spireClusterGeo, energyMaterial);
      const voidCoreMesh = new THREE.Mesh(voidCoreGeo, energyMaterial);
      const wingLeftMesh = new THREE.Mesh(wingLeftGeo, energyMaterial);
      const wingRightMesh = new THREE.Mesh(wingRightGeo, energyMaterial);

      const ringGroundMesh = new THREE.Mesh(ringPlaneGeo, ringMaterial);
      ringGroundMesh.position.y = 0.08;
      const ringUpperMesh = new THREE.Mesh(ringPlaneGeo, ringMaterial);
      ringUpperMesh.position.y = 0.16;
      const ringGyroAMesh = new THREE.Mesh(gyroRingPlaneGeo, ringMaterial);
      const ringGyroBMesh = new THREE.Mesh(gyroRingPlaneGeo, ringMaterial);

      const scorchMesh = new THREE.Mesh(ringPlaneGeo, scorchMaterial);
      scorchMesh.position.y = 0.045;
      const flashCoreMesh = new THREE.Mesh(flashCoreGeo, flashMaterial);
      flashCoreMesh.renderOrder = 8;

      const allMeshes = [
        fireballMain,
        fireballCrown,
        fireballSide,
        vortexColumnMesh,
        helixMeshA,
        helixMeshB,
        cycloneMesh,
        crescentMeshA,
        crescentMeshB,
        spireClusterMesh,
        voidCoreMesh,
        wingLeftMesh,
        wingRightMesh,
        ringGroundMesh,
        ringUpperMesh,
        ringGyroAMesh,
        ringGyroBMesh,
        scorchMesh,
        flashCoreMesh,
      ];
      for (let m = 0; m < allMeshes.length; m++) {
        allMeshes[m]!.frustumCulled = false;
        group.add(allMeshes[m]!);
      }

      this.root.add(group);

      this.slots.push({
        active: false,
        kind: 'DOME_NOVA',
        elapsed: 0,
        duration: 0.85,
        baseRadius: 4.5,
        baseYaw: 0,
        group,
        fireballMain,
        fireballCrown,
        fireballSide,
        fireballUniforms,
        fireballMaterial,
        vortexColumnMesh,
        helixMeshA,
        helixMeshB,
        cycloneMesh,
        crescentMeshA,
        crescentMeshB,
        spireClusterMesh,
        voidCoreMesh,
        wingLeftMesh,
        wingRightMesh,
        energyUniforms,
        energyMaterial,
        ringGroundMesh,
        ringUpperMesh,
        ringGyroAMesh,
        ringGyroBMesh,
        ringUniforms,
        ringMaterial,
        scorchMesh,
        scorchUniforms,
        scorchMaterial,
        flashCoreMesh,
        flashUniforms,
        flashMaterial,
      });
    }
  }

  /**
   * Dedicated Super Form Henshin VFX:
   * Belt Core Flash + Dual Gyroscopic K-Driver Armor Rings + Organic Energy Ascension Shroud + Dynamic Light.
   */
  public spawnHenshinSuper(elementId: ElementId, x: number, z: number, yaw: number): void {
    this.activateSlot(elementId, 'HENSHIN_SUPER', x, z, yaw, 5.4, 1.25);
    const cfg = getElementConfig(elementId);
    this.scratchFlashColor.set(cfg.emissiveColor);
    this.triggerFlashLight(x, 1.5, z, this.scratchFlashColor.getHex(), 11.5, 0.55);
  }

  /**
   * Dedicated Ultimate Form Awakening VFX:
   * Golden-Elemental Corona Flash + 3-Tier Rising K-Driver Seals + Twin Roaring Plasma Wings + Voronoi Ground Cracks.
   */
  public spawnHenshinUltimate(elementId: ElementId, x: number, z: number, yaw: number): void {
    this.activateSlot(elementId, 'HENSHIN_ULTIMATE', x, z, yaw, 7.2, 1.55);
    const cfg = getElementConfig(elementId);
    this.scratchFlashColor.set(cfg.emissiveColor).lerp(this.scratchPrimaryColor.setHex(0xfef08a), 0.4);
    this.triggerFlashLight(x, 1.9, z, this.scratchFlashColor.getHex(), 16.5, 0.72);
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
    const duration = isSuper ? 0.98 : 0.82;
    this.activateSlot(elementId, kind, x, z, yaw, radius, duration);
    const cfg = getElementConfig(elementId);
    this.scratchFlashColor.set(cfg.emissiveColor);
    this.triggerFlashLight(x, 1.4, z, this.scratchFlashColor.getHex(), isSuper ? 8.5 : 5.5, 0.36);
  }

  /**
   * Temporarily reveals slot 0's shader layers off-screen so `renderer.compile()` pre-warms
   * all 5 custom GLSL shaders during loading (zero first-use frame hitch!).
   */
  public setWarmupVisible(visible: boolean): void {
    const slot = this.slots[0];
    if (!slot) return;
    slot.group.visible = visible;
    if (visible) {
      slot.group.position.set(0, -45, 0);
      slot.fireballMain.visible = true;
      slot.vortexColumnMesh.visible = true;
      slot.ringGroundMesh.visible = true;
      slot.scorchMesh.visible = true;
      slot.flashCoreMesh.visible = true;
      slot.wingLeftMesh.visible = true;
    } else {
      slot.fireballMain.visible = false;
      slot.vortexColumnMesh.visible = false;
      slot.ringGroundMesh.visible = false;
      slot.scorchMesh.visible = false;
      slot.flashCoreMesh.visible = false;
      slot.wingLeftMesh.visible = false;
    }
  }

  /**
   * Ultimate Skill [R] from Super Form Climax Impact:
   * Organic Flared Plasma Sky-Vortex + Twin Giant Helical Filaments + Multi-Lobe Fireball Impact + Voronoi Rupture.
   */
  public spawnFinisherClimax(elementId: ElementId, x: number, z: number, radius = 11.5): void {
    this.activateSlot(elementId, 'FINISHER_CLIMAX', x, z, 0, radius, 1.55);
    const cfg = getElementConfig(elementId);
    this.scratchFlashColor.set(cfg.emissiveColor);
    this.triggerFlashLight(x, 2.8, z, this.scratchFlashColor.getHex(), 19.0, 0.78);
  }

  /**
   * GRAND SOVEREIGN FINISHER ([R] from Ultimate Form!) — Distinct Cataclysmic Supernova:
   * 0.00-0.16s Dark-Gold Reality Implosion -> Colossal Golden-Elemental Sky-Vortex + Twin Crossed Horizon
   * X-Slash Blades + Triple Orbital Energy Rings + 3-Lobe Mega-Fireball Plume + Arena-Wide Tectonic Rupture!
   */
  public spawnGrandUltimateClimax(
    elementId: ElementId,
    x: number,
    z: number,
    yaw: number,
    radius = 15.5
  ): void {
    this.activateSlot(elementId, 'GRAND_ULTIMATE_CLIMAX', x, z, yaw, radius, 1.95);
    const cfg = getElementConfig(elementId);
    this.scratchFlashColor.set(cfg.emissiveColor).lerp(this.scratchPrimaryColor.setHex(0xfef08a), 0.55);
    this.triggerFlashLight(x, 3.4, z, this.scratchFlashColor.getHex(), 24.0, 1.15);
  }

  /**
   * Organic emerald healing vortex aura for Sylvan Sovereign's interruptible Sanctuary Mend.
   */
  public spawnSanctuaryMendPulse(x: number, z: number): void {
    this.activateSlot('flora', 'HENSHIN_SUPER', x, z, Math.random() * Math.PI * 2, 4.2, 0.95);
  }

  /**
   * Realistic Live-Action Toei Pyrotechnic Explosion (After Rider Kick, Beat 3 Back Explosions & Boss Magma Eruptions):
   * Instant Flashbang + Multi-Lobe Vertex-Displaced Boiling 3D Fireball Plume + Shockwave + Voronoi Scorch + Dynamic Light.
   */
  public spawnExplosionPillar(elementId: ElementId, x: number, z: number, scale = 3.2): void {
    this.activateSlot(elementId, 'PYRO_EXPLOSION', x, z, Math.random() * Math.PI * 2, scale, 1.25);
    const cfg = getElementConfig(elementId);
    this.scratchFlashColor.setHex(0xff8c2b).lerp(this.scratchPrimaryColor.set(cfg.emissiveColor), 0.35);
    this.triggerFlashLight(x, 2.0, z, this.scratchFlashColor.getHex(), Math.min(18, 5.5 + scale * 2.8), 0.52);
  }

  /**
   * Organic jagged crystal/briar spire eruption (used by Sylvan Sovereign Boss Briar Surge hazards!).
   */
  public spawnBriarEruption(elementId: ElementId, x: number, z: number, scale = 2.4): void {
    this.activateSlot(elementId, 'SPIKE_RING', x, z, Math.random() * Math.PI * 2, scale, 0.88);
    const cfg = getElementConfig(elementId);
    this.scratchFlashColor.set(cfg.emissiveColor);
    this.triggerFlashLight(x, 1.3, z, this.scratchFlashColor.getHex(), 7.0, 0.38);
  }

  public clearAll(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.active = false;
      slot.group.visible = false;
    }
    for (let i = 0; i < this.flashLights.length; i++) {
      const fl = this.flashLights[i]!;
      fl.active = false;
      fl.light.intensity = 0;
    }
  }

  public update(dt: number): void {
    if (dt <= 0) return;

    // Update pooled dynamic flash lights
    for (let i = 0; i < this.flashLights.length; i++) {
      const fl = this.flashLights[i]!;
      if (!fl.active) continue;
      fl.elapsed += dt;
      if (fl.elapsed >= fl.duration) {
        fl.active = false;
        fl.light.intensity = 0;
        continue;
      }
      const t = fl.elapsed / fl.duration;
      const env = t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.88, 2.0);
      fl.light.intensity = fl.peakIntensity * env;
    }

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
      const fade = p < 0.12 ? p / 0.12 : Math.max(0, 1 - (p - 0.12) / 0.88);
      const r = slot.baseRadius;

      slot.energyUniforms.uTime.value = slot.elapsed;
      slot.energyUniforms.uProgress.value = p;
      slot.energyUniforms.uOpacity.value = fade;

      slot.fireballUniforms.uTime.value = slot.elapsed;
      slot.fireballUniforms.uProgress.value = p;
      // Hand off seamlessly from 3D boiling core into soft billboard rolling smoke before p=0.78!
      slot.fireballUniforms.uOpacity.value =
        p < 0.08 ? p / 0.08 : Math.max(0, 1 - Math.pow(Math.min(1, (p - 0.08) / 0.72), 1.45));

      slot.ringUniforms.uTime.value = slot.elapsed;
      slot.ringUniforms.uProgress.value = p;
      slot.ringUniforms.uOpacity.value = fade;

      slot.scorchUniforms.uTime.value = slot.elapsed;
      slot.scorchUniforms.uProgress.value = p;
      slot.scorchUniforms.uOpacity.value = p < 0.1 ? p / 0.1 : Math.max(0, 1 - (p - 0.1) / 0.9);

      const ringScale = r * (0.36 + easeOut * 0.92);
      slot.ringGroundMesh.scale.set(ringScale, 1, ringScale);
      slot.ringGroundMesh.rotation.y = slot.elapsed * 2.2;

      switch (slot.kind) {
        case 'HENSHIN_SUPER': {
          // 1. Blazing K-Driver belt core flash (fast crisp pop!)
          const flashT = Math.min(1, p * 3.4);
          slot.flashCoreMesh.position.set(0, 1.15, 0);
          slot.flashCoreMesh.scale.setScalar(0.35 + flashT * 2.35);
          slot.flashUniforms.uOpacity.value = Math.max(0, 1 - flashT) * 1.1;

          // 2. Dual Gyroscopic K-Driver Armor Lock-On Rings orbiting & snapping inward
          const gyroRad = 2.65 - easeOut * 1.25 + p * 0.55;
          slot.ringGyroAMesh.position.set(0, 1.18 + Math.sin(p * Math.PI) * 0.35, 0);
          slot.ringGyroAMesh.scale.setScalar(gyroRad);
          slot.ringGyroAMesh.rotation.set(
            0.78 + slot.elapsed * 2.4,
            slot.baseYaw + slot.elapsed * 6.8,
            0.42
          );
          slot.ringGyroBMesh.position.set(0, 1.28 - Math.sin(p * Math.PI) * 0.25, 0);
          slot.ringGyroBMesh.scale.setScalar(gyroRad * 0.88);
          slot.ringGyroBMesh.rotation.set(
            -0.82 - slot.elapsed * 2.1,
            slot.baseYaw - slot.elapsed * 7.4,
            -0.55
          );

          // 3. Organic swirling Ascension Shroud lifting up past the Rider (zero hard tube!)
          const shroudW = 0.85 + easeOut * 1.35;
          const shroudH = 0.28 + Math.min(1, p * 2.4) * 0.55;
          slot.vortexColumnMesh.scale.set(shroudW, shroudH, shroudW);
          slot.vortexColumnMesh.rotation.y = slot.elapsed * 5.8;
          slot.energyUniforms.uOpacity.value = fade * 0.78;

          // 4. Rising K-Driver floor seal + shockwave
          slot.ringUpperMesh.position.y = 0.18 + p * 3.2;
          slot.ringUpperMesh.scale.setScalar(1.6 + easeOut * 1.4);
          slot.ringUpperMesh.rotation.y = -slot.elapsed * 5.4;
          break;
        }

        case 'HENSHIN_ULTIMATE': {
          // 1. Blinding Golden-Elemental Corona Flash
          const flashT = Math.min(1, p * 2.6);
          slot.flashCoreMesh.position.set(0, 1.3, 0);
          slot.flashCoreMesh.scale.setScalar(0.5 + flashT * 3.6);
          slot.flashUniforms.uOpacity.value = Math.max(0, 1 - flashT) * 1.35;

          // 2. Twin Roaring Volumetric Plasma Wings erupting behind the Rider!
          const wingSpread = 0.35 + easeOut * 1.12;
          const wingY = Math.sin(p * Math.PI) * 0.25;
          slot.wingLeftMesh.position.set(0, wingY, 0);
          slot.wingRightMesh.position.set(0, wingY, 0);
          slot.wingLeftMesh.rotation.set(-0.08, slot.baseYaw + 0.18 - easeOut * 0.28, -0.05);
          slot.wingRightMesh.rotation.set(-0.08, slot.baseYaw - 0.18 + easeOut * 0.28, 0.05);
          slot.wingLeftMesh.scale.setScalar(wingSpread);
          slot.wingRightMesh.scale.setScalar(wingSpread);

          // 3. Triple-tier Rising K-Driver Seals + Tilted Gyro Rings
          slot.ringGroundMesh.scale.setScalar(2.4 + easeOut * 4.4);
          slot.ringUpperMesh.position.y = 0.25 + p * 4.8;
          slot.ringUpperMesh.scale.setScalar(2.2 + easeOut * 2.4);
          slot.ringUpperMesh.rotation.y = -slot.elapsed * 6.5;

          const gyroR = 3.2 - easeOut * 1.1 + p * 0.7;
          slot.ringGyroAMesh.position.set(0, 1.45, 0);
          slot.ringGyroAMesh.scale.setScalar(gyroR);
          slot.ringGyroAMesh.rotation.set(0.95 + slot.elapsed * 2.8, slot.elapsed * 8.2, 0.35);
          slot.ringGyroBMesh.position.set(0, 1.65, 0);
          slot.ringGyroBMesh.scale.setScalar(gyroR * 0.84);
          slot.ringGyroBMesh.rotation.set(-0.88 - slot.elapsed * 2.6, -slot.elapsed * 7.8, -0.45);

          // 4. Giant Counter-Rotating Helical Ribbons + Glowing Voronoi Ground Fracture!
          const helixScale = 0.95 + easeOut * 0.95;
          slot.helixMeshA.scale.set(helixScale, 0.6 + easeOut * 0.6, helixScale);
          slot.helixMeshA.rotation.y = slot.elapsed * 7.5;
          slot.helixMeshB.scale.set(helixScale * 1.12, 0.55 + easeOut * 0.65, helixScale * 1.12);
          slot.helixMeshB.rotation.y = -slot.elapsed * 6.2;

          const scorchS = 2.6 + easeOut * 3.8;
          slot.scorchMesh.scale.set(scorchS, 1, scorchS);
          slot.scorchMesh.rotation.y = slot.baseYaw;
          break;
        }

        case 'PYRO_EXPLOSION': {
          // 1. Instant white-hot Toei detonation flashbang core!
          const flashT = Math.min(1, p * 5.2);
          slot.flashCoreMesh.position.set(0, 0.9 + p * 0.8, 0);
          slot.flashCoreMesh.scale.setScalar(r * (0.45 + flashT * 0.95));
          slot.flashUniforms.uOpacity.value = Math.max(0, 1 - flashT) * 1.3;

          // 2. Three asymmetrical overlapping Vertex-Displaced Volumetric Fireball Lobes forming a boiling mushroom plume!
          const expand = 0.34 + Math.pow(easeOut, 0.78) * 0.88;
          const mainR = r * 0.56 * expand;
          slot.fireballMain.position.set(0, mainR * 0.78 + p * r * 0.38, 0);
          slot.fireballMain.scale.set(mainR * 1.08, mainR * (0.95 + p * 0.22), mainR * 1.04);
          slot.fireballMain.rotation.set(p * 0.6, slot.baseYaw + p * 0.9, p * 0.35);

          // Rising mushroom cap surging upward faster than base
          const crownDelay = Math.max(0, (p - 0.04) / 0.96);
          const crownR = r * 0.48 * (0.28 + Math.pow(crownDelay, 0.65) * 0.98);
          const cosY = Math.cos(slot.baseYaw);
          const sinY = Math.sin(slot.baseYaw);
          slot.fireballCrown.position.set(
            sinY * r * 0.14,
            r * (0.45 + Math.pow(crownDelay, 0.72) * 1.32),
            cosY * r * 0.14
          );
          slot.fireballCrown.scale.set(crownR * 1.12, crownR * 1.06, crownR * 1.08);
          slot.fireballCrown.rotation.set(-p * 0.75, slot.baseYaw - p * 1.15, p * 0.5);

          // Offset asymmetrical side-billow lobe breaking symmetry
          const sideR = r * 0.42 * expand;
          slot.fireballSide.position.set(
            -cosY * r * 0.32 * expand,
            r * 0.38 + p * r * 0.48,
            sinY * r * 0.32 * expand
          );
          slot.fireballSide.scale.set(sideR * 1.18, sideR * 0.88, sideR * 1.05);
          slot.fireballSide.rotation.set(p * 0.5, slot.baseYaw + 1.7 + p * 0.8, -p * 0.45);

          // 3. Fast horizontal concrete shockwave + glowing Voronoi ground scorch
          const waveR = r * (0.45 + easeOut * 1.55);
          slot.ringGroundMesh.scale.set(waveR, 1, waveR);
          slot.scorchMesh.scale.set(r * 1.05, 1, r * 1.05);
          break;
        }

        case 'GRAND_ULTIMATE_CLIMAX': {
          // Stage 1 (0.00 - 0.14): Reality Implosion Core sucking light inward before Supernova release!
          if (p < 0.12) {
            const imp = p / 0.12;
            const collapse = 1.0 - imp * 0.78;
            slot.voidCoreMesh.visible = true;
            slot.voidCoreMesh.position.set(0, 2.1, 0);
            slot.voidCoreMesh.scale.setScalar(r * 0.42 * collapse);
            slot.voidCoreMesh.rotation.y = slot.elapsed * 16.0;
            slot.flashCoreMesh.position.set(0, 2.1, 0);
            slot.flashCoreMesh.scale.setScalar(r * 0.28 * (0.2 + imp * 1.4));
            slot.flashUniforms.uOpacity.value = 0.65 + imp * 0.95;
            slot.vortexColumnMesh.scale.set(0.01, 0.01, 0.01);
            slot.fireballMain.scale.setScalar(0.01);
            slot.fireballCrown.scale.setScalar(0.01);
            slot.fireballSide.scale.setScalar(0.01);
            slot.crescentMeshA.scale.setScalar(0.01);
            slot.crescentMeshB.scale.setScalar(0.01);
            break;
          }

          // Stage 2 (0.12 - 1.00): COLOSSAL GOLDEN-ELEMENTAL SUPERNOVA CATACLYSM!
          slot.voidCoreMesh.visible = false;
          const postP = (p - 0.12) / 0.88;
          const blastEase = 1 - Math.pow(1 - Math.min(1, postP * 1.65), 3);

          // Blinding golden supernova flash
          const flashT = Math.min(1, postP * 3.8);
          slot.flashCoreMesh.position.set(0, 2.2, 0);
          slot.flashCoreMesh.scale.setScalar(r * (0.28 + flashT * 0.65));
          slot.flashUniforms.uOpacity.value = Math.max(0, 1 - flashT) * 1.65;

          // Colossal flared Sky-Vortex towering into the eclipsed sky
          const beamW = r * 0.34 * (1.35 - postP * 0.45);
          slot.vortexColumnMesh.scale.set(beamW, 1.65 + postP * 0.4, beamW);
          slot.vortexColumnMesh.rotation.y = slot.elapsed * 8.2;

          // Twin Giant Counter-Rotating Helical Ribbons
          const helW = r * (0.26 + blastEase * 0.28);
          slot.helixMeshA.scale.set(helW, 1.55, helW);
          slot.helixMeshA.rotation.y = slot.elapsed * 11.2;
          slot.helixMeshB.scale.set(helW * 1.24, 1.6, helW * 1.24);
          slot.helixMeshB.rotation.y = -slot.elapsed * 9.4;

          // Twin Crossed Horizon X-Slash Waves carving outward across the arena!
          const slashR = r * (0.42 + blastEase * 0.92);
          slot.crescentMeshA.position.set(0, 2.35, 0);
          slot.crescentMeshA.scale.set(slashR, 2.2, slashR);
          slot.crescentMeshA.rotation.set(0.62, slot.baseYaw + postP * 3.8, 0.58);
          slot.crescentMeshB.position.set(0, 2.35, 0);
          slot.crescentMeshB.scale.set(slashR * 0.96, 2.2, slashR * 0.96);
          slot.crescentMeshB.rotation.set(-0.62, slot.baseYaw - postP * 3.8 + 1.57, -0.58);

          // 3-Lobe Mega-Fireball Mushroom Plume at Ground Zero
          const fbBase = r * 0.38 * (0.28 + blastEase * 0.85);
          slot.fireballMain.position.set(0, fbBase * 0.72 + postP * 2.8, 0);
          slot.fireballMain.scale.set(fbBase * 1.42, fbBase * 0.96, fbBase * 1.42);
          slot.fireballMain.rotation.y = slot.elapsed * 1.3;

          const fbTop = r * 0.32 * (0.26 + blastEase * 0.92);
          slot.fireballCrown.position.set(0.6, 1.8 + postP * 5.8, -0.5);
          slot.fireballCrown.scale.set(fbTop * 1.22, fbTop * 1.18, fbTop * 1.22);
          slot.fireballCrown.rotation.y = -slot.elapsed * 1.7;

          const fbSide = r * 0.28 * (0.24 + blastEase * 0.85);
          slot.fireballSide.position.set(-1.6 * blastEase, 1.1 + postP * 2.5, 1.4 * blastEase);
          slot.fireballSide.scale.set(fbSide * 1.25, fbSide * 0.92, fbSide * 1.18);
          slot.fireballSide.rotation.y = slot.elapsed * 1.5;

          // Triple Orbital Seals (ground + ascending crown + giant tilted celestial gyro!)
          slot.ringGroundMesh.scale.set(r * (0.55 + blastEase * 0.95), 1, r * (0.55 + blastEase * 0.95));
          slot.ringUpperMesh.position.y = 0.4 + postP * 6.4;
          slot.ringUpperMesh.scale.set(r * (0.5 + blastEase * 0.75), 1, r * (0.5 + blastEase * 0.75));
          slot.ringUpperMesh.rotation.y = -slot.elapsed * 5.8;

          const gyroR = r * (0.35 + blastEase * 0.55);
          slot.ringGyroAMesh.position.set(0, 3.2 + postP * 1.8, 0);
          slot.ringGyroAMesh.scale.setScalar(gyroR);
          slot.ringGyroAMesh.rotation.set(0.92, slot.elapsed * 4.2, 0.36);
          slot.ringGyroBMesh.position.set(0, 3.2 + postP * 1.8, 0);
          slot.ringGyroBMesh.scale.setScalar(gyroR * 0.86);
          slot.ringGyroBMesh.rotation.set(-0.88, -slot.elapsed * 4.8, -0.42);

          // Arena-Wide Glowing Voronoi Tectonic Rupture!
          slot.scorchMesh.scale.set(r * 1.02, 1, r * 1.02);
          break;
        }

        case 'FINISHER_CLIMAX': {
          // 1. Blinding Ultimate Impact Flash Core
          const flashT = Math.min(1, p * 4.0);
          slot.flashCoreMesh.position.set(0, 1.5, 0);
          slot.flashCoreMesh.scale.setScalar(r * (0.22 + flashT * 0.45));
          slot.flashUniforms.uOpacity.value = Math.max(0, 1 - flashT) * 1.4;

          // 2. Organic Flared Vertex-Displaced Sky-Vortex (NOT a straight pipe!)
          const beamW = r * 0.24 * (1.28 - p * 0.48);
          slot.vortexColumnMesh.scale.set(beamW, 1.25 + p * 0.25, beamW);
          slot.vortexColumnMesh.rotation.y = slot.elapsed * 6.8;

          // 3. Twin Giant Counter-Rotating Helical Plasma Filaments soaring into sky
          const helW = r * (0.18 + easeOut * 0.2);
          slot.helixMeshA.scale.set(helW, 1.18, helW);
          slot.helixMeshA.rotation.y = slot.elapsed * 9.5;
          slot.helixMeshB.scale.set(helW * 1.16, 1.22, helW * 1.16);
          slot.helixMeshB.rotation.y = -slot.elapsed * 7.8;

          // 4. Boiling Volumetric 3D Fireball Impact Cloud at Ground Zero
          const blastExp = 0.25 + Math.pow(easeOut, 0.8) * 0.85;
          const fbBase = r * 0.34 * blastExp;
          slot.fireballMain.position.set(0, fbBase * 0.72 + p * 2.2, 0);
          slot.fireballMain.scale.set(fbBase * 1.35, fbBase * 0.92, fbBase * 1.35);
          slot.fireballMain.rotation.y = slot.elapsed * 1.2;

          const fbTop = r * 0.28 * blastExp;
          slot.fireballCrown.position.set(0.4, 1.4 + p * 4.4, -0.35);
          slot.fireballCrown.scale.set(fbTop * 1.18, fbTop * 1.12, fbTop * 1.18);
          slot.fireballCrown.rotation.y = -slot.elapsed * 1.6;

          // 5. Dual Counter-Rotating K-Driver Ground Seals + Glowing Voronoi Crater
          slot.ringGroundMesh.scale.set(r * (0.45 + easeOut * 0.88), 1, r * (0.45 + easeOut * 0.88));
          slot.ringUpperMesh.position.y = 0.24 + p * 2.6;
          slot.ringUpperMesh.scale.set(r * (0.62 + easeOut * 0.68), 1, r * (0.62 + easeOut * 0.68));
          slot.ringUpperMesh.rotation.y = -slot.elapsed * 4.5;
          slot.scorchMesh.scale.set(r * 0.85, 1, r * 0.85);
          break;
        }

        case 'DOME_NOVA': {
          // Boiling vertex-displaced magma/solar fireball burst (replaces smooth hemisphere!)
          const exp = 0.32 + easeOut * 0.78;
          const rad = r * 0.54 * exp;
          slot.fireballMain.position.set(0, rad * 0.62 + p * 0.65, 0);
          slot.fireballMain.scale.set(rad * 1.24, rad * 0.88, rad * 1.24);
          slot.fireballMain.rotation.y = slot.elapsed * 1.8;

          const capR = r * 0.38 * exp;
          slot.fireballCrown.position.set(0, rad * 1.08 + p * 1.0, 0);
          slot.fireballCrown.scale.set(capR, capR * 0.95, capR);
          slot.fireballCrown.rotation.y = -slot.elapsed * 2.2;

          slot.ringUpperMesh.scale.set(ringScale * 1.24, 1, ringScale * 1.24);
          slot.ringUpperMesh.rotation.y = -slot.elapsed * 3.1;
          slot.scorchMesh.scale.set(r * 0.95, 1, r * 0.95);
          break;
        }

        case 'SKY_PILLAR': {
          // Organic vertex-displaced lightning/light vortex + twin rising helixes (NOT straight tube!)
          const beamW = r * 0.24 * (1.22 - p * 0.42);
          const beamH = 0.36 + Math.min(1, p * 4.2) * 0.82;
          slot.vortexColumnMesh.scale.set(beamW, beamH, beamW);
          slot.vortexColumnMesh.rotation.y = slot.elapsed * 8.5;

          slot.helixMeshA.scale.set(beamW * 1.35, beamH * 0.95, beamW * 1.35);
          slot.helixMeshA.rotation.y = -slot.elapsed * 10.5;
          slot.helixMeshB.scale.set(beamW * 1.1, beamH * 0.9, beamW * 1.1);
          slot.helixMeshB.rotation.y = slot.elapsed * 12.0;

          slot.ringUpperMesh.position.y = 0.35 + p * 5.0;
          slot.ringUpperMesh.scale.set(r * 0.68, 1, r * 0.68);
          slot.ringUpperMesh.rotation.y = -slot.elapsed * 6.0;
          slot.scorchMesh.scale.set(r * 0.72, 1, r * 0.72);
          break;
        }

        case 'CRESCENT_VORTEX': {
          // Razor-sharp curved crescent energy waves (NOT chunky donuts!)
          const arcScale = r * (0.48 + easeOut * 0.65);
          slot.crescentMeshA.position.y = 1.05;
          slot.crescentMeshA.scale.set(arcScale, 1.45, arcScale);
          slot.crescentMeshA.rotation.set(0.24, slot.baseYaw + slot.elapsed * 11.5, 0.14);
          slot.crescentMeshB.position.y = 1.72;
          slot.crescentMeshB.scale.set(arcScale * 0.86, 1.25, arcScale * 0.86);
          slot.crescentMeshB.rotation.set(-0.28, slot.baseYaw - slot.elapsed * 9.5 + 1.8, -0.18);
          break;
        }

        case 'CYCLONE_FUNNEL': {
          // Organic swaying wind-shear funnel + double wind helixes (NOT inverted straight cone!)
          const funnelW = r * (0.32 + easeOut * 0.42);
          const funnelH = 0.45 + easeOut * 0.92;
          slot.cycloneMesh.scale.set(funnelW, funnelH, funnelW);
          slot.cycloneMesh.rotation.y = slot.elapsed * 12.5;
          slot.helixMeshA.scale.set(funnelW * 0.85, 0.5 + easeOut * 0.38, funnelW * 0.85);
          slot.helixMeshA.rotation.y = slot.elapsed * 15.0;
          slot.ringUpperMesh.position.y = 1.4 + p * 2.6;
          slot.ringUpperMesh.scale.set(funnelW * 1.25, 1, funnelW * 1.25);
          slot.ringUpperMesh.rotation.y = slot.elapsed * 9.0;
          break;
        }

        case 'SPIKE_RING': {
          // Organic curved jagged crystal/briar spire eruption + cracked glowing ground!
          const spikeRadial = r * 0.66;
          const riseT = Math.min(1, p * 4.4);
          const spikeY = (1 - Math.pow(1 - riseT, 3)) * (1.15 + r * 0.2);
          slot.spireClusterMesh.scale.set(spikeRadial, spikeY, spikeRadial);
          slot.spireClusterMesh.rotation.y = slot.baseYaw + p * 0.22;
          slot.scorchMesh.scale.set(r * 0.92, 1, r * 0.92);
          break;
        }

        case 'VOID_SINGULARITY': {
          const corePulse = r * 0.34 * (0.55 + Math.sin(p * Math.PI) * 0.82);
          slot.voidCoreMesh.position.y = 1.4;
          slot.voidCoreMesh.scale.setScalar(corePulse);
          slot.voidCoreMesh.rotation.y = slot.elapsed * 4.5;
          const orbitScale = r * (0.45 + easeOut * 0.58);
          slot.crescentMeshA.position.y = 1.4;
          slot.crescentMeshA.scale.set(orbitScale, 1.35, orbitScale);
          slot.crescentMeshA.rotation.set(0.68, slot.elapsed * 8.8, 0.42);
          slot.crescentMeshB.position.y = 1.4;
          slot.crescentMeshB.scale.set(orbitScale * 0.88, 1.25, orbitScale * 0.88);
          slot.crescentMeshB.rotation.set(-0.74, -slot.elapsed * 7.4, -0.35);
          slot.scorchMesh.scale.set(r * 0.85, 1, r * 0.85);
          break;
        }
      }
    }
  }

  public dispose(): void {
    this.clearAll();
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.fireballMaterial.dispose();
      slot.energyMaterial.dispose();
      slot.ringMaterial.dispose();
      slot.scorchMaterial.dispose();
      slot.flashMaterial.dispose();
    }
    for (let i = 0; i < this.sharedGeometries.length; i++) {
      this.sharedGeometries[i]!.dispose();
    }
    this.sharedGeometries.length = 0;
  }

  private triggerFlashLight(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    peakIntensity: number,
    duration: number
  ): void {
    const fl = this.flashLights[this.lightCursor % this.flashLights.length]!;
    this.lightCursor++;
    fl.active = true;
    fl.elapsed = 0;
    fl.duration = duration;
    fl.peakIntensity = peakIntensity;
    fl.light.color.setHex(colorHex);
    fl.light.position.set(x, y, z);
    fl.light.intensity = peakIntensity * 0.65;
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

    // Reset all uniforms cleanly (Zero-Allocation)
    chosen.fireballUniforms.uColorA.value.copy(this.scratchPrimaryColor);
    chosen.fireballUniforms.uColorB.value.copy(this.scratchEmissiveColor);
    chosen.fireballUniforms.uTime.value = 0;
    chosen.fireballUniforms.uProgress.value = 0;
    chosen.fireballUniforms.uOpacity.value = 1;
    chosen.fireballUniforms.uElementTint.value = kind === 'PYRO_EXPLOSION' ? 0.34 : 0.68;
    chosen.fireballUniforms.uSeed.value = Math.random() * 50.0;

    chosen.energyUniforms.uColorA.value.copy(this.scratchPrimaryColor);
    chosen.energyUniforms.uColorB.value.copy(this.scratchEmissiveColor);
    chosen.energyUniforms.uTime.value = 0;
    chosen.energyUniforms.uProgress.value = 0;
    chosen.energyUniforms.uOpacity.value = 1;
    chosen.energyUniforms.uDisplaceAmp.value = 0.22;

    chosen.ringUniforms.uColorA.value.copy(this.scratchPrimaryColor);
    chosen.ringUniforms.uColorB.value.copy(this.scratchEmissiveColor);
    chosen.ringUniforms.uTime.value = 0;
    chosen.ringUniforms.uProgress.value = 0;
    chosen.ringUniforms.uOpacity.value = 1;
    chosen.ringUniforms.uRingStyle.value = 0;

    chosen.scorchUniforms.uColorA.value.copy(this.scratchPrimaryColor);
    chosen.scorchUniforms.uColorB.value.copy(this.scratchEmissiveColor);
    chosen.scorchUniforms.uTime.value = 0;
    chosen.scorchUniforms.uProgress.value = 0;
    chosen.scorchUniforms.uOpacity.value = 1;

    chosen.flashUniforms.uColor.value.copy(this.scratchEmissiveColor);
    chosen.flashUniforms.uOpacity.value = 0;

    // Hide all sub-meshes before enabling mode-specific layers
    chosen.fireballMain.visible = false;
    chosen.fireballCrown.visible = false;
    chosen.fireballSide.visible = false;
    chosen.vortexColumnMesh.visible = false;
    chosen.helixMeshA.visible = false;
    chosen.helixMeshB.visible = false;
    chosen.cycloneMesh.visible = false;
    chosen.crescentMeshA.visible = false;
    chosen.crescentMeshB.visible = false;
    chosen.spireClusterMesh.visible = false;
    chosen.voidCoreMesh.visible = false;
    chosen.wingLeftMesh.visible = false;
    chosen.wingRightMesh.visible = false;
    chosen.ringGroundMesh.visible = true;
    chosen.ringUpperMesh.visible = false;
    chosen.ringGyroAMesh.visible = false;
    chosen.ringGyroBMesh.visible = false;
    chosen.scorchMesh.visible = false;
    chosen.flashCoreMesh.visible = false;

    chosen.ringUpperMesh.position.y = 0.16;

    switch (kind) {
      case 'HENSHIN_SUPER':
        chosen.energyUniforms.uMode.value = 1;
        chosen.energyUniforms.uDisplaceAmp.value = 0.28;
        chosen.ringUniforms.uRingStyle.value = 1;
        chosen.vortexColumnMesh.visible = true;
        chosen.ringUpperMesh.visible = true;
        chosen.ringGyroAMesh.visible = true;
        chosen.ringGyroBMesh.visible = true;
        chosen.flashCoreMesh.visible = true;
        break;

      case 'HENSHIN_ULTIMATE':
        // Blend radiant gold into emissive hue for unmistakable Ultimate Awakening majesty!
        chosen.energyUniforms.uColorB.value.lerp(this.scratchFlashColor.setHex(0xfef08a), 0.38);
        chosen.ringUniforms.uColorB.value.lerp(this.scratchFlashColor.setHex(0xfef08a), 0.45);
        chosen.energyUniforms.uMode.value = 5;
        chosen.energyUniforms.uDisplaceAmp.value = 0.34;
        chosen.ringUniforms.uRingStyle.value = 0;
        chosen.wingLeftMesh.visible = true;
        chosen.wingRightMesh.visible = true;
        chosen.helixMeshA.visible = true;
        chosen.helixMeshB.visible = true;
        chosen.ringUpperMesh.visible = true;
        chosen.ringGyroAMesh.visible = true;
        chosen.ringGyroBMesh.visible = true;
        chosen.scorchMesh.visible = true;
        chosen.flashCoreMesh.visible = true;
        break;

      case 'PYRO_EXPLOSION':
        chosen.ringUniforms.uRingStyle.value = 2;
        chosen.fireballMain.visible = true;
        chosen.fireballCrown.visible = true;
        chosen.fireballSide.visible = true;
        chosen.scorchMesh.visible = true;
        chosen.flashCoreMesh.visible = true;
        chosen.flashUniforms.uColor.value.setHex(0xffb74d);
        break;

      case 'GRAND_ULTIMATE_CLIMAX':
        // Imperial Golden-Elemental Supernova palette!
        chosen.energyUniforms.uColorB.value.lerp(this.scratchFlashColor.setHex(0xfef08a), 0.52);
        chosen.ringUniforms.uColorB.value.lerp(this.scratchFlashColor.setHex(0xfef08a), 0.62);
        chosen.scorchUniforms.uColorB.value.lerp(this.scratchFlashColor.setHex(0xfde047), 0.55);
        chosen.flashUniforms.uColor.value.setHex(0xfef08a);
        chosen.energyUniforms.uMode.value = 1;
        chosen.energyUniforms.uDisplaceAmp.value = 0.42;
        chosen.ringUniforms.uRingStyle.value = 0;
        chosen.voidCoreMesh.visible = true;
        chosen.vortexColumnMesh.visible = true;
        chosen.helixMeshA.visible = true;
        chosen.helixMeshB.visible = true;
        chosen.crescentMeshA.visible = true;
        chosen.crescentMeshB.visible = true;
        chosen.fireballMain.visible = true;
        chosen.fireballCrown.visible = true;
        chosen.fireballSide.visible = true;
        chosen.ringUpperMesh.visible = true;
        chosen.ringGyroAMesh.visible = true;
        chosen.ringGyroBMesh.visible = true;
        chosen.scorchMesh.visible = true;
        chosen.flashCoreMesh.visible = true;
        break;

      case 'FINISHER_CLIMAX':
        chosen.energyUniforms.uMode.value = 1;
        chosen.energyUniforms.uDisplaceAmp.value = 0.36;
        chosen.ringUniforms.uRingStyle.value = 0;
        chosen.vortexColumnMesh.visible = true;
        chosen.helixMeshA.visible = true;
        chosen.helixMeshB.visible = true;
        chosen.fireballMain.visible = true;
        chosen.fireballCrown.visible = true;
        chosen.ringUpperMesh.visible = true;
        chosen.scorchMesh.visible = true;
        chosen.flashCoreMesh.visible = true;
        break;

      case 'DOME_NOVA':
        chosen.ringUniforms.uRingStyle.value = 2;
        chosen.fireballMain.visible = true;
        chosen.fireballCrown.visible = true;
        chosen.ringUpperMesh.visible = true;
        chosen.scorchMesh.visible = true;
        break;

      case 'SKY_PILLAR':
        chosen.energyUniforms.uMode.value = 1;
        chosen.energyUniforms.uDisplaceAmp.value = 0.32;
        chosen.vortexColumnMesh.visible = true;
        chosen.helixMeshA.visible = true;
        chosen.helixMeshB.visible = true;
        chosen.ringUpperMesh.visible = true;
        chosen.scorchMesh.visible = true;
        break;

      case 'CRESCENT_VORTEX':
        chosen.energyUniforms.uMode.value = 2;
        chosen.energyUniforms.uDisplaceAmp.value = 0.16;
        chosen.crescentMeshA.visible = true;
        chosen.crescentMeshB.visible = true;
        break;

      case 'CYCLONE_FUNNEL':
        chosen.energyUniforms.uMode.value = 2;
        chosen.energyUniforms.uDisplaceAmp.value = 0.34;
        chosen.cycloneMesh.visible = true;
        chosen.helixMeshA.visible = true;
        chosen.ringUpperMesh.visible = true;
        break;

      case 'SPIKE_RING':
        chosen.energyUniforms.uMode.value = 3;
        chosen.energyUniforms.uDisplaceAmp.value = 0.08;
        chosen.spireClusterMesh.visible = true;
        chosen.scorchMesh.visible = true;
        break;

      case 'VOID_SINGULARITY':
        chosen.energyUniforms.uMode.value = 4;
        chosen.energyUniforms.uDisplaceAmp.value = 0.24;
        chosen.voidCoreMesh.visible = true;
        chosen.crescentMeshA.visible = true;
        chosen.crescentMeshB.visible = true;
        chosen.scorchMesh.visible = true;
        break;
    }
  }
}

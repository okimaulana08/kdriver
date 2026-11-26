import * as THREE from 'three';
import { getElementConfig } from '../data/elements';
import type { ElementId } from '../types/schema';

const MAX_MACH_RINGS = 5;
const MAX_CRATERS = 3;
const MACH_RING_INTERVAL_SEC = 0.075;
const MACH_RING_DURATION_SEC = 0.36;
const CRATER_DURATION_SEC = 2.6;
const SEAL_DURATION_SEC = 0.95;

function getElementVfxStyle(elementId: ElementId): number {
  if (elementId === 'pyro' || elementId === 'solar') return 0; // Roaring flame plasma
  if (elementId === 'volt' || elementId === 'lux') return 1; // Jagged electric arcs
  return 2; // Supersonic hydro / wind / botanical / void vortex
}

/**
 * Builds an aerodynamic bullet-nose paraboloid shell oriented along +Y (tip at y=0, tail extending to -length)
 * so the Rider's boot sits flush inside the glowing parabolic nose with organic tapering flame/plasma backflow!
 */
function buildParabolicVortexGeometry(length = 2.45, maxRadius = 0.62): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 = nose tip (y = +0.24), 1 = trailing open tail (y = -length)
    const y = 0.24 - t * (length + 0.24);
    // Smooth parabolic flare near boot nose -> wide trailing plasma plume
    const r = Math.max(0.03, Math.pow(t, 0.56) * maxRadius * (0.95 + 0.12 * Math.sin(t * Math.PI)));
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, 28);
  // Rotate so nose points along +Z and tail trails back along -Z
  geo.rotateX(Math.PI / 2);
  return geo;
}

/**
 * Builds a sleek 3D helical energy ribbon twisting around the Z axis from boot tip (+0.18) back to -length.
 */
function buildHelixRibbonGeometry(
  phaseOffset: number,
  turns = 2.15,
  length = 2.55,
  width = 0.13
): THREE.BufferGeometry {
  const segs = 44;
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const uvs = new Float32Array((segs + 1) * 2 * 2);
  const indices = new Uint16Array(segs * 6);

  for (let i = 0; i <= segs; i++) {
    const t = i / segs; // 0 = boot tip (+0.18), 1 = trailing tail (-length)
    const angle = phaseOffset + t * turns * Math.PI * 2;
    const radius = 0.16 + Math.pow(t, 0.72) * 0.56;
    const z = 0.18 - t * (length + 0.18);
    const taper = Math.sin(t * Math.PI) * 0.85 + 0.15;
    const halfW = width * 0.5 * taper;

    const cx = Math.cos(angle) * radius;
    const cy = Math.sin(angle) * radius;
    // Ribbon radial width normal
    const rx = Math.cos(angle) * halfW;
    const ry = Math.sin(angle) * halfW;

    const v0 = i * 2;
    const v1 = v0 + 1;
    positions[v0 * 3] = cx - rx;
    positions[v0 * 3 + 1] = cy - ry;
    positions[v0 * 3 + 2] = z + halfW * 0.5;
    uvs[v0 * 2] = 0;
    uvs[v0 * 2 + 1] = t;

    positions[v1 * 3] = cx + rx;
    positions[v1 * 3 + 1] = cy + ry;
    positions[v1 * 3 + 2] = z - halfW * 0.5;
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

const COMMON_VERT = /* glsl */ `
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

// Layer 1: Incandescent Blazing Boot Core Shader
const BOOT_CORE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float core = pow(ndv, 1.45);
    float fresnel = pow(1.0 - ndv, 2.2);
    float turb = noise(vUv * 8.0 + vec2(uTime * 5.0, -uTime * 9.0));
    vec3 col = mix(uColorA, uColorB, 0.55 + turb * 0.45);
    col = mix(col, vec3(1.0, 0.98, 0.94), core * 0.88);
    float alpha = (core * 0.92 + fresnel * 0.65) * uIntensity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col * (1.7 + core * 1.4), clamp(alpha, 0.0, 1.0));
  }
`;

// Layer 2: Turbulent Volumetric Plasma / Flame / Lightning Vortex Shader (replaces plain cone!)
const PLASMA_VORTEX_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uStyle;
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.52;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.07 + vec2(13.1, 7.7);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // LatheGeometry uv.y runs 0 (nose) -> 1 (trailing tail)
    float along = vUv.y;
    float spiral = vUv.x * 6.0 + along * 3.8;
    vec2 flowUv = vec2(spiral, along * 4.5 - uTime * 7.8);

    float n = fbm(flowUv);
    float n2 = fbm(flowUv * 1.9 + vec2(-uTime * 3.2, -uTime * 11.5));

    // Dissolve trailing tail organically into roaring licks / lightning tendrils
    float noseHot = smoothstep(0.0, 0.14, along) * (1.0 - smoothstep(0.55, 0.98, along));
    float tailDissolve = smoothstep(along * 0.92 - 0.12, along * 0.92 + 0.18, n * 0.72 + n2 * 0.45);
    float fresnel = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vViewDir))), 1.55);

    float pattern = 0.0;
    if (uStyle < 0.5) {
      // Flame / Solar: licking fire tongues & blistering core
      pattern = smoothstep(0.26, 0.78, n * 0.65 + n2 * 0.5) * tailDissolve;
    } else if (uStyle < 1.5) {
      // Lightning / Volt / Lux: razor-sharp flickering electric arcs
      float ridge = 1.0 - abs(n * 2.0 - 1.0);
      float bolt = pow(clamp(ridge, 0.0, 1.0), 3.6);
      float bolt2 = pow(clamp(1.0 - abs(n2 * 2.0 - 1.0), 0.0, 1.0), 4.2);
      pattern = (bolt * 1.35 + bolt2 * 0.95 + fresnel * 0.35) * tailDissolve;
    } else {
      // Hydro / Wind / Arcane Vortex: silky spiraling air-plasma ribbons
      float ribbon = 0.5 + 0.5 * sin(spiral * 4.2 - uTime * 14.0 + n * 5.0);
      pattern = (pow(ribbon, 2.0) * 0.85 + n * 0.5) * tailDissolve;
    }

    float noseGlow = exp(-along * 5.5) * 0.95;
    float alpha = (pattern * 0.88 + noseGlow + fresnel * 0.32 * (1.0 - along)) * noseHot * uOpacity;
    if (alpha < 0.025) discard;

    vec3 col = mix(uColorA, uColorB, clamp(pattern + 0.25, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.98, 0.94), clamp(noseGlow * 0.9 + pow(pattern, 2.2) * 0.65, 0.0, 1.0));
    gl_FragColor = vec4(col * 1.85, clamp(alpha, 0.0, 0.96));
  }
`;

// Layer 3: Double-Helix Racing Energy Ribbon Shader
const HELIX_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  varying vec2 vUv;

  void main() {
    float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float core = pow(edge, 1.6);
    float pulse = 0.55 + 0.45 * sin(vUv.y * 18.0 - uTime * 26.0);
    float lengthFade = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
    float alpha = core * lengthFade * uOpacity;
    if (alpha < 0.02) discard;

    vec3 col = mix(uColorA, uColorB, pulse);
    col = mix(col, vec3(1.0, 0.99, 0.95), core * 0.65 * pulse);
    gl_FragColor = vec4(col * 2.1, clamp(alpha, 0.0, 0.95));
  }
`;

// Layer 4: Floating Tokusatsu K-Driver Geometric Seal Shader (Kuuga / Wizard / Geats aerial crest!)
const SEAL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float ang = atan(p.y, p.x);

    // Outer double ring + rotating 12-tick K-Driver gear marks + inner hex-star
    float outerRing = smoothstep(0.035, 0.0, abs(r - 0.88));
    float midRing = smoothstep(0.028, 0.0, abs(r - 0.66));
    float innerRing = smoothstep(0.024, 0.0, abs(r - 0.36));

    float ticks = smoothstep(0.55, 0.92, cos((ang + uTime * 2.2) * 12.0))
      * smoothstep(0.66, 0.71, r) * (1.0 - smoothstep(0.84, 0.88, r));

    // Rotating 6-point Tokusatsu crest polygon
    float rotA = ang - uTime * 3.1;
    float starR = 0.46 + 0.14 * cos(rotA * 6.0);
    float starLine = smoothstep(0.03, 0.0, abs(r - starR));

    // Radial spokes
    float spokes = smoothstep(0.93, 0.99, abs(cos((ang + uTime * 1.4) * 3.0)))
      * smoothstep(0.14, 0.22, r) * (1.0 - smoothstep(0.64, 0.68, r));

    // Pierce-through burst flash when uProgress crosses 0.45
    float shatter = smoothstep(0.42, 0.95, uProgress);
    float fadeIn = smoothstep(0.0, 0.12, uProgress);
    float fadeOut = 1.0 - smoothstep(0.55, 1.0, uProgress);

    float glyph = clamp(outerRing + midRing * 0.9 + innerRing * 0.85 + ticks * 0.9 + starLine + spokes * 0.7, 0.0, 1.5);
    float aura = exp(-abs(r - 0.72) * 7.0) * 0.35 + exp(-r * 3.2) * 0.45 * (1.0 - shatter);

    float alpha = (glyph + aura) * fadeIn * fadeOut;
    if (alpha < 0.02) discard;

    vec3 col = mix(uColorA, uColorB, 0.45 + 0.4 * sin(ang * 3.0 - uTime * 6.0));
    col = mix(col, vec3(1.0, 0.99, 0.95), clamp(glyph * 0.55 + shatter * 0.4, 0.0, 1.0));
    gl_FragColor = vec4(col * 2.0, clamp(alpha, 0.0, 0.95));
  }
`;

// Layer 5: Supersonic Air-Shock Mach Ring Shader
const MACH_RING_FRAG = /* glsl */ `
  uniform float uProgress;
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float ang = atan(p.y, p.x);

    float ringPos = mix(0.28, 0.86, uProgress);
    float thickness = mix(0.14, 0.04, uProgress);
    float ring = exp(-pow((r - ringPos) / thickness, 2.0));
    float innerMist = exp(-pow((r - ringPos * 0.78) / (thickness * 1.4), 2.0)) * 0.42;
    float streak = 0.75 + 0.25 * sin(ang * 16.0 + uProgress * 8.0);

    float fade = (1.0 - smoothstep(0.45, 1.0, uProgress)) * smoothstep(0.0, 0.08, uProgress);
    float alpha = (ring + innerMist) * streak * fade;
    if (alpha < 0.02) discard;

    vec3 col = mix(uColorB, vec3(1.0, 0.98, 0.95), ring * 0.72);
    col = mix(uColorA, col, 0.65);
    gl_FragColor = vec4(col * 1.75, clamp(alpha, 0.0, 0.92));
  }
`;

// Layer 6: Scorched Glowing Voronoi Ground Crater Decal Shader (cools organically over 2.6s!)
const CRATER_FRAG = /* glsl */ `
  uniform float uProgress;
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  varying vec2 vUv;

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // Returns distance to nearest Voronoi cell border (0.0 right on fracture crack!)
  float voronoiCrack(vec2 x) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float md = 8.0;
    vec2 mr = vec2(0.0);
    vec2 mg = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(n + g);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < md) {
          md = d;
          mr = r;
          mg = g;
        }
      }
    }
    float edgeDist = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = mg + vec2(float(i), float(j));
        vec2 o = hash2(n + g);
        vec2 r = g + o - f;
        if (dot(mr - r, mr - r) > 0.0001) {
          edgeDist = min(edgeDist, dot(0.5 * (mr + r), normalize(r - mr)));
        }
      }
    }
    return edgeDist;
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    // Radial fracture stretch + Voronoi crust cells
    float ang = atan(p.y, p.x);
    vec2 crackUv = p * 4.6 + vec2(cos(ang), sin(ang)) * r * 0.8;
    float edge = voronoiCrack(crackUv);
    float cracks = smoothstep(0.095, 0.012, edge);
    float radialMask = (1.0 - smoothstep(0.28, 0.96, r));

    // Heat cools down cleanly from blistering white-hot -> glowing elemental embers -> dark scorched crater
    float heat = 1.0 - smoothstep(0.08, 0.82, uProgress);
    float scorchFade = 1.0 - smoothstep(0.62, 1.0, uProgress);

    float coreGlow = exp(-r * 4.2) * heat * 1.25;
    float crackGlow = cracks * radialMask * (0.25 + heat * 1.15);
    float rimRing = exp(-pow((r - mix(0.18, 0.92, min(1.0, uProgress * 4.5))) / 0.08, 2.0)) * (1.0 - smoothstep(0.14, 0.34, uProgress));

    float alpha = clamp((crackGlow + coreGlow + rimRing) * scorchFade, 0.0, 0.96);
    if (alpha < 0.02) discard;

    vec3 ember = mix(uColorA, uColorB, clamp(heat + cracks * 0.4, 0.0, 1.0));
    vec3 col = mix(ember, vec3(1.0, 0.98, 0.92), clamp(coreGlow * 0.85 + rimRing * 0.75 + cracks * heat * 0.5, 0.0, 1.0));
    gl_FragColor = vec4(col * (1.35 + heat * 0.85), alpha);
  }
`;

interface PooledMachRing {
  active: boolean;
  elapsed: number;
  baseScale: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  uniforms: {
    uProgress: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
  };
}

interface PooledCrater {
  active: boolean;
  elapsed: number;
  radius: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  uniforms: {
    uProgress: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
  };
}

/**
 * 6-Layer Live-Action Tokusatsu Rider Kick VFX Engine (Zero-Allocation Hot Path, 0 MB external assets):
 * 1. Bone-Attached Blazing Boot Core + Dynamic PointLight
 * 2. GLSL Volumetric Turbulent Plasma/Flame/Lightning Paraboloid Vortex
 * 3. Counter-Wound Double-Helix Spiral Energy Ribbons
 * 4. Floating Air-Hang K-Driver Geometric Seal (Rider pierces straight through!)
 * 5. Pooled Supersonic Mach Shockwave Rings along dive trajectory
 * 6. Pooled Scorched Voronoi Glowing Ground Crater Decals on impact
 */
export class RiderKickVfx {
  public readonly root = new THREE.Group();

  // Boot-attached active kick ensemble (Layers 1, 2, 3)
  private readonly bootAnchor = new THREE.Group();
  private readonly bootCoreMesh: THREE.Mesh;
  private readonly bootLight: THREE.PointLight;
  private readonly vortexMesh: THREE.Mesh;
  private readonly helixMeshA: THREE.Mesh;
  private readonly helixMeshB: THREE.Mesh;

  // Shared geometries for clean dispose()
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];

  private readonly bootCoreUniforms: {
    uTime: { value: number };
    uIntensity: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
  };
  private readonly vortexUniforms: {
    uTime: { value: number };
    uOpacity: { value: number };
    uStyle: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
  };
  private readonly helixUniforms: {
    uTime: { value: number };
    uOpacity: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
  };

  // Layer 4: Floating Air-Hang K-Driver Seal
  private readonly airSealMesh: THREE.Mesh;
  private readonly airSealUniforms: {
    uTime: { value: number };
    uProgress: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
  };
  private sealActive = false;
  private sealElapsed = 0;
  private sealBaseScale = 2.4;

  // Layer 5 & 6 Pools
  private readonly machRings: PooledMachRing[] = [];
  private readonly craters: PooledCrater[] = [];
  private machSpawnCooldown = 0;

  private active = false;
  private activeElement: ElementId = 'pyro';
  private vfxTime = 0;

  // Pre-allocated scratch math objects (Zero-Allocation Hot Path)
  private readonly scratchForwardZ = new THREE.Vector3(0, 0, 1);
  private readonly scratchDiveDir = new THREE.Vector3(0, -0.5, 1);
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchColorA = new THREE.Color();
  private readonly scratchColorB = new THREE.Color();

  constructor() {
    this.root.name = 'RiderKickVfxRoot';
    this.bootAnchor.visible = false;
    this.root.add(this.bootAnchor);

    // Layer 1: Incandescent Blazing Boot Core + Dynamic PointLight
    const coreGeo = new THREE.SphereGeometry(0.32, 18, 14);
    this.ownedGeometries.push(coreGeo);
    this.bootCoreUniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uColorA: { value: new THREE.Color(0xe11d48) },
      uColorB: { value: new THREE.Color(0xff5722) },
    };
    const bootCoreMat = new THREE.ShaderMaterial({
      vertexShader: COMMON_VERT,
      fragmentShader: BOOT_CORE_FRAG,
      uniforms: this.bootCoreUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ownedMaterials.push(bootCoreMat);
    this.bootCoreMesh = new THREE.Mesh(coreGeo, bootCoreMat);
    this.bootCoreMesh.scale.set(1.0, 1.0, 1.45);
    this.bootAnchor.add(this.bootCoreMesh);

    this.bootLight = new THREE.PointLight(0xff5722, 0, 14, 1.6);
    this.bootAnchor.add(this.bootLight);

    // Layer 2: Volumetric Turbulent Plasma / Flame / Lightning Vortex Sheath
    const vortexGeo = buildParabolicVortexGeometry(2.45, 0.64);
    this.ownedGeometries.push(vortexGeo);
    this.vortexUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uStyle: { value: 0 },
      uColorA: { value: new THREE.Color(0xe11d48) },
      uColorB: { value: new THREE.Color(0xff5722) },
    };
    const vortexMat = new THREE.ShaderMaterial({
      vertexShader: COMMON_VERT,
      fragmentShader: PLASMA_VORTEX_FRAG,
      uniforms: this.vortexUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ownedMaterials.push(vortexMat);
    this.vortexMesh = new THREE.Mesh(vortexGeo, vortexMat);
    this.bootAnchor.add(this.vortexMesh);

    // Layer 3: Double-Helix Spiral Ribbons
    const helixGeoA = buildHelixRibbonGeometry(0, 2.15, 2.55, 0.14);
    const helixGeoB = buildHelixRibbonGeometry(Math.PI, 2.15, 2.55, 0.14);
    this.ownedGeometries.push(helixGeoA, helixGeoB);
    this.helixUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uColorA: { value: new THREE.Color(0xe11d48) },
      uColorB: { value: new THREE.Color(0xff5722) },
    };
    const helixMat = new THREE.ShaderMaterial({
      vertexShader: COMMON_VERT,
      fragmentShader: HELIX_FRAG,
      uniforms: this.helixUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ownedMaterials.push(helixMat);
    this.helixMeshA = new THREE.Mesh(helixGeoA, helixMat);
    this.helixMeshB = new THREE.Mesh(helixGeoB, helixMat);
    this.bootAnchor.add(this.helixMeshA, this.helixMeshB);

    // Layer 4: Floating Air-Hang K-Driver Geometric Seal
    const planeGeo = new THREE.PlaneGeometry(2.0, 2.0);
    this.ownedGeometries.push(planeGeo);
    this.airSealUniforms = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uColorA: { value: new THREE.Color(0xe11d48) },
      uColorB: { value: new THREE.Color(0xff5722) },
    };
    const sealMat = new THREE.ShaderMaterial({
      vertexShader: COMMON_VERT,
      fragmentShader: SEAL_FRAG,
      uniforms: this.airSealUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ownedMaterials.push(sealMat);
    this.airSealMesh = new THREE.Mesh(planeGeo, sealMat);
    this.airSealMesh.visible = false;
    this.root.add(this.airSealMesh);

    // Layer 5: Pooled Supersonic Mach Shockwave Rings
    for (let i = 0; i < MAX_MACH_RINGS; i++) {
      const uniforms = {
        uProgress: { value: 0 },
        uColorA: { value: new THREE.Color(0xe11d48) },
        uColorB: { value: new THREE.Color(0xff5722) },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: COMMON_VERT,
        fragmentShader: MACH_RING_FRAG,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.ownedMaterials.push(mat);
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.machRings.push({
        active: false,
        elapsed: 0,
        baseScale: 1.5,
        mesh,
        mat,
        uniforms,
      });
    }

    // Layer 6: Pooled Scorched Voronoi Glowing Ground Crater Decals
    const craterGeo = new THREE.PlaneGeometry(2.0, 2.0);
    craterGeo.rotateX(-Math.PI / 2);
    this.ownedGeometries.push(craterGeo);
    for (let i = 0; i < MAX_CRATERS; i++) {
      const uniforms = {
        uProgress: { value: 0 },
        uColorA: { value: new THREE.Color(0xe11d48) },
        uColorB: { value: new THREE.Color(0xff5722) },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: COMMON_VERT,
        fragmentShader: CRATER_FRAG,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.ownedMaterials.push(mat);
      const mesh = new THREE.Mesh(craterGeo, mat);
      mesh.position.y = 0.032;
      mesh.visible = false;
      this.root.add(mesh);
      this.craters.push({
        active: false,
        elapsed: 0,
        radius: 3.5,
        mesh,
        mat,
        uniforms,
      });
    }
  }

  /**
   * Summons the floating K-Driver geometric energy seal ahead of the Rider's aerial dive path!
   */
  public spawnAirSeal(
    elementId: ElementId,
    riderX: number,
    riderY: number,
    riderZ: number,
    facingYaw: number,
    isHyper = false
  ): void {
    const cfg = getElementConfig(elementId);
    this.scratchColorA.set(cfg.primaryColor);
    this.scratchColorB.set(cfg.emissiveColor);
    this.airSealUniforms.uColorA.value.copy(this.scratchColorA);
    this.airSealUniforms.uColorB.value.copy(this.scratchColorB);
    this.airSealUniforms.uProgress.value = 0;

    const fx = Math.sin(facingYaw);
    const fz = Math.cos(facingYaw);
    this.scratchDiveDir.set(fx * 0.84, -0.54, fz * 0.84).normalize();
    this.scratchQuat.setFromUnitVectors(this.scratchForwardZ, this.scratchDiveDir);

    this.sealBaseScale = isHyper ? 2.85 : 2.1;
    this.airSealMesh.position.set(
      riderX + fx * (isHyper ? 1.45 : 1.85),
      Math.max(1.4, riderY + (isHyper ? 1.85 : 1.65)),
      riderZ + fz * (isHyper ? 1.45 : 1.85)
    );
    this.airSealMesh.quaternion.copy(this.scratchQuat);
    this.airSealMesh.scale.setScalar(this.sealBaseScale * 0.35);
    this.airSealMesh.visible = true;
    this.sealActive = true;
    this.sealElapsed = 0;
  }

  /**
   * Spawns a glowing scorched Voronoi crater decal right on the arena floor on Rider Kick impact!
   */
  public spawnImpactCrater(
    elementId: ElementId,
    x: number,
    z: number,
    radius: number,
    isHyper = false
  ): void {
    let slot = this.craters[0]!;
    for (let i = 0; i < this.craters.length; i++) {
      if (!this.craters[i]!.active) {
        slot = this.craters[i]!;
        break;
      }
      if (this.craters[i]!.elapsed > slot.elapsed) {
        slot = this.craters[i]!;
      }
    }
    const cfg = getElementConfig(elementId);
    slot.active = true;
    slot.elapsed = 0;
    slot.radius = radius * (isHyper ? 1.25 : 1.0);
    slot.uniforms.uColorA.value.set(cfg.primaryColor);
    slot.uniforms.uColorB.value.set(cfg.emissiveColor);
    slot.uniforms.uProgress.value = 0;
    slot.mesh.position.set(x, 0.032 + (Math.random() * 0.006), z);
    slot.mesh.rotation.y = Math.random() * Math.PI * 2;
    slot.mesh.scale.setScalar(slot.radius);
    slot.mesh.visible = true;
  }

  /**
   * Drives the bone-attached boot vortex, double-helix ribbons, dynamic light, and spawns supersonic Mach rings!
   * Call once per render frame with `isDiveActive = true` during RIDER_KICK or ULTIMATE_CINEMATIC dive!
   */
  public syncBootDive(
    isDiveActive: boolean,
    elementId: ElementId,
    bootWorldPos: THREE.Vector3,
    facingYaw: number,
    intensity: number,
    scaleMult: number,
    dt: number
  ): void {
    if (!isDiveActive || intensity <= 0.01) {
      this.active = false;
      this.bootAnchor.visible = false;
      this.bootLight.intensity = 0;
      this.machSpawnCooldown = 0;
      return;
    }

    if (!this.active || this.activeElement !== elementId) {
      this.active = true;
      this.activeElement = elementId;
      const cfg = getElementConfig(elementId);
      this.scratchColorA.set(cfg.primaryColor);
      this.scratchColorB.set(cfg.emissiveColor);
      this.bootCoreUniforms.uColorA.value.copy(this.scratchColorA);
      this.bootCoreUniforms.uColorB.value.copy(this.scratchColorB);
      this.vortexUniforms.uColorA.value.copy(this.scratchColorA);
      this.vortexUniforms.uColorB.value.copy(this.scratchColorB);
      this.vortexUniforms.uStyle.value = getElementVfxStyle(elementId);
      this.helixUniforms.uColorA.value.copy(this.scratchColorA);
      this.helixUniforms.uColorB.value.copy(this.scratchColorB);
      this.bootLight.color.copy(this.scratchColorB);
    }

    // Orient boot sheath along the diagonal downward-forward Kamen Rider dive vector
    const fx = Math.sin(facingYaw);
    const fz = Math.cos(facingYaw);
    this.scratchDiveDir.set(fx * 0.84, -0.54, fz * 0.84).normalize();
    this.scratchQuat.setFromUnitVectors(this.scratchForwardZ, this.scratchDiveDir);

    this.bootAnchor.visible = true;
    this.bootAnchor.position.copy(bootWorldPos);
    this.bootAnchor.quaternion.copy(this.scratchQuat);
    this.bootAnchor.scale.setScalar(scaleMult);

    this.bootCoreUniforms.uIntensity.value = intensity;
    this.vortexUniforms.uOpacity.value = intensity * 0.96;
    this.helixUniforms.uOpacity.value = intensity * 0.92;
    this.bootLight.intensity = 12.5 * intensity * scaleMult;

    // Spin vortex & double-helix counter-rotational for blazing tokusatsu energy drill look!
    this.vortexMesh.rotation.z += dt * 13.0;
    this.helixMeshA.rotation.z -= dt * 16.5;
    this.helixMeshB.rotation.z -= dt * 16.5;

    // Spawn supersonic Mach shockwave rings along the live aerial dive path!
    this.machSpawnCooldown -= dt;
    if (this.machSpawnCooldown <= 0 && intensity > 0.35) {
      this.machSpawnCooldown = MACH_RING_INTERVAL_SEC;
      this.spawnMachRing(bootWorldPos, this.scratchQuat, scaleMult);
    }
  }

  public update(dt: number): void {
    this.vfxTime += dt;
    this.bootCoreUniforms.uTime.value = this.vfxTime;
    this.vortexUniforms.uTime.value = this.vfxTime;
    this.helixUniforms.uTime.value = this.vfxTime;

    // Update Floating Air-Hang K-Driver Seal
    if (this.sealActive) {
      this.sealElapsed += dt;
      const p = Math.min(1, this.sealElapsed / SEAL_DURATION_SEC);
      this.airSealUniforms.uTime.value = this.vfxTime;
      this.airSealUniforms.uProgress.value = p;
      const pop = p < 0.16 ? 0.35 + (p / 0.16) * 0.65 : 1.0 + Math.max(0, p - 0.42) * 1.45;
      this.airSealMesh.scale.setScalar(this.sealBaseScale * pop);
      if (p >= 1) {
        this.sealActive = false;
        this.airSealMesh.visible = false;
      }
    }

    // Update Pooled Mach Shockwave Rings
    for (let i = 0; i < this.machRings.length; i++) {
      const r = this.machRings[i]!;
      if (!r.active) continue;
      r.elapsed += dt;
      const p = Math.min(1, r.elapsed / MACH_RING_DURATION_SEC);
      r.uniforms.uProgress.value = p;
      r.mesh.scale.setScalar(r.baseScale * (0.45 + p * 1.65));
      if (p >= 1) {
        r.active = false;
        r.mesh.visible = false;
      }
    }

    // Update Pooled Scorched Ground Craters
    for (let i = 0; i < this.craters.length; i++) {
      const c = this.craters[i]!;
      if (!c.active) continue;
      c.elapsed += dt;
      const p = Math.min(1, c.elapsed / CRATER_DURATION_SEC);
      c.uniforms.uProgress.value = p;
      const expand = p < 0.08 ? 0.45 + (p / 0.08) * 0.55 : 1.0;
      c.mesh.scale.setScalar(c.radius * expand);
      if (p >= 1) {
        c.active = false;
        c.mesh.visible = false;
      }
    }
  }

  public clearAll(): void {
    this.active = false;
    this.bootAnchor.visible = false;
    this.bootLight.intensity = 0;
    this.sealActive = false;
    this.airSealMesh.visible = false;
    for (let i = 0; i < this.machRings.length; i++) {
      this.machRings[i]!.active = false;
      this.machRings[i]!.mesh.visible = false;
    }
    for (let i = 0; i < this.craters.length; i++) {
      this.craters[i]!.active = false;
      this.craters[i]!.mesh.visible = false;
    }
  }

  public dispose(): void {
    this.clearAll();
    for (let i = 0; i < this.ownedGeometries.length; i++) {
      this.ownedGeometries[i]!.dispose();
    }
    this.ownedGeometries.length = 0;
    for (let i = 0; i < this.ownedMaterials.length; i++) {
      this.ownedMaterials[i]!.dispose();
    }
    this.ownedMaterials.length = 0;
  }

  private spawnMachRing(
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    scaleMult: number
  ): void {
    let slot = this.machRings[0]!;
    for (let i = 0; i < this.machRings.length; i++) {
      if (!this.machRings[i]!.active) {
        slot = this.machRings[i]!;
        break;
      }
      if (this.machRings[i]!.elapsed > slot.elapsed) {
        slot = this.machRings[i]!;
      }
    }
    slot.active = true;
    slot.elapsed = 0;
    slot.baseScale = 1.35 * scaleMult;
    slot.uniforms.uProgress.value = 0;
    slot.uniforms.uColorA.value.copy(this.scratchColorA);
    slot.uniforms.uColorB.value.copy(this.scratchColorB);
    slot.mesh.position.copy(pos);
    slot.mesh.quaternion.copy(quat);
    slot.mesh.scale.setScalar(slot.baseScale * 0.45);
    slot.mesh.visible = true;
  }
}

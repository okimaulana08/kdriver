import * as THREE from 'three';
import { getElementConfig } from '../data/elements';
import type { ElementId, ReactionId } from '../types/schema';

const MAX_SPARKS = 320;
const MAX_CLOUDS = 160;
const MAX_EMBERS = 140;

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

interface CloudSlot {
  active: boolean;
  age: number;
  lifetime: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  riseAccel: number;
  dragRate: number;
  startScale: number;
  endScale: number;
  angle: number;
  spinSpeed: number;
  seed: number;
  /** 0 = backlit concrete dust/smoke, 1 = incandescent pyrotechnic fireball cooling into dark quarry smoke */
  heatMode: number;
}

interface EmberSlot {
  active: boolean;
  age: number;
  lifetime: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  swirlAmp: number;
  swirlFreq: number;
  seed: number;
  scale: number;
}

/**
 * Builds a crossed dual-quad tapered geometry aligned along +Z (nose at +0.5, tail at -0.5)
 * so velocity-stretched welding sparks look volumetric from every camera angle with zero box corners.
 */
function buildCrossedStreakGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    // Horizontal quad (X width, Z length)
    -0.5, 0, -0.5,  0.5, 0, -0.5,  0.5, 0, 0.5,  -0.5, 0, 0.5,
    // Vertical quad (Y width, Z length)
    0, -0.5, -0.5,  0, 0.5, -0.5,  0, 0.5, 0.5,  0, -0.5, 0.5,
  ]);
  const uvs = new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2,  0, 2, 3,
    4, 5, 6,  4, 6, 7,
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

const SPARK_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aSparkColor;
  attribute float aSparkLife;

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vLife;

  void main() {
    vUv = uv;
    vColor = aSparkColor;
    vLife = aSparkLife;
    vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const SPARK_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vLife;

  void main() {
    // Smooth tapered teardrop streak: hot rounded nose at vUv.y ~ 0.78, feathered comet tail toward 0.0
    float lateral = abs(vUv.x * 2.0 - 1.0);
    float tailTaper = mix(0.22, 1.0, smoothstep(0.0, 0.75, vUv.y));
    float headTaper = smoothstep(1.0, 0.72, vUv.y);
    float radial = lateral / max(0.08, tailTaper);

    float core = exp(-radial * radial * 5.2) * smoothstep(0.0, 0.25, vUv.y) * headTaper;
    float halo = exp(-radial * radial * 1.9) * smoothstep(0.0, 0.14, vUv.y) * headTaper;
    float hotTip = exp(-pow((vUv.y - 0.78) * 4.8, 2.0) - radial * radial * 4.5);

    float fade = 1.0 - vLife * vLife;
    float alpha = (core * 0.95 + halo * 0.45) * fade;
    if (alpha < 0.02) discard;

    // Incandescent hot golden-white nose blending smoothly into rich amber/elemental spark tail
    vec3 col = mix(vColor * 1.45, vec3(1.0, 0.94, 0.78) * 1.95, clamp(hotTip * 0.75 + core * 0.32, 0.0, 1.0));
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

const CLOUD_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aCloudColor;
  attribute vec4 aCloudMeta; // x: age01, y: seed, z: heatMode (0=dust/smoke, 1=fireball->smoke), w: spinAngle

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vMeta;

  void main() {
    vUv = uv;
    vColor = aCloudColor;
    vMeta = aCloudMeta;

    // True spherical camera-facing billboard straight from instanceMatrix translation & uniform scale
    vec4 worldCenter = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float scale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));

    float c = cos(aCloudMeta.w);
    float s = sin(aCloudMeta.w);
    vec2 localOffset = vec2(
      position.x * c - position.y * s,
      position.x * s + position.y * c
    ) * scale;

    vec4 mvCenter = viewMatrix * worldCenter;
    mvCenter.xy += localOffset;
    gl_Position = projectionMatrix * mvCenter;
  }
`;

const CLOUD_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vMeta;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.17);
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
    float a = 0.52;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = rot * p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float age = vMeta.x;
    float seed = vMeta.y;
    float heat = vMeta.z;

    vec2 centered = vUv * 2.0 - 1.0;
    float dist = length(centered);
    if (dist > 1.0) discard;

    // Swirling billowing FBM puff silhouette (zero polygon corners!)
    vec2 flowUv = centered * 2.15 + vec2(seed * 7.13, seed * 3.91 - age * 1.45);
    float n1 = fbm(flowUv);
    float n2 = fbm(flowUv * 2.05 - vec2(uTime * 0.45, uTime * 0.85 + seed * 5.0));
    float puffNoise = n1 * 0.64 + n2 * 0.36;

    // Soft organic radial mask GUARANTEED 0 before quad boundary (zero rectangular clipping!)
    float boundaryFade = smoothstep(0.95, 0.46, dist);
    float radialSoft = smoothstep(0.92, 0.16, dist + (puffNoise - 0.5) * 0.34) * boundaryFade;
    float density = smoothstep(0.2 + age * 0.38, 0.76, puffNoise * 0.68 + radialSoft * 0.62) * radialSoft;

    float fadeIn = smoothstep(0.0, 0.08, age);
    float fadeOut = 1.0 - smoothstep(0.54, 1.0, age);
    float alpha = density * fadeIn * fadeOut;

    if (heat > 0.05) {
      // Live-action Toei pyrotechnic fireball -> rich charcoal-black backlit quarry smoke!
      float burnTemp = clamp((1.0 - smoothstep(0.06, 0.5, age)) * heat, 0.0, 1.0);
      float coreHeat = clamp(pow(1.0 - dist * 0.92, 1.25) * 0.75 + puffNoise * 0.52, 0.0, 1.2) * burnTemp;

      // Deep contrasting quarry napalm smoke (charcoal shadows + warm rim-lit curls)
      float lightBias = clamp(0.4 + centered.y * 0.38 + (n2 - 0.5) * 0.42, 0.0, 1.0);
      vec3 sootSmoke = mix(vec3(0.035, 0.032, 0.036), vec3(0.18, 0.16, 0.155), lightBias);

      // Rich high-contrast gasoline fire gradient (deep crimson -> roaring orange -> pinpoint gold-white core)
      vec3 deepFire = mix(vec3(0.88, 0.12, 0.015), vColor * 0.85, 0.35);
      vec3 brightFire = mix(vec3(1.0, 0.46, 0.06), vColor * 1.1 + vec3(0.12, 0.06, 0.0), 0.25);
      vec3 whiteCore = vec3(1.0, 0.92, 0.72);

      vec3 fireCol = mix(deepFire, brightFire, smoothstep(0.24, 0.62, coreHeat));
      fireCol = mix(fireCol, whiteCore, smoothstep(0.72, 1.08, coreHeat));

      // Glowing fiery under-light illuminating thick dark smoke from within as explosion cools
      float emberBacklight = smoothstep(0.38, 0.88, puffNoise) * (1.0 - dist) * clamp(1.0 - age * 1.25, 0.0, 1.0) * heat;
      vec3 litSmoke = sootSmoke + deepFire * emberBacklight * 0.85;

      vec3 finalCol = mix(litSmoke, fireCol * 1.48, smoothstep(0.22, 0.64, coreHeat));
      float finalAlpha = clamp(alpha * mix(0.82, 0.94, burnTemp), 0.0, 0.94);
      if (finalAlpha < 0.015) discard;
      gl_FragColor = vec4(finalCol, finalAlpha);
    } else {
      // Subtle grounded warm quarry concrete dust (never pale blue mist!)
      float shade = clamp(0.48 + centered.y * 0.34 + (n2 - 0.5) * 0.3, 0.15, 1.0);
      vec3 dustCol = vColor * mix(0.45, 0.86, shade);
      float finalAlpha = clamp(alpha * 0.36, 0.0, 0.46);
      if (finalAlpha < 0.012) discard;
      gl_FragColor = vec4(dustCol, finalAlpha);
    }
  }
`;

const EMBER_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aEmberColor;
  attribute vec2 aEmberMeta; // x: age01, y: seed

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec2 vMeta;

  void main() {
    vUv = uv;
    vColor = aEmberColor;
    vMeta = aEmberMeta;

    vec4 worldCenter = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float scale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
    vec4 mvCenter = viewMatrix * worldCenter;
    mvCenter.xy += position.xy * scale;
    gl_Position = projectionMatrix * mvCenter;
  }
`;

const EMBER_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec2 vMeta;

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float r = length(centered);
    if (r > 1.0) discard;

    float age = vMeta.x;
    float flicker = 0.72 + 0.28 * sin(uTime * 19.0 + vMeta.y * 42.0);
    float core = exp(-r * r * 6.5);
    float halo = exp(-r * r * 2.1);

    float env = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.58, 1.0, age));
    float alpha = (core * 0.95 + halo * 0.5) * env * flicker;
    if (alpha < 0.015) discard;

    vec3 col = mix(vColor * 1.8, vec3(1.0, 0.98, 0.9) * 2.5, core * 0.8);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/**
 * Tri-channel live-action Tokusatsu GPU VFX pool:
 * 1) Velocity-aligned GLSL tapered incandescent sparks with concrete bounce physics
 * 2) Camera-facing GLSL volumetric FBM fireball-to-dark-smoke & dust billboards (zero dodecahedrons!)
 * 3) Camera-facing rising glowing ember/energy motes for Henshin, explosions & Ultimates
 * 100% Zero-Allocation hot path & clean dispose().
 */
export class ParticlePool {
  public readonly root = new THREE.Group();
  public readonly mesh: THREE.InstancedMesh;
  private readonly cloudMesh: THREE.InstancedMesh;
  private readonly emberMesh: THREE.InstancedMesh;

  private readonly sparkGeo: THREE.BufferGeometry;
  private readonly sparkMat: THREE.ShaderMaterial;
  private readonly sparkColorAttr: THREE.InstancedBufferAttribute;
  private readonly sparkLifeAttr: THREE.InstancedBufferAttribute;

  private readonly cloudGeo: THREE.PlaneGeometry;
  private readonly cloudMat: THREE.ShaderMaterial;
  private readonly cloudColorAttr: THREE.InstancedBufferAttribute;
  private readonly cloudMetaAttr: THREE.InstancedBufferAttribute;
  private readonly cloudTimeUniform = { value: 0 };

  private readonly emberGeo: THREE.PlaneGeometry;
  private readonly emberMat: THREE.ShaderMaterial;
  private readonly emberColorAttr: THREE.InstancedBufferAttribute;
  private readonly emberMetaAttr: THREE.InstancedBufferAttribute;
  private readonly emberTimeUniform = { value: 0 };

  private readonly sparkSlots: SparkSlot[] = [];
  private readonly cloudSlots: CloudSlot[] = [];
  private readonly emberSlots: EmberSlot[] = [];
  private sparkCursor = 0;
  private cloudCursor = 0;
  private emberCursor = 0;

  // Reusable scratch objects (Zero-Allocation Hot Path)
  private readonly scratchDummy = new THREE.Object3D();
  private readonly scratchLookTarget = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();
  private readonly scratchColorB = new THREE.Color();

  constructor() {
    this.root.name = 'TokusatsuParticlePoolRoot';

    // Channel 1: Crossed-blade velocity-stretched incandescent pyrotechnic sparks
    this.sparkGeo = buildCrossedStreakGeometry();
    this.sparkColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3);
    this.sparkColorAttr.setUsage(THREE.DynamicDrawUsage);
    this.sparkLifeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS), 1);
    this.sparkLifeAttr.setUsage(THREE.DynamicDrawUsage);
    this.sparkGeo.setAttribute('aSparkColor', this.sparkColorAttr);
    this.sparkGeo.setAttribute('aSparkLife', this.sparkLifeAttr);

    this.sparkMat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERTEX_SHADER,
      fragmentShader: SPARK_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(this.sparkGeo, this.sparkMat, MAX_SPARKS);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = 6;

    // Channel 2: Camera-facing volumetric FBM fireball -> billowing dark quarry smoke & concrete dust
    this.cloudGeo = new THREE.PlaneGeometry(1.0, 1.0);
    this.cloudColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CLOUDS * 3), 3);
    this.cloudColorAttr.setUsage(THREE.DynamicDrawUsage);
    this.cloudMetaAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CLOUDS * 4), 4);
    this.cloudMetaAttr.setUsage(THREE.DynamicDrawUsage);
    this.cloudGeo.setAttribute('aCloudColor', this.cloudColorAttr);
    this.cloudGeo.setAttribute('aCloudMeta', this.cloudMetaAttr);

    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.cloudTimeUniform,
      },
      vertexShader: CLOUD_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.cloudMesh = new THREE.InstancedMesh(this.cloudGeo, this.cloudMat, MAX_CLOUDS);
    this.cloudMesh.frustumCulled = false;
    this.cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cloudMesh.renderOrder = 4;

    // Channel 3: Glowing rising embers & Henshin ascension energy motes
    this.emberGeo = new THREE.PlaneGeometry(1.0, 1.0);
    this.emberColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_EMBERS * 3), 3);
    this.emberColorAttr.setUsage(THREE.DynamicDrawUsage);
    this.emberMetaAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_EMBERS * 2), 2);
    this.emberMetaAttr.setUsage(THREE.DynamicDrawUsage);
    this.emberGeo.setAttribute('aEmberColor', this.emberColorAttr);
    this.emberGeo.setAttribute('aEmberMeta', this.emberMetaAttr);

    this.emberMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.emberTimeUniform,
      },
      vertexShader: EMBER_VERTEX_SHADER,
      fragmentShader: EMBER_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.emberMesh = new THREE.InstancedMesh(this.emberGeo, this.emberMat, MAX_EMBERS);
    this.emberMesh.frustumCulled = false;
    this.emberMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.emberMesh.renderOrder = 7;

    this.root.add(this.cloudMesh, this.mesh, this.emberMesh);

    this.scratchDummy.position.set(0, -100, 0);
    this.scratchDummy.scale.set(0, 0, 0);
    this.scratchDummy.updateMatrix();

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
      this.sparkColorAttr.setXYZ(i, 1, 1, 1);
      this.sparkLifeAttr.setX(i, 1);
    }

    for (let i = 0; i < MAX_CLOUDS; i++) {
      this.cloudSlots.push({
        active: false,
        age: 0,
        lifetime: 0.9,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        riseAccel: 0.6,
        dragRate: 2.6,
        startScale: 0.5,
        endScale: 2.2,
        angle: 0,
        spinSpeed: 1.0,
        seed: i * 0.37,
        heatMode: 0,
      });
      this.cloudMesh.setMatrixAt(i, this.scratchDummy.matrix);
      this.cloudColorAttr.setXYZ(i, 0.8, 0.8, 0.8);
      this.cloudMetaAttr.setXYZW(i, 1, i * 0.37, 0, 0);
    }

    for (let i = 0; i < MAX_EMBERS; i++) {
      this.emberSlots.push({
        active: false,
        age: 0,
        lifetime: 1.0,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        swirlAmp: 0.8,
        swirlFreq: 4.0,
        seed: i * 0.53,
        scale: 0.2,
      });
      this.emberMesh.setMatrixAt(i, this.scratchDummy.matrix);
      this.emberColorAttr.setXYZ(i, 1, 0.8, 0.4);
      this.emberMetaAttr.setXY(i, 1, i * 0.53);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.sparkColorAttr.needsUpdate = true;
    this.sparkLifeAttr.needsUpdate = true;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    this.cloudColorAttr.needsUpdate = true;
    this.cloudMetaAttr.needsUpdate = true;
    this.emberMesh.instanceMatrix.needsUpdate = true;
    this.emberColorAttr.needsUpdate = true;
    this.emberMetaAttr.needsUpdate = true;
  }

  public emitBeltSwitchBurst(x: number, y: number, z: number, colorHex: number): void {
    const count = 24;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 4.4 + (i % 3) * 1.5;
      const bright = i % 3 === 0 ? 0xfff7ed : colorHex;
      this.scratchColor.setHex(bright);
      this.spawnSpark(
        x,
        y,
        z,
        Math.cos(angle) * speed,
        1.1 + Math.random() * 2.4,
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
    this.emitDustRing(x, 0.25, z, 7, 0xdbeafe, 1.35);
    this.scratchColor.setHex(colorHex);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawnEmber(
        x + Math.cos(a) * 0.55,
        y + Math.random() * 0.6,
        z + Math.sin(a) * 0.55,
        Math.cos(a) * 1.2,
        2.2 + Math.random() * 2.4,
        Math.sin(a) * 1.2,
        0.65 + Math.random() * 0.35,
        0.16 + Math.random() * 0.14,
        1.1,
        5.5,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }
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
    const isFiery = element === 'pyro' || element === 'solar';
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

    if (isFiery) {
      this.scratchColor.setHex(emissiveHex);
      const puffs = Math.min(8, Math.max(4, Math.floor(count / 5)));
      for (let i = 0; i < puffs; i++) {
        const a = (i / puffs) * Math.PI * 2 + Math.random() * 0.4;
        const spd = (1.0 + Math.random() * 2.2) * spreadScale;
        this.spawnCloud(
          x + (Math.random() - 0.5) * 0.6,
          Math.max(0.35, y),
          z + (Math.random() - 0.5) * 0.6,
          Math.cos(a) * spd,
          1.4 + Math.random() * 2.0,
          Math.sin(a) * spd,
          1.1,
          2.2,
          0.72 + Math.random() * 0.42,
          0.75 * spreadScale,
          2.4 * spreadScale,
          0.85,
          this.scratchColor.r,
          this.scratchColor.g,
          this.scratchColor.b
        );
      }
    } else {
      const smokeHex =
        element === 'terra'
          ? 0x948777
          : element === 'umbra'
            ? 0x4c1d95
            : element === 'flora'
              ? 0x86efac
              : 0xdbeafe;
      this.emitDustRing(
        x,
        Math.max(0.28, y * 0.48),
        z,
        Math.min(10, Math.max(5, Math.floor(count / 4))),
        smokeHex,
        1.5 * spreadScale
      );
    }
  }

  public emitReactionBurst(reactionId: ReactionId, x: number, y: number, z: number): void {
    const count = 46;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const speed = 5.4 + Math.random() * 8.8;
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

    // Authentic volumetric Tokusatsu explosion cloud burst (hot fireball -> rolling backlit smoke!)
    const isHotBlast =
      reactionId === 'OVERLOAD' || reactionId === 'WILDFIRE' || reactionId === 'ECLIPSE';
    if (isHotBlast) {
      const tintHex =
        reactionId === 'ECLIPSE'
          ? 0xa855f7
          : reactionId === 'WILDFIRE'
            ? 0xf97316
            : 0xff5722;
      this.scratchColor.setHex(tintHex);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
        const radialSpd = 1.4 + Math.random() * 3.1;
        this.spawnCloud(
          x + Math.cos(a) * 0.55,
          Math.max(0.4, y + Math.random() * 0.55),
          z + Math.sin(a) * 0.55,
          Math.cos(a) * radialSpd,
          2.2 + Math.random() * 3.2,
          Math.sin(a) * radialSpd,
          1.35,
          2.3,
          0.95 + Math.random() * 0.55,
          1.15,
          3.55,
          1.0,
          this.scratchColor.r,
          this.scratchColor.g,
          this.scratchColor.b
        );
      }
      this.emitDustRing(x, 0.32, z, 8, 0x9ca3af, 2.2);
    } else {
      const smokeColor = reactionId === 'STEAM_BURST' ? 0xf1f5f9 : 0xbae6fd;
      this.emitDustRing(x, 0.38, z, 12, smokeColor, 2.25);
    }
  }

  /**
   * Live-action Toei quarry pyrotechnic detonation:
   * - Billowing multi-tier incandescent fireball-to-dark-smoke mushroom plume
   * - Expanding ground concrete dust wave
   * - Bouncing hot metal/ember sparks + rising drifting glowing cinders
   */
  public emitTokusatsuExplosion(
    element: ElementId,
    x: number,
    y: number,
    z: number,
    scale = 1.0
  ): void {
    const cfg = getElementConfig(element);
    this.scratchColor.set(cfg.primaryColor);
    this.scratchColorB.set(cfg.emissiveColor);

    // 1. Multi-tier volumetric Fireball -> Rolling Dark Smoke Plume
    const plumeCount = Math.min(24, Math.max(14, Math.round(18 * scale)));
    for (let i = 0; i < plumeCount; i++) {
      const isCrown = i < plumeCount * 0.45;
      const angle = (i / plumeCount) * Math.PI * 2 + Math.random() * 0.55;
      const radialSpeed = (isCrown ? 0.6 + Math.random() * 2.1 : 2.4 + Math.random() * 3.8) * scale;
      const upwardSpeed = (isCrown ? 4.2 + Math.random() * 4.4 : 1.5 + Math.random() * 2.6) * scale;
      const startSc = (isCrown ? 1.15 : 0.95) * scale;
      const endSc = (isCrown ? 4.4 : 3.4) * scale;
      const life = (isCrown ? 1.25 : 0.95) + Math.random() * 0.55;

      this.spawnCloud(
        x + Math.cos(angle) * (0.35 + Math.random() * 0.85) * scale,
        Math.max(0.35, y + (isCrown ? 0.75 : 0.25) + Math.random() * 0.6 * scale),
        z + Math.sin(angle) * (0.35 + Math.random() * 0.85) * scale,
        Math.cos(angle) * radialSpeed,
        upwardSpeed,
        Math.sin(angle) * radialSpeed,
        isCrown ? 1.75 : 0.85,
        isCrown ? 1.9 : 2.6,
        life,
        startSc,
        endSc,
        1.0,
        this.scratchColorB.r,
        this.scratchColorB.g,
        this.scratchColorB.b
      );
    }

    // 2. Low horizontal warm concrete dust shockwave collar (tight & realistic, never hides the fireball!)
    this.emitDustRing(x, 0.42, z, Math.min(10, Math.round(8 * scale)), 0x78716c, 1.65 * scale);

    // 3. Razor-fine bouncing incandescent welding/pyro sparks showering across the concrete floor
    const sparkCount = Math.min(60, Math.round(44 * scale));
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (5.0 + Math.random() * 10.5) * Math.sqrt(scale);
      const useHotGold = i % 4 === 0;
      const useAmber = i % 4 === 1 || i % 4 === 2;
      if (useHotGold) {
        this.scratchColor.setHex(0xfef08a);
      } else if (useAmber) {
        this.scratchColor.setHex(i % 2 === 0 ? 0xfb923c : 0xea580c);
      } else {
        this.scratchColor.copy(this.scratchColorB);
      }

      this.spawnSpark(
        x + (Math.random() - 0.5) * 1.1 * scale,
        y + 0.35 + Math.random() * 1.0 * scale,
        z + (Math.random() - 0.5) * 1.1 * scale,
        Math.cos(angle) * speed,
        3.8 + Math.random() * 8.2 * Math.sqrt(scale),
        Math.sin(angle) * speed,
        -17.5,
        0.55 + Math.random() * 0.45,
        (0.85 + Math.random() * 0.65) * Math.min(1.25, scale),
        1.55,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }

    // 4. Slow drifting glowing cinders floating out of the smoke column
    const emberCount = Math.min(28, Math.round(20 * scale));
    for (let i = 0; i < emberCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.5 + Math.random() * 2.2) * scale;
      const useElem = i % 3 === 0;
      const rCol = useElem ? this.scratchColorB.r : 1.0;
      const gCol = useElem ? this.scratchColorB.g : 0.62;
      const bCol = useElem ? this.scratchColorB.b : 0.16;
      this.spawnEmber(
        x + Math.cos(a) * r,
        y + 0.3 + Math.random() * 1.5 * scale,
        z + Math.sin(a) * r,
        Math.cos(a) * (0.8 + Math.random() * 1.5),
        1.8 + Math.random() * 3.4,
        Math.sin(a) * (0.8 + Math.random() * 1.5),
        1.15 + Math.random() * 0.85,
        (0.16 + Math.random() * 0.18) * Math.min(1.35, scale),
        1.45,
        3.6 + Math.random() * 2.8,
        rCol,
        gCol,
        bCol
      );
    }
  }

  /**
   * Heroic Tokusatsu Henshin Ascension burst:
   * - Spiraling upward energy motes + crisp elemental flash sparks + clean ground dust collar
   * (zero dark smoke obscuring the Rider's newly transformed armor!)
   */
  public emitHenshinAscension(
    element: ElementId,
    x: number,
    y: number,
    z: number,
    isUltimate: boolean
  ): void {
    const cfg = getElementConfig(element);
    this.scratchColor.set(cfg.primaryColor);
    this.scratchColorB.set(cfg.emissiveColor);

    const emberCount = isUltimate ? 48 : 30;
    for (let i = 0; i < emberCount; i++) {
      const angle = (i / emberCount) * Math.PI * 2 + Math.random() * 0.3;
      const radius = 0.65 + Math.random() * (isUltimate ? 2.4 : 1.65);
      const isGold = isUltimate && i % 3 === 0;
      const rCol = isGold ? 1.0 : i % 2 === 0 ? this.scratchColorB.r : this.scratchColor.r;
      const gCol = isGold ? 0.88 : i % 2 === 0 ? this.scratchColorB.g : this.scratchColor.g;
      const bCol = isGold ? 0.32 : i % 2 === 0 ? this.scratchColorB.b : this.scratchColor.b;
      this.spawnEmber(
        x + Math.cos(angle) * radius,
        0.15 + Math.random() * 1.2,
        z + Math.sin(angle) * radius,
        Math.cos(angle) * (isUltimate ? 1.6 : 1.0),
        (isUltimate ? 4.4 : 3.2) + Math.random() * 3.5,
        Math.sin(angle) * (isUltimate ? 1.6 : 1.0),
        (isUltimate ? 1.3 : 1.0) + Math.random() * 0.55,
        (isUltimate ? 0.24 : 0.18) + Math.random() * 0.16,
        isUltimate ? 2.4 : 1.6,
        6.5 + Math.random() * 3.5,
        rCol,
        gCol,
        bCol
      );
    }

    const sparkCount = isUltimate ? 54 : 34;
    for (let i = 0; i < sparkCount; i++) {
      const angle = (i / sparkCount) * Math.PI * 2;
      const speed = (isUltimate ? 7.2 : 5.2) + Math.random() * 6.5;
      const hex =
        i % 4 === 0
          ? 0xffffff
          : isUltimate && i % 3 === 0
            ? 0xfde047
            : this.scratchColorB.getHex();
      this.scratchColor.setHex(hex);
      this.spawnSpark(
        x + Math.cos(angle) * 0.45,
        y + 0.5 + Math.random() * 0.7,
        z + Math.sin(angle) * 0.45,
        Math.cos(angle) * speed,
        2.5 + Math.random() * (isUltimate ? 6.5 : 4.5),
        Math.sin(angle) * speed,
        -12.0,
        0.48 + Math.random() * 0.32,
        isUltimate ? 1.25 : 1.0,
        1.9,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }

    // Crisp sunlit radial shockwave dust collar sweeping outward along the floor
    this.emitDustRing(x, 0.24, z, isUltimate ? 14 : 10, isUltimate ? 0xfef3c7 : 0xe2e8f0, isUltimate ? 2.6 : 1.9);
  }

  public emitHitSparks(x: number, y: number, z: number, colorHex: number, isCrit: boolean): void {
    const count = isCrit ? 24 : 13;
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
        isCrit ? 1.85 : 1.45,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }
    this.emitDustRing(x, Math.max(0.22, y - 0.35), z, isCrit ? 4 : 2, 0xb8c2cc, isCrit ? 1.15 : 0.72);
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
      const speed = (1.15 + Math.random() * 2.4) * spread;
      this.spawnCloud(
        x + Math.cos(angle) * 0.42 * spread,
        y + Math.random() * 0.22,
        z + Math.sin(angle) * 0.42 * spread,
        Math.cos(angle) * speed,
        0.45 + Math.random() * 0.95,
        Math.sin(angle) * speed,
        0.35,
        3.0,
        0.65 + Math.random() * 0.42,
        0.62 * spread,
        2.35 * spread,
        0.0,
        this.scratchColor.r,
        this.scratchColor.g,
        this.scratchColor.b
      );
    }
  }

  public update(dt: number): void {
    if (dt <= 0) return;

    this.cloudTimeUniform.value += dt;
    this.emberTimeUniform.value += dt;

    // 1. Update Tapered Pyrotechnic Sparks
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
        this.sparkLifeAttr.setX(i, 1);
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
      const thickness = p.baseScale * 0.072 * (1 - t * 0.55);
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      const length = Math.max(0.14, Math.min(0.92, speed * 0.068 * p.lengthStretch * p.baseScale));

      this.scratchDummy.position.set(p.x, p.y, p.z);
      if (speed > 0.05) {
        this.scratchLookTarget.set(p.x + p.vx, p.y + p.vy, p.z + p.vz);
        this.scratchDummy.lookAt(this.scratchLookTarget);
      }
      this.scratchDummy.scale.set(thickness, thickness, length);
      this.scratchDummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.scratchDummy.matrix);
      this.sparkLifeAttr.setX(i, t);
    }

    if (sparkDirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.sparkLifeAttr.needsUpdate = true;
    }

    // 2. Update Volumetric Camera-Facing Fireball / Smoke / Dust Billboards
    let cloudDirty = false;
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const s = this.cloudSlots[i]!;
      if (!s.active) continue;

      cloudDirty = true;
      s.age += dt;
      if (s.age >= s.lifetime) {
        s.active = false;
        this.scratchDummy.position.set(0, -100, 0);
        this.scratchDummy.scale.set(0, 0, 0);
        this.scratchDummy.updateMatrix();
        this.cloudMesh.setMatrixAt(i, this.scratchDummy.matrix);
        this.cloudMetaAttr.setX(i, 1);
        continue;
      }

      const drag = Math.exp(-s.dragRate * dt);
      s.vx *= drag;
      s.vz *= drag;
      s.vy = s.vy * drag + s.riseAccel * dt;
      s.x += s.vx * dt;
      s.y = Math.max(0.18, s.y + s.vy * dt);
      s.z += s.vz * dt;
      s.angle += s.spinSpeed * dt;

      const t = s.age / s.lifetime;
      const expand = 1 - Math.pow(1 - t, 2.2);
      const sc = s.startScale + (s.endScale - s.startScale) * expand;
      // Lift billboard gently above floor so expanding clouds never slice sharply through the arena concrete!
      const liftY = Math.max(s.y, sc * 0.36);

      this.scratchDummy.position.set(s.x, liftY, s.z);
      this.scratchDummy.rotation.set(0, 0, 0);
      this.scratchDummy.scale.set(sc, sc, sc);
      this.scratchDummy.updateMatrix();
      this.cloudMesh.setMatrixAt(i, this.scratchDummy.matrix);
      this.cloudMetaAttr.setXYZW(i, t, s.seed, s.heatMode, s.angle);
    }

    if (cloudDirty) {
      this.cloudMesh.instanceMatrix.needsUpdate = true;
      this.cloudMetaAttr.needsUpdate = true;
    }

    // 3. Update Glowing Rising Embers / Ascension Energy Motes
    let emberDirty = false;
    for (let i = 0; i < MAX_EMBERS; i++) {
      const e = this.emberSlots[i]!;
      if (!e.active) continue;

      emberDirty = true;
      e.age += dt;
      if (e.age >= e.lifetime) {
        e.active = false;
        this.scratchDummy.position.set(0, -100, 0);
        this.scratchDummy.scale.set(0, 0, 0);
        this.scratchDummy.updateMatrix();
        this.emberMesh.setMatrixAt(i, this.scratchDummy.matrix);
        this.emberMetaAttr.setX(i, 1);
        continue;
      }

      const drag = Math.exp(-1.1 * dt);
      e.vx *= drag;
      e.vz *= drag;
      const swirlAngle = e.age * e.swirlFreq + e.seed * 6.283;
      e.x += (e.vx + Math.cos(swirlAngle) * e.swirlAmp) * dt;
      e.y += e.vy * dt;
      e.z += (e.vz + Math.sin(swirlAngle) * e.swirlAmp) * dt;

      const t = e.age / e.lifetime;
      const sc = e.scale * (1.0 - t * 0.45);
      this.scratchDummy.position.set(e.x, e.y, e.z);
      this.scratchDummy.rotation.set(0, 0, 0);
      this.scratchDummy.scale.set(sc, sc, sc);
      this.scratchDummy.updateMatrix();
      this.emberMesh.setMatrixAt(i, this.scratchDummy.matrix);
      this.emberMetaAttr.setXY(i, t, e.seed);
    }

    if (emberDirty) {
      this.emberMesh.instanceMatrix.needsUpdate = true;
      this.emberMetaAttr.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.sparkGeo.dispose();
    this.sparkMat.dispose();
    this.cloudGeo.dispose();
    this.cloudMat.dispose();
    this.emberGeo.dispose();
    this.emberMat.dispose();
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

    this.sparkColorAttr.setXYZ(idx, r, g, b);
    this.sparkColorAttr.needsUpdate = true;
    this.sparkLifeAttr.setX(idx, 0);
    this.sparkLifeAttr.needsUpdate = true;
  }

  private spawnCloud(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    riseAccel: number,
    dragRate: number,
    lifetime: number,
    startScale: number,
    endScale: number,
    heatMode: number,
    r: number,
    g: number,
    b: number
  ): void {
    const idx = this.cloudCursor;
    this.cloudCursor = (this.cloudCursor + 1) % MAX_CLOUDS;

    const slot = this.cloudSlots[idx]!;
    slot.active = true;
    slot.age = 0;
    slot.lifetime = lifetime;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.riseAccel = riseAccel;
    slot.dragRate = dragRate;
    slot.startScale = startScale;
    slot.endScale = endScale;
    slot.angle = Math.random() * Math.PI * 2;
    slot.spinSpeed = (Math.random() > 0.5 ? 1 : -1) * (0.45 + Math.random() * 0.95);
    slot.seed = Math.random() * 100.0;
    slot.heatMode = heatMode;

    this.cloudColorAttr.setXYZ(idx, r, g, b);
    this.cloudColorAttr.needsUpdate = true;
    this.cloudMetaAttr.setXYZW(idx, 0, slot.seed, heatMode, slot.angle);
    this.cloudMetaAttr.needsUpdate = true;
  }

  private spawnEmber(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    lifetime: number,
    scale: number,
    swirlAmp: number,
    swirlFreq: number,
    r: number,
    g: number,
    b: number
  ): void {
    const idx = this.emberCursor;
    this.emberCursor = (this.emberCursor + 1) % MAX_EMBERS;

    const slot = this.emberSlots[idx]!;
    slot.active = true;
    slot.age = 0;
    slot.lifetime = lifetime;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.scale = scale;
    slot.swirlAmp = swirlAmp;
    slot.swirlFreq = swirlFreq;
    slot.seed = Math.random() * 100.0;

    this.emberColorAttr.setXYZ(idx, r, g, b);
    this.emberColorAttr.needsUpdate = true;
    this.emberMetaAttr.setXY(idx, 0, slot.seed);
    this.emberMetaAttr.needsUpdate = true;
  }
}

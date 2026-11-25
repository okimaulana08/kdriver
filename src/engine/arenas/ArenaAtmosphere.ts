import * as THREE from 'three';

export interface AmbientParticleConfig {
  readonly count: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly baseSize: number;
  readonly riseSpeed: number;
  readonly driftSpeed: number;
  readonly colorA: number;
  readonly colorB: number;
  readonly opacity: number;
  readonly additive?: boolean;
}

export interface DisposableAtmospherePart {
  readonly object: THREE.Object3D;
  update?: (dt: number) => void;
  dispose(): void;
}

const AMBIENT_PARTICLE_VERTEX = /* glsl */ `
attribute float aPhase;
attribute float aScale;
attribute float aColorMix;

uniform float uTime;
uniform float uRiseSpeed;
uniform float uDriftSpeed;
uniform float uMinY;
uniform float uHeightSpan;
uniform float uBaseSize;

varying float vAlpha;
varying float vColorMix;
varying float vPulse;

void main() {
  vec3 pos = position;

  if (uRiseSpeed > 0.001) {
    // Rising thermal embers / spores wrapping seamlessly across vertical span
    float yOff = mod((pos.y - uMinY) + uTime * uRiseSpeed * (0.65 + aScale * 0.55), uHeightSpan);
    pos.y = uMinY + yOff;
    float lifeT = yOff / max(0.001, uHeightSpan);
    vAlpha = smoothstep(0.0, 0.14, lifeT) * (1.0 - smoothstep(0.72, 1.0, lifeT));
    // Spiraling thermal air currents
    pos.x += sin(uTime * 1.15 + aPhase + lifeT * 4.5) * uDriftSpeed;
    pos.z += cos(uTime * 0.95 + aPhase * 1.3 + lifeT * 4.0) * uDriftSpeed;
  } else {
    // Gentle floating fireflies / sunlit harbor dust motes
    pos.x += sin(uTime * 0.55 + aPhase) * uDriftSpeed;
    pos.y += sin(uTime * 0.85 + aPhase * 1.7) * 0.55;
    pos.z += cos(uTime * 0.48 + aPhase * 1.2) * uDriftSpeed;
    vAlpha = 0.45 + 0.55 * sin(uTime * 1.8 + aPhase * 2.3) * sin(uTime * 1.8 + aPhase * 2.3);
  }

  vColorMix = aColorMix;
  vPulse = 0.72 + 0.28 * sin(uTime * 4.2 + aPhase * 5.0);

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPos;
  float distScale = clamp(240.0 / max(2.0, -mvPos.z), 4.0, 48.0);
  gl_PointSize = uBaseSize * aScale * distScale;
}
`;

const AMBIENT_PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uOpacity;

varying float vAlpha;
varying float vColorMix;
varying float vPulse;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c) * 2.0;
  if (d > 1.0) discard;

  // Soft glowing bokeh core + smooth halo falloff
  float core = pow(1.0 - d, 2.2);
  vec3 col = mix(uColorA, uColorB, vColorMix) * (0.85 + 0.55 * core) * vPulse;
  float alpha = core * vAlpha * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Creates a 100% GPU-driven ambient environmental particle field (volcanic embers,
 * forest fireflies, or sunlit harbor dust motes) — 1 draw call, zero per-frame allocations!
 */
export function createAmbientParticleField(
  name: string,
  config: AmbientParticleConfig
): DisposableAtmospherePart {
  const { count, innerRadius, outerRadius, minHeight, maxHeight } = config;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const scales = new Float32Array(count);
  const colorMixes = new Float32Array(count);

  const hash = (n: number): number => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };

  for (let i = 0; i < count; i++) {
    const a = hash(i * 3.1 + 1.7) * Math.PI * 2;
    const rT = Math.sqrt(hash(i * 5.7 + 2.3));
    const r = innerRadius + rT * (outerRadius - innerRadius);
    const y = minHeight + hash(i * 7.3 + 4.1) * (maxHeight - minHeight);

    positions[i * 3] = Math.sin(a) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.cos(a) * r;

    phases[i] = hash(i * 11.3 + 0.9) * Math.PI * 2;
    scales[i] = 0.55 + hash(i * 13.9 + 6.2) * 0.95;
    colorMixes[i] = hash(i * 17.1 + 3.4);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geo.setAttribute('aColorMix', new THREE.BufferAttribute(colorMixes, 1));

  const uniforms = {
    uTime: { value: 0 },
    uRiseSpeed: { value: config.riseSpeed },
    uDriftSpeed: { value: config.driftSpeed },
    uMinY: { value: minHeight },
    uHeightSpan: { value: Math.max(0.5, maxHeight - minHeight) },
    uBaseSize: { value: config.baseSize },
    uColorA: { value: new THREE.Color(config.colorA) },
    uColorB: { value: new THREE.Color(config.colorB) },
    uOpacity: { value: config.opacity },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: AMBIENT_PARTICLE_VERTEX,
    fragmentShader: AMBIENT_PARTICLE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: config.additive !== false ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.name = name;
  points.frustumCulled = false;

  let elapsed = 0;
  return {
    object: points,
    update: (dt: number) => {
      elapsed += dt;
      uniforms.uTime.value = elapsed;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

const CONTACT_AO_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const CONTACT_AO_FRAGMENT = /* glsl */ `
uniform float uStrength;
varying vec2 vUv;
void main() {
  float d = length((vUv - vec2(0.5)) * 2.0);
  if (d > 1.0) discard;
  float alpha = pow(1.0 - d, 1.9) * uStrength;
  gl_FragColor = vec4(0.01, 0.015, 0.02, alpha);
}
`;

export interface ContactShadowPlacement {
  readonly x: number;
  readonly z: number;
  readonly radiusX: number;
  readonly radiusZ?: number;
  readonly rotY?: number;
  readonly y?: number;
}

/**
 * Builds a single InstancedMesh of soft radial contact-shadow / ambient-occlusion discs
 * underneath arena props so barriers, cliffs, pillars, and trees feel heavily grounded.
 */
export function createContactShadowDiscs(
  name: string,
  placements: readonly ContactShadowPlacement[],
  strength = 0.56
): DisposableAtmospherePart {
  const geo = new THREE.PlaneGeometry(2, 2);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: strength } },
    vertexShader: CONTACT_AO_VERTEX,
    fragmentShader: CONTACT_AO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const inst = new THREE.InstancedMesh(geo, mat, placements.length);
  inst.name = name;
  inst.renderOrder = 1;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!;
    dummy.position.set(p.x, p.y ?? 0.015, p.z);
    dummy.rotation.set(0, p.rotY ?? 0, 0);
    dummy.scale.set(p.radiusX, 1, p.radiusZ ?? p.radiusX);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;

  return {
    object: inst,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Generates a crisp 128x128 RGBA botanical fern & wild woodland grass clump texture
 * (arching pinnate fern fronds + soft blades) for alpha-cutout crossed-card InstancedMesh foliage!
 */
export function createBotanicalFernTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);

  const drawBlade = (
    baseX: number,
    height: number,
    bend: number,
    halfWidth: number,
    isFern: boolean,
    rBase: number,
    gBase: number,
    bBase: number
  ) => {
    for (let py = 0; py < size; py++) {
      // v = 0 at bottom (py = size-1), v = 1 at top (py = 0)
      const v = (size - 1 - py) / (size - 1);
      if (v > height) continue;
      const t = v / height;
      const cx = baseX + bend * t * t;
      let w = halfWidth * Math.sin(Math.pow(t, 0.72) * Math.PI);

      if (isFern && t > 0.14) {
        // Serrated fern pinnae leaflets along the frond spine
        const pinna = Math.abs(Math.sin(t * Math.PI * 10.5));
        w *= 0.32 + 0.85 * Math.pow(pinna, 0.65);
      }

      const x0 = Math.max(0, Math.floor((cx - w) * (size - 1)));
      const x1 = Math.min(size - 1, Math.ceil((cx + w) * (size - 1)));
      for (let px = x0; px <= x1; px++) {
        const u = px / (size - 1);
        const edgeDist = Math.abs(u - cx) / Math.max(0.002, w);
        if (edgeDist > 1.0) continue;

        const shade = (0.58 + 0.52 * t) * (1.0 - 0.18 * edgeDist * edgeDist);
        const vein = Math.exp(-Math.pow((u - cx) * 55, 2)) * 0.16;
        const idx = (py * size + px) * 4;
        data[idx] = Math.min(255, Math.round((rBase * shade + vein * 65)));
        data[idx + 1] = Math.min(255, Math.round((gBase * shade + vein * 95)));
        data[idx + 2] = Math.min(255, Math.round((bBase * shade + vein * 35)));
        data[idx + 3] = 255;
      }
    }
  };

  // Back wild woodland grass blades (darker mossy base)
  drawBlade(0.46, 0.74, -0.26, 0.045, false, 48, 86, 36);
  drawBlade(0.54, 0.78, 0.28, 0.045, false, 52, 92, 38);
  drawBlade(0.5, 0.86, 0.05, 0.042, false, 58, 102, 42);
  drawBlade(0.42, 0.62, -0.34, 0.04, false, 42, 78, 32);
  drawBlade(0.58, 0.65, 0.35, 0.04, false, 46, 82, 34);

  // Foreground arching lush emerald fern fronds
  drawBlade(0.48, 0.82, -0.32, 0.145, true, 54, 108, 42);
  drawBlade(0.52, 0.84, 0.32, 0.145, true, 62, 118, 46);
  drawBlade(0.5, 0.94, -0.06, 0.13, true, 72, 132, 52);
  drawBlade(0.46, 0.66, -0.38, 0.12, true, 46, 94, 38);
  drawBlade(0.54, 0.68, 0.38, 0.12, true, 50, 98, 40);

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.flipY = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds a single crossed 2-card ("X") BufferGeometry grounded at y = 0 for realistic
 * 360-degree readable alpha-cutout fern bushes in 1 draw call!
 */
export function createCrossedFoliageCardGeometry(width = 1.45, height = 1.05): THREE.BufferGeometry {
  const hw = width * 0.5;
  // Two vertical quads intersecting at 90 degrees (+ a 3rd slight diagonal quad for lush density)
  const angles = [0, Math.PI / 3, (2 * Math.PI) / 3];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let q = 0; q < angles.length; q++) {
    const a = angles[q]!;
    const cx = Math.cos(a) * hw;
    const cz = Math.sin(a) * hw;
    const base = q * 4;

    positions.push(
      -cx, 0, -cz,
       cx, 0,  cz,
       cx, height,  cz,
      -cx, height, -cz
    );
    // Upward-biased normals give soft natural overhead sunlight shading on foliage cards
    normals.push(
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0
    );
    uvs.push(
      0, 0,
      1, 0,
      1, 1,
      0, 1
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

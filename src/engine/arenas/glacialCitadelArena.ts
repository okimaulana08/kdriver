import * as THREE from 'three';
import type { PbrTextureSet } from '../PbrMaterialSystem';
import {
  createContactShadowDiscs,
  type ContactShadowPlacement,
  type DisposableAtmospherePart,
} from './ArenaAtmosphere';
import type { ArenaThemePalette, MountedArenaTheme } from './ArenaThemeTypes';

export const GLACIAL_CITADEL_PALETTE: ArenaThemePalette = {
  fogColor: 0x131930,
  fogDensity: 0.0062,
  backgroundTint: 0x0d1226,
  deckColor: 0xdcf2ff,
  skirtColor: 0x24344d,
  hazardRingColor: 0x38bdf8,
  hemiSkyColor: 0xc4e8ff,
  hemiGroundColor: 0x2e1065,
  hemiIntensity: 0.96,
  sunColor: 0xf5d0fe,
  sunIntensity: 2.55,
  fillColor: 0x38bdf8,
  fillIntensity: 0.98,
  environmentIntensity: 1.42,
  backgroundBlurriness: 0.015,
};

const CRYO_MOAT_VERTEX_SHADER = /* glsl */ `
varying vec2 vWorldXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CRYO_MOAT_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uInnerRadius;
uniform float uOuterRadius;
varying vec2 vWorldXZ;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 41.3);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  float r = length(vWorldXZ);
  float angle = atan(vWorldXZ.y, vWorldXZ.x);

  vec2 flow = vWorldXZ * 0.20 + vec2(cos(angle) * uTime * 0.10, sin(angle) * uTime * 0.10);
  float warp = fbm(flow + vec2(uTime * 0.08, -uTime * 0.06));
  float veins = 1.0 - abs(fbm(flow * 1.65 + vec2(warp * 2.0, -warp * 1.5)) * 2.0 - 1.0);
  float auroraGlow = pow(veins, 2.6);

  vec3 deepGlacier = vec3(0.04, 0.11, 0.24);
  vec3 cryoCyan = vec3(0.24, 0.88, 1.25);
  vec3 eclipseViolet = vec3(0.95, 0.26, 0.82);

  float eclipseMix = 0.5 + 0.5 * sin(angle * 3.0 - uTime * 0.65 + warp * 3.5);
  vec3 veinCol = mix(cryoCyan, eclipseViolet, eclipseMix * 0.55);
  vec3 col = mix(deepGlacier, veinCol, clamp(auroraGlow * 0.95, 0.0, 1.0));

  float edgeNoise = (warp - 0.5) * 1.1;
  float innerFade = smoothstep(uInnerRadius - 0.35 + edgeNoise * 0.5, uInnerRadius + 1.05 + edgeNoise * 0.5, r);
  float outerFade = 1.0 - smoothstep(uOuterRadius - 2.3 + edgeNoise, uOuterRadius + edgeNoise, r);
  float alpha = clamp(innerFade * outerFade * 0.92, 0.0, 0.96);
  if (alpha < 0.015) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const ECLIPSE_SEAL_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uRadius;
varying vec2 vWorldXZ;

void main() {
  float r = length(vWorldXZ);
  if (r > uRadius) discard;
  float ang = atan(vWorldXZ.y, vWorldXZ.x);

  float outerRing = exp(-pow((r - (uRadius - 1.35)) * 5.0, 2.0));
  float innerSeal = exp(-pow((r - 5.4) * 5.8, 2.0));
  float frostStar = smoothstep(0.32, 0.92, cos(ang * 12.0 + uTime * 0.45) * 0.5 + 0.5);
  float shimmer = 0.72 + 0.28 * sin(uTime * 2.2 - r * 0.4);

  float glow = (outerRing * (0.45 + 0.55 * frostStar) + innerSeal * (0.38 + 0.52 * frostStar)) * shimmer;
  float alpha = clamp(glow * 0.55, 0.0, 0.75);
  if (alpha < 0.015) discard;

  float mixCol = 0.5 + 0.5 * sin(ang * 6.0 - uTime * 0.9);
  vec3 col = mix(vec3(0.35, 0.90, 1.0), vec3(0.92, 0.32, 0.82), mixCol * 0.48);
  gl_FragColor = vec4(col * 1.35, alpha);
}
`;

const SNOW_VERTEX_SHADER = /* glsl */ `
attribute float aPhase;
attribute float aScale;
attribute float aMix;
uniform float uTime;
varying float vAlpha;
varying float vMix;

void main() {
  vec3 pos = position;
  float span = 14.5;
  float fall = mod(pos.y - uTime * (1.85 + aScale * 0.95) + aPhase * span, span);
  pos.y = 0.2 + fall;
  pos.x += sin(uTime * 0.95 + aPhase * 6.28 + fall * 0.45) * 1.85 - uTime * 0.65;
  pos.x = mod(pos.x + 28.0, 56.0) - 28.0;
  pos.z += cos(uTime * 0.78 + aPhase * 5.1) * 1.35;

  float life = smoothstep(0.0, 1.6, fall) * (1.0 - smoothstep(12.0, span, fall));
  vAlpha = life * 0.85;
  vMix = aMix;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float distScale = clamp(220.0 / max(2.0, -mv.z), 3.0, 26.0);
  gl_PointSize = (0.48 + aScale * 0.52) * distScale;
}
`;

const SNOW_FRAGMENT_SHADER = /* glsl */ `
varying float vAlpha;
varying float vMix;
void main() {
  float d = length((gl_PointCoord - vec2(0.5)) * 2.0);
  if (d > 1.0) discard;
  float flake = pow(1.0 - d, 1.9);
  vec3 col = mix(vec3(0.84, 0.96, 1.0), vec3(0.96, 0.78, 1.0), vMix * 0.35);
  float alpha = flake * vAlpha;
  if (alpha < 0.015) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

function buildGlacialSummitTerrain(arenaRadius: number): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(arenaRadius + 0.35, 128, 84, 18);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);

    const crags =
      Math.sin(ang * 6.0 + r * 0.07) * 0.55 +
      Math.cos(ang * 13.0 - r * 0.11) * 0.35 +
      Math.sin(ang * 21.0 + r * 0.19) * 0.18;

    const chasmMask =
      THREE.MathUtils.smoothstep(r, arenaRadius + 0.5, arenaRadius + 2.1) *
      (1.0 - THREE.MathUtils.smoothstep(r, arenaRadius + 7.2, arenaRadius + 10.6));
    const ridgeT = THREE.MathUtils.smoothstep(r, arenaRadius + 8.6, arenaRadius + 29.0);
    const farPeakT = THREE.MathUtils.smoothstep(r, arenaRadius + 28.0, 96.0);

    const y =
      -0.06 -
      chasmMask * 1.15 +
      ridgeT * (2.05 + crags * 1.25) +
      farPeakT * (2.4 + crags * 1.55);

    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a sharp sculpted hexagonal glacier crystal spire BufferGeometry grounded at y = 0.
 */
function buildCrystalMonolithGeo(seed: number): THREE.BufferGeometry {
  const indexed = new THREE.CylinderGeometry(0.08, 1.55, 8.2, 6, 4, false);
  indexed.translate(0, 4.1, 0);
  const pos = indexed.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const yNorm = y / 8.2;
    const ang = Math.atan2(z, x);
    // Sharp angular quartz prism taper (flat-faceted crystalline bevels, zero rounded teardrops!)
    const flare = yNorm < 0.68 ? 1.0 + yNorm * 0.16 : Math.max(0.04, (1.0 - yNorm) / 0.32);
    const facet = 1.0 + Math.cos(ang * 3.0 + seed * 2.1) * 0.24;
    const shearX = yNorm * Math.sin(seed * 4.3) * 0.65;
    pos.setXYZ(i, x * flare * facet + shearX, y, z * flare * facet);
  }
  const faceted = indexed.toNonIndexed();
  indexed.dispose();
  faceted.computeVertexNormals();
  return faceted;
}

function createBlizzardSnowField(arenaRadius: number): DisposableAtmospherePart {
  const count = 280;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const scales = new Float32Array(count);
  const mixes = new Float32Array(count);

  const hash = (n: number): number => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  for (let i = 0; i < count; i++) {
    const a = hash(i * 3.3 + 1.4) * Math.PI * 2;
    const r = Math.sqrt(hash(i * 5.1 + 2.9)) * (arenaRadius + 13.5);
    positions[i * 3] = Math.sin(a) * r;
    positions[i * 3 + 1] = hash(i * 7.7 + 3.2) * 14.5;
    positions[i * 3 + 2] = Math.cos(a) * r;
    phases[i] = hash(i * 11.7 + 0.5);
    scales[i] = 0.5 + hash(i * 13.3 + 4.8) * 1.0;
    mixes[i] = hash(i * 17.9 + 2.1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geo.setAttribute('aMix', new THREE.BufferAttribute(mixes, 1));

  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SNOW_VERTEX_SHADER,
    fragmentShader: SNOW_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.name = 'GlacialBlizzardSnow';
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

/**
 * Lazy-loaded Sector 05 Arena: Glacial Eclipse Citadel (Frozen Summit under Crimson-Violet Eclipse).
 * Features cracked crystal-ice PBR deck, animated GLSL frozen aurora chasm moat, faceted physical
 * ice crystal monoliths, GPU swirling blizzard snowfield, and dramatic eclipse rim lighting.
 */
export function buildGlacialCitadelArenaTheme(
  pbrTextures: PbrTextureSet,
  arenaRadius: number
): MountedArenaTheme {
  const group = new THREE.Group();
  group.name = 'ArenaTheme_GlacialCitadel';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const atmosphereParts: DisposableAtmospherePart[] = [];

  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x3a5272,
    map: pbrTextures.floorAlbedo,
    normalMap: pbrTextures.floorNormal,
    normalScale: new THREE.Vector2(1.3, 1.3),
    roughnessMap: pbrTextures.floorRoughness,
    roughness: 0.72,
    metalness: 0.14,
    envMapIntensity: 1.15,
  });

  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0x7dd3fc,
    emissive: 0x0c4a6e,
    emissiveIntensity: 0.45,
    roughness: 0.14,
    metalness: 0.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.65,
  });

  const obsidianPillarMat = new THREE.MeshStandardMaterial({
    color: 0x1e1b4b,
    emissive: 0x581c87,
    emissiveIntensity: 0.25,
    roughness: 0.28,
    metalness: 0.65,
    envMapIntensity: 1.35,
  });

  const moatUniforms = {
    uTime: { value: 0 },
    uInnerRadius: { value: arenaRadius + 0.65 },
    uOuterRadius: { value: arenaRadius + 9.4 },
  };
  const moatMat = new THREE.ShaderMaterial({
    uniforms: moatUniforms,
    vertexShader: CRYO_MOAT_VERTEX_SHADER,
    fragmentShader: CRYO_MOAT_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const sealUniforms = {
    uTime: { value: 0 },
    uRadius: { value: arenaRadius - 0.3 },
  };
  const sealMat = new THREE.ShaderMaterial({
    uniforms: sealUniforms,
    vertexShader: CRYO_MOAT_VERTEX_SHADER,
    fragmentShader: ECLIPSE_SEAL_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  materials.push(terrainMat, crystalMat, obsidianPillarMat, moatMat, sealMat);

  // 1. Displaced Glacial Summit Ridge Terrain Skirt
  const terrainGeo = buildGlacialSummitTerrain(arenaRadius);
  geometries.push(terrainGeo);
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 2. Animated GLSL Subsurface Aurora-Eclipse Frozen Chasm Moat
  const moatGeo = new THREE.RingGeometry(arenaRadius + 0.4, arenaRadius + 9.8, 72, 4);
  geometries.push(moatGeo);
  const moatMesh = new THREE.Mesh(moatGeo, moatMat);
  moatMesh.rotation.x = -Math.PI / 2;
  moatMesh.position.y = -0.05;
  group.add(moatMesh);

  // 3. Animated Frost-Eclipse Citadel Floor Filigree Seal
  const sealGeo = new THREE.CircleGeometry(arenaRadius - 0.2, 64);
  geometries.push(sealGeo);
  const sealMesh = new THREE.Mesh(sealGeo, sealMat);
  sealMesh.rotation.x = -Math.PI / 2;
  sealMesh.position.y = 0.018;
  group.add(sealMesh);

  // 4. Instanced Towering Faceted Glacial Crystal Monoliths + Rim Obsidian Spires
  const crystalGeoA = buildCrystalMonolithGeo(1.1);
  const crystalGeoB = buildCrystalMonolithGeo(2.9);
  geometries.push(crystalGeoA, crystalGeoB);

  const outerCount = 16;
  const rimCount = 10;
  const crystalInst = new THREE.InstancedMesh(crystalGeoA, crystalMat, outerCount + rimCount);
  crystalInst.castShadow = true;
  crystalInst.receiveShadow = true;

  const obsidianCount = 8;
  const obsidianInst = new THREE.InstancedMesh(crystalGeoB, obsidianPillarMat, obsidianCount);
  obsidianInst.castShadow = true;
  obsidianInst.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const aoPlacements: ContactShadowPlacement[] = [];

  for (let i = 0; i < outerCount; i++) {
    const a = (i / outerCount) * Math.PI * 2 + 0.14;
    const dist = arenaRadius + 9.4 + (i % 3) * 3.5;
    const px = Math.sin(a) * dist;
    const pz = Math.cos(a) * dist;
    const hScale = 0.82 + (i % 4) * 0.28;
    dummy.position.set(px, -0.45, pz);
    dummy.rotation.set((i % 2 === 0 ? 1 : -1) * 0.12, a * 1.7 + i, ((i % 3) - 1) * 0.1);
    dummy.scale.set(0.85 + (i % 3) * 0.25, hScale, 0.85 + ((i + 1) % 3) * 0.22);
    dummy.updateMatrix();
    crystalInst.setMatrixAt(i, dummy.matrix);
    aoPlacements.push({ x: px, z: pz, radiusX: 2.8 * hScale, y: 0.04 });
  }

  for (let i = 0; i < rimCount; i++) {
    const a = (i / rimCount) * Math.PI * 2 + 0.31;
    const dist = arenaRadius + 1.55 + (i % 2) * 0.55;
    const px = Math.sin(a) * dist;
    const pz = Math.cos(a) * dist;
    const hScale = 0.28 + (i % 3) * 0.11;
    dummy.position.set(px, -0.35, pz);
    dummy.rotation.set((i % 2 === 0 ? -1 : 1) * 0.24, a * 2.1, ((i % 3) - 1) * 0.18);
    dummy.scale.set(0.55 + (i % 2) * 0.18, hScale, 0.55 + ((i + 1) % 2) * 0.16);
    dummy.updateMatrix();
    crystalInst.setMatrixAt(outerCount + i, dummy.matrix);
    aoPlacements.push({ x: px, z: pz, radiusX: 1.45, y: 0.025 });
  }
  crystalInst.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < obsidianCount; i++) {
    const a = (i / obsidianCount) * Math.PI * 2 + 0.5;
    const dist = arenaRadius + 12.2 + (i % 2) * 3.8;
    const px = Math.sin(a) * dist;
    const pz = Math.cos(a) * dist;
    const hScale = 1.05 + (i % 3) * 0.3;
    dummy.position.set(px, -0.5, pz);
    dummy.rotation.set(0.06, a, -0.05);
    dummy.scale.set(1.05, hScale, 1.05);
    dummy.updateMatrix();
    obsidianInst.setMatrixAt(i, dummy.matrix);
  }
  obsidianInst.instanceMatrix.needsUpdate = true;
  group.add(crystalInst, obsidianInst);

  // 5. Contact AO + Swirling Blizzard Snowfield
  const aoDiscs = createContactShadowDiscs('GlacialContactAO', aoPlacements, 0.54);
  const snowField = createBlizzardSnowField(arenaRadius);
  atmosphereParts.push(aoDiscs, snowField);
  group.add(aoDiscs.object, snowField.object);

  // 6. Glacial Cyan & Crimson-Violet Eclipse Rim PointLights
  const cryoLight = new THREE.PointLight(0x38bdf8, 22, 38, 1.45);
  cryoLight.position.set(arenaRadius + 2.0, 3.4, 5.0);
  const eclipseLight = new THREE.PointLight(0xe879f9, 20, 40, 1.4);
  eclipseLight.position.set(-(arenaRadius + 1.8), 4.6, -7.0);
  const summitCoreLight = new THREE.PointLight(0x818cf8, 14, 30, 1.6);
  summitCoreLight.position.set(0, 2.2, 0);
  group.add(cryoLight, eclipseLight, summitCoreLight);

  let elapsed = 0;

  return {
    group,
    palette: GLACIAL_CITADEL_PALETTE,
    skyboxUrl: '/assets/textures/env_glacial_citadel_360.jpg',
    hidesBaseSkirt: true,
    floorTextureUrls: {
      albedo: '/assets/textures/floor_glacial_ice_albedo.jpg',
      normal: '/assets/textures/floor_glacial_ice_normal.png',
      roughness: '/assets/textures/floor_glacial_ice_roughness.png',
      deckRepeat: 5,
      skirtRepeat: 22,
    },
    onFloorTexturesLoaded: (albedo, normal, roughness, skirtAlbedo, skirtNormal) => {
      if (skirtAlbedo) terrainMat.map = skirtAlbedo;
      else if (albedo) terrainMat.map = albedo;
      if (skirtNormal) terrainMat.normalMap = skirtNormal;
      else if (normal) terrainMat.normalMap = normal;
      if (roughness) terrainMat.roughnessMap = roughness;
      terrainMat.needsUpdate = true;
    },
    update: (dt: number) => {
      elapsed += dt;
      moatUniforms.uTime.value = elapsed;
      sealUniforms.uTime.value = elapsed;
      cryoLight.intensity = 20 + Math.sin(elapsed * 2.1) * 3.5;
      eclipseLight.intensity = 18 + Math.cos(elapsed * 1.7 + 0.9) * 4.0;
      summitCoreLight.intensity = 12 + Math.sin(elapsed * 2.6) * 2.5;
      snowField.update?.(dt);
    },
    dispose: () => {
      for (let i = 0; i < atmosphereParts.length; i++) atmosphereParts[i]!.dispose();
      for (let i = 0; i < geometries.length; i++) geometries[i]!.dispose();
      for (let i = 0; i < materials.length; i++) materials[i]!.dispose();
    },
  };
}

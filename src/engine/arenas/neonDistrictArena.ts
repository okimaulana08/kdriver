import * as THREE from 'three';
import type { PbrTextureSet } from '../PbrMaterialSystem';
import {
  createContactShadowDiscs,
  type ContactShadowPlacement,
  type DisposableAtmospherePart,
} from './ArenaAtmosphere';
import type { ArenaThemePalette, MountedArenaTheme } from './ArenaThemeTypes';

export const NEON_DISTRICT_PALETTE: ArenaThemePalette = {
  fogColor: 0x0a1324,
  fogDensity: 0.0066,
  backgroundTint: 0x070e1c,
  deckColor: 0xc2d4ea,
  skirtColor: 0x1b263b,
  hazardRingColor: 0x22d3ee,
  hemiSkyColor: 0x7dd3fc,
  hemiGroundColor: 0x1e1b4b,
  hemiIntensity: 0.95,
  sunColor: 0xe0f2fe,
  sunIntensity: 2.35,
  fillColor: 0xe879f9,
  fillIntensity: 0.98,
  environmentIntensity: 1.45,
  backgroundBlurriness: 0.015,
};

const NEON_GRID_VERTEX_SHADER = /* glsl */ `
varying vec2 vWorldXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const NEON_GRID_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uRadius;
varying vec2 vWorldXZ;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  float r = length(vWorldXZ);
  if (r > uRadius + 0.2) discard;
  float ang = atan(vWorldXZ.y, vWorldXZ.x);

  // Sleek cyberpunk helipad neon border ring + tactical directional chevrons
  float outerRing = exp(-pow((r - (uRadius - 1.15)) * 5.2, 2.0));
  float innerRing = exp(-pow((r - (uRadius - 2.35)) * 8.5, 2.0)) * 0.55;
  float dashes = smoothstep(0.15, 0.55, sin(ang * 24.0 - uTime * 1.4) * 0.5 + 0.5);
  float centerCross = exp(-pow((r - 5.2) * 6.5, 2.0)) * 0.35 *
                      smoothstep(0.35, 0.85, cos(ang * 8.0 + uTime * 0.8) * 0.5 + 0.5);

  // Subtle wet raindrop ripple rings across the rooftop asphalt
  vec2 cell = floor(vWorldXZ * 0.55);
  vec2 f = fract(vWorldXZ * 0.55) - 0.5;
  float rnd = hash21(cell);
  float dropT = fract(uTime * (0.75 + rnd * 0.55) + rnd * 7.0);
  float distToDrop = length(f - (vec2(hash21(cell + 13.0), hash21(cell + 29.0)) - 0.5) * 0.45);
  float ripple = exp(-pow((distToDrop - dropT * 0.42) * 32.0, 2.0)) * (1.0 - dropT) * 0.32;

  float cyanMix = 0.5 + 0.5 * sin(ang * 4.0 + uTime * 1.2);
  vec3 neonCol = mix(vec3(0.08, 0.88, 1.0), vec3(0.92, 0.24, 0.88), cyanMix * 0.65);

  float glow = outerRing * (0.45 + 0.55 * dashes) + innerRing * 0.5 + centerCross + ripple;
  float alpha = clamp(glow * 0.62, 0.0, 0.82);
  if (alpha < 0.015) discard;
  gl_FragColor = vec4(neonCol * 1.35 + vec3(ripple * 0.65), alpha);
}
`;

const BILLBOARD_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BILLBOARD_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uSeed;
varying vec2 vUv;

void main() {
  float scan = 0.82 + 0.18 * sin(vUv.y * 95.0 - uTime * 9.0 + uSeed * 6.0);
  float sweep = exp(-pow((fract(vUv.y - uTime * 0.25 + uSeed) - 0.5) * 8.0, 2.0));
  float border = max(
    smoothstep(0.08, 0.0, min(vUv.x, 1.0 - vUv.x)),
    smoothstep(0.05, 0.0, min(vUv.y, 1.0 - vUv.y))
  );
  float bars = smoothstep(0.35, 0.85, sin(vUv.y * 22.0 + uSeed * 5.0) * 0.5 + 0.5) *
               smoothstep(0.25, 0.75, sin(vUv.x * 12.0 - uSeed * 3.0) * 0.5 + 0.5);
  vec3 col = mix(uColorA, uColorB, clamp(vUv.y + sweep * 0.4, 0.0, 1.0));
  float intensity = (0.35 + bars * 0.45 + sweep * 0.65 + border * 0.95) * scan;
  gl_FragColor = vec4(col * intensity * 1.4, clamp(0.45 + border * 0.5 + bars * 0.35, 0.0, 0.95));
}
`;

const RAIN_VERTEX_SHADER = /* glsl */ `
attribute vec3 aOffset;
attribute float aPhase;
attribute float aSpeed;
uniform float uTime;
varying float vAlpha;

void main() {
  float heightSpan = 20.0;
  float fall = mod(aOffset.y - uTime * aSpeed + aPhase * heightSpan, heightSpan);
  // Subtle storm-wind diagonal slant
  vec3 worldCenter = vec3(
    aOffset.x + sin(uTime * 0.4 + aPhase * 6.28) * 0.35 - (heightSpan - fall) * 0.08,
    fall,
    aOffset.z + cos(uTime * 0.35 + aPhase * 4.1) * 0.25
  );

  // Camera-aligned vertical rain streak ribbon (billboard around Y axis)
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 streakDir = normalize(vec3(-0.08, 1.0, 0.02));
  vec3 displaced = worldCenter + camRight * position.x + streakDir * position.y;

  float lifeFade = smoothstep(0.0, 1.8, fall) * (1.0 - smoothstep(16.5, 20.0, fall));
  vAlpha = lifeFade * (0.32 + 0.25 * (1.0 - abs(position.y) * 1.4));
  gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
}
`;

const RAIN_FRAGMENT_SHADER = /* glsl */ `
varying float vAlpha;
void main() {
  if (vAlpha < 0.02) discard;
  gl_FragColor = vec4(0.68, 0.88, 1.0, vAlpha);
}
`;

function buildNeonRooftopSurround(arenaRadius: number): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(arenaRadius + 0.25, 118, 72, 12);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    // Raised helipad curb around arenaRadius+0.5..+2.8, then drops sharply into cyberpunk city canyon abyss!
    const curb =
      THREE.MathUtils.smoothstep(r, arenaRadius + 0.25, arenaRadius + 1.1) *
      (1.0 - THREE.MathUtils.smoothstep(r, arenaRadius + 3.2, arenaRadius + 5.0));
    const drop = THREE.MathUtils.smoothstep(r, arenaRadius + 4.2, arenaRadius + 15.0);
    pos.setY(i, curb * 0.42 - drop * 9.5 - 0.06);
  }
  geo.computeVertexNormals();
  return geo;
}

function createGpuRainStreaks(arenaRadius: number): DisposableAtmospherePart {
  const count = 420;
  const baseQuad = new THREE.PlaneGeometry(0.032, 0.92);
  const instGeo = new THREE.InstancedBufferGeometry();
  if (baseQuad.index) instGeo.setIndex(baseQuad.index.clone());
  instGeo.setAttribute('position', baseQuad.attributes.position!.clone());
  instGeo.setAttribute('uv', baseQuad.attributes.uv!.clone());
  baseQuad.dispose();

  const offsets = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);

  const hash = (n: number): number => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  for (let i = 0; i < count; i++) {
    const a = hash(i * 3.7 + 1.1) * Math.PI * 2;
    const r = Math.sqrt(hash(i * 5.9 + 2.7)) * (arenaRadius + 10.5);
    offsets[i * 3] = Math.sin(a) * r;
    offsets[i * 3 + 1] = hash(i * 7.1 + 4.3) * 20.0;
    offsets[i * 3 + 2] = Math.cos(a) * r;
    phases[i] = hash(i * 11.3 + 0.8);
    speeds[i] = 17.5 + hash(i * 13.7 + 6.1) * 9.0;
  }

  instGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  instGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  instGeo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
  instGeo.instanceCount = count;

  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: RAIN_VERTEX_SHADER,
    fragmentShader: RAIN_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(instGeo, mat);
  mesh.name = 'NeonRainStreaks';
  mesh.frustumCulled = false;

  let elapsed = 0;
  return {
    object: mesh,
    update: (dt: number) => {
      elapsed += dt;
      uniforms.uTime.value = elapsed;
    },
    dispose: () => {
      instGeo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Lazy-loaded Sector 04 Arena: Neon Rain District (Cyberpunk Skyscraper Rooftop).
 * Features wet reflective asphalt puddles (low-roughness PBR + PMREM IBL), GLSL rain streaks,
 * neon holographic perimeter pylons & skyline megastructures, and ambient storm lightning flashes.
 */
export function buildNeonDistrictArenaTheme(
  pbrTextures: PbrTextureSet,
  arenaRadius: number
): MountedArenaTheme {
  const group = new THREE.Group();
  group.name = 'ArenaTheme_NeonDistrict';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const atmosphereParts: DisposableAtmospherePart[] = [];

  const surroundMat = new THREE.MeshStandardMaterial({
    color: 0x1c273a,
    map: pbrTextures.floorAlbedo,
    normalMap: pbrTextures.floorNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: pbrTextures.floorRoughness,
    roughness: 0.45,
    metalness: 0.25,
    envMapIntensity: 1.3,
  });

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x1f2937,
    roughness: 0.34,
    metalness: 0.72,
    envMapIntensity: 1.4,
  });

  const towerGlassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.18,
    metalness: 0.85,
    envMapIntensity: 1.5,
  });

  const cyanGlowMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
  const magentaGlowMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });

  const gridUniforms = {
    uTime: { value: 0 },
    uRadius: { value: arenaRadius },
  };
  const neonGridMat = new THREE.ShaderMaterial({
    uniforms: gridUniforms,
    vertexShader: NEON_GRID_VERTEX_SHADER,
    fragmentShader: NEON_GRID_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  materials.push(surroundMat, steelMat, towerGlassMat, cyanGlowMat, magentaGlowMat, neonGridMat);

  // 1. Rooftop Curb & Recessed Cyberpunk City Canyon Skirt
  const surroundGeo = buildNeonRooftopSurround(arenaRadius);
  geometries.push(surroundGeo);
  const surroundMesh = new THREE.Mesh(surroundGeo, surroundMat);
  surroundMesh.receiveShadow = true;
  group.add(surroundMesh);

  // 2. Animated GLSL Wet-Neon Rooftop Grid & Raindrop Ripples on Asphalt
  const gridGeo = new THREE.CircleGeometry(arenaRadius + 0.15, 64);
  geometries.push(gridGeo);
  const gridMesh = new THREE.Mesh(gridGeo, neonGridMat);
  gridMesh.rotation.x = -Math.PI / 2;
  gridMesh.position.y = 0.018;
  group.add(gridMesh);

  // 3. Instanced Rooftop Tactical Parapet Barriers & Cyberpunk Neon Pylon Lamps
  const barrierGeo = new THREE.BoxGeometry(3.4, 0.92, 0.62);
  const pylonGeo = new THREE.BoxGeometry(0.42, 6.2, 0.42);
  const pylonStripGeo = new THREE.BoxGeometry(0.14, 4.8, 0.46);
  const pylonArmGeo = new THREE.BoxGeometry(0.28, 0.24, 1.55);
  geometries.push(barrierGeo, pylonGeo, pylonStripGeo, pylonArmGeo);

  const barrierCount = 12;
  const barrierInst = new THREE.InstancedMesh(barrierGeo, steelMat, barrierCount);
  barrierInst.castShadow = true;
  barrierInst.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const aoPlacements: ContactShadowPlacement[] = [];

  for (let i = 0; i < barrierCount; i++) {
    const a = (i / barrierCount) * Math.PI * 2 + 0.13;
    const dist = arenaRadius + 1.25;
    const bx = Math.sin(a) * dist;
    const bz = Math.cos(a) * dist;
    dummy.position.set(bx, 0.46, bz);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    barrierInst.setMatrixAt(i, dummy.matrix);
    aoPlacements.push({ x: bx, z: bz, radiusX: 2.1, radiusZ: 1.0, rotY: a, y: 0.02 });
  }
  barrierInst.instanceMatrix.needsUpdate = true;
  group.add(barrierInst);

  const pylonCount = 8;
  const pylonInst = new THREE.InstancedMesh(pylonGeo, steelMat, pylonCount);
  const pylonArmInst = new THREE.InstancedMesh(pylonArmGeo, steelMat, pylonCount);
  pylonInst.castShadow = true;

  for (let i = 0; i < pylonCount; i++) {
    const a = (i / pylonCount) * Math.PI * 2;
    const dist = arenaRadius + 2.35;
    const px = Math.sin(a) * dist;
    const pz = Math.cos(a) * dist;

    dummy.position.set(px, 3.1, pz);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    pylonInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(
      px - Math.sin(a) * 0.65,
      6.05,
      pz - Math.cos(a) * 0.65
    );
    dummy.rotation.set(0.12, a, 0);
    dummy.updateMatrix();
    pylonArmInst.setMatrixAt(i, dummy.matrix);

    const strip = new THREE.Mesh(pylonStripGeo, i % 2 === 0 ? cyanGlowMat : magentaGlowMat);
    strip.position.set(px, 3.25, pz);
    strip.rotation.y = a;
    group.add(strip);

    aoPlacements.push({ x: px, z: pz, radiusX: 1.25, y: 0.025 });
  }
  pylonInst.instanceMatrix.needsUpdate = true;
  pylonArmInst.instanceMatrix.needsUpdate = true;
  group.add(pylonInst, pylonArmInst);

  // 4. Outer Megacity Neon Skyscrapers & Animated Holographic Billboards
  const towerGeo = new THREE.BoxGeometry(5.8, 28, 5.8);
  const billboardGeo = new THREE.PlaneGeometry(3.8, 9.5);
  geometries.push(towerGeo, billboardGeo);

  const billboardUniformsList: Array<{ uTime: { value: number } }> = [];
  const towerCount = 10;
  const towerInst = new THREE.InstancedMesh(towerGeo, towerGlassMat, towerCount);

  for (let i = 0; i < towerCount; i++) {
    const a = (i / towerCount) * Math.PI * 2 + 0.22;
    const dist = arenaRadius + 18.5 + (i % 3) * 5.2;
    const tx = Math.sin(a) * dist;
    const tz = Math.cos(a) * dist;
    const hScale = 0.72 + (i % 4) * 0.24;
    dummy.position.set(tx, -6.5 + 14 * hScale, tz);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(0.85 + (i % 2) * 0.35, hScale, 0.85 + ((i + 1) % 2) * 0.3);
    dummy.updateMatrix();
    towerInst.setMatrixAt(i, dummy.matrix);

    // Animated vertical neon holo-billboard facing the combat rooftop
    const uUniforms = {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(i % 2 === 0 ? 0x06b6d4 : 0xec4899) },
      uColorB: { value: new THREE.Color(i % 2 === 0 ? 0x818cf8 : 0xf59e0b) },
      uSeed: { value: i * 1.37 },
    };
    billboardUniformsList.push(uUniforms);
    const bMat = new THREE.ShaderMaterial({
      uniforms: uUniforms,
      vertexShader: BILLBOARD_VERTEX_SHADER,
      fragmentShader: BILLBOARD_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.push(bMat);

    const bill = new THREE.Mesh(billboardGeo, bMat);
    const faceDist = dist - 3.6;
    bill.position.set(Math.sin(a) * faceDist, 5.8 + (i % 3) * 2.2, Math.cos(a) * faceDist);
    bill.lookAt(0, bill.position.y, 0);
    group.add(bill);
  }
  towerInst.instanceMatrix.needsUpdate = true;
  group.add(towerInst);

  // 5. Contact Shadows + GPU Rain Streaks
  const aoDiscs = createContactShadowDiscs('NeonRooftopContactAO', aoPlacements, 0.62);
  const rainStreaks = createGpuRainStreaks(arenaRadius);
  atmosphereParts.push(aoDiscs, rainStreaks);
  group.add(aoDiscs.object, rainStreaks.object);

  // 6. Dynamic Cyberpunk Neon Accent & Storm Lightning PointLights
  const cyanLight = new THREE.PointLight(0x22d3ee, 24, 38, 1.45);
  cyanLight.position.set(arenaRadius + 1.5, 4.2, -5.0);
  const magentaLight = new THREE.PointLight(0xf472b6, 22, 38, 1.45);
  magentaLight.position.set(-(arenaRadius + 1.5), 4.2, 6.0);
  const stormFlashLight = new THREE.PointLight(0xc4b5fd, 0, 72, 1.1);
  stormFlashLight.position.set(0, 18.0, -10.0);
  group.add(cyanLight, magentaLight, stormFlashLight);

  let elapsed = 0;

  return {
    group,
    palette: NEON_DISTRICT_PALETTE,
    skyboxUrl: '/assets/textures/env_neon_district_360.jpg',
    hidesBaseSkirt: true,
    floorTextureUrls: {
      albedo: '/assets/textures/floor_neon_asphalt_albedo.jpg',
      normal: '/assets/textures/floor_neon_asphalt_normal.png',
      roughness: '/assets/textures/floor_neon_asphalt_roughness.png',
      deckRepeat: 6,
      skirtRepeat: 20,
    },
    onFloorTexturesLoaded: (albedo, normal, roughness, skirtAlbedo, skirtNormal) => {
      if (skirtAlbedo) surroundMat.map = skirtAlbedo;
      else if (albedo) surroundMat.map = albedo;
      if (skirtNormal) surroundMat.normalMap = skirtNormal;
      else if (normal) surroundMat.normalMap = normal;
      if (roughness) surroundMat.roughnessMap = roughness;
      surroundMat.needsUpdate = true;
    },
    update: (dt: number) => {
      elapsed += dt;
      gridUniforms.uTime.value = elapsed;
      for (let i = 0; i < billboardUniformsList.length; i++) {
        billboardUniformsList[i]!.uTime.value = elapsed;
      }
      cyanLight.intensity = 22 + Math.sin(elapsed * 2.8) * 3.5;
      magentaLight.intensity = 20 + Math.cos(elapsed * 2.3 + 1.1) * 3.5;

      // Occasional ambient storm-cloud lightning sheet pulse (every ~6.5s)
      const cycle = elapsed % 6.5;
      const flashA = Math.exp(-Math.pow((cycle - 4.8) * 14.0, 2));
      const flashB = Math.exp(-Math.pow((cycle - 5.02) * 18.0, 2)) * 0.72;
      stormFlashLight.intensity = (flashA + flashB) * 38.0;

      rainStreaks.update?.(dt);
    },
    dispose: () => {
      for (let i = 0; i < atmosphereParts.length; i++) atmosphereParts[i]!.dispose();
      for (let i = 0; i < geometries.length; i++) geometries[i]!.dispose();
      for (let i = 0; i < materials.length; i++) materials[i]!.dispose();
    },
  };
}

import * as THREE from 'three';
import type { PbrTextureSet } from '../PbrMaterialSystem';
import {
  createAmbientParticleField,
  createContactShadowDiscs,
  type ContactShadowPlacement,
  type DisposableAtmospherePart,
} from './ArenaAtmosphere';
import type { ArenaThemePalette, MountedArenaTheme } from './ArenaThemeTypes';

export const ECLIPSE_SANCTUM_PALETTE: ArenaThemePalette = {
  fogColor: 0x1a0910,
  fogDensity: 0.0054,
  backgroundTint: 0x12060b,
  deckColor: 0xe6d6c3,
  skirtColor: 0x26141a,
  hazardRingColor: 0xf59e0b,
  hemiSkyColor: 0xffc896,
  hemiGroundColor: 0x2a0b15,
  hemiIntensity: 0.94,
  sunColor: 0xffd584,
  sunIntensity: 2.75,
  fillColor: 0xf43f5e,
  fillIntensity: 0.9,
  environmentIntensity: 1.4,
  backgroundBlurriness: 0.015,
};

const WORLD_XZ_VERTEX_SHADER = /* glsl */ `
varying vec2 vWorldXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ECLIPSE_ABYSS_MOAT_FRAGMENT_SHADER = /* glsl */ `
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

  vec2 swirl = vec2(cos(angle - uTime * 0.12), sin(angle - uTime * 0.12)) * r * 0.16;
  float n1 = fbm(swirl + vec2(uTime * 0.1, -uTime * 0.08));
  float ridge = 1.0 - abs(fbm(swirl * 1.85 + vec2(n1 * 2.2, -n1 * 1.7)) * 2.0 - 1.0);
  float corona = pow(ridge, 2.8);

  vec3 obsidianAbyss = vec3(0.05, 0.015, 0.025);
  vec3 crimsonFlare = vec3(1.05, 0.14, 0.24);
  vec3 imperialGold = vec3(1.25, 0.82, 0.22);

  float band = 0.5 + 0.5 * sin(angle * 4.0 + uTime * 0.75 + n1 * 3.0);
  vec3 veinCol = mix(crimsonFlare, imperialGold, band * 0.65);
  vec3 col = mix(obsidianAbyss, veinCol, clamp(corona * 1.05, 0.0, 1.0));

  float edgeNoise = (n1 - 0.5) * 1.1;
  float innerFade = smoothstep(uInnerRadius - 0.35 + edgeNoise * 0.5, uInnerRadius + 1.1 + edgeNoise * 0.5, r);
  float outerFade = 1.0 - smoothstep(uOuterRadius - 2.4 + edgeNoise, uOuterRadius + edgeNoise, r);
  float alpha = clamp(innerFade * outerFade * 0.94, 0.0, 0.96);
  if (alpha < 0.015) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const SOVEREIGN_SEAL_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uRadius;
varying vec2 vWorldXZ;

void main() {
  float r = length(vWorldXZ);
  if (r > uRadius) discard;
  float ang = atan(vWorldXZ.y, vWorldXZ.x);

  float outerRing = exp(-pow((r - (uRadius - 1.15)) * 5.2, 2.0));
  float midRing = exp(-pow((r - (uRadius * 0.56)) * 6.5, 2.0));
  float innerRing = exp(-pow((r - 4.6) * 5.5, 2.0));
  float runes = smoothstep(0.35, 0.92, cos(ang * 16.0 - uTime * 0.4) * 0.5 + 0.5);
  float spokes = exp(-pow(sin(ang * 4.0) * r * 0.65, 2.0)) * smoothstep(4.6, 5.2, r) * (1.0 - smoothstep(uRadius - 1.5, uRadius - 1.0, r));
  float pulse = 0.76 + 0.24 * sin(uTime * 2.0 - r * 0.35);

  float glow = (outerRing * (0.55 + 0.45 * runes) + midRing * 0.55 + innerRing * (0.5 + 0.5 * runes) + spokes * 0.22) * pulse;
  float alpha = clamp(glow * 0.58, 0.0, 0.78);
  if (alpha < 0.015) discard;

  float colMix = 0.5 + 0.5 * sin(ang * 8.0 + uTime * 0.85);
  vec3 col = mix(vec3(1.0, 0.72, 0.18), vec3(0.98, 0.18, 0.32), colMix * 0.52);
  gl_FragColor = vec4(col * 1.35, alpha);
}
`;

function buildColosseumAbyssTerrain(arenaRadius: number): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(arenaRadius + 0.3, 128, 72, 16);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);

    const steps = Math.sin(ang * 8.0) * 0.35 + Math.cos(ang * 16.0 + r * 0.09) * 0.24;
    const chasmDrop =
      THREE.MathUtils.smoothstep(r, arenaRadius + 0.45, arenaRadius + 2.2) *
      (1.0 - THREE.MathUtils.smoothstep(r, arenaRadius + 7.6, arenaRadius + 11.2));
    const outerTerrace = THREE.MathUtils.smoothstep(r, arenaRadius + 9.2, arenaRadius + 28.0);
    const farRuins = THREE.MathUtils.smoothstep(r, arenaRadius + 30.0, 96.0);

    const y =
      -0.08 -
      chasmDrop * 1.65 +
      outerTerrace * (1.55 + steps * 0.85) +
      farRuins * (1.8 + steps * 1.1);
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildObeliskGeo(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.42, 0.92, 9.2, 4, 1, false);
  geo.rotateY(Math.PI / 4);
  geo.translate(0, 4.6, 0);
  return geo;
}

/**
 * Lazy-loaded Endgame Boss Rush Arena: Eclipse Sanctum // Sovereign Colosseum.
 * Dedicated obsidian-and-imperial-gold dimension colosseum under a blazing Total Solar Eclipse:
 * - Custom 360° Eclipse Colosseum skybox + PMREM IBL
 * - Seamless dark obsidian-gold tiled floor albedo paired with battle-worn stone PBR maps
 * - Animated GLSL molten-crimson & imperial-gold eclipse abyss moat + floor sovereign rune seal
 * - 8 monumental obsidian-gold perimeter obelisks with floating levitating crimson-gold crystals
 * - 4 imperial colosseum triumphal arches + giant counter-rotating overhead Eclipse Crown halo
 * - Rising solar ember particle field + dynamic eclipse rim PointLights
 */
export function buildEclipseSanctumArenaTheme(
  pbrTextures: PbrTextureSet,
  arenaRadius: number
): MountedArenaTheme {
  const group = new THREE.Group();
  group.name = 'ArenaTheme_EclipseSanctum';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const atmosphereParts: DisposableAtmospherePart[] = [];

  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x3b262c,
    map: pbrTextures.floorAlbedo,
    normalMap: pbrTextures.floorNormal,
    normalScale: new THREE.Vector2(1.25, 1.25),
    roughnessMap: pbrTextures.floorRoughness,
    roughness: 0.68,
    metalness: 0.25,
    envMapIntensity: 1.25,
  });

  const obsidianMat = new THREE.MeshStandardMaterial({
    color: 0x16121a,
    emissive: 0x260812,
    emissiveIntensity: 0.35,
    roughness: 0.28,
    metalness: 0.82,
    envMapIntensity: 1.55,
  });

  const imperialGoldMat = new THREE.MeshStandardMaterial({
    color: 0xd99b26,
    emissive: 0x78350f,
    emissiveIntensity: 0.42,
    roughness: 0.24,
    metalness: 0.92,
    envMapIntensity: 1.8,
  });

  const crystalShardMat = new THREE.MeshPhysicalMaterial({
    color: 0xf43f5e,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.15,
    roughness: 0.12,
    metalness: 0.25,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.7,
  });

  const crownGlowMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const moatUniforms = {
    uTime: { value: 0 },
    uInnerRadius: { value: arenaRadius + 0.55 },
    uOuterRadius: { value: arenaRadius + 9.8 },
  };
  const moatMat = new THREE.ShaderMaterial({
    uniforms: moatUniforms,
    vertexShader: WORLD_XZ_VERTEX_SHADER,
    fragmentShader: ECLIPSE_ABYSS_MOAT_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const sealUniforms = {
    uTime: { value: 0 },
    uRadius: { value: arenaRadius - 0.25 },
  };
  const sealMat = new THREE.ShaderMaterial({
    uniforms: sealUniforms,
    vertexShader: WORLD_XZ_VERTEX_SHADER,
    fragmentShader: SOVEREIGN_SEAL_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  materials.push(
    terrainMat,
    obsidianMat,
    imperialGoldMat,
    crystalShardMat,
    crownGlowMat,
    moatMat,
    sealMat
  );

  // 1. Stepped Colosseum Abyss Skirt
  const terrainGeo = buildColosseumAbyssTerrain(arenaRadius);
  geometries.push(terrainGeo);
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 2. Animated GLSL Molten Crimson-Gold Eclipse Abyss Moat
  const moatGeo = new THREE.RingGeometry(arenaRadius + 0.35, arenaRadius + 10.2, 72, 4);
  geometries.push(moatGeo);
  const moatMesh = new THREE.Mesh(moatGeo, moatMat);
  moatMesh.rotation.x = -Math.PI / 2;
  moatMesh.position.y = -0.05;
  group.add(moatMesh);

  // 3. Sovereign Boss-Rush Golden-Crimson Floor Rune Seal
  const sealGeo = new THREE.CircleGeometry(arenaRadius - 0.15, 64);
  geometries.push(sealGeo);
  const sealMesh = new THREE.Mesh(sealGeo, sealMat);
  sealMesh.rotation.x = -Math.PI / 2;
  sealMesh.position.y = 0.018;
  group.add(sealMesh);

  // 4. 8 Monumental Obsidian-Gold Perimeter Obelisks + Levitating Eclipse Shards
  const obeliskGeo = buildObeliskGeo();
  const collarGeo = new THREE.BoxGeometry(1.62, 0.38, 1.62);
  const shardGeo = new THREE.OctahedronGeometry(0.58, 0);
  geometries.push(obeliskGeo, collarGeo, shardGeo);

  const obeliskCount = 8;
  const obeliskInst = new THREE.InstancedMesh(obeliskGeo, obsidianMat, obeliskCount);
  obeliskInst.castShadow = true;
  obeliskInst.receiveShadow = true;
  const collarInst = new THREE.InstancedMesh(collarGeo, imperialGoldMat, obeliskCount * 2);
  collarInst.castShadow = true;

  const floatingShards: { mesh: THREE.Mesh; baseY: number; phase: number }[] = [];
  const aoPlacements: ContactShadowPlacement[] = [];
  const dummy = new THREE.Object3D();

  for (let i = 0; i < obeliskCount; i++) {
    const a = (i / obeliskCount) * Math.PI * 2 + Math.PI / 8;
    const dist = arenaRadius + 2.35;
    const px = Math.sin(a) * dist;
    const pz = Math.cos(a) * dist;
    const hScale = 0.88 + (i % 2) * 0.24;

    dummy.position.set(px, -0.35, pz);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(1, hScale, 1);
    dummy.updateMatrix();
    obeliskInst.setMatrixAt(i, dummy.matrix);

    // Lower & upper imperial gold bands on each obelisk
    dummy.position.set(px, 1.15, pz);
    dummy.scale.set(1.06, 1, 1.06);
    dummy.updateMatrix();
    collarInst.setMatrixAt(i * 2, dummy.matrix);

    dummy.position.set(px, 9.2 * hScale - 0.65, pz);
    dummy.scale.set(0.68, 0.85, 0.68);
    dummy.updateMatrix();
    collarInst.setMatrixAt(i * 2 + 1, dummy.matrix);

    const shard = new THREE.Mesh(shardGeo, crystalShardMat);
    const baseY = 9.2 * hScale + 0.95;
    shard.position.set(px, baseY, pz);
    shard.scale.set(0.75, 1.55, 0.75);
    group.add(shard);
    floatingShards.push({ mesh: shard, baseY, phase: i * 0.85 });

    aoPlacements.push({ x: px, z: pz, radiusX: 1.9, y: 0.03 });
  }
  obeliskInst.instanceMatrix.needsUpdate = true;
  collarInst.instanceMatrix.needsUpdate = true;
  group.add(obeliskInst, collarInst);

  // 5. 4 Shattered Imperial Colosseum Triumphal Archways framing outer abyss
  const archPillarGeo = new THREE.BoxGeometry(1.5, 11.5, 1.5);
  const archBeamGeo = new THREE.BoxGeometry(8.8, 1.35, 1.75);
  geometries.push(archPillarGeo, archBeamGeo);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const dist = arenaRadius + 11.2;
    const archGroup = new THREE.Group();
    archGroup.position.set(Math.sin(a) * dist, -0.6, Math.cos(a) * dist);
    archGroup.rotation.y = a;

    const leftCol = new THREE.Mesh(archPillarGeo, obsidianMat);
    leftCol.position.set(-3.4, 5.75, 0);
    const rightCol = new THREE.Mesh(archPillarGeo, obsidianMat);
    rightCol.position.set(3.4, 5.75, 0);
    const lintel = new THREE.Mesh(archBeamGeo, imperialGoldMat);
    lintel.position.set(0, 11.6, 0);
    archGroup.add(leftCol, rightCol, lintel);
    group.add(archGroup);
  }

  // 6. Colossal Counter-Rotating Overhead Eclipse Crown Halo (y = 18.5m)
  const outerCrownGeo = new THREE.TorusGeometry(11.6, 0.28, 12, 64);
  const innerCrownGeo = new THREE.TorusGeometry(8.8, 0.14, 10, 48);
  const coronaRingGeo = new THREE.RingGeometry(10.6, 12.6, 64);
  geometries.push(outerCrownGeo, innerCrownGeo, coronaRingGeo);

  const outerCrown = new THREE.Mesh(outerCrownGeo, imperialGoldMat);
  outerCrown.rotation.x = Math.PI / 2;
  outerCrown.position.y = 18.5;

  const innerCrown = new THREE.Mesh(innerCrownGeo, obsidianMat);
  innerCrown.rotation.x = Math.PI / 2;
  innerCrown.position.y = 17.6;

  const coronaDisc = new THREE.Mesh(coronaRingGeo, crownGlowMat);
  coronaDisc.rotation.x = -Math.PI / 2;
  coronaDisc.position.y = 18.4;

  group.add(outerCrown, innerCrown, coronaDisc);

  // 7. Ground Contact AO + Rising Molten-Gold & Crimson Solar Embers
  const aoDiscs = createContactShadowDiscs('EclipseSanctumAO', aoPlacements, 0.56);
  const solarEmbers = createAmbientParticleField('EclipseSolarEmbers', {
    count: 210,
    innerRadius: 2.5,
    outerRadius: arenaRadius + 11.0,
    minHeight: 0.4,
    maxHeight: 16.0,
    baseSize: 0.46,
    riseSpeed: 1.15,
    driftSpeed: 0.95,
    colorA: 0xfbbf24,
    colorB: 0xf43f5e,
    opacity: 0.78,
    additive: true,
  });
  atmosphereParts.push(aoDiscs, solarEmbers);
  group.add(aoDiscs.object, solarEmbers.object);

  // 8. Dramatic Eclipse Sanctum PointLights
  const goldRimLight = new THREE.PointLight(0xfbbf24, 24, 42, 1.4);
  goldRimLight.position.set(arenaRadius + 1.5, 5.2, 6.0);
  const crimsonRimLight = new THREE.PointLight(0xf43f5e, 22, 42, 1.4);
  crimsonRimLight.position.set(-(arenaRadius + 1.5), 4.8, -6.5);
  const zenithCoreLight = new THREE.PointLight(0xf59e0b, 16, 36, 1.5);
  zenithCoreLight.position.set(0, 12.0, 0);
  group.add(goldRimLight, crimsonRimLight, zenithCoreLight);

  let elapsed = 0;

  return {
    group,
    palette: ECLIPSE_SANCTUM_PALETTE,
    skyboxUrl: '/assets/textures/env_eclipse_sanctum_360.jpg',
    hidesBaseSkirt: true,
    floorTextureUrls: {
      albedo: '/assets/textures/floor_eclipse_albedo.jpg',
      normal: '/assets/textures/floor_concrete_normal.png',
      roughness: '/assets/textures/floor_concrete_roughness.png',
      deckRepeat: 5,
      skirtRepeat: 20,
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

      outerCrown.rotation.z = elapsed * 0.14;
      innerCrown.rotation.z = -elapsed * 0.24;
      coronaDisc.rotation.z = elapsed * 0.1;
      crownGlowMat.opacity = 0.56 + Math.sin(elapsed * 2.1) * 0.16;

      for (let i = 0; i < floatingShards.length; i++) {
        const s = floatingShards[i]!;
        s.mesh.position.y = s.baseY + Math.sin(elapsed * 1.9 + s.phase) * 0.42;
        s.mesh.rotation.y = elapsed * 1.15 + s.phase;
      }

      goldRimLight.intensity = 22 + Math.sin(elapsed * 2.2) * 3.8;
      crimsonRimLight.intensity = 20 + Math.cos(elapsed * 1.85 + 0.7) * 4.0;
      zenithCoreLight.intensity = 14.5 + Math.sin(elapsed * 2.5) * 2.8;

      solarEmbers.update?.(dt);
    },
    dispose: () => {
      for (let i = 0; i < atmosphereParts.length; i++) atmosphereParts[i]!.dispose();
      for (let i = 0; i < geometries.length; i++) geometries[i]!.dispose();
      for (let i = 0; i < materials.length; i++) materials[i]!.dispose();
    },
  };
}

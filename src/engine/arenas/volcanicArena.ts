import * as THREE from 'three';
import type { PbrTextureSet } from '../PbrMaterialSystem';
import {
  createAmbientParticleField,
  createContactShadowDiscs,
  type ContactShadowPlacement,
  type DisposableAtmospherePart,
} from './ArenaAtmosphere';
import type { ArenaThemePalette, MountedArenaTheme } from './ArenaThemeTypes';

export const VOLCANIC_PALETTE: ArenaThemePalette = {
  fogColor: 0x26120e,
  fogDensity: 0.0072,
  backgroundTint: 0x1c0b09,
  deckColor: 0xd8cec8,
  skirtColor: 0x4a3b37,
  hazardRingColor: 0xea580c,
  hemiSkyColor: 0xffb07c,
  hemiGroundColor: 0x4f170c,
  hemiIntensity: 0.85,
  sunColor: 0xffbc75,
  sunIntensity: 2.65,
  fillColor: 0xff5a22,
  fillIntensity: 0.92,
  environmentIntensity: 1.28,
  backgroundBlurriness: 0.015,
};

const LAVA_VERTEX_SHADER = /* glsl */ `
varying vec2 vWorldXZ;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LAVA_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uInnerRadius;
uniform float uOuterRadius;
varying vec2 vWorldXZ;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
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
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  float r = length(vWorldXZ);
  float angle = atan(vWorldXZ.y, vWorldXZ.x);

  // Domain-warped slow radial + tangential magma drift
  vec2 flowUv = vWorldXZ * 0.24 + vec2(cos(angle) * uTime * 0.14, sin(angle) * uTime * 0.14);
  float warp = fbm(flowUv + vec2(uTime * 0.09, -uTime * 0.07));
  float n = fbm(flowUv * 1.45 + vec2(warp * 2.1, -warp * 1.6));

  // Cooled basalt crust islands floating over glowing molten fissures (prevents flat white bloom!)
  float crustMask = smoothstep(0.36, 0.66, n);
  float hotCore = smoothstep(0.58, 0.86, 1.0 - n + sin(uTime * 1.8 + warp * 5.0) * 0.05);

  vec3 cooledCrust = vec3(0.09, 0.05, 0.05);
  vec3 deepMagma = vec3(0.72, 0.14, 0.02);
  vec3 brightLava = vec3(1.28, 0.48, 0.06);
  vec3 moltenPeak = vec3(1.55, 0.96, 0.36);

  vec3 col = mix(deepMagma, brightLava, smoothstep(0.22, 0.72, 1.0 - n));
  col = mix(col, moltenPeak, hotCore * 0.75);
  col = mix(col, cooledCrust, crustMask * 0.88);

  // Organic jagged radial fade at inner & outer caldera banks
  float edgeNoise = (warp - 0.5) * 1.35;
  float innerFade = smoothstep(uInnerRadius - 0.35 + edgeNoise * 0.6, uInnerRadius + 1.15 + edgeNoise * 0.6, r);
  float outerFade = 1.0 - smoothstep(uOuterRadius - 2.4 + edgeNoise, uOuterRadius + edgeNoise, r);
  float alpha = clamp(innerFade * outerFade, 0.0, 1.0);

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

function buildDisplacedCalderaTerrain(arenaRadius: number): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(arenaRadius + 0.4, 128, 84, 18);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);

    // Depressed caldera magma trench from arenaRadius+0.8 to arenaRadius+8.8 so the GLSL lava river
    // shines cleanly in full view, then low rugged volcanic rim ledges (+1.8m..+4.2m) that frame —
    // NEVER block — the dramatic 360° fiery volcanic caldera skybox!
    const crags =
      Math.sin(ang * 7.0 + r * 0.08) * 0.5 +
      Math.cos(ang * 13.0 - r * 0.12) * 0.32 +
      Math.sin(ang * 23.0 + r * 0.21) * 0.18;

    const trenchMask =
      THREE.MathUtils.smoothstep(r, arenaRadius + 0.6, arenaRadius + 2.2) *
      (1.0 - THREE.MathUtils.smoothstep(r, arenaRadius + 7.2, arenaRadius + 10.5));
    const outerRimT = THREE.MathUtils.smoothstep(r, arenaRadius + 8.5, arenaRadius + 28.0);
    const distantT = THREE.MathUtils.smoothstep(r, arenaRadius + 26.0, 95.0);

    const y =
      -0.08 -
      trenchMask * 0.95 +
      outerRimT * (1.85 + crags * 1.15) +
      distantT * (1.9 + crags * 1.35);

    pos.setY(i, y);
  }

  geo.computeVertexNormals();
  return geo;
}

function buildOrganicBasaltSpireGeo(seed: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.45, 2.35, 7.6, 9, 6, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const yNorm = (y + 3.8) / 7.6; // 0 at base, 1 at peak
    // Layered hexagonal columnar basalt shear + jagged volcanic strata
    const strata = Math.sin(yNorm * 14.0 + seed * 3.1) * 0.14;
    const facets = Math.cos(ang * 5.0 + seed * 1.7 + yNorm * 2.2) * 0.22;
    const radialScale = Math.max(0.18, 1.0 + strata + facets * (0.4 + yNorm * 0.6));
    pos.setXYZ(i, x * radialScale, y, z * radialScale);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Lazy-loaded Stage 2 Arena: Kawah Vulkanik (Magma Caldera — Tier 1 Photorealism).
 * Features dedicated 360° volcanic caldera skybox + PMREM IBL, photographic basalt PBR floor,
 * animated domain-warped GLSL magma moat shader, displaced volcanic ridge terrain skirt,
 * and dynamic flickering lava glow lights.
 */
export function buildVolcanicArenaTheme(
  pbrTextures: PbrTextureSet,
  arenaRadius: number
): MountedArenaTheme {
  const group = new THREE.Group();
  group.name = 'ArenaTheme_VolcanicCrater';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x6b5c58,
    map: pbrTextures.floorAlbedo,
    normalMap: pbrTextures.floorNormal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: pbrTextures.floorRoughness,
    roughness: 0.92,
    metalness: 0.08,
    envMapIntensity: 0.9,
  });

  const basaltMat = new THREE.MeshStandardMaterial({
    color: 0x5c504d,
    map: pbrTextures.floorAlbedo,
    normalMap: pbrTextures.floorNormal,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughnessMap: pbrTextures.floorRoughness,
    roughness: 0.9,
    metalness: 0.1,
    envMapIntensity: 0.95,
  });

  const lavaUniforms = {
    uTime: { value: 0 },
    uInnerRadius: { value: arenaRadius + 0.7 },
    uOuterRadius: { value: arenaRadius + 9.4 },
  };

  const lavaFlowMat = new THREE.ShaderMaterial({
    uniforms: lavaUniforms,
    vertexShader: LAVA_VERTEX_SHADER,
    fragmentShader: LAVA_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const rimFissureMat = new THREE.MeshBasicMaterial({
    color: 0xff5a1f,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  materials.push(terrainMat, basaltMat, lavaFlowMat, rimFissureMat);

  // 1. Displaced Surrounding Caldera Ridge Terrain Skirt (eliminates flat circular platform!)
  const terrainGeo = buildDisplacedCalderaTerrain(arenaRadius);
  geometries.push(terrainGeo);
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 2. Animated GLSL Flowing Molten Magma Moat (sits proudly inside the recessed caldera trench!)
  const lavaMoatGeo = new THREE.RingGeometry(arenaRadius + 0.45, arenaRadius + 9.8, 72, 4);
  geometries.push(lavaMoatGeo);
  const lavaMoat = new THREE.Mesh(lavaMoatGeo, lavaFlowMat);
  lavaMoat.rotation.x = -Math.PI / 2;
  lavaMoat.position.y = -0.05;
  group.add(lavaMoat);

  // 3. Subtle Volcanic Heat Rim Fissure inside Arena Edge
  const fissureGeo = new THREE.RingGeometry(arenaRadius - 0.95, arenaRadius - 0.72, 48);
  geometries.push(fissureGeo);
  const fissure = new THREE.Mesh(fissureGeo, rimFissureMat);
  fissure.rotation.x = -Math.PI / 2;
  fissure.position.y = 0.018;
  group.add(fissure);

  // 4. Fallback procedural spires (hidden automatically once sculpted Meshy basalt cliff GLB loads!)
  const fallbackPropsGroup = new THREE.Group();
  fallbackPropsGroup.name = 'VolcanicFallbackProps';
  const spireGeoA = buildOrganicBasaltSpireGeo(1.0);
  const spireGeoB = buildOrganicBasaltSpireGeo(2.7);
  const boulderGeo = new THREE.DodecahedronGeometry(1.45, 2);
  const bPos = boulderGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bPos.count; i++) {
    const x = bPos.getX(i);
    const y = bPos.getY(i);
    const z = bPos.getZ(i);
    const n = 0.82 + 0.28 * Math.sin(x * 2.7 + z * 1.9) * Math.cos(y * 3.1);
    bPos.setXYZ(i, x * n, y * n * 0.62, z * n);
  }
  boulderGeo.computeVertexNormals();
  geometries.push(spireGeoA, spireGeoB, boulderGeo);

  const spireCount = 10;
  for (let i = 0; i < spireCount; i++) {
    const angle = (i / spireCount) * Math.PI * 2 + 0.25;
    const dist = arenaRadius + 8.6 + (i % 3) * 3.2;
    const sx = Math.sin(angle) * dist;
    const sz = Math.cos(angle) * dist;

    const spire = new THREE.Mesh(i % 2 === 0 ? spireGeoA : spireGeoB, basaltMat);
    const heightScale = 0.85 + (i % 4) * 0.34;
    spire.scale.set(0.95 + (i % 2) * 0.4, heightScale, 0.95 + ((i + 1) % 2) * 0.35);
    spire.position.set(sx, 7.6 * heightScale * 0.36, sz);
    spire.rotation.set((i % 2 === 0 ? 1 : -1) * 0.14, angle * 1.7, ((i % 3) - 1) * 0.11);
    spire.castShadow = true;
    spire.receiveShadow = true;
    fallbackPropsGroup.add(spire);

    // Low craggy basalt ledge rocks breaking up the circular arena border
    const rAngle = angle + 0.18;
    const rDist = arenaRadius + 1.55 + (i % 2) * 0.45;
    const rock = new THREE.Mesh(boulderGeo, basaltMat);
    rock.scale.set(1.1 + (i % 3) * 0.35, 0.65 + (i % 2) * 0.3, 0.9 + ((i + 1) % 3) * 0.25);
    rock.position.set(Math.sin(rAngle) * rDist, 0.22, Math.cos(rAngle) * rDist);
    rock.rotation.set(0.1 * (i % 3), rAngle, -0.08 * (i % 2));
    rock.castShadow = true;
    rock.receiveShadow = true;
    fallbackPropsGroup.add(rock);
  }
  group.add(fallbackPropsGroup);

  // 5. Dynamic Flickering Volcanic Under-Glow PointLights (casts 360° fiery rim shimmer on Rider armor!)
  const lavaLightA = new THREE.PointLight(0xff5a1a, 24, 34, 1.5);
  lavaLightA.position.set(arenaRadius + 2.5, 2.2, -6);
  const lavaLightB = new THREE.PointLight(0xff3b0a, 20, 34, 1.5);
  lavaLightB.position.set(-(arenaRadius + 2.5), 2.2, 8);
  const lavaLightC = new THREE.PointLight(0xff7722, 18, 32, 1.5);
  lavaLightC.position.set(2, 2.0, arenaRadius + 2.2);
  group.add(lavaLightA, lavaLightB, lavaLightC);

  // 6. Tier 3 Atmospheric Rising Molten Volcanic Embers & Sparks (1 GPU draw call, zero allocs!)
  const atmosphereParts: DisposableAtmospherePart[] = [];
  const embersField = createAmbientParticleField('VolcanicEmbers', {
    count: 220,
    innerRadius: 2.5,
    outerRadius: arenaRadius + 15.0,
    minHeight: 0.2,
    maxHeight: 13.5,
    baseSize: 0.78,
    riseSpeed: 1.75,
    driftSpeed: 1.45,
    colorA: 0xff4500,
    colorB: 0xffe082,
    opacity: 0.92,
    additive: true,
  });
  atmosphereParts.push(embersField);
  group.add(embersField.object);

  let elapsed = 0;

  return {
    group,
    palette: VOLCANIC_PALETTE,
    skyboxUrl: '/assets/textures/env_volcanic_360.jpg',
    hidesBaseSkirt: true,
    floorTextureUrls: {
      albedo: '/assets/textures/floor_volcanic_albedo.jpg',
      normal: '/assets/textures/floor_volcanic_normal.png',
      roughness: '/assets/textures/floor_volcanic_roughness.png',
      deckRepeat: 5,
      skirtRepeat: 24,
    },
    propSpecs: {
      volcanicSpire: {
        url: '/assets/models/custom/prop_volcanic_spire.glb',
        envMapIntensity: 1.35,
      },
    },
    onFloorTexturesLoaded: (albedo, normal, roughness, skirtAlbedo, skirtNormal) => {
      if (skirtAlbedo) terrainMat.map = skirtAlbedo;
      if (skirtNormal) terrainMat.normalMap = skirtNormal;
      if (roughness) terrainMat.roughnessMap = roughness;
      terrainMat.needsUpdate = true;

      if (albedo) basaltMat.map = albedo;
      if (normal) basaltMat.normalMap = normal;
      if (roughness) basaltMat.roughnessMap = roughness;
      basaltMat.needsUpdate = true;
    },
    onPropsLoaded: (props) => {
      const spireProto = props.volcanicSpire;
      if (!spireProto) return;

      // Replace procedural fallback cones with 26 GPU-instanced sculpted magma-cracked basalt spires & crags (1 draw call!)
      fallbackPropsGroup.visible = false;
      const outerCount = 14;
      const rimCount = 12;
      const total = outerCount + rimCount;
      const inst = new THREE.InstancedMesh(spireProto.geometry, spireProto.material, total);
      inst.name = 'InstancedVolcanicBasaltSpires';
      inst.castShadow = true;
      inst.receiveShadow = true;

      const dummy = new THREE.Object3D();
      const baseH = Math.max(0.01, spireProto.size.y);
      const aoPlacements: ContactShadowPlacement[] = [];

      // Ring A: 14 towering jagged obsidian caldera monoliths framing the lava bank
      for (let i = 0; i < outerCount; i++) {
        const ang = (i / outerCount) * Math.PI * 2 + 0.19;
        const dist = arenaRadius + 9.2 + (i % 3) * 3.4;
        const px = Math.sin(ang) * dist;
        const pz = Math.cos(ang) * dist;
        const targetH = 7.4 + (i % 4) * 2.25;
        const s = targetH / baseH;
        const widen = 1.05 + (i % 3) * 0.28;
        dummy.position.set(px, -0.35, pz);
        dummy.rotation.set(
          (i % 2 === 0 ? 1 : -1) * 0.09,
          ang + i * 1.37,
          ((i % 3) - 1) * 0.08
        );
        dummy.scale.set(s * widen, s, s * (0.95 + ((i + 1) % 3) * 0.25));
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        aoPlacements.push({ x: px, z: pz, radiusX: targetH * 0.36, y: 0.04 });
      }

      // Ring B: 12 smaller jagged lava-bank basalt crags emerging near the rim
      for (let i = 0; i < rimCount; i++) {
        const ang = (i / rimCount) * Math.PI * 2 + 0.42;
        const dist = arenaRadius + 1.6 + (i % 2) * 0.7;
        const px = Math.sin(ang) * dist;
        const pz = Math.cos(ang) * dist;
        const targetH = 2.05 + (i % 3) * 0.75;
        const s = targetH / baseH;
        dummy.position.set(px, -0.45, pz);
        dummy.rotation.set(
          (i % 2 === 0 ? -1 : 1) * 0.18,
          ang * 2.1 + i,
          ((i % 3) - 1) * 0.14
        );
        dummy.scale.set(s * 1.45, s, s * 1.35);
        dummy.updateMatrix();
        inst.setMatrixAt(outerCount + i, dummy.matrix);
        aoPlacements.push({ x: px, z: pz, radiusX: targetH * 0.58, y: 0.025 });
      }

      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);

      // Grounded Contact AO shadows beneath every volcanic crag & monolith
      const aoDiscs = createContactShadowDiscs('VolcanicContactAO', aoPlacements, 0.58);
      atmosphereParts.push(aoDiscs);
      group.add(aoDiscs.object);
    },
    update: (dt: number) => {
      elapsed += dt;
      lavaUniforms.uTime.value = elapsed;
      lavaLightA.intensity = 22 + Math.sin(elapsed * 3.4) * 4.5 + Math.cos(elapsed * 7.1) * 2.0;
      lavaLightB.intensity = 18 + Math.cos(elapsed * 2.9 + 1.2) * 4.0 + Math.sin(elapsed * 6.3) * 1.8;
      lavaLightC.intensity = 16 + Math.sin(elapsed * 3.8 + 2.4) * 3.5;
      rimFissureMat.opacity = 0.34 + Math.sin(elapsed * 2.4) * 0.09;
      embersField.update?.(dt);
    },
    dispose: () => {
      for (let i = 0; i < atmosphereParts.length; i++) atmosphereParts[i]!.dispose();
      for (let i = 0; i < geometries.length; i++) geometries[i]!.dispose();
      for (let i = 0; i < materials.length; i++) materials[i]!.dispose();
    },
  };
}

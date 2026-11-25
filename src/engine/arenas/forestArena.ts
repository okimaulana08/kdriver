import * as THREE from 'three';
import type { PbrTextureSet } from '../PbrMaterialSystem';
import {
  createAmbientParticleField,
  createBotanicalFernTexture,
  createContactShadowDiscs,
  createCrossedFoliageCardGeometry,
  type ContactShadowPlacement,
  type DisposableAtmospherePart,
} from './ArenaAtmosphere';
import type { ArenaThemePalette, MountedArenaTheme } from './ArenaThemeTypes';

export const FOREST_RUINS_PALETTE: ArenaThemePalette = {
  fogColor: 0x3b5949,
  fogDensity: 0.0068,
  backgroundTint: 0x263f33,
  deckColor: 0xe6eae0,
  skirtColor: 0x5c7258,
  hazardRingColor: 0x34d399,
  hemiSkyColor: 0xd9f9e4,
  hemiGroundColor: 0x2c4028,
  hemiIntensity: 0.92,
  sunColor: 0xfff5d4,
  sunIntensity: 2.55,
  fillColor: 0x6ee7b7,
  fillIntensity: 0.62,
  environmentIntensity: 1.18,
  backgroundBlurriness: 0.03,
};

const SUNBEAM_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const SUNBEAM_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;
void main() {
  float edge = pow(abs(dot(vNormalView, vViewDir)), 1.65);
  float vertical = smoothstep(0.0, 0.28, vUv.y) * (1.0 - smoothstep(0.62, 1.0, vUv.y));
  float shimmer = 0.82 + 0.18 * sin(uTime * 0.9 + vUv.x * 12.566);
  float alpha = edge * vertical * shimmer * 0.14;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const RUNE_VERTEX_SHADER = /* glsl */ `
varying vec2 vWorldXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RUNE_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uRadius;
varying vec2 vWorldXZ;
void main() {
  float r = length(vWorldXZ);
  float ang = atan(vWorldXZ.y, vWorldXZ.x);
  float outerBand = exp(-pow((r - (uRadius - 1.9)) * 4.2, 2.0));
  float innerBand = exp(-pow((r - 4.3) * 5.0, 2.0));
  float glyph = 0.45 + 0.55 * smoothstep(-0.2, 0.55, sin(ang * 16.0 + sin(ang * 8.0) * 0.5));
  float pulse = 0.65 + 0.35 * sin(uTime * 1.8 - r * 0.35);
  float alpha = (outerBand * glyph * 0.45 + innerBand * glyph * 0.32) * pulse;
  if (alpha < 0.01) discard;
  vec3 col = mix(vec3(0.20, 0.85, 0.58), vec3(0.85, 1.0, 0.72), pulse * 0.45);
  gl_FragColor = vec4(col, alpha);
}
`;

function buildDisplacedForestTerrain(arenaRadius: number): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(arenaRadius + 0.35, 128, 84, 18);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);

    // Gentle low mossy woodland earth slopes (+0.6m..+2.8m) so the misty morning forest skybox
    // and golden sunbeams shine cleanly across the sanctuary horizon!
    const rollT = THREE.MathUtils.smoothstep(r, arenaRadius + 1.8, arenaRadius + 18.0);
    const hillT = THREE.MathUtils.smoothstep(r, arenaRadius + 18.0, 95.0);
    const undulation =
      Math.sin(ang * 5.0 + r * 0.05) * 0.55 +
      Math.cos(ang * 11.0 - r * 0.09) * 0.3 +
      Math.sin(ang * 17.0 + r * 0.14) * 0.15;

    const y = rollT * (0.45 + undulation * 0.45) + hillT * (2.1 + undulation * 1.15) - 0.05;
    pos.setY(i, y);
  }

  geo.computeVertexNormals();
  return geo;
}

function buildOrganicCanopyClusterGeo(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.9, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const puff =
      1.0 +
      0.22 * Math.sin(x * 2.1 + seed) * Math.cos(z * 2.3 - seed) +
      0.14 * Math.sin(y * 3.4 + x * 1.7);
    pos.setXYZ(i, x * puff * 1.18, y * puff * 0.68, z * puff * 1.18);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Lazy-loaded Stage 3 Arena: Reruntuhan Hutan (Ancient Moss Temple — Tier 1 Photorealism).
 * Features dedicated misty forest 360° panorama + PMREM IBL, photographic mossy flagstone PBR floor,
 * displaced forest hillside terrain skirt, animated ancient rune glow shader, and volumetric morning sunbeams.
 */
export function buildForestRuinsArenaTheme(
  pbrTextures: PbrTextureSet,
  arenaRadius: number
): MountedArenaTheme {
  const group = new THREE.Group();
  group.name = 'ArenaTheme_ForestRuins';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // Surrounding forest floor uses rich organic mossy woodland soil (NOT tiled temple courtyard bricks!)
  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x2d442b,
    normalMap: pbrTextures.floorNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.96,
    metalness: 0.02,
    envMapIntensity: 0.6,
  });

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xa2b09e,
    map: pbrTextures.floorAlbedo,
    normalMap: pbrTextures.floorNormal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: pbrTextures.floorRoughness,
    roughness: 0.9,
    metalness: 0.04,
    envMapIntensity: 0.9,
  });

  const barkMat = new THREE.MeshStandardMaterial({
    color: 0x3b2c20,
    normalMap: pbrTextures.floorNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.95,
    metalness: 0.02,
  });

  const foliageDarkMat = new THREE.MeshStandardMaterial({
    color: 0x1b472b,
    roughness: 0.88,
    metalness: 0.03,
    envMapIntensity: 0.72,
  });

  const foliageSunMat = new THREE.MeshStandardMaterial({
    color: 0x2c6639,
    roughness: 0.84,
    metalness: 0.03,
    envMapIntensity: 0.82,
  });

  const runeUniforms = {
    uTime: { value: 0 },
    uRadius: { value: arenaRadius },
  };
  const runeShaderMat = new THREE.ShaderMaterial({
    uniforms: runeUniforms,
    vertexShader: RUNE_VERTEX_SHADER,
    fragmentShader: RUNE_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const sunbeamUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0xeefad0) },
  };
  const sunbeamMat = new THREE.ShaderMaterial({
    uniforms: sunbeamUniforms,
    vertexShader: SUNBEAM_VERTEX_SHADER,
    fragmentShader: SUNBEAM_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  materials.push(terrainMat, stoneMat, barkMat, foliageDarkMat, foliageSunMat, runeShaderMat, sunbeamMat);

  // 1. Displaced Mossy Hillside Surrounding Terrain Skirt
  const terrainGeo = buildDisplacedForestTerrain(arenaRadius);
  geometries.push(terrainGeo);
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 2. Animated Sacred Temple Rune Circle Shader on Mossy Flagstones
  const runeDiscGeo = new THREE.CircleGeometry(arenaRadius - 0.6, 64);
  geometries.push(runeDiscGeo);
  const runeDisc = new THREE.Mesh(runeDiscGeo, runeShaderMat);
  runeDisc.rotation.x = -Math.PI / 2;
  runeDisc.position.y = 0.018;
  group.add(runeDisc);

  // 3. Fallback procedural pillars & trees (replaced cleanly by InstancedMesh sculpted Meshy GLBs once loaded!)
  const fallbackPillarsGroup = new THREE.Group();
  fallbackPillarsGroup.name = 'ForestFallbackPillars';
  const fallbackTreesGroup = new THREE.Group();
  fallbackTreesGroup.name = 'ForestFallbackTrees';

  const pillarGeo = new THREE.CylinderGeometry(0.62, 0.76, 5.2, 8);
  const plinthGeo = new THREE.BoxGeometry(1.85, 0.52, 1.85);
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.76, 6.8, 8);
  const canopyGeoA = buildOrganicCanopyClusterGeo(1.3);
  const canopyGeoB = buildOrganicCanopyClusterGeo(3.9);
  geometries.push(pillarGeo, plinthGeo, trunkGeo, canopyGeoA, canopyGeoB);

  const pillarCount = 8;
  for (let i = 0; i < pillarCount; i++) {
    const angle = (i / pillarCount) * Math.PI * 2;
    const pDist = arenaRadius + 2.35;
    const px = Math.sin(angle) * pDist;
    const pz = Math.cos(angle) * pDist;
    const broken = i % 3 === 1;
    const hScale = broken ? 0.5 : 1.0;

    const plinth = new THREE.Mesh(plinthGeo, stoneMat);
    plinth.position.set(px, 0.24, pz);
    plinth.rotation.y = angle;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    fallbackPillarsGroup.add(plinth);

    const pillar = new THREE.Mesh(pillarGeo, stoneMat);
    pillar.scale.set(1, hScale, 1);
    pillar.position.set(px, 0.45 + 5.2 * hScale * 0.5, pz);
    pillar.rotation.set(broken ? 0.06 : 0, angle, broken ? -0.05 : 0);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    fallbackPillarsGroup.add(pillar);

    if (!broken) {
      const cap = new THREE.Mesh(plinthGeo, stoneMat);
      cap.scale.set(1.08, 0.85, 1.08);
      cap.position.set(px, 5.75, pz);
      cap.rotation.y = angle;
      cap.castShadow = true;
      fallbackPillarsGroup.add(cap);
    }

    const tAngle = angle + Math.PI / pillarCount;
    const tDist = arenaRadius + 6.8 + (i % 2) * 2.8;
    const tx = Math.sin(tAngle) * tDist;
    const tz = Math.cos(tAngle) * tDist;

    const trunk = new THREE.Mesh(trunkGeo, barkMat);
    trunk.position.set(tx, 3.2, tz);
    trunk.rotation.set((i % 2 === 0 ? 1 : -1) * 0.05, tAngle, ((i % 3) - 1) * 0.04);
    trunk.castShadow = true;
    fallbackTreesGroup.add(trunk);

    const baseY = 6.1 + (i % 2) * 0.8;
    const bough1 = new THREE.Mesh(canopyGeoA, foliageDarkMat);
    bough1.position.set(tx + Math.cos(tAngle) * 0.8, baseY, tz - Math.sin(tAngle) * 0.8);
    bough1.scale.setScalar(1.25);
    bough1.rotation.y = tAngle;
    bough1.castShadow = true;

    const bough2 = new THREE.Mesh(canopyGeoB, foliageSunMat);
    bough2.position.set(tx - Math.cos(tAngle) * 0.7, baseY + 1.15, tz + Math.sin(tAngle) * 0.7);
    bough2.scale.setScalar(1.05);
    bough2.rotation.y = tAngle + 1.8;
    bough2.castShadow = true;

    const bough3 = new THREE.Mesh(canopyGeoA, foliageSunMat);
    bough3.position.set(tx, baseY + 2.0, tz);
    bough3.scale.set(0.88, 0.78, 0.88);
    bough3.rotation.y = tAngle + 3.1;
    fallbackTreesGroup.add(bough1, bough2, bough3);
  }
  group.add(fallbackPillarsGroup, fallbackTreesGroup);

  // 4. Tier 3: 240 Crossed-Card Alpha-Cutout Botanical Fern & Woodland Grass Clumps (1 InstancedMesh draw call!)
  const fernTex = createBotanicalFernTexture();
  const fernCardGeo = createCrossedFoliageCardGeometry(1.55, 1.15);
  geometries.push(fernCardGeo);

  const grassWindUniform = { value: 0 };
  const fernMat = new THREE.MeshStandardMaterial({
    map: fernTex,
    alphaTest: 0.42,
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide,
    envMapIntensity: 0.72,
  });
  fernMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = grassWindUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float windFlex = clamp(position.y / 1.15, 0.0, 1.0);
float phase = instanceMatrix[3][0] * 0.38 + instanceMatrix[3][2] * 0.38;
transformed.x += sin(uWindTime * 1.75 + phase) * 0.16 * windFlex * windFlex;
transformed.z += cos(uWindTime * 1.35 + phase * 1.2) * 0.11 * windFlex * windFlex;`
      );
  };
  fernMat.customProgramCacheKey = () => 'kdriver-forest-fern-wind-v2';
  materials.push(fernMat);

  const fernCount = 240;
  const fernInst = new THREE.InstancedMesh(fernCardGeo, fernMat, fernCount);
  fernInst.name = 'InstancedForestBotanicalFerns';
  fernInst.receiveShadow = true;
  const fernDummy = new THREE.Object3D();
  const fernTint = new THREE.Color();
  for (let i = 0; i < fernCount; i++) {
    const hashA = Math.abs(Math.sin(i * 12.9898 + 4.1414) * 43758.5453) % 1;
    const hashR = Math.abs(Math.sin(i * 78.233 + 1.919) * 43758.5453) % 1;
    // Cluster 65% organically hugging the temple flagstone rim + 35% nestled near pillar/tree roots!
    const a = (i / fernCount) * Math.PI * 2 + (hashA - 0.5) * 0.18;
    const r =
      i % 3 === 0
        ? arenaRadius + 1.8 + hashR * 7.8
        : arenaRadius + 0.25 + hashR * 2.65;
    const hScale = 0.62 + ((i * 37) % 10) * 0.095;
    const wScale = 0.78 + ((i * 19) % 8) * 0.12;
    fernDummy.position.set(Math.sin(a) * r, -0.04, Math.cos(a) * r);
    fernDummy.rotation.set(0, a + i * 1.31, 0);
    fernDummy.scale.set(wScale, hScale, wScale);
    fernDummy.updateMatrix();
    fernInst.setMatrixAt(i, fernDummy.matrix);
    fernTint.setHSL(0.27 + ((i * 13) % 10) * 0.008, 0.34, 0.74 + hashR * 0.24);
    fernInst.setColorAt(i, fernTint);
  }
  fernInst.instanceMatrix.needsUpdate = true;
  if (fernInst.instanceColor) fernInst.instanceColor.needsUpdate = true;
  group.add(fernInst);

  // 5. Diagonal Volumetric Morning Sunbeams piercing through the Forest Canopy!
  const beamGeo = new THREE.CylinderGeometry(1.15, 3.6, 18.0, 14, 1, true);
  geometries.push(beamGeo);
  const beamAngles = [0.6, 1.9, 3.7, 5.1];
  for (let i = 0; i < beamAngles.length; i++) {
    const a = beamAngles[i]!;
    const dist = arenaRadius - 1.5 + (i % 2) * 3.5;
    const beam = new THREE.Mesh(beamGeo, sunbeamMat);
    beam.position.set(Math.sin(a) * dist, 7.2, Math.cos(a) * dist);
    beam.rotation.set(0.28, a * 0.3, -0.34);
    group.add(beam);
  }

  // 6. Tier 3 Atmospheric Floating Sacred Forest Fireflies & Sunlit Pollen Spores + Sanctuary Rune Bounce Light
  const atmosphereParts: DisposableAtmospherePart[] = [];
  const firefliesField = createAmbientParticleField('ForestFireflies', {
    count: 180,
    innerRadius: 1.5,
    outerRadius: arenaRadius + 12.0,
    minHeight: 0.45,
    maxHeight: 8.5,
    baseSize: 0.72,
    riseSpeed: 0,
    driftSpeed: 1.15,
    colorA: 0xbef264,
    colorB: 0xfef08a,
    opacity: 0.88,
    additive: true,
  });
  atmosphereParts.push(firefliesField);
  group.add(firefliesField.object);

  const sanctuaryLight = new THREE.PointLight(0x86efac, 10, 26, 1.6);
  sanctuaryLight.position.set(0, 1.8, 0);
  group.add(sanctuaryLight);

  let elapsed = 0;

  return {
    group,
    palette: FOREST_RUINS_PALETTE,
    skyboxUrl: '/assets/textures/env_forest_ruins_360.jpg',
    hidesBaseSkirt: true,
    floorTextureUrls: {
      albedo: '/assets/textures/floor_forest_albedo.jpg',
      normal: '/assets/textures/floor_forest_normal.png',
      roughness: '/assets/textures/floor_forest_roughness.png',
      deckRepeat: 5,
      skirtRepeat: 24,
    },
    propSpecs: {
      templePillar: {
        url: '/assets/models/custom/prop_temple_pillar.glb',
        envMapIntensity: 1.05,
      },
      forestTree: {
        url: '/assets/models/custom/prop_forest_tree.glb',
        doubleSide: true,
        envMapIntensity: 0.95,
      },
    },
    onFloorTexturesLoaded: (albedo, normal, roughness, _skirtAlbedo, skirtNormal) => {
      if (skirtNormal) terrainMat.normalMap = skirtNormal;
      terrainMat.needsUpdate = true;

      if (albedo) stoneMat.map = albedo;
      if (normal) stoneMat.normalMap = normal;
      if (roughness) stoneMat.roughnessMap = roughness;
      stoneMat.needsUpdate = true;
    },
    onPropsLoaded: (props) => {
      const dummy = new THREE.Object3D();
      const aoPlacements: ContactShadowPlacement[] = [];

      // Mount 8 instanced sculpted carved mossy temple ruin columns (1 draw call!)
      const pillarProto = props.templePillar;
      if (pillarProto) {
        fallbackPillarsGroup.visible = false;
        const pInst = new THREE.InstancedMesh(pillarProto.geometry, pillarProto.material, pillarCount);
        pInst.name = 'InstancedTempleRuinPillars';
        pInst.castShadow = true;
        pInst.receiveShadow = true;
        const pBaseH = Math.max(0.01, pillarProto.size.y);

        for (let i = 0; i < pillarCount; i++) {
          const angle = (i / pillarCount) * Math.PI * 2;
          const pDist = arenaRadius + 2.4;
          const px = Math.sin(angle) * pDist;
          const pz = Math.cos(angle) * pDist;
          const broken = i % 3 === 1;
          const targetH = broken ? 4.4 : 6.15;
          const s = targetH / pBaseH;
          dummy.position.set(px, broken ? -1.1 : -0.1, pz);
          dummy.rotation.set(
            broken ? 0.06 : 0.015 * ((i % 3) - 1),
            angle + i * 0.9,
            broken ? -0.05 : 0
          );
          dummy.scale.set(s * 1.12, s, s * 1.12);
          dummy.updateMatrix();
          pInst.setMatrixAt(i, dummy.matrix);
          aoPlacements.push({ x: px, z: pz, radiusX: 2.15, y: 0.025 });
        }
        pInst.instanceMatrix.needsUpdate = true;
        group.add(pInst);
      }

      // Mount 14 instanced sculpted ancient gnarled mossy forest trees (1 draw call!)
      const treeProto = props.forestTree;
      if (treeProto) {
        fallbackTreesGroup.visible = false;
        const treeCount = 14;
        const tInst = new THREE.InstancedMesh(treeProto.geometry, treeProto.material, treeCount);
        tInst.name = 'InstancedAncientForestTrees';
        tInst.castShadow = true;
        tInst.receiveShadow = true;
        const tBaseH = Math.max(0.01, treeProto.size.y);

        for (let i = 0; i < treeCount; i++) {
          const tAngle = (i / treeCount) * Math.PI * 2 + 0.24;
          const tDist = arenaRadius + 7.2 + (i % 3) * 3.6;
          const tx = Math.sin(tAngle) * tDist;
          const tz = Math.cos(tAngle) * tDist;
          const targetH = 8.4 + (i % 4) * 1.45;
          const s = targetH / tBaseH;
          const spread = 0.95 + (i % 3) * 0.14;
          dummy.position.set(tx, -0.25, tz);
          dummy.rotation.set(
            (i % 2 === 0 ? 1 : -1) * 0.03,
            tAngle + i * 1.85,
            ((i % 3) - 1) * 0.03
          );
          dummy.scale.set(s * spread, s, s * spread);
          dummy.updateMatrix();
          tInst.setMatrixAt(i, dummy.matrix);
          aoPlacements.push({ x: tx, z: tz, radiusX: targetH * 0.52, y: 0.05 });
        }
        tInst.instanceMatrix.needsUpdate = true;
        group.add(tInst);
      }

      if (aoPlacements.length > 0) {
        const aoDiscs = createContactShadowDiscs('ForestContactAO', aoPlacements, 0.56);
        atmosphereParts.push(aoDiscs);
        group.add(aoDiscs.object);
      }
    },
    update: (dt: number) => {
      elapsed += dt;
      runeUniforms.uTime.value = elapsed;
      sunbeamUniforms.uTime.value = elapsed;
      grassWindUniform.value = elapsed;
      sanctuaryLight.intensity = 9 + Math.sin(elapsed * 1.8) * 2.5;
      firefliesField.update?.(dt);
    },
    dispose: () => {
      fernTex.dispose();
      for (let i = 0; i < atmosphereParts.length; i++) atmosphereParts[i]!.dispose();
      for (let i = 0; i < geometries.length; i++) geometries[i]!.dispose();
      for (let i = 0; i < materials.length; i++) materials[i]!.dispose();
    },
  };
}

import * as THREE from 'three';
import { extractMaterialRole } from './CelShader';

export interface PbrTextureSet {
  undersuitNormal: THREE.Texture;
  compoundEyeNormal: THREE.Texture;
  armorWearRoughness: THREE.Texture;
  kaijinChitinNormal: THREE.Texture;
  floorAlbedo: THREE.Texture;
  floorNormal: THREE.Texture;
  floorRoughness: THREE.Texture;
}

export interface BindPbrOptions {
  preserveExternalPbr?: boolean;
  envMapIntensity?: number;
  enableArmorHueShift?: boolean;
}

export interface ArmorHueShiftUniforms {
  uArmorTargetColor: { value: THREE.Color };
  uHueMix: { value: number };
}

/**
 * Injects a selective PBR red-armor recoloring shader into UV-textured external `.glb` materials
 * (e.g. Meshy/Tripo Kuuga crimson-gold Rider). Shifts ONLY high-saturation crimson armor & ruby
 * compound eyes into the active Element hue (PYRO Crimson, VOLT Electric Gold, AQUA Sapphire Blue)
 * while leaving matte charcoal undersuit, silver K-Driver belt, and antique gold trim 100% untouched!
 */
export function attachSelectiveArmorColorShift(
  mat: THREE.MeshStandardMaterial
): ArmorHueShiftUniforms {
  const uniforms: ArmorHueShiftUniforms = {
    uArmorTargetColor: { value: new THREE.Color(0xe11d48) },
    uHueMix: { value: 0.0 },
  };
  mat.userData.armorHueShiftUniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uArmorTargetColor = uniforms.uArmorTargetColor;
    shader.uniforms.uHueMix = uniforms.uHueMix;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uArmorTargetColor;
uniform float uHueMix;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
if (uHueMix > 0.001) {
  vec3 kRgb = diffuseColor.rgb;
  float kMax = max(kRgb.r, max(kRgb.g, kRgb.b));
  float kMin = min(kRgb.r, min(kRgb.g, kRgb.b));
  float kSat = kMax > 0.0001 ? (kMax - kMin) / kMax : 0.0;
  // Scale-invariant linear-space crimson isolation: recolors BOTH bright and shadowed ruby/crimson
  // armor plates & compound eyes while preserving antique/champagne gold trim, silver, and black undersuit
  float kRedRatio = (kRgb.r - max(kRgb.g * 1.55, kRgb.b * 1.32)) / max(kRgb.r, 0.0001);
  float kRedDom = smoothstep(0.18, 0.52, kRedRatio);
  float kNotBlack = smoothstep(0.012, 0.035, kMax);
  float kMask = smoothstep(0.24, 0.48, kSat) * kRedDom * kNotBlack * uHueMix;
  if (kMask > 0.001) {
    float kCrimsonEnergy = max(kRgb.r * 0.92, dot(kRgb, vec3(0.35, 0.50, 0.15)));
    vec3 kShifted = uArmorTargetColor * (0.04 + kCrimsonEnergy * 1.45);
    diffuseColor.rgb = mix(kRgb, kShifted, kMask);
  }
}`
      );
  };
  mat.customProgramCacheKey = () => 'kdriver-selective-armor-hue-v2';
  mat.needsUpdate = true;
  return uniforms;
}

/**
 * Creates tiny neutral fallback textures (1x1 flat normal/white roughness) for headless Vitest
 * environments or graceful offline fallback before texture loading completes.
 */
export function createFallbackPbrTextureSet(): PbrTextureSet {
  const makeSolid = (r: number, g: number, b: number, a = 255): THREE.DataTexture => {
    const tex = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  return {
    undersuitNormal: makeSolid(128, 128, 255),
    compoundEyeNormal: makeSolid(128, 128, 255),
    armorWearRoughness: makeSolid(190, 190, 190),
    kaijinChitinNormal: makeSolid(128, 128, 255),
    floorAlbedo: makeSolid(128, 126, 122),
    floorNormal: makeSolid(128, 128, 255),
    floorRoughness: makeSolid(215, 215, 215),
  };
}

export function disposePbrTextureSet(set: PbrTextureSet): void {
  set.undersuitNormal.dispose();
  set.compoundEyeNormal.dispose();
  set.armorWearRoughness.dispose();
  set.kaijinChitinNormal.dispose();
  set.floorAlbedo.dispose();
  set.floorNormal.dispose();
  set.floorRoughness.dispose();
}

/**
 * Live-action painted fiberglass / metallic Tokusatsu Rider armor with automotive Clearcoat.
 * Reflects the 360-degree HDRI skybox and golden-afternoon directional sunlight like a real suit.
 */
export function createRiderArmorMaterial(
  color: number | string,
  textures: PbrTextureSet
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    metalness: 0.48,
    roughness: 0.28,
    roughnessMap: textures.armorWearRoughness,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    reflectivity: 0.9,
    envMapIntensity: 1.5,
  });
}

/**
 * Metallic silver/titanium/chrome secondary armor trim & clasps.
 */
export function createAccentArmorMaterial(
  color: number | string,
  textures: PbrTextureSet
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    metalness: 0.72,
    roughness: 0.25,
    roughnessMap: textures.armorWearRoughness,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.45,
  });
}

/**
 * Matte ribbed neoprene/leather live-action Tokusatsu undersuit (Kuuga / Ryuki suit fabric).
 */
export function createUndersuitMaterial(textures: PbrTextureSet): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x171a22,
    metalness: 0.08,
    roughness: 0.76,
    normalMap: textures.undersuitNormal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    envMapIntensity: 0.75,
  });
}

/**
 * Glossy acrylic hexagonal compound-eye visor & glowing K-Driver core lens.
 */
export function createCompoundEyeMaterial(
  color: number | string,
  textures: PbrTextureSet,
  emissiveIntensity = 1.65
): THREE.MeshPhysicalMaterial {
  const col = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: col,
    emissive: col,
    emissiveIntensity,
    metalness: 0.14,
    roughness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    normalMap: textures.compoundEyeNormal,
    normalScale: new THREE.Vector2(1.25, 1.25),
    envMapIntensity: 1.65,
  });
}

/**
 * Brushed chrome / antique gold metal for K-Driver buckle, horns, blade guards, and Super Form crest.
 */
export function createMetallicTrimMaterial(
  color: number | string,
  emissive: number | string = 0x000000,
  emissiveIntensity = 0
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(emissive),
    emissiveIntensity,
    metalness: 0.92,
    roughness: 0.2,
    clearcoat: 0.65,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.6,
  });
}

/**
 * Weathered cloth scarf material (matte woven textile without shiny plastic sheen).
 */
export function createClothMaterial(color: number | string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: 0.02,
    roughness: 0.88,
    side: THREE.DoubleSide,
    envMapIntensity: 0.65,
  });
}

/**
 * Live-action Toei rubber/chitin monster suit material with organic cellular normal relief.
 */
export function createKaijinCarapaceMaterial(
  color: number | string,
  textures: PbrTextureSet,
  isBoss = false
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    metalness: isBoss ? 0.52 : 0.24,
    roughness: isBoss ? 0.34 : 0.46,
    clearcoat: isBoss ? 0.72 : 0.36,
    clearcoatRoughness: 0.26,
    normalMap: textures.kaijinChitinNormal,
    normalScale: new THREE.Vector2(1.05, 1.05),
    envMapIntensity: isBoss ? 1.45 : 1.15,
  });
}

/**
 * Binds realistic PBR materials to semantic `role:*` meshes on procedural `.glb` assets,
 * while preserving original UV-mapped PBR textures (Albedo/Normal/Roughness/Metallic) on
 * external Tripo3D / Meshy.ai / Mixamo `.glb` characters!
 *
 * Returns any newly cloned external PBR materials so entities can tint/flash and dispose them safely.
 */
export function bindPbrMaterials(
  root: THREE.Object3D,
  roleMap: Readonly<Record<string, THREE.Material>>,
  options?: BindPbrOptions
): THREE.MeshStandardMaterial[] {
  const preserveExternal = options?.preserveExternalPbr ?? true;
  const envMapIntensity = options?.envMapIntensity ?? 1.35;
  const enableArmorHueShift = options?.enableArmorHueShift ?? false;
  const clonedExternalMaterials: THREE.MeshStandardMaterial[] = [];

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.userData.isOutlineMesh) return;

    obj.castShadow = obj.userData.castShadow !== false;
    obj.receiveShadow = obj.userData.receiveShadow !== false;
    if (obj instanceof THREE.SkinnedMesh) {
      // Prevent bind-pose bounding-sphere frustum culling flicker during animated leaps/crouches
      obj.frustumCulled = false;
    }

    const role = extractMaterialRole(obj.material);
    if (role && roleMap[role]) {
      obj.material = roleMap[role]!;
      return;
    }

    if (!preserveExternal) return;

    const upgradeExternal = (mat: THREE.Material): THREE.Material => {
      if (mat instanceof THREE.MeshStandardMaterial) {
        // Clone so per-instance hit-flashes or armor hue shifts never mutate cached prototype material
        const cloned = mat.clone();
        cloned.envMapIntensity = envMapIntensity;
        if (enableArmorHueShift) {
          attachSelectiveArmorColorShift(cloned);
        }
        cloned.needsUpdate = true;
        clonedExternalMaterials.push(cloned);
        return cloned;
      }
      return mat;
    };

    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map(upgradeExternal);
    } else if (obj.material) {
      obj.material = upgradeExternal(obj.material);
    }
  });

  return clonedExternalMaterials;
}

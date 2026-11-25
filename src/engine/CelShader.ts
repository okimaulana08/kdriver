import * as THREE from 'three';

export interface CelMaterialOptions {
  color: number | string;
  gradientMap: THREE.DataTexture;
  rimColor?: number | string;
  rimStrength?: number;
  rimPower?: number;
}

/**
 * Creates a crisp 4-band Tokusatsu anime cel-shading gradient ramp texture.
 */
export function createToonGradientRamp(): THREE.DataTexture {
  const bands = new Uint8Array([68, 132, 206, 255]);
  const texture = new THREE.DataTexture(bands, bands.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Custom Tokusatsu Cel-Shaded material built atop Three.js MeshToonMaterial with
 * an injected Fresnel Rim Highlight shader pass so curved helmet domes, armor plates,
 * and monster horns pop with crisp studio/anime edge lighting.
 */
export function createCelMaterial(options: CelMaterialOptions): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: new THREE.Color(options.color),
    gradientMap: options.gradientMap,
  });

  const rimColor = new THREE.Color(options.rimColor ?? 0x93c5fd);
  const rimStrength = options.rimStrength ?? 0.55;
  const rimPower = options.rimPower ?? 2.8;

  mat.userData.rimUniforms = {
    uRimColor: { value: rimColor },
    uRimStrength: { value: rimStrength },
    uRimPower: { value: rimPower },
  };

  mat.onBeforeCompile = (shader) => {
    const u = mat.userData.rimUniforms as {
      uRimColor: { value: THREE.Color };
      uRimStrength: { value: number };
      uRimPower: { value: number };
    };
    shader.uniforms.uRimColor = u.uRimColor;
    shader.uniforms.uRimStrength = u.uRimStrength;
    shader.uniforms.uRimPower = u.uRimPower;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimPower;`
      )
      .replace(
        '#include <dithering_fragment>',
        `vec3 tokViewDir = normalize(vViewPosition);
float tokFresnel = pow(1.0 - clamp(dot(normalize(normal), tokViewDir), 0.0, 1.0), uRimPower);
gl_FragColor.rgb += uRimColor * tokFresnel * uRimStrength;
#include <dithering_fragment>`
      );
  };

  mat.customProgramCacheKey = () => 'tokusatsu-cel-rim-v1';
  return mat;
}

/**
 * Creates a shared BackSide inverted-hull ink outline material.
 * Shared across entities to minimize GPU state switches.
 */
export function createSharedOutlineMaterial(colorHex = 0x040712): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colorHex,
    side: THREE.BackSide,
  });
}

/**
 * Extracts semantic role name exported from our .glb assets (`role:armor` -> `armor`).
 */
export function extractMaterialRole(material: THREE.Material | THREE.Material[]): string | null {
  const mat = Array.isArray(material) ? material[0] : material;
  if (!mat || !mat.name) return null;
  return mat.name.startsWith('role:') ? mat.name.slice(5) : null;
}

/**
 * Rebinds all meshes in a loaded .glb hierarchy to semantic dynamic materials
 * and optionally attaches crisp inverted-hull anime ink outlines.
 */
export function bindRoleMaterialsAndOutlines(
  root: THREE.Object3D,
  roleMap: Readonly<Record<string, THREE.Material>>,
  outlineMaterial?: THREE.MeshBasicMaterial,
  outlineScale = 1.038
): void {
  const meshesToOutline: THREE.Mesh[] = [];

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.userData.isOutlineMesh) return;

    const role = extractMaterialRole(obj.material);
    if (role && roleMap[role]) {
      obj.material = roleMap[role]!;
    }

    obj.castShadow = obj.userData.castShadow !== false;
    obj.receiveShadow = obj.userData.receiveShadow !== false;

    const wantsOutline =
      outlineMaterial !== undefined &&
      obj.userData.outline !== false &&
      role !== 'emissive' &&
      role !== 'blade_edge' &&
      role !== 'super_wing' &&
      role !== 'enemy_eye' &&
      role !== 'arena_glow';

    if (wantsOutline) {
      meshesToOutline.push(obj);
    }
  });

  if (outlineMaterial) {
    for (let i = 0; i < meshesToOutline.length; i++) {
      const host = meshesToOutline[i]!;
      const outlineMesh = new THREE.Mesh(host.geometry, outlineMaterial);
      outlineMesh.name = `${host.name}_Outline`;
      outlineMesh.scale.setScalar(outlineScale);
      outlineMesh.castShadow = false;
      outlineMesh.receiveShadow = false;
      outlineMesh.userData.isOutlineMesh = true;
      host.add(outlineMesh);
    }
  }
}

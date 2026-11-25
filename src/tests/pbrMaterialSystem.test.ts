import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  bindPbrMaterials,
  createCompoundEyeMaterial,
  createFallbackPbrTextureSet,
  createKaijinCarapaceMaterial,
  createRiderArmorMaterial,
  createUndersuitMaterial,
  disposePbrTextureSet,
} from '../engine/PbrMaterialSystem';

describe('PbrMaterialSystem (Live-Action Tokusatsu Clearcoat PBR & External GLB Preservation)', () => {
  it('creates clearcoat fiberglass armor, ribbed undersuit, compound-eye, and kaijin carapace materials', () => {
    const tex = createFallbackPbrTextureSet();
    const armor = createRiderArmorMaterial('#e11d48', tex);
    const suit = createUndersuitMaterial(tex);
    const visor = createCompoundEyeMaterial('#ff5722', tex);
    const boss = createKaijinCarapaceMaterial('#7f1d1d', tex, true);

    expect(armor.clearcoat).toBe(1.0);
    expect(armor.roughnessMap).toBe(tex.armorWearRoughness);
    expect(suit.normalMap).toBe(tex.undersuitNormal);
    expect(visor.clearcoat).toBe(1.0);
    expect(visor.normalMap).toBe(tex.compoundEyeNormal);
    expect(boss.normalMap).toBe(tex.kaijinChitinNormal);

    armor.dispose();
    suit.dispose();
    visor.dispose();
    boss.dispose();
    disposePbrTextureSet(tex);
  });

  it('rebinds semantic role:* meshes while preserving UV-mapped PBR textures on custom Tripo3D/Mixamo models', () => {
    const tex = createFallbackPbrTextureSet();
    const armorMat = createRiderArmorMaterial('#e11d48', tex);

    // Simulated external Tripo3D/Mixamo material with its own UV albedo map (no "role:" prefix)
    const externalAlbedo = new THREE.DataTexture(new Uint8Array([200, 40, 40, 255]), 1, 1, THREE.RGBAFormat);
    const externalMat = new THREE.MeshStandardMaterial({
      name: 'Tripo_Rider_Suit_PBR',
      map: externalAlbedo,
      roughness: 0.35,
      metalness: 0.4,
    });

    const root = new THREE.Group();
    const proceduralMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ name: 'role:armor' })
    );
    const externalMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), externalMat);
    root.add(proceduralMesh, externalMesh);

    const clonedExternal = bindPbrMaterials(
      root,
      { armor: armorMat },
      { preserveExternalPbr: true, envMapIntensity: 1.5, enableArmorHueShift: true }
    );

    expect(proceduralMesh.material).toBe(armorMat);
    expect(clonedExternal).toHaveLength(1);
    expect(externalMesh.material).toBe(clonedExternal[0]);
    expect(externalMesh.material).not.toBe(externalMat); // Cloned so per-instance hit flashes don't mutate prototype!
    expect((externalMesh.material as THREE.MeshStandardMaterial).map).toBe(externalAlbedo);
    expect((externalMesh.material as THREE.MeshStandardMaterial).envMapIntensity).toBe(1.5);
    expect(clonedExternal[0]?.userData.armorHueShiftUniforms).toBeDefined();

    proceduralMesh.geometry.dispose();
    externalMesh.geometry.dispose();
    armorMat.dispose();
    externalMat.dispose();
    clonedExternal[0]?.dispose();
    externalAlbedo.dispose();
    disposePbrTextureSet(tex);
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  bindRoleMaterialsAndOutlines,
  createCelMaterial,
  createSharedOutlineMaterial,
  createToonGradientRamp,
  extractMaterialRole,
} from '../engine/CelShader';

describe('CelShader (Custom Fresnel Rim Cel-Material & Ink Outlines)', () => {
  it('extracts role prefixes from exported .glb materials and binds custom Cel-Shader + outlines', () => {
    const ramp = createToonGradientRamp();
    const outlineMat = createSharedOutlineMaterial();
    const armorMat = createCelMaterial({ color: 0xe11d48, gradientMap: ramp });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xff5722, emissive: 0xff5722 });

    const root = new THREE.Group();
    const armorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ name: 'role:armor' })
    );
    const visorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ name: 'role:emissive' })
    );
    root.add(armorMesh, visorMesh);

    expect(extractMaterialRole(armorMesh.material)).toBe('armor');
    expect(extractMaterialRole(visorMesh.material)).toBe('emissive');

    bindRoleMaterialsAndOutlines(root, { armor: armorMat, emissive: glowMat }, outlineMat, 1.04);

    // Armor gets Cel-Shader + inverted-hull outline child; emissive visor skips outline so bloom stays pure
    expect(armorMesh.material).toBe(armorMat);
    expect(armorMesh.children).toHaveLength(1);
    expect(armorMesh.children[0]?.userData.isOutlineMesh).toBe(true);

    expect(visorMesh.material).toBe(glowMat);
    expect(visorMesh.children).toHaveLength(0);

    armorMesh.geometry.dispose();
    visorMesh.geometry.dispose();
    armorMat.dispose();
    glowMat.dispose();
    outlineMat.dispose();
    ramp.dispose();
  });
});

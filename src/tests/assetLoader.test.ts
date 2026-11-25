import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSET_MANIFEST,
  CUSTOM_MANIFEST_URL,
  PBR_TEXTURE_PATHS,
  type AssetKey,
} from '../engine/AssetLoader';

describe('Phase 4.5 GLB, PBR Texture Manifest & Performance Budget Audit', () => {
  it('verifies all 11 .glb models, PBR textures, 360° skybox, and custom manifest exist well under 25 MB', () => {
    const publicDir = path.resolve(process.cwd(), 'public');
    const keys = Object.keys(ASSET_MANIFEST) as AssetKey[];
    expect(keys.length).toBe(11);

    let totalBytes = 0;
    for (const key of keys) {
      const relPath = ASSET_MANIFEST[key].replace(/^\//, '');
      const fullPath = path.join(publicDir, relPath);
      expect(fs.existsSync(fullPath), `Missing model ${relPath}`).toBe(true);

      const buf = fs.readFileSync(fullPath);
      expect(buf.length).toBeGreaterThan(1024);
      // Verify exact binary glTF magic header "glTF" (0x46546C67)
      expect(buf.subarray(0, 4).toString('ascii')).toBe('glTF');
      totalBytes += buf.length;
    }

    for (const texRel of Object.values(PBR_TEXTURE_PATHS)) {
      const fullPath = path.join(publicDir, texRel.replace(/^\//, ''));
      expect(fs.existsSync(fullPath), `Missing PBR texture ${texRel}`).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size).toBeGreaterThan(1024);
      totalBytes += stat.size;
    }

    const customManifestPath = path.join(publicDir, CUSTOM_MANIFEST_URL.replace(/^\//, ''));
    expect(fs.existsSync(customManifestPath)).toBe(true);
    const parsedManifest = JSON.parse(fs.readFileSync(customManifestPath, 'utf8'));
    expect(parsedManifest).toHaveProperty('rider');

    // Total models + 360 skybox + PBR texture pack must remain well below 25 MB budget (leaving headroom for custom Mixamo rigs!)
    expect(totalBytes).toBeLessThan(8 * 1024 * 1024);
  });

  it('audits all update()/render() hot paths for zero new THREE.Vector3/Quaternion/Matrix4 allocations', () => {
    const hotPathFiles = [
      'src/engine/GameApp.ts',
      'src/engine/CameraRig.ts',
      'src/engine/PhysicsWorld.ts',
      'src/engine/SkeletalAnimator.ts',
      'src/engine/HumanoidBoneDriver.ts',
      'src/engine/PbrMaterialSystem.ts',
      'src/engine/ArenaThemeManager.ts',
      'src/engine/arenas/ArenaAtmosphere.ts',
      'src/game/combat/PlayerProjectilePool.ts',
      'src/game/entities/PlayerRider.ts',
      'src/game/entities/EnemyBase.ts',
      'src/game/entities/BossKaijin.ts',
      'src/game/entities/PetEntity.ts',
      'src/game/vfx/ElementSkillVfx.ts',
      'src/game/vfx/ParticlePool.ts',
      'src/game/vfx/SlashTrail.ts',
    ];

    for (const rel of hotPathFiles) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      const updateMethodRegex =
        /(?:public|private)?\s*(?:readonly\s+)?(?:fixedUpdate|updateVisuals|onFixedUpdate|onRender|update)\s*=?\s*\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/g;

      let match: RegExpExecArray | null;
      while ((match = updateMethodRegex.exec(content)) !== null) {
        const body = match[1] ?? '';
        expect(body, `Hot-path allocation detected in ${rel}`).not.toMatch(
          /new\s+THREE\.(Vector3|Quaternion|Matrix4)\s*\(/
        );
      }
    }
  });
});

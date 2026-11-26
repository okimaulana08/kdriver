import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_LIST, scaleEnemyConfigForDifficulty } from '../game/data/difficulty';
import { ENEMY_CONFIGS } from '../game/data/enemies';
import {
  STAGE_4_NEON_DISTRICT,
  STAGE_5_GLACIAL_CITADEL,
  STAGE_BOSS_RUSH,
  STAGE_LIST,
  getStageConfig,
  isValidStageId,
} from '../game/data/stages';
import { BOSS_SIGNATURE_PROFILES, getBossSignatureProfile } from '../game/entities/BossKaijin';

function getDirectorySizeBytes(dirPath: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    total += entry.isDirectory() ? getDirectorySizeBytes(full) : fs.statSync(full).size;
  }
  return total;
}

describe('Paket B — Sector 04 Neon District, Sector 05 Glacial Citadel, 2 New Bosses & 5-Boss Rush', () => {
  it('registers 5 distinct thematic Sectors plus the expanded 5-Boss Boss Rush gauntlet', () => {
    expect(STAGE_LIST).toHaveLength(6);
    expect(isValidStageId('stage_04_neon_district')).toBe(true);
    expect(isValidStageId('stage_05_glacial_citadel')).toBe(true);

    expect(getStageConfig('stage_04_neon_district').arenaTheme).toBe('neon_district');
    expect(getStageConfig('stage_05_glacial_citadel').arenaTheme).toBe('glacial_citadel');
    expect(STAGE_4_NEON_DISTRICT.waves[2]?.spawns[0]?.enemyId).toBe('chrono_volt_striker');
    expect(STAGE_5_GLACIAL_CITADEL.waves[2]?.spawns[0]?.enemyId).toBe('cryo_eclipse_emperor');

    expect(STAGE_BOSS_RUSH.waves.map((w) => w.spawns[0]?.enemyId)).toEqual([
      'obsidian_kaijin',
      'magma_overlord',
      'sylvan_sovereign',
      'chrono_volt_striker',
      'cryo_eclipse_emperor',
    ]);
  });

  it('defines Chrono-Volt Striker & Cryo-Eclipse Emperor signature profiles and fair >= 0.45s telegraphs', () => {
    expect(Object.keys(BOSS_SIGNATURE_PROFILES)).toEqual(
      expect.arrayContaining(['chrono_volt_striker', 'cryo_eclipse_emperor'])
    );

    const chrono = getBossSignatureProfile('chrono_volt_striker');
    expect(chrono.phase1Patterns).toContain('BLINK_STRIKE');
    expect(chrono.phase1Patterns).toContain('LIGHTNING_LANES');
    expect(chrono.hazardElement).toBe('volt');

    const cryo = getBossSignatureProfile('cryo_eclipse_emperor');
    expect(cryo.phase1Patterns).toContain('ICE_SPIKE_BARRAGE');
    expect(cryo.phase2FarPatterns).toContain('ECLIPSE_GRAVITY_PULL');
    expect(cryo.hazardElement).toBe('aqua');

    for (const diff of DIFFICULTY_LIST) {
      const scaledChrono = scaleEnemyConfigForDifficulty(ENEMY_CONFIGS.chrono_volt_striker, diff.id);
      const scaledCryo = scaleEnemyConfigForDifficulty(ENEMY_CONFIGS.cryo_eclipse_emperor, diff.id);
      expect(scaledChrono.telegraphDurationSec).toBeGreaterThanOrEqual(0.45);
      expect(scaledCryo.telegraphDurationSec).toBeGreaterThanOrEqual(0.45);
    }
  });

  it('verifies all Sector 04 & 05 textures exist and total public/assets stays strictly under 25 MB budget', () => {
    const texDir = path.resolve(process.cwd(), 'public/assets/textures');
    const expectedTextures = [
      'env_neon_district_360.jpg',
      'floor_neon_asphalt_albedo.jpg',
      'floor_neon_asphalt_normal.png',
      'floor_neon_asphalt_roughness.png',
      'env_glacial_citadel_360.jpg',
      'floor_glacial_ice_albedo.jpg',
      'floor_glacial_ice_normal.png',
      'floor_glacial_ice_roughness.png',
    ];
    for (const file of expectedTextures) {
      expect(fs.existsSync(path.join(texDir, file)), `Missing texture ${file}`).toBe(true);
    }

    const totalAssetsBytes = getDirectorySizeBytes(path.resolve(process.cwd(), 'public/assets'));
    expect(totalAssetsBytes).toBeLessThan(25 * 1024 * 1024);
  });
});

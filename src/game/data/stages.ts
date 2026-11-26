import type { StageConfig, StageId } from '../types/schema';

export const MVP_STAGE_1: StageConfig = {
  id: 'stage_01_nexus_arena',
  name: 'Nexus Sector 01',
  subtitle: 'Coastal Harbor Quarry • 3-Wave Gauntlet',
  arenaTheme: 'coastal_quarry',
  accentColor: '#38bdf8',
  recommendedLevel: 1,
  shardReward: 60,
  bossDropPool: ['terra', 'aero', 'flora', 'solar', 'lunar', 'umbra', 'lux'],
  waves: [
    {
      waveNumber: 1,
      title: 'WAVE 1 / 3',
      subtitle: 'SHADOW GRUNT AMBUSH',
      spawns: [{ enemyId: 'shadow_grunt', count: 5 }],
    },
    {
      waveNumber: 2,
      title: 'WAVE 2 / 3',
      subtitle: 'ARMORED BRUTE VANGUARD',
      spawns: [
        { enemyId: 'armored_brute', count: 1 },
        { enemyId: 'shadow_grunt', count: 3 },
      ],
    },
    {
      waveNumber: 3,
      title: 'FINAL WAVE',
      subtitle: 'STAGE BOSS: OBSIDIAN KAIJIN',
      spawns: [{ enemyId: 'obsidian_kaijin', count: 1 }],
    },
  ],
};

export const STAGE_2_VOLCANIC_CRATER: StageConfig = {
  id: 'stage_02_volcanic_crater',
  name: 'Kawah Vulkanik',
  subtitle: 'Magma Caldera • Dual Brute & Magma Overlord',
  arenaTheme: 'volcanic_crater',
  accentColor: '#f97316',
  recommendedLevel: 2,
  shardReward: 95,
  bossDropPool: ['terra', 'solar', 'umbra', 'lux', 'aero', 'flora', 'lunar'],
  waves: [
    {
      waveNumber: 1,
      title: 'WAVE 1 / 3',
      subtitle: 'CALDERA SWARM',
      spawns: [{ enemyId: 'shadow_grunt', count: 6 }],
    },
    {
      waveNumber: 2,
      title: 'WAVE 2 / 3',
      subtitle: 'TWIN BRUTE CRUCIBLE',
      spawns: [
        { enemyId: 'armored_brute', count: 2 },
        { enemyId: 'shadow_grunt', count: 2 },
      ],
    },
    {
      waveNumber: 3,
      title: 'FINAL WAVE',
      subtitle: 'STAGE BOSS: MAGMA OVERLORD',
      spawns: [{ enemyId: 'magma_overlord', count: 1 }],
    },
  ],
};

export const STAGE_3_FOREST_RUINS: StageConfig = {
  id: 'stage_03_forest_ruins',
  name: 'Reruntuhan Hutan',
  subtitle: 'Ancient Moss Temple • Sylvan Sovereign',
  arenaTheme: 'forest_ruins',
  accentColor: '#22c55e',
  recommendedLevel: 3,
  shardReward: 120,
  bossDropPool: ['flora', 'aero', 'lunar', 'lux', 'umbra', 'solar', 'terra'],
  waves: [
    {
      waveNumber: 1,
      title: 'WAVE 1 / 3',
      subtitle: 'RUIN STALKER AMBUSH',
      spawns: [
        { enemyId: 'shadow_grunt', count: 5 },
        { enemyId: 'armored_brute', count: 1 },
      ],
    },
    {
      waveNumber: 2,
      title: 'WAVE 2 / 3',
      subtitle: 'ANCIENT GUARDIAN ASSAULT',
      spawns: [
        { enemyId: 'armored_brute', count: 2 },
        { enemyId: 'shadow_grunt', count: 3 },
      ],
    },
    {
      waveNumber: 3,
      title: 'FINAL WAVE',
      subtitle: 'STAGE BOSS: SYLVAN SOVEREIGN',
      spawns: [{ enemyId: 'sylvan_sovereign', count: 1 }],
    },
  ],
};

export const STAGE_4_NEON_DISTRICT: StageConfig = {
  id: 'stage_04_neon_district',
  name: 'Neon District',
  subtitle: 'Rainy Cyber Rooftop • Chrono-Volt Striker',
  arenaTheme: 'neon_district',
  accentColor: '#22d3ee',
  recommendedLevel: 4,
  shardReward: 150,
  bossDropPool: ['umbra', 'lux', 'aero', 'lunar', 'solar', 'terra', 'flora'],
  waves: [
    {
      waveNumber: 1,
      title: 'WAVE 1 / 3',
      subtitle: 'CYBER RAIDERS AMBUSH',
      spawns: [
        { enemyId: 'shadow_grunt', count: 6 },
        { enemyId: 'armored_brute', count: 1 },
      ],
    },
    {
      waveNumber: 2,
      title: 'WAVE 2 / 3',
      subtitle: 'HIGH-VOLTAGE ENFORCERS',
      spawns: [
        { enemyId: 'armored_brute', count: 2 },
        { enemyId: 'shadow_grunt', count: 4 },
      ],
    },
    {
      waveNumber: 3,
      title: 'FINAL WAVE',
      subtitle: 'STAGE BOSS: CHRONO-VOLT STRIKER',
      spawns: [{ enemyId: 'chrono_volt_striker', count: 1 }],
    },
  ],
};

export const STAGE_5_GLACIAL_CITADEL: StageConfig = {
  id: 'stage_05_glacial_citadel',
  name: 'Glacial Citadel',
  subtitle: 'Eclipse Summit • Cryo-Eclipse Emperor',
  arenaTheme: 'glacial_citadel',
  accentColor: '#c084fc',
  recommendedLevel: 5,
  shardReward: 190,
  bossDropPool: ['lux', 'umbra', 'lunar', 'solar', 'flora', 'aero', 'terra'],
  waves: [
    {
      waveNumber: 1,
      title: 'WAVE 1 / 3',
      subtitle: 'FROST VANGUARD',
      spawns: [
        { enemyId: 'shadow_grunt', count: 6 },
        { enemyId: 'armored_brute', count: 2 },
      ],
    },
    {
      waveNumber: 2,
      title: 'WAVE 2 / 3',
      subtitle: 'ECLIPSE ROYAL GUARD',
      spawns: [
        { enemyId: 'armored_brute', count: 3 },
        { enemyId: 'shadow_grunt', count: 3 },
      ],
    },
    {
      waveNumber: 3,
      title: 'FINAL WAVE',
      subtitle: 'FINAL BOSS: CRYO-ECLIPSE EMPEROR',
      spawns: [{ enemyId: 'cryo_eclipse_emperor', count: 1 }],
    },
  ],
};

export const STAGE_BOSS_RUSH: StageConfig = {
  id: 'stage_boss_rush',
  name: 'Boss Rush',
  subtitle: '5-Boss Endurance Gauntlet • +35% HP Recovery',
  arenaTheme: 'glacial_citadel',
  accentColor: '#f43f5e',
  recommendedLevel: 5,
  shardReward: 260,
  bossDropPool: ['lux', 'umbra', 'solar', 'lunar', 'terra', 'aero', 'flora'],
  isBossRush: true,
  bossRushHealPct: 0.35,
  waves: [
    {
      waveNumber: 1,
      title: 'BOSS RUSH 1 / 5',
      subtitle: 'OBSIDIAN KAIJIN',
      spawns: [{ enemyId: 'obsidian_kaijin', count: 1 }],
    },
    {
      waveNumber: 2,
      title: 'BOSS RUSH 2 / 5',
      subtitle: 'MAGMA OVERLORD',
      spawns: [{ enemyId: 'magma_overlord', count: 1 }],
    },
    {
      waveNumber: 3,
      title: 'BOSS RUSH 3 / 5',
      subtitle: 'SYLVAN SOVEREIGN',
      spawns: [{ enemyId: 'sylvan_sovereign', count: 1 }],
    },
    {
      waveNumber: 4,
      title: 'BOSS RUSH 4 / 5',
      subtitle: 'CHRONO-VOLT STRIKER',
      spawns: [{ enemyId: 'chrono_volt_striker', count: 1 }],
    },
    {
      waveNumber: 5,
      title: 'FINAL BOSS 5 / 5',
      subtitle: 'CRYO-ECLIPSE EMPEROR',
      spawns: [{ enemyId: 'cryo_eclipse_emperor', count: 1 }],
    },
  ],
};

export const ALL_STAGES: Readonly<Record<StageId, StageConfig>> = {
  stage_01_nexus_arena: MVP_STAGE_1,
  stage_02_volcanic_crater: STAGE_2_VOLCANIC_CRATER,
  stage_03_forest_ruins: STAGE_3_FOREST_RUINS,
  stage_04_neon_district: STAGE_4_NEON_DISTRICT,
  stage_05_glacial_citadel: STAGE_5_GLACIAL_CITADEL,
  stage_boss_rush: STAGE_BOSS_RUSH,
};

export const STAGE_LIST: readonly StageConfig[] = [
  MVP_STAGE_1,
  STAGE_2_VOLCANIC_CRATER,
  STAGE_3_FOREST_RUINS,
  STAGE_4_NEON_DISTRICT,
  STAGE_5_GLACIAL_CITADEL,
  STAGE_BOSS_RUSH,
];

export function getStageConfig(id: StageId): StageConfig {
  return ALL_STAGES[id] ?? MVP_STAGE_1;
}

export function isValidStageId(value: unknown): value is StageId {
  return typeof value === 'string' && value in ALL_STAGES;
}

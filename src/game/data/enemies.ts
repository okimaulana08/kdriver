import type { EnemyConfig } from '../types/schema';

export type EnemyConfigId =
  | 'training_dummy'
  | 'shadow_grunt'
  | 'armored_brute'
  | 'obsidian_kaijin'
  | 'magma_overlord'
  | 'sylvan_sovereign';

export const ENEMY_CONFIGS: Readonly<Record<EnemyConfigId, EnemyConfig>> = {
  training_dummy: {
    id: 'training_dummy',
    name: 'Kaijin Dummy MK-I',
    tier: 'MINION',
    maxHp: 600,
    maxGuard: 0,
    defense: 20,
    moveSpeed: 0,
    attackDamage: 16,
    telegraphDurationSec: 0.65,
    scale: 1.15,
    color: '#6366f1',
  },
  shadow_grunt: {
    id: 'shadow_grunt',
    name: 'Shadow Grunt',
    tier: 'MINION',
    maxHp: 120,
    maxGuard: 0,
    defense: 15,
    moveSpeed: 4.2,
    attackDamage: 12,
    telegraphDurationSec: 0.7,
    scale: 1.0,
    color: '#475569',
  },
  armored_brute: {
    id: 'armored_brute',
    name: 'Armored Brute',
    tier: 'ELITE',
    maxHp: 450,
    maxGuard: 150,
    defense: 35,
    moveSpeed: 3.1,
    attackDamage: 24,
    telegraphDurationSec: 0.75,
    scale: 1.38,
    color: '#7c3aed',
  },
  obsidian_kaijin: {
    id: 'obsidian_kaijin',
    name: 'Obsidian Kaijin',
    tier: 'BOSS',
    maxHp: 1800,
    maxGuard: 260,
    defense: 40,
    moveSpeed: 4.6,
    attackDamage: 32,
    telegraphDurationSec: 0.6,
    scale: 1.65,
    color: '#be123c',
  },
  magma_overlord: {
    id: 'magma_overlord',
    name: 'Magma Overlord',
    tier: 'BOSS',
    maxHp: 2200,
    maxGuard: 300,
    defense: 46,
    moveSpeed: 4.8,
    attackDamage: 36,
    telegraphDurationSec: 0.56,
    scale: 1.7,
    color: '#ea580c',
  },
  sylvan_sovereign: {
    id: 'sylvan_sovereign',
    name: 'Sylvan Sovereign',
    tier: 'BOSS',
    maxHp: 2400,
    maxGuard: 320,
    defense: 44,
    moveSpeed: 5.1,
    attackDamage: 38,
    telegraphDurationSec: 0.54,
    scale: 1.7,
    color: '#15803d',
  },
};

export function getEnemyConfig(id: EnemyConfigId): EnemyConfig {
  return ENEMY_CONFIGS[id];
}

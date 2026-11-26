import type { DifficultyConfig, DifficultyId, EnemyConfig, StageId } from '../types/schema';

export const DIFFICULTY_CONFIGS: Readonly<Record<DifficultyId, DifficultyConfig>> = {
  easy: {
    id: 'easy',
    label: 'EASY',
    tagline: 'Rookie Rider • +22% Telegraph • Wide Dodge',
    accentColor: '#34d399',
    enemyHpMult: 0.7,
    enemyDamageMult: 0.68,
    enemyGuardMult: 0.75,
    telegraphDurationMult: 1.22,
    enemyCooldownMult: 1.25,
    bossPhase2HpRatio: 0.45,
    dodgeIframeBonusSec: 0.06,
    shardRewardMult: 0.85,
    scoreMult: 0.85,
    hellExtraElite: false,
  },
  medium: {
    id: 'medium',
    label: 'MEDIUM',
    tagline: 'Standard Drive • Balanced Tokusatsu Combat',
    accentColor: '#38bdf8',
    enemyHpMult: 1.0,
    enemyDamageMult: 1.0,
    enemyGuardMult: 1.0,
    telegraphDurationMult: 1.0,
    enemyCooldownMult: 1.0,
    bossPhase2HpRatio: 0.5,
    dodgeIframeBonusSec: 0,
    shardRewardMult: 1.0,
    scoreMult: 1.0,
    hellExtraElite: false,
  },
  hard: {
    id: 'hard',
    label: 'HARD',
    tagline: 'Veteran Overdrive • Faster AI • 1.5× Shards • S+ Ready',
    accentColor: '#f59e0b',
    enemyHpMult: 1.45,
    enemyDamageMult: 1.4,
    enemyGuardMult: 1.3,
    telegraphDurationMult: 0.92,
    enemyCooldownMult: 0.82,
    bossPhase2HpRatio: 0.55,
    dodgeIframeBonusSec: 0,
    shardRewardMult: 1.5,
    scoreMult: 1.35,
    hellExtraElite: false,
  },
  hell: {
    id: 'hell',
    label: 'HELL',
    tagline: 'Final Hazard • 65% Boss P2 • +1 Wave 2 Elite • 2.25× Shards',
    accentColor: '#f43f5e',
    enemyHpMult: 1.95,
    enemyDamageMult: 1.85,
    enemyGuardMult: 1.55,
    telegraphDurationMult: 0.85,
    enemyCooldownMult: 0.68,
    bossPhase2HpRatio: 0.65,
    dodgeIframeBonusSec: 0,
    shardRewardMult: 2.25,
    scoreMult: 1.75,
    hellExtraElite: true,
  },
};

export const DIFFICULTY_LIST: readonly DifficultyConfig[] = [
  DIFFICULTY_CONFIGS.easy,
  DIFFICULTY_CONFIGS.medium,
  DIFFICULTY_CONFIGS.hard,
  DIFFICULTY_CONFIGS.hell,
];

export function getDifficultyConfig(id: DifficultyId): DifficultyConfig {
  return DIFFICULTY_CONFIGS[id] ?? DIFFICULTY_CONFIGS.medium;
}

export function isValidDifficultyId(value: unknown): value is DifficultyId {
  return typeof value === 'string' && value in DIFFICULTY_CONFIGS;
}

export function makeStageDifficultyKey(stageId: StageId, difficulty: DifficultyId): string {
  return `${stageId}:${difficulty}`;
}

/**
 * Pure data-driven enemy stat scaler per difficulty.
 * Strictly enforces the >= 0.45s fair telegraph floor even on HELL difficulty.
 */
export function scaleEnemyConfigForDifficulty(
  base: EnemyConfig,
  difficulty: DifficultyId
): EnemyConfig {
  if (difficulty === 'medium') return base;
  const cfg = getDifficultyConfig(difficulty);
  return {
    ...base,
    maxHp: Math.max(40, Math.round(base.maxHp * cfg.enemyHpMult)),
    maxGuard: base.maxGuard > 0 ? Math.max(40, Math.round(base.maxGuard * cfg.enemyGuardMult)) : 0,
    attackDamage: Math.max(4, Math.round(base.attackDamage * cfg.enemyDamageMult)),
    telegraphDurationSec: Math.max(
      0.45,
      Math.round(base.telegraphDurationSec * cfg.telegraphDurationMult * 100) / 100
    ),
    moveSpeed:
      base.moveSpeed > 0
        ? Math.round(
            base.moveSpeed * (difficulty === 'hell' ? 1.12 : difficulty === 'hard' ? 1.06 : difficulty === 'easy' ? 0.92 : 1.0) * 100
          ) / 100
        : 0,
  };
}

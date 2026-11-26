import { ALL_ELEMENT_IDS, STARTER_ELEMENT_IDS, isValidElementId } from './data/elements';
import { getDifficultyConfig } from './data/difficulty';
import { getStageConfig } from './data/stages';
import type { DifficultyId, ElementId, RankGrade, SaveRecord, StageId } from './types/schema';

export const MAX_GEM_LEVEL = 5;
export const GEM_SHARD_UNLOCK_COST = 80;

const RANK_SHARD_BONUS: Readonly<Record<RankGrade, number>> = {
  'S+': 75,
  S: 45,
  A: 30,
  B: 18,
  C: 10,
};

/**
 * Pure Gem upgrade cost formula (Lv.1->2 = 40, Lv.2->3 = 80, Lv.3->4 = 120, Lv.4->5 = 160).
 */
export function getGemUpgradeCost(currentLevel: number): number {
  const clamped = Math.max(1, Math.floor(currentLevel));
  return clamped * 40;
}

export function getGemLevel(record: Readonly<SaveRecord>, elementId: ElementId): number {
  const raw = record.gemLevels[elementId];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(MAX_GEM_LEVEL, Math.floor(raw)));
}

export function getPhantomCoreLevel(record: Readonly<SaveRecord>): number {
  const raw = record.phantomCoreLevel;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(MAX_GEM_LEVEL, Math.floor(raw)));
}

export function applyPhantomCoreUpgrade(
  record: Readonly<SaveRecord>
): { updated: SaveRecord; upgraded: boolean; newLevel: number; cost: number } {
  const currentLevel = getPhantomCoreLevel(record);
  const cost = getGemUpgradeCost(currentLevel);
  if (currentLevel >= MAX_GEM_LEVEL || record.gemShards < cost) {
    return { updated: record, upgraded: false, newLevel: currentLevel, cost };
  }
  const nextLevel = currentLevel + 1;
  return {
    upgraded: true,
    newLevel: nextLevel,
    cost,
    updated: {
      ...record,
      gemShards: record.gemShards - cost,
      phantomCoreLevel: nextLevel,
    },
  };
}

export function isElementUnlocked(record: Readonly<SaveRecord>, elementId: ElementId): boolean {
  return record.unlockedElements.includes(elementId);
}

/**
 * Pure Boss Drop picker: awards the first still-locked Element Gem from the stage's drop pool
 * (falling back to any locked element across the full 10-element roster).
 */
export function pickBossDropUnlock(
  unlockedElements: readonly ElementId[],
  stageId: StageId
): ElementId | null {
  const stage = getStageConfig(stageId);
  for (let i = 0; i < stage.bossDropPool.length; i++) {
    const candidate = stage.bossDropPool[i]!;
    if (!unlockedElements.includes(candidate)) {
      return candidate;
    }
  }
  for (let i = 0; i < ALL_ELEMENT_IDS.length; i++) {
    const candidate = ALL_ELEMENT_IDS[i]!;
    if (!unlockedElements.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Pure stage completion reward calculator (Shards + guaranteed Boss Gem/Pet drop on Victory).
 */
export function calculateStageRewards(
  victory: boolean,
  stageId: StageId,
  rank: RankGrade,
  unlockedElements: readonly ElementId[],
  difficulty: DifficultyId = 'medium'
): { shardsEarned: number; unlockedElementDrop: ElementId | null } {
  const stage = getStageConfig(stageId);
  const diffCfg = getDifficultyConfig(difficulty);
  if (!victory) {
    // Consolation shards even on defeat so players steadily progress!
    return { shardsEarned: Math.max(10, Math.round(15 * diffCfg.shardRewardMult)), unlockedElementDrop: null };
  }
  const shardsEarned = Math.round((stage.shardReward + RANK_SHARD_BONUS[rank]) * diffCfg.shardRewardMult);
  const unlockedElementDrop = pickBossDropUnlock(unlockedElements, stageId);
  return { shardsEarned, unlockedElementDrop };
}

/**
 * Pure Hub action: spend Gem Shards to upgrade an unlocked Gem by +1 level (max Lv. 5).
 */
export function applyGemUpgrade(
  record: Readonly<SaveRecord>,
  elementId: ElementId
): { updated: SaveRecord; upgraded: boolean; newLevel: number; cost: number } {
  const currentLevel = getGemLevel(record, elementId);
  const cost = getGemUpgradeCost(currentLevel);
  if (
    !isElementUnlocked(record, elementId) ||
    currentLevel >= MAX_GEM_LEVEL ||
    record.gemShards < cost
  ) {
    return { updated: record, upgraded: false, newLevel: currentLevel, cost };
  }

  const nextLevel = currentLevel + 1;
  return {
    upgraded: true,
    newLevel: nextLevel,
    cost,
    updated: {
      ...record,
      gemShards: record.gemShards - cost,
      gemLevels: {
        ...record.gemLevels,
        [elementId]: nextLevel,
      },
    },
  };
}

/**
 * Pure Hub action: spend Gem Shards to unlock a locked Expansion Gem early.
 */
export function applyShardGemUnlock(
  record: Readonly<SaveRecord>,
  elementId: ElementId
): { updated: SaveRecord; unlocked: boolean; cost: number } {
  const cost = GEM_SHARD_UNLOCK_COST;
  if (isElementUnlocked(record, elementId) || record.gemShards < cost) {
    return { updated: record, unlocked: false, cost };
  }

  return {
    unlocked: true,
    cost,
    updated: {
      ...record,
      gemShards: record.gemShards - cost,
      unlockedElements: [...record.unlockedElements, elementId],
      gemLevels: {
        ...record.gemLevels,
        [elementId]: 1,
      },
    },
  };
}

/**
 * Sanitizes unlocked elements so starter trio (Pyro, Volt, Aqua) are always unlocked and valid.
 */
export function sanitizeUnlockedElements(raw: unknown): ElementId[] {
  const out: ElementId[] = [...STARTER_ELEMENT_IDS];
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const id = raw[i];
      if (isValidElementId(id) && !out.includes(id)) {
        out.push(id);
      }
    }
  }
  return out;
}

import { ALL_ELEMENT_IDS, STARTER_ELEMENT_IDS, isValidElementId } from './data/elements';
import {
  getDifficultyConfig,
  isValidDifficultyId,
  makeStageDifficultyKey,
} from './data/difficulty';
import { MVP_STAGE_1, isValidStageId } from './data/stages';
import { isValidRiderId } from './data/riders';
import { calculateStageRewards, sanitizeUnlockedElements } from './ProgressionSystem';
import type {
  DifficultyId,
  ElementId,
  RankGrade,
  RiderId,
  SaveRecord,
  StageConfig,
  StageId,
  StageResult,
  StageStats,
  WaveConfig,
} from './types/schema';

const SAVE_STORAGE_KEY = 'k_driver_save_v1';

/**
 * Temporary QA toggle requested by user: unlocks all 10 elemental forms in Hub for testing.
 * Flip back to `false` when ready to restore Boss Drop / Shard progression locks.
 */
export const UNLOCK_ALL_ELEMENTS_FOR_TESTING = true;

const RANK_ORDER: Readonly<Record<RankGrade, number>> = {
  'S+': 5,
  S: 4,
  A: 3,
  B: 2,
  C: 1,
};

export const DEFAULT_LOADOUT_ORDER: [ElementId, ElementId, ElementId] = ['pyro', 'volt', 'aqua'];

function createDefaultSaveRecord(): SaveRecord {
  const unlocked: ElementId[] = UNLOCK_ALL_ELEMENTS_FOR_TESTING
    ? [...ALL_ELEMENT_IDS]
    : [...STARTER_ELEMENT_IDS];
  const gemLevels: Partial<Record<ElementId, number>> = {};
  for (let i = 0; i < unlocked.length; i++) {
    gemLevels[unlocked[i]!] = 1;
  }
  return {
    bestRank: null,
    bestScore: 0,
    fastestClearSec: null,
    totalClears: 0,
    loadoutOrder: [...DEFAULT_LOADOUT_ORDER] as [ElementId, ElementId, ElementId],
    selectedStageId: 'stage_01_nexus_arena',
    selectedDifficulty: 'medium',
    selectedRiderId: 'nexus',
    phantomCoreLevel: 1,
    stageDifficultyBestRanks: {},
    unlockedElements: unlocked,
    gemLevels,
    gemShards: 0,
    clearedStageIds: [],
  };
}

export const DEFAULT_SAVE_RECORD: SaveRecord = createDefaultSaveRecord();

/**
 * Pure score & Tokusatsu Rank calculator (GDD Section 4.1 + Difficulty Multiplier & S+ Rank).
 * Evaluates clear speed, damage avoided, elemental reactions, perfect dodges, and Ultimate Finisher bonus.
 */
export function calculateStageRank(stats: StageStats): { score: number; rank: RankGrade } {
  const difficulty: DifficultyId = stats.difficulty ?? 'medium';
  const diffCfg = getDifficultyConfig(difficulty);

  if (!stats.victory) {
    const partialScore = Math.max(
      0,
      Math.round(
        (stats.reactionsTriggered * 250 + stats.perfectDodges * 200 + stats.maxCombo * 30) *
          diffCfg.scoreMult
      )
    );
    return { score: partialScore, rank: 'C' };
  }

  // Time score: 4000 pts if <= 60s, smoothly decays to 1000 pts over 180s
  const timePenalty = Math.max(0, stats.clearTimeSec - 60) * 25;
  const timeScore = Math.max(1000, Math.round(4000 - timePenalty));

  // Survival score: 2500 pts for no-hit, loses 12 pts per HP lost
  const survivalScore = Math.max(0, Math.round(2500 - stats.damageTaken * 12));

  // Style score: Elemental Reactions + Perfect Dodges + Combo mastery
  const reactionScore = Math.min(2500, stats.reactionsTriggered * 420);
  const dodgeScore = Math.min(1200, stats.perfectDodges * 300);
  const comboScore = Math.min(800, stats.maxCombo * 40);
  const finisherBonus = stats.defeatedBossWithFinisher ? 1500 : 0;

  const baseScore =
    timeScore + survivalScore + reactionScore + dodgeScore + comboScore + finisherBonus;
  const totalScore = Math.round(baseScore * diffCfg.scoreMult);

  let rank: RankGrade = 'C';
  if ((difficulty === 'hard' || difficulty === 'hell') && totalScore >= 11200) {
    rank = 'S+';
  } else if (totalScore >= 8200) {
    rank = 'S';
  } else if (totalScore >= 6400) {
    rank = 'A';
  } else if (totalScore >= 4600) {
    rank = 'B';
  }

  return { score: totalScore, rank };
}

export function loadSaveRecord(): SaveRecord {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createDefaultSaveRecord();
  }
  try {
    const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) {
      return createDefaultSaveRecord();
    }
    const parsed = JSON.parse(raw) as Partial<SaveRecord>;
    const unlockedElements = UNLOCK_ALL_ELEMENTS_FOR_TESTING
      ? [...ALL_ELEMENT_IDS]
      : sanitizeUnlockedElements(parsed.unlockedElements);

    const validLoadout =
      Array.isArray(parsed.loadoutOrder) &&
      parsed.loadoutOrder.length === 3 &&
      new Set(parsed.loadoutOrder).size === 3 &&
      parsed.loadoutOrder.every((id) => isValidElementId(id) && unlockedElements.includes(id))
        ? (parsed.loadoutOrder as [ElementId, ElementId, ElementId])
        : ([...DEFAULT_LOADOUT_ORDER] as [ElementId, ElementId, ElementId]);

    const gemLevels: Partial<Record<ElementId, number>> = { pyro: 1, volt: 1, aqua: 1 };
    if (parsed.gemLevels && typeof parsed.gemLevels === 'object') {
      for (const [k, v] of Object.entries(parsed.gemLevels)) {
        if (isValidElementId(k) && typeof v === 'number' && Number.isFinite(v)) {
          gemLevels[k] = Math.max(1, Math.min(5, Math.floor(v)));
        }
      }
    }

    const clearedStageIds: StageId[] = Array.isArray(parsed.clearedStageIds)
      ? parsed.clearedStageIds.filter((id): id is StageId => isValidStageId(id))
      : [];

    const selectedStageId: StageId = isValidStageId(parsed.selectedStageId)
      ? parsed.selectedStageId
      : 'stage_01_nexus_arena';

    const selectedDifficulty: DifficultyId = isValidDifficultyId(parsed.selectedDifficulty)
      ? parsed.selectedDifficulty
      : 'medium';

    const selectedRiderId: RiderId = isValidRiderId(parsed.selectedRiderId)
      ? parsed.selectedRiderId
      : 'nexus';

    const phantomCoreLevel =
      typeof parsed.phantomCoreLevel === 'number' && Number.isFinite(parsed.phantomCoreLevel)
        ? Math.max(1, Math.min(5, Math.floor(parsed.phantomCoreLevel)))
        : 1;

    const stageDifficultyBestRanks: Partial<Record<string, RankGrade>> = {};
    if (parsed.stageDifficultyBestRanks && typeof parsed.stageDifficultyBestRanks === 'object') {
      for (const [k, v] of Object.entries(parsed.stageDifficultyBestRanks)) {
        if (typeof v === 'string' && v in RANK_ORDER) {
          stageDifficultyBestRanks[k] = v as RankGrade;
        }
      }
    }

    return {
      bestRank: parsed.bestRank && parsed.bestRank in RANK_ORDER ? parsed.bestRank : null,
      bestScore: typeof parsed.bestScore === 'number' ? parsed.bestScore : 0,
      fastestClearSec: typeof parsed.fastestClearSec === 'number' ? parsed.fastestClearSec : null,
      totalClears: typeof parsed.totalClears === 'number' ? parsed.totalClears : 0,
      loadoutOrder: validLoadout,
      selectedStageId,
      selectedDifficulty,
      selectedRiderId,
      phantomCoreLevel,
      stageDifficultyBestRanks,
      unlockedElements,
      gemLevels,
      gemShards:
        typeof parsed.gemShards === 'number' && Number.isFinite(parsed.gemShards)
          ? Math.max(0, Math.floor(parsed.gemShards))
          : 0,
      clearedStageIds,
    };
  } catch {
    return createDefaultSaveRecord();
  }
}

export function persistSaveRecord(record: SaveRecord): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Ignore storage quota or private-mode errors gracefully.
  }
}

export function isRankBetter(candidate: RankGrade, current: RankGrade | null): boolean {
  if (!current) return true;
  return RANK_ORDER[candidate] > RANK_ORDER[current];
}

export type StageFlowState = 'IDLE' | 'ENTRY_HENSHIN' | 'WAVE_ACTIVE' | 'WAVE_TRANSITION' | 'FINISHED';

/**
 * Orchestrates multi-stage 3-Wave progression, clear timer, combat statistics,
 * Boss Drop Gem/Pet unlocks, Gem Shards, and result ranking.
 */
export class StageManager {
  public stage: StageConfig;
  public difficulty: DifficultyId = 'medium';

  private flowState: StageFlowState = 'IDLE';
  private currentWaveIndex = -1;
  private transitionTimer = 0;
  private elapsedStageSec = 0;

  private damageTaken = 0;
  private reactionsTriggered = 0;
  private perfectDodges = 0;
  private maxCombo = 0;
  private defeatedBossWithFinisher = false;

  constructor(stage: StageConfig = MVP_STAGE_1, difficulty: DifficultyId = 'medium') {
    this.stage = stage;
    this.difficulty = difficulty;
  }

  public setStage(stage: StageConfig): void {
    this.stage = stage;
    this.resetToIdle();
  }

  public setDifficulty(difficulty: DifficultyId): void {
    this.difficulty = difficulty;
  }

  public get state(): StageFlowState {
    return this.flowState;
  }

  public get waveNumber(): number {
    return Math.max(1, this.currentWaveIndex + 1);
  }

  public get totalWaves(): number {
    return this.stage.waves.length;
  }

  public get clearTimeSec(): number {
    return this.elapsedStageSec;
  }

  public get currentWave(): WaveConfig | null {
    return this.stage.waves[this.currentWaveIndex] ?? null;
  }

  public startStage(): void {
    this.flowState = 'ENTRY_HENSHIN';
    this.currentWaveIndex = -1;
    this.transitionTimer = 1.8; // GDD Section 4.1: 1.8s fast Arena Entry Henshin
    this.elapsedStageSec = 0;
    this.damageTaken = 0;
    this.reactionsTriggered = 0;
    this.perfectDodges = 0;
    this.maxCombo = 0;
    this.defeatedBossWithFinisher = false;
  }

  public recordDamageTaken(amount: number): void {
    if (amount > 0) this.damageTaken += Math.round(amount);
  }

  public recordReaction(): void {
    this.reactionsTriggered++;
  }

  public recordPerfectDodge(): void {
    this.perfectDodges++;
  }

  public recordCombo(combo: number): void {
    if (combo > this.maxCombo) this.maxCombo = combo;
  }

  public markBossFinisherKill(): void {
    this.defeatedBossWithFinisher = true;
  }

  public fixedUpdate(dt: number, aliveEnemyCount: number): {
    spawnWave: WaveConfig | null;
    stageCleared: boolean;
    bossRushHealPct: number;
  } {
    if (this.flowState === 'IDLE' || this.flowState === 'FINISHED') {
      return { spawnWave: null, stageCleared: false, bossRushHealPct: 0 };
    }

    if (this.flowState === 'ENTRY_HENSHIN') {
      this.transitionTimer -= dt;
      if (this.transitionTimer <= 0) {
        this.currentWaveIndex = 0;
        this.flowState = 'WAVE_ACTIVE';
        return {
          spawnWave: this.stage.waves[0] ?? null,
          stageCleared: false,
          bossRushHealPct: 0,
        };
      }
      return { spawnWave: null, stageCleared: false, bossRushHealPct: 0 };
    }

    this.elapsedStageSec += dt;

    if (this.flowState === 'WAVE_ACTIVE') {
      if (aliveEnemyCount <= 0) {
        if (this.currentWaveIndex + 1 >= this.stage.waves.length) {
          this.flowState = 'FINISHED';
          return { spawnWave: null, stageCleared: true, bossRushHealPct: 0 };
        }
        this.flowState = 'WAVE_TRANSITION';
        this.transitionTimer = 1.65;
        return {
          spawnWave: null,
          stageCleared: false,
          bossRushHealPct: this.stage.isBossRush ? (this.stage.bossRushHealPct ?? 0.35) : 0,
        };
      }
      return { spawnWave: null, stageCleared: false, bossRushHealPct: 0 };
    }

    if (this.flowState === 'WAVE_TRANSITION') {
      this.transitionTimer -= dt;
      if (this.transitionTimer <= 0) {
        this.currentWaveIndex++;
        this.flowState = 'WAVE_ACTIVE';
        return {
          spawnWave: this.stage.waves[this.currentWaveIndex] ?? null,
          stageCleared: false,
          bossRushHealPct: 0,
        };
      }
    }

    return { spawnWave: null, stageCleared: false, bossRushHealPct: 0 };
  }

  public buildResultAndPersist(victory: boolean): { result: StageResult; saveRecord: SaveRecord } {
    this.flowState = 'FINISHED';
    const stats: StageStats = {
      stageId: this.stage.id,
      difficulty: this.difficulty,
      victory,
      clearTimeSec: Math.round(this.elapsedStageSec * 10) / 10,
      damageTaken: this.damageTaken,
      reactionsTriggered: this.reactionsTriggered,
      perfectDodges: this.perfectDodges,
      maxCombo: this.maxCombo,
      defeatedBossWithFinisher: victory && this.defeatedBossWithFinisher,
    };

    const { score, rank } = calculateStageRank(stats);
    const prevSave = loadSaveRecord();
    const isNewBest = victory && score > prevSave.bestScore;
    const { shardsEarned, unlockedElementDrop } = calculateStageRewards(
      victory,
      this.stage.id,
      rank,
      prevSave.unlockedElements,
      this.difficulty
    );

    const nextUnlocked =
      unlockedElementDrop && !prevSave.unlockedElements.includes(unlockedElementDrop)
        ? [...prevSave.unlockedElements, unlockedElementDrop]
        : prevSave.unlockedElements;

    const nextGemLevels = unlockedElementDrop
      ? { ...prevSave.gemLevels, [unlockedElementDrop]: prevSave.gemLevels[unlockedElementDrop] ?? 1 }
      : prevSave.gemLevels;

    const nextClearedStages =
      victory && !prevSave.clearedStageIds.includes(this.stage.id)
        ? [...prevSave.clearedStageIds, this.stage.id]
        : prevSave.clearedStageIds;

    const rankKey = makeStageDifficultyKey(this.stage.id, this.difficulty);
    const prevModeRank = prevSave.stageDifficultyBestRanks[rankKey] ?? null;
    const nextStageDiffRanks: Partial<Record<string, RankGrade>> =
      victory && isRankBetter(rank, prevModeRank)
        ? { ...prevSave.stageDifficultyBestRanks, [rankKey]: rank }
        : prevSave.stageDifficultyBestRanks;

    const updatedSave: SaveRecord = {
      ...prevSave,
      bestRank: victory && isRankBetter(rank, prevSave.bestRank) ? rank : prevSave.bestRank,
      bestScore: victory ? Math.max(prevSave.bestScore, score) : prevSave.bestScore,
      fastestClearSec:
        victory &&
        (prevSave.fastestClearSec === null || stats.clearTimeSec < prevSave.fastestClearSec)
          ? stats.clearTimeSec
          : prevSave.fastestClearSec,
      totalClears: victory ? prevSave.totalClears + 1 : prevSave.totalClears,
      selectedDifficulty: this.difficulty,
      stageDifficultyBestRanks: nextStageDiffRanks,
      unlockedElements: nextUnlocked,
      gemLevels: nextGemLevels,
      gemShards: prevSave.gemShards + shardsEarned,
      clearedStageIds: nextClearedStages,
    };

    persistSaveRecord(updatedSave);

    return {
      result: {
        ...stats,
        difficulty: this.difficulty,
        score,
        rank,
        isNewBest,
        shardsEarned,
        unlockedElementDrop,
      },
      saveRecord: updatedSave,
    };
  }

  public resetToIdle(): void {
    this.flowState = 'IDLE';
    this.currentWaveIndex = -1;
    this.transitionTimer = 0;
    this.elapsedStageSec = 0;
  }
}

import { describe, expect, it } from 'vitest';
import { PlayerFSM } from '../game/combat/PlayerFSM';
import {
  DIFFICULTY_LIST,
  getDifficultyConfig,
  scaleEnemyConfigForDifficulty,
} from '../game/data/difficulty';
import { ENEMY_CONFIGS } from '../game/data/enemies';
import { STAGE_BOSS_RUSH, STAGE_LIST } from '../game/data/stages';
import { calculateStageRewards } from '../game/ProgressionSystem';
import { StageManager, calculateStageRank } from '../game/StageManager';

describe('Paket A — Difficulty Modes (Easy/Medium/Hard/Hell), S+ Rank & Boss Rush', () => {
  it('scales enemy stats across all 4 difficulties while strictly enforcing >= 0.45s fair telegraphs', () => {
    expect(DIFFICULTY_LIST.map((d) => d.id)).toEqual(['easy', 'medium', 'hard', 'hell']);

    const boss = ENEMY_CONFIGS.sylvan_sovereign;
    const easyBoss = scaleEnemyConfigForDifficulty(boss, 'easy');
    const hardBoss = scaleEnemyConfigForDifficulty(boss, 'hard');
    const hellBoss = scaleEnemyConfigForDifficulty(boss, 'hell');

    expect(easyBoss.maxHp).toBeLessThan(boss.maxHp);
    expect(hardBoss.maxHp).toBeGreaterThan(boss.maxHp);
    expect(hellBoss.maxHp).toBeGreaterThan(hardBoss.maxHp);
    expect(hellBoss.attackDamage).toBeGreaterThan(hardBoss.attackDamage);

    // Every enemy on every difficulty MUST respect the >= 0.45s Tokusatsu telegraph rule!
    for (const diff of DIFFICULTY_LIST) {
      for (const enemy of Object.values(ENEMY_CONFIGS)) {
        const scaled = scaleEnemyConfigForDifficulty(enemy, diff.id);
        expect(scaled.telegraphDurationSec).toBeGreaterThanOrEqual(0.45);
      }
    }
  });

  it('awards S+ Rank only on Hard/Hell high-score victories and scales Shard rewards', () => {
    const perfectStats = {
      victory: true,
      clearTimeSec: 52,
      damageTaken: 0,
      reactionsTriggered: 6,
      perfectDodges: 4,
      maxCombo: 25,
      defeatedBossWithFinisher: true,
    };

    const mediumRes = calculateStageRank({ ...perfectStats, difficulty: 'medium' });
    const hardRes = calculateStageRank({ ...perfectStats, difficulty: 'hard' });
    const hellRes = calculateStageRank({ ...perfectStats, difficulty: 'hell' });

    expect(mediumRes.rank).toBe('S');
    expect(hardRes.rank).toBe('S+');
    expect(hellRes.rank).toBe('S+');
    expect(hellRes.score).toBeGreaterThan(hardRes.score);

    const medShards = calculateStageRewards(true, 'stage_boss_rush', 'S', ['pyro', 'volt', 'aqua'], 'medium');
    const hellShards = calculateStageRewards(true, 'stage_boss_rush', 'S+', ['pyro', 'volt', 'aqua'], 'hell');
    expect(hellShards.shardsEarned).toBeGreaterThan(medShards.shardsEarned * 2);
  });

  it('runs 3-Boss Boss Rush gauntlet and triggers +35% HP recovery between Boss waves', () => {
    expect(STAGE_LIST.some((s) => s.id === 'stage_boss_rush')).toBe(true);
    expect(STAGE_BOSS_RUSH.waves).toHaveLength(3);
    expect(STAGE_BOSS_RUSH.isBossRush).toBe(true);

    const mgr = new StageManager(STAGE_BOSS_RUSH, 'hell');
    mgr.startStage();

    // Finish 1.8s Entry Henshin -> spawns Boss 1 (Obsidian Kaijin)
    const w1 = mgr.fixedUpdate(1.9, 0);
    expect(w1.spawnWave?.spawns[0]?.enemyId).toBe('obsidian_kaijin');

    // Defeat Boss 1 -> triggers 35% Boss Rush HP Recovery!
    const heal1 = mgr.fixedUpdate(0.016, 0);
    expect(heal1.bossRushHealPct).toBeCloseTo(0.35, 2);

    // Transition -> spawns Boss 2 (Magma Overlord)
    const w2 = mgr.fixedUpdate(1.7, 0);
    expect(w2.spawnWave?.spawns[0]?.enemyId).toBe('magma_overlord');
  });

  it('grants wider Perfect Dodge i-frame window on Easy difficulty', () => {
    const easyFsm = new PlayerFSM();
    easyFsm.setDodgeIframeBonus(getDifficultyConfig('easy').dodgeIframeBonusSec);

    easyFsm.update(0.016, {
      isMoving: true,
      wantsAttack: false,
      wantsDodge: true,
      attackSpeed: 1,
    });
    // Advance to 0.28s (past standard 0.25s i-frames, still inside Easy's 0.31s window!)
    easyFsm.update(0.28, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      attackSpeed: 1,
    });
    expect(easyFsm.receiveIncomingHit(false, false)).toBe('PERFECT_DODGE');
  });
});

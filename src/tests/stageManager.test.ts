import { describe, expect, it } from 'vitest';
import {
  StageManager,
  calculateStageRank,
  isRankBetter,
} from '../game/StageManager';

describe('StageManager & Pure Rank Calculator (Phase 3)', () => {
  it('awards S Rank for fast clear with Elemental Reactions and Ultimate Finisher bonus', () => {
    const res = calculateStageRank({
      victory: true,
      clearTimeSec: 55,
      damageTaken: 20,
      reactionsTriggered: 4,
      perfectDodges: 2,
      maxCombo: 12,
      defeatedBossWithFinisher: true,
    });

    expect(res.rank).toBe('S');
    expect(res.score).toBeGreaterThanOrEqual(8200);
  });

  it('awards C Rank on defeat regardless of partial style points', () => {
    const res = calculateStageRank({
      victory: false,
      clearTimeSec: 40,
      damageTaken: 220,
      reactionsTriggered: 3,
      perfectDodges: 1,
      maxCombo: 8,
      defeatedBossWithFinisher: false,
    });

    expect(res.rank).toBe('C');
    expect(res.score).toBeGreaterThan(0);
  });

  it('orders rank hierarchy S > A > B > C > null cleanly', () => {
    expect(isRankBetter('C', null)).toBe(true);
    expect(isRankBetter('S', 'A')).toBe(true);
    expect(isRankBetter('B', 'A')).toBe(false);
    expect(isRankBetter('A', 'A')).toBe(false);
  });

  it('progresses cleanly through Entry Henshin -> Wave 1 -> Wave 2 -> Wave 3 -> Stage Cleared', () => {
    const manager = new StageManager();
    manager.startStage();
    expect(manager.state).toBe('ENTRY_HENSHIN');

    // Finish 1.8s entry Henshin -> spawns Wave 1 (5 Shadow Grunts)
    const w1 = manager.fixedUpdate(1.85, 0);
    expect(w1.spawnWave?.waveNumber).toBe(1);
    expect(w1.stageCleared).toBe(false);
    expect(manager.state).toBe('WAVE_ACTIVE');

    // While enemies alive, does not advance wave
    const stillW1 = manager.fixedUpdate(1.0, 3);
    expect(stillW1.spawnWave).toBeNull();
    expect(manager.state).toBe('WAVE_ACTIVE');

    // Defeating all Wave 1 enemies triggers transition -> Wave 2
    manager.fixedUpdate(0.1, 0);
    expect(manager.state).toBe('WAVE_TRANSITION');
    const w2 = manager.fixedUpdate(1.7, 0);
    expect(w2.spawnWave?.waveNumber).toBe(2);

    // Clear Wave 2 -> spawns Wave 3 (Obsidian Kaijin Boss)
    manager.fixedUpdate(0.1, 0);
    const w3 = manager.fixedUpdate(1.7, 0);
    expect(w3.spawnWave?.waveNumber).toBe(3);

    // Defeat Boss in Wave 3 -> Stage Cleared!
    manager.markBossFinisherKill();
    manager.recordReaction();
    const done = manager.fixedUpdate(0.1, 0);
    expect(done.stageCleared).toBe(true);
    expect(manager.state).toBe('FINISHED');

    const { result } = manager.buildResultAndPersist(true);
    expect(result.victory).toBe(true);
    expect(result.defeatedBossWithFinisher).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { InputManager } from '../engine/InputManager';
import { calculateDamage } from '../game/combat/DamageCalculator';
import { evaluateElementalReaction } from '../game/combat/ReactionSystem';
import {
  ALL_ELEMENT_IDS,
  ALL_ELEMENTS,
  getElementConfig,
  getElementLevelDamageMultiplier,
} from '../game/data/elements';
import { ENEMY_CONFIGS } from '../game/data/enemies';
import { STAGE_LIST, getStageConfig } from '../game/data/stages';
import {
  GEM_SHARD_UNLOCK_COST,
  MAX_GEM_LEVEL,
  applyGemUpgrade,
  applyShardGemUnlock,
  calculateStageRewards,
  getGemLevel,
  getGemUpgradeCost,
  pickBossDropUnlock,
} from '../game/ProgressionSystem';
import {
  PET_ASSIST_STRIKE_DURATION_SEC,
  PET_AUTO_SHOT_INTERVAL_SEC,
  PET_COMPANION_DURATION_SEC,
  PET_POST_FOLLOW_COOLDOWN_SEC,
} from '../game/entities/PetEntity';
import {
  FINISHER_COOLDOWN_SEC,
  FINISHER_SUPER_DURATION_COST_SEC,
  SUPER_FORM_DURATION_SEC,
  SUPER_FORM_MAX_DURATION_SEC,
  ULTIMATE_FORM_DURATION_SEC,
  ULTIMATE_FORM_MAX_DURATION_SEC,
} from '../game/entities/PlayerRider';
import { DEFAULT_SAVE_RECORD, StageManager } from '../game/StageManager';
import type { SaveRecord } from '../game/types/schema';

describe('Phase 5 Expansion: 10 Elements, RANGED, Lazy Arenas, Progression & Gamepad API', () => {
  it('defines all 10 elements (3 starters + 7 expansion) including RANGED Bow & Dual Guns', () => {
    expect(ALL_ELEMENT_IDS).toHaveLength(10);
    for (const id of ALL_ELEMENT_IDS) {
      const cfg = getElementConfig(id);
      expect(cfg.id).toBe(id);
      expect(cfg.weapon.baseDamage).toBeGreaterThan(0);
      expect(cfg.pet.name.length).toBeGreaterThan(0);
      expect(cfg.skill.cooldown).toBeGreaterThan(0);
    }

    expect(ALL_ELEMENTS.flora.weapon.archetype).toBe('RANGED');
    expect(ALL_ELEMENTS.umbra.weapon.archetype).toBe('RANGED');
    expect(ALL_ELEMENTS.flora.statusApplied).toBe('ROOT');
    expect(ALL_ELEMENTS.umbra.statusApplied).toBe('MARK');

    expect(getElementLevelDamageMultiplier(1)).toBeCloseTo(1.0, 5);
    expect(getElementLevelDamageMultiplier(5)).toBeCloseTo(1.48, 5);
    expect(getElementLevelDamageMultiplier(99)).toBeCloseTo(1.48, 5);
  });

  it('triggers Phase 5 WILDFIRE (ROOT+PYRO) and ECLIPSE (MARK+LUX True Damage) reactions accurately', () => {
    const wildfire = evaluateElementalReaction(['ROOT'], 'pyro', 'BURN');
    expect(wildfire.triggered).toBe(true);
    expect(wildfire.reaction?.id).toBe('WILDFIRE');
    expect(wildfire.consumedStatus).toBe('ROOT');

    const eclipse = evaluateElementalReaction(['MARK'], 'lux', 'SHOCK');
    expect(eclipse.triggered).toBe(true);
    expect(eclipse.reaction?.id).toBe('ECLIPSE');
    expect(eclipse.reaction?.ignoresDefense).toBe(true);

    const normalHit = calculateDamage({
      baseDamage: 100,
      skillMultiplier: 1.0,
      formTier: 'BASIC',
      targetDefense: 100,
      ignoresDefense: false,
      critRoll: 0.99,
    });
    const trueDmgHit = calculateDamage({
      baseDamage: 100,
      skillMultiplier: 1.0,
      formTier: 'BASIC',
      targetDefense: 100,
      ignoresDefense: true,
      critRoll: 0.99,
    });
    expect(trueDmgHit.finalDamage).toBe(100);
    expect(normalHit.finalDamage).toBe(50);
  });

  it('provides 3 distinct thematic stages (Coastal Quarry, Volcanic Crater, Forest Ruins) with Boss pools', () => {
    expect(STAGE_LIST).toHaveLength(3);
    const s1 = getStageConfig('stage_01_nexus_arena');
    const s2 = getStageConfig('stage_02_volcanic_crater');
    const s3 = getStageConfig('stage_03_forest_ruins');

    expect(s1.arenaTheme).toBe('coastal_quarry');
    expect(s2.arenaTheme).toBe('volcanic_crater');
    expect(s3.arenaTheme).toBe('forest_ruins');
    expect(ENEMY_CONFIGS.magma_overlord.tier).toBe('BOSS');
    expect(ENEMY_CONFIGS.sylvan_sovereign.tier).toBe('BOSS');

    const mgr = new StageManager(s2);
    mgr.startStage();
    const w1 = mgr.fixedUpdate(1.9, 0);
    expect(w1.spawnWave?.waveNumber).toBe(1);
    expect(mgr.totalWaves).toBe(3);
  });

  it('awards Boss Drop Gem unlocks, calculates shards, and validates Hub upgrades & shard unlocks', () => {
    const drop = pickBossDropUnlock(['pyro', 'volt', 'aqua'], 'stage_02_volcanic_crater');
    expect(drop).toBe('terra');

    const rewards = calculateStageRewards(true, 'stage_02_volcanic_crater', 'S', [
      'pyro',
      'volt',
      'aqua',
    ]);
    expect(rewards.shardsEarned).toBeGreaterThan(100);
    expect(rewards.unlockedElementDrop).toBe('terra');

    const defeatRewards = calculateStageRewards(false, 'stage_01_nexus_arena', 'C', [
      'pyro',
      'volt',
      'aqua',
    ]);
    expect(defeatRewards.shardsEarned).toBe(15);
    expect(defeatRewards.unlockedElementDrop).toBeNull();

    // Upgrade Pyro Lv.1 -> Lv.2 (cost 40 shards)
    let save: SaveRecord = {
      ...DEFAULT_SAVE_RECORD,
      unlockedElements: ['pyro', 'volt', 'aqua'],
      gemLevels: { pyro: 1, volt: 1, aqua: 1 },
      gemShards: 200,
    };
    expect(getGemUpgradeCost(1)).toBe(40);
    const upg = applyGemUpgrade(save, 'pyro');
    expect(upg.upgraded).toBe(true);
    expect(upg.newLevel).toBe(2);
    expect(getGemLevel(upg.updated, 'pyro')).toBe(2);
    expect(upg.updated.gemShards).toBe(160);

    // Unlock locked Flora gem with Shards (cost 80 shards)
    const unlock = applyShardGemUnlock(upg.updated, 'flora');
    expect(unlock.unlocked).toBe(true);
    expect(unlock.updated.unlockedElements).toContain('flora');
    expect(unlock.updated.gemShards).toBe(160 - GEM_SHARD_UNLOCK_COST);

    // Cap enforcement at MAX_GEM_LEVEL
    save = {
      ...unlock.updated,
      gemShards: 999,
      gemLevels: { ...unlock.updated.gemLevels, pyro: MAX_GEM_LEVEL },
    };
    expect(applyGemUpgrade(save, 'pyro').upgraded).toBe(false);
  });

  it('processes Gamepad API analog sticks with deadzone and rising-edge buffered combat buttons', () => {
    let clock = 1000;
    const input = new InputManager({ now: () => clock });
    const move = { x: 0, z: 0 };
    const look = { dx: 0, dy: 0 };

    const makeButtons = (pressedIndices: number[]) =>
      Array.from({ length: 16 }, (_, idx) => ({
        pressed: pressedIndices.includes(idx),
        value: pressedIndices.includes(idx) ? 1 : 0,
      }));

    // Inside deadzone -> zero motion
    input.applyGamepadSnapshot(
      { id: 'Xbox Controller', axes: [0.05, -0.08, 0.04, 0.02], buttons: makeButtons([]) },
      1 / 60,
      clock
    );
    input.getMoveInput(move);
    expect(move.x).toBe(0);
    expect(move.z).toBe(0);

    // Full stick + X(2)=ATTACK, Y(3)=SKILL, RT(7)=HENSHIN, L3(10)=FINISHER, D-Pad Left(14)=SWITCH_1
    clock += 16;
    input.applyGamepadSnapshot(
      { id: 'Xbox Controller', axes: [0.9, -0.5, 0.8, 0], buttons: makeButtons([2, 3, 7, 10, 14]) },
      1 / 60,
      clock
    );
    input.getMoveInput(move);
    input.consumeLookDelta(look);
    expect(move.x).toBeGreaterThan(0.5);
    expect(move.z).toBeGreaterThan(0.2);
    expect(look.dx).toBeGreaterThan(0);
    expect(input.consumeBufferedAction('ATTACK', clock)).toBe(true);
    expect(input.consumeBufferedAction('SKILL', clock)).toBe(true);
    expect(input.consumeBufferedAction('HENSHIN', clock)).toBe(true);
    expect(input.consumeBufferedAction('FINISHER', clock)).toBe(true);
    expect(input.consumeBufferedAction('SWITCH_1', clock)).toBe(true);

    // Holding X(2) on the next frame must NOT re-trigger rising-edge ATTACK buffer
    clock += 16;
    input.applyGamepadSnapshot(
      { id: 'Xbox Controller', axes: [0, 0, 0, 0], buttons: makeButtons([2]) },
      1 / 60,
      clock
    );
    expect(input.consumeBufferedAction('ATTACK', clock)).toBe(false);

    input.dispose();
  });

  it('enforces extended Super/Ultimate Form sustain timers and instant [R] Finisher constants', () => {
    expect(SUPER_FORM_DURATION_SEC).toBe(32);
    expect(SUPER_FORM_MAX_DURATION_SEC).toBe(40);
    expect(ULTIMATE_FORM_DURATION_SEC).toBe(25);
    expect(ULTIMATE_FORM_MAX_DURATION_SEC).toBe(32);
    expect(FINISHER_COOLDOWN_SEC).toBe(7);
    expect(FINISHER_SUPER_DURATION_COST_SEC).toBe(7);
    expect(PET_ASSIST_STRIKE_DURATION_SEC).toBeGreaterThan(0.8);
    expect(PET_COMPANION_DURATION_SEC).toBeGreaterThanOrEqual(15);
    expect(PET_COMPANION_DURATION_SEC).toBeLessThanOrEqual(20);
    expect(PET_POST_FOLLOW_COOLDOWN_SEC).toBe(20);
    expect(PET_AUTO_SHOT_INTERVAL_SEC).toBeGreaterThanOrEqual(1.0);
    expect(PET_AUTO_SHOT_INTERVAL_SEC).toBeLessThanOrEqual(2.0);
  });
});

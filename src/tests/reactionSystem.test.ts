import { describe, expect, it } from 'vitest';
import { calculateDamage } from '../game/combat/DamageCalculator';
import {
  evaluateElementalReaction,
  getReactionSpecById,
} from '../game/combat/ReactionSystem';

describe('ReactionSystem (Pure GDD Section 3.2 Elemental Combo Matrix)', () => {
  it('triggers ELECTRO_SURGE when VOLT hits a WET target and consumes WET', () => {
    const result = evaluateElementalReaction(['WET'], 'volt', 'SHOCK');

    expect(result.triggered).toBe(true);
    expect(result.reaction?.id).toBe('ELECTRO_SURGE');
    expect(result.reaction?.displayName).toBe('ELECTRO-SURGE!');
    expect(result.reaction?.guardDamageMultiplier).toBe(2.5);
    expect(result.consumedStatus).toBe('WET');
    expect(result.remainingStatuses).toEqual([]);
  });

  it('triggers STEAM_BURST when PYRO hits a WET target with 1.8x damage multiplier', () => {
    const result = evaluateElementalReaction(['WET', 'SHOCK'], 'pyro', 'BURN');

    expect(result.triggered).toBe(true);
    expect(result.reaction?.id).toBe('STEAM_BURST');
    expect(result.reaction?.damageMultiplier).toBe(1.8);
    expect(result.consumedStatus).toBe('WET');
    // Unrelated status SHOCK remains untouched
    expect(result.remainingStatuses).toEqual(['SHOCK']);
  });

  it('triggers OVERLOAD when VOLT hits a BURN target with 3 micro-explosions & 2.0x gauge multiplier', () => {
    const result = evaluateElementalReaction(['BURN'], 'volt', 'SHOCK');

    expect(result.triggered).toBe(true);
    expect(result.reaction?.id).toBe('OVERLOAD');
    expect(result.reaction?.microExplosionCount).toBe(3);
    expect(result.reaction?.gaugeMultiplier).toBe(2.0);
    expect(result.consumedStatus).toBe('BURN');
    expect(result.remainingStatuses).toEqual([]);
  });

  it('applies incoming status without duplicate entries when no reaction matches', () => {
    const first = evaluateElementalReaction([], 'aqua', 'WET');
    expect(first.triggered).toBe(false);
    expect(first.appliedStatus).toBe('WET');
    expect(first.remainingStatuses).toEqual(['WET']);

    const refresh = evaluateElementalReaction(['WET'], 'aqua', 'WET');
    expect(refresh.triggered).toBe(false);
    expect(refresh.remainingStatuses).toEqual(['WET']);
  });

  it('supports expansion reactions WILDFIRE (ROOT+PYRO) and ECLIPSE (MARK+LUX true damage)', () => {
    const wildfire = evaluateElementalReaction(['ROOT'], 'pyro', 'BURN');
    expect(wildfire.triggered).toBe(true);
    expect(wildfire.reaction?.id).toBe('WILDFIRE');

    const eclipse = evaluateElementalReaction(['MARK'], 'lux');
    expect(eclipse.triggered).toBe(true);
    expect(eclipse.reaction?.id).toBe('ECLIPSE');
    expect(eclipse.reaction?.ignoresDefense).toBe(true);

    // True damage integration check with DamageCalculator
    const spec = getReactionSpecById('ECLIPSE')!;
    const dmg = calculateDamage({
      baseDamage: 100,
      skillMultiplier: 1.0,
      formTier: 'BASIC',
      reactionMultiplier: spec.damageMultiplier,
      targetDefense: 200,
      ignoresDefense: spec.ignoresDefense,
      critRoll: 0.99,
    });
    expect(dmg.effectiveDefense).toBe(0);
    expect(dmg.finalDamage).toBe(175);
  });
});

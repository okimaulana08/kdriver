import { describe, expect, it } from 'vitest';
import {
  BASE_CRIT_CHANCE,
  CRIT_MULTIPLIER,
  PERFECT_DODGE_GAUGE_BONUS,
  SHOCK_CRIT_BONUS,
  calculateDamage,
  calculateHitGaugeGain,
  getCritChance,
  getEffectiveDefense,
  getFormMultiplier,
} from '../game/combat/DamageCalculator';

describe('DamageCalculator (Pure GDD Section 3.4 Formulas)', () => {
  it('computes exact base non-crit damage with defense mitigation', () => {
    // floor(100 * 1.0 * 1.0 * 1.0 * 1.0 * (100 / 125)) = 80
    const result = calculateDamage({
      baseDamage: 100,
      skillMultiplier: 1.0,
      formTier: 'BASIC',
      targetDefense: 25,
      critRoll: 0.9,
    });

    expect(result.isCrit).toBe(false);
    expect(result.effectiveDefense).toBe(25);
    expect(result.critChance).toBeCloseTo(BASE_CRIT_CHANCE, 5);
    expect(result.finalDamage).toBe(80);
  });

  it('applies form tier, skill, reaction, crit, and staggered 50% defense reduction', () => {
    // DEF_eff = 40 * 0.5 = 20 -> mitigation = 100 / 120
    // 50 * 1.5 (Hit 3) * 1.3 (SUPER) * 1.8 (Steam Burst) * 1.5 (Crit) * (100 / 120) = 219.375 -> floor = 219
    const result = calculateDamage({
      baseDamage: 50,
      skillMultiplier: 1.5,
      formTier: 'SUPER',
      reactionMultiplier: 1.8,
      targetDefense: 40,
      targetStaggered: true,
      critRoll: 0.05,
    });

    expect(result.isCrit).toBe(true);
    expect(result.effectiveDefense).toBe(20);
    expect(result.finalDamage).toBe(219);
  });

  it('increases critical hit chance by +25% against SHOCK targets', () => {
    expect(getCritChance([])).toBeCloseTo(0.1, 5);
    expect(getCritChance(['SHOCK'])).toBeCloseTo(BASE_CRIT_CHANCE + SHOCK_CRIT_BONUS, 5);

    // Roll 0.25 misses 10% base crit, but hits 35% SHOCK crit
    const noShock = calculateDamage({
      baseDamage: 100,
      skillMultiplier: 1.0,
      formTier: 'BASIC',
      targetDefense: 0,
      targetStatuses: [],
      critRoll: 0.25,
    });
    const withShock = calculateDamage({
      baseDamage: 100,
      skillMultiplier: 1.0,
      formTier: 'BASIC',
      targetDefense: 0,
      targetStatuses: ['SHOCK'],
      critRoll: 0.25,
    });

    expect(noShock.isCrit).toBe(false);
    expect(noShock.finalDamage).toBe(100);
    expect(withShock.isCrit).toBe(true);
    expect(withShock.finalDamage).toBe(Math.floor(100 * CRIT_MULTIPLIER));
  });

  it('supports BASIC, SUPER, and ULTIMATE form multipliers and floors cleanly with min 1 damage', () => {
    expect(getFormMultiplier('BASIC')).toBe(1.0);
    expect(getFormMultiplier('SUPER')).toBe(1.3);
    expect(getFormMultiplier('ULTIMATE')).toBe(1.6);
    expect(getEffectiveDefense(60, true)).toBe(30);

    const tinyHit = calculateDamage({
      baseDamage: 1,
      skillMultiplier: 0.5,
      formTier: 'BASIC',
      targetDefense: 900,
      critRoll: 0.99,
    });
    expect(tinyHit.finalDamage).toBe(1);

    const zeroHit = calculateDamage({
      baseDamage: 0,
      skillMultiplier: 1.0,
      formTier: 'BASIC',
      targetDefense: 0,
      critRoll: 0.99,
    });
    expect(zeroHit.finalDamage).toBe(0);
  });

  it('computes Driver Gauge gain with 2x switch reaction multiplier and +15 Perfect Dodge bonus', () => {
    expect(calculateHitGaugeGain(8, false)).toBe(8);
    expect(calculateHitGaugeGain(8, true)).toBe(16);
    expect(PERFECT_DODGE_GAUGE_BONUS).toBe(15);
  });
});

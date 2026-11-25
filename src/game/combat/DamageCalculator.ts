import type {
  DamageCalculationInput,
  DamageCalculationResult,
  FormTier,
  StatusEffectId,
} from '../types/schema';

export const BASE_CRIT_CHANCE = 0.1;
export const SHOCK_CRIT_BONUS = 0.25;
export const CRIT_MULTIPLIER = 1.5;
export const STAGGERED_DEFENSE_RATIO = 0.5;
export const SWITCH_REACTION_GAUGE_MULTIPLIER = 2.0;
export const PERFECT_DODGE_GAUGE_BONUS = 15;

export function getFormMultiplier(formTier: FormTier): number {
  switch (formTier) {
    case 'SUPER':
      return 1.3;
    case 'ULTIMATE':
      return 1.6;
    case 'BASIC':
    default:
      return 1.0;
  }
}

export function getEffectiveDefense(baseDefense: number, isStaggered = false): number {
  const clampedDefense = Math.max(0, baseDefense);
  return isStaggered ? clampedDefense * STAGGERED_DEFENSE_RATIO : clampedDefense;
}

export function getCritChance(
  targetStatuses: readonly StatusEffectId[] = [],
  baseCritChance = BASE_CRIT_CHANCE
): number {
  const hasShock = targetStatuses.includes('SHOCK');
  const raw = baseCritChance + (hasShock ? SHOCK_CRIT_BONUS : 0);
  return Math.min(1, Math.max(0, raw));
}

/**
 * Pure damage calculation implementing GDD Section 3.4:
 * D_final = floor(D_base * M_skill * M_form * M_reaction * M_crit * (100 / (100 + DEF_eff)))
 */
export function calculateDamage(input: DamageCalculationInput): DamageCalculationResult {
  const baseDamage = Math.max(0, input.baseDamage);
  const skillMultiplier = Math.max(0, input.skillMultiplier);
  const formMultiplier = getFormMultiplier(input.formTier);
  const reactionMultiplier = Math.max(0, input.reactionMultiplier ?? 1.0);
  const effectiveDefense = input.ignoresDefense
    ? 0
    : getEffectiveDefense(input.targetDefense, input.targetStaggered);

  const critChance = getCritChance(input.targetStatuses, input.baseCritChance);
  const roll = input.critRoll ?? Math.random();
  const isCrit = roll < critChance;
  const critMultiplier = isCrit ? CRIT_MULTIPLIER : 1.0;

  const mitigation = 100 / (100 + effectiveDefense);
  const rawDamage =
    baseDamage *
    skillMultiplier *
    formMultiplier *
    reactionMultiplier *
    critMultiplier *
    mitigation;

  const floored = Math.floor(rawDamage);
  const finalDamage = baseDamage > 0 && skillMultiplier > 0 ? Math.max(1, floored) : 0;

  return {
    finalDamage,
    isCrit,
    critChance,
    effectiveDefense,
  };
}

/**
 * Pure Driver Gauge calculation per hit (GDD Section 3.4).
 */
export function calculateHitGaugeGain(
  baseGaugePerHit: number,
  triggeredRecentSwitchReaction = false
): number {
  const clampedBase = Math.max(0, baseGaugePerHit);
  const switchMultiplier = triggeredRecentSwitchReaction ? SWITCH_REACTION_GAUGE_MULTIPLIER : 1.0;
  return clampedBase * switchMultiplier;
}

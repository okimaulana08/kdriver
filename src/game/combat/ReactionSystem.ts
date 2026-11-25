import type {
  ElementId,
  ReactionId,
  ReactionSpec,
  StatusEffectId,
} from '../types/schema';

export const STATUS_DEFAULT_DURATIONS: Readonly<Record<StatusEffectId, number>> = {
  BURN: 5.0,
  SHOCK: 6.0,
  WET: 6.0,
  ROOT: 4.0,
  MARK: 6.0,
};

/**
 * Pure Elemental Combo Matrix (GDD Section 3.2).
 * Zero Three.js or DOM dependencies for direct Vitest verification.
 */
export const REACTION_MATRIX: readonly ReactionSpec[] = [
  {
    id: 'ELECTRO_SURGE',
    displayName: 'ELECTRO-SURGE!',
    subtitle: 'CHAIN LIGHTNING • 2.5x ARMOR BREAK',
    requiredStatus: 'WET',
    triggerElement: 'volt',
    damageMultiplier: 1.6,
    guardDamageMultiplier: 2.5,
    gaugeMultiplier: 1.0,
    radius: 5.5,
    knockbackForce: 2.0,
    microExplosionCount: 1,
    ignoresDefense: false,
    accentColor: '#38bdf8',
  },
  {
    id: 'STEAM_BURST',
    displayName: 'STEAM BURST!',
    subtitle: '1.8x VAPOR BLAST • HEAVY KNOCKBACK',
    requiredStatus: 'WET',
    triggerElement: 'pyro',
    damageMultiplier: 1.8,
    guardDamageMultiplier: 1.4,
    gaugeMultiplier: 1.0,
    radius: 4.6,
    knockbackForce: 6.5,
    microExplosionCount: 1,
    ignoresDefense: false,
    accentColor: '#fb923c',
  },
  {
    id: 'OVERLOAD',
    displayName: 'OVERLOAD!',
    subtitle: 'TRIPLE MICRO-BLAST • 2.0x DRIVER GAUGE',
    requiredStatus: 'BURN',
    triggerElement: 'volt',
    damageMultiplier: 1.5,
    guardDamageMultiplier: 1.5,
    gaugeMultiplier: 2.0,
    radius: 4.2,
    knockbackForce: 3.5,
    microExplosionCount: 3,
    ignoresDefense: false,
    accentColor: '#facc15',
  },
  {
    id: 'WILDFIRE',
    displayName: 'WILDFIRE!',
    subtitle: 'SCORCHING ZONE • 4s BURN FIELD',
    requiredStatus: 'ROOT',
    triggerElement: 'pyro',
    damageMultiplier: 1.5,
    guardDamageMultiplier: 1.2,
    gaugeMultiplier: 1.0,
    radius: 4.8,
    knockbackForce: 1.5,
    microExplosionCount: 1,
    ignoresDefense: false,
    accentColor: '#f97316',
  },
  {
    id: 'ECLIPSE',
    displayName: 'ECLIPSE!',
    subtitle: 'TRUE DAMAGE • IGNORES DEFENSE',
    requiredStatus: 'MARK',
    triggerElement: 'lux',
    damageMultiplier: 1.75,
    guardDamageMultiplier: 1.5,
    gaugeMultiplier: 1.0,
    radius: 3.8,
    knockbackForce: 2.5,
    microExplosionCount: 1,
    ignoresDefense: true,
    accentColor: '#e2e8f0',
  },
];

export interface ReactionEvaluationResult {
  triggered: boolean;
  reaction: ReactionSpec | null;
  consumedStatus: StatusEffectId | null;
  remainingStatuses: StatusEffectId[];
  appliedStatus: StatusEffectId | null;
}

/**
 * Checks whether an incoming element reacts with any active status on a target.
 * If a reaction triggers, the matching status is consumed; otherwise the incoming
 * element's status (if provided) is applied or refreshed.
 */
export function evaluateElementalReaction(
  activeStatuses: readonly StatusEffectId[],
  incomingElement: ElementId,
  incomingStatusToApply?: StatusEffectId
): ReactionEvaluationResult {
  for (let i = 0; i < REACTION_MATRIX.length; i++) {
    const spec = REACTION_MATRIX[i]!;
    if (
      spec.triggerElement === incomingElement &&
      activeStatuses.includes(spec.requiredStatus)
    ) {
      const remaining = activeStatuses.filter((s) => s !== spec.requiredStatus);
      return {
        triggered: true,
        reaction: spec,
        consumedStatus: spec.requiredStatus,
        remainingStatuses: remaining,
        appliedStatus: null,
      };
    }
  }

  const nextStatuses = [...activeStatuses];
  let applied: StatusEffectId | null = null;
  if (incomingStatusToApply) {
    applied = incomingStatusToApply;
    if (!nextStatuses.includes(incomingStatusToApply)) {
      nextStatuses.push(incomingStatusToApply);
    }
  }

  return {
    triggered: false,
    reaction: null,
    consumedStatus: null,
    remainingStatuses: nextStatuses,
    appliedStatus: applied,
  };
}

export function getReactionSpecById(id: ReactionId): ReactionSpec | undefined {
  return REACTION_MATRIX.find((spec) => spec.id === id);
}

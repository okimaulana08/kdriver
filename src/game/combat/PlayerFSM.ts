import type { PlayerStateId } from '../types/schema';

export interface AttackTimingSpec {
  readonly durationSec: number;
  readonly activeStartSec: number;
  readonly activeEndSec: number;
  readonly cancelWindowStartSec: number;
  readonly lungeSpeed: number;
  readonly minDotProduct: number;
}

export const DODGE_DURATION_SEC = 0.34;
export const DODGE_IFRAME_SEC = 0.25;
export const DODGE_COOLDOWN_SEC = 0.6;
export const DODGE_SPEED = 17.5;
export const HITSTUN_DURATION_SEC = 0.32;

export const FORM_SWITCH_DURATION_SEC = 0.2;
export const FORM_SWITCH_COOLDOWN_SEC = 1.2;
export const ELEMENT_SKILL_DURATION_SEC = 0.56;
export const ELEMENT_SKILL_ACTIVE_START_SEC = 0.16;
export const ELEMENT_SKILL_ACTIVE_END_SEC = 0.32;

export const RIDER_KICK_DURATION_SEC = 1.15;
export const RIDER_KICK_VAULT_END_SEC = 0.34;
export const RIDER_KICK_DIVE_END_SEC = 0.68;
export const RIDER_KICK_IMPACT_TIME_SEC = 0.64;
export const RIDER_KICK_COOLDOWN_SEC = 8.0;

export const HENSHIN_SUPER_DURATION_SEC = 1.0;
export const ULTIMATE_CINEMATIC_DURATION_SEC = 3.5;

const BASE_ATTACK_SPECS: Readonly<Record<1 | 2 | 3, AttackTimingSpec>> = {
  1: {
    durationSec: 0.44,
    activeStartSec: 0.11,
    activeEndSec: 0.25,
    cancelWindowStartSec: 0.23,
    lungeSpeed: 5.5,
    minDotProduct: 0.05,
  },
  2: {
    durationSec: 0.46,
    activeStartSec: 0.12,
    activeEndSec: 0.27,
    cancelWindowStartSec: 0.25,
    lungeSpeed: 6.2,
    minDotProduct: -0.05,
  },
  3: {
    durationSec: 0.62,
    activeStartSec: 0.18,
    activeEndSec: 0.36,
    cancelWindowStartSec: 0.46,
    lungeSpeed: 8.4,
    minDotProduct: -0.25, // Wide 3rd-hit cleave finisher
  },
};

export interface PlayerFSMInput {
  isMoving: boolean;
  wantsAttack: boolean;
  wantsDodge: boolean;
  wantsSkill?: boolean;
  wantsRiderKick?: boolean;
  wantsFormSwitch?: boolean;
  wantsHenshinSuper?: boolean;
  wantsUltimateFinisher?: boolean;
  attackSpeed: number;
}

export type PlayerIncomingHitOutcome = 'DAMAGED' | 'PERFECT_DODGE' | 'IGNORED';

/**
 * Pure Finite State Machine for PlayerRider:
 * IDLE, MOVE, ATTACK_1/2/3, ELEMENT_SKILL, FORM_SWITCH, DODGE,
 * HENSHIN_SUPER (1.0s invulnerable), ULTIMATE_CINEMATIC (3.5s invulnerable), HITSTUN, DEAD.
 * Zero Three.js/DOM dependencies so all transitions are unit-tested in Vitest.
 */
export class PlayerFSM {
  private currentState: PlayerStateId = 'IDLE';
  private stateElapsedSec = 0;
  private currentAttackSpeed = 1.0;
  private dodgeCooldownRemainingSec = 0;
  private formSwitchCooldownRemainingSec = 0;
  private riderKickCooldownRemainingSec = 0;
  private swingSequenceId = 0;
  private skillSequenceId = 0;
  private kickSequenceId = 0;
  private perfectDodgeTriggeredThisDodge = false;
  private dodgeIframeBonusSec = 0;

  public setDodgeIframeBonus(bonusSec: number): void {
    this.dodgeIframeBonusSec = Math.max(0, Math.min(0.12, bonusSec));
  }

  public get state(): PlayerStateId {
    return this.currentState;
  }

  public get stateTime(): number {
    return this.stateElapsedSec;
  }

  public get swingId(): number {
    return this.swingSequenceId;
  }

  public get skillId(): number {
    return this.skillSequenceId;
  }

  public get kickId(): number {
    return this.kickSequenceId;
  }

  public get dodgeCooldown(): number {
    return this.dodgeCooldownRemainingSec;
  }

  public get formSwitchCooldown(): number {
    return this.formSwitchCooldownRemainingSec;
  }

  public get riderKickCooldown(): number {
    return this.riderKickCooldownRemainingSec;
  }

  public get isAttacking(): boolean {
    return (
      this.currentState === 'ATTACK_1' ||
      this.currentState === 'ATTACK_2' ||
      this.currentState === 'ATTACK_3'
    );
  }

  public get isInCinematic(): boolean {
    return this.currentState === 'ULTIMATE_CINEMATIC';
  }

  public get isDead(): boolean {
    return this.currentState === 'DEAD';
  }

  public get comboStep(): 0 | 1 | 2 | 3 {
    if (this.currentState === 'ATTACK_1') return 1;
    if (this.currentState === 'ATTACK_2') return 2;
    if (this.currentState === 'ATTACK_3') return 3;
    return 0;
  }

  public get isInvulnerable(): boolean {
    if (
      this.currentState === 'HENSHIN_SUPER' ||
      this.currentState === 'ULTIMATE_CINEMATIC' ||
      this.currentState === 'DEAD'
    ) {
      return true;
    }
    if (this.currentState === 'RIDER_KICK' && this.stateElapsedSec <= 0.85) {
      return true;
    }
    return (
      this.currentState === 'DODGE' &&
      this.stateElapsedSec <= DODGE_IFRAME_SEC + this.dodgeIframeBonusSec
    );
  }

  public get isHitboxActive(): boolean {
    const step = this.comboStep;
    if (step === 0) return false;
    const spec = BASE_ATTACK_SPECS[step];
    const scaledElapsed = this.stateElapsedSec * this.currentAttackSpeed;
    return scaledElapsed >= spec.activeStartSec && scaledElapsed <= spec.activeEndSec;
  }

  public get isSkillHitboxActive(): boolean {
    return (
      this.currentState === 'ELEMENT_SKILL' &&
      this.stateElapsedSec >= ELEMENT_SKILL_ACTIVE_START_SEC &&
      this.stateElapsedSec <= ELEMENT_SKILL_ACTIVE_END_SEC
    );
  }

  public get normalizedStateProgress(): number {
    const duration = this.getCurrentStateDurationSec();
    if (duration <= 0) return 0;
    return Math.min(1, Math.max(0, this.stateElapsedSec / duration));
  }

  public getCurrentAttackSpec(): AttackTimingSpec | null {
    const step = this.comboStep;
    return step === 0 ? null : BASE_ATTACK_SPECS[step];
  }

  public canTransformNow(): boolean {
    return (
      this.currentState !== 'HENSHIN_SUPER' &&
      this.currentState !== 'ULTIMATE_CINEMATIC' &&
      this.currentState !== 'HITSTUN' &&
      this.currentState !== 'DEAD'
    );
  }

  public canDodgeNow(): boolean {
    return (
      this.dodgeCooldownRemainingSec <= 0 &&
      this.currentState !== 'DODGE' &&
      this.currentState !== 'HITSTUN' &&
      this.currentState !== 'HENSHIN_SUPER' &&
      this.currentState !== 'ULTIMATE_CINEMATIC' &&
      this.currentState !== 'DEAD'
    );
  }

  public canFormSwitchNow(): boolean {
    if (this.formSwitchCooldownRemainingSec > 0) return false;
    if (
      this.currentState === 'HITSTUN' ||
      this.currentState === 'FORM_SWITCH' ||
      this.currentState === 'HENSHIN_SUPER' ||
      this.currentState === 'ULTIMATE_CINEMATIC' ||
      this.currentState === 'DEAD'
    ) {
      return false;
    }
    if (this.currentState === 'ELEMENT_SKILL') {
      return this.stateElapsedSec >= ELEMENT_SKILL_ACTIVE_END_SEC;
    }
    return true;
  }

  public canRiderKickNow(): boolean {
    if (this.riderKickCooldownRemainingSec > 0) return false;
    return (
      this.currentState === 'IDLE' ||
      this.currentState === 'MOVE' ||
      this.isAttacking ||
      this.currentState === 'DODGE' ||
      this.currentState === 'FORM_SWITCH'
    );
  }

  public canCastSkillNow(): boolean {
    if (this.currentState === 'IDLE' || this.currentState === 'MOVE') {
      return true;
    }
    if (this.isAttacking) {
      const spec = BASE_ATTACK_SPECS[this.comboStep as 1 | 2 | 3];
      return this.stateElapsedSec * this.currentAttackSpeed >= spec.cancelWindowStartSec;
    }
    if (this.currentState === 'FORM_SWITCH') {
      return this.stateElapsedSec >= FORM_SWITCH_DURATION_SEC * 0.55;
    }
    return false;
  }

  public canAcceptAttackNow(): boolean {
    if (this.currentState === 'IDLE' || this.currentState === 'MOVE') {
      return true;
    }
    if (this.currentState === 'ATTACK_1' || this.currentState === 'ATTACK_2') {
      const spec = BASE_ATTACK_SPECS[this.comboStep as 1 | 2];
      return this.stateElapsedSec * this.currentAttackSpeed >= spec.cancelWindowStartSec;
    }
    if (this.currentState === 'DODGE') {
      return this.stateElapsedSec >= DODGE_DURATION_SEC * 0.72;
    }
    if (this.currentState === 'FORM_SWITCH') {
      return this.stateElapsedSec >= FORM_SWITCH_DURATION_SEC * 0.6;
    }
    return false;
  }

  public update(dt: number, input: PlayerFSMInput): PlayerStateId {
    if (this.currentState === 'DEAD') {
      this.stateElapsedSec += dt;
      return this.currentState;
    }

    if (this.dodgeCooldownRemainingSec > 0) {
      this.dodgeCooldownRemainingSec = Math.max(0, this.dodgeCooldownRemainingSec - dt);
    }
    if (this.formSwitchCooldownRemainingSec > 0) {
      this.formSwitchCooldownRemainingSec = Math.max(0, this.formSwitchCooldownRemainingSec - dt);
    }
    if (this.riderKickCooldownRemainingSec > 0) {
      this.riderKickCooldownRemainingSec = Math.max(0, this.riderKickCooldownRemainingSec - dt);
    }

    this.stateElapsedSec += dt;

    // 1. Ultimate Finisher & Super Henshin have top action priority (invulnerable)
    if (input.wantsUltimateFinisher && this.canTransformNow()) {
      this.enterState('ULTIMATE_CINEMATIC', input.attackSpeed);
      return this.currentState;
    }
    if (input.wantsHenshinSuper && this.canTransformNow()) {
      this.enterState('HENSHIN_SUPER', input.attackSpeed);
      return this.currentState;
    }

    // 2. Dodge cancel (defensive priority)
    if (input.wantsDodge && this.canDodgeNow()) {
      this.enterState('DODGE', input.attackSpeed);
      return this.currentState;
    }

    // 2.5. Active Flying Rider Kick ([SPACE] / [X]) — can cancel combos & dodge!
    if (input.wantsRiderKick && this.canRiderKickNow()) {
      this.enterState('RIDER_KICK', input.attackSpeed);
      return this.currentState;
    }

    // 3. Form Switch animation cancel (1/2/3)
    if (input.wantsFormSwitch && this.canFormSwitchNow()) {
      this.enterState('FORM_SWITCH', input.attackSpeed);
      return this.currentState;
    }

    // 4. Element Skill (Q)
    if (input.wantsSkill && this.canCastSkillNow()) {
      this.enterState('ELEMENT_SKILL', input.attackSpeed);
      return this.currentState;
    }

    // 5. Attack / combo chain transition
    if (input.wantsAttack && this.canAcceptAttackNow()) {
      if (this.currentState === 'ATTACK_1') {
        this.enterState('ATTACK_2', input.attackSpeed);
      } else if (this.currentState === 'ATTACK_2') {
        this.enterState('ATTACK_3', input.attackSpeed);
      } else {
        this.enterState('ATTACK_1', input.attackSpeed);
      }
      return this.currentState;
    }

    // 6. Timed state completion
    const duration = this.getCurrentStateDurationSec();
    if (duration > 0 && this.stateElapsedSec >= duration) {
      this.enterState(input.isMoving ? 'MOVE' : 'IDLE', input.attackSpeed);
      return this.currentState;
    }

    // 7. Locomotion transitions between IDLE and MOVE
    if (this.currentState === 'IDLE' && input.isMoving) {
      this.enterState('MOVE', input.attackSpeed);
    } else if (this.currentState === 'MOVE' && !input.isMoving) {
      this.enterState('IDLE', input.attackSpeed);
    }

    return this.currentState;
  }

  /**
   * Evaluates an incoming enemy attack against invulnerability, Dodge i-frames, and Super Armor.
   */
  public receiveIncomingHit(hasLightSuperArmor = false, isHeavyAttack = false): PlayerIncomingHitOutcome {
    if (
      this.currentState === 'HENSHIN_SUPER' ||
      this.currentState === 'ULTIMATE_CINEMATIC' ||
      this.currentState === 'DEAD' ||
      (this.currentState === 'RIDER_KICK' && this.stateElapsedSec <= 0.85)
    ) {
      return 'IGNORED';
    }

    if (
      this.currentState === 'DODGE' &&
      this.stateElapsedSec <= DODGE_IFRAME_SEC + this.dodgeIframeBonusSec
    ) {
      if (!this.perfectDodgeTriggeredThisDodge) {
        this.perfectDodgeTriggeredThisDodge = true;
        return 'PERFECT_DODGE';
      }
      return 'IGNORED';
    }

    // Light Super Armor in Super Form prevents flinching during attacks from non-heavy blows
    if (!(hasLightSuperArmor && !isHeavyAttack && (this.isAttacking || this.currentState === 'ELEMENT_SKILL'))) {
      this.enterState('HITSTUN', this.currentAttackSpeed);
    }
    return 'DAMAGED';
  }

  public forceDead(): void {
    this.currentState = 'DEAD';
    this.stateElapsedSec = 0;
  }

  public reset(): void {
    this.currentState = 'IDLE';
    this.stateElapsedSec = 0;
    this.currentAttackSpeed = 1.0;
    this.dodgeCooldownRemainingSec = 0;
    this.formSwitchCooldownRemainingSec = 0;
    this.riderKickCooldownRemainingSec = 0;
    this.swingSequenceId = 0;
    this.skillSequenceId = 0;
    this.kickSequenceId = 0;
    this.perfectDodgeTriggeredThisDodge = false;
  }

  private enterState(next: PlayerStateId, attackSpeed: number): void {
    this.currentState = next;
    this.stateElapsedSec = 0;
    this.currentAttackSpeed = Math.max(0.25, attackSpeed);

    if (next === 'ATTACK_1' || next === 'ATTACK_2' || next === 'ATTACK_3') {
      this.swingSequenceId++;
    } else if (next === 'ELEMENT_SKILL') {
      this.skillSequenceId++;
    } else if (next === 'RIDER_KICK') {
      this.kickSequenceId++;
      this.riderKickCooldownRemainingSec = RIDER_KICK_COOLDOWN_SEC;
    } else if (next === 'FORM_SWITCH') {
      this.formSwitchCooldownRemainingSec = FORM_SWITCH_COOLDOWN_SEC;
    } else if (next === 'DODGE') {
      this.dodgeCooldownRemainingSec = DODGE_COOLDOWN_SEC;
      this.perfectDodgeTriggeredThisDodge = false;
    }
  }

  private getCurrentStateDurationSec(): number {
    switch (this.currentState) {
      case 'ATTACK_1':
        return BASE_ATTACK_SPECS[1].durationSec / this.currentAttackSpeed;
      case 'ATTACK_2':
        return BASE_ATTACK_SPECS[2].durationSec / this.currentAttackSpeed;
      case 'ATTACK_3':
        return BASE_ATTACK_SPECS[3].durationSec / this.currentAttackSpeed;
      case 'ELEMENT_SKILL':
        return ELEMENT_SKILL_DURATION_SEC;
      case 'RIDER_KICK':
        return RIDER_KICK_DURATION_SEC;
      case 'FORM_SWITCH':
        return FORM_SWITCH_DURATION_SEC;
      case 'DODGE':
        return DODGE_DURATION_SEC;
      case 'HENSHIN_SUPER':
        return HENSHIN_SUPER_DURATION_SEC;
      case 'ULTIMATE_CINEMATIC':
        return ULTIMATE_CINEMATIC_DURATION_SEC;
      case 'HITSTUN':
        return HITSTUN_DURATION_SEC;
      default:
        return 0;
    }
  }
}

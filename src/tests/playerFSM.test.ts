import { describe, expect, it } from 'vitest';
import {
  DODGE_COOLDOWN_SEC,
  DODGE_DURATION_SEC,
  DODGE_IFRAME_SEC,
  ELEMENT_SKILL_ACTIVE_START_SEC,
  ELEMENT_SKILL_DURATION_SEC,
  FORM_SWITCH_COOLDOWN_SEC,
  FORM_SWITCH_DURATION_SEC,
  HENSHIN_SUPER_DURATION_SEC,
  HITSTUN_DURATION_SEC,
  PlayerFSM,
  ULTIMATE_CINEMATIC_DURATION_SEC,
} from '../game/combat/PlayerFSM';

describe('PlayerFSM (3-Hit Combo, Dodge Cancel, i-Frames & Perfect Dodge)', () => {
  it('chains IDLE -> ATTACK_1 -> ATTACK_2 -> ATTACK_3 cleanly within combo cancel windows', () => {
    const fsm = new PlayerFSM();
    expect(fsm.state).toBe('IDLE');

    // Start ATTACK_1
    fsm.update(0.016, { isMoving: false, wantsAttack: true, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.state).toBe('ATTACK_1');
    const swing1Id = fsm.swingId;

    // Early attack input at 0.12s (inside active hitbox [0.11, 0.25], before cancel window 0.23s)
    // must NOT prematurely skip swing 1
    fsm.update(0.12, { isMoving: false, wantsAttack: true, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.state).toBe('ATTACK_1');
    expect(fsm.isHitboxActive).toBe(true);

    // Advance into cancel window (0.12 + 0.12 = 0.24s >= 0.23s) and trigger ATTACK_2
    fsm.update(0.12, { isMoving: false, wantsAttack: true, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.state).toBe('ATTACK_2');
    expect(fsm.swingId).toBe(swing1Id + 1);

    // Advance into ATTACK_2 cancel window (~0.26s) and trigger ATTACK_3
    fsm.update(0.26, { isMoving: false, wantsAttack: true, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.state).toBe('ATTACK_3');
    expect(fsm.swingId).toBe(swing1Id + 2);

    // Complete ATTACK_3 recovery -> returns to IDLE
    fsm.update(0.7, { isMoving: false, wantsAttack: false, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.state).toBe('IDLE');
  });

  it('allows Dodge to cancel attacks and triggers PERFECT_DODGE during 0.25s i-frames', () => {
    const fsm = new PlayerFSM();

    // Enter ATTACK_1 then immediately cancel into DODGE
    fsm.update(0.016, { isMoving: false, wantsAttack: true, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.state).toBe('ATTACK_1');

    fsm.update(0.05, { isMoving: true, wantsAttack: false, wantsDodge: true, attackSpeed: 1.0 });
    expect(fsm.state).toBe('DODGE');
    expect(fsm.dodgeCooldown).toBeCloseTo(DODGE_COOLDOWN_SEC, 5);
    expect(fsm.isInvulnerable).toBe(true);

    // Enemy hit at 0.12s (inside 0.25s i-frame window) -> PERFECT_DODGE!
    fsm.update(0.12, { isMoving: true, wantsAttack: false, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.receiveIncomingHit()).toBe('PERFECT_DODGE');
    // Second hit during same dodge i-frames is IGNORED (no double trigger)
    expect(fsm.receiveIncomingHit()).toBe('IGNORED');

    // Advance past i-frame window (0.12 + 0.16 = 0.28s > 0.25s, still inside 0.34s dodge)
    fsm.update(0.16, { isMoving: true, wantsAttack: false, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.isInvulnerable).toBe(false);

    // Getting hit outside i-frames causes DAMAGED -> HITSTUN
    expect(fsm.receiveIncomingHit()).toBe('DAMAGED');
    expect(fsm.state).toBe('HITSTUN');

    // After HITSTUN duration finishes, returns to IDLE
    fsm.update(HITSTUN_DURATION_SEC + 0.02, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('IDLE');
  });

  it('enforces dodge cooldown after dodge finishes', () => {
    const fsm = new PlayerFSM();
    fsm.update(0.016, { isMoving: true, wantsAttack: false, wantsDodge: true, attackSpeed: 1.0 });
    expect(fsm.state).toBe('DODGE');
    expect(DODGE_IFRAME_SEC).toBe(0.25);

    // Finish dodge duration (0.34s), cooldown still remaining (~0.26s)
    fsm.update(DODGE_DURATION_SEC + 0.01, {
      isMoving: true,
      wantsAttack: false,
      wantsDodge: true,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('MOVE');
    expect(fsm.canDodgeNow()).toBe(false);

    // Wait out remaining cooldown
    fsm.update(0.3, { isMoving: true, wantsAttack: false, wantsDodge: true, attackSpeed: 1.0 });
    expect(fsm.state).toBe('DODGE');
  });

  it('supports FORM_SWITCH animation cancel out of attacks with 1.2s cooldown and ELEMENT_SKILL active window', () => {
    const fsm = new PlayerFSM();

    // Start ATTACK_1, then immediately animation-cancel into FORM_SWITCH
    fsm.update(0.016, { isMoving: false, wantsAttack: true, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.state).toBe('ATTACK_1');

    fsm.update(0.08, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      wantsFormSwitch: true,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('FORM_SWITCH');
    expect(fsm.formSwitchCooldown).toBeCloseTo(FORM_SWITCH_COOLDOWN_SEC, 5);
    expect(fsm.canFormSwitchNow()).toBe(false);

    // Finish FORM_SWITCH (0.2s) with no follow-up input -> returns to IDLE
    fsm.update(FORM_SWITCH_DURATION_SEC + 0.01, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      wantsSkill: false,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('IDLE');

    fsm.update(0.016, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      wantsSkill: true,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('ELEMENT_SKILL');
    expect(fsm.isSkillHitboxActive).toBe(false);

    // Advance into skill active frame window
    fsm.update(ELEMENT_SKILL_ACTIVE_START_SEC + 0.02, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      attackSpeed: 1.0,
    });
    expect(fsm.isSkillHitboxActive).toBe(true);

    // Finish skill -> returns to IDLE
    fsm.update(ELEMENT_SKILL_DURATION_SEC, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('IDLE');
  });

  it('handles HENSHIN_SUPER (1.0s invuln), Super Armor, ULTIMATE_CINEMATIC (3.5s invuln), and DEAD', () => {
    const fsm = new PlayerFSM();

    // Activate HENSHIN_SUPER
    fsm.update(0.016, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      wantsHenshinSuper: true,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('HENSHIN_SUPER');
    expect(fsm.isInvulnerable).toBe(true);
    expect(fsm.receiveIncomingHit()).toBe('IGNORED');

    // Finish 1.0s Henshin -> IDLE
    fsm.update(HENSHIN_SUPER_DURATION_SEC + 0.01, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('IDLE');

    // Light Super Armor resists hitstun while attacking non-heavy hits
    fsm.update(0.016, { isMoving: false, wantsAttack: true, wantsDodge: false, attackSpeed: 1.0 });
    expect(fsm.state).toBe('ATTACK_1');
    expect(fsm.receiveIncomingHit(true, false)).toBe('DAMAGED');
    expect(fsm.state).toBe('ATTACK_1'); // Did NOT flinch into HITSTUN!

    // Activate ULTIMATE_CINEMATIC (3.5s invulnerable)
    fsm.update(0.016, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      wantsUltimateFinisher: true,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('ULTIMATE_CINEMATIC');
    expect(fsm.isInCinematic).toBe(true);
    expect(fsm.isInvulnerable).toBe(true);
    expect(fsm.receiveIncomingHit()).toBe('IGNORED');

    fsm.update(ULTIMATE_CINEMATIC_DURATION_SEC + 0.02, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      attackSpeed: 1.0,
    });
    expect(fsm.state).toBe('IDLE');

    // DEAD state locks transitions until reset
    fsm.forceDead();
    expect(fsm.isDead).toBe(true);
    fsm.update(0.1, { isMoving: true, wantsAttack: true, wantsDodge: true, attackSpeed: 1.0 });
    expect(fsm.state).toBe('DEAD');
  });
});

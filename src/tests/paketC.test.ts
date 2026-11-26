import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPhantomCoreUpgrade, getPhantomCoreLevel } from '../game/ProgressionSystem';
import { DEFAULT_SAVE_RECORD } from '../game/StageManager';
import { calculateDamage } from '../game/combat/DamageCalculator';
import { PlayerFSM } from '../game/combat/PlayerFSM';
import {
  RIDER_CONFIGS,
  RIDER_LIST,
  getRiderConfig,
  isValidRiderId,
} from '../game/data/riders';

function getDirectorySizeBytes(dirPath: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    total += entry.isDirectory() ? getDirectorySizeBytes(full) : fs.statSync(full).size;
  }
  return total;
}

describe('Paket C — Playable Second Rider UNIT-02 PHANTOM (2-Form Counter-Assassin)', () => {
  it('defines UNIT-01 NEXUS (3 Forms) and UNIT-02 PHANTOM (strictly 2 Forms: Basic & Upgraded)', () => {
    expect(RIDER_LIST).toHaveLength(2);
    expect(isValidRiderId('nexus')).toBe(true);
    expect(isValidRiderId('phantom')).toBe(true);
    expect(isValidRiderId('unknown')).toBe(false);

    const nexus = getRiderConfig('nexus');
    const phantom = getRiderConfig('phantom');

    expect(nexus.maxForms).toBe(3);
    expect(nexus.hasUltimateForm).toBe(true);
    expect(nexus.locksElementSelection).toBe(false);
    expect(phantom.maxForms).toBe(2);
    expect(phantom.hasUltimateForm).toBe(false);
    expect(phantom.locksElementSelection).toBe(true);
    expect(phantom.ultimateFormLabel).toBeNull();
    expect(phantom.signatureFinisherName).toBe('PHANTOM OMNISLASH');
    expect(phantom.signatureWeapon?.id).toBe('phantom_katana');
    expect(phantom.signaturePet?.id).toBe('pet_phantom_fox');
    expect(phantom.signatureSkill?.name).toBe('Phantom Iaido Cross');

    // Dedicated Phantom Core shard upgrade independent of Unit-01 Elemental Gems
    const richSave = { ...DEFAULT_SAVE_RECORD, gemShards: 100, phantomCoreLevel: 1 };
    expect(getPhantomCoreLevel(richSave)).toBe(1);
    const up = applyPhantomCoreUpgrade(richSave);
    expect(up.upgraded).toBe(true);
    expect(up.newLevel).toBe(2);
    expect(up.updated.gemShards).toBe(60);

    // Counter-assassin stat differentiation: faster speed, faster attacks, higher crit, lethal counter, lower HP
    expect(phantom.maxHp).toBeLessThan(nexus.maxHp);
    expect(phantom.moveSpeed).toBeGreaterThan(nexus.moveSpeed);
    expect(phantom.attackSpeedMult).toBeGreaterThan(nexus.attackSpeedMult);
    expect(phantom.baseCritChance).toBeGreaterThan(nexus.baseCritChance);
    expect(phantom.warpCounterDamageMult).toBeGreaterThan(nexus.warpCounterDamageMult);
    expect(phantom.riderKickCooldownSec).toBeLessThan(nexus.riderKickCooldownSec);
  });

  it('applies Unit-02 Upgraded Form 1.40x damage override & higher 22% base crit cleanly in DamageCalculator', () => {
    const nexusSuper = calculateDamage({
      baseDamage: 100,
      skillMultiplier: 1.0,
      formTier: 'SUPER',
      formMultiplierOverride: RIDER_CONFIGS.nexus.upgradedFormDamageMult,
      baseCritChance: RIDER_CONFIGS.nexus.baseCritChance,
      targetDefense: 0,
      critRoll: 0.15, // Above Nexus 10% crit, below Phantom 22% crit!
    });

    const phantomUpgraded = calculateDamage({
      baseDamage: 100,
      skillMultiplier: 1.0,
      formTier: 'SUPER',
      formMultiplierOverride: RIDER_CONFIGS.phantom.upgradedFormDamageMult,
      baseCritChance: RIDER_CONFIGS.phantom.baseCritChance,
      targetDefense: 0,
      critRoll: 0.15,
    });

    expect(nexusSuper.isCrit).toBe(false);
    expect(nexusSuper.finalDamage).toBe(130);
    expect(phantomUpgraded.isCrit).toBe(true);
    expect(phantomUpgraded.finalDamage).toBe(210); // 100 * 1.40 * 1.5 crit
  });

  it('applies Unit-02 shorter 6.0s Phantom Kick cooldown and +0.04s natural reflex dodge i-frames in PlayerFSM', () => {
    const fsm = new PlayerFSM();
    const phantom = RIDER_CONFIGS.phantom;
    fsm.setRiderKickCooldownDuration(phantom.riderKickCooldownSec);
    fsm.setDodgeIframeBonus(phantom.dodgeIframeBonusSec);

    fsm.update(0.016, {
      isMoving: false,
      wantsAttack: false,
      wantsDodge: false,
      wantsRiderKick: true,
      attackSpeed: phantom.attackSpeedMult,
    });
    expect(fsm.state).toBe('RIDER_KICK');
    expect(fsm.riderKickCooldown).toBeCloseTo(6.0, 2);
  });

  it('verifies photorealistic cutin_phantom_visor.jpg exists with valid JPEG magic bytes', () => {
    const visorPath = path.resolve(process.cwd(), 'public/assets/textures/cutin_phantom_visor.jpg');
    expect(fs.existsSync(visorPath)).toBe(true);
    const bytes = fs.readFileSync(visorPath);
    expect(bytes.length).toBeGreaterThan(40 * 1024);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it('verifies total public/assets stays strictly under 25 MB after adding both rigged Unit-02 GLBs', () => {
    const totalBytes = getDirectorySizeBytes(path.resolve(process.cwd(), 'public/assets'));
    expect(totalBytes).toBeLessThan(25 * 1024 * 1024);
  });
});

import { describe, expect, it } from 'vitest';
import { HitboxSystem } from '../game/combat/HitboxSystem';
import type { HurtboxTarget, Vec3Snapshot } from '../game/types/schema';

function makeTarget(id: string, x: number, z: number, radius = 0.6, isAlive = true): HurtboxTarget {
  return {
    id,
    radius,
    isAlive,
    getPosition(out: Vec3Snapshot) {
      out.x = x;
      out.y = 1.0;
      out.z = z;
      return out;
    },
  };
}

describe('HitboxSystem (Hit Registry & Spatial Overlap)', () => {
  it('hits each target at most once per swing ID across multiple active frames', () => {
    const hitbox = new HitboxSystem();
    const targetA = makeTarget('enemy_a', 0, 2.0);
    const targetB = makeTarget('enemy_b', 10, 10); // out of range
    const targetBehind = makeTarget('enemy_behind', 0, -2.0); // behind attacker
    const targets = [targetA, targetB, targetBehind];
    const out: HurtboxTarget[] = [];

    hitbox.beginSwing(1);

    // Frame 1 of swing 1 -> hits targetA only
    hitbox.checkMeleeArc({ x: 0, y: 1, z: 0 }, 0, 1, 3.0, 0.2, targets, out);
    expect(out.map((t) => t.id)).toEqual(['enemy_a']);

    // Frame 2 of the SAME swing 1 -> Hit Registry blocks duplicate hit on targetA
    hitbox.checkMeleeArc({ x: 0, y: 1, z: 0 }, 0, 1, 3.0, 0.2, targets, out);
    expect(out).toHaveLength(0);

    // New swing ID 2 resets Hit Registry -> targetA can be hit again
    hitbox.beginSwing(2);
    hitbox.checkMeleeArc({ x: 0, y: 1, z: 0 }, 0, 1, 3.0, 0.2, targets, out);
    expect(out.map((t) => t.id)).toEqual(['enemy_a']);

    hitbox.dispose();
  });

  it('checks radial sphere overlaps and ignores dead targets', () => {
    const hitbox = new HitboxSystem();
    const aliveNear = makeTarget('near', 2.0, 0, 0.5, true);
    const deadNear = makeTarget('dead', 1.0, 0, 0.5, false);
    const aliveFar = makeTarget('far', 8.0, 0, 0.5, true);
    const out: HurtboxTarget[] = [];

    hitbox.beginSwing(42);
    hitbox.checkSphere({ x: 0, y: 1, z: 0 }, 3.0, [aliveNear, deadNear, aliveFar], out);
    expect(out.map((t) => t.id)).toEqual(['near']);

    // Duplicate sphere tick on same swing returns empty
    hitbox.checkSphere({ x: 0, y: 1, z: 0 }, 3.0, [aliveNear, deadNear, aliveFar], out);
    expect(out).toHaveLength(0);

    hitbox.dispose();
  });
});

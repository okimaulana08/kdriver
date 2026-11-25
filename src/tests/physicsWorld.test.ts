import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../engine/Loop';
import {
  ARENA_RADIUS,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_SPAWN_Y,
  PhysicsWorld,
} from '../engine/PhysicsWorld';

describe('PhysicsWorld (Rapier3D Octagonal Arena & Character Controller)', () => {
  it('spawns player capsule grounded at arena center and blocks traversal through walls', async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    expect(physics.isReady).toBe(true);

    const pos = new THREE.Vector3();
    physics.getPlayerPosition(pos);
    expect(pos.x).toBeCloseTo(0, 3);
    expect(pos.y).toBeCloseTo(PLAYER_SPAWN_Y, 3);
    expect(pos.z).toBeCloseTo(0, 3);

    // Run straight along +Z for 3 seconds at 12 m/s (36m attempted > 16m arena radius)
    let touchedWall = false;
    let lastGrounded = false;
    for (let i = 0; i < 180; i++) {
      const res = physics.stepPlayerMovement(0, -18 * FIXED_DT, 12 * FIXED_DT, FIXED_DT, pos);
      if (res.isTouchingWall) touchedWall = true;
      lastGrounded = res.isGrounded;
    }

    expect(lastGrounded).toBe(true);
    expect(touchedWall).toBe(true);
    // Capsule center must stay strictly inside the octagonal wall apothem minus capsule radius
    expect(pos.z).toBeLessThanOrEqual(ARENA_RADIUS - PLAYER_CAPSULE_RADIUS + 0.05);
    expect(pos.z).toBeGreaterThan(ARENA_RADIUS - 1.2);
    expect(pos.y).toBeGreaterThan(0.8);

    // Also test a diagonal direction (45 deg -> octagonal angled wall)
    let touchedDiagonalWall = false;
    for (let i = 0; i < 240; i++) {
      const res = physics.stepPlayerMovement(
        10 * Math.SQRT1_2 * FIXED_DT,
        -18 * FIXED_DT,
        10 * Math.SQRT1_2 * FIXED_DT,
        FIXED_DT,
        pos
      );
      if (res.isTouchingWall) touchedDiagonalWall = true;
    }

    expect(touchedDiagonalWall).toBe(true);
    // Verify player remains strictly inside all 8 octagonal wall half-spaces and circumradius.
    const circumradius = ARENA_RADIUS / Math.cos(Math.PI / 8);
    const distFromCenter = Math.hypot(pos.x, pos.z);
    expect(distFromCenter).toBeLessThanOrEqual(circumradius - PLAYER_CAPSULE_RADIUS + 0.05);
    for (let i = 0; i < 8; i++) {
      const theta = (i * Math.PI * 2) / 8;
      const projection = pos.x * Math.sin(theta) + pos.z * Math.cos(theta);
      expect(projection).toBeLessThanOrEqual(ARENA_RADIUS - PLAYER_CAPSULE_RADIUS + 0.05);
    }

    physics.dispose();
    expect(physics.isReady).toBe(false);
  });

  it('survives concurrent StrictMode double-mount init + cylinder obstacle stepping cleanly', async () => {
    const mount1 = new PhysicsWorld();
    const mount2 = new PhysicsWorld();

    const p1 = mount1.init();
    mount1.dispose(); // Simulates React StrictMode immediate cleanup while init is in-flight
    const p2 = mount2.init();

    await Promise.all([p1, p2]);
    expect(mount1.isReady).toBe(false);
    expect(mount2.isReady).toBe(true);

    mount2.addStaticCylinderObstacle(0, -5.5, 0.72, 2.3);

    const pos = new THREE.Vector3();
    let touchedObstacle = false;
    for (let i = 0; i < 60; i++) {
      const res = mount2.stepPlayerMovement(0, -18 * FIXED_DT, -8.8 * FIXED_DT, FIXED_DT, pos);
      if (res.isTouchingWall) touchedObstacle = true;
      expect(pos.y).toBeGreaterThanOrEqual(0.9);
      expect(pos.y).toBeLessThanOrEqual(1.1);
    }

    // Should stop cleanly against the dummy cylinder obstacle around z = -5.5 + 0.72 + 0.4 = -4.38
    expect(touchedObstacle).toBe(true);
    expect(pos.z).toBeGreaterThan(-4.6);
    expect(pos.z).toBeLessThan(-3.5);

    mount2.dispose();
  });
});

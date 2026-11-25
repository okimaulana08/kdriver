import { describe, expect, it, vi } from 'vitest';
import { FIXED_DT, Loop, MAX_SUBSTEPS } from '../engine/Loop';

describe('Loop (Fixed Timestep, Hit-Stop & Time-Scale)', () => {
  it('executes exact 60Hz fixed steps and passes interpolation alpha', () => {
    const fixedUpdates: number[] = [];
    const renderAlphas: number[] = [];

    const loop = new Loop({
      onFixedUpdate: (dt) => fixedUpdates.push(dt),
      onRender: (alpha) => renderAlphas.push(alpha),
    });

    // Advance by 2.5 fixed steps -> should run 2 fixed updates and leave alpha ~ 0.5
    const steps = loop.stepFrame(FIXED_DT * 2.5);
    expect(steps).toBe(2);
    expect(fixedUpdates).toHaveLength(2);
    expect(fixedUpdates[0]).toBeCloseTo(FIXED_DT, 6);
    expect(renderAlphas[0]).toBeCloseTo(0.5, 5);

    // Next half-step completes the remaining 0.5 -> triggers 1 fixed update
    const nextSteps = loop.stepFrame(FIXED_DT * 0.5);
    expect(nextSteps).toBe(1);
    expect(fixedUpdates).toHaveLength(3);

    loop.dispose();
  });

  it('clamps huge frame delta spikes to prevent spiral of death', () => {
    let fixedCount = 0;
    const loop = new Loop({
      onFixedUpdate: () => {
        fixedCount++;
      },
      onRender: () => {},
    });

    const steps = loop.stepFrame(5.0); // 5 second tab pause
    expect(steps).toBeLessThanOrEqual(MAX_SUBSTEPS);
    expect(fixedCount).toBe(steps);

    loop.dispose();
  });

  it('freezes fixed simulation during hit-stop while continuing to render', () => {
    const onFixedUpdate = vi.fn();
    const onRender = vi.fn();

    const loop = new Loop({ onFixedUpdate, onRender });
    loop.triggerHitStop(0.075); // 75ms heavy hit-stop

    expect(loop.isHitStopActive).toBe(true);

    // 50ms passes -> still in hit-stop, 0 fixed steps, 1 render call
    expect(loop.stepFrame(0.05)).toBe(0);
    expect(onFixedUpdate).not.toHaveBeenCalled();
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(loop.isHitStopActive).toBe(true);

    // Another 50ms passes -> 25ms finishes hit-stop, remaining 25ms runs 1 fixed step (16.67ms)
    expect(loop.stepFrame(0.05)).toBe(1);
    expect(onFixedUpdate).toHaveBeenCalledTimes(1);
    expect(loop.isHitStopActive).toBe(false);

    loop.dispose();
  });

  it('scales simulation time for Perfect Dodge slow-motion and auto-restores to 1.0x', () => {
    const onFixedUpdate = vi.fn();
    const loop = new Loop({
      onFixedUpdate,
      onRender: () => {},
    });

    // Perfect Dodge: 0.25x time-scale for 0.6s real time
    loop.setTimeScale(0.25, 0.6);
    expect(loop.getTimeScale()).toBeCloseTo(0.25, 5);

    // 0.04s real time * 0.25 = 0.01s sim time (< 16.67ms -> 0 steps)
    expect(loop.stepFrame(0.04)).toBe(0);
    // Another 0.04s real time -> total 0.02s sim time -> 1 fixed step
    expect(loop.stepFrame(0.04)).toBe(1);

    // Advance real time past 0.6s total duration (in 0.1s chunks)
    for (let i = 0; i < 6; i++) {
      loop.stepFrame(0.1);
    }

    expect(loop.getTimeScale()).toBe(1);
    loop.dispose();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { INPUT_BUFFER_WINDOW_MS, InputManager, type MoveInput2D } from '../engine/InputManager';

describe('InputManager (WASD Normalization & 150ms Input Buffer)', () => {
  it('normalizes diagonal WASD movement into reusable vector without allocation', () => {
    let clock = 1000;
    const input = new InputManager({ now: () => clock });
    const move: MoveInput2D = { x: 0, z: 0 };

    input.setKeyState('KeyW', true);
    input.setKeyState('KeyD', true);

    const result = input.getMoveInput(move);
    expect(result).toBe(move); // Same object reference (zero allocation)
    expect(Math.hypot(move.x, move.z)).toBeCloseTo(1, 5);
    expect(move.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(move.z).toBeCloseTo(Math.SQRT1_2, 5);

    // Cancelling opposite keys produces zero vector
    input.setKeyState('KeyA', true);
    input.getMoveInput(move);
    expect(move.x).toBe(0);
    expect(move.z).toBe(1);

    clock += 10;
    input.dispose();
  });

  it('buffers actions within 150ms window and expires stale inputs', () => {
    let clock = 500;
    const onBuffered = vi.fn();
    const input = new InputManager({
      now: () => clock,
      onActionBuffered: onBuffered,
    });

    input.bufferAction('ATTACK');
    expect(onBuffered).toHaveBeenCalledWith('ATTACK', 500);

    // Still valid at 140ms
    clock = 640;
    expect(input.hasBufferedAction('ATTACK')).toBe(true);
    expect(input.consumeBufferedAction('ATTACK')).toBe(true);
    // Consumed once -> cannot be consumed twice
    expect(input.consumeBufferedAction('ATTACK')).toBe(false);

    // Buffer a dodge via Shift key and let it expire past 150ms
    input.setKeyState('ShiftLeft', true, clock);
    expect(input.hasBufferedAction('DODGE', clock + INPUT_BUFFER_WINDOW_MS)).toBe(true);
    expect(input.consumeBufferedAction('DODGE', clock + INPUT_BUFFER_WINDOW_MS + 1)).toBe(false);

    input.dispose();
  });

  it('maps element switch and combat keys to their expected InputActions', () => {
    let clock = 100;
    const input = new InputManager({ now: () => clock });

    input.setKeyState('Digit1', true);
    input.setKeyState('KeyQ', true);
    input.setKeyState('KeyE', true);
    input.setKeyState('KeyF', true);
    input.setKeyState('Tab', true);

    expect(input.consumeBufferedAction('SWITCH_1')).toBe(true);
    expect(input.consumeBufferedAction('SKILL')).toBe(true);
    expect(input.consumeBufferedAction('PET')).toBe(true);
    expect(input.consumeBufferedAction('HENSHIN')).toBe(true);
    expect(input.consumeBufferedAction('LOCK_ON')).toBe(true);

    clock += 50;
    input.dispose();
  });
});

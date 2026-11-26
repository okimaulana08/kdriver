import type { InputAction } from '../game/types/schema';

export const INPUT_BUFFER_WINDOW_MS = 150;

export interface MoveInput2D {
  x: number;
  z: number;
}

export interface LookDelta2D {
  dx: number;
  dy: number;
}

export interface GamepadButtonLike {
  pressed: boolean;
  value?: number;
}

export interface GamepadSnapshotLike {
  id: string;
  axes: readonly number[];
  buttons: readonly GamepadButtonLike[];
}

export interface InputManagerOptions {
  targetElement?: HTMLElement | null;
  bufferWindowMs?: number;
  now?: () => number;
  onPointerLockChange?: (locked: boolean) => void;
  onActionBuffered?: (action: InputAction, timestampMs: number) => void;
  onActiveKeysChange?: (keys: string[]) => void;
  onGamepadChange?: (connected: boolean, name: string | null) => void;
  onDebugToggle?: () => void;
  onSpecialKey?: (code: string) => void;
  onUserGesture?: () => void;
}

const GAMEPAD_STICK_DEADZONE = 0.18;
const GAMEPAD_LOOK_SENSITIVITY = 720;

// Standard Gamepad Mapping (Xbox / DualSense / Switch Pro / XInput)
const GAMEPAD_BUTTON_ACTIONS: readonly (readonly [number, InputAction])[] = [
  [0, 'DODGE'], // A / Cross
  [1, 'DODGE'], // B / Circle
  [2, 'ATTACK'], // X / Square
  [3, 'SKILL'], // Y / Triangle
  [4, 'PET'], // LB / L1
  [5, 'RIDER_KICK'], // RB / R1 (Signature Flying Rider Kick!)
  [6, 'LOCK_ON'], // LT / L2
  [7, 'HENSHIN'], // RT / R2
  [10, 'FINISHER'], // L3 (Instant Ultimate Finisher in Super/Ultimate Form)
  [11, 'LOCK_ON'], // R3
  [14, 'SWITCH_1'], // D-Pad Left
  [12, 'SWITCH_2'], // D-Pad Up
  [15, 'SWITCH_3'], // D-Pad Right
];

const KEY_TO_ACTION: Readonly<Record<string, InputAction>> = {
  KeyJ: 'ATTACK',
  ShiftLeft: 'DODGE',
  ShiftRight: 'DODGE',
  Digit1: 'SWITCH_1',
  Digit2: 'SWITCH_2',
  Digit3: 'SWITCH_3',
  KeyQ: 'SKILL',
  Space: 'RIDER_KICK',
  KeyX: 'RIDER_KICK',
  KeyE: 'PET',
  KeyF: 'HENSHIN',
  KeyR: 'FINISHER',
  Tab: 'LOCK_ON',
};

const TRACKED_MOVEMENT_KEYS = new Set<string>([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

const KEY_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  KeyQ: 'Q',
  Space: 'SPACE',
  KeyX: 'X',
  KeyE: 'E',
  KeyF: 'F',
  KeyR: 'R',
  Tab: 'TAB',
};

export class InputManager {
  private readonly targetElement: HTMLElement | null;
  private readonly bufferWindowMs: number;
  private readonly now: () => number;
  private readonly onPointerLockChange?: (locked: boolean) => void;
  private readonly onActionBuffered?: (action: InputAction, timestampMs: number) => void;
  private readonly onActiveKeysChange?: (keys: string[]) => void;
  private readonly onGamepadChange?: (connected: boolean, name: string | null) => void;
  private readonly onDebugToggle?: () => void;
  private readonly onSpecialKey?: (code: string) => void;
  private readonly onUserGesture?: () => void;

  private readonly pressedKeys = new Set<string>();
  private readonly actionBuffer = new Map<InputAction, number>();
  private readonly prevGamepadButtons: boolean[] = new Array<boolean>(18).fill(false);
  private gamepadMoveX = 0;
  private gamepadMoveZ = 0;
  private gamepadConnected = false;
  private gamepadName: string | null = null;
  private pointerLocked = false;
  private allowPointerLock = false;
  private isDraggingOrbit = false;
  private lastDragX = 0;
  private lastDragY = 0;

  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private zoomDelta = 0;
  private activeTouchId: number | null = null;
  private disposed = false;

  constructor(options: InputManagerOptions = {}) {
    this.targetElement = options.targetElement ?? null;
    this.bufferWindowMs = options.bufferWindowMs ?? INPUT_BUFFER_WINDOW_MS;
    this.now = options.now ?? (() => performance.now());
    this.onPointerLockChange = options.onPointerLockChange;
    this.onActionBuffered = options.onActionBuffered;
    this.onActiveKeysChange = options.onActiveKeysChange;
    this.onGamepadChange = options.onGamepadChange;
    this.onDebugToggle = options.onDebugToggle;
    this.onSpecialKey = options.onSpecialKey;
    this.onUserGesture = options.onUserGesture;

    this.attachListeners();
  }

  public get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  public get isGamepadConnected(): boolean {
    return this.gamepadConnected;
  }

  public get connectedGamepadName(): string | null {
    return this.gamepadName;
  }

  public setAllowPointerLock(allow: boolean): void {
    this.allowPointerLock = allow;
    if (!allow && this.pointerLocked) {
      this.releasePointerLock();
    }
  }

  public requestPointerLock(): void {
    if (!this.targetElement || typeof this.targetElement.requestPointerLock !== 'function') {
      return;
    }
    try {
      const maybePromise = this.targetElement.requestPointerLock() as unknown;
      if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
        (maybePromise as Promise<void>).catch(() => {
          // Pointer lock may be declined outside user gesture or in headless preview.
        });
      }
    } catch {
      // Ignore pointer lock rejection gracefully.
    }
  }

  public releasePointerLock(): void {
    if (
      typeof document !== 'undefined' &&
      document.pointerLockElement &&
      typeof document.exitPointerLock === 'function'
    ) {
      document.exitPointerLock();
    }
  }

  /**
   * Polls the first connected browser Gamepad (zero allocations in fixedUpdate hot path).
   */
  public pollGamepad(dt: number): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return;
    }
    const pads = navigator.getGamepads();
    let activePad: GamepadSnapshotLike | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) {
        activePad = p;
        break;
      }
    }

    if (!activePad) {
      if (this.gamepadConnected) {
        this.gamepadConnected = false;
        this.gamepadName = null;
        this.gamepadMoveX = 0;
        this.gamepadMoveZ = 0;
        this.prevGamepadButtons.fill(false);
        this.onGamepadChange?.(false, null);
      }
      return;
    }

    if (!this.gamepadConnected || this.gamepadName !== activePad.id) {
      this.gamepadConnected = true;
      this.gamepadName = activePad.id;
      this.onGamepadChange?.(true, activePad.id);
    }

    this.applyGamepadSnapshot(activePad, dt);
  }

  /**
   * Pure testable Gamepad snapshot processor: maps Left Stick -> move, Right Stick -> camera orbit,
   * and rising-edge buttons -> 150ms buffered InputActions with zero per-frame allocations.
   */
  public applyGamepadSnapshot(
    pad: GamepadSnapshotLike,
    dt: number,
    timestampMs?: number
  ): void {
    const rawLX = pad.axes[0] ?? 0;
    const rawLY = pad.axes[1] ?? 0;
    const lMag = Math.hypot(rawLX, rawLY);
    if (lMag > GAMEPAD_STICK_DEADZONE) {
      const scaled = Math.min(1, (lMag - GAMEPAD_STICK_DEADZONE) / (1 - GAMEPAD_STICK_DEADZONE));
      this.gamepadMoveX = (rawLX / lMag) * scaled;
      this.gamepadMoveZ = (-rawLY / lMag) * scaled;
    } else {
      this.gamepadMoveX = 0;
      this.gamepadMoveZ = 0;
    }

    const rawRX = pad.axes[2] ?? 0;
    const rawRY = pad.axes[3] ?? 0;
    const rMag = Math.hypot(rawRX, rawRY);
    if (rMag > GAMEPAD_STICK_DEADZONE) {
      const scaled = Math.min(1, (rMag - GAMEPAD_STICK_DEADZONE) / (1 - GAMEPAD_STICK_DEADZONE));
      this.lookDeltaX += (rawRX / rMag) * scaled * GAMEPAD_LOOK_SENSITIVITY * dt;
      this.lookDeltaY += (rawRY / rMag) * scaled * GAMEPAD_LOOK_SENSITIVITY * dt;
    }

    for (let i = 0; i < GAMEPAD_BUTTON_ACTIONS.length; i++) {
      const [btnIdx, action] = GAMEPAD_BUTTON_ACTIONS[i]!;
      const btn = pad.buttons[btnIdx];
      const isDown = Boolean(btn && (btn.pressed || (btn.value ?? 0) > 0.5));
      const wasDown = this.prevGamepadButtons[btnIdx] ?? false;
      this.prevGamepadButtons[btnIdx] = isDown;
      if (isDown && !wasDown) {
        this.onUserGesture?.();
        this.bufferAction(action, timestampMs);
      }
    }
  }

  /**
   * Writes normalized WASD + Gamepad Left-Stick movement input into `out` without allocating objects.
   * x: -1 (left) to +1 (right), z: -1 (backward) to +1 (forward).
   */
  public getMoveInput(out: MoveInput2D): MoveInput2D {
    let x = this.gamepadMoveX;
    let z = this.gamepadMoveZ;

    if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) z += 1;
    if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) z -= 1;
    if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) x += 1;
    if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft')) x -= 1;

    const lengthSq = x * x + z * z;
    if (lengthSq > 1) {
      const invLen = 1 / Math.sqrt(lengthSq);
      x *= invLen;
      z *= invLen;
    }

    out.x = x;
    out.z = z;
    return out;
  }

  /**
   * Consumes accumulated mouse movement delta into `out` (zero allocation) and resets delta.
   */
  public consumeLookDelta(out: LookDelta2D): LookDelta2D {
    out.dx = this.lookDeltaX;
    out.dy = this.lookDeltaY;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return out;
  }

  public consumeZoomDelta(): number {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }

  public isKeyDown(code: string): boolean {
    return this.pressedKeys.has(code);
  }

  public setKeyState(code: string, isDown: boolean, timestampMs?: number): void {
    const wasDown = this.pressedKeys.has(code);
    if (isDown) {
      this.pressedKeys.add(code);
      if (!wasDown) {
        const mappedAction = KEY_TO_ACTION[code];
        if (mappedAction) {
          this.bufferAction(mappedAction, timestampMs);
        }
        this.emitActiveKeysIfRelevant(code);
      }
    } else if (wasDown) {
      this.pressedKeys.delete(code);
      this.emitActiveKeysIfRelevant(code);
    }
  }

  public bufferAction(action: InputAction, timestampMs?: number): void {
    const ts = timestampMs ?? this.now();
    this.actionBuffer.set(action, ts);
    this.onActionBuffered?.(action, ts);
  }

  public hasBufferedAction(action: InputAction, nowMs?: number): boolean {
    const ts = this.actionBuffer.get(action);
    if (ts === undefined) return false;
    const current = nowMs ?? this.now();
    if (current - ts <= this.bufferWindowMs) {
      return true;
    }
    this.actionBuffer.delete(action);
    return false;
  }

  public consumeBufferedAction(action: InputAction, nowMs?: number): boolean {
    const ts = this.actionBuffer.get(action);
    if (ts === undefined) return false;
    const current = nowMs ?? this.now();
    this.actionBuffer.delete(action);
    return current - ts <= this.bufferWindowMs;
  }

  public clearExpiredBuffers(nowMs?: number): void {
    const current = nowMs ?? this.now();
    for (const [action, ts] of this.actionBuffer) {
      if (current - ts > this.bufferWindowMs) {
        this.actionBuffer.delete(action);
      }
    }
  }

  public clearAllInputs(): void {
    this.pressedKeys.clear();
    this.actionBuffer.clear();
    this.prevGamepadButtons.fill(false);
    this.gamepadMoveX = 0;
    this.gamepadMoveZ = 0;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.zoomDelta = 0;
    this.isDraggingOrbit = false;
    this.activeTouchId = null;
    this.onActiveKeysChange?.([]);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachListeners();
    this.releasePointerLock();
    this.clearAllInputs();
  }

  private emitActiveKeysIfRelevant(code: string): void {
    if (!this.onActiveKeysChange) return;
    if (!TRACKED_MOVEMENT_KEYS.has(code) && !(code in KEY_TO_ACTION)) return;

    const labels: string[] = [];
    for (const key of this.pressedKeys) {
      const label = KEY_DISPLAY_LABELS[key];
      if (label && !labels.includes(label)) {
        labels.push(label);
      }
    }
    this.onActiveKeysChange(labels);
  }

  private attachListeners(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('gamepadconnected', this.handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);

    if (this.targetElement) {
      this.targetElement.addEventListener('mousedown', this.handleMouseDown);
      this.targetElement.addEventListener('wheel', this.handleWheel, { passive: false });
      this.targetElement.addEventListener('touchstart', this.handleTouchStart, { passive: true });
      this.targetElement.addEventListener('touchmove', this.handleTouchMove, { passive: true });
      this.targetElement.addEventListener('touchend', this.handleTouchEnd);
      this.targetElement.addEventListener('contextmenu', this.handleContextMenu);
    }
  }

  private detachListeners(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);

    if (this.targetElement) {
      this.targetElement.removeEventListener('mousedown', this.handleMouseDown);
      this.targetElement.removeEventListener('wheel', this.handleWheel);
      this.targetElement.removeEventListener('touchstart', this.handleTouchStart);
      this.targetElement.removeEventListener('touchmove', this.handleTouchMove);
      this.targetElement.removeEventListener('touchend', this.handleTouchEnd);
      this.targetElement.removeEventListener('contextmenu', this.handleContextMenu);
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.onUserGesture?.();

    if (event.code === 'F3') {
      event.preventDefault();
      this.onDebugToggle?.();
      return;
    }

    if (event.code === 'Tab' || event.code === 'Space' || event.code.startsWith('Arrow')) {
      event.preventDefault();
    }

    if (event.repeat) return;

    if (event.code === 'KeyT' || event.code === 'KeyM' || event.code === 'KeyB') {
      this.onSpecialKey?.(event.code);
    }

    this.setKeyState(event.code, true);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.setKeyState(event.code, false);
  };

  private readonly handleWindowBlur = (): void => {
    this.clearAllInputs();
  };

  private readonly handleGamepadConnected = (event: GamepadEvent): void => {
    this.gamepadConnected = true;
    this.gamepadName = event.gamepad.id || 'Controller';
    this.onGamepadChange?.(true, this.gamepadName);
  };

  private readonly handleGamepadDisconnected = (): void => {
    this.gamepadConnected = false;
    this.gamepadName = null;
    this.gamepadMoveX = 0;
    this.gamepadMoveZ = 0;
    this.prevGamepadButtons.fill(false);
    this.onGamepadChange?.(false, null);
  };

  private readonly handlePointerLockChange = (): void => {
    const locked =
      this.targetElement !== null && document.pointerLockElement === this.targetElement;
    if (this.pointerLocked !== locked) {
      this.pointerLocked = locked;
      this.onPointerLockChange?.(locked);
    }
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    this.onUserGesture?.();

    if (event.button === 0) {
      if (this.allowPointerLock) {
        this.bufferAction('ATTACK');
      }
      if (!this.pointerLocked) {
        this.isDraggingOrbit = true;
        this.lastDragX = event.clientX;
        this.lastDragY = event.clientY;
        if (this.allowPointerLock) {
          this.requestPointerLock();
        }
      }
    } else if (event.button === 1 && this.allowPointerLock) {
      event.preventDefault();
      this.bufferAction('LOCK_ON');
    } else if (event.button === 2 && this.allowPointerLock) {
      event.preventDefault();
      this.bufferAction('DODGE');
    }
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.allowPointerLock) {
      event.preventDefault();
      this.zoomDelta += event.deltaY;
    }
  };

  private readonly handleTouchStart = (event: TouchEvent): void => {
    if (this.allowPointerLock || event.touches.length !== 1) return;
    const t = event.touches[0]!;
    this.activeTouchId = t.identifier;
    this.isDraggingOrbit = true;
    this.lastDragX = t.clientX;
    this.lastDragY = t.clientY;
  };

  private readonly handleTouchMove = (event: TouchEvent): void => {
    if (!this.isDraggingOrbit || this.activeTouchId === null) return;
    for (let i = 0; i < event.touches.length; i++) {
      const t = event.touches[i]!;
      if (t.identifier === this.activeTouchId) {
        this.lookDeltaX += t.clientX - this.lastDragX;
        this.lookDeltaY += t.clientY - this.lastDragY;
        this.lastDragX = t.clientX;
        this.lastDragY = t.clientY;
        break;
      }
    }
  };

  private readonly handleTouchEnd = (): void => {
    this.activeTouchId = null;
    this.isDraggingOrbit = false;
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.isDraggingOrbit = false;
    }
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (this.pointerLocked) {
      this.lookDeltaX += event.movementX;
      this.lookDeltaY += event.movementY;
    } else if (this.isDraggingOrbit) {
      const dx = event.clientX - this.lastDragX;
      const dy = event.clientY - this.lastDragY;
      this.lastDragX = event.clientX;
      this.lastDragY = event.clientY;
      this.lookDeltaX += dx;
      this.lookDeltaY += dy;
    }
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}

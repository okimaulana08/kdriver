export const FIXED_DT = 1 / 60;
export const MAX_FRAME_DT = 0.1;
export const MAX_SUBSTEPS = 5;
const ACCUMULATOR_EPS = 1e-9;
const FPS_SAMPLE_INTERVAL_SEC = 0.25;

export interface LoopCallbacks {
  onFixedUpdate: (fixedDt: number) => void;
  onRender: (alpha: number, rawDt: number) => void;
  onFpsSample?: (
    fps: number,
    frameTimeMs: number,
    timeScale: number,
    hitStopActive: boolean
  ) => void;
}

export class Loop {
  private readonly callbacks: LoopCallbacks;
  private rafId: number | null = null;
  private running = false;
  private paused = false;
  private lastTimestampMs = 0;

  private accumulator = 0;
  private timeScale = 1;
  private timeScaleRemainingSec = 0;
  private hitStopRemainingSec = 0;

  private fpsFrameCount = 0;
  private fpsElapsedSec = 0;
  private lastFps = 60;
  private lastFrameTimeMs = 16.7;

  constructor(callbacks: LoopCallbacks) {
    this.callbacks = callbacks;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTimestampMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  public stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTimestampMs = performance.now();
  }

  public triggerHitStop(durationSec: number): void {
    if (durationSec <= 0) return;
    this.hitStopRemainingSec = Math.max(this.hitStopRemainingSec, durationSec);
  }

  public setTimeScale(scale: number, durationSec = 0): void {
    const clamped = Math.min(2.0, Math.max(0.05, scale));
    this.timeScale = clamped;
    this.timeScaleRemainingSec = durationSec > 0 ? durationSec : 0;
  }

  public resetTimeScale(): void {
    this.timeScale = 1;
    this.timeScaleRemainingSec = 0;
  }

  public getTimeScale(): number {
    return this.timeScale;
  }

  public get isRunning(): boolean {
    return this.running;
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  public get isHitStopActive(): boolean {
    return this.hitStopRemainingSec > 0;
  }

  public get currentFps(): number {
    return this.lastFps;
  }

  /**
   * Advances simulation and rendering deterministically by `rawDtSec`.
   * Exposed directly for unit testing without relying on `requestAnimationFrame`.
   */
  public stepFrame(rawDtSec: number): number {
    const clampedDt = Math.min(MAX_FRAME_DT, Math.max(0, rawDtSec));
    if (this.paused) {
      this.callbacks.onRender(this.accumulator / FIXED_DT, 0);
      return 0;
    }

    // Track temporary time-scale duration in real (unscaled) time.
    if (this.timeScaleRemainingSec > 0) {
      this.timeScaleRemainingSec -= clampedDt;
      if (this.timeScaleRemainingSec <= 0) {
        this.timeScaleRemainingSec = 0;
        this.timeScale = 1;
      }
    }

    let stepsExecuted = 0;
    let simDt = clampedDt;

    if (this.hitStopRemainingSec > 0) {
      if (simDt <= this.hitStopRemainingSec) {
        this.hitStopRemainingSec -= simDt;
        simDt = 0;
      } else {
        simDt -= this.hitStopRemainingSec;
        this.hitStopRemainingSec = 0;
      }
    }

    if (simDt > 0) {
      this.accumulator += simDt * this.timeScale;

      while (this.accumulator + ACCUMULATOR_EPS >= FIXED_DT && stepsExecuted < MAX_SUBSTEPS) {
        this.callbacks.onFixedUpdate(FIXED_DT);
        this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
        stepsExecuted++;
      }

      if (stepsExecuted >= MAX_SUBSTEPS && this.accumulator > FIXED_DT) {
        this.accumulator = FIXED_DT;
      }
    }

    const alpha = this.accumulator / FIXED_DT;
    this.callbacks.onRender(alpha, clampedDt);

    // FPS tracking sampled at a throttled interval (4 Hz) to keep React store calm.
    this.fpsFrameCount++;
    this.fpsElapsedSec += clampedDt;
    if (this.fpsElapsedSec >= FPS_SAMPLE_INTERVAL_SEC) {
      this.lastFps = this.fpsFrameCount / this.fpsElapsedSec;
      this.lastFrameTimeMs = (this.fpsElapsedSec / this.fpsFrameCount) * 1000;
      this.fpsFrameCount = 0;
      this.fpsElapsedSec = 0;
      this.callbacks.onFpsSample?.(
        this.lastFps,
        this.lastFrameTimeMs,
        this.timeScale,
        this.hitStopRemainingSec > 0
      );
    }

    return stepsExecuted;
  }

  public dispose(): void {
    this.stop();
    this.accumulator = 0;
    this.hitStopRemainingSec = 0;
    this.timeScale = 1;
    this.timeScaleRemainingSec = 0;
  }

  private readonly tick = (nowMs: number): void => {
    if (!this.running) return;
    const rawDtSec = Math.max(0, (nowMs - this.lastTimestampMs) / 1000);
    this.lastTimestampMs = nowMs;
    this.stepFrame(rawDtSec);
    if (this.running) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };
}

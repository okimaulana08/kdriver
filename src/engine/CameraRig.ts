import * as THREE from 'three';
import type { LookDelta2D } from './InputManager';
import { ARENA_RADIUS } from './PhysicsWorld';

export type CameraMode =
  | 'HUB_PEDESTAL'
  | 'ARENA_ENTRY'
  | 'COMBAT'
  | 'ULTIMATE_CINEMATIC'
  | 'STAGE_OUTCOME';

const DEFAULT_DISTANCE = 7.2;
const LOCKON_DISTANCE = 7.8;
const CAMERA_SENSITIVITY = 0.0028;
const HUB_ORBIT_SENSITIVITY = 0.0075;
const HUB_DEFAULT_YAW = -0.18;
const HUB_DEFAULT_PITCH = 0.09;
const HUB_DEFAULT_DISTANCE = 4.25;
const HUB_MIN_DISTANCE = 2.05;
const HUB_MAX_DISTANCE = 5.85;
const HUB_MIN_PITCH = -0.18;
const HUB_MAX_PITCH = 0.56;
const MIN_PITCH = 0.12;
const MAX_PITCH = 1.08;
const MIN_CAMERA_Y = 0.72;
const MAX_CAMERA_RADIAL_DIST = ARENA_RADIUS + 2.8;

/**
 * Third-person combat camera supporting 4 modes:
 * HUB_PEDESTAL (rotating showcase), ARENA_ENTRY (1.8s Henshin swoop),
 * COMBAT (orbit + Lock-On + floor/arena clamp + shake), and ULTIMATE_CINEMATIC (3.5s 3-beat timeline).
 * Zero per-frame vector allocations.
 */
export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera;

  private mode: CameraMode = 'HUB_PEDESTAL';
  private modeElapsedSec = 0;
  private cinematicYaw = Math.PI;

  private yaw = 0;
  private pitch = 0.34;
  private currentDistance = DEFAULT_DISTANCE;
  private lockedOn = false;

  // Interactive Hub Showcase Orbit + Scroll Zoom state (zero per-frame allocations)
  private hubTargetYaw = HUB_DEFAULT_YAW;
  private hubYaw = HUB_DEFAULT_YAW;
  private hubTargetPitch = HUB_DEFAULT_PITCH;
  private hubPitch = HUB_DEFAULT_PITCH;
  private hubTargetDistance = HUB_DEFAULT_DISTANCE;
  private hubDistance = HUB_DEFAULT_DISTANCE;
  private hubUserInteracted = false;

  private shakeIntensity = 0;
  private shakeTimeRemaining = 0;
  private shakeDuration = 0.15;
  private shakePhase = 0;

  private initialized = false;

  // Reusable scratch vectors (Zero-Allocation Hot Path)
  private readonly currentPivot = new THREE.Vector3();
  private readonly desiredPivot = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly currentPos = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly scratchToTarget = new THREE.Vector3();
  private readonly scratchRight = new THREE.Vector3();
  private readonly scratchShakeOffset = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  public getYaw(): number {
    return this.yaw;
  }

  public get currentMode(): CameraMode {
    return this.mode;
  }

  public get isLockedOn(): boolean {
    return this.lockedOn;
  }

  public setMode(mode: CameraMode, riderYaw = Math.PI): void {
    this.mode = mode;
    this.modeElapsedSec = 0;
    this.cinematicYaw = riderYaw;
    if (mode === 'COMBAT') {
      this.yaw = 0;
      this.pitch = 0.34;
    }
  }

  public setLockedOn(locked: boolean): void {
    this.lockedOn = locked;
  }

  public addShake(intensity: number, durationSec = 0.16): void {
    if (intensity <= 0) return;
    this.shakeIntensity = Math.max(this.shakeIntensity, Math.min(0.65, intensity));
    this.shakeDuration = Math.max(0.05, durationSec);
    this.shakeTimeRemaining = Math.max(this.shakeTimeRemaining, this.shakeDuration);
  }

  public applyLookDelta(delta: Readonly<LookDelta2D>): void {
    if (delta.dx === 0 && delta.dy === 0) return;
    if (this.mode === 'HUB_PEDESTAL') {
      this.hubUserInteracted = true;
      this.hubTargetYaw -= delta.dx * HUB_ORBIT_SENSITIVITY;
      this.hubTargetPitch = Math.min(
        HUB_MAX_PITCH,
        Math.max(HUB_MIN_PITCH, this.hubTargetPitch + delta.dy * HUB_ORBIT_SENSITIVITY * 0.65)
      );
      return;
    }
    if (this.mode !== 'COMBAT') return;
    if (!this.lockedOn) {
      this.yaw -= delta.dx * CAMERA_SENSITIVITY;
    }
    this.pitch = Math.min(
      MAX_PITCH,
      Math.max(MIN_PITCH, this.pitch + delta.dy * CAMERA_SENSITIVITY)
    );
  }

  public applyHubZoom(wheelDelta: number): void {
    if (this.mode !== 'HUB_PEDESTAL' || wheelDelta === 0) return;
    this.hubUserInteracted = true;
    const step = Math.sign(wheelDelta) * Math.min(0.65, Math.abs(wheelDelta) * 0.0028);
    this.hubTargetDistance = Math.min(
      HUB_MAX_DISTANCE,
      Math.max(HUB_MIN_DISTANCE, this.hubTargetDistance + step)
    );
  }

  public resetHubOrbit(): void {
    this.hubTargetYaw = HUB_DEFAULT_YAW;
    this.hubTargetPitch = HUB_DEFAULT_PITCH;
    this.hubTargetDistance = HUB_DEFAULT_DISTANCE;
    this.hubUserInteracted = false;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    lockTargetPos: THREE.Vector3 | null
  ): void {
    const safeDt = Math.max(0.0001, dt);
    this.modeElapsedSec += safeDt;

    if (this.mode === 'HUB_PEDESTAL') {
      this.updateHubPedestal(safeDt, playerPos);
      return;
    }

    if (this.mode === 'ARENA_ENTRY') {
      this.updateArenaEntry(safeDt, playerPos);
      return;
    }

    if (this.mode === 'ULTIMATE_CINEMATIC') {
      this.updateUltimateCinematic(safeDt, playerPos);
      return;
    }

    if (this.mode === 'STAGE_OUTCOME') {
      this.updateStageOutcome(safeDt, playerPos);
      return;
    }

    // Standard COMBAT third-person camera
    const followLerp = 1 - Math.exp(-14 * safeDt);
    const yawLerp = 1 - Math.exp(-9 * safeDt);
    const distLerp = 1 - Math.exp(-8 * safeDt);

    const hasLockTarget = this.lockedOn && lockTargetPos !== null;

    if (hasLockTarget && lockTargetPos) {
      this.scratchToTarget.subVectors(lockTargetPos, playerPos);
      this.scratchToTarget.y = 0;
      if (this.scratchToTarget.lengthSq() > 0.01) {
        const targetCameraYaw = Math.atan2(-this.scratchToTarget.x, -this.scratchToTarget.z) + 0.14;
        this.yaw = this.dampAngle(this.yaw, targetCameraYaw, yawLerp);
      }

      this.pitch = THREE.MathUtils.lerp(this.pitch, 0.31, 1 - Math.exp(-6 * safeDt));
      this.currentDistance = THREE.MathUtils.lerp(this.currentDistance, LOCKON_DISTANCE, distLerp);

      this.desiredPivot.set(
        THREE.MathUtils.lerp(playerPos.x, lockTargetPos.x, 0.34),
        playerPos.y + 0.65,
        THREE.MathUtils.lerp(playerPos.z, lockTargetPos.z, 0.34)
      );
    } else {
      this.currentDistance = THREE.MathUtils.lerp(this.currentDistance, DEFAULT_DISTANCE, distLerp);
      this.desiredPivot.set(playerPos.x, playerPos.y + 0.65, playerPos.z);
    }

    if (!this.initialized) {
      this.currentPivot.copy(this.desiredPivot);
    } else {
      this.currentPivot.lerp(this.desiredPivot, followLerp);
    }

    const horizDist = Math.cos(this.pitch) * this.currentDistance;
    const vertOffset = Math.sin(this.pitch) * this.currentDistance + 1.25;

    this.desiredPos.set(
      this.currentPivot.x + Math.sin(this.yaw) * horizDist,
      this.currentPivot.y + vertOffset,
      this.currentPivot.z + Math.cos(this.yaw) * horizDist
    );

    if (this.desiredPos.y < MIN_CAMERA_Y) {
      this.desiredPos.y = MIN_CAMERA_Y;
    }

    const radialDist = Math.hypot(this.desiredPos.x, this.desiredPos.z);
    if (radialDist > MAX_CAMERA_RADIAL_DIST) {
      const pullRatio = MAX_CAMERA_RADIAL_DIST / radialDist;
      this.desiredPos.x *= pullRatio;
      this.desiredPos.z *= pullRatio;
      this.desiredPos.y = Math.max(this.desiredPos.y, 2.1);
    }

    if (!this.initialized) {
      this.currentPos.copy(this.desiredPos);
      this.initialized = true;
    } else {
      this.currentPos.lerp(this.desiredPos, followLerp);
    }

    this.applyShakeAndCommit(safeDt, this.currentPos, this.currentPivot);
  }

  public dispose(): void {
    this.shakeIntensity = 0;
    this.shakeTimeRemaining = 0;
    this.lockedOn = false;
    this.initialized = false;
  }

  private updateHubPedestal(dt: number, playerPos: THREE.Vector3): void {
    const smooth = 1 - Math.exp(-10 * dt);
    const desiredYaw = this.hubUserInteracted
      ? this.hubTargetYaw
      : HUB_DEFAULT_YAW + Math.sin(this.modeElapsedSec * 0.42) * 0.22;

    this.hubYaw = THREE.MathUtils.lerp(this.hubYaw, desiredYaw, smooth);
    this.hubPitch = THREE.MathUtils.lerp(this.hubPitch, this.hubTargetPitch, smooth);
    this.hubDistance = THREE.MathUtils.lerp(this.hubDistance, this.hubTargetDistance, smooth);

    // As player zooms closer toward 2.05m, smoothly lift framing onto helmet/chest & center horizontally!
    const zoomFrac =
      1 -
      Math.min(
        1,
        Math.max(0, (this.hubDistance - HUB_MIN_DISTANCE) / (HUB_DEFAULT_DISTANCE - HUB_MIN_DISTANCE))
      );
    const pivotOffsetX = THREE.MathUtils.lerp(-0.85, -0.18, zoomFrac);
    const pivotY = playerPos.y + THREE.MathUtils.lerp(0.38, 0.58, zoomFrac);

    const horizDist = Math.cos(this.hubPitch) * this.hubDistance;
    const vertOffset = Math.sin(this.hubPitch) * this.hubDistance;

    // Orbit cleanly 360 degrees around the Rider (at playerPos), then shift camera right along screen-right for asymmetric Hub layout
    this.desiredPivot.set(playerPos.x + pivotOffsetX * Math.cos(this.hubYaw), pivotY, playerPos.z - pivotOffsetX * Math.sin(this.hubYaw));
    this.desiredPos.set(
      this.desiredPivot.x + Math.sin(this.hubYaw) * horizDist,
      Math.max(0.45, this.desiredPivot.y + vertOffset + 0.16),
      this.desiredPivot.z + Math.cos(this.hubYaw) * horizDist
    );

    const lerp = 1 - Math.exp(-12 * dt);
    if (!this.initialized) {
      this.currentPos.copy(this.desiredPos);
      this.currentPivot.copy(this.desiredPivot);
      this.initialized = true;
    } else {
      this.currentPos.lerp(this.desiredPos, lerp);
      this.currentPivot.lerp(this.desiredPivot, lerp);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentPivot);
  }

  private updateStageOutcome(dt: number, playerPos: THREE.Vector3): void {
    // Dramatic slow-motion hero orbit around the Rider during Stage Cleared / Mission Failed Cut-In
    const angle = this.cinematicYaw + 0.4 + this.modeElapsedSec * 0.55;
    const dist = THREE.MathUtils.lerp(5.4, 3.85, Math.min(1, this.modeElapsedSec / 2.2));
    this.desiredPivot.set(playerPos.x, playerPos.y + 0.55, playerPos.z);
    this.desiredPos.set(
      playerPos.x + Math.sin(angle) * dist,
      Math.max(MIN_CAMERA_Y, playerPos.y + 1.35),
      playerPos.z + Math.cos(angle) * dist
    );
    const lerp = 1 - Math.exp(-7 * dt);
    this.currentPos.lerp(this.desiredPos, lerp);
    this.currentPivot.lerp(this.desiredPivot, lerp);
    this.applyShakeAndCommit(dt, this.currentPos, this.currentPivot);
  }

  private updateArenaEntry(dt: number, playerPos: THREE.Vector3): void {
    // 1.8s fast swoop from dramatic front-close Henshin angle around behind the Rider
    const t = Math.min(1, this.modeElapsedSec / 1.8);
    const ease = 1 - Math.pow(1 - t, 3);
    const angle = THREE.MathUtils.lerp(Math.PI * 0.85, 0, ease);
    const dist = THREE.MathUtils.lerp(3.6, DEFAULT_DISTANCE, ease);
    const height = THREE.MathUtils.lerp(1.4, 3.6, ease);

    this.desiredPivot.set(playerPos.x, playerPos.y + 0.65, playerPos.z);
    this.desiredPos.set(
      playerPos.x + Math.sin(angle) * dist,
      Math.max(MIN_CAMERA_Y, playerPos.y + height),
      playerPos.z + Math.cos(angle) * dist
    );

    this.currentPos.copy(this.desiredPos);
    this.currentPivot.copy(this.desiredPivot);
    this.initialized = true;
    this.applyShakeAndCommit(dt, this.currentPos, this.currentPivot);
  }

  private updateUltimateCinematic(dt: number, playerPos: THREE.Vector3): void {
    const t = this.modeElapsedSec;
    const baseAngle = this.cinematicYaw;

    if (t < 1.45) {
      // Beat 1 (0–1.45s): Heroic low-angle front sweep framing Rider + Giant 2.7x Pet rising behind (under Cut-In)
      const p = t / 1.45;
      const angle = baseAngle + THREE.MathUtils.lerp(-0.48, 0.45, p);
      const dist = THREE.MathUtils.lerp(4.2, 6.4, p);
      this.desiredPos.set(
        playerPos.x + Math.sin(angle) * dist,
        playerPos.y + THREE.MathUtils.lerp(0.65, 1.65, p),
        playerPos.z + Math.cos(angle) * dist
      );
      this.desiredPivot.set(playerPos.x, playerPos.y + 1.15, playerPos.z);
    } else if (t < 2.45) {
      // Beat 2 (1.45–2.45s): Dramatic wide side-action climax revealing Domain-Dimmed 3D Arena + Mega Skybeam + Giant Pet surge
      const p = (t - 1.45) / 1.0;
      const angle = baseAngle + Math.PI * 0.62 + p * 0.38;
      const dist = THREE.MathUtils.lerp(10.6, 8.8, p);
      this.desiredPos.set(
        playerPos.x + Math.sin(angle) * dist,
        playerPos.y + 3.5,
        playerPos.z + Math.cos(angle) * dist
      );
      this.desiredPivot.set(
        playerPos.x + Math.sin(baseAngle) * 2.6,
        playerPos.y + 1.25,
        playerPos.z + Math.cos(baseAngle) * 2.6
      );
    } else {
      // Beat 3 (2.45–3.5s): Iconic Kamen Rider Back-Turned Explosion Pose!
      const p = Math.min(1, (t - 2.45) / 1.05);
      const angle = baseAngle + Math.PI + THREE.MathUtils.lerp(-0.24, 0.2, p);
      const dist = THREE.MathUtils.lerp(4.1, 4.95, p);
      this.desiredPos.set(
        playerPos.x + Math.sin(angle) * dist,
        playerPos.y + 0.85,
        playerPos.z + Math.cos(angle) * dist
      );
      this.desiredPivot.set(playerPos.x, playerPos.y + 0.9, playerPos.z);
    }

    if (this.desiredPos.y < MIN_CAMERA_Y) this.desiredPos.y = MIN_CAMERA_Y;
    const lerp = 1 - Math.exp(-10 * dt);
    this.currentPos.lerp(this.desiredPos, lerp);
    this.currentPivot.lerp(this.desiredPivot, lerp);
    this.applyShakeAndCommit(dt, this.currentPos, this.currentPivot);
  }

  private applyShakeAndCommit(
    safeDt: number,
    pos: THREE.Vector3,
    pivot: THREE.Vector3
  ): void {
    this.scratchShakeOffset.set(0, 0, 0);
    if (this.shakeTimeRemaining > 0) {
      this.shakeTimeRemaining = Math.max(0, this.shakeTimeRemaining - safeDt);
      const decay = this.shakeTimeRemaining / this.shakeDuration;
      const amp = this.shakeIntensity * decay * decay;
      this.shakePhase += safeDt * 72;

      this.scratchRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.scratchShakeOffset
        .copy(this.scratchRight)
        .multiplyScalar(Math.sin(this.shakePhase) * amp);
      this.scratchShakeOffset.y += Math.cos(this.shakePhase * 1.37) * amp * 0.75;

      if (this.shakeTimeRemaining === 0) {
        this.shakeIntensity = 0;
      }
    }

    this.camera.position.copy(pos).add(this.scratchShakeOffset);
    this.lookTarget.copy(pivot).addScaledVector(this.scratchShakeOffset, 0.35);
    this.camera.lookAt(this.lookTarget);
  }

  private dampAngle(current: number, target: number, factor: number): number {
    let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return current + diff * Math.min(1, factor);
  }
}

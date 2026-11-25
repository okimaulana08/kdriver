import type { HurtboxTarget, Vec3Snapshot } from '../types/schema';

/**
 * Spatial hitbox resolver with per-swing Hit Registry.
 * Guarantees one weapon swing can hit each enemy at most once across all active frames.
 * Zero per-call vector allocations.
 */
export class HitboxSystem {
  private activeSwingId: number | null = null;
  private readonly hitTargetIds = new Set<string>();
  private readonly scratchTargetPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };

  public beginSwing(swingId: number): void {
    if (this.activeSwingId !== swingId) {
      this.activeSwingId = swingId;
      this.hitTargetIds.clear();
    }
  }

  public endSwing(): void {
    this.activeSwingId = null;
    this.hitTargetIds.clear();
  }

  public hasHitTarget(targetId: string): boolean {
    return this.hitTargetIds.has(targetId);
  }

  public get currentSwingId(): number | null {
    return this.activeSwingId;
  }

  /**
   * Tests a horizontal forward melee arc centered at `origin` facing normalized `(forwardX, forwardZ)`.
   * Appends newly-hit targets into `outHits` (clears `outHits` first) and records them in the Hit Registry.
   */
  public checkMeleeArc(
    origin: Readonly<Vec3Snapshot>,
    forwardX: number,
    forwardZ: number,
    range: number,
    minDotProduct: number,
    targets: readonly HurtboxTarget[],
    outHits: HurtboxTarget[]
  ): HurtboxTarget[] {
    outHits.length = 0;
    if (this.activeSwingId === null) {
      return outHits;
    }

    const fLen = Math.hypot(forwardX, forwardZ);
    const nx = fLen > 0.0001 ? forwardX / fLen : 0;
    const nz = fLen > 0.0001 ? forwardZ / fLen : 1;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      if (!target.isAlive || this.hitTargetIds.has(target.id)) {
        continue;
      }

      target.getPosition(this.scratchTargetPos);
      const dx = this.scratchTargetPos.x - origin.x;
      const dz = this.scratchTargetPos.z - origin.z;
      const maxReach = range + target.radius;
      const distSq = dx * dx + dz * dz;

      if (distSq > maxReach * maxReach) {
        continue;
      }

      // Targets standing practically on top of the attacker always connect.
      if (distSq > 0.04) {
        const invDist = 1 / Math.sqrt(distSq);
        const dot = (dx * nx + dz * nz) * invDist;
        if (dot < minDotProduct) {
          continue;
        }
      }

      this.hitTargetIds.add(target.id);
      outHits.push(target);
    }

    return outHits;
  }

  /**
   * Tests a 3D spherical overlap (e.g., radial shockwave or boss slam) with Hit Registry deduplication.
   */
  public checkSphere(
    center: Readonly<Vec3Snapshot>,
    radius: number,
    targets: readonly HurtboxTarget[],
    outHits: HurtboxTarget[]
  ): HurtboxTarget[] {
    outHits.length = 0;
    if (this.activeSwingId === null) {
      return outHits;
    }

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      if (!target.isAlive || this.hitTargetIds.has(target.id)) {
        continue;
      }

      target.getPosition(this.scratchTargetPos);
      const dx = this.scratchTargetPos.x - center.x;
      const dy = this.scratchTargetPos.y - center.y;
      const dz = this.scratchTargetPos.z - center.z;
      const maxDist = radius + target.radius;

      if (dx * dx + dy * dy + dz * dz <= maxDist * maxDist) {
        this.hitTargetIds.add(target.id);
        outHits.push(target);
      }
    }

    return outHits;
  }

  public dispose(): void {
    this.endSwing();
  }
}

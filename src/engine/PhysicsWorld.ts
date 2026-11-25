import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export const ARENA_RADIUS = 16;
export const ARENA_SIDES = 8;
export const ARENA_WALL_HEIGHT = 6;
export const PLAYER_CAPSULE_HALF_HEIGHT = 0.55;
export const PLAYER_CAPSULE_RADIUS = 0.4;
export const CHARACTER_SKIN_OFFSET = 0.02;
export const PLAYER_SPAWN_Y =
  PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS + CHARACTER_SKIN_OFFSET;

const GRAVITY = { x: 0, y: -25.0, z: 0 };
const WALL_THICKNESS = 1.0;

// Module-level singleton guard: @dimforge/rapier3d-compat must only initialize WASM once,
// even when React <StrictMode> double-mounts and disposes concurrently.
let rapierInitPromise: Promise<void> | null = null;

function ensureRapierInitialized(): Promise<void> {
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init().catch((err) => {
      rapierInitPromise = null;
      throw err;
    });
  }
  return rapierInitPromise;
}

export interface PlayerMoveResult {
  isGrounded: boolean;
  isTouchingWall: boolean;
}

export class PhysicsWorld {
  private world: RAPIER.World | null = null;
  private characterController: RAPIER.KinematicCharacterController | null = null;
  private playerBody: RAPIER.RigidBody | null = null;
  private playerCollider: RAPIER.Collider | null = null;
  private initialized = false;
  private disposed = false;

  // Reusable scratch objects (Zero-Allocation Hot Path)
  private readonly scratchDesiredMove = { x: 0, y: 0, z: 0 };
  private readonly scratchNextTranslation = { x: 0, y: 0, z: 0 };
  private readonly moveResult: PlayerMoveResult = {
    isGrounded: true,
    isTouchingWall: false,
  };

  public async init(): Promise<void> {
    if (this.initialized || this.disposed) return;

    await ensureRapierInitialized();
    if (this.disposed) return;

    const world = new RAPIER.World(GRAVITY);
    this.world = world;

    this.buildArenaColliders(world);
    this.buildPlayerCapsule(world);

    // Prime Rapier's query pipeline so the very first character controller cast sees all colliders.
    world.timestep = 1 / 60;
    world.step();

    this.initialized = true;
  }

  public get isReady(): boolean {
    return this.initialized && !this.disposed && this.world !== null;
  }

  public getPlayerPosition(out: THREE.Vector3): THREE.Vector3 {
    if (!this.playerBody) {
      return out.set(0, PLAYER_SPAWN_Y, 0);
    }
    const pos = this.playerBody.translation();
    return out.set(pos.x, pos.y, pos.z);
  }

  public resetPlayerPosition(x = 0, z = 0): void {
    if (!this.world || !this.playerBody) return;
    this.scratchNextTranslation.x = x;
    this.scratchNextTranslation.y = PLAYER_SPAWN_Y;
    this.scratchNextTranslation.z = z;
    this.playerBody.setTranslation(this.scratchNextTranslation, true);
    this.playerBody.setNextKinematicTranslation(this.scratchNextTranslation);
    this.world.timestep = 1 / 60;
    this.world.step();
  }

  /**
   * Registers a static vertical cylinder blocker (e.g., Training Dummy pedestal)
   * so the player capsule slides around it cleanly without clipping inside.
   */
  public addStaticCylinderObstacle(
    x: number,
    z: number,
    radius: number,
    height = 2.2
  ): RAPIER.RigidBody | null {
    if (!this.world) return null;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, height * 0.5, z)
    );
    const collider = RAPIER.ColliderDesc.cylinder(height * 0.5, radius);
    this.world.createCollider(collider, body);
    this.world.timestep = 1 / 60;
    this.world.step();
    return body;
  }

  /**
   * Moves the player capsule using Rapier's KinematicCharacterController,
   * advances the physics world by `fixedDt`, and copies the new position into `outPos`.
   */
  public stepPlayerMovement(
    desiredDx: number,
    desiredDy: number,
    desiredDz: number,
    fixedDt: number,
    outPos: THREE.Vector3
  ): PlayerMoveResult {
    if (!this.world || !this.characterController || !this.playerBody || !this.playerCollider) {
      outPos.set(0, PLAYER_SPAWN_Y, 0);
      this.moveResult.isGrounded = true;
      this.moveResult.isTouchingWall = false;
      return this.moveResult;
    }

    this.scratchDesiredMove.x = desiredDx;
    this.scratchDesiredMove.y = desiredDy;
    this.scratchDesiredMove.z = desiredDz;

    this.characterController.computeColliderMovement(
      this.playerCollider,
      this.scratchDesiredMove
    );

    const corrected = this.characterController.computedMovement();
    const current = this.playerBody.translation();

    this.scratchNextTranslation.x = current.x + corrected.x;
    this.scratchNextTranslation.y = current.y + corrected.y;
    this.scratchNextTranslation.z = current.z + corrected.z;

    this.playerBody.setNextKinematicTranslation(this.scratchNextTranslation);

    this.world.timestep = fixedDt;
    this.world.step();

    const updated = this.playerBody.translation();
    outPos.set(updated.x, updated.y, updated.z);

    let touchingWall = false;
    const collisionCount = this.characterController.numComputedCollisions();
    for (let i = 0; i < collisionCount; i++) {
      const collision = this.characterController.computedCollision(i);
      if (!collision) continue;
      const normal = collision.normal1;
      if (Math.abs(normal.x) + Math.abs(normal.z) > 0.5) {
        touchingWall = true;
        break;
      }
    }

    this.moveResult.isGrounded = this.characterController.computedGrounded();
    this.moveResult.isTouchingWall = touchingWall;
    return this.moveResult;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.initialized = false;

    if (this.world) {
      if (this.characterController) {
        this.world.removeCharacterController(this.characterController);
      }
      this.world.free();
    }

    this.characterController = null;
    this.playerBody = null;
    this.playerCollider = null;
    this.world = null;
  }

  private buildArenaColliders(world: RAPIER.World): void {
    // Solid floor slab with top face at exact y = 0.
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const floorRadius = ARENA_RADIUS + 4;
    const floorCollider = RAPIER.ColliderDesc.cuboid(floorRadius, 0.5, floorRadius)
      .setTranslation(0, -0.5, 0)
      .setFriction(1.0);
    world.createCollider(floorCollider, floorBody);

    // 8 invisible perimeter walls forming an exact regular octagon with apothem = ARENA_RADIUS.
    const edgeLength = 2 * ARENA_RADIUS * Math.tan(Math.PI / ARENA_SIDES);
    const halfWidth = edgeLength * 0.5 + 0.6; // Slight overlap guarantees sealed corners.
    const halfHeight = ARENA_WALL_HEIGHT * 0.5;
    const halfDepth = WALL_THICKNESS * 0.5;
    const wallCenterDist = ARENA_RADIUS + halfDepth;

    for (let i = 0; i < ARENA_SIDES; i++) {
      const theta = (i * Math.PI * 2) / ARENA_SIDES;
      const cx = Math.sin(theta) * wallCenterDist;
      const cz = Math.cos(theta) * wallCenterDist;
      const halfAngle = theta * 0.5;

      const wallBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(cx, halfHeight, cz)
          .setRotation({ x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) })
      );

      const wallCollider = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth);
      world.createCollider(wallCollider, wallBody);
    }
  }

  private buildPlayerCapsule(world: RAPIER.World): void {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      0,
      PLAYER_SPAWN_Y,
      0
    );
    const playerBody = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.capsule(
      PLAYER_CAPSULE_HALF_HEIGHT,
      PLAYER_CAPSULE_RADIUS
    );
    const playerCollider = world.createCollider(colliderDesc, playerBody);

    const controller = world.createCharacterController(CHARACTER_SKIN_OFFSET);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.enableSnapToGround(0.3);
    controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);

    this.playerBody = playerBody;
    this.playerCollider = playerCollider;
    this.characterController = controller;
  }
}

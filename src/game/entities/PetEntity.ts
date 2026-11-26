import * as THREE from 'three';
import type { AssetLoader } from '../../engine/AssetLoader';
import {
  bindPbrMaterials,
  createCompoundEyeMaterial,
  createRiderArmorMaterial,
  createUndersuitMaterial,
  type ArmorHueShiftUniforms,
  type PbrTextureSet,
} from '../../engine/PbrMaterialSystem';
import { ALL_ELEMENT_IDS, getElementConfig } from '../data/elements';
import type { ElementId, HurtboxTarget, StatusEffectId, Vec3Snapshot } from '../types/schema';

export const PET_ASSIST_STRIKE_DURATION_SEC = 1.15;
export const PET_COMPANION_DURATION_SEC = 18.0;
export const PET_POST_FOLLOW_COOLDOWN_SEC = 20.0;
export const PET_AUTO_SHOT_INTERVAL_SEC = 1.5;
export const PET_SHOT_RANGE = 16.5;

const PET_IMPACT_TIME = 0.46;
const PET_DEFAULT_STRIKE_DIST = 5.2;
const PET_SHOT_RECOIL_SEC = 0.28;
const PET_DESPAWN_FADE_SEC = 0.45;

type PetRigArchetype = 'winged' | 'beast' | 'serpent';
type PetPhase = 'STRIKE' | 'FOLLOW';

const ELEMENT_PET_ARCHETYPE: Readonly<Record<ElementId, PetRigArchetype>> = {
  pyro: 'winged',
  volt: 'beast',
  aqua: 'serpent',
  terra: 'beast',
  aero: 'winged',
  flora: 'serpent',
  solar: 'beast',
  lunar: 'winged',
  umbra: 'serpent',
  lux: 'beast',
};

export interface PetImpactEvent {
  element: ElementId;
  x: number;
  y: number;
  z: number;
  radius: number;
  damageMultiplier: number;
  appliesStatus: StatusEffectId;
  healRiderAmount: number;
}

export interface PetShotEvent {
  element: ElementId;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export interface PetUpdateEvents {
  impact: PetImpactEvent | null;
  shots: readonly PetShotEvent[];
}

interface PetSkeletonBones {
  body?: THREE.Object3D;
  chest?: THREE.Object3D;
  head?: THREE.Object3D;
  tail?: THREE.Object3D;
  tailBase?: THREE.Object3D;
  tailTip?: THREE.Object3D;
  talons?: THREE.Object3D;
  wingLIn?: THREE.Object3D;
  wingLOut?: THREE.Object3D;
  wingRIn?: THREE.Object3D;
  wingROut?: THREE.Object3D;
  frontLegL?: THREE.Object3D;
  frontLegR?: THREE.Object3D;
  backLegL?: THREE.Object3D;
  backLegR?: THREE.Object3D;
  dragonNeck?: THREE.Object3D;
  dragonLowerCoil?: THREE.Object3D;
  dragonTailMid?: THREE.Object3D;
  dragonClaws?: THREE.Object3D;
}

interface PooledPetRig {
  archetype: PetRigArchetype;
  group: THREE.Group;
  armorMat: THREE.MeshPhysicalMaterial;
  glowMat: THREE.MeshPhysicalMaterial;
  armorHueUniforms: ArmorHueShiftUniforms[];
  isCustomExternal: boolean;
  bones: PetSkeletonBones;
  wingLeft?: THREE.Object3D;
  wingRight?: THREE.Object3D;
  tailPivot?: THREE.Object3D;
  activeElement: ElementId | null;
  active: boolean;
  phase: PetPhase;
  elapsed: number;
  impactFired: boolean;
  startX: number;
  startY: number;
  startZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  posX: number;
  posY: number;
  posZ: number;
  yaw: number;
  moveSpeed: number;
  shotTimer: number;
  shotRecoilTimer: number;
}

const ARCHETYPES: readonly PetRigArchetype[] = ['winged', 'beast', 'serpent'];

function dampAngle(current: number, target: number, factor: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, factor);
}

/**
 * Object-pooled 10-Element Contract-Beast Pet system powered by 3 sculpted PBR `.glb` archetypes
 * (`pet_phoenix`, `pet_raiju`, `pet_leviathan`) with real-time selective armor hue-shifting!
 *
 * Lifecycle on `[E]` Summon:
 * 1. Assist Strike Phase (0.0s - 1.15s): Dives/lunges at enemy for heavy elemental AoE burst + status.
 * 2. Companion Follow Phase (1.15s - 18.0s): Patrols beside the Rider in non-overlapping formations and
 *    automatically fires glowing 3D Elemental Shots at nearby monsters every 1.5s!
 */
export class PetEntity {
  public readonly root = new THREE.Group();

  private readonly rigs: Record<PetRigArchetype, PooledPetRig>;
  private readonly cooldowns: Record<ElementId, number>;
  private readonly ownedMaterials: THREE.Material[] = [];

  private ultimateElement: ElementId | null = null;
  private ultimateArchetype: PetRigArchetype | null = null;
  private ultimateTrinityMode = false;
  private ultimateElapsed = 0;
  private ultimateAnchorX = 0;
  private ultimateAnchorZ = 0;
  private ultimateYaw = 0;

  // Pre-allocated scratch results (Zero-Allocation Hot Path)
  private readonly impactResult: PetImpactEvent = {
    element: 'pyro',
    x: 0,
    y: 1,
    z: 0,
    radius: 4.0,
    damageMultiplier: 1.8,
    appliesStatus: 'BURN',
    healRiderAmount: 0,
  };
  private readonly scratchShotPool: PetShotEvent[] = [
    { element: 'pyro', x: 0, y: 1, z: 0, targetX: 0, targetY: 1, targetZ: 0 },
    { element: 'volt', x: 0, y: 1, z: 0, targetX: 0, targetY: 1, targetZ: 0 },
    { element: 'aqua', x: 0, y: 1, z: 0, targetX: 0, targetY: 1, targetZ: 0 },
  ];
  private readonly activeShots: PetShotEvent[] = [];
  private readonly updateResult: PetUpdateEvents = {
    impact: null,
    shots: this.activeShots,
  };
  private readonly scratchTargetPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };

  constructor(assetLoader: AssetLoader, pbrTextures: PbrTextureSet) {
    const buildRig = (
      archetype: PetRigArchetype,
      key: 'pet_phoenix' | 'pet_raiju' | 'pet_leviathan',
      bodyHex: number,
      emissiveHex: number
    ): PooledPetRig => {
      const cloned = assetLoader.cloneRig(key);
      const group = cloned.scene;
      const armorMat = createRiderArmorMaterial(bodyHex, pbrTextures);
      const darkMat = createUndersuitMaterial(pbrTextures);
      const glowMat = createCompoundEyeMaterial(emissiveHex, pbrTextures, 2.0);
      this.ownedMaterials.push(armorMat, darkMat, glowMat);

      const externalMats = bindPbrMaterials(
        group,
        {
          armor: armorMat,
          undersuit: darkMat,
          emissive: glowMat,
        },
        {
          preserveExternalPbr: true,
          envMapIntensity: 1.4,
          enableArmorHueShift: cloned.isCustomExternal,
        }
      );
      this.ownedMaterials.push(...externalMats);
      const armorHueUniforms: ArmorHueShiftUniforms[] = [];
      for (let i = 0; i < externalMats.length; i++) {
        const u = externalMats[i]!.userData.armorHueShiftUniforms as
          | ArmorHueShiftUniforms
          | undefined;
        if (u) armorHueUniforms.push(u);
      }
      group.visible = false;
      this.root.add(group);

      const bones: PetSkeletonBones = {
        body: assetLoader.findSocket(group, 'PetBody') ?? undefined,
        chest: assetLoader.findSocket(group, 'PetChest') ?? undefined,
        head: assetLoader.findSocket(group, 'PetHead') ?? undefined,
        tail: assetLoader.findSocket(group, 'PetTail') ?? undefined,
        tailBase: assetLoader.findSocket(group, 'PetTailBase') ?? undefined,
        tailTip: assetLoader.findSocket(group, 'PetTailTip') ?? undefined,
        talons: assetLoader.findSocket(group, 'PetTalons') ?? undefined,
        wingLIn: assetLoader.findSocket(group, 'WingL_Inner') ?? undefined,
        wingLOut: assetLoader.findSocket(group, 'WingL_Outer') ?? undefined,
        wingRIn: assetLoader.findSocket(group, 'WingR_Inner') ?? undefined,
        wingROut: assetLoader.findSocket(group, 'WingR_Outer') ?? undefined,
        frontLegL: assetLoader.findSocket(group, 'FrontLegL') ?? undefined,
        frontLegR: assetLoader.findSocket(group, 'FrontLegR') ?? undefined,
        backLegL: assetLoader.findSocket(group, 'BackLegL') ?? undefined,
        backLegR: assetLoader.findSocket(group, 'BackLegR') ?? undefined,
        dragonNeck: assetLoader.findSocket(group, 'DragonNeck') ?? undefined,
        dragonLowerCoil: assetLoader.findSocket(group, 'DragonLowerCoil') ?? undefined,
        dragonTailMid: assetLoader.findSocket(group, 'DragonTailMid') ?? undefined,
        dragonClaws: assetLoader.findSocket(group, 'DragonClaws') ?? undefined,
      };

      return {
        archetype,
        group,
        armorMat,
        glowMat,
        armorHueUniforms,
        isCustomExternal: cloned.isCustomExternal,
        bones,
        wingLeft: assetLoader.findSocket(group, 'WingLeft') ?? undefined,
        wingRight: assetLoader.findSocket(group, 'WingRight') ?? undefined,
        tailPivot: assetLoader.findSocket(group, 'TailPivot') ?? undefined,
        activeElement: null,
        active: false,
        phase: 'STRIKE',
        elapsed: 0,
        impactFired: false,
        startX: 0,
        startY: 1.5,
        startZ: 0,
        targetX: 0,
        targetY: 1.0,
        targetZ: -4,
        posX: 0,
        posY: 1.5,
        posZ: 0,
        yaw: 0,
        moveSpeed: 0,
        shotTimer: 0.75,
        shotRecoilTimer: 0,
      };
    };

    this.rigs = {
      winged: buildRig('winged', 'pet_phoenix', 0xe11d48, 0xff5722),
      beast: buildRig('beast', 'pet_raiju', 0xfacc15, 0x38bdf8),
      serpent: buildRig('serpent', 'pet_leviathan', 0x0284c7, 0x22d3ee),
    };

    this.cooldowns = {
      pyro: 0,
      volt: 0,
      aqua: 0,
      terra: 0,
      aero: 0,
      flora: 0,
      solar: 0,
      lunar: 0,
      umbra: 0,
      lux: 0,
    };
  }

  public getCooldown(element: ElementId): number {
    return this.cooldowns[element];
  }

  /**
   * Returns remaining active companion duration (in seconds) for `element`, or the longest active
   * companion if `element` is omitted.
   */
  public getActiveCompanionRemaining(element?: ElementId): number {
    if (element) {
      const rig = this.rigs[ELEMENT_PET_ARCHETYPE[element]];
      if (rig.active && rig.activeElement === element) {
        return Math.max(0, PET_COMPANION_DURATION_SEC - rig.elapsed);
      }
      return 0;
    }
    let maxRem = 0;
    for (let i = 0; i < ARCHETYPES.length; i++) {
      const rig = this.rigs[ARCHETYPES[i]!];
      if (rig.active) {
        const rem = Math.max(0, PET_COMPANION_DURATION_SEC - rig.elapsed);
        if (rem > maxRem) maxRem = rem;
      }
    }
    return maxRem;
  }

  public getActiveCompanionCount(): number {
    let count = 0;
    for (let i = 0; i < ARCHETYPES.length; i++) {
      if (this.rigs[ARCHETYPES[i]!].active) count++;
    }
    return count;
  }

  public canSummon(element: ElementId): boolean {
    if (this.ultimateElement !== null) return false;
    if (this.cooldowns[element] > 0) return false;
    const rig = this.rigs[ELEMENT_PET_ARCHETYPE[element]];
    // Cannot re-summon the same element while its Pet is already actively fighting beside the Rider;
    // its 20s cooldown begins once the 18s companion window ends!
    if (rig.active && rig.activeElement === element) return false;
    return !(rig.active && rig.phase === 'STRIKE');
  }

  public activateUltimatePet(
    element: ElementId,
    riderPos: Readonly<Vec3Snapshot>,
    riderYaw: number,
    isGrandUltimate = false
  ): void {
    // Pause any active patrolling companions while the Giant Ultimate Pet(s) take center stage
    for (let i = 0; i < ARCHETYPES.length; i++) {
      this.rigs[ARCHETYPES[i]!].group.visible = false;
    }
    const archetype = ELEMENT_PET_ARCHETYPE[element];
    this.ultimateElement = element;
    this.ultimateArchetype = archetype;
    this.ultimateTrinityMode = isGrandUltimate;
    this.ultimateElapsed = 0;
    this.ultimateAnchorX = riderPos.x;
    this.ultimateAnchorZ = riderPos.z;
    this.ultimateYaw = riderYaw;

    if (isGrandUltimate) {
      // GRAND SOVEREIGN ULTIMATE FORM [R]: Summon ALL 3 Rigged Contract-Beast Pets simultaneously!
      for (let i = 0; i < ARCHETYPES.length; i++) {
        const arch = ARCHETYPES[i]!;
        const rig = this.rigs[arch];
        const tintElem: ElementId =
          arch === archetype
            ? element
            : arch === 'winged'
              ? 'solar'
              : arch === 'beast'
                ? 'lux'
                : 'aqua';
        this.tintRigForElement(rig, tintElem);
        rig.group.visible = true;
        rig.group.scale.setScalar(0.2);
      }
      return;
    }

    const rig = this.rigs[archetype];
    this.tintRigForElement(rig, element);
    rig.group.visible = true;
    rig.group.scale.setScalar(0.2);
  }

  public deactivateUltimatePet(): void {
    if (this.ultimateArchetype) {
      for (let i = 0; i < ARCHETYPES.length; i++) {
        const r = this.rigs[ARCHETYPES[i]!];
        r.group.visible = false;
        r.group.scale.setScalar(1.0);
      }
      this.ultimateElement = null;
      this.ultimateArchetype = null;
      this.ultimateTrinityMode = false;

      // Restore any still-active patrolling companions seamlessly!
      for (let i = 0; i < ARCHETYPES.length; i++) {
        const rig = this.rigs[ARCHETYPES[i]!];
        if (rig.active && rig.activeElement) {
          this.tintRigForElement(rig, rig.activeElement);
          rig.group.scale.setScalar(1.0);
          rig.group.visible = true;
        }
      }
    }
  }

  public resetAll(): void {
    this.ultimateElement = null;
    this.ultimateArchetype = null;
    this.ultimateTrinityMode = false;
    this.resetActiveSummons();
    for (let i = 0; i < ALL_ELEMENT_IDS.length; i++) {
      this.cooldowns[ALL_ELEMENT_IDS[i]!] = 0;
    }
  }

  public summon(
    element: ElementId,
    riderPos: Readonly<Vec3Snapshot>,
    forwardX: number,
    forwardZ: number,
    targetPos: Readonly<Vec3Snapshot> | null
  ): boolean {
    if (!this.canSummon(element)) return false;

    const archetype = ELEMENT_PET_ARCHETYPE[element];
    const rig = this.rigs[archetype];
    // If replacing a different active element on the same archetype rig early, put the replaced Pet on its 20s cooldown
    if (rig.active && rig.activeElement && rig.activeElement !== element) {
      this.cooldowns[rig.activeElement] = PET_POST_FOLLOW_COOLDOWN_SEC;
    }
    this.tintRigForElement(rig, element);
    rig.activeElement = element;
    rig.active = true;
    rig.phase = 'STRIKE';
    rig.elapsed = 0;
    rig.impactFired = false;
    rig.shotTimer = 0.7;
    rig.shotRecoilTimer = 0;
    this.cooldowns[element] = 0;

    const sideSign = archetype === 'beast' ? 1 : -1;
    const sideX = -forwardZ * 1.45 * sideSign;
    const sideZ = forwardX * 1.45 * sideSign;
    rig.startX = riderPos.x + sideX - forwardX * 0.4;
    rig.startY = archetype === 'winged' ? 2.55 : archetype === 'serpent' ? 1.1 : 0.12;
    rig.startZ = riderPos.z + sideZ - forwardZ * 0.4;

    if (targetPos) {
      rig.targetX = targetPos.x;
      rig.targetY = 1.0;
      rig.targetZ = targetPos.z;
    } else {
      rig.targetX = riderPos.x + forwardX * PET_DEFAULT_STRIKE_DIST;
      rig.targetY = 1.0;
      rig.targetZ = riderPos.z + forwardZ * PET_DEFAULT_STRIKE_DIST;
    }

    rig.posX = rig.startX;
    rig.posY = rig.startY;
    rig.posZ = rig.startZ;
    rig.yaw = Math.atan2(rig.targetX - rig.startX, rig.targetZ - rig.startZ);
    rig.moveSpeed = 0;
    rig.group.position.set(rig.posX, rig.posY, rig.posZ);
    rig.group.rotation.set(0, rig.yaw, 0);
    rig.group.scale.setScalar(0.15);
    rig.group.visible = true;

    return true;
  }

  public fixedUpdate(
    dt: number,
    riderPos: Readonly<Vec3Snapshot>,
    riderYaw: number,
    targets: readonly HurtboxTarget[],
    preferredTarget: HurtboxTarget | null,
    freezeCombat = false
  ): PetUpdateEvents {
    this.updateResult.impact = null;
    this.activeShots.length = 0;

    for (let i = 0; i < ALL_ELEMENT_IDS.length; i++) {
      const id = ALL_ELEMENT_IDS[i]!;
      if (this.cooldowns[id] > 0) {
        this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
      }
    }

    if (this.ultimateElement) {
      this.ultimateElapsed += dt;
      if (this.ultimateElapsed >= 2.65) {
        this.deactivateUltimatePet();
      }
      return this.updateResult;
    }

    const fwdX = Math.sin(riderYaw);
    const fwdZ = Math.cos(riderYaw);
    const rightX = Math.cos(riderYaw);
    const rightZ = -Math.sin(riderYaw);
    const followLerp = 1 - Math.exp(-6.4 * dt);

    let shotPoolIdx = 0;

    for (let i = 0; i < ARCHETYPES.length; i++) {
      const rig = this.rigs[ARCHETYPES[i]!];
      if (!rig.active || !rig.activeElement) continue;

      rig.elapsed += dt;
      if (rig.shotRecoilTimer > 0) {
        rig.shotRecoilTimer = Math.max(0, rig.shotRecoilTimer - dt);
      }

      // Phase 1: Initial Signature Assist Strike (0.0s - 1.15s)
      if (rig.phase === 'STRIKE') {
        if (!rig.impactFired && rig.elapsed >= PET_IMPACT_TIME) {
          rig.impactFired = true;
          const elemId = rig.activeElement;
          const cfg = getElementConfig(elemId);
          this.impactResult.element = elemId;
          this.impactResult.x = rig.targetX;
          this.impactResult.y = rig.targetY;
          this.impactResult.z = rig.targetZ;
          this.impactResult.radius =
            rig.archetype === 'serpent' ? 4.8 : rig.archetype === 'winged' ? 4.4 : 4.0;
          this.impactResult.damageMultiplier = cfg.pet.assistDamageMultiplier;
          this.impactResult.appliesStatus = cfg.pet.appliesStatus;
          this.impactResult.healRiderAmount = cfg.pet.passiveBonus.stat === 'regen' ? 14 : 0;
          this.updateResult.impact = this.impactResult;
        }

        const strikeT = Math.min(1, rig.elapsed / PET_IMPACT_TIME);
        const easeStrike = 1 - Math.pow(1 - strikeT, 3);
        if (rig.archetype === 'winged') {
          rig.posX = THREE.MathUtils.lerp(rig.startX, rig.targetX, easeStrike);
          rig.posZ = THREE.MathUtils.lerp(rig.startZ, rig.targetZ, easeStrike);
          const diveArc = Math.sin(strikeT * Math.PI) * 1.4;
          const postRise =
            rig.elapsed > PET_IMPACT_TIME ? (rig.elapsed - PET_IMPACT_TIME) * 2.1 : 0;
          rig.posY =
            THREE.MathUtils.lerp(rig.startY, rig.targetY + 0.35, easeStrike) + diveArc + postRise;
        } else if (rig.archetype === 'beast') {
          const dashT = Math.min(1.18, easeStrike * 1.12);
          rig.posX = THREE.MathUtils.lerp(rig.startX, rig.targetX, dashT);
          rig.posZ = THREE.MathUtils.lerp(rig.startZ, rig.targetZ, dashT);
          const hop = Math.sin(Math.min(1, strikeT) * Math.PI) * 0.55;
          rig.posY = (rig.isCustomExternal ? 0.08 : 0.72) + hop;
        } else {
          const weave = Math.sin(rig.elapsed * 14) * 0.65 * (1 - strikeT * 0.5);
          const perpX = Math.cos(rig.yaw) * weave;
          const perpZ = -Math.sin(rig.yaw) * weave;
          rig.posX = THREE.MathUtils.lerp(rig.startX, rig.targetX, easeStrike) + perpX;
          rig.posZ = THREE.MathUtils.lerp(rig.startZ, rig.targetZ, easeStrike) + perpZ;
          rig.posY = (rig.isCustomExternal ? 0.45 : 1.15) + Math.sin(rig.elapsed * 10) * 0.35;
        }

        if (rig.elapsed >= PET_ASSIST_STRIKE_DURATION_SEC) {
          rig.phase = 'FOLLOW';
          rig.shotTimer = 0.55; // First auto-shot fires promptly after transitioning into formation!
        }
        continue;
      }

      // Phase 2: Persistent Companion Follow + Auto Elemental Shot every 1.5s (1.15s - 18.0s)
      if (rig.elapsed >= PET_COMPANION_DURATION_SEC) {
        const finishedElement = rig.activeElement;
        rig.active = false;
        rig.activeElement = null;
        rig.group.visible = false;
        rig.group.scale.setScalar(1.0);
        // Post-follow 20s cooldown begins right when the Pet finishes its 18s companion duration!
        this.cooldowns[finishedElement] = PET_POST_FOLLOW_COOLDOWN_SEC;
        continue;
      }

      // Compute distinct non-overlapping wingman formation offset beside the Rider
      let offsetRight = 0;
      let offsetBack = 0;
      let targetHoverY = 1.0;
      if (rig.archetype === 'winged') {
        offsetRight = -1.95;
        offsetBack = -0.85;
        targetHoverY = rig.isCustomExternal ? 2.35 : 2.65;
      } else if (rig.archetype === 'beast') {
        offsetRight = 1.95;
        offsetBack = -0.35;
        targetHoverY = rig.isCustomExternal ? 0.06 : 0.72;
      } else {
        offsetRight = -1.55;
        offsetBack = -1.75;
        targetHoverY = rig.isCustomExternal ? 0.95 : 1.35;
      }

      const desiredX = riderPos.x + rightX * offsetRight + fwdX * offsetBack;
      const desiredZ = riderPos.z + rightZ * offsetRight + fwdZ * offsetBack;

      const prevX = rig.posX;
      const prevZ = rig.posZ;
      rig.posX = THREE.MathUtils.lerp(rig.posX, desiredX, followLerp);
      rig.posY = THREE.MathUtils.lerp(rig.posY, targetHoverY, followLerp);
      rig.posZ = THREE.MathUtils.lerp(rig.posZ, desiredZ, followLerp);
      rig.moveSpeed = Math.hypot(rig.posX - prevX, rig.posZ - prevZ) / Math.max(0.001, dt);

      // Acquire nearest alive monster within PET_SHOT_RANGE (preferring locked-on enemy!)
      const aimTarget = this.findNearestTarget(rig.posX, rig.posZ, targets, preferredTarget);
      if (aimTarget) {
        aimTarget.getPosition(this.scratchTargetPos);
        const dx = this.scratchTargetPos.x - rig.posX;
        const dz = this.scratchTargetPos.z - rig.posZ;
        if (dx * dx + dz * dz > 0.04) {
          rig.yaw = dampAngle(rig.yaw, Math.atan2(dx, dz), 11 * dt);
        }

        if (!freezeCombat) {
          rig.shotTimer -= dt;
          if (rig.shotTimer <= 0 && shotPoolIdx < this.scratchShotPool.length) {
            rig.shotTimer = PET_AUTO_SHOT_INTERVAL_SEC;
            rig.shotRecoilTimer = PET_SHOT_RECOIL_SEC;

            const shotEv = this.scratchShotPool[shotPoolIdx++]!;
            const muzzleOffsetY =
              rig.archetype === 'winged' ? 0.75 : rig.archetype === 'beast' ? 0.85 : 1.05;
            shotEv.element = rig.activeElement;
            shotEv.x = rig.posX + Math.sin(rig.yaw) * 0.65;
            shotEv.y = rig.posY + muzzleOffsetY;
            shotEv.z = rig.posZ + Math.cos(rig.yaw) * 0.65;
            shotEv.targetX = this.scratchTargetPos.x;
            shotEv.targetY = Math.max(0.9, this.scratchTargetPos.y + 0.15);
            shotEv.targetZ = this.scratchTargetPos.z;
            this.activeShots.push(shotEv);
          }
        }
      } else {
        // Patrol cleanly facing the same direction as the Rider when between waves
        rig.yaw = dampAngle(rig.yaw, riderYaw, 8 * dt);
        rig.shotTimer = Math.min(rig.shotTimer, 0.35);
      }
    }

    return this.updateResult;
  }

  public updateVisuals(): void {
    if (this.ultimateArchetype) {
      const t = this.ultimateElapsed;
      const fx = Math.sin(this.ultimateYaw);
      const fz = Math.cos(this.ultimateYaw);
      const rx = Math.cos(this.ultimateYaw);
      const rz = -Math.sin(this.ultimateYaw);

      if (this.ultimateTrinityMode) {
        // TRINITY CONTRACT-BEAST ULTIMATE ASSAULT: All 3 Giant Rigged Pets converging in V-arrowhead formation!
        const surgeT = t < 1.25 ? 0 : Math.min(1, (t - 1.25) / 0.65);
        const easeSurge = 1 - Math.pow(1 - surgeT, 2.6);
        const fadeScale = t < 0.4 ? 0.22 + (t / 0.4) * 0.78 : t > 2.15 ? Math.max(0.05, 1 - (t - 2.15) / 0.5) : 1.0;

        for (let i = 0; i < ARCHETYPES.length; i++) {
          const arch = ARCHETYPES[i]!;
          const rig = this.rigs[arch];
          let baseScale = 2.65;
          let sideOffset = 0;
          let backStart = -2.8;
          let heightStart = 2.2;
          let heightEnd = 1.1;

          if (arch === 'winged') {
            baseScale = 3.05;
            sideOffset = 0;
            backStart = -3.4;
            heightStart = rig.isCustomExternal ? 3.55 : 4.2;
            heightEnd = 1.65;
          } else if (arch === 'beast') {
            baseScale = 2.55;
            sideOffset = 3.8 * (1 - easeSurge * 0.62);
            backStart = -2.4;
            heightStart = rig.isCustomExternal ? 0.25 : 0.9;
            heightEnd = rig.isCustomExternal ? 0.35 : 1.0;
          } else {
            baseScale = 2.65;
            sideOffset = -3.8 * (1 - easeSurge * 0.62);
            backStart = -2.6;
            heightStart = rig.isCustomExternal ? 1.85 : 2.3;
            heightEnd = 1.25;
          }

          const surgeDist = backStart + easeSurge * 8.6;
          const hoverY =
            THREE.MathUtils.lerp(heightStart, heightEnd, easeSurge) + Math.sin(t * 8 + i * 2.1) * 0.25;
          const convergeYaw = this.ultimateYaw - Math.sign(sideOffset) * 0.24 * (1 - easeSurge * 0.6);

          rig.group.scale.setScalar(baseScale * fadeScale);
          rig.group.position.set(
            this.ultimateAnchorX + fx * surgeDist + rx * sideOffset,
            hoverY,
            this.ultimateAnchorZ + fz * surgeDist + rz * sideOffset
          );
          rig.group.rotation.set(
            arch === 'winged' && t > 1.25 ? 0.34 : t > 1.25 ? 0.16 : -0.1,
            convergeYaw,
            Math.sin(t * 10 + i) * 0.12
          );
          this.animateRiggedPetBones(rig, t + i * 0.4, 'STRIKE', 11.0, t > 1.25 ? 0.95 : 0.3, true);
        }
        return;
      }

      const rig = this.rigs[this.ultimateArchetype];
      let scale = 2.75;
      if (t < 0.4) {
        scale = 0.25 + (t / 0.4) * 2.5;
      } else if (t > 2.2) {
        scale = Math.max(0.1, (1 - (t - 2.2) / 0.45) * 2.75);
      }

      const baseHoverY = rig.isCustomExternal ? 1.45 : 2.9;
      const surgeDist = t < 1.38 ? -2.2 : -2.2 + Math.min(1, (t - 1.38) / 0.55) * 8.2;
      const hoverY =
        baseHoverY + Math.sin(t * 7) * 0.22 - (t > 1.38 ? Math.min(1, (t - 1.38) / 0.5) * 0.75 : 0);

      rig.group.scale.setScalar(scale);
      rig.group.position.set(
        this.ultimateAnchorX + fx * surgeDist,
        hoverY,
        this.ultimateAnchorZ + fz * surgeDist
      );
      const bankRoll = rig.isCustomExternal ? Math.sin(t * 10) * 0.1 : 0;
      rig.group.rotation.set(t > 1.38 ? 0.25 : -0.1, this.ultimateYaw, bankRoll);
      this.animateRiggedPetBones(rig, t, 'STRIKE', 9.0, t > 1.38 ? 0.85 : 0.25, true);
      if (rig.wingLeft && rig.wingRight) {
        const flap = Math.sin(t * 16) * 0.55;
        rig.wingLeft.rotation.z = flap;
        rig.wingRight.rotation.z = -flap;
      }
      if (rig.tailPivot) {
        rig.tailPivot.rotation.y = Math.sin(t * 16) * 0.5;
      }
      return;
    }

    for (let i = 0; i < ARCHETYPES.length; i++) {
      const rig = this.rigs[ARCHETYPES[i]!];
      if (!rig.active) continue;

      const remaining = PET_COMPANION_DURATION_SEC - rig.elapsed;
      let scale = rig.phase === 'FOLLOW' ? 0.88 : 1.0;
      if (rig.elapsed < 0.18) {
        scale = 0.15 + (rig.elapsed / 0.18) * 0.85;
      } else if (remaining < PET_DESPAWN_FADE_SEC) {
        scale *= Math.max(0.05, remaining / PET_DESPAWN_FADE_SEC);
      }

      // Crisp recoil pulse when firing an Elemental Shot!
      const recoilT = rig.shotRecoilTimer > 0 ? Math.sin((rig.shotRecoilTimer / PET_SHOT_RECOIL_SEC) * Math.PI) : 0;
      scale *= 1 + recoilT * 0.14;
      rig.group.scale.setScalar(scale);

      const recoilLungeX = Math.sin(rig.yaw) * recoilT * 0.42;
      const recoilLungeZ = Math.cos(rig.yaw) * recoilT * 0.42;

      // Drive real 3D skeletal wingbeats, galloping quadruped limbs, or Asian-dragon undulating coils!
      this.animateRiggedPetBones(rig, rig.elapsed, rig.phase, rig.moveSpeed, recoilT, false);

      if (rig.phase === 'STRIKE') {
        rig.group.position.set(rig.posX, rig.posY, rig.posZ);
        if (rig.archetype === 'winged') {
          const wingRoll = rig.isCustomExternal ? Math.sin(rig.elapsed * 22) * 0.14 : 0;
          rig.group.rotation.set(rig.elapsed < PET_IMPACT_TIME ? 0.45 : -0.35, rig.yaw, wingRoll);
          const flap = Math.sin(rig.elapsed * 26) * 0.65;
          if (rig.wingLeft) rig.wingLeft.rotation.z = flap;
          if (rig.wingRight) rig.wingRight.rotation.z = -flap;
        } else if (rig.archetype === 'beast') {
          rig.group.rotation.set(0, rig.yaw, Math.sin(rig.elapsed * 32) * 0.12);
          if (rig.tailPivot) rig.tailPivot.rotation.y = Math.sin(rig.elapsed * 28) * 0.45;
        } else {
          const serpentRoll = rig.isCustomExternal ? Math.sin(rig.elapsed * 14) * 0.2 : 0;
          rig.group.rotation.set(0, rig.yaw + Math.cos(rig.elapsed * 14) * 0.25, serpentRoll);
          if (rig.tailPivot) rig.tailPivot.rotation.y = Math.sin(rig.elapsed * 18) * 0.6;
        }
        continue;
      }

      // FOLLOW Phase animations (alive hovering, bounding run, serpentine glide + shot recoil pitch!)
      if (rig.archetype === 'winged') {
        const hoverBob = Math.sin(rig.elapsed * 4.8) * 0.22;
        rig.group.position.set(
          rig.posX + recoilLungeX,
          rig.posY + hoverBob,
          rig.posZ + recoilLungeZ
        );
        const wingRoll = Math.sin(rig.elapsed * 6.5) * 0.12;
        rig.group.rotation.set(0.14 + recoilT * 0.28, rig.yaw, wingRoll);
        const flap = Math.sin(rig.elapsed * 14) * 0.5;
        if (rig.wingLeft) rig.wingLeft.rotation.z = flap;
        if (rig.wingRight) rig.wingRight.rotation.z = -flap;
      } else if (rig.archetype === 'beast') {
        const runFactor = Math.min(1, rig.moveSpeed / 6.0);
        const trotHop = Math.abs(Math.sin(rig.elapsed * 13)) * 0.24 * runFactor;
        rig.group.position.set(
          rig.posX + recoilLungeX,
          rig.posY + trotHop,
          rig.posZ + recoilLungeZ
        );
        rig.group.rotation.set(
          -recoilT * 0.22 + runFactor * 0.08,
          rig.yaw,
          Math.sin(rig.elapsed * 13) * 0.08 * runFactor
        );
        if (rig.tailPivot) {
          rig.tailPivot.rotation.y = Math.sin(rig.elapsed * 12) * 0.35;
        }
      } else {
        const glideBob = Math.sin(rig.elapsed * 5.2) * 0.2;
        const glideSway = Math.cos(rig.elapsed * 4.0) * 0.22;
        rig.group.position.set(
          rig.posX + recoilLungeX + Math.cos(rig.yaw) * glideSway,
          rig.posY + glideBob,
          rig.posZ + recoilLungeZ - Math.sin(rig.yaw) * glideSway
        );
        rig.group.rotation.set(
          recoilT * 0.22,
          rig.yaw + Math.sin(rig.elapsed * 4.5) * 0.14,
          Math.sin(rig.elapsed * 6.0) * 0.15
        );
        if (rig.tailPivot) {
          rig.tailPivot.rotation.y = Math.sin(rig.elapsed * 14) * 0.5;
        }
      }
    }
  }

  public dispose(): void {
    this.resetAll();
    for (let i = 0; i < this.ownedMaterials.length; i++) {
      this.ownedMaterials[i]!.dispose();
    }
    this.ownedMaterials.length = 0;
  }

  private animateRiggedPetBones(
    rig: PooledPetRig,
    t: number,
    phase: PetPhase,
    moveSpeed: number,
    recoilT: number,
    isUltimate: boolean
  ): void {
    const b = rig.bones;
    if (rig.archetype === 'winged') {
      // 8-Bone Avian Rig: 2-joint aerodynamic flapping wings (outer wingtips trail inner wing by 0.72 rad!)
      const isFast = phase === 'STRIKE' || isUltimate || recoilT > 0.1;
      const freq = isFast ? 15.5 : 8.8;
      const amp = isFast ? 0.56 : 0.44;
      const innerFlap = Math.sin(t * freq) * amp;
      const outerWhip = Math.sin(t * freq - 0.72) * (amp * 0.72);
      const diveSweep = phase === 'STRIKE' ? -0.32 : -0.08;

      if (b.wingLIn) b.wingLIn.rotation.set(0.06, diveSweep, innerFlap);
      if (b.wingLOut) b.wingLOut.rotation.set(0, -0.08, outerWhip);
      if (b.wingRIn) b.wingRIn.rotation.set(0.06, -diveSweep, -innerFlap);
      if (b.wingROut) b.wingROut.rotation.set(0, 0.08, -outerWhip);
      if (b.body) b.body.rotation.set(Math.sin(t * freq) * 0.08, 0, Math.sin(t * 3.8) * 0.06);
      if (b.head) b.head.rotation.set(recoilT * 0.42 - Math.sin(t * freq) * 0.12, Math.sin(t * 2.7) * 0.16, 0);
      if (b.tail) b.tail.rotation.set(-Math.sin(t * freq) * 0.32, Math.sin(t * 4.2) * 0.18, 0);
      if (b.talons) b.talons.rotation.set(phase === 'STRIKE' ? -0.58 : 0.25 + Math.sin(t * freq) * 0.14, 0, 0);
      return;
    }

    if (rig.archetype === 'beast') {
      // 9-Bone Quadruped Beast Rig: bounding 4-leg gallop synced to movement speed + snapping jaw & whip tail!
      const runIntensity =
        phase === 'STRIKE' || isUltimate ? 1.0 : Math.min(1, 0.28 + (moveSpeed / 5.5) * 0.72);
      const strideFreq = phase === 'STRIKE' || isUltimate ? 16.0 : 8.0 + runIntensity * 6.5;
      const frontSwing = Math.sin(t * strideFreq) * 0.62 * runIntensity;
      const frontAlt = Math.sin(t * strideFreq + 0.55) * 0.62 * runIntensity;
      const backSwing = Math.sin(t * strideFreq + Math.PI) * 0.65 * runIntensity;
      const backAlt = Math.sin(t * strideFreq + Math.PI + 0.55) * 0.65 * runIntensity;

      if (b.body) b.body.rotation.set(Math.sin(t * strideFreq) * 0.12 * runIntensity, 0, 0);
      if (b.chest) b.chest.rotation.set(-Math.sin(t * strideFreq) * 0.14 * runIntensity + recoilT * 0.22, 0, 0);
      if (b.head) b.head.rotation.set(-0.08 - recoilT * 0.36 + Math.sin(t * 5.0) * 0.08, Math.sin(t * 3.2) * 0.14, 0);
      if (b.frontLegL) b.frontLegL.rotation.set(frontSwing - recoilT * 0.32, 0, 0);
      if (b.frontLegR) b.frontLegR.rotation.set(frontAlt - recoilT * 0.32, 0, 0);
      if (b.backLegL) b.backLegL.rotation.set(backSwing, 0, 0);
      if (b.backLegR) b.backLegR.rotation.set(backAlt, 0, 0);
      if (b.tailBase) b.tailBase.rotation.set(0.18 + Math.sin(t * 9) * 0.18, Math.sin(t * 11) * 0.42, 0);
      if (b.tailTip) b.tailTip.rotation.set(Math.sin(t * 9 - 0.8) * 0.24, Math.sin(t * 11 - 0.8) * 0.55, 0);
      return;
    }

    // 7-Bone Coiled Asian Dragon Rig: fluid sinusoidal slither wave rippling from Head -> Neck -> Coil -> Tail!
    const waveFreq = phase === 'STRIKE' || isUltimate ? 9.5 : 5.4;
    if (b.body) {
      b.body.rotation.set(Math.sin(t * waveFreq * 0.8) * 0.1, Math.sin(t * waveFreq) * 0.24, Math.cos(t * waveFreq) * 0.12);
    }
    if (b.dragonNeck) {
      b.dragonNeck.rotation.set(recoilT * 0.36 + Math.sin(t * waveFreq - 0.7) * 0.18, Math.sin(t * waveFreq - 0.8) * 0.3, 0);
    }
    if (b.head) {
      b.head.rotation.set(recoilT * 0.45 - Math.sin(t * waveFreq - 1.2) * 0.15, -Math.sin(t * waveFreq - 0.9) * 0.22, 0);
    }
    if (b.dragonLowerCoil) {
      b.dragonLowerCoil.rotation.set(Math.sin(t * waveFreq + 0.8) * 0.18, Math.sin(t * waveFreq + 0.9) * 0.34, Math.cos(t * waveFreq + 0.8) * 0.16);
    }
    if (b.dragonTailMid) {
      b.dragonTailMid.rotation.set(Math.sin(t * waveFreq + 1.6) * 0.22, Math.sin(t * waveFreq + 1.7) * 0.44, 0);
    }
    if (b.tailTip) {
      b.tailTip.rotation.set(Math.sin(t * waveFreq + 2.4) * 0.28, Math.sin(t * waveFreq + 2.5) * 0.58, 0);
    }
    if (b.dragonClaws) {
      b.dragonClaws.rotation.set(-0.15 + Math.sin(t * waveFreq * 1.2) * 0.34 - recoilT * 0.55, 0, Math.sin(t * waveFreq) * 0.18);
    }
  }

  private findNearestTarget(
    x: number,
    z: number,
    targets: readonly HurtboxTarget[],
    preferredTarget: HurtboxTarget | null
  ): HurtboxTarget | null {
    const maxSq = PET_SHOT_RANGE * PET_SHOT_RANGE;
    if (preferredTarget && preferredTarget.isAlive) {
      preferredTarget.getPosition(this.scratchTargetPos);
      const dx = this.scratchTargetPos.x - x;
      const dz = this.scratchTargetPos.z - z;
      if (dx * dx + dz * dz <= maxSq) {
        return preferredTarget;
      }
    }

    let best: HurtboxTarget | null = null;
    let bestSq = maxSq;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      if (!t.isAlive) continue;
      t.getPosition(this.scratchTargetPos);
      const dx = this.scratchTargetPos.x - x;
      const dz = this.scratchTargetPos.z - z;
      const distSq = dx * dx + dz * dz;
      if (distSq < bestSq) {
        bestSq = distSq;
        best = t;
      }
    }
    return best;
  }

  private tintRigForElement(rig: PooledPetRig, element: ElementId): void {
    const cfg = getElementConfig(element);
    rig.armorMat.color.set(cfg.primaryColor);
    rig.glowMat.color.set(cfg.emissiveColor);
    rig.glowMat.emissive.set(cfg.emissiveColor);

    if (rig.isCustomExternal && rig.armorHueUniforms.length > 0) {
      // All 3 sculpted Contract-Beast masters are authored with crimson armor + gunmetal frame + champagne gold trim
      // so attachSelectiveArmorColorShift cleanly recolors every non-Pyro element!
      for (let i = 0; i < rig.armorHueUniforms.length; i++) {
        const u = rig.armorHueUniforms[i]!;
        if (element === 'pyro') {
          u.uHueMix.value = 0.0;
        } else {
          u.uArmorTargetColor.value.set(cfg.primaryColor);
          u.uHueMix.value = 1.0;
        }
      }
    }
  }

  private resetActiveSummons(): void {
    for (let i = 0; i < ARCHETYPES.length; i++) {
      const rig = this.rigs[ARCHETYPES[i]!];
      rig.active = false;
      rig.activeElement = null;
      rig.phase = 'STRIKE';
      rig.elapsed = 0;
      rig.shotRecoilTimer = 0;
      rig.group.visible = false;
      rig.group.scale.setScalar(1.0);
    }
  }
}

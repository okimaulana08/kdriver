import * as THREE from 'three';
import type { AssetLoader } from '../../engine/AssetLoader';
import { HumanoidBoneDriver } from '../../engine/HumanoidBoneDriver';
import {
  bindPbrMaterials,
  createAccentArmorMaterial,
  createClothMaterial,
  createCompoundEyeMaterial,
  createMetallicTrimMaterial,
  createRiderArmorMaterial,
  createUndersuitMaterial,
  type ArmorHueShiftUniforms,
  type PbrTextureSet,
} from '../../engine/PbrMaterialSystem';
import type { InputManager, MoveInput2D } from '../../engine/InputManager';
import { PLAYER_CAPSULE_RADIUS, PLAYER_SPAWN_Y } from '../../engine/PhysicsWorld';
import { findRigSocket, SkeletalAnimator } from '../../engine/SkeletalAnimator';
import {
  DODGE_SPEED,
  PlayerFSM,
  RIDER_KICK_DIVE_END_SEC,
  RIDER_KICK_IMPACT_TIME_SEC,
  RIDER_KICK_VAULT_END_SEC,
  type PlayerFSMInput,
  type PlayerIncomingHitOutcome,
} from '../combat/PlayerFSM';
import {
  ALL_ELEMENT_IDS,
  getElementConfig,
  getElementLevelDamageMultiplier,
} from '../data/elements';
import type {
  ElementConfig,
  ElementId,
  FormTier,
  HurtboxTarget,
  PlayerStateId,
  Vec3Snapshot,
} from '../types/schema';
import { SlashTrail } from '../vfx/SlashTrail';

const PLAYER_MOVE_SPEED = 8.8;
const PLAYER_TURN_SPEED = 16.0;
const PLAYER_MAX_HP = 220;
const RECENT_SWITCH_WINDOW_SEC = 2.0;
export const SUPER_FORM_DURATION_SEC = 32.0;
export const SUPER_FORM_MAX_DURATION_SEC = 40.0;
export const ULTIMATE_FORM_DURATION_SEC = 25.0;
export const ULTIMATE_FORM_MAX_DURATION_SEC = 32.0;
export const FINISHER_COOLDOWN_SEC = 7.0;
export const FINISHER_SUPER_DURATION_COST_SEC = 7.0;
export const ULTIMATE_UNLOCK_REMAINING_SEC = 10.0;
export const ULTIMATE_IMPACT_TIME_SEC = 1.9;
export const WARP_COUNTER_WINDOW_SEC = 1.45;
export const WARP_COUNTER_DAMAGE_MULTIPLIER = 1.65;
const BASIC_GAUGE_ACCELERATION = 1.45;
const SUPER_OVERDRIVE_MULTIPLIER = 2.8;
const SUPER_PASSIVE_OVERDRIVE_PER_SEC = 2.2;

export interface PlayerDesiredMovement {
  dx: number;
  dz: number;
}

export interface PlayerFrameEvents {
  startedSwingStep: 0 | 1 | 2 | 3;
  triggeredWarpCounter: boolean;
  startedDodge: boolean;
  startedSkillElement: ElementId | null;
  startedRiderKick: boolean;
  riderKickImpactThisStep: boolean;
  switchedToElement: ElementId | null;
  startedHenshinSuper: boolean;
  startedHenshinUltimate: boolean;
  startedUltimateFinisher: boolean;
  ultimateImpactThisStep: boolean;
  ultimateExplosionPulseThisStep: boolean;
  hitboxActive: boolean;
  skillHitboxActive: boolean;
  swingId: number;
  skillId: number;
  state: PlayerStateId;
}

/**
 * Stylized Kamen Rider driven by the sculpted `rider_base.glb` shared rig + named bone sockets
 * (`RightHand`, `LeftHand`, `ChestArmor`, `ShoulderL`, `ShoulderR`, `BackWing`),
 * custom Fresnel Cel-Shader + Ink Outlines, swappable `.glb` elemental weapons, and Super/Ultimate forms.
 */
export class PlayerRider implements HurtboxTarget {
  public readonly id = 'player_rider';
  public readonly radius = PLAYER_CAPSULE_RADIUS;
  public readonly root = new THREE.Group();
  public readonly slashTrail: SlashTrail;
  public readonly fsm = new PlayerFSM();

  private loadoutOrder: [ElementId, ElementId, ElementId] = ['pyro', 'volt', 'aqua'];
  private activeElementId: ElementId;
  private elementConfig: ElementConfig;
  private gemLevels: Partial<Record<ElementId, number>> = { pyro: 1, volt: 1, aqua: 1 };
  private formTier: FormTier = 'BASIC';
  private hp = PLAYER_MAX_HP;
  private maxHp = PLAYER_MAX_HP;
  private driverGauge = 0;
  private overdriveGauge = 0;
  private superFormRemainingSec = 0;
  private finisherCooldownSec = 0;
  private pendingHenshinTargetTier: 'SUPER' | 'ULTIMATE' = 'SUPER';
  private preCinematicFormTier: FormTier = 'SUPER';
  private preCinematicRemainingSec = 0;

  private ultimateImpactFired = false;
  private ultimatePostExplosionsFired = 0;
  private riderKickImpactFired = false;
  private riderKickDiveSpeed = 15.0;

  private readonly skillCooldowns: Record<ElementId, number> = {
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
  private recentSwitchTimer = 0;
  private warpCounterTimer = 0;
  private activeSwingIsWarpCounter = false;
  private passiveRegenAccumulator = 0;

  private yaw = Math.PI;
  private animTime = 0;
  private hitFlashRemaining = 0;
  private dodgeFlashRemaining = 0;
  private beltGestureTimer = 0;
  private beltBurstTimer = 0;
  private prevState: PlayerStateId = 'IDLE';
  private prevHitboxActive = false;

  private dodgeDirX = 0;
  private dodgeDirZ = 1;
  private hitstunVelX = 0;
  private hitstunVelZ = 0;

  // Named GLB Rig Sockets & Pivots
  private readonly bodyPivot: THREE.Object3D;
  private readonly torsoPivot: THREE.Object3D;
  private readonly headPivot: THREE.Object3D;
  private readonly leftArmPivot: THREE.Object3D;
  private readonly rightArmPivot: THREE.Object3D;
  private readonly leftHandSocket: THREE.Object3D;
  private readonly rightHandSocket: THREE.Object3D;
  private readonly leftLegPivot: THREE.Object3D;
  private readonly rightLegPivot: THREE.Object3D;
  private readonly scarfUpperPivot: THREE.Object3D;
  private readonly scarfLowerPivot: THREE.Object3D;
  private readonly backWingSocket: THREE.Object3D;
  private readonly superLeftWingPivot: THREE.Object3D;
  private readonly superRightWingPivot: THREE.Object3D;

  private readonly weaponBaseMarker = new THREE.Object3D();
  private readonly weaponTipMarker = new THREE.Object3D();

  // Swappable .glb & procedural PBR elemental weapons (4 Archetypes across 10 Elements!)
  private readonly pyroGreatsword: THREE.Group;
  private readonly voltRightDagger: THREE.Group;
  private readonly voltLeftDagger: THREE.Group;
  private readonly aquaTrident: THREE.Group;
  private readonly rangedBowGroup: THREE.Group;
  private readonly rangedGunRightGroup: THREE.Group;
  private readonly rangedGunLeftGroup: THREE.Group;
  private readonly customRightWeapons = new Map<ElementId, THREE.Group>();
  private readonly customLeftWeapons = new Map<ElementId, THREE.Group>();
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];

  // Skeletal Animation Controller (activates automatically for Mixamo / Meshy rigged .glb!)
  public readonly isCustomSkeletalRig: boolean;
  private readonly basicRigHost: THREE.Group;
  private readonly skeletalAnimator: SkeletalAnimator;
  private readonly boneDriver: HumanoidBoneDriver;
  private readonly hubHeadBone: THREE.Object3D | null;
  // Solved directly against rider.glb Idle_5 so chest/neck stay 100% undeformed while Head gazes straight forward (0° yaw, +2° pitch)
  private readonly hubHeadLiftQuat = new THREE.Quaternion(
    -0.3361,
    -0.1486,
    0.1052,
    0.9241
  ).normalize();
  private readonly superRigHost: THREE.Group | null;
  private readonly superSkeletalAnimator: SkeletalAnimator | null;
  private readonly superBoneDriver: HumanoidBoneDriver | null;
  private readonly superRightHandSocket: THREE.Object3D | null;
  private readonly superLeftHandSocket: THREE.Object3D | null;
  private readonly ultimateRigHost: THREE.Group | null;
  private readonly ultimateSkeletalAnimator: SkeletalAnimator | null;
  private readonly ultimateBoneDriver: HumanoidBoneDriver | null;
  private readonly ultimateRightHandSocket: THREE.Object3D | null;
  private readonly ultimateLeftHandSocket: THREE.Object3D | null;
  private activeBodyMode: FormTier = 'BASIC';
  private prevVisualState: PlayerStateId | null = null;
  private prevVisualSwingId = -1;
  private readonly externalMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly armorHueUniforms: ArmorHueShiftUniforms[] = [];

  // Live-Action PBR Tokusatsu Materials (Clearcoat Fiberglass, Ribbed Undersuit, Compound Eyes)
  private readonly armorMat: THREE.MeshPhysicalMaterial;
  private readonly accentArmorMat: THREE.MeshPhysicalMaterial;
  private readonly undersuitMat: THREE.MeshStandardMaterial;
  private readonly bladeCoreMat: THREE.MeshPhysicalMaterial;
  private readonly scarfMat: THREE.MeshStandardMaterial;
  private readonly metallicMat: THREE.MeshPhysicalMaterial;
  private readonly emissiveMat: THREE.MeshPhysicalMaterial;
  private readonly superGoldMat: THREE.MeshPhysicalMaterial;
  private readonly superWingMat: THREE.MeshStandardMaterial;
  private readonly bladeEdgeMat: THREE.MeshStandardMaterial;

  private readonly dodgeRingMat: THREE.MeshBasicMaterial;
  private readonly dodgeRingMesh: THREE.Mesh;
  private readonly superAuraRingMat: THREE.MeshBasicMaterial;
  private readonly superAuraRingMesh: THREE.Mesh;
  private readonly beltBurstRingMat: THREE.MeshBasicMaterial;
  private readonly beltBurstRingMesh: THREE.Mesh;
  private readonly riderKickConeMat: THREE.MeshBasicMaterial;
  private readonly riderKickConeMesh: THREE.Mesh;
  private readonly ownedMaterials: THREE.Material[] = [];

  // Reusable scratch objects (Zero-Allocation Hot Path)
  private readonly scratchMoveInput: MoveInput2D = { x: 0, z: 0 };
  private readonly scratchForward = new THREE.Vector3();
  private readonly scratchRight = new THREE.Vector3();
  private readonly scratchMoveDir = new THREE.Vector3();
  private readonly scratchWeaponBaseWorld = new THREE.Vector3();
  private readonly scratchWeaponTipWorld = new THREE.Vector3();
  private readonly scratchFsmInput: PlayerFSMInput = {
    isMoving: false,
    wantsAttack: false,
    wantsDodge: false,
    wantsSkill: false,
    wantsRiderKick: false,
    wantsFormSwitch: false,
    wantsHenshinSuper: false,
    wantsUltimateFinisher: false,
    attackSpeed: 1.0,
  };
  private readonly frameEvents: PlayerFrameEvents = {
    startedSwingStep: 0,
    triggeredWarpCounter: false,
    startedDodge: false,
    startedSkillElement: null,
    startedRiderKick: false,
    riderKickImpactThisStep: false,
    switchedToElement: null,
    startedHenshinSuper: false,
    startedHenshinUltimate: false,
    startedUltimateFinisher: false,
    ultimateImpactThisStep: false,
    ultimateExplosionPulseThisStep: false,
    hitboxActive: false,
    skillHitboxActive: false,
    swingId: 0,
    skillId: 0,
    state: 'IDLE',
  };

  constructor(
    assetLoader: AssetLoader,
    pbrTextures: PbrTextureSet,
    initialElement: ElementId = 'pyro'
  ) {
    this.activeElementId = initialElement;
    this.elementConfig = getElementConfig(initialElement);
    this.slashTrail = new SlashTrail();

    const primaryHex = new THREE.Color(this.elementConfig.primaryColor).getHex();
    const emissiveHex = new THREE.Color(this.elementConfig.emissiveColor).getHex();

    // Live-action Tokusatsu PBR materials (Kuuga/Ryuki fiberglass clearcoat + ribbed undersuit + compound eyes)
    this.undersuitMat = createUndersuitMaterial(pbrTextures);
    this.armorMat = createRiderArmorMaterial(primaryHex, pbrTextures);
    this.accentArmorMat = createAccentArmorMaterial(0xd1d5db, pbrTextures);
    this.bladeCoreMat = createMetallicTrimMaterial(0x334155);
    this.scarfMat = createClothMaterial(primaryHex);
    this.metallicMat = createMetallicTrimMaterial(0xdbeafe);
    this.emissiveMat = createCompoundEyeMaterial(emissiveHex, pbrTextures, 1.75);
    this.superGoldMat = createMetallicTrimMaterial(0xeab308, 0xb45309, 0.35);
    this.superWingMat = new THREE.MeshStandardMaterial({
      color: emissiveHex,
      emissive: emissiveHex,
      emissiveIntensity: 2.1,
      transparent: true,
      opacity: 0.84,
      roughness: 0.14,
      metalness: 0.25,
    });
    this.bladeEdgeMat = new THREE.MeshStandardMaterial({
      color: emissiveHex,
      emissive: emissiveHex,
      emissiveIntensity: 1.9,
      roughness: 0.16,
      metalness: 0.55,
    });

    this.dodgeRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    this.superAuraRingMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.beltBurstRingMat = new THREE.MeshBasicMaterial({
      color: emissiveHex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.ownedMaterials.push(
      this.undersuitMat,
      this.armorMat,
      this.accentArmorMat,
      this.bladeCoreMat,
      this.scarfMat,
      this.metallicMat,
      this.emissiveMat,
      this.superGoldMat,
      this.superWingMat,
      this.bladeEdgeMat,
      this.dodgeRingMat,
      this.superAuraRingMat,
      this.beltBurstRingMat
    );

    const roleMaterials: Record<string, THREE.Material> = {
      undersuit: this.undersuitMat,
      armor: this.armorMat,
      accent: this.accentArmorMat,
      metallic: this.metallicMat,
      emissive: this.emissiveMat,
      scarf: this.scarfMat,
      super_gold: this.superGoldMat,
      super_wing: this.superWingMat,
      blade_core: this.bladeCoreMat,
      blade_edge: this.bladeEdgeMat,
    };

    // Clone Rider .glb rig (automatically supports SkeletonUtils.clone for Mixamo/Tripo3D SkinnedMeshes!)
    const clonedRig = assetLoader.cloneRig('rider_base');
    const riderRig = clonedRig.scene;
    const rigHost = new THREE.Group();
    rigHost.name = 'RiderVisualHost';
    if (clonedRig.isCustomExternal) {
      // Custom normalized rigs are grounded at y=0, whereas capsule root sits at y=PLAYER_SPAWN_Y
      riderRig.position.y = -PLAYER_SPAWN_Y;
    }
    rigHost.add(riderRig);
    this.basicRigHost = rigHost;

    const externalMats = bindPbrMaterials(riderRig, roleMaterials, {
      preserveExternalPbr: true,
      envMapIntensity: 1.45,
      enableArmorHueShift: true,
    });
    this.externalMaterials.push(...externalMats);
    this.ownedMaterials.push(...externalMats);
    for (let i = 0; i < externalMats.length; i++) {
      const u = externalMats[i]!.userData.armorHueShiftUniforms as ArmorHueShiftUniforms | undefined;
      if (u) this.armorHueUniforms.push(u);
    }

    this.skeletalAnimator = new SkeletalAnimator(riderRig, clonedRig.animations);
    this.boneDriver = new HumanoidBoneDriver(riderRig);
    this.hubHeadBone =
      riderRig.getObjectByName('Head') ??
      riderRig.getObjectByName('head') ??
      riderRig.getObjectByName('mixamorigHead') ??
      null;
    this.isCustomSkeletalRig =
      clonedRig.isCustomExternal ||
      this.boneDriver.isActive ||
      (clonedRig.isSkinned && this.skeletalAnimator.hasClips);
    if (this.skeletalAnimator.hasClips) {
      this.skeletalAnimator.playState('IDLE', { loop: true });
    }
    this.root.add(rigHost);

    // Bind procedural pivots or real 24/65-bone humanoid calibrated mounts!
    const foundBody = assetLoader.findSocket(riderRig, 'BodyPivot');
    this.bodyPivot = foundBody ?? rigHost;
    this.torsoPivot =
      assetLoader.findSocket(riderRig, 'TorsoPivot') ??
      findRigSocket(riderRig, 'ChestArmor') ??
      new THREE.Group();
    this.headPivot = findRigSocket(riderRig, 'HeadPivot') ?? new THREE.Group();
    this.leftArmPivot = assetLoader.findSocket(riderRig, 'LeftArmPivot') ?? new THREE.Group();
    this.rightArmPivot = assetLoader.findSocket(riderRig, 'RightArmPivot') ?? new THREE.Group();

    const calibratedLeft = this.boneDriver.isActive
      ? this.boneDriver.createCalibratedHandMount('LeftHand')
      : null;
    const foundLeftHand = calibratedLeft ?? findRigSocket(riderRig, 'LeftHand');
    if (foundLeftHand) {
      this.leftHandSocket = foundLeftHand;
    } else {
      const syntheticLeft = new THREE.Group();
      syntheticLeft.name = 'SyntheticLeftHand';
      syntheticLeft.position.set(0.48, -PLAYER_SPAWN_Y + 0.88, 0.1);
      rigHost.add(syntheticLeft);
      this.leftHandSocket = syntheticLeft;
    }

    const calibratedRight = this.boneDriver.isActive
      ? this.boneDriver.createCalibratedHandMount('RightHand')
      : null;
    const foundRightHand = calibratedRight ?? findRigSocket(riderRig, 'RightHand');
    if (foundRightHand) {
      this.rightHandSocket = foundRightHand;
    } else {
      const syntheticRight = new THREE.Group();
      syntheticRight.name = 'SyntheticRightHand';
      syntheticRight.position.set(-0.48, -PLAYER_SPAWN_Y + 0.88, 0.1);
      rigHost.add(syntheticRight);
      this.rightHandSocket = syntheticRight;
    }

    this.leftLegPivot = assetLoader.findSocket(riderRig, 'LeftLegPivot') ?? new THREE.Group();
    this.rightLegPivot = assetLoader.findSocket(riderRig, 'RightLegPivot') ?? new THREE.Group();
    this.scarfUpperPivot = assetLoader.findSocket(riderRig, 'ScarfUpperPivot') ?? new THREE.Group();
    this.scarfLowerPivot = assetLoader.findSocket(riderRig, 'ScarfLowerPivot') ?? new THREE.Group();

    const calibratedBack = this.boneDriver.isActive
      ? this.boneDriver.createCalibratedBackMount()
      : null;
    const foundBackWing = calibratedBack ?? findRigSocket(riderRig, 'BackWing');
    if (foundBackWing) {
      this.backWingSocket = foundBackWing;
    } else {
      const syntheticBack = new THREE.Group();
      syntheticBack.name = 'SyntheticBackWing';
      syntheticBack.position.set(0, -PLAYER_SPAWN_Y + 1.32, -0.16);
      rigHost.add(syntheticBack);
      this.backWingSocket = syntheticBack;
    }
    this.superLeftWingPivot =
      assetLoader.findSocket(riderRig, 'SuperLeftWingPivot') ?? new THREE.Group();
    this.superRightWingPivot =
      assetLoader.findSocket(riderRig, 'SuperRightWingPivot') ?? new THREE.Group();

    // Optional dedicated Super Form (`rider_super`) & Ultimate Form (`rider_ultimate`) 3D rigs
    const setupOptionalFormRig = (
      optKey: 'rider_super' | 'rider_ultimate',
      hostName: string
    ) => {
      const cloned = assetLoader.cloneOptionalRig(optKey);
      if (!cloned) return null;
      const host = new THREE.Group();
      host.name = hostName;
      const rigScene = cloned.scene;
      rigScene.position.y = -PLAYER_SPAWN_Y;
      host.add(rigScene);
      host.visible = false;

      const extMats = bindPbrMaterials(rigScene, roleMaterials, {
        preserveExternalPbr: true,
        envMapIntensity: 1.5,
        enableArmorHueShift: true,
      });
      this.externalMaterials.push(...extMats);
      this.ownedMaterials.push(...extMats);
      for (let i = 0; i < extMats.length; i++) {
        const u = extMats[i]!.userData.armorHueShiftUniforms as ArmorHueShiftUniforms | undefined;
        if (u) this.armorHueUniforms.push(u);
      }

      const animator = new SkeletalAnimator(rigScene, cloned.animations);
      const driver = new HumanoidBoneDriver(rigScene);
      if (animator.hasClipForState('IDLE')) {
        animator.playState('IDLE', { loop: true });
      }

      const calR = driver.isActive ? driver.createCalibratedHandMount('RightHand') : null;
      const calL = driver.isActive ? driver.createCalibratedHandMount('LeftHand') : null;

      let rightSock: THREE.Object3D;
      if (calR) {
        rightSock = calR;
      } else {
        const synR = new THREE.Group();
        synR.name = `${hostName}SyntheticRightHand`;
        synR.position.set(-0.46, -PLAYER_SPAWN_Y + 0.94, 0.14);
        synR.rotation.set(0.18, 0, -0.1);
        synR.scale.setScalar(0.72);
        host.add(synR);
        rightSock = synR;
      }

      let leftSock: THREE.Object3D;
      if (calL) {
        leftSock = calL;
      } else {
        const synL = new THREE.Group();
        synL.name = `${hostName}SyntheticLeftHand`;
        synL.position.set(0.46, -PLAYER_SPAWN_Y + 0.94, 0.14);
        synL.rotation.set(0.18, 0, 0.1);
        synL.scale.setScalar(0.72);
        host.add(synL);
        leftSock = synL;
      }

      this.root.add(host);
      return { host, animator, driver, rightSock, leftSock };
    };

    const superSetup = setupOptionalFormRig('rider_super', 'SuperRiderVisualHost');
    this.superRigHost = superSetup?.host ?? null;
    this.superSkeletalAnimator = superSetup?.animator ?? null;
    this.superBoneDriver = superSetup?.driver ?? null;
    this.superRightHandSocket = superSetup?.rightSock ?? null;
    this.superLeftHandSocket = superSetup?.leftSock ?? null;

    const ultimateSetup = setupOptionalFormRig('rider_ultimate', 'UltimateRiderVisualHost');
    this.ultimateRigHost = ultimateSetup?.host ?? null;
    this.ultimateSkeletalAnimator = ultimateSetup?.animator ?? null;
    this.ultimateBoneDriver = ultimateSetup?.driver ?? null;
    this.ultimateRightHandSocket = ultimateSetup?.rightSock ?? null;
    this.ultimateLeftHandSocket = ultimateSetup?.leftSock ?? null;

    // Clone & attach the 3 sculpted .glb elemental weapons into RightHand & LeftHand sockets (works on Mixamo/Meshy bones too!)
    const pyroCloned = assetLoader.cloneRig('weapon_pyro');
    this.pyroGreatsword = pyroCloned.scene;
    this.ownedMaterials.push(
      ...bindPbrMaterials(this.pyroGreatsword, roleMaterials, {
        preserveExternalPbr: true,
        envMapIntensity: 1.55,
      })
    );
    if (this.boneDriver.isActive && pyroCloned.isCustomExternal) {
      // Custom normalized sword has pommel at y=0 and crossguard around y=0.45 -> center leather grip inside clenched fist!
      this.pyroGreatsword.position.set(0, -0.22, 0.02);
    }

    const voltRightCloned = assetLoader.cloneRig('weapon_volt');
    this.voltRightDagger = voltRightCloned.scene;
    this.ownedMaterials.push(
      ...bindPbrMaterials(this.voltRightDagger, roleMaterials, {
        preserveExternalPbr: true,
        envMapIntensity: 1.55,
      })
    );

    const voltLeftCloned = assetLoader.cloneRig('weapon_volt');
    this.voltLeftDagger = voltLeftCloned.scene;
    this.ownedMaterials.push(
      ...bindPbrMaterials(this.voltLeftDagger, roleMaterials, {
        preserveExternalPbr: true,
        envMapIntensity: 1.55,
      })
    );
    if (this.boneDriver.isActive && voltRightCloned.isCustomExternal) {
      // Center lower grip of 1.28m Golden Dagger right inside both clenched fists below the crossguard
      this.voltRightDagger.position.set(0, -0.06, 0.01);
      this.voltLeftDagger.position.set(0, -0.06, 0.01);
    }

    const aquaCloned = assetLoader.cloneRig('weapon_aqua');
    this.aquaTrident = aquaCloned.scene;
    this.ownedMaterials.push(
      ...bindPbrMaterials(this.aquaTrident, roleMaterials, {
        preserveExternalPbr: true,
        envMapIntensity: 1.55,
      })
    );
    if (this.boneDriver.isActive) {
      if (aquaCloned.isCustomExternal) {
        // Grip ~33% up the 2.65m Blue Trident shaft so butt finial clears floor/knee & sapphire prongs frame cleanly!
        this.aquaTrident.position.set(0, -0.88, 0.02);
      } else {
        this.aquaTrident.position.y = 0.42;
      }
    }

    // Build sleek procedural PBR RANGED weapons (Verdant Longbow & Nightfall Dual Pistols)
    this.rangedBowGroup = this.buildProceduralLongbow();
    this.rangedGunRightGroup = this.buildProceduralEnergyPistol();
    this.rangedGunLeftGroup = this.buildProceduralEnergyPistol();

    // Load any optional dedicated Phase 5 sculpted custom weapon `.glb`s from manifest.json!
    // Each weapon uses an explicit grip-pivot calibrated against the animated RightHand/LeftHand mount basis
    // so non-vertical props (Scythe hook, Bow riser vs bowstring, Dual side-profile Pistols) sit squarely
    // inside the clenched fist and point cleanly forward toward enemies.
    const expansionSpecs: readonly {
      elem: ElementId;
      key:
        | 'weapon_terra'
        | 'weapon_aero'
        | 'weapon_flora'
        | 'weapon_solar'
        | 'weapon_lunar'
        | 'weapon_umbra'
        | 'weapon_lux';
      hand: 'right' | 'left' | 'dual';
      gripX: number;
      gripY: number;
      gripZ: number;
      rot: readonly [number, number, number];
      rotLeft?: readonly [number, number, number];
      mountOffsetZ: number;
    }[] = [
      { elem: 'terra', key: 'weapon_terra', hand: 'right', gripX: 0, gripY: 0.45, gripZ: 0, rot: [0, 0, 0], mountOffsetZ: 0.02 },
      { elem: 'aero', key: 'weapon_aero', hand: 'right', gripX: 0, gripY: 0.18, gripZ: 0, rot: [0, 0, 0], mountOffsetZ: 0.02 },
      // Flora bow: fist grips curved emerald riser (-X front faces enemy +Z, +X bowstring stays behind hand -Z)
      { elem: 'flora', key: 'weapon_flora', hand: 'left', gripX: -0.025, gripY: 0.84, gripZ: 0, rot: [1.6028, 0.8843, -2.9797], mountOffsetZ: 0 },
      { elem: 'solar', key: 'weapon_solar', hand: 'right', gripX: 0, gripY: 0.85, gripZ: 0, rot: [0, 0, 0], mountOffsetZ: 0.02 },
      // Lunar scythe: exact shaft axis (gripX=0.203) centered inside fist, shaft upright/clear of torso, crescent forward-outward
      { elem: 'lunar', key: 'weapon_lunar', hand: 'right', gripX: 0.203, gripY: 0.85, gripZ: 0, rot: [-0.8131, 1.3417, 0.2127], mountOffsetZ: 0 },
      // Umbra dual pistols: separate calibrated R/L rotations so BOTH barrels aim parallel forward (+Z) & upright (+Y)
      {
        elem: 'umbra',
        key: 'weapon_umbra',
        hand: 'dual',
        gripX: 0.233,
        gripY: 0.097,
        gripZ: 0,
        rot: [-0.2581, 1.4761, -0.7414],
        rotLeft: [1.7046, 0.922, -3.0584],
        mountOffsetZ: 0,
      },
      { elem: 'lux', key: 'weapon_lux', hand: 'right', gripX: 0, gripY: 0.86, gripZ: 0, rot: [0, 0, 0], mountOffsetZ: 0.02 },
    ];

    const mountCustomWeaponPivot = (
      mesh: THREE.Group,
      spec: (typeof expansionSpecs)[number],
      rotEuler: readonly [number, number, number],
      tag: string
    ): THREE.Group => {
      this.ownedMaterials.push(
        ...bindPbrMaterials(mesh, roleMaterials, {
          preserveExternalPbr: true,
          envMapIntensity: 1.55,
        })
      );
      mesh.position.set(-spec.gripX, -spec.gripY, -spec.gripZ);
      const pivot = new THREE.Group();
      pivot.name = `WeaponPivot_${spec.elem}_${tag}`;
      pivot.rotation.set(rotEuler[0], rotEuler[1], rotEuler[2]);
      pivot.position.set(0, 0, spec.mountOffsetZ);
      pivot.add(mesh);
      pivot.visible = false;
      return pivot;
    };

    for (let i = 0; i < expansionSpecs.length; i++) {
      const spec = expansionSpecs[i]!;
      const clonedW = assetLoader.cloneOptionalRig(spec.key);
      if (!clonedW) continue;
      const pivotPrimary = mountCustomWeaponPivot(
        clonedW.scene,
        spec,
        spec.rot,
        spec.hand === 'left' ? 'L' : 'R'
      );

      if (spec.hand === 'left') {
        this.customLeftWeapons.set(spec.elem, pivotPrimary);
      } else {
        this.customRightWeapons.set(spec.elem, pivotPrimary);
        if (spec.hand === 'dual') {
          const clonedL = assetLoader.cloneOptionalRig(spec.key);
          if (clonedL) {
            const pivotLeft = mountCustomWeaponPivot(
              clonedL.scene,
              spec,
              spec.rotLeft ?? spec.rot,
              'L'
            );
            this.customLeftWeapons.set(spec.elem, pivotLeft);
          }
        }
      }
    }

    this.rightHandSocket.add(
      this.pyroGreatsword,
      this.voltRightDagger,
      this.aquaTrident,
      this.rangedGunRightGroup,
      this.weaponBaseMarker,
      this.weaponTipMarker
    );
    for (const mesh of this.customRightWeapons.values()) {
      this.rightHandSocket.add(mesh);
    }
    this.leftHandSocket.add(this.voltLeftDagger, this.rangedBowGroup, this.rangedGunLeftGroup);
    for (const mesh of this.customLeftWeapons.values()) {
      this.leftHandSocket.add(mesh);
    }

    // Ground & Aura VFX rings
    this.dodgeRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.54, 28),
      this.dodgeRingMat
    );
    this.dodgeRingMesh.rotation.x = -Math.PI / 2;
    this.dodgeRingMesh.position.y = -PLAYER_SPAWN_Y + 0.03;

    this.superAuraRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 1.0, 36),
      this.superAuraRingMat
    );
    this.superAuraRingMesh.rotation.x = -Math.PI / 2;
    this.superAuraRingMesh.position.y = -PLAYER_SPAWN_Y + 0.05;
    this.superAuraRingMesh.visible = false;

    this.beltBurstRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.85, 32),
      this.beltBurstRingMat
    );
    this.beltBurstRingMesh.rotation.x = -Math.PI / 2;
    this.beltBurstRingMesh.position.y = 0.05;
    this.beltBurstRingMesh.visible = false;

    // Flying Rider Kick supersonic elemental energy cone projecting from the Rider's boot!
    this.riderKickConeMat = new THREE.MeshBasicMaterial({
      color: this.elementConfig.emissiveColor,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ownedMaterials.push(this.riderKickConeMat);
    const kickConeGeo = new THREE.ConeGeometry(0.72, 2.35, 18, 1, true);
    kickConeGeo.rotateX(Math.PI / 2 + 0.34);
    this.ownedGeometries.push(kickConeGeo);
    this.riderKickConeMesh = new THREE.Mesh(kickConeGeo, this.riderKickConeMat);
    this.riderKickConeMesh.position.set(-0.14, -0.25, 1.38);
    this.riderKickConeMesh.visible = false;

    this.root.add(
      this.dodgeRingMesh,
      this.superAuraRingMesh,
      this.beltBurstRingMesh,
      this.riderKickConeMesh
    );

    this.applyActiveWeaponMesh(initialElement);
    this.setModularSuperArmorVisible(false);
    this.root.position.set(0, PLAYER_SPAWN_Y, 0);
  }

  public get isAlive(): boolean {
    return this.hp > 0 && !this.fsm.isDead;
  }

  public get currentHp(): number {
    return this.hp;
  }

  public get maximumHp(): number {
    return this.maxHp;
  }

  public get currentDriverGauge(): number {
    return this.driverGauge;
  }

  public get currentOverdriveGauge(): number {
    return this.overdriveGauge;
  }

  public get currentSuperFormRemaining(): number {
    return this.superFormRemainingSec;
  }

  public get currentFinisherCooldown(): number {
    return this.finisherCooldownSec;
  }

  public get currentRiderKickCooldown(): number {
    return this.fsm.riderKickCooldown;
  }

  public get currentCinematicElapsed(): number {
    return this.fsm.isInCinematic ? this.fsm.stateTime : 0;
  }

  public get wasFinisherCastFromUltimate(): boolean {
    return this.preCinematicFormTier === 'ULTIMATE';
  }

  public get isWarpCounterReady(): boolean {
    return this.warpCounterTimer > 0 && this.isAlive && !this.fsm.isInCinematic;
  }

  public get currentWarpCounterRemaining(): number {
    return this.warpCounterTimer;
  }

  public get isActiveSwingWarpCounter(): boolean {
    return this.activeSwingIsWarpCounter;
  }

  public faceToward(targetX: number, targetZ: number): void {
    const dx = targetX - this.root.position.x;
    const dz = targetZ - this.root.position.z;
    if (dx * dx + dz * dz > 0.0004) {
      this.yaw = Math.atan2(dx, dz);
      this.root.rotation.y = this.yaw;
    }
  }

  public get currentElementId(): ElementId {
    return this.activeElementId;
  }

  public get activeElement(): ElementConfig {
    return this.elementConfig;
  }

  public setGemLevels(levels: Readonly<Partial<Record<ElementId, number>>>): void {
    this.gemLevels = { ...levels };
  }

  public getActiveGemLevel(): number {
    return this.gemLevels[this.activeElementId] ?? 1;
  }

  public get currentFormTier(): FormTier {
    return this.formTier;
  }

  public get facingYaw(): number {
    return this.yaw;
  }

  public get isInRecentSwitchWindow(): boolean {
    return this.recentSwitchTimer > 0;
  }

  public getSkillCooldown(id: ElementId): number {
    return this.skillCooldowns[id];
  }

  public canActivateSuperForm(): boolean {
    return this.formTier === 'BASIC' && this.driverGauge >= 100 && this.fsm.canTransformNow();
  }

  public canActivateUltimateForm(bossStaggered: boolean): boolean {
    return (
      this.formTier === 'SUPER' &&
      (this.overdriveGauge >= 100 || bossStaggered) &&
      this.fsm.canTransformNow()
    );
  }

  public canActivateFinisher(): boolean {
    return (
      (this.formTier === 'SUPER' || this.formTier === 'ULTIMATE') &&
      this.finisherCooldownSec <= 0 &&
      this.fsm.canTransformNow()
    );
  }

  public canActivateUltimateFinisher(_bossStaggered: boolean): boolean {
    return this.canActivateFinisher();
  }

  /**
   * Overdrive Sustain: extends remaining Super/Ultimate Form duration on enemy kills & reactions.
   */
  public extendFormDuration(seconds: number): number {
    if (seconds <= 0 || this.formTier === 'BASIC' || this.fsm.isInCinematic) return 0;
    const maxDur =
      this.formTier === 'ULTIMATE' ? ULTIMATE_FORM_MAX_DURATION_SEC : SUPER_FORM_MAX_DURATION_SEC;
    const before = this.superFormRemainingSec;
    this.superFormRemainingSec = Math.min(maxDur, this.superFormRemainingSec + seconds);
    return this.superFormRemainingSec - before;
  }

  public setLoadoutOrder(order: [ElementId, ElementId, ElementId]): void {
    this.loadoutOrder = [...order] as [ElementId, ElementId, ElementId];
    this.setElementTheme(this.loadoutOrder[0]);
  }

  public resetForNewStage(
    order: [ElementId, ElementId, ElementId],
    facingYaw = Math.PI
  ): void {
    this.loadoutOrder = [...order] as [ElementId, ElementId, ElementId];
    this.fsm.reset();
    this.hp = this.maxHp;
    this.driverGauge = 0;
    this.overdriveGauge = 0;
    this.superFormRemainingSec = 0;
    this.finisherCooldownSec = 0;
    this.pendingHenshinTargetTier = 'SUPER';
    this.preCinematicFormTier = 'SUPER';
    this.preCinematicRemainingSec = 0;
    this.formTier = 'BASIC';
    for (let i = 0; i < ALL_ELEMENT_IDS.length; i++) {
      this.skillCooldowns[ALL_ELEMENT_IDS[i]!] = 0;
    }
    this.recentSwitchTimer = 0;
    this.warpCounterTimer = 0;
    this.activeSwingIsWarpCounter = false;
    this.hitFlashRemaining = 0;
    this.dodgeFlashRemaining = 0;
    this.beltBurstTimer = 0;
    this.beltGestureTimer = 0;
    this.prevState = 'IDLE';
    this.prevHitboxActive = false;
    this.ultimateImpactFired = false;
    this.ultimatePostExplosionsFired = 0;
    this.riderKickImpactFired = false;
    this.yaw = facingYaw;
    this.setElementTheme(this.loadoutOrder[0]);
    this.setModularSuperArmorVisible(false);
    this.slashTrail.endSwing();
  }

  public getEffectiveBaseAttack(): number {
    const base = this.elementConfig.weapon.baseDamage;
    const levelMult = getElementLevelDamageMultiplier(this.getActiveGemLevel());
    const passive = this.elementConfig.pet.passiveBonus;
    const passiveMult = passive.stat === 'atk' ? 1 + passive.value : 1.0;
    return base * levelMult * passiveMult;
  }

  public addDriverGauge(amount: number): void {
    if (amount <= 0 || this.formTier === 'ULTIMATE') return;
    const passive = this.elementConfig.pet.passiveBonus;
    const scaled = passive.stat === 'gaugeGain' ? amount * (1 + passive.value) : amount;

    if (this.formTier === 'SUPER') {
      this.overdriveGauge = Math.min(100, this.overdriveGauge + scaled * SUPER_OVERDRIVE_MULTIPLIER);
    } else {
      this.driverGauge = Math.min(100, this.driverGauge + scaled * BASIC_GAUGE_ACCELERATION);
    }
  }

  public heal(amount: number): number {
    if (amount <= 0 || !this.isAlive || this.hp >= this.maxHp) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + Math.round(amount));
    return this.hp - before;
  }

  public triggerBeltGesture(): void {
    this.beltGestureTimer = 0.28;
    this.beltBurstTimer = 0.25;
  }

  public triggerEntryHenshinVisual(): void {
    this.beltBurstTimer = 0.65;
    this.beltGestureTimer = 0.45;
  }

  public getPosition(out: Vec3Snapshot): Vec3Snapshot {
    out.x = this.root.position.x;
    out.y = this.root.position.y;
    out.z = this.root.position.z;
    return out;
  }

  public getForwardXZ(out: { x: number; z: number }): { x: number; z: number } {
    out.x = Math.sin(this.yaw);
    out.z = Math.cos(this.yaw);
    return out;
  }

  public setElementTheme(elementId: ElementId): void {
    this.activeElementId = elementId;
    this.elementConfig = getElementConfig(elementId);
    this.armorMat.color.set(this.elementConfig.primaryColor);
    this.scarfMat.color.set(this.elementConfig.primaryColor);
    this.emissiveMat.color.set(this.elementConfig.emissiveColor);
    this.emissiveMat.emissive.set(this.elementConfig.emissiveColor);
    this.superWingMat.color.set(this.elementConfig.emissiveColor);
    this.superWingMat.emissive.set(this.elementConfig.emissiveColor);
    this.bladeEdgeMat.color.set(this.elementConfig.emissiveColor);
    this.bladeEdgeMat.emissive.set(this.elementConfig.emissiveColor);
    this.beltBurstRingMat.color.set(this.elementConfig.emissiveColor);
    this.riderKickConeMat.color.set(this.elementConfig.emissiveColor);

    // Data-driven selective PBR Armor Hue-Shift on Basic & Super Form sculpted suits (PYRO=native crimson, VOLT=electric gold, AQUA=sapphire blue!)
    for (let i = 0; i < this.armorHueUniforms.length; i++) {
      const u = this.armorHueUniforms[i]!;
      if (elementId === 'pyro') {
        u.uHueMix.value = 0.0;
      } else {
        u.uArmorTargetColor.value.set(this.elementConfig.primaryColor);
        u.uHueMix.value = 1.0;
      }
    }

    this.applyActiveWeaponMesh(elementId);
  }

  public receiveEnemyAttack(
    damage: number,
    knockbackDirX: number,
    knockbackDirZ: number,
    isHeavyAttack = false
  ): PlayerIncomingHitOutcome {
    const hasSuperArmor = this.formTier === 'SUPER' || this.formTier === 'ULTIMATE';
    const effectiveHeavy = this.formTier === 'ULTIMATE' ? false : isHeavyAttack;
    const outcome = this.fsm.receiveIncomingHit(hasSuperArmor, effectiveHeavy);
    if (outcome === 'PERFECT_DODGE') {
      this.dodgeFlashRemaining = 0.45;
      this.warpCounterTimer = WARP_COUNTER_WINDOW_SEC;
      return outcome;
    }
    if (outcome === 'DAMAGED') {
      const mitigated = this.formTier === 'ULTIMATE' ? damage * 0.75 : damage;
      this.hp = Math.max(0, this.hp - Math.max(1, Math.floor(mitigated)));
      this.hitFlashRemaining = 0.22;
      if (this.hp === 0) {
        this.fsm.forceDead();
        this.slashTrail.endSwing();
      } else if (this.fsm.state === 'HITSTUN') {
        this.hitstunVelX = knockbackDirX * 7.5;
        this.hitstunVelZ = knockbackDirZ * 7.5;
        this.slashTrail.endSwing();
      }
    }
    return outcome;
  }

  public fixedUpdate(
    dt: number,
    input: InputManager,
    cameraYaw: number,
    lockTargetPos: THREE.Vector3 | null,
    bossStaggered: boolean,
    controlsLocked: boolean,
    outMove: PlayerDesiredMovement
  ): PlayerFrameEvents {
    for (let i = 0; i < ALL_ELEMENT_IDS.length; i++) {
      const id = ALL_ELEMENT_IDS[i]!;
      if (this.skillCooldowns[id] > 0) {
        this.skillCooldowns[id] = Math.max(0, this.skillCooldowns[id] - dt);
      }
    }

    if (this.recentSwitchTimer > 0) {
      this.recentSwitchTimer = Math.max(0, this.recentSwitchTimer - dt);
    }

    if (this.warpCounterTimer > 0) {
      this.warpCounterTimer = Math.max(0, this.warpCounterTimer - dt);
    }

    if (this.finisherCooldownSec > 0 && !this.fsm.isInCinematic) {
      this.finisherCooldownSec = Math.max(0, this.finisherCooldownSec - dt);
    }

    if (
      (this.formTier === 'SUPER' || this.formTier === 'ULTIMATE') &&
      !this.fsm.isInCinematic &&
      this.fsm.state !== 'HENSHIN_SUPER'
    ) {
      this.superFormRemainingSec = Math.max(0, this.superFormRemainingSec - dt);
      if (this.formTier === 'SUPER') {
        this.overdriveGauge = Math.min(100, this.overdriveGauge + SUPER_PASSIVE_OVERDRIVE_PER_SEC * dt);
      }
      if (this.superFormRemainingSec === 0) {
        this.formTier = 'BASIC';
        this.overdriveGauge = 0;
        this.finisherCooldownSec = 0;
        this.setModularSuperArmorVisible(false);
      }
    }

    const passive = this.elementConfig.pet.passiveBonus;
    if (passive.stat === 'regen' && this.isAlive && this.hp < this.maxHp) {
      this.passiveRegenAccumulator += passive.value * dt;
      if (this.passiveRegenAccumulator >= 1.0) {
        const whole = Math.floor(this.passiveRegenAccumulator);
        this.passiveRegenAccumulator -= whole;
        this.hp = Math.min(this.maxHp, this.hp + whole);
      }
    } else {
      this.passiveRegenAccumulator = 0;
    }

    if (controlsLocked || this.fsm.isDead || this.fsm.isInCinematic) {
      this.scratchMoveInput.x = 0;
      this.scratchMoveInput.z = 0;
    } else {
      input.getMoveInput(this.scratchMoveInput);
    }

    this.scratchForward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    this.scratchRight.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    this.scratchMoveDir
      .set(0, 0, 0)
      .addScaledVector(this.scratchForward, this.scratchMoveInput.z)
      .addScaledVector(this.scratchRight, this.scratchMoveInput.x);

    const hasMoveInput = this.scratchMoveDir.lengthSq() > 0.0001;
    if (hasMoveInput) {
      this.scratchMoveDir.normalize();
    }

    let requestedElement: ElementId | null = null;
    let wantsUltimateFinisher = false;
    let wantsHenshinSuper = false;
    let wantsDodge = false;
    let wantsRiderKick = false;
    let wantsSkill = false;
    let wantsAttack = false;

    if (!controlsLocked && !this.fsm.isDead) {
      if (this.canActivateFinisher() && input.consumeBufferedAction('FINISHER')) {
        wantsUltimateFinisher = true;
      } else if (this.canActivateUltimateForm(bossStaggered) && input.consumeBufferedAction('HENSHIN')) {
        this.pendingHenshinTargetTier = 'ULTIMATE';
        wantsHenshinSuper = true;
      } else if (this.canActivateSuperForm() && input.consumeBufferedAction('HENSHIN')) {
        this.pendingHenshinTargetTier = 'SUPER';
        wantsHenshinSuper = true;
      }

      if (!wantsUltimateFinisher && !wantsHenshinSuper) {
        wantsDodge = this.fsm.canDodgeNow() && input.consumeBufferedAction('DODGE');
        wantsRiderKick =
          !wantsDodge &&
          this.fsm.canRiderKickNow() &&
          input.consumeBufferedAction('RIDER_KICK');
        if (!wantsDodge && !wantsRiderKick && this.fsm.canFormSwitchNow()) {
          if (this.activeElementId !== this.loadoutOrder[0] && input.consumeBufferedAction('SWITCH_1')) {
            requestedElement = this.loadoutOrder[0];
          } else if (
            this.activeElementId !== this.loadoutOrder[1] &&
            input.consumeBufferedAction('SWITCH_2')
          ) {
            requestedElement = this.loadoutOrder[1];
          } else if (
            this.activeElementId !== this.loadoutOrder[2] &&
            input.consumeBufferedAction('SWITCH_3')
          ) {
            requestedElement = this.loadoutOrder[2];
          }
        }

        wantsSkill =
          !wantsDodge &&
          !wantsRiderKick &&
          requestedElement === null &&
          this.skillCooldowns[this.activeElementId] <= 0 &&
          this.fsm.canCastSkillNow() &&
          input.consumeBufferedAction('SKILL');

        wantsAttack =
          !wantsDodge &&
          !wantsRiderKick &&
          requestedElement === null &&
          !wantsSkill &&
          this.fsm.canAcceptAttackNow() &&
          input.consumeBufferedAction('ATTACK');
      }
    }

    const effectiveAttackSpeed =
      this.elementConfig.weapon.attackSpeed *
      (this.formTier === 'ULTIMATE' ? 1.22 : this.formTier === 'SUPER' ? 1.15 : 1.0);

    this.scratchFsmInput.isMoving = hasMoveInput;
    this.scratchFsmInput.wantsAttack = wantsAttack;
    this.scratchFsmInput.wantsDodge = wantsDodge;
    this.scratchFsmInput.wantsRiderKick = wantsRiderKick;
    this.scratchFsmInput.wantsSkill = wantsSkill;
    this.scratchFsmInput.wantsFormSwitch = requestedElement !== null;
    this.scratchFsmInput.wantsHenshinSuper = wantsHenshinSuper;
    this.scratchFsmInput.wantsUltimateFinisher = wantsUltimateFinisher;
    this.scratchFsmInput.attackSpeed = effectiveAttackSpeed;

    const prevSwingId = this.fsm.swingId;
    const prevSkillId = this.fsm.skillId;
    const prevKickId = this.fsm.kickId;
    const nextState = this.fsm.update(dt, this.scratchFsmInput);
    const enteredNewState =
      nextState !== this.prevState ||
      this.fsm.swingId !== prevSwingId ||
      this.fsm.skillId !== prevSkillId ||
      this.fsm.kickId !== prevKickId;

    this.frameEvents.startedSwingStep = 0;
    this.frameEvents.triggeredWarpCounter = false;
    this.frameEvents.startedDodge = false;
    this.frameEvents.startedSkillElement = null;
    this.frameEvents.startedRiderKick = false;
    this.frameEvents.riderKickImpactThisStep = false;
    this.frameEvents.switchedToElement = null;
    this.frameEvents.startedHenshinSuper = false;
    this.frameEvents.startedHenshinUltimate = false;
    this.frameEvents.startedUltimateFinisher = false;
    this.frameEvents.ultimateImpactThisStep = false;
    this.frameEvents.ultimateExplosionPulseThisStep = false;
    this.frameEvents.state = nextState;
    this.frameEvents.swingId = this.fsm.swingId;
    this.frameEvents.skillId = this.fsm.skillId;

    if (this.prevState === 'ULTIMATE_CINEMATIC' && nextState !== 'ULTIMATE_CINEMATIC') {
      this.finisherCooldownSec = FINISHER_COOLDOWN_SEC;
      if (this.preCinematicFormTier === 'ULTIMATE') {
        this.formTier = 'ULTIMATE';
        this.superFormRemainingSec = Math.max(0.5, this.preCinematicRemainingSec);
        this.setModularSuperArmorVisible(true, 'ULTIMATE');
      } else {
        const remainingAfterCost = Math.max(
          0,
          this.preCinematicRemainingSec - FINISHER_SUPER_DURATION_COST_SEC
        );
        if (remainingAfterCost > 0.5) {
          this.formTier = 'SUPER';
          this.superFormRemainingSec = remainingAfterCost;
          this.setModularSuperArmorVisible(true, 'SUPER');
        } else {
          this.formTier = 'BASIC';
          this.superFormRemainingSec = 0;
          this.overdriveGauge = 0;
          this.driverGauge = 0;
          this.finisherCooldownSec = 0;
          this.setModularSuperArmorVisible(false);
        }
      }
    }

    if (enteredNewState) {
      if (nextState === 'HENSHIN_SUPER') {
        if (this.pendingHenshinTargetTier === 'ULTIMATE') {
          this.formTier = 'ULTIMATE';
          this.overdriveGauge = 0;
          this.superFormRemainingSec = ULTIMATE_FORM_DURATION_SEC;
          this.finisherCooldownSec = 0;
          this.beltBurstTimer = 0.95;
          this.slashTrail.endSwing();
          this.setModularSuperArmorVisible(true, 'ULTIMATE');
          this.frameEvents.startedHenshinUltimate = true;
        } else {
          this.formTier = 'SUPER';
          this.driverGauge = 0;
          this.overdriveGauge = 0;
          this.superFormRemainingSec = SUPER_FORM_DURATION_SEC;
          this.finisherCooldownSec = 0;
          this.beltBurstTimer = 0.85;
          this.slashTrail.endSwing();
          this.setModularSuperArmorVisible(true, 'SUPER');
          this.frameEvents.startedHenshinSuper = true;
        }
      } else if (nextState === 'ULTIMATE_CINEMATIC') {
        this.preCinematicFormTier = this.formTier === 'BASIC' ? 'SUPER' : this.formTier;
        this.preCinematicRemainingSec = this.superFormRemainingSec;
        this.formTier = 'ULTIMATE';
        this.ultimateImpactFired = false;
        this.ultimatePostExplosionsFired = 0;
        this.beltBurstTimer = 1.0;
        this.slashTrail.endSwing();
        this.setModularSuperArmorVisible(true, 'ULTIMATE');
        this.frameEvents.startedUltimateFinisher = true;
        if (lockTargetPos) {
          const toX = lockTargetPos.x - this.root.position.x;
          const toZ = lockTargetPos.z - this.root.position.z;
          if (toX * toX + toZ * toZ > 0.01) {
            this.yaw = Math.atan2(toX, toZ);
          }
        }
      } else if (nextState === 'FORM_SWITCH' && requestedElement) {
        this.setElementTheme(requestedElement);
        this.recentSwitchTimer = RECENT_SWITCH_WINDOW_SEC;
        this.beltBurstTimer = 0.36;
        this.slashTrail.endSwing();
        this.frameEvents.switchedToElement = requestedElement;
        if (lockTargetPos) {
          const toX = lockTargetPos.x - this.root.position.x;
          const toZ = lockTargetPos.z - this.root.position.z;
          if (toX * toX + toZ * toZ > 0.01) {
            this.yaw = Math.atan2(toX, toZ);
          }
        }
      } else if (nextState === 'RIDER_KICK') {
        this.riderKickImpactFired = false;
        this.beltBurstTimer = 0.5;
        this.slashTrail.endSwing();
        this.frameEvents.startedRiderKick = true;
        if (lockTargetPos) {
          const toX = lockTargetPos.x - this.root.position.x;
          const toZ = lockTargetPos.z - this.root.position.z;
          const dist = Math.hypot(toX, toZ);
          if (dist > 0.05) {
            this.yaw = Math.atan2(toX, toZ);
          }
          const diveDur = Math.max(0.12, RIDER_KICK_DIVE_END_SEC - RIDER_KICK_VAULT_END_SEC);
          this.riderKickDiveSpeed = THREE.MathUtils.clamp((dist - 0.65) / diveDur, 9.5, 28.0);
        } else {
          if (hasMoveInput) {
            this.yaw = Math.atan2(this.scratchMoveDir.x, this.scratchMoveDir.z);
          }
          this.riderKickDiveSpeed = 15.5;
        }
      } else if (nextState === 'ELEMENT_SKILL') {
        const cfg = getElementConfig(this.activeElementId);
        this.skillCooldowns[this.activeElementId] = cfg.skill.cooldown;
        this.beltBurstTimer = 0.45;
        this.slashTrail.endSwing();
        this.frameEvents.startedSkillElement = this.activeElementId;
        if (lockTargetPos) {
          const toX = lockTargetPos.x - this.root.position.x;
          const toZ = lockTargetPos.z - this.root.position.z;
          if (toX * toX + toZ * toZ > 0.01) {
            this.yaw = Math.atan2(toX, toZ);
          }
        } else if (hasMoveInput) {
          this.yaw = Math.atan2(this.scratchMoveDir.x, this.scratchMoveDir.z);
        }
      } else if (nextState === 'ATTACK_1' || nextState === 'ATTACK_2' || nextState === 'ATTACK_3') {
        this.frameEvents.startedSwingStep = this.fsm.comboStep as 1 | 2 | 3;
        if (this.warpCounterTimer > 0) {
          this.warpCounterTimer = 0;
          this.activeSwingIsWarpCounter = true;
          this.frameEvents.triggeredWarpCounter = true;
          this.beltBurstTimer = 0.35;
          this.dodgeFlashRemaining = 0.38;
        } else {
          this.activeSwingIsWarpCounter = false;
        }
        if (lockTargetPos) {
          const toX = lockTargetPos.x - this.root.position.x;
          const toZ = lockTargetPos.z - this.root.position.z;
          if (toX * toX + toZ * toZ > 0.01) {
            this.yaw = Math.atan2(toX, toZ);
          }
        } else if (hasMoveInput) {
          this.yaw = Math.atan2(this.scratchMoveDir.x, this.scratchMoveDir.z);
        }
      } else if (nextState === 'DODGE') {
        this.frameEvents.startedDodge = true;
        this.dodgeFlashRemaining = 0.25;
        this.slashTrail.endSwing();
        if (hasMoveInput) {
          this.dodgeDirX = this.scratchMoveDir.x;
          this.dodgeDirZ = this.scratchMoveDir.z;
          this.yaw = Math.atan2(this.dodgeDirX, this.dodgeDirZ);
        } else {
          this.dodgeDirX = Math.sin(this.yaw);
          this.dodgeDirZ = Math.cos(this.yaw);
        }
      }
    }

    if (nextState === 'RIDER_KICK') {
      const t = this.fsm.stateTime;
      if (!this.riderKickImpactFired && t >= RIDER_KICK_IMPACT_TIME_SEC) {
        this.riderKickImpactFired = true;
        this.frameEvents.riderKickImpactThisStep = true;
      }
    }

    if (nextState === 'ULTIMATE_CINEMATIC') {
      const t = this.fsm.stateTime;
      if (!this.ultimateImpactFired && t >= ULTIMATE_IMPACT_TIME_SEC) {
        this.ultimateImpactFired = true;
        this.frameEvents.ultimateImpactThisStep = true;
      }
      const pulseTimes = [2.48, 2.82, 3.16];
      if (
        this.ultimatePostExplosionsFired < pulseTimes.length &&
        t >= pulseTimes[this.ultimatePostExplosionsFired]!
      ) {
        this.ultimatePostExplosionsFired++;
        this.frameEvents.ultimateExplosionPulseThisStep = true;
      }
    }

    let vx = 0;
    let vz = 0;

    if (nextState === 'MOVE' && hasMoveInput) {
      const passiveSpeed = passive.stat === 'speed' ? 1 + passive.value : 1.0;
      const speedBonus =
        (this.formTier === 'ULTIMATE' ? 1.2 : this.formTier === 'SUPER' ? 1.12 : 1.0) * passiveSpeed;
      vx = this.scratchMoveDir.x * PLAYER_MOVE_SPEED * speedBonus;
      vz = this.scratchMoveDir.z * PLAYER_MOVE_SPEED * speedBonus;
      const targetYaw = Math.atan2(this.scratchMoveDir.x, this.scratchMoveDir.z);
      this.yaw = this.dampAngle(this.yaw, targetYaw, PLAYER_TURN_SPEED * dt);
    } else if (this.fsm.isAttacking) {
      const spec = this.fsm.getCurrentAttackSpec();
      const progress = this.fsm.normalizedStateProgress;
      const isRanged = this.elementConfig.weapon.archetype === 'RANGED';
      if (spec && progress < 0.45) {
        const lungeDecay = (1 - progress / 0.45) * (isRanged ? 0.22 : 1.0);
        vx = Math.sin(this.yaw) * spec.lungeSpeed * lungeDecay;
        vz = Math.cos(this.yaw) * spec.lungeSpeed * lungeDecay;
      }
      if (lockTargetPos && progress < 0.35) {
        const toX = lockTargetPos.x - this.root.position.x;
        const toZ = lockTargetPos.z - this.root.position.z;
        if (toX * toX + toZ * toZ > 0.04) {
          this.yaw = this.dampAngle(this.yaw, Math.atan2(toX, toZ), 14 * dt);
        }
      }
    } else if (nextState === 'RIDER_KICK') {
      const t = this.fsm.stateTime;
      if (t < RIDER_KICK_VAULT_END_SEC) {
        // Vault upward-backward coil while locking onto target
        vx = -Math.sin(this.yaw) * 2.4;
        vz = -Math.cos(this.yaw) * 2.4;
        if (lockTargetPos) {
          const toX = lockTargetPos.x - this.root.position.x;
          const toZ = lockTargetPos.z - this.root.position.z;
          const dist = Math.hypot(toX, toZ);
          if (dist > 0.1) {
            this.yaw = this.dampAngle(this.yaw, Math.atan2(toX, toZ), 16 * dt);
            const diveDur = Math.max(0.12, RIDER_KICK_DIVE_END_SEC - RIDER_KICK_VAULT_END_SEC);
            this.riderKickDiveSpeed = THREE.MathUtils.clamp((dist - 0.55) / diveDur, 9.5, 29.0);
          }
        }
      } else if (t < RIDER_KICK_DIVE_END_SEC) {
        // Supersonic diagonal homing dive straight into enemy!
        if (lockTargetPos && t < 0.56) {
          const toX = lockTargetPos.x - this.root.position.x;
          const toZ = lockTargetPos.z - this.root.position.z;
          if (toX * toX + toZ * toZ > 0.16) {
            this.yaw = this.dampAngle(this.yaw, Math.atan2(toX, toZ), 14 * dt);
          }
        }
        vx = Math.sin(this.yaw) * this.riderKickDiveSpeed;
        vz = Math.cos(this.yaw) * this.riderKickDiveSpeed;
      } else {
        // Acrobatic backflip rebound landing!
        const u = Math.min(1, (t - RIDER_KICK_DIVE_END_SEC) / 0.42);
        const backSpeed = 6.8 * (1 - u);
        vx = -Math.sin(this.yaw) * backSpeed;
        vz = -Math.cos(this.yaw) * backSpeed;
      }
    } else if (nextState === 'ELEMENT_SKILL') {
      const p = this.fsm.normalizedStateProgress;
      if (this.activeElementId === 'volt' && p < 0.42) {
        vx = Math.sin(this.yaw) * 14.5 * (1 - p / 0.42);
        vz = Math.cos(this.yaw) * 14.5 * (1 - p / 0.42);
      } else if (p < 0.3) {
        vx = Math.sin(this.yaw) * 4.2;
        vz = Math.cos(this.yaw) * 4.2;
      }
    } else if (nextState === 'DODGE') {
      const progress = this.fsm.normalizedStateProgress;
      const dashCurve = 1 - progress * 0.65;
      vx = this.dodgeDirX * DODGE_SPEED * dashCurve;
      vz = this.dodgeDirZ * DODGE_SPEED * dashCurve;
    } else if (nextState === 'HITSTUN') {
      vx = this.hitstunVelX;
      vz = this.hitstunVelZ;
      const decay = Math.exp(-10 * dt);
      this.hitstunVelX *= decay;
      this.hitstunVelZ *= decay;
    }

    outMove.dx = vx * dt;
    outMove.dz = vz * dt;

    const hitboxActive = this.fsm.isHitboxActive;
    const skillHitboxActive = this.fsm.isSkillHitboxActive;
    this.frameEvents.hitboxActive = hitboxActive;
    this.frameEvents.skillHitboxActive = skillHitboxActive;

    if (hitboxActive && !this.prevHitboxActive) {
      this.slashTrail.beginSwing(this.emissiveMat.emissive.getHex());
    } else if (!hitboxActive && this.prevHitboxActive) {
      this.slashTrail.endSwing();
    }

    this.prevState = nextState;
    this.prevHitboxActive = hitboxActive;

    if (this.hitFlashRemaining > 0) this.hitFlashRemaining = Math.max(0, this.hitFlashRemaining - dt);
    if (this.dodgeFlashRemaining > 0)
      this.dodgeFlashRemaining = Math.max(0, this.dodgeFlashRemaining - dt);
    if (this.beltGestureTimer > 0) this.beltGestureTimer = Math.max(0, this.beltGestureTimer - dt);
    if (this.beltBurstTimer > 0) this.beltBurstTimer = Math.max(0, this.beltBurstTimer - dt);

    return this.frameEvents;
  }

  public updateVisuals(renderDt: number, interpolatedPos: THREE.Vector3): void {
    const state = this.fsm.state;
    const progress = this.fsm.normalizedStateProgress;
    const swingId = this.fsm.swingId;
    const enteredNewVisualAction = state !== this.prevVisualState || swingId !== this.prevVisualSwingId;

    // Physical soaring vault + diagonal Flying Rider Kick dive for BOTH [SPACE] RIDER_KICK & [R] ULTIMATE_CINEMATIC!
    if (state === 'RIDER_KICK') {
      const t = this.fsm.stateTime;
      let kickOffsetY = 0;
      if (t < 0.34) {
        const u = t / 0.34;
        kickOffsetY = 2.9 * Math.sin(u * Math.PI * 0.5);
      } else if (t < 0.68) {
        const u = (t - 0.34) / 0.34;
        kickOffsetY = THREE.MathUtils.lerp(2.9, 0.42, u * u);
      } else if (t < 1.06) {
        const u = (t - 0.68) / 0.38;
        kickOffsetY = 0.42 * (1 - u) + Math.sin(u * Math.PI) * 1.15;
      }
      this.root.position.set(interpolatedPos.x, interpolatedPos.y + kickOffsetY, interpolatedPos.z);

      const showCone = t >= 0.28 && t <= 0.74;
      this.riderKickConeMesh.visible = showCone;
      if (showCone) {
        const pulse = 0.94 + Math.sin(t * 48) * 0.14;
        this.riderKickConeMesh.scale.set(pulse, 1.15, pulse);
        this.riderKickConeMesh.rotation.z += renderDt * 22;
        this.riderKickConeMat.opacity = t > 0.64 ? Math.max(0, (0.74 - t) / 0.1) * 0.88 : 0.86;
      }
    } else if (state === 'ULTIMATE_CINEMATIC') {
      const t = this.fsm.stateTime;
      let kickOffsetY = 0;
      let kickOffsetForward = 0;
      if (t >= 1.04 && t < 1.46) {
        // Cut-In is OPEN! Soaring +3.65m vault into the darkened sky beside Giant Animated Pet!
        const u = (t - 1.04) / 0.42;
        const easeOut = 1 - (1 - u) * (1 - u);
        kickOffsetY = 3.65 * easeOut;
        kickOffsetForward = -1.65 * easeOut;
      } else if (t >= 1.46 && t < 1.94) {
        // Supersonic diagonal Hyper Rider Kick dive slamming target at 1.90s!
        const u = (t - 1.46) / 0.48;
        kickOffsetY = THREE.MathUtils.lerp(3.65, 0.55, u * u);
        kickOffsetForward = THREE.MathUtils.lerp(-1.65, 2.25, u);
      } else if (t >= 1.94 && t < 2.4) {
        // Acrobatic rebound landing before Back-Turned Explosion Pose
        const u = (t - 1.94) / 0.46;
        kickOffsetY = THREE.MathUtils.lerp(0.55, 0, u) + Math.sin(u * Math.PI) * 0.75;
        kickOffsetForward = THREE.MathUtils.lerp(2.25, 0, u);
      }
      this.root.position.set(
        interpolatedPos.x + Math.sin(this.yaw) * kickOffsetForward,
        interpolatedPos.y + kickOffsetY,
        interpolatedPos.z + Math.cos(this.yaw) * kickOffsetForward
      );

      const showCone = t >= 1.38 && t <= 2.12;
      this.riderKickConeMesh.visible = showCone;
      if (showCone) {
        const pulse = 1.05 + Math.sin(t * 46) * 0.16;
        this.riderKickConeMesh.scale.set(pulse, 1.35 + (t > 1.82 && t < 1.98 ? 0.35 : 0), pulse);
        this.riderKickConeMesh.rotation.z += renderDt * 24;
        this.riderKickConeMat.opacity = t > 1.96 ? Math.max(0, (2.12 - t) / 0.16) * 0.9 : 0.9;
      }
    } else {
      this.root.position.copy(interpolatedPos);
      this.riderKickConeMesh.visible = false;
    }
    this.root.rotation.y = this.yaw;
    this.animTime += renderDt * (state === 'MOVE' ? 9.6 : 3.0);

    // Route RANGED Bow/Dual-Gun attacks, [SPACE] RIDER_KICK & [R] ULTIMATE_CINEMATIC directly to HumanoidBoneDriver!
    const forceBespokeProceduralPose =
      state === 'ULTIMATE_CINEMATIC' ||
      state === 'RIDER_KICK' ||
      (this.elementConfig.weapon.archetype === 'RANGED' &&
        (state === 'ATTACK_1' || state === 'ATTACK_2' || state === 'ATTACK_3'));

    if (this.activeBodyMode === 'ULTIMATE' && this.ultimateRigHost) {
      if (!forceBespokeProceduralPose && this.ultimateSkeletalAnimator?.hasClipForState(state)) {
        this.driveSkeletalClipForState(this.ultimateSkeletalAnimator, state, enteredNewVisualAction, renderDt);
      } else if (this.ultimateBoneDriver?.isActive) {
        this.ultimateSkeletalAnimator?.pauseForProceduralBlend();
        this.ultimateBoneDriver.applyRiderPose(
          state,
          progress,
          this.animTime,
          this.activeElementId,
          this.formTier,
          this.fsm.stateTime,
          renderDt
        );
      } else {
        this.applyUnriggedFormBodyMotion(this.ultimateRigHost, state, progress);
      }
    } else if (this.activeBodyMode !== 'BASIC' && this.superRigHost) {
      if (!forceBespokeProceduralPose && this.superSkeletalAnimator?.hasClipForState(state)) {
        this.driveSkeletalClipForState(this.superSkeletalAnimator, state, enteredNewVisualAction, renderDt);
      } else if (this.superBoneDriver?.isActive) {
        this.superSkeletalAnimator?.pauseForProceduralBlend();
        this.superBoneDriver.applyRiderPose(
          state,
          progress,
          this.animTime,
          this.activeElementId,
          this.formTier,
          this.fsm.stateTime,
          renderDt
        );
      } else {
        // Kinetic hover/lunge/slash body motion for unrigged custom Super Form Armored Warrior!
        this.applyUnriggedFormBodyMotion(this.superRigHost, state, progress);
      }
    } else if (!forceBespokeProceduralPose && this.skeletalAnimator.hasClipForState(state)) {
      // Hybrid real Meshy mocap clips (Idle_5, Running, Roll_Dodge, Thrust_Slash Atk1/Atk2, Dead)!
      this.driveSkeletalClipForState(this.skeletalAnimator, state, enteredNewVisualAction, renderDt);
    } else if (this.boneDriver.isActive) {
      // Smooth procedural 24-bone handoff for Bow Draw, Dual-Gun Gun-Kata, Flying Rider Kick, ATTACK_3 slam, SKILL, FORM_SWITCH, HENSHIN, HITSTUN
      this.skeletalAnimator.pauseForProceduralBlend();
      this.boneDriver.applyRiderPose(
        state,
        progress,
        this.animTime,
        this.activeElementId,
        this.formTier,
        this.fsm.stateTime,
        renderDt
      );
    } else {
      this.applyProceduralPose(state, progress);
    }
    this.prevVisualState = state;
    this.prevVisualSwingId = swingId;
    this.updateMaterialFeedback();

    if (this.fsm.isHitboxActive) {
      this.root.updateMatrixWorld(true);
      this.weaponBaseMarker.getWorldPosition(this.scratchWeaponBaseWorld);
      this.weaponTipMarker.getWorldPosition(this.scratchWeaponTipWorld);
      this.slashTrail.sample(this.scratchWeaponBaseWorld, this.scratchWeaponTipWorld);
    }

    this.slashTrail.update(renderDt);
  }

  public updateHubPedestalVisuals(renderDt: number): void {
    this.animTime += renderDt * 2.8;
    this.root.position.set(0, PLAYER_SPAWN_Y, 0);
    // Offset Idle_5's sideways martial-arts hips/spine stance (+0.58 rad) so the Rider's chest & face align cleanly toward camera
    this.yaw = this.skeletalAnimator.hasClipForState('IDLE') ? 0.58 : 0;
    this.root.rotation.y = this.yaw;
    if (this.skeletalAnimator.hasClipForState('IDLE')) {
      this.skeletalAnimator.playState('IDLE', { loop: true, timeScale: 1.0, fadeSec: 0.14 });
      this.skeletalAnimator.update(renderDt);
      // Leave neck bone 100% untouched (prevents chest collar deformation!) and untwist + lift Head bone only
      if (this.hubHeadBone) {
        this.hubHeadBone.quaternion.multiply(this.hubHeadLiftQuat);
      }
    } else if (this.boneDriver.isActive) {
      this.skeletalAnimator.pauseForProceduralBlend();
      this.boneDriver.applyRiderPose('IDLE', 0, this.animTime, this.activeElementId, this.formTier, 0, renderDt);
    } else {
      this.applyProceduralPose('IDLE', 0);
    }
    this.updateMaterialFeedback();
  }

  private driveSkeletalClipForState(
    animator: SkeletalAnimator,
    state: PlayerStateId,
    restartAction: boolean,
    renderDt: number
  ): void {
    const loopAnim = state === 'IDLE' || state === 'MOVE';
    const clipDur = animator.getClipDuration(state);
    let timeScale = 1.0;
    let fadeSec = 0.11;

    if (state === 'MOVE') {
      timeScale = 1.08;
      fadeSec = 0.09;
    } else if (state === 'DODGE') {
      // Sync acrobatic somersault roll duration 1:1 with the 0.34s dodge dash window!
      timeScale = clipDur > 0.1 ? Math.min(3.6, Math.max(1.2, clipDur / 0.36)) : 2.5;
      fadeSec = 0.05;
    } else if (state === 'ATTACK_1' || state === 'ATTACK_2' || state === 'ATTACK_3') {
      const spec = this.fsm.getCurrentAttackSpec();
      const targetDur = spec ? spec.durationSec / this.elementConfig.weapon.attackSpeed : 0.45;
      timeScale = clipDur > 0.1 ? Math.min(3.4, Math.max(1.0, clipDur / targetDur)) : this.elementConfig.weapon.attackSpeed;
      fadeSec = 0.06;
    } else if (state === 'DEAD') {
      timeScale = 1.0;
      fadeSec = 0.12;
    }

    animator.playState(state, {
      loop: loopAnim,
      timeScale,
      fadeSec,
      restart: !loopAnim && restartAction,
    });
    animator.update(renderDt);
  }

  public dispose(): void {
    this.skeletalAnimator.dispose();
    this.superSkeletalAnimator?.dispose();
    this.ultimateSkeletalAnimator?.dispose();
    this.slashTrail.dispose();
    this.dodgeRingMesh.geometry.dispose();
    this.superAuraRingMesh.geometry.dispose();
    this.beltBurstRingMesh.geometry.dispose();
    for (let i = 0; i < this.ownedGeometries.length; i++) {
      this.ownedGeometries[i]!.dispose();
    }
    this.ownedGeometries.length = 0;
    for (let i = 0; i < this.ownedMaterials.length; i++) {
      this.ownedMaterials[i]!.dispose();
    }
    this.ownedMaterials.length = 0;
    this.externalMaterials.length = 0;
    this.armorHueUniforms.length = 0;
  }

  private setModularSuperArmorVisible(visible: boolean, tier: FormTier = visible ? 'SUPER' : 'BASIC'): void {
    const useUltimate =
      visible &&
      tier === 'ULTIMATE' &&
      this.ultimateRigHost !== null &&
      this.ultimateRightHandSocket !== null &&
      this.ultimateLeftHandSocket !== null;
    const useSuper =
      visible &&
      !useUltimate &&
      this.superRigHost !== null &&
      this.superRightHandSocket !== null &&
      this.superLeftHandSocket !== null;

    if (useUltimate || useSuper || this.superRigHost || this.ultimateRigHost) {
      this.activeBodyMode = useUltimate ? 'ULTIMATE' : useSuper ? 'SUPER' : 'BASIC';
      this.basicRigHost.visible = this.activeBodyMode === 'BASIC';
      if (this.superRigHost) this.superRigHost.visible = this.activeBodyMode === 'SUPER';
      if (this.ultimateRigHost) this.ultimateRigHost.visible = this.activeBodyMode === 'ULTIMATE';

      // Seamlessly transfer active sculpted weapons & slash markers between Basic / Super / Ultimate hands (zero allocations!)
      const targetRight =
        this.activeBodyMode === 'ULTIMATE' && this.ultimateRightHandSocket
          ? this.ultimateRightHandSocket
          : this.activeBodyMode === 'SUPER' && this.superRightHandSocket
            ? this.superRightHandSocket
            : this.rightHandSocket;
      const targetLeft =
        this.activeBodyMode === 'ULTIMATE' && this.ultimateLeftHandSocket
          ? this.ultimateLeftHandSocket
          : this.activeBodyMode === 'SUPER' && this.superLeftHandSocket
            ? this.superLeftHandSocket
            : this.leftHandSocket;

      targetRight.add(
        this.pyroGreatsword,
        this.voltRightDagger,
        this.aquaTrident,
        this.rangedGunRightGroup,
        this.weaponBaseMarker,
        this.weaponTipMarker
      );
      for (const mesh of this.customRightWeapons.values()) {
        targetRight.add(mesh);
      }
      targetLeft.add(this.voltLeftDagger, this.rangedBowGroup, this.rangedGunLeftGroup);
      for (const mesh of this.customLeftWeapons.values()) {
        targetLeft.add(mesh);
      }
    } else if (!this.isCustomSkeletalRig) {
      // Fallback: only hide dedicated BackWing socket if it is not a shared skeleton spine bone
      this.backWingSocket.visible = visible;
    }
    this.superAuraRingMesh.visible = visible;
  }

  private applyUnriggedFormBodyMotion(host: THREE.Group, state: PlayerStateId, p: number): void {
    host.position.set(0, 0, 0);
    host.rotation.set(0, 0, 0);

    if (state === 'DEAD') {
      host.position.y = -0.58;
      host.rotation.x = -1.4;
      return;
    }
    if (state === 'HENSHIN_SUPER') {
      const rise = Math.sin(p * Math.PI);
      host.position.y = rise * 0.42;
      host.rotation.y = (1 - p) * Math.PI * 2;
      return;
    }
    if (state === 'ULTIMATE_CINEMATIC') {
      const t = this.fsm.stateTime;
      if (t < 1.15) {
        host.position.y = 0.25 + Math.sin(t * 14) * 0.05;
        host.rotation.x = -0.15;
      } else if (t < 2.2) {
        const s = Math.min(1, (t - 1.15) / 0.45);
        host.position.y = Math.sin(s * Math.PI) * 0.65;
        host.rotation.x = THREE.MathUtils.lerp(-0.2, 0.35, s);
        host.rotation.y = THREE.MathUtils.lerp(-0.7, 0.85, s);
      } else {
        host.rotation.y = Math.PI;
      }
      return;
    }
    if (state === 'MOVE') {
      host.position.y = Math.abs(Math.sin(this.animTime)) * 0.07;
      host.rotation.x = 0.18;
      host.rotation.z = Math.sin(this.animTime) * 0.06;
    } else if (state === 'DODGE') {
      host.position.y = -0.12;
      host.rotation.x = 0.42;
    } else if (state === 'ATTACK_1' || state === 'ATTACK_2' || state === 'ATTACK_3' || state === 'ELEMENT_SKILL') {
      const swing = this.smoothSwingCurve(p, 0.2, 0.6);
      const dir = state === 'ATTACK_2' ? -1 : 1;
      host.position.y = state === 'ATTACK_3' ? Math.sin(Math.min(1, p * 1.3) * Math.PI) * 0.3 : 0;
      host.rotation.y = THREE.MathUtils.lerp(-0.75 * dir, 0.85 * dir, swing);
      host.rotation.x = THREE.MathUtils.lerp(-0.15, 0.28, swing);
    } else if (state === 'HITSTUN') {
      host.rotation.x = -0.3 * Math.sin(p * Math.PI);
    } else {
      // Heroic Super/Ultimate Form slight hovering power pulse
      host.position.y = Math.sin(this.animTime * 0.9) * 0.03;
    }
  }

  private applyActiveWeaponMesh(elementId: ElementId): void {
    const cfg = getElementConfig(elementId);
    const arch = cfg.weapon.archetype;
    const customRight = this.customRightWeapons.get(elementId);
    const customLeft = this.customLeftWeapons.get(elementId);
    const hasCustom = Boolean(customRight || customLeft);

    for (const [id, mesh] of this.customRightWeapons.entries()) {
      mesh.visible = id === elementId;
    }
    for (const [id, mesh] of this.customLeftWeapons.entries()) {
      mesh.visible = id === elementId;
    }

    const isBow = !hasCustom && arch === 'RANGED' && elementId === 'flora';
    const isDualGuns = !hasCustom && arch === 'RANGED' && elementId !== 'flora';

    this.pyroGreatsword.visible = !hasCustom && arch === 'HEAVY_MELEE';
    this.voltRightDagger.visible = !hasCustom && arch === 'FAST_MELEE';
    this.voltLeftDagger.visible = !hasCustom && arch === 'FAST_MELEE';
    this.aquaTrident.visible = !hasCustom && arch === 'POLEARM';
    this.rangedBowGroup.visible = isBow;
    this.rangedGunRightGroup.visible = isDualGuns;
    this.rangedGunLeftGroup.visible = isDualGuns;

    if (arch === 'HEAVY_MELEE') {
      this.weaponBaseMarker.position.set(0, 0.25, 0);
      this.weaponTipMarker.position.set(0, 1.9, 0);
    } else if (arch === 'FAST_MELEE') {
      this.weaponBaseMarker.position.set(0, 0.12, 0);
      this.weaponTipMarker.position.set(0, 1.0, 0);
    } else if (arch === 'POLEARM') {
      this.weaponBaseMarker.position.set(0, 0.55, 0);
      this.weaponTipMarker.position.set(0, 2.35, 0);
    } else {
      this.weaponBaseMarker.position.set(0, 0.2, 0);
      this.weaponTipMarker.position.set(0, 0.9, 0.4);
    }
  }

  private buildProceduralLongbow(): THREE.Group {
    const bow = new THREE.Group();
    bow.name = 'ProceduralLongbow';
    const arcGeo = new THREE.TorusGeometry(0.74, 0.036, 8, 22, Math.PI * 1.1);
    const stringGeo = new THREE.CylinderGeometry(0.01, 0.01, 1.42, 6);
    const gripGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.26, 8);
    this.ownedGeometries.push(arcGeo, stringGeo, gripGeo);

    const arcMesh = new THREE.Mesh(arcGeo, this.armorMat);
    arcMesh.rotation.z = -Math.PI * 0.55;
    arcMesh.position.set(0, 0, 0.12);
    arcMesh.castShadow = true;

    const stringMesh = new THREE.Mesh(stringGeo, this.bladeEdgeMat);
    stringMesh.position.set(0, 0, -0.14);

    const gripMesh = new THREE.Mesh(gripGeo, this.metallicMat);
    gripMesh.position.set(0, 0, 0.85);

    bow.add(arcMesh, stringMesh, gripMesh);
    bow.position.set(0, 0.05, 0.1);
    bow.visible = false;
    return bow;
  }

  private buildProceduralEnergyPistol(): THREE.Group {
    const gun = new THREE.Group();
    gun.name = 'ProceduralEnergyPistol';
    const gripGeo = new THREE.BoxGeometry(0.075, 0.24, 0.1);
    const barrelGeo = new THREE.BoxGeometry(0.085, 0.11, 0.52);
    const muzzleGeo = new THREE.CylinderGeometry(0.038, 0.044, 0.14, 8);
    muzzleGeo.rotateX(Math.PI / 2);
    this.ownedGeometries.push(gripGeo, barrelGeo, muzzleGeo);

    const grip = new THREE.Mesh(gripGeo, this.undersuitMat);
    grip.position.set(0, 0.02, 0.02);

    const barrel = new THREE.Mesh(barrelGeo, this.armorMat);
    barrel.position.set(0, 0.16, 0.2);
    barrel.castShadow = true;

    const muzzle = new THREE.Mesh(muzzleGeo, this.bladeEdgeMat);
    muzzle.position.set(0, 0.16, 0.48);

    gun.add(grip, barrel, muzzle);
    gun.visible = false;
    return gun;
  }

  private applyProceduralPose(state: PlayerStateId, p: number): void {
    this.bodyPivot.position.set(0, 0, 0);
    this.bodyPivot.rotation.set(0, 0, 0);
    this.torsoPivot.rotation.set(0, 0, 0);
    this.headPivot.rotation.set(0, 0, 0);
    this.leftArmPivot.rotation.set(0.12, 0, 0.22);
    this.rightArmPivot.rotation.set(-0.22, 0, -0.2);
    this.rightHandSocket.rotation.set(0.25, 0, 0);
    this.leftHandSocket.rotation.set(0.25, 0, 0);
    this.leftLegPivot.rotation.set(0, 0, 0);
    this.rightLegPivot.rotation.set(0, 0, 0);

    const windSpeed = state === 'MOVE' || state === 'DODGE' || this.formTier !== 'BASIC' ? 2.5 : 1.0;
    this.scarfUpperPivot.rotation.x = 0.35 + windSpeed * 0.28 + Math.sin(this.animTime * 1.4) * 0.14;
    this.scarfLowerPivot.rotation.x = 0.25 + Math.cos(this.animTime * 1.7) * 0.22;

    if (this.backWingSocket.visible) {
      const wingBeat = Math.sin(this.animTime * 2.2) * 0.14;
      this.superLeftWingPivot.rotation.y = 0.35 + wingBeat;
      this.superRightWingPivot.rotation.y = -0.35 - wingBeat;
    }

    if (state === 'DEAD') {
      this.bodyPivot.position.y = -0.58;
      this.bodyPivot.rotation.x = 1.42;
      return;
    }

    if (state === 'HENSHIN_SUPER') {
      const rise = Math.sin(p * Math.PI);
      this.bodyPivot.position.y = rise * 0.42;
      this.torsoPivot.rotation.x = -0.18 * rise;
      this.leftArmPivot.rotation.set(-0.4, 0, 1.35 * rise + 0.25);
      this.rightArmPivot.rotation.set(-0.4, 0, -1.35 * rise - 0.25);
      return;
    }

    if (state === 'ULTIMATE_CINEMATIC') {
      const t = this.fsm.stateTime;
      if (t < 1.15) {
        this.bodyPivot.position.y = 0.18 + Math.sin(t * 14) * 0.04;
        this.torsoPivot.rotation.y = -0.35;
        this.rightArmPivot.rotation.set(-2.5, 0, -0.2);
        this.leftArmPivot.rotation.set(-0.9, 0.5, 0.2);
      } else if (t < 2.2) {
        const slashT = Math.min(1, (t - 1.15) / 0.45);
        this.bodyPivot.position.y = Math.sin(slashT * Math.PI) * 0.55;
        this.bodyPivot.rotation.x = THREE.MathUtils.lerp(-0.2, 0.42, slashT);
        this.torsoPivot.rotation.y = THREE.MathUtils.lerp(-0.7, 0.85, slashT);
        this.rightArmPivot.rotation.set(THREE.MathUtils.lerp(-2.5, 0.65, slashT), 0, -0.2);
        this.leftArmPivot.rotation.set(-0.5, 0, 0.8);
      } else {
        this.bodyPivot.rotation.y = Math.PI;
        this.torsoPivot.rotation.y = 0.18;
        this.leftArmPivot.rotation.set(-0.45, 0.65, -0.3);
        this.rightArmPivot.rotation.set(-0.35, -0.25, -0.45);
        this.rightHandSocket.rotation.set(0.3, 0, 0.2);
      }
      return;
    }

    if (state === 'FORM_SWITCH') {
      const pop = Math.sin(p * Math.PI);
      this.bodyPivot.position.y = pop * 0.14;
      this.torsoPivot.rotation.y = -0.35 * pop;
      this.leftArmPivot.rotation.set(-0.95, 0.55, -0.35);
      this.rightArmPivot.rotation.set(-0.65, -0.3, -0.85);
      this.scarfUpperPivot.rotation.x = 1.15;
      return;
    }

    if (state === 'ELEMENT_SKILL') {
      const surge = this.smoothSwingCurve(p, 0.24, 0.58);
      this.bodyPivot.position.y = Math.sin(Math.min(1, p * 1.2) * Math.PI) * 0.32;
      this.bodyPivot.rotation.x = THREE.MathUtils.lerp(-0.25, 0.35, surge);
      this.torsoPivot.rotation.y = THREE.MathUtils.lerp(-0.8, 0.85, surge);
      this.rightArmPivot.rotation.set(THREE.MathUtils.lerp(-2.2, 0.45, surge), 0, -0.5);
      this.leftArmPivot.rotation.set(THREE.MathUtils.lerp(-1.8, 0.35, surge), 0, 0.5);
      this.rightHandSocket.rotation.set(1.25, 0, 0);
      return;
    }

    if (state === 'IDLE') {
      const breathe = Math.sin(this.animTime);
      this.bodyPivot.position.y = breathe * 0.025;
      this.torsoPivot.rotation.y = this.activeElementId === 'volt' ? 0.12 : -0.18;
      this.rightArmPivot.rotation.set(-0.45 + breathe * 0.04, 0.15, -0.35);
      this.leftArmPivot.rotation.set(
        this.activeElementId === 'volt' ? -0.55 : -0.35,
        -0.2,
        0.35
      );
      this.rightHandSocket.rotation.set(this.activeElementId === 'aqua' ? 0.9 : 0.45, 0, -0.2);
    } else if (state === 'MOVE') {
      const stride = Math.sin(this.animTime);
      this.bodyPivot.position.y = Math.abs(stride) * 0.07;
      this.bodyPivot.rotation.x = 0.16;
      this.leftLegPivot.rotation.x = stride * 0.72;
      this.rightLegPivot.rotation.x = -stride * 0.72;
      this.leftArmPivot.rotation.set(-stride * 0.55 - 0.15, 0, 0.25);
      this.rightArmPivot.rotation.set(0.25 + stride * 0.25, -0.25, -0.42);
      this.rightHandSocket.rotation.set(0.75, 0, -0.15);
    } else if (state === 'DODGE') {
      this.bodyPivot.position.y = -0.14;
      this.bodyPivot.rotation.x = 0.52;
      this.torsoPivot.rotation.y = -0.35;
      this.leftArmPivot.rotation.set(0.65, 0, 0.45);
      this.rightArmPivot.rotation.set(0.55, 0, -0.55);
      this.leftLegPivot.rotation.x = -0.55;
      this.rightLegPivot.rotation.x = 0.65;
      this.scarfUpperPivot.rotation.x = 1.25;
    } else if (state === 'HITSTUN') {
      const recoil = Math.sin(p * Math.PI);
      this.bodyPivot.rotation.x = -0.38 * recoil;
      this.torsoPivot.rotation.y = 0.3 * recoil;
      this.leftArmPivot.rotation.set(-0.8 * recoil, 0, 0.65);
      this.rightArmPivot.rotation.set(-0.7 * recoil, 0, -0.65);
    } else if (state === 'ATTACK_1') {
      const swing = this.smoothSwingCurve(p, 0.22, 0.58);
      this.bodyPivot.rotation.x = 0.18;
      if (this.activeElementId === 'aqua') {
        this.torsoPivot.rotation.y = THREE.MathUtils.lerp(-0.4, 0.35, swing);
        this.rightArmPivot.rotation.set(THREE.MathUtils.lerp(-0.35, -1.45, swing), 0, -0.15);
        this.rightHandSocket.rotation.set(1.45, 0, 0);
      } else {
        this.torsoPivot.rotation.y = THREE.MathUtils.lerp(-0.95, 1.05, swing);
        this.rightArmPivot.rotation.set(
          THREE.MathUtils.lerp(-1.25, -0.35, swing),
          THREE.MathUtils.lerp(-0.55, 0.9, swing),
          THREE.MathUtils.lerp(-1.1, 0.45, swing)
        );
        this.rightHandSocket.rotation.set(1.15, 0, -0.35);
      }
      this.leftArmPivot.rotation.set(-0.4, 0, 0.55);
      this.leftLegPivot.rotation.x = -0.32;
      this.rightLegPivot.rotation.x = 0.36;
    } else if (state === 'ATTACK_2') {
      const swing = this.smoothSwingCurve(p, 0.22, 0.6);
      this.bodyPivot.rotation.x = 0.22;
      this.torsoPivot.rotation.y = THREE.MathUtils.lerp(1.15, -1.1, swing);
      this.rightArmPivot.rotation.set(
        THREE.MathUtils.lerp(-0.75, -0.9, swing),
        THREE.MathUtils.lerp(1.15, -1.1, swing),
        THREE.MathUtils.lerp(0.65, -1.25, swing)
      );
      if (this.activeElementId === 'volt') {
        this.leftArmPivot.rotation.set(
          THREE.MathUtils.lerp(-1.1, -0.3, swing),
          THREE.MathUtils.lerp(-0.9, 0.9, swing),
          0.75
        );
      } else {
        this.leftArmPivot.rotation.set(0.25, 0, 0.7);
      }
      this.rightHandSocket.rotation.set(1.3, 0.25, 0.35);
      this.leftLegPivot.rotation.x = 0.38;
      this.rightLegPivot.rotation.x = -0.34;
    } else if (state === 'ATTACK_3') {
      const swing = this.smoothSwingCurve(p, 0.25, 0.62);
      const jumpArc = Math.sin(Math.min(1, p * 1.35) * Math.PI) * 0.24;
      this.bodyPivot.position.y = jumpArc;
      this.bodyPivot.rotation.x = THREE.MathUtils.lerp(-0.18, 0.36, swing);
      this.torsoPivot.rotation.y =
        this.activeElementId === 'volt'
          ? THREE.MathUtils.lerp(-1.4, 1.8, swing)
          : THREE.MathUtils.lerp(-0.5, 0.45, swing);
      this.rightArmPivot.rotation.set(
        THREE.MathUtils.lerp(-2.55, 0.65, swing),
        0,
        THREE.MathUtils.lerp(-0.22, -0.1, swing)
      );
      this.leftArmPivot.rotation.set(THREE.MathUtils.lerp(-2.1, 0.2, swing), 0, 0.38);
      this.rightHandSocket.rotation.set(THREE.MathUtils.lerp(0.65, 1.45, swing), 0, 0);
      this.leftLegPivot.rotation.x = -0.45 * swing;
      this.rightLegPivot.rotation.x = 0.42 * swing;
    }

    if (this.beltGestureTimer > 0 && !this.fsm.isAttacking) {
      this.leftArmPivot.rotation.set(-0.85, 0.5, -0.25);
    }
  }

  private smoothSwingCurve(p: number, windupEnd: number, swingEnd: number): number {
    if (p <= windupEnd) return 0;
    if (p >= swingEnd) return 1;
    const t = (p - windupEnd) / (swingEnd - windupEnd);
    return 1 - Math.pow(1 - t, 3);
  }

  private updateMaterialFeedback(): void {
    if (this.superAuraRingMesh.visible) {
      this.superAuraRingMesh.rotation.z = this.animTime * 2.0;
      const pulse = 1 + Math.sin(this.animTime * 6) * 0.08;
      this.superAuraRingMesh.scale.setScalar(this.formTier === 'ULTIMATE' ? pulse * 1.25 : pulse);
      this.superAuraRingMat.color.set(this.elementConfig.emissiveColor);
    }

    if (this.beltBurstTimer > 0) {
      const t = 1 - Math.min(1, this.beltBurstTimer / 0.65);
      this.beltBurstRingMesh.visible = true;
      this.beltBurstRingMesh.scale.setScalar(0.8 + t * 5.2);
      this.beltBurstRingMat.opacity = Math.max(0, (1 - t) * 0.9);
    } else {
      this.beltBurstRingMesh.visible = false;
    }

    if (this.hitFlashRemaining > 0) {
      this.armorMat.color.setHex(0xffffff);
      this.armorMat.emissive.setHex(0xffffff);
      this.armorMat.emissiveIntensity = 0.45;
      for (let i = 0; i < this.externalMaterials.length; i++) {
        const m = this.externalMaterials[i]!;
        m.emissive.setHex(0xef4444);
        m.emissiveIntensity = 0.12;
      }
      this.dodgeRingMat.color.setHex(0xf43f5e);
      this.dodgeRingMat.opacity = 0.75;
      return;
    }

    this.armorMat.color.set(this.elementConfig.primaryColor);
    this.armorMat.emissive.setHex(0x000000);
    this.armorMat.emissiveIntensity = 0;
    // Keep external sculpted PBR armor (Basic & Super Form) 100% free of emissive haze so every metallic detail stays sharp!
    for (let i = 0; i < this.externalMaterials.length; i++) {
      const m = this.externalMaterials[i]!;
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
    }

    if (this.fsm.isInvulnerable || this.dodgeFlashRemaining > 0) {
      this.dodgeRingMat.color.setHex(this.formTier !== 'BASIC' ? 0xfacc15 : 0x38bdf8);
      this.dodgeRingMat.opacity = 0.85;
      this.emissiveMat.emissiveIntensity = 2.6;
    } else {
      this.dodgeRingMat.color.set(this.elementConfig.emissiveColor);
      this.dodgeRingMat.opacity = 0.32;
      this.emissiveMat.emissiveIntensity =
        (this.formTier !== 'BASIC' ? 2.4 : 1.75) + Math.sin(this.animTime * 1.5) * 0.2;
    }
  }

  private dampAngle(current: number, target: number, factor: number): number {
    let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return current + diff * Math.min(1, factor);
  }
}

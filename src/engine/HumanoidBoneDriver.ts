import * as THREE from 'three';
import type { ElementId, FormTier, PlayerStateId, RiderId } from '../game/types/schema';
import type { EnemyAIState } from '../game/entities/EnemyBase';
import { normalizeBoneName } from './SkeletalAnimator';

export type HumanoidBoneKey =
  | 'Hips'
  | 'SpineLower'
  | 'SpineMid'
  | 'SpineUpper'
  | 'Neck'
  | 'Head'
  | 'LeftShoulder'
  | 'LeftArm'
  | 'LeftForeArm'
  | 'LeftHand'
  | 'RightShoulder'
  | 'RightArm'
  | 'RightForeArm'
  | 'RightHand'
  | 'LeftUpLeg'
  | 'LeftLeg'
  | 'LeftFoot'
  | 'RightUpLeg'
  | 'RightLeg'
  | 'RightFoot';

interface CapturedBone {
  bone: THREE.Object3D;
  restLocalQuat: THREE.Quaternion;
  restParentWorldQuat: THREE.Quaternion;
  restParentWorldQuatInv: THREE.Quaternion;
  restLocalPos: THREE.Vector3;
}

const BONE_ALIASES: Readonly<Record<HumanoidBoneKey, readonly string[]>> = {
  Hips: ['hips', 'pelvis', 'root'],
  SpineLower: ['spine02', 'spine'],
  SpineMid: ['spine01', 'spine1'],
  SpineUpper: ['spine', 'spine2', 'upperchest', 'chest'],
  Neck: ['neck'],
  Head: ['head'],
  LeftShoulder: ['leftshoulder', 'shoulderl', 'claviclel'],
  LeftArm: ['leftarm', 'upperarml', 'arml'],
  LeftForeArm: ['leftforearm', 'forearml', 'lowerarml'],
  LeftHand: ['lefthand', 'handl'],
  RightShoulder: ['rightshoulder', 'shoulderr', 'clavicler'],
  RightArm: ['rightarm', 'upperarmr', 'armr'],
  RightForeArm: ['rightforearm', 'forearmr', 'lowerarmr'],
  RightHand: ['righthand', 'handr'],
  LeftUpLeg: ['leftupleg', 'thighl', 'uplegl'],
  LeftLeg: ['leftleg', 'calfl', 'shinl', 'legl'],
  LeftFoot: ['leftfoot', 'footl'],
  RightUpLeg: ['rightupleg', 'thighr', 'uplegr'],
  RightLeg: ['rightleg', 'calfr', 'shinr', 'legr'],
  RightFoot: ['rightfoot', 'footr'],
};

/**
 * Pure helper: inspects parent/child spine topology to handle BOTH:
 * - Meshy hierarchy: Hips -> Spine02 (lower) -> Spine01 (mid) -> Spine (upper chest with shoulders)
 * - Mixamo hierarchy: Hips -> Spine (lower) -> Spine1 (mid) -> Spine2 (upper chest with shoulders)
 */
export function resolveHumanoidBoneMap(root: THREE.Object3D): Map<HumanoidBoneKey, THREE.Object3D> {
  const byNorm = new Map<string, THREE.Object3D>();
  root.traverse((obj) => {
    if (!obj.name) return;
    const norm = normalizeBoneName(obj.name);
    if (!byNorm.has(norm)) {
      byNorm.set(norm, obj);
    }
  });

  const resolved = new Map<HumanoidBoneKey, THREE.Object3D>();
  const keys = Object.keys(BONE_ALIASES) as HumanoidBoneKey[];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const aliases = BONE_ALIASES[key];
    for (let a = 0; a < aliases.length; a++) {
      const hit = byNorm.get(aliases[a]!);
      if (hit) {
        resolved.set(key, hit);
        break;
      }
    }
  }

  // Detect Mixamo vs Meshy spine ordering: whichever spine node is parent of shoulders is SpineUpper!
  const spineA = byNorm.get('spine');
  const spineB = byNorm.get('spine2') ?? byNorm.get('spine02');
  const spineMid = byNorm.get('spine1') ?? byNorm.get('spine01');
  if (spineA && spineB) {
    const isSpineAUpper = spineA.children.some((c) => {
      const n = normalizeBoneName(c.name);
      return n.includes('shoulder') || n.includes('neck') || n.includes('arm');
    });
    if (isSpineAUpper) {
      resolved.set('SpineLower', spineB);
      resolved.set('SpineUpper', spineA);
    } else {
      resolved.set('SpineLower', spineA);
      resolved.set('SpineUpper', spineB);
    }
    if (spineMid) {
      resolved.set('SpineMid', spineMid);
    }
  }

  return resolved;
}

/**
 * Real-time Character-Space Humanoid Skeletal Animator for 24-bone (Meshy) & 65-bone (Mixamo) rigs.
 * Applies character-space delta rotations via exact conjugation `q_local = R_P^-1 * Q_delta * R_P * q_rest`
 * so any skeleton's arbitrary local bind axes animate cleanly with ZERO per-frame allocations!
 */
export class HumanoidBoneDriver {
  public readonly isActive: boolean;

  private readonly rigRoot: THREE.Object3D;
  private readonly bones = new Map<HumanoidBoneKey, CapturedBone>();
  private readonly targetQuats = new Map<HumanoidBoneKey, THREE.Quaternion>();
  private readonly hipsUnitsPerMeter: number;
  private readonly kaijinArmLowerBias: number;

  // Zero-Allocation Hot-Path Scratch Objects
  private readonly scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly scratchDeltaQuat = new THREE.Quaternion();
  private readonly scratchTempQuat = new THREE.Quaternion();
  private readonly scratchTargetHipsPos = new THREE.Vector3();

  constructor(rigRoot: THREE.Object3D) {
    this.rigRoot = rigRoot;
    const boneMap = resolveHumanoidBoneMap(rigRoot);

    // Require at least Hips + arms + legs to treat this as an animatable humanoid rig
    const hasCoreSkeleton =
      boneMap.has('Hips') &&
      boneMap.has('RightArm') &&
      boneMap.has('LeftArm') &&
      boneMap.has('RightUpLeg') &&
      boneMap.has('LeftUpLeg');

    this.isActive = hasCoreSkeleton;
    if (!hasCoreSkeleton) {
      this.hipsUnitsPerMeter = 1;
      this.kaijinArmLowerBias = 0.44;
      return;
    }

    rigRoot.updateMatrixWorld(true);
    const rootWorldQuat = new THREE.Quaternion();
    const rootWorldScale = new THREE.Vector3(1, 1, 1);
    const rootWorldPos = new THREE.Vector3();
    rigRoot.matrixWorld.decompose(rootWorldPos, rootWorldQuat, rootWorldScale);
    const rootWorldQuatInv = rootWorldQuat.clone().invert();

    for (const [key, bone] of boneMap.entries()) {
      const parentWorldQuat = new THREE.Quaternion();
      if (bone.parent) {
        bone.parent.getWorldQuaternion(parentWorldQuat);
        parentWorldQuat.premultiply(rootWorldQuatInv);
      }
      this.bones.set(key, {
        bone,
        restLocalQuat: bone.quaternion.clone(),
        restParentWorldQuat: parentWorldQuat,
        restParentWorldQuatInv: parentWorldQuat.clone().invert(),
        restLocalPos: bone.position.clone(),
      });
      this.targetQuats.set(key, bone.quaternion.clone());
    }

    // Measure how many Hips local units equal 1.0 real-world meter (100 for Meshy cm armatures!)
    const hips = boneMap.get('Hips')!;
    const hipsParentScale = new THREE.Vector3(1, 1, 1);
    if (hips.parent) {
      hips.parent.getWorldScale(hipsParentScale);
    }
    const worldScaleY = Math.max(0.0005, Math.abs(hipsParentScale.y));
    this.hipsUnitsPerMeter = 1 / worldScaleY;

    // Auto-calibrate rest-pose arm abduction so BOTH wide T/A-pose rigs (~55 deg) and
    // relaxed A-pose sculpted Boss rigs (~20 deg) keep clean ribcage clearance in applyKaijinPose!
    const lArmBone = boneMap.get('LeftArm');
    const lForeBone = boneMap.get('LeftForeArm');
    if (lArmBone && lForeBone) {
      const pArm = new THREE.Vector3();
      const pFore = new THREE.Vector3();
      lArmBone.getWorldPosition(pArm);
      lForeBone.getWorldPosition(pFore);
      pFore.sub(pArm).applyQuaternion(rootWorldQuatInv);
      const downLen = Math.max(0.0001, -pFore.y);
      const restAbductionRad = Math.atan2(Math.abs(pFore.x), downLen);
      // Wide A-pose (~0.92 rad) gets ~0.44 lowering bias; relaxed A-pose (~0.28 rad) stays naturally clear (-0.08 outward!)
      this.kaijinArmLowerBias = THREE.MathUtils.clamp(restAbductionRad - 0.44, -0.1, 0.44);
    } else {
      this.kaijinArmLowerBias = 0.44;
    }
  }

  public get isActiveRig(): boolean {
    return this.isActive;
  }

  public getBone(key: HumanoidBoneKey): THREE.Object3D | null {
    return this.bones.get(key)?.bone ?? null;
  }

  /**
   * Creates a weapon mount Group inside `RightHand` or `LeftHand` that automatically compensates
   * for centimeter-scale armatures (0.01 -> 100x) and arbitrary hand bind-pose roll so meter-scale
   * weapons mount flush inside the Rider's real animated palm!
   */
  public createCalibratedHandMount(slot: 'RightHand' | 'LeftHand'): THREE.Group | null {
    const captured = this.bones.get(slot);
    if (!captured) return null;

    this.rigRoot.updateMatrixWorld(true);
    const rootWorldQuat = new THREE.Quaternion();
    const rootWorldScale = new THREE.Vector3(1, 1, 1);
    const rootWorldPos = new THREE.Vector3();
    this.rigRoot.matrixWorld.decompose(rootWorldPos, rootWorldQuat, rootWorldScale);

    const handWorldQuat = new THREE.Quaternion();
    const handWorldScale = new THREE.Vector3(1, 1, 1);
    const handWorldPos = new THREE.Vector3();
    captured.bone.matrixWorld.decompose(handWorldPos, handWorldQuat, handWorldScale);

    const invScale = 1 / Math.max(0.0005, Math.abs(handWorldScale.y));
    const handRelQuat = rootWorldQuat.clone().invert().multiply(handWorldQuat);

    const mount = new THREE.Group();
    mount.name = `Calibrated_${slot}_WeaponMount`;
    // Center grip directly inside the sculpted clenched fist cavity (knuckleY ~8.4cm, palm centerZ ~3.15cm)
    const sideOffset = slot === 'RightHand' ? -0.012 : 0.012;
    mount.position.set(sideOffset * invScale, 0.076 * invScale, 0.03 * invScale);
    // Scale weapons to 0.72x realistic suit-actor proportions while compensating for cm armature scale
    mount.scale.setScalar(invScale * 0.72);

    // Undo hand bind-pose roll so mount local +Y = world UP, +Z = world FORWARD in bind pose,
    // then pitch weapon cleanly forward out of the Rider's grip!
    const gripCorrection = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.PI * 0.38, 0, slot === 'RightHand' ? -0.18 : 0.18, 'YXZ')
    );
    mount.quaternion.copy(handRelQuat).invert().multiply(gripCorrection);
    captured.bone.add(mount);
    return mount;
  }

  /**
   * Creates a calibrated back mount on the upper chest spine bone for Super Form wings/crest.
   */
  public createCalibratedBackMount(): THREE.Group | null {
    const captured = this.bones.get('SpineUpper') ?? this.bones.get('SpineMid');
    if (!captured) return null;

    this.rigRoot.updateMatrixWorld(true);
    const scale = new THREE.Vector3(1, 1, 1);
    captured.bone.getWorldScale(scale);
    const invScale = 1 / Math.max(0.0005, Math.abs(scale.y));

    const mount = new THREE.Group();
    mount.name = 'Calibrated_BackWingMount';
    mount.scale.setScalar(invScale);
    mount.position.set(0, 0.08 * invScale, -0.14 * invScale);
    captured.bone.add(mount);
    return mount;
  }

  /**
   * Resets target pose buffer cleanly to rest bind pose (zero allocations).
   */
  public resetPose(): void {
    for (const [key, c] of this.bones.entries()) {
      const target = this.targetQuats.get(key);
      if (target) target.copy(c.restLocalQuat);
    }
    const hips = this.bones.get('Hips');
    if (hips) {
      this.scratchTargetHipsPos.copy(hips.restLocalPos);
    }
  }

  /**
   * Drives full live-action Kamen Rider suit-actor skeletal motion across all PlayerFSM states
   * with smooth per-bone quaternion slerp blending and true contralateral athletic locomotion.
   * Character space: +X = Rider's left, +Y = up, +Z = forward.
   */
  public applyRiderPose(
    state: PlayerStateId,
    p: number,
    animTime: number,
    activeElementId: ElementId,
    formTier: FormTier,
    stateTime: number,
    dt?: number,
    riderId: RiderId = 'nexus'
  ): void {
    if (!this.isActive) return;
    if (dt !== undefined && dt <= 0) return; // Freeze cleanly on Hit-Stop frame!
    this.resetPose();

    const isFastCombatState =
      state === 'ATTACK_1' ||
      state === 'ATTACK_2' ||
      state === 'ATTACK_3' ||
      state === 'DODGE' ||
      state === 'HITSTUN' ||
      state === 'ELEMENT_SKILL' ||
      state === 'RIDER_KICK';
    const blendRate = isFastCombatState ? 24 : 13;

    // Coordinate reference:
    // +X = Rider's left, -X = Rider's right, +Y = up, +Z = forward
    // RightArm: +rollZ lowers toward side, -yawY angles OUTWARD (right), -pitchX swings FORWARD (+Z)
    // LeftArm:  -rollZ lowers toward side, +yawY angles OUTWARD (left),  -pitchX swings FORWARD (+Z)
    // Legs:     -pitchX lifts thigh forward (+Z), +pitchX drives leg back (-Z); knee bend = +pitchX on Leg!

    if (state === 'DEAD') {
      this.offsetHips(0, -0.78, -0.12);
      this.rotateBone('Hips', -1.42, 0, 0.12);
      this.rotateBone('SpineUpper', -0.2, 0, 0);
      this.rotateBone('LeftArm', -0.2, 0.25, 0.45);
      this.rotateBone('RightArm', -0.35, -0.25, -0.4);
      this.rotateBone('LeftLeg', 0.35, 0, 0);
      this.rotateBone('RightLeg', 0.25, 0, 0);
      this.commitPose(dt, 10);
      return;
    }

    if (state === 'HENSHIN_SUPER') {
      const rise = Math.sin(p * Math.PI);
      this.offsetHips(0, rise * 0.26 - 0.05, 0);
      this.rotateBone('SpineLower', -0.12 * rise, 0, 0);
      this.rotateBone('SpineUpper', -0.16 * rise, 0, 0);
      this.rotateBone('Head', -0.18 * rise, 0, 0);
      this.rotateBone('LeftArm', -0.35, 0.22, -0.3 + rise * 0.95);
      this.rotateBone('LeftForeArm', -0.55 * (1 - rise * 0.5), 0, 0);
      this.rotateBone('RightArm', -0.35, -0.22, 0.3 - rise * 0.95);
      this.rotateBone('RightForeArm', -0.55 * (1 - rise * 0.5), 0, 0);
      this.rotateBone('LeftUpLeg', -0.15, 0, 0.12);
      this.rotateBone('RightUpLeg', -0.15, 0, -0.12);
      this.rotateBone('LeftLeg', 0.25, 0, 0);
      this.rotateBone('RightLeg', 0.25, 0, 0);
      this.commitPose(dt, 16);
      return;
    }

    if (state === 'RIDER_KICK') {
      if (stateTime < 0.14) {
        // Phase 1a: Deep explosive crouch coil before skyward jump
        const c = stateTime / 0.14;
        this.offsetHips(0, -0.26 * c, -0.06 * c);
        this.rotateBone('Hips', 0.34 * c, -0.18 * c, 0);
        this.rotateBone('SpineUpper', 0.24 * c, 0, 0);
        this.rotateBone('Head', -0.35 * c, 0, 0);
        this.rotateBone('LeftArm', 0.55 * c, 0.25, -0.45);
        this.rotateBone('RightArm', 0.55 * c, -0.25, 0.45);
        this.rotateBone('LeftUpLeg', -0.85 * c, 0, 0.08);
        this.rotateBone('LeftLeg', 1.45 * c, 0, 0);
        this.rotateBone('RightUpLeg', -0.78 * c, 0, -0.08);
        this.rotateBone('RightLeg', 1.38 * c, 0, 0);
      } else if (stateTime < 0.34) {
        // Phase 1b: Soaring aerial front-somersault tuck!
        const v = (stateTime - 0.14) / 0.2;
        const flipPitch = v * Math.PI * 2;
        this.offsetHips(0, 0.12, 0);
        this.rotateBone('Hips', flipPitch - 0.2, 0, 0);
        this.rotateBone('SpineUpper', 0.35, 0, 0);
        this.rotateBone('LeftArm', -1.35, 0.32, -0.45);
        this.rotateBone('LeftForeArm', -1.25, 0, 0);
        this.rotateBone('RightArm', -1.35, -0.32, 0.45);
        this.rotateBone('RightForeArm', -1.25, 0, 0);
        this.rotateBone('LeftUpLeg', -1.25, 0, 0.06);
        this.rotateBone('LeftLeg', 1.95, 0, 0);
        this.rotateBone('RightUpLeg', -1.25, 0, -0.06);
        this.rotateBone('RightLeg', 1.95, 0, 0);
      } else if (stateTime < 0.72) {
        // Phase 2: ICONIC KAMEN RIDER FLYING KICK! Right leg ramrod-straight forward-downward, left knee tucked!
        this.offsetHips(0, 0, 0.08);
        this.rotateBone('Hips', -0.62, -0.18, 0.08);
        this.rotateBone('SpineLower', -0.16, 0.08, 0);
        this.rotateBone('SpineUpper', -0.2, 0.14, 0);
        this.rotateBone('Head', 0.54, 0.1, 0);
        // Swept-back aerodynamic Tokusatsu arms
        this.rotateBone('RightArm', 0.62, -0.38, 0.62);
        this.rotateBone('RightForeArm', -0.52, 0, 0);
        this.rotateBone('LeftArm', 0.68, 0.38, -0.62);
        this.rotateBone('LeftForeArm', -0.58, 0, 0);
        // Right leg: FULLY EXTENDED BLAZING RIDER KICK BOOT!
        this.rotateBone('RightUpLeg', -1.26, 0.04, -0.04);
        this.rotateBone('RightLeg', 0.04, 0, 0);
        this.rotateBone('RightFoot', 0.46, 0, 0);
        // Left leg: Tightly tucked aerial counterbalance
        this.rotateBone('LeftUpLeg', -1.12, 0, 0.08);
        this.rotateBone('LeftLeg', 1.92, 0, 0);
        this.rotateBone('LeftFoot', 0.25, 0, 0);
      } else if (stateTime < 0.96) {
        // Phase 3a: Acrobatic backward backflip off target!
        const b = (stateTime - 0.72) / 0.24;
        this.offsetHips(0, 0.1, 0);
        this.rotateBone('Hips', -0.62 - b * (Math.PI * 2 - 0.62), 0, 0);
        this.rotateBone('SpineUpper', -0.18, 0, 0);
        this.rotateBone('LeftArm', -0.95, 0.3, -0.55);
        this.rotateBone('LeftForeArm', -0.85, 0, 0);
        this.rotateBone('RightArm', -0.95, -0.3, 0.55);
        this.rotateBone('RightForeArm', -0.85, 0, 0);
        this.rotateBone('LeftUpLeg', -1.05, 0, 0.08);
        this.rotateBone('LeftLeg', 1.72, 0, 0);
        this.rotateBone('RightUpLeg', -0.95, 0, -0.08);
        this.rotateBone('RightLeg', 1.62, 0, 0);
      } else {
        // Phase 3b: Heroic crouched superhero landing!
        const l = Math.min(1, (stateTime - 0.96) / 0.19);
        const cushion = Math.sin((1 - l) * Math.PI * 0.5);
        this.offsetHips(0, -0.24 * cushion, 0);
        this.rotateBone('Hips', 0.28 * cushion, 0, 0);
        this.rotateBone('SpineUpper', 0.22 * cushion, 0, 0);
        this.rotateBone('Head', -0.24 * cushion, 0, 0);
        this.rotateBone('LeftArm', -0.35, 0.26, -0.45);
        this.rotateBone('LeftForeArm', -0.72, 0, 0);
        this.rotateBone('RightArm', -0.38, -0.22, 0.48);
        this.rotateBone('RightForeArm', -0.68, 0, 0);
        this.rotateBone('LeftUpLeg', -0.68 * cushion - 0.18, 0, 0.1);
        this.rotateBone('LeftLeg', 1.15 * cushion + 0.28, 0, 0);
        this.rotateBone('RightUpLeg', 0.22 * cushion, 0, -0.1);
        this.rotateBone('RightLeg', 0.72 * cushion + 0.22, 0, 0);
      }
      this.commitPose(dt, 28);
      return;
    }

    if (state === 'ULTIMATE_CINEMATIC') {
      if (riderId === 'phantom') {
        // UNIT-02 PHANTOM DEDICATED SAMURAI KATANA OMNISLASH CHOREOGRAPHY (Not Unit-01 Flying Kick!)
        if (stateTime < 1.04) {
          // Beat 1: Deep Iaido Battoujutsu crouch-draw stance under Obsidian-Cyan Visor Cut-In
          const charge = Math.min(1, stateTime / 0.78);
          this.offsetHips(0, -0.3 * charge, -0.06 * charge);
          this.rotateBone('Hips', 0.34 * charge, -0.44 * charge, 0);
          this.rotateBone('SpineUpper', 0.22 * charge, -0.48 * charge, 0);
          this.rotateBone('Head', -0.34 * charge, 0.78 * charge, 0);
          // Right hand coiled low across left hip gripping Katana hilt; left hand bracing phantom sheath!
          this.rotateBone('RightArm', -0.52 * charge, 0.48 * charge, 0.24);
          this.rotateBone('RightForeArm', -1.22 * charge, 0, 0);
          this.rotateBone('LeftArm', -0.68 * charge, 0.32 * charge, -0.22);
          this.rotateBone('LeftForeArm', -1.1 * charge, 0, 0);
          this.rotateBone('LeftUpLeg', -0.82 * charge, 0.14, 0.12);
          this.rotateBone('LeftLeg', 1.32 * charge, 0, 0);
          this.rotateBone('RightUpLeg', 0.38 * charge, -0.14, -0.12);
          this.rotateBone('RightLeg', 0.76 * charge, 0, 0);
        } else if (stateTime < 2.24) {
          // Beat 2: High-Velocity Multi-Angle Katana Omnislash Blitz climaxing at 1.90s!
          const blitzT = stateTime - 1.04;
          const phaseIdx = Math.floor(blitzT / 0.22);
          const localP = (blitzT % 0.22) / 0.22;
          const dir = phaseIdx % 2 === 0 ? 1 : -1;
          const isClimaxSlash = stateTime >= 1.78;
          const s = isClimaxSlash
            ? this.smoothSwingCurve(Math.min(1, (stateTime - 1.78) / 0.34), 0.12, 0.72)
            : this.smoothSwingCurve(localP, 0.08, 0.78);

          this.offsetHips(0, isClimaxSlash ? -0.18 * s : -0.14, 0.14);
          this.rotateBone('Hips', 0.24, THREE.MathUtils.lerp(-0.65 * dir, 0.68 * dir, s), 0);
          this.rotateBone('SpineUpper', 0.18, THREE.MathUtils.lerp(-0.85 * dir, 0.92 * dir, s), 0);
          this.rotateBone('Head', -0.16, THREE.MathUtils.lerp(0.62 * dir, -0.55 * dir, s), 0);
          this.rotateBone(
            'RightArm',
            isClimaxSlash ? THREE.MathUtils.lerp(-2.35, 0.45, s) : THREE.MathUtils.lerp(-1.35, -0.45, s),
            THREE.MathUtils.lerp(-0.95 * dir, 0.92 * dir, s),
            0.18
          );
          this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.92, -0.18, s), 0, 0);
          this.rotateBone('LeftArm', 0.38, 0.42, -0.32);
          this.rotateBone('LeftForeArm', -0.75, 0, 0);
          this.rotateBone('LeftUpLeg', -0.58, 0, 0.1);
          this.rotateBone('LeftLeg', 0.88, 0, 0);
          this.rotateBone('RightUpLeg', 0.42, 0, -0.1);
          this.rotateBone('RightLeg', 0.62, 0, 0);
        } else {
          // Beat 3: Iconic Samurai Back-Turned Katana Sheathe (Noto) Pose as 5 Cyan-Crimson Slashes Detonate!
          const noto = Math.min(1, (stateTime - 2.24) / 0.35);
          this.offsetHips(0, -0.04, 0);
          this.rotateBone('Hips', 0.02, Math.PI, 0);
          this.rotateBone('SpineUpper', 0, 0.22, 0);
          this.rotateBone('Head', -0.04, -0.42, 0);
          // Cool samurai blade-lowered right arm + left hand resting at waist sheath
          this.rotateBone('RightArm', THREE.MathUtils.lerp(-0.55, 0.16, noto), -0.24, 0.18);
          this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.8, -0.32, noto), 0, 0);
          this.rotateBone('LeftArm', -0.35, 0.25, -0.22);
          this.rotateBone('LeftForeArm', -0.85, 0, 0);
          this.rotateBone('LeftUpLeg', -0.12, 0, 0.07);
          this.rotateBone('LeftLeg', 0.18, 0, 0);
          this.rotateBone('RightUpLeg', 0.1, 0, -0.07);
          this.rotateBone('RightLeg', 0.16, 0, 0);
        }
        this.commitPose(dt, 28);
        return;
      }

      if (stateTime < 1.02) {
        // Beat 1 (0.00-1.02s): Deep K-Driver crouch-charge under sleek 2D Visor Cut-In
        const charge = Math.min(1, stateTime / 0.85);
        this.offsetHips(0, -0.24 * charge + Math.sin(stateTime * 16) * 0.02, -0.05 * charge);
        this.rotateBone('Hips', 0.26 * charge, -0.28 * charge, 0);
        this.rotateBone('SpineUpper', 0.18 * charge, -0.32 * charge, 0);
        this.rotateBone('Head', -0.26 * charge, 0.45 * charge, 0);
        this.rotateBone('RightArm', 0.35 * charge - 0.3, -0.35, 0.48);
        this.rotateBone('RightForeArm', -0.75, 0, 0);
        this.rotateBone('LeftArm', -0.82, 0.24, -0.36);
        this.rotateBone('LeftForeArm', -0.95, 0, 0);
        this.rotateBone('LeftUpLeg', -0.72 * charge, 0, 0.1);
        this.rotateBone('LeftLeg', 1.18 * charge, 0, 0);
        this.rotateBone('RightUpLeg', 0.35 * charge, 0, -0.1);
        this.rotateBone('RightLeg', 0.65 * charge, 0, 0);
      } else if (stateTime < 1.44) {
        // Beat 2a (1.02-1.44s, Cut-In OPEN!): Skyward somersault vault into darkened sky beside Giant Pet!
        const vaultT = (stateTime - 1.02) / 0.42;
        this.offsetHips(0, 0.16 * Math.sin(vaultT * Math.PI), 0);
        this.rotateBone('Hips', vaultT * Math.PI * 2 - 0.3, 0, 0);
        this.rotateBone('SpineUpper', 0.32, 0, 0);
        this.rotateBone('Head', 0.22, 0, 0);
        this.rotateBone('LeftArm', -1.25, 0.3, -0.5);
        this.rotateBone('LeftForeArm', -1.15, 0, 0);
        this.rotateBone('RightArm', -1.25, -0.3, 0.5);
        this.rotateBone('RightForeArm', -1.15, 0, 0);
        this.rotateBone('LeftUpLeg', -1.16, 0, 0.08);
        this.rotateBone('LeftLeg', 1.84, 0, 0);
        this.rotateBone('RightUpLeg', -1.14, 0, -0.08);
        this.rotateBone('RightLeg', 1.8, 0, 0);
      } else if (stateTime < 2.42) {
        // Beat 2b (1.44-2.42s): FULL UNOBSTRUCTED 3D HYPER RIDER KICK impacting Boss at 1.90s!
        const landT = stateTime > 2.12 ? Math.min(1, (stateTime - 2.12) / 0.3) : 0;
        const kickHold = 1 - landT;
        this.offsetHips(0, -0.16 * landT, 0.08 * kickHold);
        this.rotateBone('Hips', THREE.MathUtils.lerp(-0.62, 0.18, landT), -0.18 * kickHold, 0.08 * kickHold);
        this.rotateBone('SpineLower', -0.16 * kickHold, 0.08 * kickHold, 0);
        this.rotateBone('SpineUpper', -0.2 * kickHold + 0.12 * landT, 0.14 * kickHold, 0);
        this.rotateBone('Head', 0.52 * kickHold - 0.12 * landT, 0.08 * kickHold, 0);
        this.rotateBone('RightArm', THREE.MathUtils.lerp(0.6, -0.35, landT), -0.38, 0.62);
        this.rotateBone('RightForeArm', -0.52, 0, 0);
        this.rotateBone('LeftArm', THREE.MathUtils.lerp(0.66, -0.45, landT), 0.38, -0.62);
        this.rotateBone('LeftForeArm', -0.58, 0, 0);
        this.rotateBone('RightUpLeg', THREE.MathUtils.lerp(-1.26, -0.28, landT), 0.04, -0.05);
        this.rotateBone('RightLeg', THREE.MathUtils.lerp(0.04, 0.52, landT), 0, 0);
        this.rotateBone('RightFoot', THREE.MathUtils.lerp(0.46, -0.15, landT), 0, 0);
        this.rotateBone('LeftUpLeg', THREE.MathUtils.lerp(-1.12, -0.42, landT), 0, 0.08);
        this.rotateBone('LeftLeg', THREE.MathUtils.lerp(1.92, 0.72, landT), 0, 0);
        this.rotateBone('LeftFoot', 0.24 * kickHold, 0, 0);
      } else {
        // Beat 3 (2.42-3.50s): Iconic Kamen Rider Back-Turned Explosion Pose!
        this.rotateBone('Hips', 0, Math.PI, 0);
        this.rotateBone('SpineUpper', 0, 0.24, 0);
        this.rotateBone('Head', 0, -0.35, 0);
        this.rotateBone('RightArm', -0.22, -0.15, 0.5);
        this.rotateBone('RightForeArm', -0.38, 0, 0);
        this.rotateBone('LeftArm', -0.42, 0.22, -0.44);
        this.rotateBone('LeftForeArm', -0.82, 0, 0);
      }
      this.commitPose(dt, 24);
      return;
    }

    if (state === 'FORM_SWITCH') {
      const pop = Math.sin(p * Math.PI);
      this.offsetHips(0, -0.06 + pop * 0.08, 0);
      this.rotateBone('SpineUpper', 0.06, -0.25 * pop, 0);
      // Left hand reaches forward near K-Driver belt without intersecting chest plate
      this.rotateBone('LeftArm', -0.72, 0.08, -0.45);
      this.rotateBone('LeftForeArm', -0.88, -0.22, 0);
      this.rotateBone('RightArm', -0.32, -0.22, 0.48);
      this.rotateBone('RightForeArm', -0.55, 0, 0);
      this.rotateBone('LeftUpLeg', -0.22, 0, 0.08);
      this.rotateBone('LeftLeg', 0.38, 0, 0);
      this.rotateBone('RightUpLeg', 0.16, 0, -0.08);
      this.rotateBone('RightLeg', 0.28, 0, 0);
      this.commitPose(dt, 20);
      return;
    }

    if (state === 'ELEMENT_SKILL') {
      if (riderId === 'phantom') {
        // UNIT-02 PHANTOM IAIDO CROSS: Low coiled dash-draw -> razor horizontal Katana cross-slash!
        const surge = this.smoothSwingCurve(p, 0.16, 0.56);
        this.offsetHips(0, -0.18 + Math.sin(Math.min(1, p * 1.4) * Math.PI) * 0.08, 0.14 * surge);
        this.rotateBone('Hips', 0.22, THREE.MathUtils.lerp(-0.72, 0.78, surge), 0);
        this.rotateBone('SpineUpper', 0.18, THREE.MathUtils.lerp(-0.88, 0.96, surge), 0);
        this.rotateBone('Head', -0.16, THREE.MathUtils.lerp(0.68, -0.58, surge), 0);
        this.rotateBone(
          'RightArm',
          THREE.MathUtils.lerp(-0.85, -0.95, surge),
          THREE.MathUtils.lerp(-0.98, 0.92, surge),
          0.18
        );
        this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-1.12, -0.14, surge), 0, 0);
        this.rotateBone('LeftArm', 0.42, 0.35, -0.28);
        this.rotateBone('LeftForeArm', -0.78, 0, 0);
        this.rotateBone('LeftUpLeg', -0.62, 0, 0.1);
        this.rotateBone('LeftLeg', 0.92, 0, 0);
        this.rotateBone('RightUpLeg', 0.44, 0, -0.1);
        this.rotateBone('RightLeg', 0.56, 0, 0);
        this.commitPose(dt, 28);
        return;
      }
      const surge = this.smoothSwingCurve(p, 0.22, 0.58);
      this.offsetHips(0, Math.sin(Math.min(1, p * 1.2) * Math.PI) * 0.24 - 0.06, 0);
      this.rotateBone('Hips', THREE.MathUtils.lerp(-0.14, 0.26, surge), 0, 0);
      this.rotateBone('SpineUpper', 0.15, THREE.MathUtils.lerp(-0.75, 0.85, surge), 0);
      this.rotateBone('RightArm', THREE.MathUtils.lerp(-2.25, 0.35, surge), THREE.MathUtils.lerp(-0.35, 0.35, surge), 0.38);
      this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.95, -0.25, surge), 0, 0);
      this.rotateBone('LeftArm', THREE.MathUtils.lerp(-1.55, 0.25, surge), 0.28, -0.38);
      this.rotateBone('LeftForeArm', -0.65, 0, 0);
      this.rotateBone('LeftUpLeg', -0.45 * surge, 0, 0.06);
      this.rotateBone('LeftLeg', 0.72 * surge, 0, 0);
      this.rotateBone('RightUpLeg', 0.32 * surge, 0, -0.06);
      this.rotateBone('RightLeg', 0.42, 0, 0);
      this.commitPose(dt, blendRate);
      return;
    }

    if (state === 'IDLE') {
      const breathe = Math.sin(animTime);
      const powerBoost = formTier !== 'BASIC' ? 0.05 : 0;
      // Athletic Kamen Rider martial fighting stance (ZERO chest clipping, natural outward arm clearance!)
      this.offsetHips(0, -0.055 + breathe * 0.015, 0);
      this.rotateBone('Hips', 0.04, -0.14, 0);
      this.rotateBone('SpineLower', 0.03, 0.05, 0);
      this.rotateBone('SpineUpper', 0.04 + breathe * 0.02, activeElementId === 'volt' ? 0.12 : -0.14, 0);
      this.rotateBone('Head', -0.04, 0.2, 0);

      // Right weapon arm: held forward & cleanly outside right ribcage (-yawY = outward right!)
      this.rotateBone('RightArm', -0.38 + breathe * 0.03, -0.16, 0.48 - powerBoost);
      this.rotateBone('RightForeArm', activeElementId === 'aqua' ? -0.92 : -0.72, 0.18, 0.12);
      this.rotateBone('RightHand', 0, 0.22, 0.18);

      // Left martial guard arm: angled OUTWARD (+yawY) away from chest plate, forearm raised cleanly in front of left shoulder!
      this.rotateBone('LeftArm', activeElementId === 'volt' ? -0.52 : -0.44 - breathe * 0.025, 0.22, -0.38 + powerBoost);
      this.rotateBone('LeftForeArm', activeElementId === 'volt' ? -0.88 : -0.82, 0.1, 0);
      this.rotateBone('LeftHand', 0.08, -0.15, -0.18);

      // Grounded wide athletic fighting leg stance
      this.rotateBone('LeftUpLeg', -0.2, 0.08, 0.09);
      this.rotateBone('LeftLeg', 0.34, 0, 0);
      this.rotateBone('LeftFoot', -0.14, 0, 0);
      this.rotateBone('RightUpLeg', 0.12, -0.1, -0.09);
      this.rotateBone('RightLeg', 0.26, 0, 0);
      this.rotateBone('RightFoot', -0.12, 0, 0);
      this.commitPose(dt, blendRate);
      return;
    }

    if (state === 'MOVE') {
      // True fluid contralateral human sprint!
      // When LeftUpLeg swings FORWARD (s > 0): RightArm swings FORWARD (-s) and LeftArm swings BACKWARD (+s)!
      const s = Math.sin(animTime);
      const c = Math.cos(animTime);
      this.offsetHips(0, -0.08 + Math.abs(s) * 0.055, 0);
      this.rotateBone('Hips', 0.18, -s * 0.14, s * 0.04);
      this.rotateBone('SpineLower', 0.08, s * 0.08, 0);
      this.rotateBone('SpineUpper', 0.1, s * 0.2, 0);
      this.rotateBone('Head', -0.24, -s * 0.1, 0);

      // Left Arm (empty): true opposite-of-left-leg runner pump, +yawY outward so elbow NEVER touches chest armor!
      this.rotateBone('LeftArm', s * 0.78 - 0.04, 0.18, -0.44);
      this.rotateBone('LeftForeArm', -1.08 - Math.max(0, -s) * 0.38, 0, 0);
      this.rotateBone('LeftHand', 0, -0.12, -0.15);

      // Right Arm (weapon hand): counter-swings forward when left leg leads, angled cleanly outside right hip (-yawY)
      this.rotateBone('RightArm', -s * 0.42 + 0.16, -0.22, 0.46);
      this.rotateBone('RightForeArm', -0.64 - Math.max(0, s) * 0.22, 0, 0);

      // Legs with anatomically accurate swing-recovery knee fold (+c on LeftLeg, -c on RightLeg)!
      this.rotateBone('LeftUpLeg', -s * 0.72 - 0.14, 0, 0.05);
      this.rotateBone('LeftLeg', 0.24 + Math.max(0, c) * 1.12 + Math.max(0, -s) * 0.2, 0, 0);
      this.rotateBone('LeftFoot', -0.18 + Math.max(0, -s) * 0.35, 0, 0);

      this.rotateBone('RightUpLeg', s * 0.72 - 0.14, 0, -0.05);
      this.rotateBone('RightLeg', 0.24 + Math.max(0, -c) * 1.12 + Math.max(0, s) * 0.2, 0, 0);
      this.rotateBone('RightFoot', -0.18 + Math.max(0, s) * 0.35, 0, 0);
      this.commitPose(dt, blendRate);
      return;
    }

    if (state === 'DODGE') {
      this.offsetHips(0, -0.26, 0.05);
      this.rotateBone('Hips', 0.42, -0.25, 0);
      this.rotateBone('SpineUpper', 0.28, -0.18, 0);
      this.rotateBone('Head', -0.45, 0.32, 0);
      this.rotateBone('LeftArm', 0.55, 0.25, -0.44);
      this.rotateBone('LeftForeArm', -0.75, 0, 0);
      this.rotateBone('RightArm', 0.48, -0.25, 0.44);
      this.rotateBone('RightForeArm', -0.65, 0, 0);
      this.rotateBone('LeftUpLeg', -0.82, 0, 0.06);
      this.rotateBone('LeftLeg', 1.12, 0, 0);
      this.rotateBone('RightUpLeg', 0.48, 0, -0.06);
      this.rotateBone('RightLeg', 0.65, 0, 0);
      this.commitPose(dt, blendRate);
      return;
    }

    if (state === 'HITSTUN') {
      const recoil = Math.sin(p * Math.PI);
      this.offsetHips(0, -0.08 * recoil, -0.1 * recoil);
      this.rotateBone('SpineLower', -0.22 * recoil, 0.2 * recoil, 0);
      this.rotateBone('SpineUpper', -0.26 * recoil, 0.22 * recoil, 0);
      this.rotateBone('Head', -0.35 * recoil, 0, 0);
      this.rotateBone('LeftArm', -0.45 * recoil, 0.25, -0.32);
      this.rotateBone('LeftForeArm', -0.65, 0, 0);
      this.rotateBone('RightArm', -0.45 * recoil, -0.25, 0.32);
      this.rotateBone('RightForeArm', -0.65, 0, 0);
      this.rotateBone('LeftUpLeg', -0.22, 0, 0.06);
      this.rotateBone('LeftLeg', 0.38, 0, 0);
      this.rotateBone('RightUpLeg', 0.18, 0, -0.06);
      this.rotateBone('RightLeg', 0.3, 0, 0);
      this.commitPose(dt, blendRate);
      return;
    }

    const isPolearm =
      activeElementId === 'aqua' || activeElementId === 'solar' || activeElementId === 'lux';
    const isBow = activeElementId === 'flora';
    const isDualGuns = activeElementId === 'umbra';

    if (state === 'ATTACK_1') {
      if (isBow) {
        // Flora Verdant Longbow: crisp sideways archery profile, Left arm aims bow straight forward, Right hand draws & releases!
        const draw = this.smoothSwingCurve(p, 0.08, 0.36);
        const release = this.smoothSwingCurve(p, 0.4, 0.72);
        this.offsetHips(0, -0.09, -0.03 * release);
        this.rotateBone('Hips', 0.08, -0.42, 0);
        this.rotateBone('SpineUpper', 0.06, -0.48 + release * 0.14, 0);
        this.rotateBone('Head', -0.05, 0.86 - release * 0.12, 0);
        // Bow hand (LeftArm): straight forward toward target
        this.rotateBone('LeftArm', -1.42 - release * 0.12, 0.72, -0.12);
        this.rotateBone('LeftForeArm', -0.12, 0, 0);
        // String hand (RightArm): draws to cheek then snaps cleanly back on loose
        this.rotateBone(
          'RightArm',
          THREE.MathUtils.lerp(-1.12, -1.36, draw) + release * 0.42,
          THREE.MathUtils.lerp(-0.22, -0.68, draw) - release * 0.32,
          0.32
        );
        this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.85, -1.78, draw) + release * 1.15, 0, 0);
        this.rotateBone('LeftUpLeg', -0.34, 0.22, 0.1);
        this.rotateBone('LeftLeg', 0.46, 0, 0);
        this.rotateBone('RightUpLeg', 0.22, -0.22, -0.1);
        this.rotateBone('RightLeg', 0.34, 0, 0);
        this.commitPose(dt, blendRate);
        return;
      }

      if (isDualGuns) {
        // Umbra Twin Pistols: sharp Right-Hand Gun-Kata snap-shot + muzzle kick while Left guards!
        const recoil = Math.sin(Math.min(1, Math.max(0, (p - 0.18) / 0.42)) * Math.PI);
        this.offsetHips(0, -0.09, -0.04 * recoil);
        this.rotateBone('Hips', 0.1, 0.24, 0);
        this.rotateBone('SpineUpper', 0.08, 0.34, 0);
        this.rotateBone('Head', -0.06, -0.52, 0);
        this.rotateBone('RightArm', -1.46 - recoil * 0.28, -0.18, 0.18);
        this.rotateBone('RightForeArm', -0.12 - recoil * 0.24, 0, 0);
        this.rotateBone('LeftArm', -0.55, 0.34, -0.44);
        this.rotateBone('LeftForeArm', -1.15, 0, 0);
        this.rotateBone('LeftUpLeg', -0.38, 0, 0.08);
        this.rotateBone('LeftLeg', 0.52, 0, 0);
        this.rotateBone('RightUpLeg', 0.28, 0, -0.08);
        this.rotateBone('RightLeg', 0.36, 0, 0);
        this.commitPose(dt, blendRate);
        return;
      }

      const swing = this.smoothSwingCurve(p, 0.2, 0.58);
      this.offsetHips(0, -0.1, 0.06 * swing);
      this.rotateBone('Hips', 0.14, THREE.MathUtils.lerp(-0.35, 0.42, swing), 0);
      this.rotateBone('SpineUpper', 0.12, THREE.MathUtils.lerp(-0.55, 0.68, swing), 0);
      this.rotateBone('Head', -0.1, THREE.MathUtils.lerp(0.45, -0.55, swing), 0);

      if (isPolearm) {
        this.rotateBone('RightArm', THREE.MathUtils.lerp(0.35, -1.48, swing), -0.12, 0.44);
        this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-1.35, -0.1, swing), 0, 0);
        this.rotateBone('LeftArm', THREE.MathUtils.lerp(-0.25, -1.15, swing), 0.28, -0.35);
        this.rotateBone('LeftForeArm', THREE.MathUtils.lerp(-1.1, -0.35, swing), 0, 0);
      } else {
        this.rotateBone(
          'RightArm',
          THREE.MathUtils.lerp(-0.95, -0.82, swing),
          THREE.MathUtils.lerp(-0.75, 0.65, swing),
          THREE.MathUtils.lerp(0.12, 0.58, swing)
        );
        this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.85, -0.25, swing), 0, 0);
        this.rotateBone('LeftArm', 0.15, 0.32, -0.42);
        this.rotateBone('LeftForeArm', -0.85, 0, 0);
      }
      this.rotateBone('LeftUpLeg', -0.42, 0, 0.08);
      this.rotateBone('LeftLeg', 0.58, 0, 0);
      this.rotateBone('RightUpLeg', 0.35, 0, -0.08);
      this.rotateBone('RightLeg', 0.35, 0, 0);
      this.commitPose(dt, blendRate);
      return;
    }

    if (state === 'ATTACK_2') {
      if (isBow) {
        // Flora Agile Crouched Quick-Shot
        const draw = this.smoothSwingCurve(p, 0.06, 0.32);
        const release = this.smoothSwingCurve(p, 0.36, 0.68);
        this.offsetHips(0, -0.22, 0.04);
        this.rotateBone('Hips', 0.18, -0.36, 0);
        this.rotateBone('SpineUpper', 0.14, -0.42 + release * 0.16, 0);
        this.rotateBone('Head', -0.18, 0.74, 0);
        this.rotateBone('LeftArm', -1.48 - release * 0.14, 0.62, -0.14);
        this.rotateBone('LeftForeArm', -0.12, 0, 0);
        this.rotateBone(
          'RightArm',
          THREE.MathUtils.lerp(-1.05, -1.38, draw) + release * 0.5,
          THREE.MathUtils.lerp(-0.18, -0.65, draw) - release * 0.28,
          0.34
        );
        this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.8, -1.72, draw) + release * 1.1, 0, 0);
        this.rotateBone('LeftUpLeg', -0.64, 0.14, 0.12);
        this.rotateBone('LeftLeg', 0.96, 0, 0);
        this.rotateBone('RightUpLeg', 0.36, -0.14, -0.12);
        this.rotateBone('RightLeg', 0.68, 0, 0);
        this.commitPose(dt, blendRate);
        return;
      }

      if (isDualGuns) {
        // Umbra Left-Hand Cross-Body Gun-Kata Snap-Shot!
        const recoil = Math.sin(Math.min(1, Math.max(0, (p - 0.18) / 0.42)) * Math.PI);
        this.offsetHips(0, -0.1, -0.04 * recoil);
        this.rotateBone('Hips', 0.1, -0.26, 0);
        this.rotateBone('SpineUpper', 0.08, -0.36, 0);
        this.rotateBone('Head', -0.06, 0.54, 0);
        this.rotateBone('LeftArm', -1.48 - recoil * 0.28, 0.18, -0.18);
        this.rotateBone('LeftForeArm', -0.12 - recoil * 0.24, 0, 0);
        this.rotateBone('RightArm', -0.48, -0.34, 0.44);
        this.rotateBone('RightForeArm', -1.12, 0, 0);
        this.rotateBone('RightUpLeg', -0.4, 0, -0.08);
        this.rotateBone('RightLeg', 0.55, 0, 0);
        this.rotateBone('LeftUpLeg', 0.26, 0, 0.08);
        this.rotateBone('LeftLeg', 0.36, 0, 0);
        this.commitPose(dt, blendRate);
        return;
      }

      const swing = this.smoothSwingCurve(p, 0.2, 0.6);
      this.offsetHips(0, -0.11, 0.08 * swing);
      this.rotateBone('Hips', 0.16, THREE.MathUtils.lerp(0.45, -0.45, swing), 0);
      this.rotateBone('SpineUpper', 0.14, THREE.MathUtils.lerp(0.62, -0.68, swing), 0);
      this.rotateBone('Head', -0.12, THREE.MathUtils.lerp(-0.5, 0.52, swing), 0);

      this.rotateBone(
        'RightArm',
        THREE.MathUtils.lerp(-0.85, -0.65, swing),
        THREE.MathUtils.lerp(0.65, -0.85, swing),
        THREE.MathUtils.lerp(0.58, 0.15, swing)
      );
      this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.55, -0.22, swing), 0, 0);

      if (activeElementId === 'volt' || activeElementId === 'aero') {
        this.rotateBone(
          'LeftArm',
          THREE.MathUtils.lerp(-1.0, -0.55, swing),
          THREE.MathUtils.lerp(0.75, -0.45, swing),
          -0.38
        );
        this.rotateBone('LeftForeArm', -0.45, 0, 0);
      } else {
        this.rotateBone('LeftArm', 0.22, 0.28, -0.46);
        this.rotateBone('LeftForeArm', -0.82, 0, 0);
      }
      this.rotateBone('RightUpLeg', -0.45, 0, -0.08);
      this.rotateBone('RightLeg', 0.62, 0, 0);
      this.rotateBone('LeftUpLeg', 0.32, 0, 0.08);
      this.rotateBone('LeftLeg', 0.38, 0, 0);
      this.commitPose(dt, blendRate);
      return;
    }

    if (state === 'ATTACK_3') {
      if (isBow) {
        // Flora Aerial Tri-Arrow Fan Volley Leap!
        const jumpArc = Math.sin(Math.min(1, p * 1.25) * Math.PI) * 0.34;
        const draw = this.smoothSwingCurve(p, 0.1, 0.38);
        const release = this.smoothSwingCurve(p, 0.42, 0.78);
        this.offsetHips(0, jumpArc - 0.06, -0.08 * release);
        this.rotateBone('Hips', 0.14, -0.44, 0);
        this.rotateBone('SpineUpper', 0.12, -0.48 + release * 0.2, 0);
        this.rotateBone('Head', -0.08, 0.88, 0);
        this.rotateBone('LeftArm', -1.26 - release * 0.18, 0.72, -0.1);
        this.rotateBone('LeftForeArm', -0.1, 0, 0);
        this.rotateBone(
          'RightArm',
          THREE.MathUtils.lerp(-1.1, -1.42, draw) + release * 0.6,
          THREE.MathUtils.lerp(-0.2, -0.78, draw) - release * 0.34,
          0.32
        );
        this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.85, -1.85, draw) + release * 1.35, 0, 0);
        this.rotateBone('LeftUpLeg', -0.68, 0, 0.08);
        this.rotateBone('LeftLeg', 1.18, 0, 0);
        this.rotateBone('RightUpLeg', 0.25, 0, -0.08);
        this.rotateBone('RightLeg', 0.65, 0, 0);
        this.commitPose(dt, blendRate);
        return;
      }

      if (isDualGuns) {
        // Umbra Twin-Gun Equilibrium Full Salvo! Both pistols aimed forward firing double-burst!
        const recoil = Math.abs(Math.sin(Math.min(1, p * 2.4) * Math.PI));
        this.offsetHips(0, -0.14, -0.06 * recoil);
        this.rotateBone('Hips', 0.12, 0, 0);
        this.rotateBone('SpineUpper', 0.08 - recoil * 0.08, 0, 0);
        this.rotateBone('Head', -0.1, 0, 0);
        this.rotateBone('RightArm', -1.48 - recoil * 0.24, -0.24, 0.18);
        this.rotateBone('RightForeArm', -0.14 - recoil * 0.2, 0, 0);
        this.rotateBone('LeftArm', -1.48 - recoil * 0.24, 0.24, -0.18);
        this.rotateBone('LeftForeArm', -0.14 - recoil * 0.2, 0, 0);
        this.rotateBone('LeftUpLeg', -0.46, 0.14, 0.12);
        this.rotateBone('LeftLeg', 0.62, 0, 0);
        this.rotateBone('RightUpLeg', -0.46, -0.14, -0.12);
        this.rotateBone('RightLeg', 0.62, 0, 0);
        this.commitPose(dt, blendRate);
        return;
      }

      const swing = this.smoothSwingCurve(p, 0.24, 0.62);
      const jumpArc = Math.sin(Math.min(1, p * 1.35) * Math.PI) * 0.24;
      this.offsetHips(0, jumpArc - 0.08, 0.08 * swing);
      this.rotateBone('Hips', THREE.MathUtils.lerp(-0.18, 0.34, swing), 0, 0);
      this.rotateBone(
        'SpineUpper',
        THREE.MathUtils.lerp(-0.22, 0.28, swing),
        activeElementId === 'volt' ? THREE.MathUtils.lerp(-0.8, 0.95, swing) : THREE.MathUtils.lerp(-0.35, 0.35, swing),
        0
      );
      this.rotateBone('RightArm', THREE.MathUtils.lerp(-2.45, 0.42, swing), -0.1, 0.42);
      this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.75, -0.18, swing), 0, 0);
      this.rotateBone('LeftArm', THREE.MathUtils.lerp(-2.0, 0.22, swing), 0.25, -0.42);
      this.rotateBone('LeftForeArm', -0.55, 0, 0);
      this.rotateBone('LeftUpLeg', -0.52 * swing, 0, 0.06);
      this.rotateBone('LeftLeg', 0.78 * swing, 0, 0);
      this.rotateBone('RightUpLeg', 0.35 * swing, 0, -0.06);
      this.rotateBone('RightLeg', 0.42, 0, 0);
      this.commitPose(dt, blendRate);
    }
  }

  /**
   * Drives heavy organic Kaijin monster skeletal animation across all EnemyAIState states!
   */
  public applyKaijinPose(
    aiState: EnemyAIState,
    stateTimer: number,
    telegraphDur: number,
    animTime: number,
    dt?: number
  ): void {
    if (!this.isActive) return;
    if (dt !== undefined && dt <= 0) return;
    this.resetPose();
    const armBias = this.kaijinArmLowerBias;

    if (aiState === 'DEAD') {
      const t = Math.min(1, stateTimer / 0.65);
      this.offsetHips(0, -0.85 * t, -0.18 * t);
      this.rotateBone('Hips', -1.45 * t, 0.15 * t, 0);
      this.rotateBone('LeftArm', -0.4 * t, 0.2, 0.35 * t);
      this.rotateBone('RightArm', -0.5 * t, -0.2, -0.35 * t);
      this.rotateBone('LeftLeg', 0.45 * t, 0, 0);
      this.rotateBone('RightLeg', 0.35 * t, 0, 0);
      this.commitPose(dt, 14);
      return;
    }

    if (aiState === 'STAGGERED') {
      const sway = Math.sin(animTime * 6.5);
      this.offsetHips(0, -0.22, 0);
      this.rotateBone('SpineLower', 0.28, sway * 0.22, sway * 0.12);
      this.rotateBone('SpineUpper', 0.26, -sway * 0.15, 0);
      this.rotateBone('Head', 0.38, sway * 0.32, 0);
      this.rotateBone('LeftArm', 0.18, 0.22, -armBias * 0.85);
      this.rotateBone('LeftForeArm', -0.45, 0, 0);
      this.rotateBone('RightArm', 0.18, -0.22, armBias * 0.85);
      this.rotateBone('RightForeArm', -0.45, 0, 0);
      this.rotateBone('LeftUpLeg', -0.32, 0, 0.12);
      this.rotateBone('LeftLeg', 0.58, 0, 0);
      this.rotateBone('RightUpLeg', -0.28, 0, -0.12);
      this.rotateBone('RightLeg', 0.52, 0, 0);
      this.commitPose(dt, 12);
      return;
    }

    if (aiState === 'HITSTUN') {
      const recoil = Math.sin(Math.min(1, stateTimer / 0.28) * Math.PI);
      this.offsetHips(0, -0.06 * recoil, -0.12 * recoil);
      this.rotateBone('SpineUpper', -0.35 * recoil, 0.25 * recoil, 0);
      this.rotateBone('Head', -0.42 * recoil, 0, 0);
      this.rotateBone('LeftArm', -0.4 * recoil, 0.2, -armBias * 0.6);
      this.rotateBone('RightArm', -0.4 * recoil, -0.2, armBias * 0.6);
      this.commitPose(dt, 22);
      return;
    }

    if (aiState === 'TELEGRAPH') {
      const t = Math.min(1, stateTimer / Math.max(0.1, telegraphDur));
      const tremor = Math.sin(stateTimer * 36) * 0.04;
      this.offsetHips(0, -0.14 * t, 0);
      this.rotateBone('SpineLower', -0.2 * t, tremor, 0);
      this.rotateBone('SpineUpper', -0.28 * t, -tremor, 0);
      this.rotateBone('Head', -0.38 * t, 0, 0);
      this.rotateBone('LeftArm', -2.15 * t - 0.25, 0.22, -armBias + 0.45 * t);
      this.rotateBone('LeftForeArm', -0.85 * t - 0.3, 0, 0);
      this.rotateBone('RightArm', -2.15 * t - 0.25, -0.22, armBias - 0.45 * t);
      this.rotateBone('RightForeArm', -0.85 * t - 0.3, 0, 0);
      this.rotateBone('LeftUpLeg', -0.34 * t, 0, 0.12);
      this.rotateBone('LeftLeg', 0.58 * t, 0, 0);
      this.rotateBone('RightUpLeg', -0.24 * t, 0, -0.12);
      this.rotateBone('RightLeg', 0.48 * t, 0, 0);
      this.commitPose(dt, 16);
      return;
    }

    if (aiState === 'ATTACK_ACTIVE' || aiState === 'RECOVERY') {
      const slamT = aiState === 'ATTACK_ACTIVE' ? Math.min(1, stateTimer / 0.14) : 1;
      const recoverT = aiState === 'RECOVERY' ? Math.min(1, stateTimer / 0.85) : 0;
      const slam = slamT * (1 - recoverT * 0.65);
      this.offsetHips(0, -0.26 * slam, 0.16 * slam);
      this.rotateBone('SpineLower', 0.44 * slam, 0, 0);
      this.rotateBone('SpineUpper', 0.36 * slam, 0, 0);
      this.rotateBone('LeftArm', THREE.MathUtils.lerp(-2.2, 0.35, slamT) * (1 - recoverT * 0.4), 0.22, -armBias);
      this.rotateBone('LeftForeArm', -0.45, 0, 0);
      this.rotateBone('RightArm', THREE.MathUtils.lerp(-2.2, 0.35, slamT) * (1 - recoverT * 0.4), -0.22, armBias);
      this.rotateBone('RightForeArm', -0.45, 0, 0);
      this.rotateBone('LeftUpLeg', -0.54 * slam, 0, 0.12);
      this.rotateBone('LeftLeg', 0.8 * slam, 0, 0);
      this.rotateBone('RightUpLeg', 0.26 * slam, 0, -0.12);
      this.rotateBone('RightLeg', 0.48 * slam, 0, 0);
      this.commitPose(dt, 22);
      return;
    }

    // CHASE: Heavy stomping contralateral monster stride!
    const s = Math.sin(animTime * 6.8);
    const c = Math.cos(animTime * 6.8);
    this.offsetHips(0, -0.09 + Math.abs(s) * 0.06, 0);
    this.rotateBone('Hips', 0.16, -s * 0.16, s * 0.05);
    this.rotateBone('SpineLower', 0.14, s * 0.12, 0);
    this.rotateBone('SpineUpper', 0.14, s * 0.16, 0);
    this.rotateBone('Head', -0.24, -s * 0.1, 0);
    // Contralateral monster arm swing (+s LeftArm opposite -s LeftUpLeg, auto-calibrated outward clearance!)
    this.rotateBone('LeftArm', s * 0.62 - 0.35, 0.24, -armBias);
    this.rotateBone('LeftForeArm', -0.82, 0, 0);
    this.rotateBone('RightArm', -s * 0.62 - 0.35, -0.24, armBias);
    this.rotateBone('RightForeArm', -0.82, 0, 0);
    this.rotateBone('LeftUpLeg', -s * 0.62 - 0.15, 0, 0.08);
    this.rotateBone('LeftLeg', 0.28 + Math.max(0, c) * 0.85, 0, 0);
    this.rotateBone('RightUpLeg', s * 0.62 - 0.15, 0, -0.08);
    this.rotateBone('RightLeg', 0.28 + Math.max(0, -c) * 0.85, 0, 0);
    this.commitPose(dt, 13);
  }

  private rotateBone(key: HumanoidBoneKey, pitchX: number, yawY: number, rollZ: number): void {
    const captured = this.bones.get(key);
    const target = this.targetQuats.get(key);
    if (!captured || !target) return;

    this.scratchEuler.set(pitchX, yawY, rollZ, 'YXZ');
    this.scratchDeltaQuat.setFromEuler(this.scratchEuler);

    // Exact conjugation: q_local = R_P^-1 * Q_delta * R_P * q_rest (ZERO allocations!)
    this.scratchTempQuat
      .copy(captured.restParentWorldQuatInv)
      .multiply(this.scratchDeltaQuat)
      .multiply(captured.restParentWorldQuat)
      .multiply(captured.restLocalQuat);

    target.copy(this.scratchTempQuat);
  }

  private offsetHips(dxMeters: number, dyMeters: number, dzMeters: number): void {
    const hips = this.bones.get('Hips');
    if (!hips) return;
    this.scratchTargetHipsPos.set(
      hips.restLocalPos.x + dxMeters * this.hipsUnitsPerMeter,
      hips.restLocalPos.y + dyMeters * this.hipsUnitsPerMeter,
      hips.restLocalPos.z + dzMeters * this.hipsUnitsPerMeter
    );
  }

  private commitPose(dt: number | undefined, blendRate: number): void {
    const alpha = dt === undefined ? 1 : Math.min(1, 1 - Math.exp(-blendRate * dt));
    for (const [key, c] of this.bones.entries()) {
      const target = this.targetQuats.get(key);
      if (!target) continue;
      if (alpha >= 0.999) {
        c.bone.quaternion.copy(target);
      } else {
        c.bone.quaternion.slerp(target, alpha);
      }
    }
    const hips = this.bones.get('Hips');
    if (hips) {
      if (alpha >= 0.999) {
        hips.bone.position.copy(this.scratchTargetHipsPos);
      } else {
        hips.bone.position.lerp(this.scratchTargetHipsPos, alpha);
      }
    }
  }

  private smoothSwingCurve(p: number, windupEnd: number, swingEnd: number): number {
    if (p <= windupEnd) return 0;
    if (p >= swingEnd) return 1;
    const t = (p - windupEnd) / (swingEnd - windupEnd);
    return 1 - Math.pow(1 - t, 3);
  }
}

import * as THREE from 'three';
import type { ElementId, FormTier, PlayerStateId } from '../game/types/schema';
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
    dt?: number
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
      state === 'ELEMENT_SKILL';
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

    if (state === 'ULTIMATE_CINEMATIC') {
      if (stateTime < 1.15) {
        this.offsetHips(0, -0.12 + Math.sin(stateTime * 14) * 0.025, 0);
        this.rotateBone('SpineUpper', -0.18, -0.45, 0);
        this.rotateBone('RightArm', -2.35, -0.15, 0.25);
        this.rotateBone('RightForeArm', -0.55, 0, 0);
        this.rotateBone('LeftArm', -0.85, 0.35, -0.32);
        this.rotateBone('LeftForeArm', -0.75, 0, 0);
        this.rotateBone('LeftUpLeg', -0.38, 0, 0.08);
        this.rotateBone('LeftLeg', 0.65, 0, 0);
        this.rotateBone('RightUpLeg', 0.25, 0, -0.08);
        this.rotateBone('RightLeg', 0.42, 0, 0);
      } else if (stateTime < 2.2) {
        const slashT = Math.min(1, (stateTime - 1.15) / 0.45);
        this.offsetHips(0, Math.sin(slashT * Math.PI) * 0.45, 0);
        this.rotateBone('Hips', THREE.MathUtils.lerp(-0.18, 0.35, slashT), 0, 0);
        this.rotateBone('SpineUpper', 0.22, THREE.MathUtils.lerp(-0.65, 0.78, slashT), 0);
        this.rotateBone('RightArm', THREE.MathUtils.lerp(-2.4, 0.45, slashT), -0.12, 0.42);
        this.rotateBone('RightForeArm', -0.35, 0, 0);
        this.rotateBone('LeftArm', -0.35, 0.35, -0.32);
        this.rotateBone('LeftUpLeg', -0.55 * slashT, 0, 0);
        this.rotateBone('LeftLeg', 0.85 * slashT, 0, 0);
        this.rotateBone('RightUpLeg', 0.32 * slashT, 0, 0);
      } else {
        this.rotateBone('Hips', 0, Math.PI, 0);
        this.rotateBone('SpineUpper', 0, 0.24, 0);
        this.rotateBone('Head', 0, -0.35, 0);
        this.rotateBone('RightArm', -0.22, -0.15, 0.5);
        this.rotateBone('RightForeArm', -0.38, 0, 0);
        this.rotateBone('LeftArm', -0.42, 0.22, -0.44);
        this.rotateBone('LeftForeArm', -0.82, 0, 0);
      }
      this.commitPose(dt, 18);
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

    if (state === 'ATTACK_1') {
      const swing = this.smoothSwingCurve(p, 0.2, 0.58);
      this.offsetHips(0, -0.1, 0.06 * swing);
      this.rotateBone('Hips', 0.14, THREE.MathUtils.lerp(-0.35, 0.42, swing), 0);
      this.rotateBone('SpineUpper', 0.12, THREE.MathUtils.lerp(-0.55, 0.68, swing), 0);
      this.rotateBone('Head', -0.1, THREE.MathUtils.lerp(0.45, -0.55, swing), 0);

      if (activeElementId === 'aqua') {
        this.rotateBone('RightArm', THREE.MathUtils.lerp(0.35, -1.45, swing), -0.12, 0.48);
        this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-1.35, -0.12, swing), 0, 0);
      } else {
        this.rotateBone(
          'RightArm',
          THREE.MathUtils.lerp(-0.95, -0.82, swing),
          THREE.MathUtils.lerp(-0.75, 0.65, swing),
          THREE.MathUtils.lerp(0.12, 0.58, swing)
        );
        this.rotateBone('RightForeArm', THREE.MathUtils.lerp(-0.85, -0.25, swing), 0, 0);
      }
      this.rotateBone('LeftArm', 0.15, 0.32, -0.42);
      this.rotateBone('LeftForeArm', -0.85, 0, 0);
      this.rotateBone('LeftUpLeg', -0.42, 0, 0.08);
      this.rotateBone('LeftLeg', 0.58, 0, 0);
      this.rotateBone('RightUpLeg', 0.35, 0, -0.08);
      this.rotateBone('RightLeg', 0.35, 0, 0);
      this.commitPose(dt, blendRate);
      return;
    }

    if (state === 'ATTACK_2') {
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

      if (activeElementId === 'volt') {
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
      this.rotateBone('LeftArm', 0.18, 0.22, -0.38);
      this.rotateBone('LeftForeArm', -0.45, 0, 0);
      this.rotateBone('RightArm', 0.18, -0.22, 0.38);
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
      this.rotateBone('LeftArm', -0.4 * recoil, 0.2, -0.25);
      this.rotateBone('RightArm', -0.4 * recoil, -0.2, 0.25);
      this.commitPose(dt, 22);
      return;
    }

    if (aiState === 'TELEGRAPH') {
      const t = Math.min(1, stateTimer / Math.max(0.1, telegraphDur));
      const tremor = Math.sin(stateTimer * 36) * 0.04;
      this.offsetHips(0, -0.12 * t, 0);
      this.rotateBone('SpineLower', -0.2 * t, tremor, 0);
      this.rotateBone('SpineUpper', -0.25 * t, -tremor, 0);
      this.rotateBone('Head', -0.35 * t, 0, 0);
      this.rotateBone('LeftArm', -2.15 * t - 0.25, 0.22, -0.4 + 0.5 * t);
      this.rotateBone('LeftForeArm', -0.85 * t - 0.3, 0, 0);
      this.rotateBone('RightArm', -2.15 * t - 0.25, -0.22, 0.4 - 0.5 * t);
      this.rotateBone('RightForeArm', -0.85 * t - 0.3, 0, 0);
      this.rotateBone('LeftUpLeg', -0.32 * t, 0, 0.12);
      this.rotateBone('LeftLeg', 0.55 * t, 0, 0);
      this.rotateBone('RightUpLeg', -0.22 * t, 0, -0.12);
      this.rotateBone('RightLeg', 0.45 * t, 0, 0);
      this.commitPose(dt, 16);
      return;
    }

    if (aiState === 'ATTACK_ACTIVE' || aiState === 'RECOVERY') {
      const slamT = aiState === 'ATTACK_ACTIVE' ? Math.min(1, stateTimer / 0.14) : 1;
      const recoverT = aiState === 'RECOVERY' ? Math.min(1, stateTimer / 0.85) : 0;
      const slam = slamT * (1 - recoverT * 0.65);
      this.offsetHips(0, -0.24 * slam, 0.14 * slam);
      this.rotateBone('SpineLower', 0.42 * slam, 0, 0);
      this.rotateBone('SpineUpper', 0.35 * slam, 0, 0);
      this.rotateBone('LeftArm', THREE.MathUtils.lerp(-2.2, 0.35, slamT) * (1 - recoverT * 0.4), 0.22, -0.45);
      this.rotateBone('LeftForeArm', -0.45, 0, 0);
      this.rotateBone('RightArm', THREE.MathUtils.lerp(-2.2, 0.35, slamT) * (1 - recoverT * 0.4), -0.22, 0.45);
      this.rotateBone('RightForeArm', -0.45, 0, 0);
      this.rotateBone('LeftUpLeg', -0.52 * slam, 0, 0.12);
      this.rotateBone('LeftLeg', 0.78 * slam, 0, 0);
      this.rotateBone('RightUpLeg', 0.25 * slam, 0, -0.12);
      this.rotateBone('RightLeg', 0.45 * slam, 0, 0);
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
    // Contralateral monster arm swing (+s LeftArm opposite -s LeftUpLeg, outward yaw clearance)
    this.rotateBone('LeftArm', s * 0.58 - 0.35, 0.24, -0.44);
    this.rotateBone('LeftForeArm', -0.78, 0, 0);
    this.rotateBone('RightArm', -s * 0.58 - 0.35, -0.24, 0.44);
    this.rotateBone('RightForeArm', -0.78, 0, 0);
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

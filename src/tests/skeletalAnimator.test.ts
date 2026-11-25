import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HumanoidBoneDriver, resolveHumanoidBoneMap } from '../engine/HumanoidBoneDriver';
import {
  computeNormalizedRigScale,
  findRigSocket,
  resolveBoneSocketName,
  resolveClipForState,
  SkeletalAnimator,
} from '../engine/SkeletalAnimator';

describe('SkeletalAnimator & Mixamo Bone Socket Pipeline', () => {
  it('resolves both custom named sockets and standard Mixamo humanoid bone names', () => {
    const customRigNodes = ['BodyPivot', 'RightHand', 'LeftHand', 'BackWing', 'HeadPivot'];
    expect(resolveBoneSocketName(customRigNodes, 'RightHand')).toBe('RightHand');
    expect(resolveBoneSocketName(customRigNodes, 'BackWing')).toBe('BackWing');

    const mixamoNodes = [
      'mixamorigHips',
      'mixamorigSpine',
      'mixamorigSpine1',
      'mixamorigSpine2',
      'mixamorigHead',
      'mixamorig:RightHand',
      'mixamorigLeftHand',
      'mixamorigLeftShoulder',
    ];
    expect(resolveBoneSocketName(mixamoNodes, 'RightHand')).toBe('mixamorig:RightHand');
    expect(resolveBoneSocketName(mixamoNodes, 'LeftHand')).toBe('mixamorigLeftHand');
    expect(resolveBoneSocketName(mixamoNodes, 'BackWing')).toBe('mixamorigSpine2');
    expect(resolveBoneSocketName(mixamoNodes, 'HeadPivot')).toBe('mixamorigHead');
    expect(resolveBoneSocketName(mixamoNodes, 'BeltCore')).toBe('mixamorigHips');
  });

  it('fuzzy-matches Mixamo clip names cleanly across PlayerFSM & EnemyAI states', () => {
    const mixamoClips = [
      'Sword And Shield Idle',
      'Sword And Shield Run',
      'Great Sword Slash',
      'Horizontal Slash',
      'Spin Attack Heavy',
      'Stand To Roll',
      'Standing React Large From Front',
      'Standing Death Backward 01',
    ];

    expect(resolveClipForState(mixamoClips, 'IDLE')).toBe('Sword And Shield Idle');
    expect(resolveClipForState(mixamoClips, 'MOVE')).toBe('Sword And Shield Run');
    expect(resolveClipForState(mixamoClips, 'ATTACK_1')).toBe('Great Sword Slash');
    expect(resolveClipForState(mixamoClips, 'ATTACK_2')).toBe('Horizontal Slash');
    expect(resolveClipForState(mixamoClips, 'ATTACK_3')).toBe('Spin Attack Heavy');
    expect(resolveClipForState(mixamoClips, 'DODGE')).toBe('Stand To Roll');
    expect(resolveClipForState(mixamoClips, 'HITSTUN')).toBe('Standing React Large From Front');
    expect(resolveClipForState(mixamoClips, 'DEAD')).toBe('Standing Death Backward 01');
  });

  it('auto-normalizes centimeter/meter Mixamo heights cleanly and drives AnimationMixer without throwing', () => {
    // 184 cm Mixamo FBX export -> 1.84 m scale factor = 0.01
    expect(computeNormalizedRigScale(184, 1.84)).toBeCloseTo(0.01, 4);
    expect(computeNormalizedRigScale(1.84, 1.84)).toBeCloseTo(1.0, 4);
    expect(computeNormalizedRigScale(0, 1.84)).toBe(1);

    const root = new THREE.Group();
    const hand = new THREE.Object3D();
    hand.name = 'mixamorigRightHand';
    root.add(hand);
    expect(findRigSocket(root, 'RightHand')).toBe(hand);

    const track = new THREE.NumberKeyframeTrack('.rotation[y]', [0, 1], [0, Math.PI]);
    const idleClip = new THREE.AnimationClip('Idle', 1, [track]);
    const runClip = new THREE.AnimationClip('Run', 1, [track]);

    const animator = new SkeletalAnimator(root, [idleClip, runClip]);
    expect(animator.hasClips).toBe(true);
    expect(animator.playState('IDLE', { loop: true })).toBe(true);
    animator.update(0.016);
    expect(animator.playState('MOVE', { loop: true, fadeSec: 0.1 })).toBe(true);
    animator.update(0.016);
    animator.dispose();
  });

  it('ignores trivial 1-frame static bind clips and drives Meshy 24-bone inverted spine order with calibrated cm->m hand mounts', () => {
    const root = new THREE.Group();
    const armature = new THREE.Group();
    armature.name = 'Armature';
    armature.scale.setScalar(0.01);
    root.add(armature);

    const makeBone = (name: string, parent: THREE.Object3D, y = 10) => {
      const b = new THREE.Object3D();
      b.name = name;
      b.position.set(0, y, 0);
      parent.add(b);
      return b;
    };

    const hips = makeBone('Hips', armature, 93);
    const spine02 = makeBone('Spine02', hips, 11);
    const spine01 = makeBone('Spine01', spine02, 11);
    const spineUpper = makeBone('Spine', spine01, 11);
    const rShoulder = makeBone('RightShoulder', spineUpper, 2);
    const rArm = makeBone('RightArm', rShoulder, 16);
    const rFore = makeBone('RightForeArm', rArm, 22);
    makeBone('RightHand', rFore, 22);
    const lShoulder = makeBone('LeftShoulder', spineUpper, 2);
    const lArm = makeBone('LeftArm', lShoulder, 16);
    const lFore = makeBone('LeftForeArm', lArm, 22);
    makeBone('LeftHand', lFore, 22);
    makeBone('LeftUpLeg', hips, -9);
    makeBone('RightUpLeg', hips, -9);

    const bindClip = new THREE.AnimationClip('Armature|clip0|baselayer', 0.033, []);
    const animator = new SkeletalAnimator(root, [bindClip]);
    expect(animator.hasClips).toBe(false);
    animator.dispose();

    const boneMap = resolveHumanoidBoneMap(root);
    expect(boneMap.get('SpineLower')).toBe(spine02);
    expect(boneMap.get('SpineUpper')).toBe(spineUpper);

    const driver = new HumanoidBoneDriver(root);
    expect(driver.isActive).toBe(true);

    const handMount = driver.createCalibratedHandMount('RightHand');
    expect(handMount).not.toBeNull();
    // Compensates 0.01 cm Armature scale to 0.72x realistic weapon proportion (72x local)!
    expect(handMount!.scale.y).toBeCloseTo(72, 1);

    const restArmQ = rArm.quaternion.clone();
    driver.applyRiderPose('ATTACK_1', 0.45, 1.2, 'pyro', 'BASIC', 0.2);
    expect(rArm.quaternion.equals(restArmQ)).toBe(false);

    driver.applyKaijinPose('TELEGRAPH', 0.35, 0.55, 2.0);
    expect(rArm.quaternion.equals(restArmQ)).toBe(false);
  });

  it('auto-slices Meshy Thrust_Slash & Roll_Dodge clips and enables hybrid procedural handoff for unmapped Tokusatsu states', () => {
    const root = new THREE.Group();
    const track3s = new THREE.NumberKeyframeTrack('.rotation[y]', [0, 1.5, 3.0], [0, 1.5, 0]);
    const trackRoll = new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.9, 1.833], [0, 0.5, 6.28]);
    const trackRun = new THREE.NumberKeyframeTrack('.rotation[z]', [0, 0.633], [0, 0.4]);

    const clips = [
      new THREE.AnimationClip('Idle_5', 1.833, [trackRun]),
      new THREE.AnimationClip('Running', 0.633, [trackRun]),
      new THREE.AnimationClip('Roll_Dodge', 1.833, [trackRoll]),
      new THREE.AnimationClip('Thrust_Slash', 3.0, [track3s]),
      new THREE.AnimationClip('Dead', 2.967, [track3s]),
    ];

    const animator = new SkeletalAnimator(root, clips);
    expect(animator.hasClipForState('IDLE')).toBe(true);
    expect(animator.hasClipForState('MOVE')).toBe(true);
    expect(animator.hasClipForState('DODGE')).toBe(true);
    expect(animator.hasClipForState('ATTACK_1')).toBe(true);
    expect(animator.hasClipForState('ATTACK_2')).toBe(true);
    expect(animator.hasClipForState('DEAD')).toBe(true);

    // Subclip slicing shortens Roll_Dodge (~1.0s) and splits Thrust_Slash (~1.1s + ~1.2s)
    expect(animator.getClipDuration('DODGE')).toBeLessThan(1.2);
    expect(animator.getClipDuration('ATTACK_1')).toBeLessThan(1.3);
    expect(animator.getClipDuration('ATTACK_2')).toBeLessThan(1.35);

    // Tokusatsu states without a dedicated mocap clip cleanly report false for HumanoidBoneDriver handoff
    expect(animator.hasClipForState('ATTACK_3')).toBe(false);
    expect(animator.hasClipForState('FORM_SWITCH')).toBe(false);
    expect(animator.hasClipForState('HENSHIN_SUPER')).toBe(false);
    expect(animator.hasClipForState('ELEMENT_SKILL')).toBe(false);

    expect(animator.playState('MOVE', { loop: true })).toBe(true);
    animator.update(0.016);
    animator.pauseForProceduralBlend();
    expect(animator.playState('ATTACK_1', { loop: false, restart: true })).toBe(true);
    animator.update(0.016);
    animator.dispose();

    // Super Form rig also includes Meshy Punch_Combo -> auto-sliced to ATTACK_3!
    const superClips = [...clips, new THREE.AnimationClip('Punch_Combo', 2.467, [track3s])];
    const superAnimator = new SkeletalAnimator(root, superClips);
    expect(superAnimator.hasClipForState('ATTACK_3')).toBe(true);
    expect(superAnimator.getClipDuration('ATTACK_3')).toBeLessThan(1.75);
    superAnimator.dispose();
  });
});

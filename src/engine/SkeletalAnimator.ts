import * as THREE from 'three';

export type RigSocketSlot =
  | 'RightHand'
  | 'LeftHand'
  | 'ChestArmor'
  | 'ShoulderL'
  | 'ShoulderR'
  | 'BackWing'
  | 'HeadPivot'
  | 'BeltCore';

const SOCKET_ALIASES: Readonly<Record<RigSocketSlot, readonly string[]>> = {
  RightHand: ['righthand', 'handr', 'rhand', 'weaponr', 'wristr', 'righthandindex1'],
  LeftHand: ['lefthand', 'handl', 'lhand', 'weaponl', 'wristl', 'lefthandindex1'],
  ChestArmor: ['chestarmor', 'spine2', 'upperchest', 'chest', 'spine1', 'torsopivot'],
  BackWing: ['backwing', 'spine2', 'upperchest', 'chest', 'spine1'],
  ShoulderL: ['shoulderl', 'leftshoulder', 'leftarm', 'claviclel', 'upperarml'],
  ShoulderR: ['shoulderr', 'rightshoulder', 'rightarm', 'clavicler', 'upperarmr'],
  HeadPivot: ['headpivot', 'head'],
  BeltCore: ['beltcore', 'hips', 'pelvis', 'spine'],
};

const STATE_CLIP_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  IDLE: ['idle', 'stand', 'breathe', 'guard', 'ready'],
  MOVE: ['run', 'sprint', 'jog', 'move', 'walk', 'locomotion'],
  CHASE: ['run', 'chase', 'walk', 'move', 'sprint'],
  ATTACK_1: ['attack_1', 'attack1', 'slash_1', 'slash1', 'combo1', 'thrust', 'slash', 'attack', 'punch', 'strike'],
  ATTACK_2: ['attack_2', 'attack2', 'slash_2', 'slash2', 'combo2', 'horizontal', 'swing', 'slash', 'attack'],
  ATTACK_3: ['attack_3', 'attack3', 'slash_3', 'slash3', 'combo3', 'heavy', 'spin', 'finisher'],
  ATTACK_ACTIVE: ['attack', 'slash', 'strike', 'punch', 'claw', 'bite', 'smash'],
  TELEGRAPH: ['telegraph', 'windup', 'charge', 'roar', 'taunt', 'powerup', 'ready'],
  RECOVERY: ['idle', 'recover', 'stand'],
  DODGE: ['dodge', 'roll', 'evade', 'dash', 'step'],
  ELEMENT_SKILL: ['skill', 'cast', 'special', 'powerup'],
  FORM_SWITCH: ['switch', 'taunt', 'henshin', 'powerup'],
  HENSHIN_SUPER: ['henshin', 'transform', 'powerup', 'roar', 'cast'],
  ULTIMATE_CINEMATIC: ['ultimate', 'finisher', 'kick'],
  HITSTUN: ['hitstun', 'hit', 'react', 'impact', 'damage', 'flinch'],
  STAGGERED: ['stagger', 'dizzy', 'stun', 'hit', 'react'],
  DEAD: ['death', 'dead', 'dying', 'die', 'fall'],
};

const KNOWN_STATES: readonly string[] = Object.keys(STATE_CLIP_KEYWORDS);

/**
 * Strips Mixamo/Blender/Unity armature prefixes and punctuation so bone names match reliably.
 */
export function normalizeBoneName(rawName: string): string {
  return rawName
    .replace(/^(mixamorig[:_]?|armature[:_]?|bip0+1[:_\s]?|cc_base_)/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

/**
 * Pure helper: resolves a semantic socket slot against either our default rig node names
 * (`RightHand`, `BackWing`) or external Mixamo/Blender humanoid skeletons (`mixamorigRightHand`, `mixamorig:Spine2`).
 */
export function resolveBoneSocketName(
  nodeNames: readonly string[],
  slot: RigSocketSlot
): string | null {
  // 1. Exact case-sensitive match first (preserves our named default sockets)
  for (let i = 0; i < nodeNames.length; i++) {
    if (nodeNames[i] === slot) {
      return nodeNames[i]!;
    }
  }

  // 2. Normalized alias match in priority order
  const aliases = SOCKET_ALIASES[slot];
  for (let a = 0; a < aliases.length; a++) {
    const alias = aliases[a]!;
    for (let i = 0; i < nodeNames.length; i++) {
      const candidate = nodeNames[i]!;
      if (normalizeBoneName(candidate) === alias) {
        return candidate;
      }
    }
  }

  // 3. Substring fallback for non-standard prefixed names
  for (let a = 0; a < aliases.length; a++) {
    const alias = aliases[a]!;
    for (let i = 0; i < nodeNames.length; i++) {
      const candidate = nodeNames[i]!;
      if (normalizeBoneName(candidate).includes(alias)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Pure helper: maps an FSM state name (`IDLE`, `ATTACK_1`, `DODGE`, etc.) to the best
 * available AnimationClip name exported from Mixamo/Meshy/Blender.
 */
export function resolveClipForState(
  clipNames: readonly string[],
  state: string,
  allowFallback = true
): string | null {
  if (clipNames.length === 0) return null;

  const lowerState = state.toLowerCase();
  // 1. Exact state name match (e.g. clip named "attack1" or "ATTACK_1")
  for (let i = 0; i < clipNames.length; i++) {
    const name = clipNames[i]!;
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm === lowerState.replace(/[^a-z0-9]/g, '')) {
      return name;
    }
  }

  // 2. Prioritized keyword match
  const keywords = STATE_CLIP_KEYWORDS[state] ?? [lowerState];
  for (let k = 0; k < keywords.length; k++) {
    const kw = keywords[k]!;
    for (let i = 0; i < clipNames.length; i++) {
      const name = clipNames[i]!;
      if (name.toLowerCase().includes(kw)) {
        return name;
      }
    }
  }

  // 3. Optional fallback to first clip (disabled in hybrid SkeletalAnimator so HumanoidBoneDriver can drive unmapped states!)
  return allowFallback ? (clipNames[0] ?? null) : null;
}

/**
 * Pure helper: computes uniform scale factor so imported Mixamo/Tripo3D models
 * match exact gameplay collision height regardless of centimeter vs meter export scale.
 */
export function computeNormalizedRigScale(bboxHeight: number, targetHeightMeters: number): number {
  if (!Number.isFinite(bboxHeight) || bboxHeight <= 0.001) return 1;
  const raw = targetHeightMeters / bboxHeight;
  return Math.min(200, Math.max(0.002, raw));
}

export interface SkeletalPlayOptions {
  loop?: boolean;
  timeScale?: number;
  fadeSec?: number;
  restart?: boolean;
}

/**
 * Runtime Three.js AnimationMixer controller supporting Mixamo/Tripo3D/Blender skeletal rigs
 * with smooth crossfading, zero per-frame allocations, hit-stop freeze compatibility, and clean dispose().
 */
export class SkeletalAnimator {
  public readonly hasClips: boolean;

  private readonly root: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actionsByState = new Map<string, THREE.AnimationAction>();
  private readonly clipDurationsByState = new Map<string, number>();
  private currentState: string | null = null;
  private currentAction: THREE.AnimationAction | null = null;

  constructor(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);

    // Filter out trivial 1-frame static bind snapshots (e.g. Meshy Rig export's 0.033s clip0)
    // so HumanoidBoneDriver can animate all 24 bones smoothly until real multi-frame clips are supplied!
    const rawPlayable = clips.filter((c) => c.duration > 0.08);
    const hasExplicitAttack1 = rawPlayable.some((c) => /attack[_]?1|slash[_]?1|combo1/i.test(c.name));
    const hasExplicitAttack2 = rawPlayable.some((c) => /attack[_]?2|slash[_]?2|combo2/i.test(c.name));
    const hasExplicitAttack3 = rawPlayable.some((c) => /attack[_]?3|slash[_]?3|combo3/i.test(c.name));

    // Automatically slice combined Meshy mocap clips once at construction (zero runtime allocations!):
    // - `Thrust_Slash` (3.0s) -> `attack1_thrust` (f11..44, 1.1s) + `attack2_slash` (f44..80, 1.2s)
    // - `Punch_Combo` (2.47s) -> `attack3_combo` (f12..60, 1.6s rapid combo barrage!)
    // - `Roll_Dodge` (1.83s, slow jog lead-in f0..24) -> `dodge_roll` (f25..55, 1.0s instant somersault!)
    const playableClips: THREE.AnimationClip[] = [];
    for (let i = 0; i < rawPlayable.length; i++) {
      const clip = rawPlayable[i]!;
      if (/thrust.*slash/i.test(clip.name) && clip.duration > 2.0 && !hasExplicitAttack1 && !hasExplicitAttack2) {
        const atk1 = THREE.AnimationUtils.subclip(clip, 'attack1_thrust', 11, 44, 30);
        const atk2 = THREE.AnimationUtils.subclip(clip, 'attack2_slash', 44, 80, 30);
        playableClips.push(atk1, atk2);
      } else if (/punch.*combo/i.test(clip.name) && clip.duration > 1.5 && !hasExplicitAttack3) {
        const atk3 = THREE.AnimationUtils.subclip(clip, 'attack3_combo', 12, 60, 30);
        playableClips.push(atk3);
      } else if (/roll.*dodge/i.test(clip.name) && clip.duration > 1.35) {
        const roll = THREE.AnimationUtils.subclip(clip, 'dodge_roll', 25, 55, 30);
        playableClips.push(roll);
      } else {
        playableClips.push(clip);
      }
    }

    this.hasClips = playableClips.length > 0;
    if (playableClips.length === 0) return;

    const clipByName = new Map<string, THREE.AnimationClip>();
    const clipNames: string[] = [];
    for (let i = 0; i < playableClips.length; i++) {
      const clip = playableClips[i]!;
      clipNames.push(clip.name);
      clipByName.set(clip.name, clip);
    }

    // Pre-create AnimationActions once at construction -> zero allocations in combat hot path!
    // Uses strict keyword matching so states without real mocap clips cleanly fall back to HumanoidBoneDriver!
    const actionByClip = new Map<string, THREE.AnimationAction>();
    for (let i = 0; i < KNOWN_STATES.length; i++) {
      const state = KNOWN_STATES[i]!;
      const matchedName = resolveClipForState(clipNames, state, false);
      if (!matchedName) continue;

      const clip = clipByName.get(matchedName)!;
      let action = actionByClip.get(matchedName);
      if (!action) {
        action = this.mixer.clipAction(clip);
        actionByClip.set(matchedName, action);
      }
      this.actionsByState.set(state, action);
      this.clipDurationsByState.set(state, clip.duration);
    }
  }

  public hasClipForState(state: string): boolean {
    return this.actionsByState.has(state);
  }

  public getClipDuration(state: string): number {
    return this.clipDurationsByState.get(state) ?? 0;
  }

  /**
   * Stops active mixer actions cleanly when handing control to HumanoidBoneDriver for
   * Tokusatsu states without a dedicated mocap clip (e.g. FORM_SWITCH, HENSHIN_SUPER, ATTACK_3).
   */
  public pauseForProceduralBlend(): void {
    if (this.currentAction) {
      this.mixer.stopAllAction();
      this.currentAction = null;
      this.currentState = null;
    }
  }

  public playState(state: string, options?: SkeletalPlayOptions): boolean {
    if (!this.hasClips) return false;
    const nextAction = this.actionsByState.get(state);
    if (!nextAction) return false;

    const loop = options?.loop ?? true;
    const timeScale = options?.timeScale ?? 1.0;
    const fadeSec = options?.fadeSec ?? 0.12;
    const restart = options?.restart ?? false;

    nextAction.enabled = true;
    nextAction.timeScale = timeScale;
    nextAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    nextAction.clampWhenFinished = !loop;

    if (this.currentState === state && this.currentAction === nextAction && !restart) {
      return true;
    }

    if (this.currentAction && this.currentAction !== nextAction) {
      nextAction.reset();
      nextAction.play();
      this.currentAction.crossFadeTo(nextAction, fadeSec, false);
    } else {
      if (restart || !nextAction.isRunning()) {
        nextAction.reset();
      }
      nextAction.play();
    }

    this.currentState = state;
    this.currentAction = nextAction;
    return true;
  }

  public update(dt: number): void {
    if (!this.hasClips || dt <= 0) return;
    this.mixer.update(dt);
  }

  public dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.actionsByState.clear();
    this.clipDurationsByState.clear();
    this.currentAction = null;
    this.currentState = null;
  }
}

/**
 * Traverses a loaded/cloned rig and finds an Object3D matching a semantic socket slot
 * across both custom rig sockets and Mixamo humanoid bone hierarchies.
 */
export function findRigSocket(root: THREE.Object3D, slot: RigSocketSlot): THREE.Object3D | null {
  const names: string[] = [];
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((obj) => {
    if (obj.name && !byName.has(obj.name)) {
      names.push(obj.name);
      byName.set(obj.name, obj);
    }
  });
  const matched = resolveBoneSocketName(names, slot);
  return matched ? (byName.get(matched) ?? null) : null;
}

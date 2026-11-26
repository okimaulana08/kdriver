import * as THREE from 'three';
import type { AssetKey, AssetLoader, OptionalCustomAssetKey } from '../../engine/AssetLoader';
import { HumanoidBoneDriver } from '../../engine/HumanoidBoneDriver';
import {
  bindPbrMaterials,
  createCompoundEyeMaterial,
  createKaijinCarapaceMaterial,
  createUndersuitMaterial,
  type PbrTextureSet,
} from '../../engine/PbrMaterialSystem';
import { ARENA_RADIUS } from '../../engine/PhysicsWorld';
import { SkeletalAnimator } from '../../engine/SkeletalAnimator';
import { HitboxSystem } from '../combat/HitboxSystem';
import { STATUS_DEFAULT_DURATIONS } from '../combat/ReactionSystem';
import { getDifficultyConfig } from '../data/difficulty';
import type {
  ActiveStatusSnapshot,
  DifficultyId,
  EnemyConfig,
  EnemyHudSnapshot,
  HurtboxTarget,
  StatusEffectId,
  Vec3Snapshot,
} from '../types/schema';

export type EnemyAIState =
  | 'CHASE'
  | 'TELEGRAPH'
  | 'ATTACK_ACTIVE'
  | 'RECOVERY'
  | 'HITSTUN'
  | 'STAGGERED'
  | 'DEAD';

const BURN_TICK_INTERVAL = 1.0;
const BURN_TICK_DAMAGE = 12;
const STAGGER_DURATION_SEC = 5.0;
const HITSTUN_DURATION_SEC = 0.28;
const DEATH_ANIM_DURATION_SEC = 0.65;

const STATUS_AURA_COLORS: Readonly<Record<StatusEffectId, number>> = {
  BURN: 0xff5722,
  SHOCK: 0xfacc15,
  WET: 0x22d3ee,
  ROOT: 0x22c55e,
  MARK: 0xa855f7,
};

export interface EnemyHitResult {
  killed: boolean;
  guardBroken: boolean;
}

export interface EnemyFixedUpdateEvents {
  startedTelegraph: boolean;
  attackActivatedThisFrame: boolean;
  hitPlayerDamage: number;
  hitPlayerHeavy: boolean;
  burnTickDamage: number;
  microExplosionDamage: number;
  enteredPhase2: boolean;
  fireProjectileSpread: boolean;
  diedThisFrame: boolean;
}

/**
 * Builds a sleek 3D curved horizontal crescent slash arc for Monster Claws & Boss Energy Cleaves.
 */
function buildMonsterSlashArcGeometry(
  arcSpan = Math.PI * 0.92,
  innerR = 0.42,
  outerR = 1.15
): THREE.BufferGeometry {
  const segs = 28;
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const uvs = new Float32Array((segs + 1) * 2 * 2);
  const indices = new Uint16Array(segs * 6);

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const angle = (t - 0.5) * arcSpan;
    const pinch = Math.sin(t * Math.PI);
    const rOut = innerR + (outerR - innerR) * (0.28 + 0.72 * Math.pow(pinch, 0.65));
    const rIn = innerR + (outerR - innerR) * 0.14 * (1 - pinch);
    const tiltY = (t - 0.5) * 0.42;

    const v0 = i * 2;
    const v1 = v0 + 1;
    // Oriented forward along +Z (sin(angle) = X, cos(angle) = Z)
    positions[v0 * 3] = Math.sin(angle) * rIn;
    positions[v0 * 3 + 1] = tiltY - 0.08;
    positions[v0 * 3 + 2] = Math.cos(angle) * rIn;
    uvs[v0 * 2] = t;
    uvs[v0 * 2 + 1] = 0;

    positions[v1 * 3] = Math.sin(angle) * rOut;
    positions[v1 * 3 + 1] = tiltY + 0.14;
    positions[v1 * 3 + 2] = Math.cos(angle) * rOut;
    uvs[v1 * 2] = t;
    uvs[v1 * 2 + 1] = 1;

    if (i < segs) {
      const idx = i * 6;
      indices[idx] = v0;
      indices[idx + 1] = v1;
      indices[idx + 2] = v0 + 2;
      indices[idx + 3] = v1;
      indices[idx + 4] = v1 + 2;
      indices[idx + 5] = v0 + 2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

const ENEMY_VFX_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// GLSL Danger Telegraph Shader (replaces overlapping flat red RingGeometry + CircleGeometry!)
const ENEMY_TELEGRAPH_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uCharge;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    float angle = atan(p.y, p.x);
    float outerBorder = exp(-pow((r - 0.94) * 26.0, 2.0));
    float ticks = smoothstep(0.2, 0.9, sin(angle * 24.0 + uTime * 5.0) * 0.5 + 0.5);
    float chargeRing = exp(-pow((r - max(0.06, uCharge)) * 22.0, 2.0));
    float innerFill = smoothstep(uCharge + 0.04, uCharge - 0.18, r) * (0.14 + 0.12 * smoothstep(0.45, 0.95, r));
    float pulse = 0.8 + 0.2 * sin(uTime * 26.0);

    float glow = outerBorder * (0.72 + 0.35 * ticks) * pulse + chargeRing * 1.05 + innerFill;
    vec3 col = mix(uColor, vec3(1.0, 0.92, 0.85), clamp(chargeRing * 0.72 + outerBorder * 0.35, 0.0, 1.0));
    float alpha = clamp(glow * uOpacity, 0.0, 0.9);
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(col * 1.45, alpha);
  }
`;

// GLSL 3D Monster Claw Rake (Minion) & Sweeping Energy Cleave Blade (Elite / Boss)
const ENEMY_SLASH_FRAG = /* glsl */ `
  uniform float uProgress;
  uniform float uStyle; // 0 = 3-claw dark crimson rakes (Kroco), 1 = heavy energy cleave blade (Elite/Boss)
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vUv;

  void main() {
    // Sweep front races from u = 0 -> 1 during early slash, trailing cleanly behind
    float head = min(1.15, uProgress * 2.15);
    float tail = max(0.0, uProgress * 1.35 - 0.38);
    float sweepMask = smoothstep(tail, tail + 0.18, vUv.x) * smoothstep(head + 0.06, head - 0.12, vUv.x);

    float blade = 0.0;
    if (uStyle < 0.5) {
      // Three razor-sharp parallel beast claw slash trails!
      float c1 = exp(-pow((vUv.y - 0.28) * 14.0, 2.0));
      float c2 = exp(-pow((vUv.y - 0.54) * 13.0, 2.0));
      float c3 = exp(-pow((vUv.y - 0.8) * 14.0, 2.0));
      blade = clamp(c1 * 0.9 + c2 * 1.15 + c3 * 0.9, 0.0, 1.35);
    } else {
      // Razor-edged Boss/Elite energy crescent with blazing outer rim + streaking inner energy
      float outerEdge = exp(-pow((vUv.y - 0.86) * 10.5, 2.0));
      float innerTrail = smoothstep(0.05, 0.86, vUv.y) * smoothstep(1.0, 0.86, vUv.y) * 0.78;
      float streaks = 0.72 + 0.28 * sin(vUv.x * 28.0 - uProgress * 18.0 + vUv.y * 9.0);
      blade = (outerEdge * 1.2 + innerTrail) * streaks;
    }

    float fade = 1.0 - smoothstep(0.45, 1.0, uProgress);
    float alpha = clamp(blade * sweepMask * fade, 0.0, 1.0);
    if (alpha < 0.02) discard;

    vec3 col = mix(uColorA, uColorB, clamp(vUv.y * 0.85 + blade * 0.25, 0.0, 1.0));
    col += vec3(1.0, 0.96, 0.92) * smoothstep(0.78, 1.25, blade) * 0.95;
    gl_FragColor = vec4(col * 1.75, alpha);
  }
`;

// GLSL Feathered Radial Shockwave / Status / Guard / Boss Phase 2 Overdrive Sigil
const ENEMY_SIGIL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uKind; // 0 = shockwave blast, 1 = status aura, 2 = guard hex barrier, 3 = Boss Phase 2 overdrive sigil
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0 || r < 0.14) discard;
    float angle = atan(p.y, p.x);
    float glow = 0.0;

    if (uKind < 0.5) {
      float wave = exp(-pow((r - 0.84) * 12.0, 2.0));
      float streaks = 0.65 + 0.35 * sin(angle * 20.0 + r * 14.0 - uTime * 12.0);
      float trail = smoothstep(0.42, 0.84, r) * smoothstep(1.0, 0.84, r) * 0.45;
      glow = (wave + trail) * streaks;
    } else if (uKind < 1.5) {
      float ring = exp(-pow((r - 0.82) * 13.0, 2.0));
      float swirl = 0.6 + 0.4 * sin(angle * 8.0 - uTime * 6.5 + r * 6.0);
      glow = ring * swirl + exp(-pow((r - 0.62) * 16.0, 2.0)) * 0.45;
    } else if (uKind < 2.5) {
      float hexShape = abs(cos(angle * 3.0 + uTime * 1.4));
      float hexRim = exp(-pow((r - (0.76 + hexShape * 0.1)) * 18.0, 2.0));
      float shimmer = 0.68 + 0.32 * sin(angle * 12.0 - uTime * 5.0);
      glow = hexRim * shimmer;
    } else {
      // Boss Phase 2 Kaijin Overdrive Sigil Halo (spiked dark-solar crest!)
      float outer = exp(-pow((r - 0.84) * 16.0, 2.0));
      float inner = exp(-pow((r - 0.58) * 18.0, 2.0)) * 0.72;
      float spikes = smoothstep(0.42, 0.96, sin(angle * 8.0 + uTime * 3.6) * 0.5 + 0.5) *
                     smoothstep(0.45, 0.95, r) * smoothstep(1.0, 0.86, r);
      float runes = smoothstep(0.3, 0.85, sin(angle * 16.0 - uTime * 5.2) * 0.5 + 0.5);
      glow = outer * (0.7 + 0.4 * runes) + inner * runes + spikes * 1.15;
    }

    vec3 col = mix(uColor, vec3(1.0, 0.96, 0.88), smoothstep(0.85, 1.35, glow) * 0.75);
    float alpha = clamp(glow * uOpacity, 0.0, 1.0);
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(col * 1.55, alpha);
  }
`;

/**
 * Base 3D Enemy Entity supporting Minion, Elite (Guard Bar / Super Armor + Stagger),
 * and Boss subclassing. Enforces >= 0.45s crimson telegraph before hitbox activation,
 * Elemental Status effects, Hit Registry, zero-allocation hot path, and clean dispose().
 */
export class EnemyBase implements HurtboxTarget {
  public readonly id: string;
  public readonly config: EnemyConfig;
  public readonly radius: number;
  public readonly root = new THREE.Group();

  protected hp: number;
  protected guard: number;
  protected aiState: EnemyAIState = 'CHASE';
  protected stateTimer = 0;
  protected attackCooldown = 1.2;
  protected attackRange: number;
  protected activeAttackRadius: number;
  protected currentTelegraphDuration: number;
  protected currentAttackHeavy = false;
  protected attackSwingId = 0;
  protected bossPhase: 1 | 2 = 1;
  protected readonly enemyCooldownMult: number;
  protected readonly bossPhase2HpRatio: number;
  protected readyForDisposal = false;

  protected lockedOn = false;
  protected hitFlashTimer = 0;
  protected animTime = 0;
  protected knockVelX = 0;
  protected knockVelZ = 0;

  protected readonly activeStatuses = new Map<StatusEffectId, number>();
  protected burnTickTimer = 0;
  protected pendingMicroExplosions = 0;
  protected microExplosionTimer = 0;
  protected microExplosionDamagePerBlast = 0;

  protected readonly attackHitbox = new HitboxSystem();
  protected readonly visualPivot = new THREE.Group();
  protected readonly lockOnReticle: THREE.Group;
  protected readonly statusAuraRing: THREE.Mesh;
  protected readonly statusAuraUniforms: {
    uTime: { value: number };
    uOpacity: { value: number };
    uKind: { value: number };
    uColor: { value: THREE.Color };
  };
  protected readonly guardShieldRing: THREE.Mesh;
  protected readonly guardShieldUniforms: {
    uTime: { value: number };
    uOpacity: { value: number };
    uKind: { value: number };
    uColor: { value: THREE.Color };
  };
  protected readonly phase2HaloMesh: THREE.Mesh;
  protected readonly phase2HaloUniforms: {
    uTime: { value: number };
    uOpacity: { value: number };
    uKind: { value: number };
    uColor: { value: THREE.Color };
  };
  protected readonly telegraphMesh: THREE.Mesh;
  protected readonly telegraphUniforms: {
    uTime: { value: number };
    uCharge: { value: number };
    uOpacity: { value: number };
    uColor: { value: THREE.Color };
  };
  protected readonly attackSlashMesh: THREE.Mesh;
  protected readonly attackSlashUniforms: {
    uProgress: { value: number };
    uStyle: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
  };
  protected readonly shockwaveMesh: THREE.Mesh;
  protected readonly shockwaveUniforms: {
    uTime: { value: number };
    uOpacity: { value: number };
    uKind: { value: number };
    uColor: { value: THREE.Color };
  };

  protected readonly bodyMat: THREE.MeshPhysicalMaterial;
  protected readonly trimMat: THREE.MeshStandardMaterial;
  protected readonly eyeMat: THREE.MeshPhysicalMaterial;
  protected readonly externalMaterials: THREE.MeshStandardMaterial[] = [];
  protected readonly skeletalAnimator: SkeletalAnimator;
  protected readonly boneDriver: HumanoidBoneDriver;
  protected readonly baseVisualScale: number;
  protected readonly usesDedicatedBossRig: boolean;
  protected readonly bossAmbientEmissiveHex: number;
  protected readonly ownedMaterials: THREE.Material[] = [];

  // Reusable scratch objects (Zero-Allocation Hot Path)
  protected readonly scratchPlayerPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  protected readonly scratchSelfPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  protected readonly scratchTargets: HurtboxTarget[] = [];
  protected readonly scratchHits: HurtboxTarget[] = [];
  protected readonly events: EnemyFixedUpdateEvents = {
    startedTelegraph: false,
    attackActivatedThisFrame: false,
    hitPlayerDamage: 0,
    hitPlayerHeavy: false,
    burnTickDamage: 0,
    microExplosionDamage: 0,
    enteredPhase2: false,
    fireProjectileSpread: false,
    diedThisFrame: false,
  };

  constructor(
    id: string,
    config: EnemyConfig,
    assetLoader: AssetLoader,
    pbrTextures: PbrTextureSet,
    spawnX: number,
    spawnZ: number,
    difficulty: DifficultyId = 'medium'
  ) {
    this.id = id;
    this.config = config;
    const diffCfg = getDifficultyConfig(difficulty);
    this.enemyCooldownMult = diffCfg.enemyCooldownMult;
    this.bossPhase2HpRatio = diffCfg.bossPhase2HpRatio;
    this.hp = config.maxHp;
    this.guard = config.maxGuard;
    this.radius = config.tier === 'BOSS' ? 1.05 : config.tier === 'ELITE' ? 0.85 : 0.56;
    this.attackRange = config.tier === 'BOSS' ? 4.2 : config.tier === 'ELITE' ? 3.5 : 2.3;
    this.activeAttackRadius = config.tier === 'BOSS' ? 4.6 : config.tier === 'ELITE' ? 4.1 : 2.4;
    this.currentTelegraphDuration = Math.max(0.45, config.telegraphDurationSec);
    this.attackCooldown = (0.9 + Math.random() * 1.1) * this.enemyCooldownMult;

    this.bodyMat = createKaijinCarapaceMaterial(config.color, pbrTextures, config.tier === 'BOSS');
    this.trimMat = createUndersuitMaterial(pbrTextures);
    this.eyeMat = createCompoundEyeMaterial(0xf43f5e, pbrTextures, 2.0);

    this.root.position.set(spawnX, 0, spawnZ);
    this.root.add(this.visualPivot);

    // Clone .glb monster rig (uses SkeletonUtils.clone automatically for Mixamo SkinnedMeshes!)
    const optionalBossKey: OptionalCustomAssetKey | null =
      config.id === 'magma_overlord'
        ? 'boss_magma'
        : config.id === 'sylvan_sovereign'
          ? 'boss_sylvan'
          : config.id === 'chrono_volt_striker'
            ? 'boss_chrono'
            : config.id === 'cryo_eclipse_emperor'
              ? 'boss_cryo'
              : null;
    const dedicatedBossRig = optionalBossKey ? assetLoader.cloneOptionalRig(optionalBossKey) : null;
    this.usesDedicatedBossRig = dedicatedBossRig !== null;
    this.bossAmbientEmissiveHex =
      config.id === 'magma_overlord'
        ? 0xc2410c
        : config.id === 'sylvan_sovereign'
          ? 0x047857
          : config.id === 'chrono_volt_striker'
            ? 0x0891b2
            : config.id === 'cryo_eclipse_emperor'
              ? 0x6d28d9
              : 0x7f1d1d;

    const assetKey: AssetKey =
      config.tier === 'BOSS'
        ? 'enemy_boss'
        : config.tier === 'ELITE'
          ? 'enemy_brute'
          : 'enemy_grunt';
    const cloned = dedicatedBossRig ?? assetLoader.cloneRig(assetKey);
    const enemyModel = cloned.scene;
    this.baseVisualScale = cloned.isCustomExternal ? 1.0 : config.scale;
    if (!cloned.isCustomExternal) {
      this.visualPivot.scale.setScalar(config.scale);
    }

    const externalMats = bindPbrMaterials(
      enemyModel,
      {
        enemy_body: this.bodyMat,
        enemy_trim: this.trimMat,
        enemy_eye: this.eyeMat,
      },
      { preserveExternalPbr: true, envMapIntensity: 1.35 }
    );
    this.externalMaterials.push(...externalMats);
    this.skeletalAnimator = new SkeletalAnimator(enemyModel, cloned.animations);
    this.boneDriver = new HumanoidBoneDriver(enemyModel);
    if (this.skeletalAnimator.hasClips) {
      this.skeletalAnimator.playState('CHASE', { loop: true });
    }

    this.visualPivot.add(enemyModel);
    this.ownedMaterials.push(this.bodyMat, this.trimMat, this.eyeMat, ...externalMats);

    // Elemental Status Swirling GLSL Aura (zero flat RingGeometry!)
    this.statusAuraUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0.85 },
      uKind: { value: 1 },
      uColor: { value: new THREE.Color(0x22d3ee) },
    };
    const statusAuraMat = new THREE.ShaderMaterial({
      uniforms: this.statusAuraUniforms,
      vertexShader: ENEMY_VFX_VERT,
      fragmentShader: ENEMY_SIGIL_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const statusPlane = new THREE.PlaneGeometry((this.radius + 0.42) * 2, (this.radius + 0.42) * 2);
    statusPlane.rotateX(-Math.PI / 2);
    this.statusAuraRing = new THREE.Mesh(statusPlane, statusAuraMat);
    this.statusAuraRing.position.y = 0.05;
    this.statusAuraRing.visible = false;
    this.root.add(this.statusAuraRing);

    // Golden Super-Armor Hex-Barrier GLSL Shield (visible while guard > 0)
    this.guardShieldUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0.78 },
      uKind: { value: 2 },
      uColor: { value: new THREE.Color(0xfacc15) },
    };
    const guardShieldMat = new THREE.ShaderMaterial({
      uniforms: this.guardShieldUniforms,
      vertexShader: ENEMY_VFX_VERT,
      fragmentShader: ENEMY_SIGIL_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const guardPlane = new THREE.PlaneGeometry((this.radius + 0.25) * 2, (this.radius + 0.25) * 2);
    guardPlane.rotateX(-Math.PI / 2);
    this.guardShieldRing = new THREE.Mesh(guardPlane, guardShieldMat);
    this.guardShieldRing.position.y = 0.085;
    this.guardShieldRing.visible = this.guard > 0;
    this.root.add(this.guardShieldRing);

    // Phase 2 Boss Overdrive Sigil Halo (GLSL rotating Kaijin crest — zero flat TorusGeometry!)
    const haloColor =
      config.id === 'magma_overlord'
        ? 0xf97316
        : config.id === 'sylvan_sovereign'
          ? 0x10b981
          : config.id === 'chrono_volt_striker'
            ? 0x22d3ee
            : config.id === 'cryo_eclipse_emperor'
              ? 0xc084fc
              : 0xf43f5e;
    this.phase2HaloUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0.92 },
      uKind: { value: 3 },
      uColor: { value: new THREE.Color(haloColor) },
    };
    const phase2Mat = new THREE.ShaderMaterial({
      uniforms: this.phase2HaloUniforms,
      vertexShader: ENEMY_VFX_VERT,
      fragmentShader: ENEMY_SIGIL_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.phase2HaloMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), phase2Mat);
    this.phase2HaloMesh.position.set(0, config.tier === 'BOSS' ? 2.45 : 2.35, -0.45);
    this.phase2HaloMesh.visible = false;
    this.root.add(this.phase2HaloMesh);

    // 3D Lock-On Diamond Reticle
    this.lockOnReticle = new THREE.Group();
    const outerReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.72, 4),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    const innerReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.4, 4),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    this.lockOnReticle.add(outerReticle, innerReticle);
    const reticleY = config.tier === 'BOSS' ? 1.95 : config.tier === 'ELITE' ? 1.65 : 1.25;
    this.lockOnReticle.position.set(0, reticleY, 0);
    this.lockOnReticle.visible = false;
    this.root.add(this.lockOnReticle);

    // GLSL Danger Telegraph Floor Shader (crisp pulsing charge wave — zero overlapping flat red circles!)
    this.telegraphUniforms = {
      uTime: { value: 0 },
      uCharge: { value: 0.08 },
      uOpacity: { value: 0.85 },
      uColor: { value: new THREE.Color(0xef4444) },
    };
    const telegraphMat = new THREE.ShaderMaterial({
      uniforms: this.telegraphUniforms,
      vertexShader: ENEMY_VFX_VERT,
      fragmentShader: ENEMY_TELEGRAPH_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const unitGroundPlane = new THREE.PlaneGeometry(2.0, 2.0);
    unitGroundPlane.rotateX(-Math.PI / 2);
    this.telegraphMesh = new THREE.Mesh(unitGroundPlane, telegraphMat);
    this.telegraphMesh.position.y = 0.04;
    this.telegraphMesh.visible = false;
    this.root.add(this.telegraphMesh);

    // 3D Sweeping Monster Claw Rake (Kroco) / Giant Kaijin Energy Cleave Blade (Elite & Boss!)
    const slashPrimaryHex =
      config.id === 'magma_overlord'
        ? 0xea580c
        : config.id === 'sylvan_sovereign'
          ? 0x059669
          : config.id === 'chrono_volt_striker'
            ? 0x06b6d4
            : config.id === 'cryo_eclipse_emperor'
              ? 0x38bdf8
              : config.tier === 'ELITE'
                ? 0xa855f7
                : 0xe11d48;
    const slashEmissiveHex =
      config.id === 'magma_overlord'
        ? 0xfde047
        : config.id === 'sylvan_sovereign'
          ? 0x6ee7b7
          : config.id === 'chrono_volt_striker'
            ? 0xa5f3fc
            : config.id === 'cryo_eclipse_emperor'
              ? 0xe879f9
              : config.tier === 'ELITE'
                ? 0xe879f9
                : 0xff4d6d;
    this.attackSlashUniforms = {
      uProgress: { value: 0 },
      uStyle: { value: config.tier === 'MINION' ? 0.0 : 1.0 },
      uColorA: { value: new THREE.Color(slashPrimaryHex) },
      uColorB: { value: new THREE.Color(slashEmissiveHex) },
    };
    const attackSlashMat = new THREE.ShaderMaterial({
      uniforms: this.attackSlashUniforms,
      vertexShader: ENEMY_VFX_VERT,
      fragmentShader: ENEMY_SLASH_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.attackSlashMesh = new THREE.Mesh(buildMonsterSlashArcGeometry(), attackSlashMat);
    this.attackSlashMesh.position.y = config.tier === 'BOSS' ? 1.55 : config.tier === 'ELITE' ? 1.3 : 1.08;
    this.attackSlashMesh.visible = false;
    this.attackSlashMesh.frustumCulled = false;
    this.root.add(this.attackSlashMesh);

    // GLSL Radial Force Impact Shockwave (feathered energy wave on strike!)
    this.shockwaveUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0.9 },
      uKind: { value: 0 },
      uColor: { value: new THREE.Color(slashEmissiveHex) },
    };
    const shockwaveMat = new THREE.ShaderMaterial({
      uniforms: this.shockwaveUniforms,
      vertexShader: ENEMY_VFX_VERT,
      fragmentShader: ENEMY_SIGIL_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const shockPlane = new THREE.PlaneGeometry(2.0, 2.0);
    shockPlane.rotateX(-Math.PI / 2);
    this.shockwaveMesh = new THREE.Mesh(shockPlane, shockwaveMat);
    this.shockwaveMesh.position.y = 0.12;
    this.shockwaveMesh.visible = false;
    this.root.add(this.shockwaveMesh);
  }

  public get isAlive(): boolean {
    return this.hp > 0 && this.aiState !== 'DEAD';
  }

  public get canBeDisposed(): boolean {
    return this.readyForDisposal;
  }

  public get currentHp(): number {
    return this.hp;
  }

  public get currentGuard(): number {
    return this.guard;
  }

  public get isStaggered(): boolean {
    return this.aiState === 'STAGGERED';
  }

  public get isTelegraphing(): boolean {
    return this.aiState === 'TELEGRAPH';
  }

  public get currentBossPhase(): 1 | 2 {
    return this.bossPhase;
  }

  public get activeAttackRadiusValue(): number {
    return this.activeAttackRadius;
  }

  protected setTelegraphColor(hex: number): void {
    this.telegraphUniforms.uColor.value.setHex(hex);
  }

  public getPosition(out: Vec3Snapshot): Vec3Snapshot {
    out.x = this.root.position.x;
    out.y = this.root.position.y + 1.0 * this.config.scale;
    out.z = this.root.position.z;
    return out;
  }

  public setLockedOn(locked: boolean): void {
    this.lockedOn = locked;
    this.lockOnReticle.visible = locked && this.isAlive;
  }

  public getActiveStatusIds(): StatusEffectId[] {
    return Array.from(this.activeStatuses.keys());
  }

  public getActiveStatusSnapshots(): ActiveStatusSnapshot[] {
    const out: ActiveStatusSnapshot[] = [];
    for (const [id, remainingSec] of this.activeStatuses) {
      out.push({ id, remainingSec, durationSec: STATUS_DEFAULT_DURATIONS[id] });
    }
    return out;
  }

  public getHudSnapshot(): EnemyHudSnapshot {
    return {
      id: this.id,
      name: this.config.name,
      tier: this.config.tier,
      hp: this.hp,
      maxHp: this.config.maxHp,
      guard: Math.round(this.guard),
      maxGuard: this.config.maxGuard,
      isStaggered: this.isStaggered,
      isTelegraphing: this.isTelegraphing,
      bossPhase: this.bossPhase,
      statuses: this.getActiveStatusSnapshots(),
    };
  }

  public applyStatus(status: StatusEffectId): void {
    if (!this.isAlive) return;
    this.activeStatuses.set(status, STATUS_DEFAULT_DURATIONS[status]);
    if (status === 'BURN' && this.burnTickTimer <= 0) {
      this.burnTickTimer = BURN_TICK_INTERVAL;
    }
  }

  public consumeStatus(status: StatusEffectId): void {
    this.activeStatuses.delete(status);
  }

  public queueMicroExplosions(count: number, damagePerBlast: number): void {
    if (count <= 0 || !this.isAlive) return;
    this.pendingMicroExplosions = Math.max(this.pendingMicroExplosions, count);
    this.microExplosionDamagePerBlast = damagePerBlast;
    this.microExplosionTimer = 0.13;
  }

  public applyKnockback(dirX: number, dirZ: number, force: number): void {
    if (!this.isAlive) return;
    const resist = this.guard > 0 ? 0.25 : this.config.tier === 'BOSS' ? 0.45 : 1.0;
    this.knockVelX += dirX * force * resist;
    this.knockVelZ += dirZ * force * resist;
  }

  public applyDamage(
    damage: number,
    guardDamage: number,
    hitFromX: number,
    hitFromZ: number,
    knockbackForce = 4.0
  ): EnemyHitResult {
    if (!this.isAlive) return { killed: false, guardBroken: false };

    this.hp = Math.max(0, this.hp - Math.max(1, Math.floor(damage)));
    this.hitFlashTimer = 0.11;

    const dx = this.root.position.x - hitFromX;
    const dz = this.root.position.z - hitFromZ;
    const len = Math.hypot(dx, dz);
    const nx = len > 0.001 ? dx / len : 0;
    const nz = len > 0.001 ? dz / len : -1;
    this.applyKnockback(nx, nz, knockbackForce);

    let guardBroken = false;
    if (this.config.maxGuard > 0 && this.guard > 0 && this.aiState !== 'STAGGERED') {
      this.guard = Math.max(0, this.guard - Math.max(0, guardDamage));
      if (this.guard === 0) {
        guardBroken = true;
        this.enterStaggered();
      }
    }

    if (this.hp === 0) {
      this.enterDead();
      return { killed: true, guardBroken };
    }

    // Super Armor: Enemies with active Guard > 0 do not flinch into HITSTUN
    if (
      !guardBroken &&
      this.guard <= 0 &&
      this.aiState !== 'STAGGERED' &&
      this.aiState !== 'ATTACK_ACTIVE'
    ) {
      if (this.config.tier === 'MINION') {
        this.aiState = 'HITSTUN';
        this.stateTimer = 0;
        this.hideTelegraph();
      }
    }

    return { killed: false, guardBroken };
  }

  public fixedUpdate(
    dt: number,
    player: HurtboxTarget,
    siblings: readonly EnemyBase[],
    freezeAI = false
  ): EnemyFixedUpdateEvents {
    this.events.startedTelegraph = false;
    this.events.attackActivatedThisFrame = false;
    this.events.hitPlayerDamage = 0;
    this.events.hitPlayerHeavy = false;
    this.events.burnTickDamage = 0;
    this.events.microExplosionDamage = 0;
    this.events.enteredPhase2 = false;
    this.events.fireProjectileSpread = false;
    this.events.diedThisFrame = false;

    this.stateTimer += dt;
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

    if (this.aiState === 'DEAD') {
      if (this.stateTimer >= DEATH_ANIM_DURATION_SEC) {
        this.readyForDisposal = true;
      }
      return this.events;
    }

    // Decay knockback & clamp inside octagonal arena
    if (Math.abs(this.knockVelX) > 0.05 || Math.abs(this.knockVelZ) > 0.05) {
      this.root.position.x += this.knockVelX * dt;
      this.root.position.z += this.knockVelZ * dt;
      const damp = Math.exp(-9 * dt);
      this.knockVelX *= damp;
      this.knockVelZ *= damp;
      this.clampToArena();
    }

    if (freezeAI) {
      return this.events;
    }

    // Tick Elemental Statuses & BURN DoT
    for (const [status, rem] of this.activeStatuses) {
      const nextRem = rem - dt;
      if (nextRem <= 0) {
        this.activeStatuses.delete(status);
      } else {
        this.activeStatuses.set(status, nextRem);
      }
    }

    if (this.activeStatuses.has('BURN')) {
      this.burnTickTimer -= dt;
      if (this.burnTickTimer <= 0) {
        this.burnTickTimer = BURN_TICK_INTERVAL;
        const res = this.applyDamage(BURN_TICK_DAMAGE, 4, this.root.position.x, this.root.position.z, 0.5);
        this.events.burnTickDamage = BURN_TICK_DAMAGE;
        if (res.killed) {
          this.events.diedThisFrame = true;
          return this.events;
        }
      }
    }

    if (this.pendingMicroExplosions > 0) {
      this.microExplosionTimer -= dt;
      if (this.microExplosionTimer <= 0) {
        this.pendingMicroExplosions--;
        this.microExplosionTimer = 0.14;
        const dmg = Math.max(1, Math.floor(this.microExplosionDamagePerBlast));
        const res = this.applyDamage(dmg, dmg * 0.4, this.root.position.x, this.root.position.z, 2.0);
        this.events.microExplosionDamage = dmg;
        if (res.killed) {
          this.events.diedThisFrame = true;
          return this.events;
        }
      }
    }

    // Hook for Boss Phase 2 transition
    this.onBeforeAIStep(dt);

    // Soft separation from other alive enemies so swarms fan out organically
    this.applySiblingSeparation(dt, siblings);

    player.getPosition(this.scratchPlayerPos);
    const toPlayerX = this.scratchPlayerPos.x - this.root.position.x;
    const toPlayerZ = this.scratchPlayerPos.z - this.root.position.z;
    const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);

    const wetScale = this.activeStatuses.has('WET') ? 0.6 : 1.0;
    const rootScale = this.activeStatuses.has('ROOT') ? 0.15 : 1.0;
    const moveStatusScale = Math.min(wetScale, rootScale);

    if (this.aiState === 'STAGGERED') {
      if (this.stateTimer >= STAGGER_DURATION_SEC) {
        this.guard = this.config.maxGuard;
        this.aiState = 'CHASE';
        this.stateTimer = 0;
        this.attackCooldown = 1.0;
      }
      return this.events;
    }

    if (this.aiState === 'HITSTUN') {
      if (this.stateTimer >= HITSTUN_DURATION_SEC) {
        this.aiState = 'CHASE';
        this.stateTimer = 0;
      }
      return this.events;
    }

    if (this.aiState === 'CHASE') {
      this.attackCooldown = Math.max(0, this.attackCooldown - dt * wetScale);
      if (distToPlayer > 0.05) {
        this.root.rotation.y = Math.atan2(toPlayerX, toPlayerZ);
      }

      if (this.shouldStartAttack(distToPlayer)) {
        this.beginConfiguredAttack(distToPlayer);
        this.events.startedTelegraph = true;
      } else if (distToPlayer > this.radius + 1.05) {
        const speed = this.config.moveSpeed * moveStatusScale * (this.bossPhase === 2 ? 1.2 : 1.0);
        const inv = 1 / Math.max(0.001, distToPlayer);
        this.root.position.x += toPlayerX * inv * speed * dt;
        this.root.position.z += toPlayerZ * inv * speed * dt;
        this.clampToArena();
      }
    } else if (this.aiState === 'TELEGRAPH') {
      if (distToPlayer > 0.1 && this.stateTimer < this.currentTelegraphDuration * 0.65) {
        this.root.rotation.y = Math.atan2(toPlayerX, toPlayerZ);
      }
      this.onTelegraphTick(dt, toPlayerX, toPlayerZ, distToPlayer);

      if (this.stateTimer >= this.currentTelegraphDuration) {
        this.aiState = 'ATTACK_ACTIVE';
        this.stateTimer = 0;
        this.attackSwingId++;
        this.attackHitbox.beginSwing(this.attackSwingId);
        this.telegraphMesh.visible = false;
        this.events.attackActivatedThisFrame = true;
        this.onAttackActivated();
      }
    } else if (this.aiState === 'ATTACK_ACTIVE') {
      this.evaluateActiveAttackHitbox(player);
      if (this.stateTimer >= 0.16) {
        this.aiState = 'RECOVERY';
        this.stateTimer = 0;
        this.attackHitbox.endSwing();
      }
    } else if (this.aiState === 'RECOVERY') {
      const recoveryDur = this.config.tier === 'BOSS' ? (this.bossPhase === 2 ? 0.62 : 0.85) : 0.95;
      if (this.stateTimer >= recoveryDur) {
        this.aiState = 'CHASE';
        this.stateTimer = 0;
        this.attackCooldown =
          (this.config.tier === 'BOSS'
            ? this.bossPhase === 2
              ? 0.9
              : 1.45
            : this.config.tier === 'ELITE'
              ? 1.85
              : 1.4 + Math.random() * 0.6) * this.enemyCooldownMult;
        this.shockwaveMesh.visible = false;
        this.attackSlashMesh.visible = false;
      }
    }

    return this.events;
  }

  public updateVisuals(renderDt: number, camera: THREE.Camera): void {
    this.animTime += renderDt;

    const usesSkeletalDriver = this.skeletalAnimator.hasClipForState(this.aiState) || this.boneDriver.isActive;
    if (this.skeletalAnimator.hasClipForState(this.aiState)) {
      const loopAnim =
        this.aiState === 'CHASE' ||
        this.aiState === 'STAGGERED' ||
        this.aiState === 'RECOVERY' ||
        this.aiState === 'TELEGRAPH';
      this.skeletalAnimator.playState(this.aiState, { loop: loopAnim });
      this.skeletalAnimator.update(renderDt);
    } else if (this.boneDriver.isActive) {
      this.skeletalAnimator.pauseForProceduralBlend();
      this.boneDriver.applyKaijinPose(
        this.aiState,
        this.stateTimer,
        this.currentTelegraphDuration,
        this.animTime,
        renderDt
      );
    } else {
      this.visualPivot.position.set(0, 0, 0);
      this.visualPivot.rotation.set(0, 0, 0);
    }

    if (this.aiState === 'DEAD') {
      if (!usesSkeletalDriver) {
        const t = Math.min(1, this.stateTimer / DEATH_ANIM_DURATION_SEC);
        const s = Math.max(0.05, 1 - t) * this.baseVisualScale;
        this.visualPivot.scale.set(s, s * 0.45, s);
        this.visualPivot.rotation.x = t * 1.1;
      }
      this.lockOnReticle.visible = false;
      this.statusAuraRing.visible = false;
      this.guardShieldRing.visible = false;
      this.phase2HaloMesh.visible = false;
      this.hideTelegraph();
      return;
    }

    // Guard ring & Phase 2 halo GLSL animations
    this.guardShieldRing.visible = this.guard > 0 && !this.isStaggered;
    if (this.guardShieldRing.visible) {
      this.guardShieldUniforms.uTime.value = this.animTime;
    }

    this.phase2HaloMesh.visible = this.bossPhase === 2;
    if (this.phase2HaloMesh.visible) {
      this.phase2HaloUniforms.uTime.value = this.animTime;
      this.phase2HaloMesh.scale.setScalar(1 + Math.sin(this.animTime * 6.5) * 0.08);
    }

    // Elemental status GLSL aura ring
    const firstStatus = this.activeStatuses.keys().next().value as StatusEffectId | undefined;
    if (firstStatus) {
      this.statusAuraRing.visible = true;
      this.statusAuraUniforms.uTime.value = this.animTime;
      this.statusAuraUniforms.uColor.value.setHex(STATUS_AURA_COLORS[firstStatus]);
      this.statusAuraRing.scale.setScalar(1 + Math.sin(this.animTime * 6) * 0.08);
    } else {
      this.statusAuraRing.visible = false;
    }

    // Body pose & material feedback per AI state (supports both procedural PBR & external UV-textured rigs)
    if (this.hitFlashTimer > 0) {
      this.bodyMat.color.setHex(0xffffff);
      this.bodyMat.emissive.setHex(0xffffff);
      this.bodyMat.emissiveIntensity = 0.65;
      this.eyeMat.emissiveIntensity = 3.2;
      for (let i = 0; i < this.externalMaterials.length; i++) {
        const m = this.externalMaterials[i]!;
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.36;
      }
      if (!usesSkeletalDriver && this.aiState === 'HITSTUN') {
        this.visualPivot.rotation.x = -0.32;
        this.visualPivot.rotation.z = 0.12;
      }
    } else if (this.aiState === 'STAGGERED') {
      const blink = 0.5 + 0.5 * Math.sin(this.animTime * 16);
      this.bodyMat.color.setHex(blink > 0.5 ? 0xfacc15 : 0x64748b);
      this.bodyMat.emissive.setHex(0xf59e0b);
      this.bodyMat.emissiveIntensity = blink > 0.5 ? 0.35 : 0;
      for (let i = 0; i < this.externalMaterials.length; i++) {
        const m = this.externalMaterials[i]!;
        m.emissive.setHex(0xf59e0b);
        m.emissiveIntensity = blink > 0.5 ? 0.28 : 0;
      }
      if (!usesSkeletalDriver) {
        this.visualPivot.rotation.x = 0.34;
        this.visualPivot.rotation.z = Math.sin(this.animTime * 6) * 0.1;
        this.visualPivot.position.y = -0.16;
      }
    } else if (this.aiState === 'TELEGRAPH') {
      const t = Math.min(1, this.stateTimer / this.currentTelegraphDuration);
      const flash = 0.5 + 0.5 * Math.sin(this.stateTimer * 38);
      this.bodyMat.color.set(this.bossPhase === 2 ? '#b91c1c' : this.config.color);
      this.bodyMat.emissive.setHex(0xef4444);
      this.bodyMat.emissiveIntensity = 0.25 + flash * 0.55;
      this.eyeMat.emissiveIntensity = 3.0 + flash * 1.2;
      for (let i = 0; i < this.externalMaterials.length; i++) {
        const m = this.externalMaterials[i]!;
        m.emissive.setHex(0xef4444);
        m.emissiveIntensity = 0.16 + flash * 0.36;
      }
      if (!usesSkeletalDriver) {
        this.visualPivot.rotation.x = -0.26 * t;
        this.visualPivot.rotation.y = -0.32 * t;
        this.visualPivot.position.y = Math.sin(t * Math.PI) * 0.24;
      }

      this.telegraphMesh.visible = true;
      this.telegraphMesh.scale.set(this.activeAttackRadius, 1, this.activeAttackRadius);
      this.telegraphUniforms.uTime.value = this.animTime;
      this.telegraphUniforms.uCharge.value = Math.max(0.06, t);
      this.telegraphUniforms.uOpacity.value = 0.62 + t * 0.34;
    } else {
      const isDistinctVariantBoss =
        this.config.tier === 'BOSS' &&
        !this.usesDedicatedBossRig &&
        (this.config.id === 'magma_overlord' || this.config.id === 'sylvan_sovereign');
      const idleEmissiveHex =
        this.bossPhase === 2 || isDistinctVariantBoss ? this.bossAmbientEmissiveHex : 0x000000;
      const idleBodyEmissiveInt = this.bossPhase === 2 ? 0.3 : isDistinctVariantBoss ? 0.2 : 0;
      const idleExtEmissiveInt = this.bossPhase === 2 ? 0.22 : isDistinctVariantBoss ? 0.16 : 0;

      this.bodyMat.color.set(this.bossPhase === 2 && this.config.id === 'obsidian_kaijin' ? '#991b1b' : this.config.color);
      this.bodyMat.emissive.setHex(idleEmissiveHex);
      this.bodyMat.emissiveIntensity = idleBodyEmissiveInt;
      this.eyeMat.emissiveIntensity = this.bossPhase === 2 ? 2.6 : 1.85;
      for (let i = 0; i < this.externalMaterials.length; i++) {
        const m = this.externalMaterials[i]!;
        m.emissive.setHex(idleEmissiveHex);
        m.emissiveIntensity = idleExtEmissiveInt;
      }
      if (!usesSkeletalDriver) {
        if (this.aiState === 'ATTACK_ACTIVE') {
          this.visualPivot.position.set(0, 0.08, 0.32);
          this.visualPivot.rotation.set(0.32, 0.44, 0);
        } else if (this.aiState === 'CHASE') {
          const freq = this.config.tier === 'BOSS' ? 6.5 : 9.2;
          this.visualPivot.position.y = Math.abs(Math.sin(this.animTime * freq)) * 0.09;
          this.visualPivot.rotation.x = 0.12;
          this.visualPivot.rotation.z = Math.sin(this.animTime * freq) * 0.07;
        } else if (this.aiState === 'HITSTUN') {
          this.visualPivot.rotation.x = -0.32;
        } else {
          this.visualPivot.position.y = Math.sin(this.animTime * 2.4) * 0.02;
          this.visualPivot.rotation.x = 0.05;
        }
      }
    }

    // Active 3D Claw/Cleave Slash Arc + Radial Force Impact Wave!
    if (this.aiState === 'ATTACK_ACTIVE' || (this.aiState === 'RECOVERY' && this.stateTimer < 0.24)) {
      const elapsed = this.aiState === 'ATTACK_ACTIVE' ? this.stateTimer : 0.16 + this.stateTimer;
      const t = Math.min(1, elapsed / 0.4);
      const ease = 1 - Math.pow(1 - t, 2.5);

      this.attackSlashMesh.visible = true;
      const slashScale = this.activeAttackRadius * (0.68 + ease * 0.32);
      this.attackSlashMesh.scale.set(slashScale, slashScale * 0.85, slashScale);
      const swingDir = this.attackSwingId % 2 === 0 ? 1 : -1;
      this.attackSlashMesh.rotation.set(0.18 * swingDir, (t - 0.5) * 0.65 * swingDir, 0.24 * swingDir);
      this.attackSlashUniforms.uProgress.value = t;

      this.shockwaveMesh.visible = true;
      const waveScale = Math.max(0.55, (0.38 + ease * 0.78) * this.activeAttackRadius);
      this.shockwaveMesh.scale.set(waveScale, 1, waveScale);
      this.shockwaveUniforms.uTime.value = this.animTime;
      this.shockwaveUniforms.uOpacity.value = (1 - t) * (this.config.tier === 'MINION' ? 0.65 : 0.92);
    } else {
      this.attackSlashMesh.visible = false;
      this.shockwaveMesh.visible = false;
    }

    // 3D Lock-On reticle billboard
    if (this.lockedOn && this.isAlive) {
      this.lockOnReticle.visible = true;
      this.lockOnReticle.lookAt(camera.position);
      this.lockOnReticle.children[0]!.rotation.z = this.animTime * 1.8;
      this.lockOnReticle.children[1]!.rotation.z = -this.animTime * 2.6;
    } else {
      this.lockOnReticle.visible = false;
    }
  }

  public dispose(): void {
    this.attackHitbox.dispose();
    this.skeletalAnimator.dispose();
    // Dispose only entity-owned ring/reticle geometries & materials; preserve shared cached .glb geometries!
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (obj.geometry && !obj.geometry.userData.sharedAssetGeometry) {
          obj.geometry.dispose();
        }
        if (!obj.userData.isOutlineMesh) {
          const mat = obj.material;
          if (Array.isArray(mat)) {
            for (let i = 0; i < mat.length; i++) {
              mat[i]?.dispose();
            }
          } else {
            mat.dispose();
          }
        }
      }
    });
    this.ownedMaterials.length = 0;
    this.externalMaterials.length = 0;
  }

  protected shouldStartAttack(distToPlayer: number): boolean {
    return this.attackCooldown <= 0 && distToPlayer <= this.attackRange;
  }

  protected beginConfiguredAttack(_distToPlayer: number): void {
    this.aiState = 'TELEGRAPH';
    this.stateTimer = 0;
    this.currentTelegraphDuration = Math.max(0.45, this.config.telegraphDurationSec);
    this.activeAttackRadius = this.config.tier === 'ELITE' ? 4.1 : 2.5;
    this.currentAttackHeavy = this.config.tier !== 'MINION';
  }

  protected onBeforeAIStep(_dt: number): void {
    // Overridden by BossKaijin for 2-phase transitions
  }

  protected onTelegraphTick(
    _dt: number,
    _toPlayerX: number,
    _toPlayerZ: number,
    _distToPlayer: number
  ): void {
    // Overridden by BossKaijin for Leap Slam lunge
  }

  protected onAttackActivated(): void {
    // Overridden by BossKaijin for Phase 2 projectiles
  }

  protected evaluateActiveAttackHitbox(player: HurtboxTarget): void {
    this.scratchSelfPos.x = this.root.position.x;
    this.scratchSelfPos.y = this.root.position.y + 1.0;
    this.scratchSelfPos.z = this.root.position.z;
    this.scratchTargets.length = 1;
    this.scratchTargets[0] = player;

    this.attackHitbox.checkSphere(
      this.scratchSelfPos,
      this.activeAttackRadius,
      this.scratchTargets,
      this.scratchHits
    );

    if (this.scratchHits.length > 0) {
      this.events.hitPlayerDamage = this.config.attackDamage;
      this.events.hitPlayerHeavy = this.currentAttackHeavy;
    }
  }

  protected healHp(amount: number): number {
    if (!this.isAlive || amount <= 0 || this.hp >= this.config.maxHp) return 0;
    const before = this.hp;
    this.hp = Math.min(this.config.maxHp, this.hp + Math.round(amount));
    return this.hp - before;
  }

  protected onStaggerEntered(): void {
    // Overridden by BossKaijin to interrupt active channels (e.g., Sanctuary Mend)
  }

  protected enterStaggered(): void {
    this.aiState = 'STAGGERED';
    this.stateTimer = 0;
    this.attackHitbox.endSwing();
    this.hideTelegraph();
    this.onStaggerEntered();
  }

  protected enterDead(): void {
    this.aiState = 'DEAD';
    this.stateTimer = 0;
    this.activeStatuses.clear();
    this.pendingMicroExplosions = 0;
    this.attackHitbox.endSwing();
    this.hideTelegraph();
  }

  protected hideTelegraph(): void {
    this.telegraphMesh.visible = false;
    this.attackSlashMesh.visible = false;
    this.shockwaveMesh.visible = false;
  }

  protected clampToArena(): void {
    const maxDist = ARENA_RADIUS - this.radius - 0.55;
    const dist = Math.hypot(this.root.position.x, this.root.position.z);
    if (dist > maxDist && dist > 0.001) {
      const s = maxDist / dist;
      this.root.position.x *= s;
      this.root.position.z *= s;
    }
  }

  private applySiblingSeparation(dt: number, siblings: readonly EnemyBase[]): void {
    let pushX = 0;
    let pushZ = 0;
    for (let i = 0; i < siblings.length; i++) {
      const other = siblings[i]!;
      if (other === this || !other.isAlive) continue;
      const dx = this.root.position.x - other.root.position.x;
      const dz = this.root.position.z - other.root.position.z;
      const minDist = this.radius + other.radius + 0.55;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const strength = (minDist - dist) / minDist;
        pushX += (dx / dist) * strength;
        pushZ += (dz / dist) * strength;
      }
    }
    if (pushX !== 0 || pushZ !== 0) {
      this.root.position.x += pushX * 3.8 * dt;
      this.root.position.z += pushZ * 3.8 * dt;
      this.clampToArena();
    }
  }
}

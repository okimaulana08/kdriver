import * as THREE from 'three';
import type { AssetLoader } from '../../engine/AssetLoader';
import type { PbrTextureSet } from '../../engine/PbrMaterialSystem';
import { ARENA_RADIUS } from '../../engine/PhysicsWorld';
import type {
  DifficultyId,
  ElementId,
  EnemyConfig,
  HurtboxTarget,
  Vec3Snapshot,
} from '../types/schema';
import { EnemyBase } from './EnemyBase';

export type BossAttackPattern =
  | 'CLEAVE_2HIT'
  | 'LEAP_SLAM'
  | 'DARK_PROJECTILES'
  | 'FURY_3HIT'
  | 'MAGMA_FISSURES'
  | 'MOLTEN_RING'
  | 'BRIAR_SURGE'
  | 'SANCTUARY_MEND'
  | 'BLINK_STRIKE'
  | 'LIGHTNING_LANES'
  | 'ICE_SPIKE_BARRAGE'
  | 'ECLIPSE_GRAVITY_PULL';

export type BossHazardShape = 'CIRCLE' | 'LANE' | 'GRAVITY_NOVA';

export interface BossSignatureProfile {
  phase1Patterns: readonly BossAttackPattern[];
  phase2FarPatterns: readonly BossAttackPattern[];
  phase2ClosePatterns: readonly BossAttackPattern[];
  projectileColorHex: number;
  projectileEmissiveHex: number;
  hazardColorHex: number;
  hazardElement: ElementId;
  phase2Title: string;
  phase2Subtitle: string;
  phase2BannerColor: string;
}

export const BOSS_SIGNATURE_PROFILES: Readonly<Record<string, BossSignatureProfile>> = {
  obsidian_kaijin: {
    phase1Patterns: ['CLEAVE_2HIT', 'LEAP_SLAM'],
    phase2FarPatterns: ['DARK_PROJECTILES', 'LEAP_SLAM', 'FURY_3HIT'],
    phase2ClosePatterns: ['FURY_3HIT', 'DARK_PROJECTILES', 'LEAP_SLAM'],
    projectileColorHex: 0xff2e63,
    projectileEmissiveHex: 0xf43f5e,
    hazardColorHex: 0xf43f5e,
    hazardElement: 'umbra',
    phase2Title: 'PHASE 2 — OBSIDIAN OVERDRIVE!',
    phase2Subtitle: 'DARK ENERGY UNLEASHED',
    phase2BannerColor: '#f43f5e',
  },
  magma_overlord: {
    phase1Patterns: ['MAGMA_FISSURES', 'LEAP_SLAM', 'CLEAVE_2HIT'],
    phase2FarPatterns: ['MAGMA_FISSURES', 'MOLTEN_RING', 'LEAP_SLAM'],
    phase2ClosePatterns: ['MOLTEN_RING', 'MAGMA_FISSURES', 'FURY_3HIT'],
    projectileColorHex: 0xff6b00,
    projectileEmissiveHex: 0xfb923c,
    hazardColorHex: 0xf97316,
    hazardElement: 'pyro',
    phase2Title: 'PHASE 2 — VOLCANIC CATACLYSM!',
    phase2Subtitle: 'LAVA FISSURES & MOLTEN SALVO',
    phase2BannerColor: '#f97316',
  },
  sylvan_sovereign: {
    phase1Patterns: ['BRIAR_SURGE', 'CLEAVE_2HIT', 'DARK_PROJECTILES'],
    phase2FarPatterns: ['BRIAR_SURGE', 'SANCTUARY_MEND', 'DARK_PROJECTILES'],
    phase2ClosePatterns: ['SANCTUARY_MEND', 'BRIAR_SURGE', 'FURY_3HIT'],
    projectileColorHex: 0x10b981,
    projectileEmissiveHex: 0x34d399,
    hazardColorHex: 0x10b981,
    hazardElement: 'flora',
    phase2Title: 'PHASE 2 — SYLVAN SOVEREIGNTY!',
    phase2Subtitle: 'BRIAR SURGE & SANCTUARY MEND',
    phase2BannerColor: '#10b981',
  },
  chrono_volt_striker: {
    phase1Patterns: ['BLINK_STRIKE', 'LIGHTNING_LANES', 'CLEAVE_2HIT'],
    phase2FarPatterns: ['LIGHTNING_LANES', 'BLINK_STRIKE', 'DARK_PROJECTILES'],
    phase2ClosePatterns: ['BLINK_STRIKE', 'LIGHTNING_LANES', 'FURY_3HIT'],
    projectileColorHex: 0x06b6d4,
    projectileEmissiveHex: 0x67e8f9,
    hazardColorHex: 0x22d3ee,
    hazardElement: 'volt',
    phase2Title: 'PHASE 2 — HYPER-CHRONO OVERCLOCK!',
    phase2Subtitle: 'BLINK DASH & HIGH-VOLTAGE LANES',
    phase2BannerColor: '#22d3ee',
  },
  cryo_eclipse_emperor: {
    phase1Patterns: ['ICE_SPIKE_BARRAGE', 'CLEAVE_2HIT', 'DARK_PROJECTILES'],
    phase2FarPatterns: ['ECLIPSE_GRAVITY_PULL', 'ICE_SPIKE_BARRAGE', 'DARK_PROJECTILES'],
    phase2ClosePatterns: ['ECLIPSE_GRAVITY_PULL', 'ICE_SPIKE_BARRAGE', 'FURY_3HIT'],
    projectileColorHex: 0x38bdf8,
    projectileEmissiveHex: 0xe879f9,
    hazardColorHex: 0x38bdf8,
    hazardElement: 'aqua',
    phase2Title: 'PHASE 2 — ABSOLUTE ZERO ECLIPSE!',
    phase2Subtitle: 'GRAVITY VORTEX & GLACIAL SPIRES',
    phase2BannerColor: '#c084fc',
  },
};

export function getBossSignatureProfile(bossId: string): BossSignatureProfile {
  return BOSS_SIGNATURE_PROFILES[bossId] ?? BOSS_SIGNATURE_PROFILES.obsidian_kaijin!;
}

interface PooledProjectile {
  active: boolean;
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  age: number;
  damage: number;
}

interface PooledHazardZone {
  phase: 'IDLE' | 'TELEGRAPH' | 'ERUPTING';
  shape: BossHazardShape;
  root: THREE.Group;
  warningMesh: THREE.Mesh;
  warningMat: THREE.ShaderMaterial;
  warningUniforms: {
    uTime: { value: number };
    uCharge: { value: number };
    uOpacity: { value: number };
    uColor: { value: THREE.Color };
    uShapeMode: { value: number };
  };
  x: number;
  z: number;
  radius: number;
  laneLength: number;
  laneHalfWidth: number;
  laneYaw: number;
  timer: number;
  telegraphDuration: number;
  eruptionDuration: number;
  damage: number;
  isHeavy: boolean;
  hitPlayer: boolean;
}

const HAZARD_WARN_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Multi-Mode Volumetric GLSL Floor Danger Shader:
// uShapeMode 0 = Magma/Obsidian fissures, 1 = Briar vines, 2 = Linear High-Voltage Laser Lane,
// 3 = Glacial Ice Crystal Shatter, 4 = Crimson-Violet Eclipse Gravity Vortex
const HAZARD_WARN_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uCharge;
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform float uShapeMode;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;

    // Mode 2: Linear Cyberpunk Lightning / Laser Lane cutting across the arena!
    if (uShapeMode > 1.5 && uShapeMode < 2.5) {
      float ax = abs(p.x);
      float az = abs(p.y);
      float endFade = smoothstep(1.0, 0.86, az);
      float edgeRail = exp(-pow((ax - 0.90) * 18.0, 2.0));
      float coreHalf = max(0.08, uCharge * 0.92);
      float chargeFill = smoothstep(coreHalf + 0.08, coreHalf - 0.14, ax);
      float chargeEdge = exp(-pow((ax - coreHalf) * 16.0, 2.0));
      float arc = 0.65 + 0.35 * sin(p.y * 28.0 - uTime * 22.0 + sin(p.x * 10.0) * 2.5);
      float pulse = 0.8 + 0.2 * sin(uTime * 28.0);
      float glow = (edgeRail * 1.05 + chargeEdge * 1.2 + chargeFill * 0.42 * arc) * endFade * pulse;
      vec3 col = mix(uColor, vec3(0.92, 0.98, 1.0), clamp(chargeEdge * 0.75 + edgeRail * 0.4, 0.0, 1.0));
      float alpha = clamp(glow * uOpacity, 0.0, 0.95);
      if (alpha < 0.02) discard;
      gl_FragColor = vec4(col * 1.7, alpha);
      return;
    }

    float r = length(p);
    if (r > 1.0) discard;
    float angle = atan(p.y, p.x);

    // Mode 4: Swirling Crimson-Violet Eclipse Gravity Pull Vortex!
    if (uShapeMode > 3.5) {
      float outerRing = exp(-pow((r - 0.93) * 18.0, 2.0));
      float spiral = smoothstep(0.22, 0.92, sin(angle * 7.0 + r * 14.0 + uTime * 9.5) * 0.5 + 0.5);
      float pullRings = smoothstep(0.35, 0.95, sin(r * 20.0 + uTime * 11.0) * 0.5 + 0.5) * (1.0 - r);
      float chargeRim = exp(-pow((r - max(0.08, 1.0 - uCharge * 0.85)) * 18.0, 2.0));
      float coreGlow = exp(-r * r * (5.5 - uCharge * 3.0)) * (0.4 + uCharge * 0.85);
      float glow = outerRing * 1.1 + chargeRim * 1.15 + (spiral * 0.38 + pullRings * 0.32) * (0.4 + uCharge * 0.6) + coreGlow;
      vec3 eclipseCol = mix(vec3(0.68, 0.22, 0.96), vec3(0.22, 0.82, 1.0), clamp(spiral * 0.65, 0.0, 1.0));
      vec3 col = mix(eclipseCol, vec3(1.0, 0.88, 0.98), clamp(coreGlow * 0.7 + chargeRim * 0.6, 0.0, 1.0));
      float alpha = clamp(glow * uOpacity, 0.0, 0.95);
      if (alpha < 0.02) discard;
      gl_FragColor = vec4(col * 1.65, alpha);
      return;
    }

    float outerRing = exp(-pow((r - 0.93) * 20.0, 2.0));
    float innerWave = smoothstep(uCharge + 0.04, uCharge - 0.08, r);
    float chargeRim = exp(-pow((r - max(0.06, uCharge)) * 22.0, 2.0));

    float pattern = 0.0;
    if (uShapeMode > 2.5) {
      // Mode 3: 6-fold Cryo Ice Crystal Fracture Star
      float star = abs(cos(angle * 3.0 + uTime * 1.2));
      pattern = smoothstep(0.28, 0.92, star * sin(r * 16.0 - uTime * 6.0) * 0.5 + 0.5);
    } else if (uShapeMode > 0.5) {
      // Mode 1: Briar
      pattern = smoothstep(0.35, 0.92, sin(angle * 8.0 + r * 10.0 - uTime * 5.0) * 0.5 + 0.5);
    } else {
      // Mode 0: Magma
      pattern = smoothstep(0.3, 0.9, sin(angle * 6.0 - r * 9.0 + uTime * 4.0) * sin(r * 14.0 - uTime * 7.0) * 0.5 + 0.5);
    }

    float pulse = 0.78 + 0.22 * sin(uTime * 22.0);
    float glow = outerRing * (0.95 + 0.25 * pulse) + chargeRim * 1.15 + innerWave * (0.24 + pattern * 0.42);

    vec3 col = mix(uColor, vec3(1.0, 0.96, 0.9), clamp(chargeRim * 0.8 + outerRing * 0.45, 0.0, 1.0));
    float alpha = clamp(glow * uOpacity, 0.0, 0.95);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col * 1.5, alpha);
  }
`;

export interface BossProjectileHitResult {
  damage: number;
  dirX: number;
  dirZ: number;
  impacted: boolean;
  impactX: number;
  impactY: number;
  impactZ: number;
  trailEmitCount: number;
  trailPositions: Float32Array;
}

const BOSS_ORB_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vPulse;

  void main() {
    vec3 dir = normalize(position);
    float ripple =
      sin(dir.x * 7.0 + uTime * 11.0) * cos(dir.y * 7.0 - uTime * 9.0) +
      sin(dir.z * 9.0 + uTime * 13.0) * 0.5;
    vec3 displaced = position + dir * ripple * 0.065;
    vPulse = ripple * 0.5 + 0.5;
    vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
    vNormalView = normalize(normalMatrix * dir);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const BOSS_ORB_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vPulse;

  void main() {
    float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float fresnel = pow(1.0 - ndv, 2.0);
    float core = pow(ndv, 1.35);
    vec3 col = mix(uColorA, uColorB, clamp(fresnel * 0.85 + vPulse * 0.45, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.96, 0.9), core * 0.78);
    gl_FragColor = vec4(col * 2.1, clamp(0.88 + fresnel * 0.12, 0.0, 1.0));
  }
`;

export interface BossHazardStepResult {
  damage: number;
  dirX: number;
  dirZ: number;
  isHeavy: boolean;
  eruptedCount: number;
  eruptedShape: BossHazardShape;
  lastEruptX: number;
  lastEruptZ: number;
  lastEruptYaw: number;
  healedBossAmount: number;
  channelInterrupted: boolean;
  pullForceX: number;
  pullForceZ: number;
  blinkOccurred: boolean;
  blinkFromX: number;
  blinkFromZ: number;
  blinkToX: number;
  blinkToZ: number;
}

const MAX_BOSS_PROJECTILES = 14;
const MAX_BOSS_HAZARDS = 6;
const PROJECTILE_SPEED = 11.8;
const PROJECTILE_LIFETIME = 2.6;
const PROJECTILE_RADIUS = 0.48;
const HAZARD_ERUPTION_DURATION = 0.5;
const ECLIPSE_GRAVITY_PULL_SPEED = 3.9;

/**
 * Tier 4 Stage Boss Entity supporting all 5 Sector Bosses:
 * - Sector 01 Obsidian Kaijin (Obsidian Overdrive)
 * - Sector 02 Magma Overlord (Volcanic Lava Fissures & Molten Ring)
 * - Sector 03 Sylvan Sovereign (Briar Surge Waves & Interruptible Sanctuary Mend)
 * - Sector 04 Chrono-Volt Striker (High-Speed Blink Dash & Linear Lightning Lanes)
 * - Sector 05 Cryo-Eclipse Emperor (Ice-Spike Barrage & Interruptible Eclipse Gravity Pull)
 * Strictly enforces >= 0.45s telegraphs, zero-allocation hot paths, and clean dispose().
 */
export class BossKaijin extends EnemyBase {
  public readonly projectileGroup = new THREE.Group();
  public readonly hazardGroup = new THREE.Group();

  private readonly profile: BossSignatureProfile;
  private patternIndex = 0;
  private activePattern: BossAttackPattern = 'CLEAVE_2HIT';
  private pendingBossHealAmount = 0;
  private pendingChannelInterrupted = false;
  private blinkedThisTelegraph = false;
  private pendingBlink = false;
  private pendingBlinkFromX = 0;
  private pendingBlinkFromZ = 0;
  private pendingBlinkToX = 0;
  private pendingBlinkToZ = 0;

  private readonly projectiles: PooledProjectile[] = [];
  private readonly projectileGeo: THREE.SphereGeometry;
  private readonly projectileUniforms: {
    uTime: { value: number };
    uColorA: { value: THREE.Color };
    uColorB: { value: THREE.Color };
  };
  private readonly projectileMat: THREE.ShaderMaterial;
  private projectileTrailAccum = 0;

  private readonly hazards: PooledHazardZone[] = [];
  private readonly hazardWarningGeo: THREE.PlaneGeometry;

  // Reusable scratch objects (Zero-Allocation Hot Path)
  private readonly scratchProjPlayerPos: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  private readonly scratchProjectileResult: BossProjectileHitResult = {
    damage: 0,
    dirX: 0,
    dirZ: 1,
    impacted: false,
    impactX: 0,
    impactY: 1.2,
    impactZ: 0,
    trailEmitCount: 0,
    trailPositions: new Float32Array(MAX_BOSS_PROJECTILES * 3),
  };
  private readonly scratchHazardResult: BossHazardStepResult = {
    damage: 0,
    dirX: 0,
    dirZ: 1,
    isHeavy: true,
    eruptedCount: 0,
    eruptedShape: 'CIRCLE',
    lastEruptX: 0,
    lastEruptZ: 0,
    lastEruptYaw: 0,
    healedBossAmount: 0,
    channelInterrupted: false,
    pullForceX: 0,
    pullForceZ: 0,
    blinkOccurred: false,
    blinkFromX: 0,
    blinkFromZ: 0,
    blinkToX: 0,
    blinkToZ: 0,
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
    super(id, config, assetLoader, pbrTextures, spawnX, spawnZ, difficulty);
    this.profile = getBossSignatureProfile(config.id);

    // Boiling GLSL Boss Energy Orbs (seamless vertex-displaced plasma/magma/thorn/cryo spheres)
    this.projectileGeo = new THREE.SphereGeometry(0.42, 20, 14);
    this.projectileUniforms = {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(this.profile.projectileColorHex) },
      uColorB: { value: new THREE.Color(this.profile.projectileEmissiveHex) },
    };
    this.projectileMat = new THREE.ShaderMaterial({
      uniforms: this.projectileUniforms,
      vertexShader: BOSS_ORB_VERTEX_SHADER,
      fragmentShader: BOSS_ORB_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    for (let i = 0; i < MAX_BOSS_PROJECTILES; i++) {
      const mesh = new THREE.Mesh(this.projectileGeo, this.projectileMat);
      mesh.visible = false;
      this.projectileGroup.add(mesh);
      this.projectiles.push({
        active: false,
        mesh,
        x: 0,
        y: 1.2,
        z: 0,
        vx: 0,
        vz: 0,
        age: 0,
        damage: Math.round(config.attackDamage * 0.72),
      });
    }

    // Pooled 3D Floor Hazard Telegraph Zones (GLSL Fissures / Briar / Lightning Lanes / Cryo Spires / Eclipse Vortex)
    this.hazardWarningGeo = new THREE.PlaneGeometry(2.0, 2.0);
    this.hazardWarningGeo.rotateX(-Math.PI / 2);
    const defaultMode =
      config.id === 'sylvan_sovereign'
        ? 1.0
        : config.id === 'chrono_volt_striker'
          ? 2.0
          : config.id === 'cryo_eclipse_emperor'
            ? 3.0
            : 0.0;

    for (let i = 0; i < MAX_BOSS_HAZARDS; i++) {
      const zoneRoot = new THREE.Group();
      zoneRoot.visible = false;

      const warningUniforms = {
        uTime: { value: 0 },
        uCharge: { value: 0.08 },
        uOpacity: { value: 0.9 },
        uColor: { value: new THREE.Color(this.profile.hazardColorHex) },
        uShapeMode: { value: defaultMode },
      };
      const warningMat = new THREE.ShaderMaterial({
        uniforms: warningUniforms,
        vertexShader: HAZARD_WARN_VERTEX_SHADER,
        fragmentShader: HAZARD_WARN_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const warningMesh = new THREE.Mesh(this.hazardWarningGeo, warningMat);
      warningMesh.position.y = 0.055;
      warningMesh.frustumCulled = false;

      zoneRoot.add(warningMesh);
      this.hazardGroup.add(zoneRoot);

      this.hazards.push({
        phase: 'IDLE',
        shape: 'CIRCLE',
        root: zoneRoot,
        warningMesh,
        warningMat,
        warningUniforms,
        x: 0,
        z: 0,
        radius: 2.2,
        laneLength: 22,
        laneHalfWidth: 1.15,
        laneYaw: 0,
        timer: 0,
        telegraphDuration: 0.85,
        eruptionDuration: HAZARD_ERUPTION_DURATION,
        damage: Math.round(config.attackDamage * 0.92),
        isHeavy: true,
        hitPlayer: false,
      });
    }
  }

  public get signatureProfile(): BossSignatureProfile {
    return this.profile;
  }

  public get currentBossPattern(): BossAttackPattern {
    return this.activePattern;
  }

  public get isChannelingSanctuaryMend(): boolean {
    return this.aiState === 'TELEGRAPH' && this.activePattern === 'SANCTUARY_MEND';
  }

  public get isChannelingGravityPull(): boolean {
    return this.aiState === 'TELEGRAPH' && this.activePattern === 'ECLIPSE_GRAVITY_PULL';
  }

  /**
   * Advances pooled Boss projectiles and tests collision against the Rider (Zero-Allocation).
   */
  public stepProjectiles(dt: number, player: HurtboxTarget): BossProjectileHitResult {
    player.getPosition(this.scratchProjPlayerPos);
    const out = this.scratchProjectileResult;
    out.damage = 0;
    out.dirX = 0;
    out.dirZ = 1;
    out.impacted = false;
    out.trailEmitCount = 0;

    this.projectileUniforms.uTime.value += dt;
    this.projectileTrailAccum += dt;
    const emitTrailNow = this.projectileTrailAccum >= 0.055;
    if (emitTrailNow) this.projectileTrailAccum = 0;

    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i]!;
      if (!p.active) continue;

      p.age += dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.y += dt * 7;
      p.mesh.rotation.x += dt * 5;

      const radial = Math.hypot(p.x, p.z);
      if (p.age >= PROJECTILE_LIFETIME || radial > ARENA_RADIUS + 1.5) {
        p.active = false;
        p.mesh.visible = false;
        out.impacted = true;
        out.impactX = p.x;
        out.impactY = p.y;
        out.impactZ = p.z;
        continue;
      }

      if (emitTrailNow && out.trailEmitCount < MAX_BOSS_PROJECTILES) {
        const base = out.trailEmitCount * 3;
        out.trailPositions[base] = p.x;
        out.trailPositions[base + 1] = p.y;
        out.trailPositions[base + 2] = p.z;
        out.trailEmitCount++;
      }

      const dx = this.scratchProjPlayerPos.x - p.x;
      const dz = this.scratchProjPlayerPos.z - p.z;
      const hitDist = PROJECTILE_RADIUS + player.radius;
      if (dx * dx + dz * dz <= hitDist * hitDist) {
        p.active = false;
        p.mesh.visible = false;
        const speed = Math.hypot(p.vx, p.vz) || 1;
        out.damage = p.damage;
        out.dirX = p.vx / speed;
        out.dirZ = p.vz / speed;
        out.impacted = true;
        out.impactX = p.x;
        out.impactY = p.y;
        out.impactZ = p.z;
      }
    }

    return out;
  }

  /**
   * Advances pooled Boss floor hazard zones (Magma Fissures, Briar Spires, Lightning Lanes,
   * Cryo Ice Spires, Eclipse Gravity Vortex) plus Blink Dash & Sanctuary Mend events (Zero-Allocation).
   */
  public stepHazards(dt: number, player: HurtboxTarget): BossHazardStepResult {
    player.getPosition(this.scratchProjPlayerPos);
    const out = this.scratchHazardResult;
    out.damage = 0;
    out.dirX = 0;
    out.dirZ = 1;
    out.isHeavy = true;
    out.eruptedCount = 0;
    out.eruptedShape = 'CIRCLE';
    out.lastEruptX = 0;
    out.lastEruptZ = 0;
    out.lastEruptYaw = 0;
    out.healedBossAmount = this.pendingBossHealAmount;
    out.channelInterrupted = this.pendingChannelInterrupted;
    out.pullForceX = 0;
    out.pullForceZ = 0;
    out.blinkOccurred = this.pendingBlink;
    out.blinkFromX = this.pendingBlinkFromX;
    out.blinkFromZ = this.pendingBlinkFromZ;
    out.blinkToX = this.pendingBlinkToX;
    out.blinkToZ = this.pendingBlinkToZ;

    this.pendingBossHealAmount = 0;
    this.pendingChannelInterrupted = false;
    this.pendingBlink = false;

    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i]!;
      if (h.phase === 'IDLE') continue;

      h.timer += dt;
      h.warningUniforms.uTime.value += dt;

      if (h.phase === 'TELEGRAPH') {
        const frac = Math.min(1, h.timer / Math.max(0.45, h.telegraphDuration));
        h.warningUniforms.uCharge.value = Math.max(0.08, frac);
        h.warningUniforms.uOpacity.value = 0.65 + frac * 0.35;

        // Eclipse Gravity Pull gently draws the Rider toward Cryo-Eclipse Emperor during telegraph!
        if (h.shape === 'GRAVITY_NOVA' && this.isAlive && !this.isStaggered) {
          h.x = this.root.position.x;
          h.z = this.root.position.z;
          h.root.position.set(h.x, 0, h.z);

          const toBossX = h.x - this.scratchProjPlayerPos.x;
          const toBossZ = h.z - this.scratchProjPlayerPos.z;
          const dist = Math.hypot(toBossX, toBossZ);
          if (dist > 1.85 && dist < 14.0) {
            const strength = ECLIPSE_GRAVITY_PULL_SPEED * (0.65 + frac * 0.55);
            out.pullForceX += (toBossX / dist) * strength;
            out.pullForceZ += (toBossZ / dist) * strength;
          }
        }

        if (h.timer >= h.telegraphDuration) {
          h.phase = 'ERUPTING';
          h.timer = 0;
          h.hitPlayer = false;
          h.warningUniforms.uCharge.value = 1.0;
          out.eruptedCount++;
          out.eruptedShape = h.shape;
          out.lastEruptX = h.x;
          out.lastEruptZ = h.z;
          out.lastEruptYaw = h.laneYaw;
        }
      } else if (h.phase === 'ERUPTING') {
        const frac = Math.min(1, h.timer / h.eruptionDuration);
        h.warningUniforms.uOpacity.value = Math.max(0, (1 - frac) * 0.85);

        // Active damage window during early peak eruption (respects Perfect Dodge!)
        if (!h.hitPlayer && frac <= 0.42) {
          const dx = this.scratchProjPlayerPos.x - h.x;
          const dz = this.scratchProjPlayerPos.z - h.z;

          if (h.shape === 'LANE') {
            // Oriented rectangular lane hit check (Zero-Allocation scalar projection)
            const cosY = Math.cos(-h.laneYaw);
            const sinY = Math.sin(-h.laneYaw);
            const localX = dx * cosY - dz * sinY;
            const localZ = dx * sinY + dz * cosY;
            if (
              Math.abs(localX) <= h.laneHalfWidth + player.radius * 0.55 &&
              Math.abs(localZ) <= h.laneLength * 0.5 + player.radius * 0.4
            ) {
              h.hitPlayer = true;
              const sideSign = localX >= 0 ? 1 : -1;
              out.damage = h.damage;
              out.dirX = Math.cos(h.laneYaw) * sideSign;
              out.dirZ = -Math.sin(h.laneYaw) * sideSign;
              out.isHeavy = h.isHeavy;
            }
          } else {
            const hitDist = h.radius + player.radius * 0.65;
            if (dx * dx + dz * dz <= hitDist * hitDist) {
              h.hitPlayer = true;
              const len = Math.hypot(dx, dz) || 1;
              out.damage = h.damage;
              out.dirX = dx / len;
              out.dirZ = dz / len;
              out.isHeavy = h.isHeavy;
            }
          }
        }

        if (h.timer >= h.eruptionDuration) {
          h.phase = 'IDLE';
          h.root.visible = false;
        }
      }
    }

    return out;
  }

  public clearProjectiles(): void {
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i]!;
      p.active = false;
      p.mesh.visible = false;
    }
  }

  public clearHazards(): void {
    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i]!;
      h.phase = 'IDLE';
      h.root.visible = false;
    }
  }

  public override dispose(): void {
    this.clearProjectiles();
    this.clearHazards();
    this.projectileGeo.dispose();
    this.projectileMat.dispose();
    this.hazardWarningGeo.dispose();
    for (let i = 0; i < this.hazards.length; i++) {
      this.hazards[i]!.warningMat.dispose();
    }
    super.dispose();
  }

  protected override onBeforeAIStep(_dt: number): void {
    if (this.bossPhase === 1 && this.hp > 0 && this.hp < this.config.maxHp * this.bossPhase2HpRatio) {
      this.bossPhase = 2;
      this.guard = Math.min(this.config.maxGuard, this.guard + Math.round(this.config.maxGuard * 0.4));
      this.events.enteredPhase2 = true;
    }
  }

  protected override onStaggerEntered(): void {
    if (
      this.activePattern === 'SANCTUARY_MEND' ||
      this.activePattern === 'ECLIPSE_GRAVITY_PULL'
    ) {
      this.pendingChannelInterrupted = true;
    }
    this.clearHazards();
  }

  protected override shouldStartAttack(distToPlayer: number): boolean {
    if (this.attackCooldown > 0) return false;
    const isHazardBoss =
      this.config.id === 'magma_overlord' ||
      this.config.id === 'sylvan_sovereign' ||
      this.config.id === 'chrono_volt_striker' ||
      this.config.id === 'cryo_eclipse_emperor';
    const maxEngageDist = this.bossPhase === 2 ? 11.2 : isHazardBoss ? 8.8 : 5.4;
    return distToPlayer <= maxEngageDist;
  }

  protected override beginConfiguredAttack(distToPlayer: number): void {
    this.aiState = 'TELEGRAPH';
    this.stateTimer = 0;
    this.blinkedThisTelegraph = false;

    const patterns =
      this.bossPhase === 1
        ? this.profile.phase1Patterns
        : distToPlayer > 5.5
          ? this.profile.phase2FarPatterns
          : this.profile.phase2ClosePatterns;
    this.activePattern = patterns[this.patternIndex % patterns.length]!;
    this.patternIndex++;

    // Signature telegraph colors per Boss pattern
    this.setTelegraphColor(
      this.activePattern === 'SANCTUARY_MEND'
        ? 0x10b981
        : this.activePattern === 'MAGMA_FISSURES' || this.activePattern === 'MOLTEN_RING'
          ? 0xf97316
          : this.activePattern === 'BLINK_STRIKE' || this.activePattern === 'LIGHTNING_LANES'
            ? 0x22d3ee
            : this.activePattern === 'ECLIPSE_GRAVITY_PULL'
              ? 0xc084fc
              : this.activePattern === 'ICE_SPIKE_BARRAGE'
                ? 0x38bdf8
                : 0xef4444
    );

    if (this.activePattern === 'LEAP_SLAM') {
      this.currentTelegraphDuration = this.bossPhase === 2 ? 0.62 : 0.72;
      this.activeAttackRadius = 5.4;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'DARK_PROJECTILES') {
      this.currentTelegraphDuration = 0.6;
      this.activeAttackRadius = 2.8;
      this.currentAttackHeavy = false;
    } else if (this.activePattern === 'MOLTEN_RING') {
      this.currentTelegraphDuration = 0.68;
      this.activeAttackRadius = 3.4;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'MAGMA_FISSURES') {
      this.currentTelegraphDuration = 0.65;
      this.activeAttackRadius = 3.6;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'BRIAR_SURGE') {
      this.currentTelegraphDuration = 0.62;
      this.activeAttackRadius = 3.4;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'SANCTUARY_MEND') {
      this.currentTelegraphDuration = 1.45;
      this.activeAttackRadius = 5.2;
      this.currentAttackHeavy = false;
    } else if (this.activePattern === 'BLINK_STRIKE') {
      this.currentTelegraphDuration = this.bossPhase === 2 ? 0.56 : 0.66;
      this.activeAttackRadius = 4.6;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'LIGHTNING_LANES') {
      this.currentTelegraphDuration = 0.62;
      this.activeAttackRadius = 3.2;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'ICE_SPIKE_BARRAGE') {
      this.currentTelegraphDuration = 0.64;
      this.activeAttackRadius = 3.5;
      this.currentAttackHeavy = true;
    } else if (this.activePattern === 'ECLIPSE_GRAVITY_PULL') {
      this.currentTelegraphDuration = 1.05;
      this.activeAttackRadius = 5.4;
      this.currentAttackHeavy = true;
      // Immediately activate the visible Gravity Pull Vortex zone around Cryo-Eclipse Emperor!
      this.spawnGravityNovaZone();
    } else if (this.activePattern === 'FURY_3HIT') {
      this.currentTelegraphDuration = 0.52;
      this.activeAttackRadius = 4.6;
      this.currentAttackHeavy = true;
    } else {
      this.currentTelegraphDuration = 0.58;
      this.activeAttackRadius = 4.3;
      this.currentAttackHeavy = true;
    }
  }

  protected override onTelegraphTick(
    dt: number,
    toPlayerX: number,
    toPlayerZ: number,
    distToPlayer: number
  ): void {
    if (this.activePattern === 'LEAP_SLAM' && distToPlayer > 2.2) {
      const inv = 1 / distToPlayer;
      const leapSpeed = this.bossPhase === 2 ? 7.4 : 6.0;
      this.root.position.x += toPlayerX * inv * leapSpeed * dt;
      this.root.position.z += toPlayerZ * inv * leapSpeed * dt;
      this.clampToArena();
    } else if (
      this.activePattern === 'BLINK_STRIKE' &&
      !this.blinkedThisTelegraph &&
      this.stateTimer >= this.currentTelegraphDuration * 0.42
    ) {
      // High-speed cyber blink right behind the Rider mid-telegraph (still leaving >= 0.32s reaction window!)
      this.blinkedThisTelegraph = true;
      this.pendingBlinkFromX = this.root.position.x;
      this.pendingBlinkFromZ = this.root.position.z;

      const inv = distToPlayer > 0.01 ? 1 / distToPlayer : 0;
      const dirX = inv > 0 ? toPlayerX * inv : Math.sin(this.root.rotation.y);
      const dirZ = inv > 0 ? toPlayerZ * inv : Math.cos(this.root.rotation.y);

      this.root.position.x = this.scratchPlayerPos.x + dirX * 2.7;
      this.root.position.z = this.scratchPlayerPos.z + dirZ * 2.7;
      this.clampToArena();

      const lookX = this.scratchPlayerPos.x - this.root.position.x;
      const lookZ = this.scratchPlayerPos.z - this.root.position.z;
      if (lookX * lookX + lookZ * lookZ > 0.01) {
        this.root.rotation.y = Math.atan2(lookX, lookZ);
      }

      this.pendingBlinkToX = this.root.position.x;
      this.pendingBlinkToZ = this.root.position.z;
      this.pendingBlink = true;
    }
  }

  protected override onAttackActivated(): void {
    if (this.activePattern === 'DARK_PROJECTILES') {
      const angles =
        (this.config.id === 'sylvan_sovereign' ||
          this.config.id === 'chrono_volt_striker' ||
          this.config.id === 'cryo_eclipse_emperor') &&
        this.bossPhase === 2
          ? [-0.5, -0.25, 0, 0.25, 0.5]
          : [-0.36, 0, 0.36];
      this.spawnProjectileSpread(angles);
      this.events.fireProjectileSpread = true;
    } else if (this.activePattern === 'MOLTEN_RING') {
      this.spawnProjectileSpread([-0.6, -0.3, 0, 0.3, 0.6]);
      this.events.fireProjectileSpread = true;
    } else if (this.activePattern === 'MAGMA_FISSURES') {
      this.spawnMagmaFissures();
    } else if (this.activePattern === 'BRIAR_SURGE') {
      this.spawnBriarSurge();
    } else if (this.activePattern === 'LIGHTNING_LANES') {
      this.spawnLightningLanes();
    } else if (this.activePattern === 'ICE_SPIKE_BARRAGE') {
      this.spawnIceSpikeBarrage();
    } else if (this.activePattern === 'SANCTUARY_MEND') {
      // Uninterrupted Sanctuary Mend heals 8% HP and restores 15% Guard!
      const healed = this.healHp(Math.round(this.config.maxHp * 0.08));
      this.guard = Math.min(
        this.config.maxGuard,
        this.guard + Math.round(this.config.maxGuard * 0.15)
      );
      this.pendingBossHealAmount = healed;
    }
  }

  private spawnProjectileSpread(spreadAngles: readonly number[]): void {
    const baseYaw = this.root.rotation.y;
    for (let a = 0; a < spreadAngles.length; a++) {
      let slot: PooledProjectile | null = null;
      for (let i = 0; i < this.projectiles.length; i++) {
        if (!this.projectiles[i]!.active) {
          slot = this.projectiles[i]!;
          break;
        }
      }
      if (!slot) break;
      const angle = baseYaw + spreadAngles[a]!;
      slot.active = true;
      slot.age = 0;
      slot.x = this.root.position.x + Math.sin(angle) * 1.15;
      slot.y = 1.25;
      slot.z = this.root.position.z + Math.cos(angle) * 1.15;
      slot.vx = Math.sin(angle) * PROJECTILE_SPEED;
      slot.vz = Math.cos(angle) * PROJECTILE_SPEED;
      slot.mesh.position.set(slot.x, slot.y, slot.z);
      slot.mesh.visible = true;
    }
  }

  private findFreeHazardSlot(): PooledHazardZone | null {
    for (let i = 0; i < this.hazards.length; i++) {
      if (this.hazards[i]!.phase === 'IDLE') {
        return this.hazards[i]!;
      }
    }
    return null;
  }

  private spawnHazardZone(
    x: number,
    z: number,
    radius: number,
    telegraphDuration: number,
    damageMultiplier: number,
    shapeMode: number,
    colorHex: number = this.profile.hazardColorHex
  ): void {
    const slot = this.findFreeHazardSlot();
    if (!slot) return;

    const maxR = ARENA_RADIUS - radius - 0.5;
    const radial = Math.hypot(x, z);
    let clampedX = x;
    let clampedZ = z;
    if (radial > maxR && radial > 0.001) {
      const s = maxR / radial;
      clampedX *= s;
      clampedZ *= s;
    }

    slot.phase = 'TELEGRAPH';
    slot.shape = shapeMode > 3.5 ? 'GRAVITY_NOVA' : 'CIRCLE';
    slot.x = clampedX;
    slot.z = clampedZ;
    slot.radius = radius;
    slot.laneYaw = 0;
    slot.timer = 0;
    slot.telegraphDuration = Math.max(0.55, telegraphDuration);
    slot.eruptionDuration = HAZARD_ERUPTION_DURATION;
    slot.damage = Math.round(this.config.attackDamage * damageMultiplier);
    slot.isHeavy = true;
    slot.hitPlayer = false;

    slot.root.position.set(clampedX, 0, clampedZ);
    slot.root.rotation.y = 0;
    slot.root.visible = true;
    slot.warningMesh.scale.set(radius, 1, radius);
    slot.warningUniforms.uShapeMode.value = shapeMode;
    slot.warningUniforms.uColor.value.setHex(colorHex);
    slot.warningUniforms.uTime.value = 0;
    slot.warningUniforms.uCharge.value = 0.08;
    slot.warningUniforms.uOpacity.value = 0.72;
  }

  private spawnLaneHazard(
    centerX: number,
    centerZ: number,
    laneYaw: number,
    length: number,
    halfWidth: number,
    telegraphDuration: number,
    damageMultiplier: number
  ): void {
    const slot = this.findFreeHazardSlot();
    if (!slot) return;

    slot.phase = 'TELEGRAPH';
    slot.shape = 'LANE';
    slot.x = centerX;
    slot.z = centerZ;
    slot.radius = halfWidth;
    slot.laneLength = length;
    slot.laneHalfWidth = halfWidth;
    slot.laneYaw = laneYaw;
    slot.timer = 0;
    slot.telegraphDuration = Math.max(0.6, telegraphDuration);
    slot.eruptionDuration = HAZARD_ERUPTION_DURATION;
    slot.damage = Math.round(this.config.attackDamage * damageMultiplier);
    slot.isHeavy = true;
    slot.hitPlayer = false;

    slot.root.position.set(centerX, 0, centerZ);
    slot.root.rotation.y = laneYaw;
    slot.root.visible = true;
    // PlaneGeometry is 2x2 so scale X by halfWidth and Z by half-length!
    slot.warningMesh.scale.set(halfWidth, 1, length * 0.5);
    slot.warningUniforms.uShapeMode.value = 2.0;
    slot.warningUniforms.uColor.value.setHex(0x22d3ee);
    slot.warningUniforms.uTime.value = 0;
    slot.warningUniforms.uCharge.value = 0.08;
    slot.warningUniforms.uOpacity.value = 0.78;
  }

  private spawnMagmaFissures(): void {
    const px = this.scratchPlayerPos.x;
    const pz = this.scratchPlayerPos.z;
    const count = this.bossPhase === 2 ? 4 : 3;
    this.spawnHazardZone(px, pz, 2.35, 0.88, 0.95, 0.0);
    const orbitR = 3.85;
    const baseAngle = this.root.rotation.y + 0.4;
    for (let i = 1; i < count; i++) {
      const ang = baseAngle + ((i - 1) * Math.PI * 2) / Math.max(1, count - 1);
      this.spawnHazardZone(
        px + Math.sin(ang) * orbitR,
        pz + Math.cos(ang) * orbitR,
        2.2,
        0.92 + i * 0.08,
        0.88,
        0.0
      );
    }
  }

  private spawnBriarSurge(): void {
    const dx = this.scratchPlayerPos.x - this.root.position.x;
    const dz = this.scratchPlayerPos.z - this.root.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const count = this.bossPhase === 2 ? 5 : 4;

    for (let i = 0; i < count; i++) {
      const stepDist = 2.6 + i * 2.55;
      const hx = this.root.position.x + dirX * stepDist;
      const hz = this.root.position.z + dirZ * stepDist;
      this.spawnHazardZone(hx, hz, 2.05, 0.78 + i * 0.14, 0.85, 1.0);
    }
  }

  private spawnLightningLanes(): void {
    // High-voltage cyberpunk laser danger corridors slicing through the Rider's position!
    const px = this.scratchPlayerPos.x;
    const pz = this.scratchPlayerPos.z;
    const dx = px - this.root.position.x;
    const dz = pz - this.root.position.z;
    const baseYaw = Math.hypot(dx, dz) > 0.1 ? Math.atan2(dx, dz) : this.root.rotation.y;

    if (this.bossPhase === 2) {
      // 3-way high-voltage starburst grid!
      this.spawnLaneHazard(px, pz, baseYaw, 26, 1.15, 0.72, 0.92);
      this.spawnLaneHazard(px, pz, baseYaw + Math.PI / 3, 26, 1.12, 0.86, 0.92);
      this.spawnLaneHazard(px, pz, baseYaw - Math.PI / 3, 26, 1.12, 1.0, 0.92);
    } else {
      // Twin perpendicular cyber lightning lanes!
      this.spawnLaneHazard(px, pz, baseYaw, 24, 1.15, 0.78, 0.88);
      this.spawnLaneHazard(px, pz, baseYaw + Math.PI * 0.5, 24, 1.15, 0.94, 0.88);
    }
  }

  private spawnIceSpikeBarrage(): void {
    // Tracking domino eruption of jagged glacial ice crystal spires toward & flanking the Rider!
    const dx = this.scratchPlayerPos.x - this.root.position.x;
    const dz = this.scratchPlayerPos.z - this.root.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const count = this.bossPhase === 2 ? 5 : 4;

    for (let i = 0; i < count; i++) {
      const stepDist = 2.5 + i * 2.55;
      const hx = this.root.position.x + dirX * stepDist;
      const hz = this.root.position.z + dirZ * stepDist;
      this.spawnHazardZone(hx, hz, 2.15, 0.72 + i * 0.12, 0.92, 3.0, 0x38bdf8);
    }
  }

  private spawnGravityNovaZone(): void {
    this.spawnHazardZone(
      this.root.position.x,
      this.root.position.z,
      6.1,
      1.05,
      1.15,
      4.0,
      0xc084fc
    );
  }
}

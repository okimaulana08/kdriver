export type ElementId =
  | 'pyro'
  | 'volt'
  | 'aqua'
  | 'terra'
  | 'aero'
  | 'flora'
  | 'solar'
  | 'lunar'
  | 'umbra'
  | 'lux';

export type StarterElementId = Extract<ElementId, 'pyro' | 'volt' | 'aqua'>;

export type WeaponArchetype = 'FAST_MELEE' | 'HEAVY_MELEE' | 'POLEARM' | 'RANGED';
export type StatusEffectId = 'BURN' | 'SHOCK' | 'WET' | 'ROOT' | 'MARK';
export type ReactionId = 'ELECTRO_SURGE' | 'STEAM_BURST' | 'OVERLOAD' | 'WILDFIRE' | 'ECLIPSE';
export type FormTier = 'BASIC' | 'SUPER' | 'ULTIMATE';
export type EnemyTier = 'MINION' | 'ELITE' | 'MINI_BOSS' | 'BOSS';

export type ScreenMode = 'HUB' | 'ARENA' | 'RESULT';
export type DifficultyId = 'easy' | 'medium' | 'hard' | 'hell';
export type RankGrade = 'S+' | 'S' | 'A' | 'B' | 'C';
export type RiderId = 'nexus' | 'phantom';

export interface RiderSignatureSkillConfig {
  readonly name: string;
  readonly cooldown: number;
  readonly damageMultiplier: number;
  readonly radius: number;
  readonly appliesStatus: StatusEffectId;
}

export interface RiderConfig {
  readonly id: RiderId;
  readonly codeName: string;
  readonly name: string;
  readonly shortName: string;
  readonly roleTag: string;
  readonly accentColor: string;
  readonly glowColor: string;
  readonly maxForms: 2 | 3;
  readonly hasUltimateForm: boolean;
  readonly locksElementSelection: boolean;
  readonly basicFormLabel: string;
  readonly upgradedFormLabel: string;
  readonly ultimateFormLabel: string | null;
  readonly maxHp: number;
  readonly moveSpeed: number;
  readonly attackSpeedMult: number;
  readonly baseCritChance: number;
  readonly dodgeIframeBonusSec: number;
  readonly warpCounterWindowSec: number;
  readonly warpCounterDamageMult: number;
  readonly riderKickCooldownSec: number;
  readonly riderKickName: string;
  readonly upgradedFormDamageMult: number;
  readonly upgradedFormDurationSec: number;
  readonly upgradedFormMaxDurationSec: number;
  readonly ultimateFormDamageMult: number;
  readonly ultimateFormDurationSec: number;
  readonly ultimateFormMaxDurationSec: number;
  readonly upgradedAfterimageAlwaysOn: boolean;
  readonly signatureFinisherName: string | null;
  readonly signatureThemeName?: string;
  readonly signatureStatus?: StatusEffectId;
  readonly signatureWeapon?: WeaponConfig;
  readonly signaturePet?: PetConfig;
  readonly signatureSkill?: RiderSignatureSkillConfig;
  readonly passiveLabel: string;
  readonly passiveSummary: string;
}

export interface DifficultyConfig {
  readonly id: DifficultyId;
  readonly label: string;
  readonly tagline: string;
  readonly accentColor: string;
  readonly enemyHpMult: number;
  readonly enemyDamageMult: number;
  readonly enemyGuardMult: number;
  readonly telegraphDurationMult: number;
  readonly enemyCooldownMult: number;
  readonly bossPhase2HpRatio: number;
  readonly dodgeIframeBonusSec: number;
  readonly shardRewardMult: number;
  readonly scoreMult: number;
  readonly hellExtraElite: boolean;
}

export type PlayerStateId =
  | 'IDLE'
  | 'MOVE'
  | 'ATTACK_1'
  | 'ATTACK_2'
  | 'ATTACK_3'
  | 'ELEMENT_SKILL'
  | 'RIDER_KICK'
  | 'FORM_SWITCH'
  | 'DODGE'
  | 'HENSHIN_SUPER'
  | 'ULTIMATE_CINEMATIC'
  | 'HITSTUN'
  | 'DEAD';

export type InputAction =
  | 'ATTACK'
  | 'DODGE'
  | 'SKILL'
  | 'RIDER_KICK'
  | 'PET'
  | 'HENSHIN'
  | 'FINISHER'
  | 'SWITCH_1'
  | 'SWITCH_2'
  | 'SWITCH_3'
  | 'LOCK_ON';

export interface WeaponConfig {
  id: string;
  name: string;
  archetype: WeaponArchetype;
  baseDamage: number;
  comboMultipliers: [number, number, number];
  attackSpeed: number;
  hitStopMs: number;
  range: number;
  gaugePerHit: number;
  modelPath?: string; // Opsional di fase Greybox (fallback ke procedural mesh)
}

export interface PetConfig {
  id: string;
  name: string;
  passiveDescription: string;
  passiveBonus: { stat: 'atk' | 'speed' | 'gaugeGain' | 'regen'; value: number };
  assistCooldown: number;
  assistDamageMultiplier: number;
  appliesStatus: StatusEffectId;
  modelPath?: string;
}

export interface ElementConfig {
  id: ElementId;
  name: string;
  primaryColor: string;
  emissiveColor: string;
  statusApplied: StatusEffectId;
  weapon: WeaponConfig;
  pet: PetConfig;
  skill: {
    name: string;
    cooldown: number;
    damageMultiplier: number;
    radius: number;
  };
  finisherName: string;
}

export interface EnemyConfig {
  id: string;
  name: string;
  tier: EnemyTier;
  maxHp: number;
  maxGuard: number; // 0 jika tidak punya Super Armor
  defense: number;
  moveSpeed: number;
  attackDamage: number;
  telegraphDurationSec: number;
  scale: number;
  color: string;
}

export type StageId =
  | 'stage_01_nexus_arena'
  | 'stage_02_volcanic_crater'
  | 'stage_03_forest_ruins'
  | 'stage_04_neon_district'
  | 'stage_05_glacial_citadel'
  | 'stage_boss_rush';

export type ArenaThemeId =
  | 'coastal_quarry'
  | 'volcanic_crater'
  | 'forest_ruins'
  | 'neon_district'
  | 'glacial_citadel';

export interface WaveSpawnEntry {
  enemyId:
    | 'shadow_grunt'
    | 'armored_brute'
    | 'obsidian_kaijin'
    | 'magma_overlord'
    | 'sylvan_sovereign'
    | 'chrono_volt_striker'
    | 'cryo_eclipse_emperor';
  count: number;
}

export interface WaveConfig {
  waveNumber: number;
  title: string;
  subtitle: string;
  spawns: readonly WaveSpawnEntry[];
}

export interface StageConfig {
  id: StageId;
  name: string;
  subtitle: string;
  arenaTheme: ArenaThemeId;
  accentColor: string;
  recommendedLevel: number;
  shardReward: number;
  bossDropPool: readonly ElementId[];
  waves: readonly WaveConfig[];
  isBossRush?: boolean;
  bossRushHealPct?: number;
}

export interface StageStats {
  stageId?: StageId;
  difficulty?: DifficultyId;
  victory: boolean;
  clearTimeSec: number;
  damageTaken: number;
  reactionsTriggered: number;
  perfectDodges: number;
  maxCombo: number;
  defeatedBossWithFinisher: boolean;
}

export interface StageResult extends StageStats {
  difficulty: DifficultyId;
  score: number;
  rank: RankGrade;
  isNewBest: boolean;
  shardsEarned: number;
  unlockedElementDrop: ElementId | null;
}

export interface SaveRecord {
  bestRank: RankGrade | null;
  bestScore: number;
  fastestClearSec: number | null;
  totalClears: number;
  loadoutOrder: [ElementId, ElementId, ElementId];
  selectedStageId: StageId;
  selectedDifficulty: DifficultyId;
  selectedRiderId: RiderId;
  phantomCoreLevel?: number;
  stageDifficultyBestRanks: Partial<Record<string, RankGrade>>;
  unlockedElements: ElementId[];
  gemLevels: Partial<Record<ElementId, number>>;
  gemShards: number;
  clearedStageIds: StageId[];
}

export interface EnemyHudSnapshot {
  id: string;
  name: string;
  tier: EnemyTier;
  hp: number;
  maxHp: number;
  guard: number;
  maxGuard: number;
  isStaggered: boolean;
  isTelegraphing: boolean;
  bossPhase: 1 | 2;
  statuses: ActiveStatusSnapshot[];
}

export interface Vec3Snapshot {
  x: number;
  y: number;
  z: number;
}

export interface ActiveStatusSnapshot {
  id: StatusEffectId;
  remainingSec: number;
  durationSec: number;
}

export interface ReactionSpec {
  readonly id: ReactionId;
  readonly displayName: string;
  readonly subtitle: string;
  readonly requiredStatus: StatusEffectId;
  readonly triggerElement: ElementId;
  readonly damageMultiplier: number;
  readonly guardDamageMultiplier: number;
  readonly gaugeMultiplier: number;
  readonly radius: number;
  readonly knockbackForce: number;
  readonly microExplosionCount: number;
  readonly ignoresDefense: boolean;
  readonly accentColor: string;
}

export interface ReactionBannerEvent {
  id: number;
  reactionId: ReactionId;
  title: string;
  subtitle: string;
  accentColor: string;
  createdAtMs: number;
}

export interface DamageCalculationInput {
  baseDamage: number;
  skillMultiplier: number;
  formTier: FormTier;
  formMultiplierOverride?: number;
  reactionMultiplier?: number;
  targetDefense: number;
  targetStaggered?: boolean;
  targetStatuses?: readonly StatusEffectId[];
  baseCritChance?: number;
  ignoresDefense?: boolean;
  /** Deterministic roll in [0, 1) for unit tests; defaults to Math.random(). */
  critRoll?: number;
}

export interface DamageCalculationResult {
  finalDamage: number;
  isCrit: boolean;
  critChance: number;
  effectiveDefense: number;
}

export type FloatingTextKind =
  | 'normal'
  | 'crit'
  | 'dodge'
  | 'playerHit'
  | 'reaction'
  | 'heal'
  | 'info';

export interface FloatingCombatText {
  id: number;
  text: string;
  subtext?: string;
  xPct: number;
  yPct: number;
  kind: FloatingTextKind;
  createdAtMs: number;
}

export interface HurtboxTarget {
  readonly id: string;
  readonly radius: number;
  readonly isAlive: boolean;
  getPosition(out: Vec3Snapshot): Vec3Snapshot;
}

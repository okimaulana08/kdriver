import { create } from 'zustand';
import { ALL_ELEMENT_IDS } from '../game/data/elements';
import { getDifficultyConfig } from '../game/data/difficulty';
import { getStageConfig } from '../game/data/stages';
import { applyGemUpgrade, applyShardGemUnlock } from '../game/ProgressionSystem';
import { loadSaveRecord, persistSaveRecord } from '../game/StageManager';
import type {
  ArenaThemeId,
  DifficultyId,
  ElementId,
  EnemyHudSnapshot,
  FloatingCombatText,
  FloatingTextKind,
  FormTier,
  InputAction,
  PlayerStateId,
  ReactionBannerEvent,
  ReactionSpec,
  SaveRecord,
  ScreenMode,
  StageId,
  StageResult,
  Vec3Snapshot,
} from '../game/types/schema';

export interface BossIntroBannerState {
  id: number;
  bossName: string;
  bossTitle: string;
  accentColor: string;
  difficultyLabel: string;
}

export type EngineStatus = 'initializing' | 'ready' | 'error';

export interface BufferedActionSnapshot {
  action: InputAction;
  timestampMs: number;
}

export interface AnnouncementBanner {
  id: number;
  title: string;
  subtitle: string;
  accentColor: string;
  createdAtMs: number;
}

export interface StageOutcomeCutInState {
  id: number;
  victory: boolean;
  stageName: string;
  accentColor: string;
}

export type ElementCooldownMap = Record<ElementId, number>;

interface GameStoreState {
  engineStatus: EngineStatus;
  errorMessage: string | null;
  loadProgress: number;
  loadLabel: string;
  bloomEnabled: boolean;
  bgmIntensity: 'OFF' | 'HUB' | 'COMBAT' | 'BOSS';
  riderRigMode: 'PROCEDURAL PBR' | 'MIXAMO SKELETAL';
  screenMode: ScreenMode;
  selectedStageId: StageId;
  selectedDifficulty: DifficultyId;
  arenaTheme: ArenaThemeId;
  loadoutOrder: [ElementId, ElementId, ElementId];
  saveRecord: SaveRecord;
  stageResult: StageResult | null;

  gamepadConnected: boolean;
  gamepadName: string | null;

  fps: number;
  frameTimeMs: number;
  fixedHz: number;
  timeScale: number;
  hitStopActive: boolean;
  pointerLocked: boolean;
  activeElement: ElementId;
  arenaRadius: number;
  playerPosition: Vec3Snapshot;
  distanceFromCenter: number;
  isGrounded: boolean;
  isTouchingWall: boolean;
  activeKeys: string[];
  lastBufferedAction: BufferedActionSnapshot | null;
  showDebugOverlay: boolean;

  playerState: PlayerStateId;
  formTier: FormTier;
  playerHp: number;
  playerMaxHp: number;
  driverGauge: number;
  overdriveGauge: number;
  superFormRemaining: number;
  finisherCooldown: number;
  riderKickCooldown: number;
  activePetRemaining: number;
  activeElementPetRemaining: number;
  activePetCount: number;
  canActivateSuper: boolean;
  canActivateUltimateForm: boolean;
  canActivateUltimate: boolean;
  bossStaggered: boolean;
  warpCounterReady: boolean;
  ultimateBannerTitle: string | null;
  finisherCinematicId: number;
  finisherCinematicElement: ElementId;
  finisherCinematicFromUltimate: boolean;
  bossIntroBanner: BossIntroBannerState | null;
  stageOutcomeCutIn: StageOutcomeCutInState | null;

  comboCount: number;
  reactionCount: number;
  isLockedOn: boolean;
  waveNumber: number;
  totalWaves: number;
  aliveEnemyCount: number;
  stageElapsedSec: number;
  focusedEnemy: EnemyHudSnapshot | null;

  formSwitchCooldown: number;
  skillCooldowns: ElementCooldownMap;
  petCooldowns: ElementCooldownMap;
  reactionBanner: ReactionBannerEvent | null;
  waveBanner: AnnouncementBanner | null;
  perfectDodgeFlashId: number;
  breakKickFlashId: number;
  audioMuted: boolean;
  floatingTexts: FloatingCombatText[];

  setEngineStatus: (status: EngineStatus, errorMessage?: string | null) => void;
  setLoadProgress: (progress: number, label: string) => void;
  setBloomEnabled: (enabled: boolean) => void;
  setBgmIntensity: (intensity: 'OFF' | 'HUB' | 'COMBAT' | 'BOSS') => void;
  setRiderRigMode: (mode: 'PROCEDURAL PBR' | 'MIXAMO SKELETAL') => void;
  setScreenMode: (mode: ScreenMode) => void;
  setSelectedStageId: (stageId: StageId) => void;
  setSelectedDifficulty: (difficulty: DifficultyId) => void;
  setArenaTheme: (theme: ArenaThemeId) => void;
  setGamepadStatus: (connected: boolean, name: string | null) => void;
  setLoadoutOrder: (order: [ElementId, ElementId, ElementId]) => void;
  upgradeGemLevel: (elementId: ElementId) => boolean;
  unlockGemWithShards: (elementId: ElementId) => boolean;
  setStageResult: (result: StageResult | null, saveRecord?: SaveRecord) => void;
  setPerformanceMetrics: (
    fps: number,
    frameTimeMs: number,
    timeScale: number,
    hitStopActive: boolean
  ) => void;
  setPointerLocked: (locked: boolean) => void;
  setActiveElement: (element: ElementId) => void;
  setPlayerTelemetry: (
    x: number,
    y: number,
    z: number,
    distanceFromCenter: number,
    isGrounded: boolean,
    isTouchingWall: boolean
  ) => void;
  setCombatSnapshot: (snapshot: {
    playerState: PlayerStateId;
    formTier: FormTier;
    playerHp: number;
    playerMaxHp: number;
    driverGauge: number;
    overdriveGauge: number;
    superFormRemaining: number;
    finisherCooldown: number;
    riderKickCooldown: number;
    activePetRemaining: number;
    activeElementPetRemaining: number;
    activePetCount: number;
    canActivateSuper: boolean;
    canActivateUltimateForm: boolean;
    canActivateUltimate: boolean;
    bossStaggered: boolean;
    warpCounterReady: boolean;
    ultimateBannerTitle: string | null;
    comboCount: number;
    isLockedOn: boolean;
    waveNumber: number;
    totalWaves: number;
    aliveEnemyCount: number;
    stageElapsedSec: number;
    focusedEnemy: EnemyHudSnapshot | null;
  }) => void;
  triggerFinisherCinematic: (element: ElementId, title: string, fromUltimate: boolean) => void;
  clearFinisherCinematic: () => void;
  triggerBossIntroBanner: (bossName: string, bossTitle: string, accentColor: string) => void;
  clearBossIntroBanner: () => void;
  triggerStageOutcomeCutIn: (victory: boolean, stageName: string, accentColor: string) => void;
  clearStageOutcomeCutIn: () => void;
  setAbilityCooldowns: (
    formSwitchCooldown: number,
    loadout: readonly [ElementId, ElementId, ElementId],
    skillValues: readonly [number, number, number],
    petValues: readonly [number, number, number]
  ) => void;
  triggerReactionBanner: (spec: ReactionSpec) => void;
  triggerWaveBanner: (title: string, subtitle: string, accentColor?: string) => void;
  clearExpiredBanners: (nowMs: number) => void;
  triggerPerfectDodgeFlash: () => void;
  triggerBreakKickFlash: () => void;
  setAudioMuted: (muted: boolean) => void;
  pushFloatingText: (
    text: string,
    xPct: number,
    yPct: number,
    kind: FloatingTextKind,
    subtext?: string
  ) => void;
  pruneFloatingTexts: (nowMs: number, maxAgeMs?: number) => void;
  setActiveKeys: (keys: string[]) => void;
  setLastBufferedAction: (action: InputAction, timestampMs: number) => void;
  toggleDebugOverlay: () => void;
  resetArenaState: () => void;
}

const INITIAL_POSITION: Vec3Snapshot = { x: 0, y: 0.97, z: 0 };

function createZeroCooldownMap(): ElementCooldownMap {
  return {
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

const MAX_FLOATING_TEXTS = 22;
let nextFloatingTextId = 1;
let nextBannerId = 1;

function quantize(value: number): number {
  return Math.round(value * 10) / 10;
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameEnemySnapshot(a: EnemyHudSnapshot | null, b: EnemyHudSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.id !== b.id ||
    a.hp !== b.hp ||
    a.maxHp !== b.maxHp ||
    a.guard !== b.guard ||
    a.maxGuard !== b.maxGuard ||
    a.isStaggered !== b.isStaggered ||
    a.isTelegraphing !== b.isTelegraphing ||
    a.bossPhase !== b.bossPhase ||
    a.statuses.length !== b.statuses.length
  ) {
    return false;
  }
  for (let i = 0; i < a.statuses.length; i++) {
    const sa = a.statuses[i]!;
    const sb = b.statuses[i]!;
    if (sa.id !== sb.id || Math.round(sa.remainingSec * 4) !== Math.round(sb.remainingSec * 4)) {
      return false;
    }
  }
  return true;
}

const initialSave = loadSaveRecord();
const initialStage = getStageConfig(initialSave.selectedStageId);

export const useGameStore = create<GameStoreState>((set, get) => ({
  engineStatus: 'initializing',
  errorMessage: null,
  loadProgress: 0,
  loadLabel: 'Preparing Engine...',
  bloomEnabled: true,
  bgmIntensity: 'HUB',
  riderRigMode: 'PROCEDURAL PBR',
  screenMode: 'HUB',
  selectedStageId: initialStage.id,
  selectedDifficulty: initialSave.selectedDifficulty,
  arenaTheme: initialStage.arenaTheme,
  loadoutOrder: initialSave.loadoutOrder,
  saveRecord: initialSave,
  stageResult: null,

  gamepadConnected: false,
  gamepadName: null,

  fps: 0,
  frameTimeMs: 0,
  fixedHz: 60,
  timeScale: 1,
  hitStopActive: false,
  pointerLocked: false,
  activeElement: initialSave.loadoutOrder[0],
  arenaRadius: 16,
  playerPosition: INITIAL_POSITION,
  distanceFromCenter: 0,
  isGrounded: true,
  isTouchingWall: false,
  activeKeys: [],
  lastBufferedAction: null,
  showDebugOverlay: false,

  playerState: 'IDLE',
  formTier: 'BASIC',
  playerHp: 220,
  playerMaxHp: 220,
  driverGauge: 0,
  overdriveGauge: 0,
  superFormRemaining: 0,
  finisherCooldown: 0,
  riderKickCooldown: 0,
  activePetRemaining: 0,
  activeElementPetRemaining: 0,
  activePetCount: 0,
  canActivateSuper: false,
  canActivateUltimateForm: false,
  canActivateUltimate: false,
  bossStaggered: false,
  warpCounterReady: false,
  ultimateBannerTitle: null,
  finisherCinematicId: 0,
  finisherCinematicElement: initialSave.loadoutOrder[0],
  finisherCinematicFromUltimate: false,
  bossIntroBanner: null,
  stageOutcomeCutIn: null,

  comboCount: 0,
  reactionCount: 0,
  isLockedOn: false,
  waveNumber: 1,
  totalWaves: initialStage.waves.length,
  aliveEnemyCount: 0,
  stageElapsedSec: 0,
  focusedEnemy: null,

  formSwitchCooldown: 0,
  skillCooldowns: createZeroCooldownMap(),
  petCooldowns: createZeroCooldownMap(),
  reactionBanner: null,
  waveBanner: null,
  perfectDodgeFlashId: 0,
  breakKickFlashId: 0,
  audioMuted: false,
  floatingTexts: [],

  setEngineStatus: (status, errorMessage = null) => {
    const state = get();
    if (state.engineStatus === status && state.errorMessage === errorMessage) return;
    set({ engineStatus: status, errorMessage });
  },

  setLoadProgress: (progress, label) => {
    const clamped = Math.min(100, Math.max(0, Math.round(progress)));
    const state = get();
    if (state.loadProgress === clamped && state.loadLabel === label) return;
    set({ loadProgress: clamped, loadLabel: label });
  },

  setBloomEnabled: (enabled) => {
    if (get().bloomEnabled === enabled) return;
    set({ bloomEnabled: enabled });
  },

  setBgmIntensity: (intensity) => {
    if (get().bgmIntensity === intensity) return;
    set({ bgmIntensity: intensity });
  },

  setRiderRigMode: (mode) => {
    if (get().riderRigMode === mode) return;
    set({ riderRigMode: mode });
  },

  setScreenMode: (mode) => {
    if (get().screenMode === mode) return;
    set({ screenMode: mode });
  },

  setSelectedStageId: (stageId) => {
    const stage = getStageConfig(stageId);
    const nextRecord: SaveRecord = { ...get().saveRecord, selectedStageId: stage.id };
    persistSaveRecord(nextRecord);
    set({
      selectedStageId: stage.id,
      arenaTheme: stage.arenaTheme,
      totalWaves: stage.waves.length,
      saveRecord: nextRecord,
    });
  },

  setSelectedDifficulty: (difficulty) => {
    const cfg = getDifficultyConfig(difficulty);
    const nextRecord: SaveRecord = { ...get().saveRecord, selectedDifficulty: cfg.id };
    persistSaveRecord(nextRecord);
    set({
      selectedDifficulty: cfg.id,
      saveRecord: nextRecord,
    });
  },

  setArenaTheme: (theme) => {
    if (get().arenaTheme === theme) return;
    set({ arenaTheme: theme });
  },

  setGamepadStatus: (connected, name) => {
    const state = get();
    if (state.gamepadConnected === connected && state.gamepadName === name) return;
    set({ gamepadConnected: connected, gamepadName: name });
  },

  setLoadoutOrder: (order) => {
    const nextRecord: SaveRecord = { ...get().saveRecord, loadoutOrder: order };
    persistSaveRecord(nextRecord);
    set({
      loadoutOrder: order,
      activeElement: order[0],
      saveRecord: nextRecord,
    });
  },

  upgradeGemLevel: (elementId) => {
    const res = applyGemUpgrade(get().saveRecord, elementId);
    if (!res.upgraded) return false;
    persistSaveRecord(res.updated);
    set({ saveRecord: res.updated });
    return true;
  },

  unlockGemWithShards: (elementId) => {
    const res = applyShardGemUnlock(get().saveRecord, elementId);
    if (!res.unlocked) return false;
    persistSaveRecord(res.updated);
    set({ saveRecord: res.updated });
    return true;
  },

  setStageResult: (result, saveRecord) => {
    set((state) => ({
      stageResult: result,
      saveRecord: saveRecord ?? state.saveRecord,
    }));
  },

  setPerformanceMetrics: (fps, frameTimeMs, timeScale, hitStopActive) => {
    const roundedFps = Math.round(fps);
    const roundedMs = Math.round(frameTimeMs * 10) / 10;
    const roundedScale = Math.round(timeScale * 100) / 100;
    const state = get();
    if (
      state.fps === roundedFps &&
      state.frameTimeMs === roundedMs &&
      state.timeScale === roundedScale &&
      state.hitStopActive === hitStopActive
    ) {
      return;
    }
    set({
      fps: roundedFps,
      frameTimeMs: roundedMs,
      timeScale: roundedScale,
      hitStopActive,
    });
  },

  setPointerLocked: (locked) => {
    if (get().pointerLocked === locked) return;
    set({ pointerLocked: locked });
  },

  setActiveElement: (element) => {
    if (get().activeElement === element) return;
    set({ activeElement: element });
  },

  setPlayerTelemetry: (x, y, z, distanceFromCenter, isGrounded, isTouchingWall) => {
    const qx = quantize(x);
    const qy = quantize(y);
    const qz = quantize(z);
    const qDist = quantize(distanceFromCenter);
    const state = get();
    const prev = state.playerPosition;
    if (
      prev.x === qx &&
      prev.y === qy &&
      prev.z === qz &&
      state.distanceFromCenter === qDist &&
      state.isGrounded === isGrounded &&
      state.isTouchingWall === isTouchingWall
    ) {
      return;
    }
    set({
      playerPosition: { x: qx, y: qy, z: qz },
      distanceFromCenter: qDist,
      isGrounded,
      isTouchingWall,
    });
  },

  setCombatSnapshot: (snap) => {
    const rGauge = Math.round(snap.driverGauge);
    const rOver = Math.round(snap.overdriveGauge);
    const rSuper = quantize(snap.superFormRemaining);
    const rFinCd = quantize(snap.finisherCooldown);
    const rKickCd = quantize(snap.riderKickCooldown);
    const rPetRem = quantize(snap.activePetRemaining);
    const rElemPetRem = quantize(snap.activeElementPetRemaining);
    const rTime = Math.floor(snap.stageElapsedSec);
    const state = get();

    if (
      state.playerState === snap.playerState &&
      state.formTier === snap.formTier &&
      state.playerHp === snap.playerHp &&
      state.playerMaxHp === snap.playerMaxHp &&
      state.driverGauge === rGauge &&
      state.overdriveGauge === rOver &&
      state.superFormRemaining === rSuper &&
      state.finisherCooldown === rFinCd &&
      state.riderKickCooldown === rKickCd &&
      state.activePetRemaining === rPetRem &&
      state.activeElementPetRemaining === rElemPetRem &&
      state.activePetCount === snap.activePetCount &&
      state.canActivateSuper === snap.canActivateSuper &&
      state.canActivateUltimateForm === snap.canActivateUltimateForm &&
      state.canActivateUltimate === snap.canActivateUltimate &&
      state.bossStaggered === snap.bossStaggered &&
      state.warpCounterReady === snap.warpCounterReady &&
      state.ultimateBannerTitle === snap.ultimateBannerTitle &&
      state.comboCount === snap.comboCount &&
      state.isLockedOn === snap.isLockedOn &&
      state.waveNumber === snap.waveNumber &&
      state.totalWaves === snap.totalWaves &&
      state.aliveEnemyCount === snap.aliveEnemyCount &&
      state.stageElapsedSec === rTime &&
      sameEnemySnapshot(state.focusedEnemy, snap.focusedEnemy)
    ) {
      return;
    }

    set({
      playerState: snap.playerState,
      formTier: snap.formTier,
      playerHp: snap.playerHp,
      playerMaxHp: snap.playerMaxHp,
      driverGauge: rGauge,
      overdriveGauge: rOver,
      superFormRemaining: rSuper,
      finisherCooldown: rFinCd,
      riderKickCooldown: rKickCd,
      activePetRemaining: rPetRem,
      activeElementPetRemaining: rElemPetRem,
      activePetCount: snap.activePetCount,
      canActivateSuper: snap.canActivateSuper,
      canActivateUltimateForm: snap.canActivateUltimateForm,
      canActivateUltimate: snap.canActivateUltimate,
      bossStaggered: snap.bossStaggered,
      warpCounterReady: snap.warpCounterReady,
      ultimateBannerTitle: snap.ultimateBannerTitle,
      comboCount: snap.comboCount,
      isLockedOn: snap.isLockedOn,
      waveNumber: snap.waveNumber,
      totalWaves: snap.totalWaves,
      aliveEnemyCount: snap.aliveEnemyCount,
      stageElapsedSec: rTime,
      focusedEnemy: snap.focusedEnemy,
    });
  },

  triggerFinisherCinematic: (element, title, fromUltimate) => {
    set((state) => ({
      finisherCinematicId: state.finisherCinematicId + 1,
      finisherCinematicElement: element,
      finisherCinematicFromUltimate: fromUltimate,
      ultimateBannerTitle: title,
    }));
  },

  clearFinisherCinematic: () => {
    if (get().ultimateBannerTitle === null) return;
    set({ ultimateBannerTitle: null });
  },

  triggerBossIntroBanner: (bossName, bossTitle, accentColor) => {
    const diffLabel = getDifficultyConfig(get().selectedDifficulty).label;
    set({
      bossIntroBanner: {
        id: nextBannerId++,
        bossName,
        bossTitle,
        accentColor,
        difficultyLabel: diffLabel,
      },
    });
  },

  clearBossIntroBanner: () => {
    if (get().bossIntroBanner === null) return;
    set({ bossIntroBanner: null });
  },

  triggerStageOutcomeCutIn: (victory, stageName, accentColor) => {
    set({
      stageOutcomeCutIn: {
        id: nextBannerId++,
        victory,
        stageName,
        accentColor,
      },
    });
  },

  clearStageOutcomeCutIn: () => {
    if (get().stageOutcomeCutIn === null) return;
    set({ stageOutcomeCutIn: null });
  },

  setAbilityCooldowns: (formSwitchCooldown, loadout, skillValues, petValues) => {
    const qSwitch = quantize(formSwitchCooldown);
    const state = get();
    const [e0, e1, e2] = loadout;
    const s0 = quantize(skillValues[0]);
    const s1 = quantize(skillValues[1]);
    const s2 = quantize(skillValues[2]);
    const p0 = quantize(petValues[0]);
    const p1 = quantize(petValues[1]);
    const p2 = quantize(petValues[2]);

    if (
      state.formSwitchCooldown === qSwitch &&
      state.skillCooldowns[e0] === s0 &&
      state.skillCooldowns[e1] === s1 &&
      state.skillCooldowns[e2] === s2 &&
      state.petCooldowns[e0] === p0 &&
      state.petCooldowns[e1] === p1 &&
      state.petCooldowns[e2] === p2
    ) {
      return;
    }

    const nextSkill: ElementCooldownMap = { ...state.skillCooldowns, [e0]: s0, [e1]: s1, [e2]: s2 };
    const nextPet: ElementCooldownMap = { ...state.petCooldowns, [e0]: p0, [e1]: p1, [e2]: p2 };
    set({
      formSwitchCooldown: qSwitch,
      skillCooldowns: nextSkill,
      petCooldowns: nextPet,
    });
  },

  triggerReactionBanner: (spec) => {
    set((state) => ({
      reactionCount: state.reactionCount + 1,
      reactionBanner: {
        id: nextBannerId++,
        reactionId: spec.id,
        title: spec.displayName,
        subtitle: spec.subtitle,
        accentColor: spec.accentColor,
        createdAtMs: performance.now(),
      },
    }));
  },

  triggerWaveBanner: (title, subtitle, accentColor = '#38bdf8') => {
    set({
      waveBanner: {
        id: nextBannerId++,
        title,
        subtitle,
        accentColor,
        createdAtMs: performance.now(),
      },
    });
  },

  clearExpiredBanners: (nowMs) => {
    const state = get();
    const clearReaction = state.reactionBanner && nowMs - state.reactionBanner.createdAtMs > 2150;
    const clearWave = state.waveBanner && nowMs - state.waveBanner.createdAtMs > 2400;
    if (!clearReaction && !clearWave) return;
    set({
      reactionBanner: clearReaction ? null : state.reactionBanner,
      waveBanner: clearWave ? null : state.waveBanner,
    });
  },

  triggerPerfectDodgeFlash: () => {
    set((state) => ({ perfectDodgeFlashId: state.perfectDodgeFlashId + 1 }));
  },

  triggerBreakKickFlash: () => {
    set((state) => ({ breakKickFlashId: state.breakKickFlashId + 1 }));
  },

  setAudioMuted: (muted) => {
    if (get().audioMuted === muted) return;
    set({ audioMuted: muted });
  },

  pushFloatingText: (text, xPct, yPct, kind, subtext) => {
    const now = performance.now();
    const item: FloatingCombatText = {
      id: nextFloatingTextId++,
      text,
      subtext,
      xPct,
      yPct,
      kind,
      createdAtMs: now,
    };
    set((state) => ({
      floatingTexts: [...state.floatingTexts.slice(-(MAX_FLOATING_TEXTS - 1)), item],
    }));
  },

  pruneFloatingTexts: (nowMs, maxAgeMs = 950) => {
    const current = get().floatingTexts;
    if (current.length === 0) return;
    let needsPrune = false;
    for (let i = 0; i < current.length; i++) {
      if (nowMs - current[i]!.createdAtMs > maxAgeMs) {
        needsPrune = true;
        break;
      }
    }
    if (!needsPrune) return;
    set({
      floatingTexts: current.filter((item) => nowMs - item.createdAtMs <= maxAgeMs),
    });
  },

  setActiveKeys: (keys) => {
    if (sameStringArray(get().activeKeys, keys)) return;
    set({ activeKeys: keys });
  },

  setLastBufferedAction: (action, timestampMs) => {
    const prev = get().lastBufferedAction;
    if (prev && prev.action === action && prev.timestampMs === timestampMs) return;
    set({ lastBufferedAction: { action, timestampMs } });
  },

  toggleDebugOverlay: () => {
    set((state) => ({ showDebugOverlay: !state.showDebugOverlay }));
  },

  resetArenaState: () => {
    const loadout = get().loadoutOrder;
    const stage = getStageConfig(get().selectedStageId);
    const zeroSkills = createZeroCooldownMap();
    const zeroPets = createZeroCooldownMap();
    for (let i = 0; i < ALL_ELEMENT_IDS.length; i++) {
      zeroSkills[ALL_ELEMENT_IDS[i]!] = 0;
      zeroPets[ALL_ELEMENT_IDS[i]!] = 0;
    }
    set({
      stageResult: null,
      activeElement: loadout[0],
      playerState: 'IDLE',
      formTier: 'BASIC',
      playerHp: 220,
      playerMaxHp: 220,
      driverGauge: 0,
      overdriveGauge: 0,
      superFormRemaining: 0,
      finisherCooldown: 0,
      riderKickCooldown: 0,
      activePetRemaining: 0,
      activeElementPetRemaining: 0,
      activePetCount: 0,
      canActivateSuper: false,
      canActivateUltimateForm: false,
      canActivateUltimate: false,
      bossStaggered: false,
      warpCounterReady: false,
      ultimateBannerTitle: null,
      finisherCinematicFromUltimate: false,
      bossIntroBanner: null,
      stageOutcomeCutIn: null,
      comboCount: 0,
      reactionCount: 0,
      isLockedOn: false,
      waveNumber: 1,
      totalWaves: stage.waves.length,
      aliveEnemyCount: 0,
      stageElapsedSec: 0,
      focusedEnemy: null,
      formSwitchCooldown: 0,
      skillCooldowns: zeroSkills,
      petCooldowns: zeroPets,
      reactionBanner: null,
      waveBanner: null,
      floatingTexts: [],
    });
  },
}));

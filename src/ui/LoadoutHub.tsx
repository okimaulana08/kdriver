import { useMemo, useState, type MouseEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { HubCameraPreset } from '../engine/CameraRig';
import {
  DIFFICULTY_LIST,
  getDifficultyConfig,
  makeStageDifficultyKey,
} from '../game/data/difficulty';
import {
  ALL_ELEMENT_IDS,
  getElementConfig,
  getElementLevelDamageMultiplier,
} from '../game/data/elements';
import { RIDER_LIST, getRiderConfig } from '../game/data/riders';
import { STAGE_LIST, getStageConfig } from '../game/data/stages';
import {
  GEM_SHARD_UNLOCK_COST,
  MAX_GEM_LEVEL,
  getGemLevel,
  getGemUpgradeCost,
  getPhantomCoreLevel,
  isElementUnlocked,
} from '../game/ProgressionSystem';
import type {
  DifficultyId,
  ElementId,
  RiderId,
  StageId,
  WeaponArchetype,
} from '../game/types/schema';
import { useGameStore } from '../store/useGameStore';
import { HoloGlitchFlash, ShimmerText } from './motion/HoloEffects';
import { MagneticGlowButton } from './motion/MagneticGlowButton';
import { SpillwayCardDeck, type SpillwayDeckItem } from './motion/SpillwayCardDeck';
import { SpotlightBeamPanel } from './motion/SpotlightBeamPanel';

interface LoadoutHubProps {
  onPreviewElement: (id: ElementId) => void;
  onUpdateLoadoutOrder: (order: [ElementId, ElementId, ElementId]) => void;
  onSelectStage: (stageId: StageId) => void;
  onSelectDifficulty: (difficulty: DifficultyId) => void;
  onSelectRider: (riderId: RiderId) => void;
  onGemProgressionChanged: () => void;
  onDeploy: () => void;
  onResetView?: () => void;
  onSelectCameraPreset?: (preset: HubCameraPreset) => void;
}

interface ElementDeckCard extends SpillwayDeckItem {
  readonly elemId: ElementId;
  readonly indexNum: number;
}

type PhantomCardKey = 'katana' | 'fox' | 'forms';

interface PhantomDeckCard extends SpillwayDeckItem {
  readonly cardKey: PhantomCardKey;
  readonly label: string;
}

const SPRING_SNAPPY = { type: 'spring' as const, stiffness: 460, damping: 32, mass: 0.8 };
const SPRING_PANEL = { type: 'spring' as const, stiffness: 320, damping: 28, mass: 0.9 };

const PHANTOM_DECK_CARDS: readonly PhantomDeckCard[] = [
  { id: 'katana', cardKey: 'katana', label: '01 KATANA', accentColor: '#06b6d4', glowColor: '#67e8f9' },
  { id: 'fox', cardKey: 'fox', label: '02 FOX PET', accentColor: '#38bdf8', glowColor: '#bae6fd' },
  { id: 'forms', cardKey: 'forms', label: '03 2-FORMS', accentColor: '#f43f5e', glowColor: '#67e8f9' },
];

function ElementEmblem({ id, color, size = 16 }: { id: ElementId; color: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0"
      aria-hidden="true"
    >
      {id === 'pyro' && (
        <path
          d="M12.5 2C13 6.2 9.2 7.8 9.2 11.4c0 1.4 1 2.4 2.2 2.4 1.6 0 2.5-1.5 2.4-3.2 2.4 1.6 4.2 4.3 4.2 7.1 0 3.2-2.7 5.3-6 5.3s-6-2.3-6-5.6C6 12.2 9.5 7.4 12.5 2Z"
          fill={color}
        />
      )}
      {id === 'volt' && (
        <path d="M13.5 2 4.5 13.5h6.2L9.5 22l10-12h-6.3L13.5 2Z" fill={color} />
      )}
      {id === 'aqua' && (
        <path
          d="M12 2.5C8.5 7.7 5.5 11.2 5.5 15a6.5 6.5 0 0 0 13 0c0-3.8-3-7.3-6.5-12.5Zm-2.5 12.7c.2 1.8 1.5 3.1 3.4 3.2-2.5.7-5-1-4.8-3.5.1-.8.5-1.7 1.4-2.8-.1 1.1-.1 2.1 0 3.1Z"
          fill={color}
        />
      )}
      {id === 'terra' && (
        <path d="M12 3 3 19h18L12 3Zm0 4.8 4.4 8.2H7.6L12 7.8Z" fill={color} />
      )}
      {id === 'aero' && (
        <path
          d="M3 9h11.5a2.5 2.5 0 1 0-2.3-3.5M3 13.5h15a2.5 2.5 0 1 1-2.2 3.6M3 18h8.5"
          stroke={color}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      )}
      {id === 'flora' && (
        <path
          d="M19.5 4.5C12.5 4.5 6 8.2 5 17.5c4.5-.2 10.8-2.2 14.5-13ZM6 19l5.5-5.5"
          fill={color}
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
      {id === 'solar' && (
        <>
          <circle cx="12" cy="12" r="4.5" fill={color} />
          <path
            d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"
            stroke={color}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </>
      )}
      {id === 'lunar' && (
        <path
          d="M17.8 15.2A7.5 7.5 0 0 1 8.8 6.2a7.5 7.5 0 1 0 9 9Z"
          fill={color}
        />
      )}
      {id === 'umbra' && (
        <path
          d="M12 2.5 4 7v10l8 4.5 8-4.5V7l-8-4.5Zm0 4.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
          fill={color}
        />
      )}
      {id === 'lux' && (
        <path
          d="M12 2 14.6 9.4 22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z"
          fill={color}
        />
      )}
    </svg>
  );
}

function formatArchetype(arch: WeaponArchetype): string {
  switch (arch) {
    case 'HEAVY_MELEE':
      return 'HEAVY';
    case 'FAST_MELEE':
      return 'RAPID';
    case 'POLEARM':
      return 'REACH';
    case 'RANGED':
      return 'RANGED';
  }
}

function trackBorderGlow(e: MouseEvent<HTMLElement>): void {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--bx', `${(e.clientX - rect.left).toFixed(1)}px`);
  e.currentTarget.style.setProperty('--by', `${(e.clientY - rect.top).toFixed(1)}px`);
}

const CAMERA_PRESETS: ReadonlyArray<{ id: HubCameraPreset; label: string }> = [
  { id: 'full', label: 'FULL' },
  { id: 'helmet', label: 'VISOR' },
  { id: 'weapon', label: 'ARMAMENT' },
];

export function LoadoutHub({
  onPreviewElement,
  onUpdateLoadoutOrder,
  onSelectStage,
  onSelectDifficulty,
  onSelectRider,
  onGemProgressionChanged,
  onDeploy,
  onResetView,
  onSelectCameraPreset,
}: LoadoutHubProps) {
  const loadoutOrder = useGameStore((s) => s.loadoutOrder);
  const activeElement = useGameStore((s) => s.activeElement);
  const selectedStageId = useGameStore((s) => s.selectedStageId);
  const selectedDifficulty = useGameStore((s) => s.selectedDifficulty);
  const selectedRiderId = useGameStore((s) => s.selectedRiderId);
  const saveRecord = useGameStore((s) => s.saveRecord);
  const engineStatus = useGameStore((s) => s.engineStatus);
  const gamepadConnected = useGameStore((s) => s.gamepadConnected);
  const upgradeGemLevel = useGameStore((s) => s.upgradeGemLevel);
  const upgradePhantomCore = useGameStore((s) => s.upgradePhantomCore);
  const unlockGemWithShards = useGameStore((s) => s.unlockGemWithShards);

  const [editingSlot, setEditingSlot] = useState<0 | 1 | 2>(0);
  const [camPreset, setCamPreset] = useState<HubCameraPreset>('full');
  const [phantomCardId, setPhantomCardId] = useState<PhantomCardKey>('katana');
  const [glitchSeq, setGlitchSeq] = useState(0);

  const elementDeckItems = useMemo<ElementDeckCard[]>(
    () =>
      ALL_ELEMENT_IDS.map((elemId, index) => {
        const cfg = getElementConfig(elemId);
        return {
          id: elemId,
          elemId,
          indexNum: index + 1,
          accentColor: cfg.primaryColor,
          glowColor: cfg.emissiveColor,
        };
      }),
    []
  );

  const previewConfig = getElementConfig(activeElement);
  const selectedStage = getStageConfig(selectedStageId);
  const diffConfig = getDifficultyConfig(selectedDifficulty);
  const riderConfig = getRiderConfig(selectedRiderId);
  const isPhantomLocked = riderConfig.locksElementSelection;
  const phantomLevel = getPhantomCoreLevel(saveRecord);
  const phantomUpgradeCost = getGemUpgradeCost(phantomLevel);
  const canUpgradePhantom =
    phantomLevel < MAX_GEM_LEVEL && saveRecord.gemShards >= phantomUpgradeCost;

  const previewLevel = isPhantomLocked ? phantomLevel : getGemLevel(saveRecord, activeElement);
  const levelMult = getElementLevelDamageMultiplier(previewLevel);
  const previewMultPct = Math.round((levelMult - 1) * 100);
  const scaledShardPreview = Math.round(selectedStage.shardReward * diffConfig.shardRewardMult);
  const accentColor = isPhantomLocked ? riderConfig.accentColor : previewConfig.primaryColor;
  const glowColor = isPhantomLocked ? riderConfig.glowColor : previewConfig.emissiveColor;

  const activeWeaponCfg = isPhantomLocked
    ? (riderConfig.signatureWeapon ?? previewConfig.weapon)
    : previewConfig.weapon;
  const displayWeaponName = activeWeaponCfg.name;
  const displayWeaponTag = isPhantomLocked
    ? 'KATANA'
    : formatArchetype(previewConfig.weapon.archetype);
  const displayStatus = isPhantomLocked
    ? (riderConfig.signatureStatus ?? 'MARK')
    : previewConfig.statusApplied;
  const displaySkillName = isPhantomLocked
    ? (riderConfig.signatureSkill?.name ?? 'Phantom Iaido Cross')
    : previewConfig.skill.name;
  const displayPetName = isPhantomLocked
    ? (riderConfig.signaturePet?.name ?? 'Kitsune-02 Cyber Fox')
    : previewConfig.pet.name;
  const displayPetPassive = isPhantomLocked
    ? (riderConfig.signaturePet?.passiveDescription ?? '+18% Overclock Gauge Gain')
    : previewConfig.pet.passiveDescription;
  const displayPedestalSubtitle = isPhantomLocked
    ? (riderConfig.signatureThemeName ?? 'FIXED FORM // CYBER KATANA')
    : previewConfig.name;

  // Data-driven animated weapon stat percentages
  const statPowerPct = Math.min(
    100,
    Math.max(24, Math.round(((activeWeaponCfg.baseDamage * levelMult) / 56) * 100))
  );
  const statSpeedPct = Math.min(
    100,
    Math.max(22, Math.round(((activeWeaponCfg.attackSpeed * riderConfig.attackSpeedMult) / 1.7) * 100))
  );
  const statReachOrCritPct = isPhantomLocked
    ? Math.min(100, Math.round((riderConfig.baseCritChance / 0.25) * 100))
    : Math.min(100, Math.max(28, Math.round((Math.min(activeWeaponCfg.range, 6.2) / 6.2) * 100)));

  const pulseGlitch = () => setGlitchSeq((n) => n + 1);

  const moveSlot = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target > 2) return;
    const next = [...loadoutOrder] as [ElementId, ElementId, ElementId];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    onUpdateLoadoutOrder(next);
    pulseGlitch();
  };

  const equipElementToSlot = (elemId: ElementId) => {
    if (!isElementUnlocked(saveRecord, elemId)) return;
    const existingIdx = loadoutOrder.indexOf(elemId);
    if (existingIdx >= 0) {
      setEditingSlot(existingIdx as 0 | 1 | 2);
      onPreviewElement(elemId);
      pulseGlitch();
      return;
    }
    const next = [...loadoutOrder] as [ElementId, ElementId, ElementId];
    next[editingSlot] = elemId;
    onUpdateLoadoutOrder(next);
    onPreviewElement(elemId);
    pulseGlitch();
  };

  const cycleElementDeck = (delta: -1 | 1) => {
    const currIdx = Math.max(0, ALL_ELEMENT_IDS.indexOf(activeElement));
    const nextElem = ALL_ELEMENT_IDS[(currIdx + delta + ALL_ELEMENT_IDS.length) % ALL_ELEMENT_IDS.length]!;
    onPreviewElement(nextElem);
  };

  const handleUpgrade = (elemId: ElementId) => {
    if (upgradeGemLevel(elemId)) {
      onGemProgressionChanged();
      onPreviewElement(elemId);
      pulseGlitch();
    }
  };

  const handleUpgradePhantom = () => {
    if (upgradePhantomCore()) {
      onGemProgressionChanged();
      pulseGlitch();
    }
  };

  const handleShardUnlock = (elemId: ElementId) => {
    if (unlockGemWithShards(elemId)) {
      onGemProgressionChanged();
      onPreviewElement(elemId);
      pulseGlitch();
    }
  };

  const handleSelectRiderWithGlitch = (rId: RiderId) => {
    if (rId !== selectedRiderId) {
      pulseGlitch();
    }
    onSelectRider(rId);
  };

  const handleCameraPresetClick = (preset: HubCameraPreset) => {
    setCamPreset(preset);
    if (onSelectCameraPreset) {
      onSelectCameraPreset(preset);
    } else if (preset === 'full' && onResetView) {
      onResetView();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="font-game-ui pointer-events-none fixed inset-0 z-20 flex flex-col justify-between overflow-hidden select-none"
    >
      {/* Dynamic Cinematic Edge Framing Vignette + Subtle Color Rim Wash */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 transition-all duration-500"
        style={{
          background: `linear-gradient(90deg, rgba(2,6,23,0.8) 0%, rgba(2,6,23,0.22) 34%, rgba(2,6,23,0.0) 56%, rgba(2,6,23,0.5) 100%), radial-gradient(ellipse at 52% 94%, ${accentColor}24 0%, transparent 56%)`,
        }}
      />

      {/* ================= TOP TACTICAL COMMAND RIBBON ================= */}
      <motion.header
        initial={{ y: -36, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={SPRING_PANEL}
        className="pointer-events-auto relative flex items-center justify-between gap-2 border-b border-white/12 bg-gradient-to-b from-slate-950/94 via-slate-950/82 to-slate-950/35 px-4 py-2 backdrop-blur-md"
      >
        {/* Dynamic top accent laser filament */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
          animate={{
            background: `linear-gradient(90deg, ${accentColor} 0%, ${glowColor} 45%, transparent 100%)`,
          }}
          transition={{ duration: 0.35 }}
        />

        {/* Game Brand Crest + Live Hangar Status */}
        <div className="flex shrink-0 items-center gap-2.5">
          <motion.div
            key={`${selectedRiderId}-${activeElement}`}
            initial={{ scale: 0.84, rotate: -14 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={SPRING_SNAPPY}
            className="game-hex flex h-9 w-10 items-center justify-center shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${accentColor}, #0f172a)`,
              boxShadow: `0 0 22px ${accentColor}77`,
            }}
          >
            {isPhantomLocked ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2 5 6.5 8 12l-3 5.5L12 22l7-4.5-3-5.5 3-5.5L12 2Z"
                  fill="#67e8f9"
                  stroke="#ffffff"
                  strokeWidth="1.4"
                />
              </svg>
            ) : (
              <ElementEmblem id={activeElement} color="#ffffff" size={18} />
            )}
          </motion.div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-game-display text-base font-black tracking-wider text-white italic">
                K-DRIVER
              </span>
              <span
                className="game-chamfer-sm hidden items-center gap-1 px-1.5 py-0.5 text-[8px] font-black tracking-[0.18em] uppercase 2xl:inline-flex"
                style={{
                  backgroundColor: `${accentColor}28`,
                  color: glowColor,
                  border: `1px solid ${accentColor}70`,
                }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ backgroundColor: glowColor }}
                />
                HANGAR BAY-01
              </span>
            </div>
            <p className="flex items-center gap-1.5 text-[9px] font-semibold tracking-[0.18em] text-slate-400 uppercase">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
              {gamepadConnected ? 'GAMEPAD LINKED' : 'SYS.ONLINE // KBM + PAD'}
            </p>
          </div>
        </div>

        {/* Center: Mission Sector Ribbon with Cursor-Tracking BorderGlow + Shared layoutId Laser Track */}
        <div className="flex min-w-0 items-center justify-center gap-1 overflow-x-auto py-0.5">
          {STAGE_LIST.map((stage, idx) => {
            const isSelected = stage.id === selectedStageId;
            const isCleared = saveRecord.clearedStageIds.includes(stage.id);
            const modeBestRank =
              saveRecord.stageDifficultyBestRanks[
                makeStageDifficultyKey(stage.id, selectedDifficulty)
              ] ?? null;
            return (
              <motion.button
                key={stage.id}
                type="button"
                whileHover={{ y: -1.5 }}
                whileTap={{ scale: 0.96 }}
                transition={SPRING_SNAPPY}
                onMouseMove={trackBorderGlow}
                onClick={() => onSelectStage(stage.id)}
                className={`game-chamfer-sm group relative shrink-0 cursor-pointer overflow-hidden px-2.5 py-1.5 text-left transition-colors ${
                  isSelected
                    ? 'text-white'
                    : 'bg-slate-950/65 text-slate-400 hover:bg-slate-900/85 hover:text-slate-100'
                }`}
              >
                {/* Edge-Sensitive Cursor BorderGlow */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  style={{
                    background: `radial-gradient(90px circle at var(--bx, 50%) var(--by, 50%), ${stage.accentColor}44, transparent 70%)`,
                  }}
                />
                {isSelected && (
                  <motion.div
                    layoutId="hub-sector-active"
                    transition={SPRING_SNAPPY}
                    className="pointer-events-none absolute inset-0 -z-10"
                    style={{
                      background: `linear-gradient(180deg, ${stage.accentColor}30 0%, rgba(15,23,42,0.96) 100%)`,
                      borderBottom: `2px solid ${stage.accentColor}`,
                      boxShadow: `inset 0 0 18px ${stage.accentColor}30`,
                    }}
                  />
                )}
                <div className="relative z-10 flex items-center justify-between gap-1.5 text-[8px] font-bold tracking-[0.12em] uppercase">
                  <span style={{ color: stage.accentColor }}>
                    {stage.isBossRush ? '★ ENDGAME' : `SEC 0${idx + 1}`}
                  </span>
                  <span className="text-slate-400">
                    {modeBestRank ? (
                      <span
                        className={
                          modeBestRank === 'S+'
                            ? 'font-black text-amber-300'
                            : 'font-bold text-emerald-400'
                        }
                      >
                        {modeBestRank}
                      </span>
                    ) : isCleared ? (
                      <span className="text-emerald-400">CLR</span>
                    ) : (
                      `L${stage.recommendedLevel}+`
                    )}
                  </span>
                </div>
                <p className="font-game-display relative z-10 mt-0.5 whitespace-nowrap text-[9.5px] font-bold tracking-wide uppercase">
                  {stage.name}
                </p>
              </motion.button>
            );
          })}
        </div>

        {/* Right: Pilot Telemetry & Animated Shard Crystal Counter */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="hidden items-center gap-2.5 border-r border-white/10 pr-2.5 text-[10px] 2xl:flex">
            <div className="flex items-center gap-1.5">
              <div className="game-hex flex h-7 w-7 items-center justify-center bg-amber-500/20 text-xs font-black text-amber-300 ring-1 ring-amber-400/50">
                {saveRecord.bestRank ?? '—'}
              </div>
              <div className="leading-tight">
                <p className="text-[8px] tracking-widest text-slate-400 uppercase">BEST SCORE</p>
                <p className="font-game-display text-[11px] font-bold text-white">
                  {saveRecord.bestScore > 0 ? saveRecord.bestScore.toLocaleString() : '0'}
                </p>
              </div>
            </div>
            <div className="leading-tight">
              <p className="text-[8px] tracking-widest text-slate-400 uppercase">CORES</p>
              <p className="font-game-display text-[11px] font-bold text-emerald-300">
                {saveRecord.unlockedElements.length}/10
              </p>
            </div>
            <div className="leading-tight">
              <p className="text-[8px] tracking-widest text-slate-400 uppercase">CLEARS</p>
              <p className="font-game-display text-[11px] font-bold text-cyan-300">
                {saveRecord.totalClears}
              </p>
            </div>
          </div>

          <motion.div
            key={saveRecord.gemShards}
            initial={{ scale: 1.16, filter: 'brightness(1.45)' }}
            animate={{ scale: 1, filter: 'brightness(1)' }}
            transition={SPRING_SNAPPY}
            className="game-chamfer-sm flex items-center gap-2 bg-amber-500/18 px-3 py-1.5 shadow-[0_0_18px_rgba(251,191,36,0.18)]"
            style={{ border: '1px solid rgba(251, 191, 36, 0.5)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#fbbf24" aria-hidden="true">
              <polygon points="12,2 20,12 12,22 4,12" />
            </svg>
            <div className="leading-none">
              <p className="text-[8px] tracking-[0.2em] text-amber-200/80 uppercase">SHARDS</p>
              <p className="font-game-display text-sm font-black text-amber-300">
                {saveRecord.gemShards}
              </p>
            </div>
          </motion.div>
        </div>
      </motion.header>

      {/* ================= MAIN FLOATING ARMORY WORKSPACE ================= */}
      <div className="flex min-h-0 flex-1 items-stretch justify-between px-4 py-2.5 sm:px-5">
        {/* LEFT TACTICAL RAIL: Spillway Ride-Card Deck (UNIT-01) OR Interactive 3-Card Overclock Stack (UNIT-02) */}
        <div className="pointer-events-auto flex min-h-0 w-[404px] max-w-full flex-col">
          <AnimatePresence mode="wait">
            {isPhantomLocked ? (
              <motion.aside
                key="rail-phantom"
                initial={{ x: -34, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={SPRING_PANEL}
                className="flex h-full flex-col justify-between gap-2.5 pr-1"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3.5 w-1 bg-cyan-400 shadow-[0_0_10px_#22d3ee]" />
                    <h2 className="font-game-display text-[11px] font-black tracking-[0.2em] text-cyan-200 uppercase">
                      PHANTOM OVERCLOCK DECK
                    </h2>
                  </div>
                  <span className="game-chamfer-sm bg-cyan-500/20 px-2 py-0.5 text-[9px] font-black tracking-wider text-cyan-200 uppercase ring-1 ring-cyan-400/45">
                    SINGLE FORM LOCKED
                  </span>
                </div>

                {/* 3-Card Interactive Spillway Stack for UNIT-02 Signature Kit */}
                <div className="flex flex-1 flex-col justify-center">
                  <SpillwayCardDeck
                    items={PHANTOM_DECK_CARDS}
                    activeId={phantomCardId}
                    onActiveChange={(card) => setPhantomCardId(card.cardKey)}
                    cardHeight={248}
                    peekLayers={2}
                    peekGap={13}
                    peekShrink={0.052}
                    ariaLabel="UNIT-02 PHANTOM Signature Kit Card Stack"
                    renderCard={(card) => {
                      if (card.cardKey === 'katana') {
                        return (
                          <div
                            className="game-panel-bezel game-corner-brackets relative flex h-full w-full flex-col justify-between p-4"
                            style={{
                              borderLeft: '4px solid #06b6d4',
                              boxShadow: 'inset 0 0 0 1px rgba(34,211,238,0.5)',
                              background:
                                'linear-gradient(140deg, rgba(8,47,73,0.92) 0%, rgba(7,12,24,0.94) 65%, rgba(2,6,23,0.98) 100%)',
                            }}
                          >
                            <div className="animate-hud-scan pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-cyan-400/18 to-transparent" />
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="font-game-display text-[9px] font-black tracking-[0.24em] text-cyan-300 uppercase">
                                  CARD 01/03 • SIGNATURE KATANA
                                </span>
                                <span className="bg-cyan-500/20 px-1.5 py-0.5 font-game-display text-[9px] font-black text-cyan-200 ring-1 ring-cyan-400/45">
                                  LV.{phantomLevel}/{MAX_GEM_LEVEL}
                                </span>
                              </div>
                              <h3 className="font-game-display mt-2 text-lg font-black tracking-wide text-white uppercase italic">
                                {displayWeaponName}
                              </h3>
                              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300/90">
                                Obsidian-cyan plasma odachi (3.15m reach • 1.24× swift slash).
                                Applies <strong className="text-cyan-300">MARK</strong> on every
                                strike with <strong className="text-amber-300">22% CRIT</strong>.
                              </p>
                            </div>

                            <div className="space-y-2.5 border-t border-cyan-400/20 pt-2.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  {Array.from({ length: MAX_GEM_LEVEL }).map((_, p) => (
                                    <span
                                      key={p}
                                      className="h-2 w-6"
                                      style={{
                                        backgroundColor:
                                          p < phantomLevel ? '#22d3ee' : 'rgba(148,163,184,0.22)',
                                        boxShadow: p < phantomLevel ? '0 0 10px #22d3ee' : 'none',
                                      }}
                                    />
                                  ))}
                                </div>
                                <span className="font-game-display text-[11px] font-black text-emerald-300">
                                  ATK +{previewMultPct}%
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[9px] tracking-[0.18em] text-slate-400 uppercase">
                                  ⇄ DRAG / CLICK CARD TO FLIP
                                </span>
                                {phantomLevel < MAX_GEM_LEVEL ? (
                                  <motion.button
                                    type="button"
                                    data-no-drag="true"
                                    whileHover={canUpgradePhantom ? { scale: 1.05 } : undefined}
                                    whileTap={canUpgradePhantom ? { scale: 0.94 } : undefined}
                                    disabled={!canUpgradePhantom}
                                    onClick={handleUpgradePhantom}
                                    className="game-chamfer-sm cursor-pointer bg-amber-500/25 px-3 py-1 font-game-display text-[10px] font-black tracking-wider text-amber-200 ring-1 ring-amber-400/65 hover:bg-amber-500/45 disabled:cursor-not-allowed disabled:opacity-35"
                                  >
                                    UPGRADE +{phantomUpgradeCost}◆
                                  </motion.button>
                                ) : (
                                  <span className="game-chamfer-sm bg-emerald-500/20 px-2.5 py-1 text-[9px] font-black text-emerald-300">
                                    MAX LV.5
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (card.cardKey === 'fox') {
                        return (
                          <div
                            className="game-panel-bezel game-corner-brackets relative flex h-full w-full flex-col justify-between p-4"
                            style={{
                              borderLeft: '4px solid #38bdf8',
                              boxShadow: 'inset 0 0 0 1px rgba(56,189,248,0.48)',
                              background:
                                'linear-gradient(140deg, rgba(12,74,110,0.9) 0%, rgba(7,12,24,0.95) 68%, rgba(2,6,23,0.98) 100%)',
                            }}
                          >
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="font-game-display text-[9px] font-black tracking-[0.24em] text-sky-300 uppercase">
                                  CARD 02/03 • CONTRACT BEAST [E]
                                </span>
                                <span className="flex items-center gap-1 bg-sky-500/20 px-2 py-0.5 text-[9px] font-black text-sky-200 ring-1 ring-sky-400/45">
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
                                  9-BONE RIG
                                </span>
                              </div>
                              <h3 className="font-game-display mt-2 text-lg font-black tracking-wide text-white uppercase italic">
                                {displayPetName}
                              </h3>
                              <p className="mt-1.5 text-[11px] font-semibold text-cyan-200">
                                Passive: {displayPetPassive}
                              </p>
                              <p className="mt-1 text-[10.5px] leading-relaxed text-slate-300/85">
                                Pounces for 2.15× MARK burst, then sprints alongside Unit-02 for
                                18s firing cyan Fox-Fire Plasma Bolts. Transforms into a Giant
                                Spectral Fox during [R] PHANTOM OMNISLASH.
                              </p>
                            </div>
                            <div className="flex items-center justify-between border-t border-sky-400/20 pt-2 text-[9px] tracking-[0.18em] text-slate-400 uppercase">
                              <span>SUMMON CD: 20s • 18s ACTIVE</span>
                              <span className="text-sky-300">⇄ DRAG TO FLIP</span>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          className="game-panel-bezel game-corner-brackets relative flex h-full w-full flex-col justify-between p-4"
                          style={{
                            borderLeft: '4px solid #f43f5e',
                            boxShadow: 'inset 0 0 0 1px rgba(244,63,94,0.45)',
                            background:
                              'linear-gradient(140deg, rgba(76,5,25,0.88) 0%, rgba(10,17,34,0.95) 62%, rgba(2,6,23,0.98) 100%)',
                          }}
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="font-game-display text-[9px] font-black tracking-[0.24em] text-rose-300 uppercase">
                                CARD 03/03 • 2-FORM MATRIX
                              </span>
                              <span className="text-[9px] font-black text-cyan-300 uppercase">
                                NO ELEMENT SWAP
                              </span>
                            </div>
                            <div className="mt-2.5 grid grid-cols-2 gap-2 text-[10px]">
                              <div className="game-chamfer-sm bg-slate-900/90 p-2 ring-1 ring-cyan-400/35">
                                <p className="text-[8px] font-black tracking-widest text-cyan-300 uppercase">
                                  FORM 01 • BASE
                                </p>
                                <p className="font-game-display mt-0.5 text-[11px] font-bold text-white uppercase">
                                  BASIC FORM
                                </p>
                                <p className="mt-0.5 text-[9px] text-slate-400">
                                  10.0 m/s • 2.15× Counter
                                </p>
                              </div>
                              <div className="game-chamfer-sm bg-cyan-950/65 p-2 ring-1 ring-cyan-300/60">
                                <p className="text-[8px] font-black tracking-widest text-rose-300 uppercase">
                                  FORM 02 • [F]
                                </p>
                                <p className="font-game-display mt-0.5 text-[11px] font-bold text-cyan-200 uppercase">
                                  UPGRADED FORM
                                </p>
                                <p className="mt-0.5 text-[9px] text-cyan-100/80">
                                  +40% DMG • 38s
                                </p>
                              </div>
                            </div>
                            <div className="mt-2.5 space-y-1 text-[10px] text-slate-300">
                              <div className="flex justify-between">
                                <span>
                                  <strong className="text-amber-300">[Q]</strong> {displaySkillName}
                                </span>
                                <span className="text-slate-400">5.5s CD</span>
                              </div>
                              <div className="flex justify-between">
                                <span>
                                  <strong className="text-rose-300">[R]</strong> PHANTOM OMNISLASH
                                </span>
                                <span className="text-cyan-300">6 Clones + Cage</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between border-t border-rose-400/20 pt-2 text-[9px] tracking-[0.18em] text-slate-400 uppercase">
                            <span>SINGLE-FORM ASSASSIN</span>
                            <span className="text-rose-300">⇄ DRAG TO FLIP</span>
                          </div>
                        </div>
                      );
                    }}
                  />

                  {/* 3-Card Quick-Select Tabs */}
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {PHANTOM_DECK_CARDS.map((card) => {
                      const active = phantomCardId === card.cardKey;
                      return (
                        <motion.button
                          key={card.id}
                          type="button"
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setPhantomCardId(card.cardKey)}
                          className={`game-chamfer-sm relative cursor-pointer py-1.5 font-game-display text-[9.5px] font-black tracking-wider uppercase transition-colors ${
                            active
                              ? 'text-slate-950'
                              : 'bg-slate-950/80 text-slate-400 ring-1 ring-white/10 hover:text-white'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="phantom-card-tab"
                              transition={SPRING_SNAPPY}
                              className="pointer-events-none absolute inset-0 -z-10"
                              style={{
                                backgroundColor: card.glowColor,
                                boxShadow: `0 0 14px ${card.accentColor}88`,
                              }}
                            />
                          )}
                          {card.label}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* Fixed Single Form Info Strip */}
                <div className="game-chamfer-sm game-panel-bezel p-3 ring-1 ring-cyan-400/20">
                  <div className="flex items-center justify-between text-[9.5px] font-bold tracking-wider uppercase">
                    <span className="text-cyan-300">PHANTOM CORE LOCK</span>
                    <span className="text-rose-300">NO 10-ELEMENT SWAP</span>
                  </div>
                  <p className="mt-1 text-[9.5px] leading-relaxed text-slate-300/85">
                    UNIT-02 PHANTOM bertarung dengan 1 wujud tetap + Kurokage Cyber Katana &
                    Kitsune-02 Fox. Pilih <strong className="text-rose-300">UNIT-01 NEXUS</strong>{' '}
                    di kanan untuk mengakses 10 Elemental Ride-Cards.
                  </p>
                </div>
              </motion.aside>
            ) : (
              <motion.aside
                key="rail-nexus"
                initial={{ x: -34, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={SPRING_PANEL}
                className="flex h-full flex-col justify-between gap-2.5 pr-1"
              >
                {/* SECTION 1: ACTIVE K-DRIVER BELT SLOTS [1] [2] [3] */}
                <section className="relative flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3.5 w-1"
                        style={{
                          backgroundColor: accentColor,
                          boxShadow: `0 0 10px ${accentColor}`,
                        }}
                      />
                      <h2 className="font-game-display text-[11px] font-black tracking-[0.2em] text-white uppercase">
                        DRIVER BELT DECK
                      </h2>
                    </div>
                    <span className="text-[9.5px] font-black tracking-wider text-amber-300 uppercase">
                      SLOT [{editingSlot + 1}] ARMED
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {loadoutOrder.map((elemId, idx) => {
                      const cfg = getElementConfig(elemId);
                      const level = getGemLevel(saveRecord, elemId);
                      const isEditing = editingSlot === idx;
                      const isPreviewing = activeElement === elemId;
                      const darkBadgeText =
                        elemId === 'volt' || elemId === 'lux' || elemId === 'solar';

                      return (
                        <motion.div
                          key={`${elemId}-${idx}`}
                          whileHover={{ x: 4 }}
                          whileTap={{ scale: 0.985 }}
                          transition={SPRING_SNAPPY}
                          onMouseMove={trackBorderGlow}
                          onClick={() => {
                            setEditingSlot(idx as 0 | 1 | 2);
                            onPreviewElement(elemId);
                          }}
                          className="game-chamfer-sm game-panel-bezel group relative flex cursor-pointer items-center justify-between overflow-hidden px-2.5 py-1.5"
                          style={{
                            borderLeft: `4px solid ${cfg.primaryColor}`,
                            boxShadow: isEditing
                              ? `inset 0 0 0 1px ${cfg.primaryColor}bb, 0 0 22px ${cfg.primaryColor}38`
                              : isPreviewing
                                ? `inset 0 0 0 1px rgba(56,189,248,0.5)`
                                : 'inset 0 0 0 1px rgba(148,163,184,0.16)',
                          }}
                        >
                          {/* Cursor-Tracking Edge BorderGlow */}
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                            style={{
                              background: `radial-gradient(150px circle at var(--bx, 50%) var(--by, 50%), ${cfg.emissiveColor}28, transparent 72%)`,
                            }}
                          />
                          {isEditing && (
                            <motion.span
                              layoutId="belt-slot-rail"
                              transition={SPRING_SNAPPY}
                              className="pointer-events-none absolute inset-y-0 right-0 w-1.5"
                              style={{
                                backgroundColor: cfg.emissiveColor,
                                boxShadow: `0 0 14px ${cfg.emissiveColor}`,
                              }}
                            />
                          )}
                          {isEditing && (
                            <span
                              className="animate-henshin-sheen pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/14 to-transparent"
                              aria-hidden="true"
                            />
                          )}

                          <div className="relative z-10 flex min-w-0 items-center gap-2.5">
                            <div
                              className="flex h-8 w-7 shrink-0 -skew-x-12 items-center justify-center font-game-display text-xs font-black shadow"
                              style={{
                                backgroundColor: cfg.primaryColor,
                                color: darkBadgeText ? '#0f172a' : '#ffffff',
                                boxShadow: `0 0 14px ${cfg.primaryColor}70`,
                              }}
                            >
                              <span className="skew-x-12">{idx + 1}</span>
                            </div>

                            <ElementEmblem id={elemId} color={cfg.primaryColor} size={18} />

                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-game-display truncate text-xs font-bold tracking-wide text-white uppercase">
                                  {cfg.name}
                                </span>
                                <div
                                  className="flex items-center gap-0.5"
                                  title={`Level ${level}/${MAX_GEM_LEVEL}`}
                                >
                                  {Array.from({ length: MAX_GEM_LEVEL }).map((_, p) => (
                                    <span
                                      key={p}
                                      className="h-1.5 w-1.5"
                                      style={{
                                        backgroundColor:
                                          p < level ? cfg.emissiveColor : 'rgba(148,163,184,0.22)',
                                        boxShadow:
                                          p < level ? `0 0 6px ${cfg.emissiveColor}` : 'none',
                                      }}
                                    />
                                  ))}
                                </div>
                                <span className="text-[9px] font-bold tracking-wider text-slate-400">
                                  {formatArchetype(cfg.weapon.archetype)}
                                </span>
                              </div>
                              <p className="truncate text-[10px] text-slate-300/85">
                                {cfg.weapon.name} <span className="text-slate-500">//</span>{' '}
                                <span className="text-cyan-300">{cfg.pet.name}</span>
                              </p>
                            </div>
                          </div>

                          <div className="relative z-10 mr-1 flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveSlot(idx, -1);
                              }}
                              className="cursor-pointer bg-slate-900/90 px-1.5 py-0.5 text-[9px] text-slate-300 ring-1 ring-white/10 hover:bg-cyan-500/25 hover:text-white disabled:cursor-default disabled:opacity-25"
                              title="Move Up"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={idx === 2}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveSlot(idx, 1);
                              }}
                              className="cursor-pointer bg-slate-900/90 px-1.5 py-0.5 text-[9px] text-slate-300 ring-1 ring-white/10 hover:bg-cyan-500/25 hover:text-white disabled:cursor-default disabled:opacity-25"
                              title="Move Down"
                            >
                              ▼
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </section>

                {/* SECTION 2: SPILLWAY RIDE-CARD DECK (Stacked 3D Physics Elemental Core Cards + Quick-Jump Bar!) */}
                <section className="flex flex-1 flex-col justify-end gap-2">
                  <div className="flex items-center justify-between px-0.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3.5 w-1 bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
                      <h2 className="font-game-display text-[11px] font-black tracking-[0.2em] text-amber-200 uppercase">
                        ELEMENTAL RIDE-DECK
                      </h2>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => cycleElementDeck(-1)}
                        className="game-chamfer-sm cursor-pointer bg-slate-900/90 px-2 py-0.5 font-game-display text-[9px] font-bold text-slate-300 ring-1 ring-white/12 hover:bg-slate-800 hover:text-white"
                        title="Previous Ride-Card"
                      >
                        ◀
                      </button>
                      <span className="px-1 font-mono text-[9px] font-bold text-slate-300">
                        {String(ALL_ELEMENT_IDS.indexOf(activeElement) + 1).padStart(2, '0')}/10
                      </span>
                      <button
                        type="button"
                        onClick={() => cycleElementDeck(1)}
                        className="game-chamfer-sm cursor-pointer bg-slate-900/90 px-2 py-0.5 font-game-display text-[9px] font-bold text-slate-300 ring-1 ring-white/12 hover:bg-slate-800 hover:text-white"
                        title="Next Ride-Card"
                      >
                        ▶
                      </button>
                    </div>
                  </div>

                  {/* Spillway 240Hz Physics Stacked Ride-Cards */}
                  <SpillwayCardDeck
                    items={elementDeckItems}
                    activeId={activeElement}
                    onActiveChange={(card) => onPreviewElement(card.elemId)}
                    cardHeight={184}
                    peekLayers={3}
                    peekGap={10}
                    peekShrink={0.048}
                    ariaLabel="Elemental Cores Spillway Ride-Card Deck"
                    renderCard={(card) => {
                      const cfg = getElementConfig(card.elemId);
                      const unlocked = isElementUnlocked(saveRecord, card.elemId);
                      const level = getGemLevel(saveRecord, card.elemId);
                      const upgradeCost = getGemUpgradeCost(level);
                      const equippedIdx = loadoutOrder.indexOf(card.elemId);
                      const isEquipped = equippedIdx >= 0;
                      const canUpgrade =
                        unlocked && level < MAX_GEM_LEVEL && saveRecord.gemShards >= upgradeCost;
                      const canUnlock =
                        !unlocked && saveRecord.gemShards >= GEM_SHARD_UNLOCK_COST;

                      return (
                        <div
                          className={`relative flex h-full w-full flex-col justify-between p-3.5 ${
                            unlocked ? '' : 'grayscale-[45%]'
                          }`}
                          style={{
                            borderLeft: `4px solid ${unlocked ? cfg.primaryColor : '#475569'}`,
                            boxShadow: `inset 0 0 0 1px ${cfg.primaryColor}99`,
                            background: `linear-gradient(135deg, ${cfg.primaryColor}40 0%, rgba(8,14,28,0.96) 44%, #040914 100%)`,
                          }}
                        >
                          {/* Subtle Diagonal Holographic Foil Watermark Emblem */}
                          <div className="pointer-events-none absolute -right-4 -bottom-4 opacity-14">
                            <ElementEmblem id={card.elemId} color={cfg.emissiveColor} size={112} />
                          </div>

                          {/* Card Top Bar */}
                          <div className="relative z-10 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="font-game-display text-[9px] font-black tracking-[0.22em] uppercase"
                                style={{ color: cfg.emissiveColor }}
                              >
                                RIDE-CORE #{String(card.indexNum).padStart(2, '0')}
                              </span>
                              <span className="bg-slate-950/75 px-1.5 py-0.5 text-[8.5px] font-bold tracking-wider text-slate-300 uppercase ring-1 ring-white/10">
                                {formatArchetype(cfg.weapon.archetype)}
                              </span>
                            </div>

                            {isEquipped ? (
                              <span
                                className="game-chamfer-sm px-2 py-0.5 font-game-display text-[9px] font-black tracking-wider uppercase"
                                style={{
                                  backgroundColor: `${cfg.primaryColor}40`,
                                  color: cfg.emissiveColor,
                                  boxShadow: `0 0 12px ${cfg.primaryColor}55`,
                                }}
                              >
                                SLOT [{equippedIdx + 1}] ARMED
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                                {unlocked ? cfg.statusApplied : 'LOCKED'}
                              </span>
                            )}
                          </div>

                          {/* Card Hero Content */}
                          <div className="relative z-10 my-1 flex items-center gap-3">
                            <div
                              className="game-hex flex h-12 w-13 shrink-0 items-center justify-center shadow-lg"
                              style={{
                                background: `linear-gradient(135deg, ${cfg.primaryColor}, #0f172a)`,
                                boxShadow: `0 0 22px ${cfg.primaryColor}80`,
                              }}
                            >
                              <ElementEmblem id={card.elemId} color="#ffffff" size={24} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="font-game-display truncate text-base font-black tracking-wide text-white uppercase italic">
                                {cfg.name}
                              </h3>
                              <p className="truncate text-[10.5px] font-semibold text-slate-200">
                                {cfg.weapon.name} <span className="text-slate-500">//</span>{' '}
                                <span className="text-cyan-300">{cfg.pet.name}</span>
                              </p>
                              <div className="mt-1 flex items-center gap-1.5">
                                {Array.from({ length: MAX_GEM_LEVEL }).map((_, p) => (
                                  <span
                                    key={p}
                                    className="h-1.5 w-4"
                                    style={{
                                      backgroundColor:
                                        unlocked && p < level
                                          ? cfg.emissiveColor
                                          : 'rgba(148,163,184,0.2)',
                                      boxShadow:
                                        unlocked && p < level
                                          ? `0 0 6px ${cfg.emissiveColor}`
                                          : 'none',
                                    }}
                                  />
                                ))}
                                <span className="ml-1 font-mono text-[9.5px] font-bold text-amber-300">
                                  LV.{level}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Interactive Action Triggers (data-no-drag prevents accidental card throw!) */}
                          <div className="relative z-10 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
                            {unlocked ? (
                              <>
                                <motion.button
                                  type="button"
                                  data-no-drag="true"
                                  whileHover={{ scale: 1.03 }}
                                  whileTap={{ scale: 0.95 }}
                                  onClick={() => equipElementToSlot(card.elemId)}
                                  className="game-chamfer-sm flex-1 cursor-pointer py-1.5 font-game-display text-[9.5px] font-black tracking-[0.14em] uppercase transition-colors"
                                  style={{
                                    backgroundColor: isEquipped
                                      ? 'rgba(15,23,42,0.88)'
                                      : cfg.primaryColor,
                                    color: isEquipped ? cfg.emissiveColor : '#ffffff',
                                    border: `1px solid ${cfg.emissiveColor}88`,
                                    boxShadow: isEquipped
                                      ? 'none'
                                      : `0 0 16px ${cfg.primaryColor}66`,
                                  }}
                                >
                                  {isEquipped
                                    ? `ACTIVE IN SLOT [${equippedIdx + 1}]`
                                    : `EQUIP → SLOT [${editingSlot + 1}]`}
                                </motion.button>

                                {level < MAX_GEM_LEVEL ? (
                                  <motion.button
                                    type="button"
                                    data-no-drag="true"
                                    whileHover={canUpgrade ? { scale: 1.05 } : undefined}
                                    whileTap={canUpgrade ? { scale: 0.94 } : undefined}
                                    disabled={!canUpgrade}
                                    onClick={() => handleUpgrade(card.elemId)}
                                    className="game-chamfer-sm shrink-0 cursor-pointer bg-amber-500/22 px-2.5 py-1.5 font-game-display text-[9.5px] font-black tracking-wider text-amber-200 ring-1 ring-amber-400/55 hover:bg-amber-500/45 disabled:cursor-not-allowed disabled:opacity-35"
                                  >
                                    +{upgradeCost}◆
                                  </motion.button>
                                ) : (
                                  <span className="game-chamfer-sm shrink-0 bg-emerald-500/20 px-2.5 py-1.5 font-game-display text-[9px] font-black text-emerald-300">
                                    MAX
                                  </span>
                                )}
                              </>
                            ) : (
                              <motion.button
                                type="button"
                                data-no-drag="true"
                                whileTap={canUnlock ? { scale: 0.95 } : undefined}
                                disabled={!canUnlock}
                                onClick={() => handleShardUnlock(card.elemId)}
                                className="game-chamfer-sm w-full cursor-pointer bg-violet-500/28 py-1.5 font-game-display text-[10px] font-black tracking-widest text-violet-200 ring-1 ring-violet-400/50 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                UNLOCK CORE ({GEM_SHARD_UNLOCK_COST}◆)
                              </motion.button>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />

                  {/* 10-Element Quick-Jump Ribbon (1-Click Spillway Fling + Live Preview!) */}
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="grid grid-cols-5 gap-1">
                      {ALL_ELEMENT_IDS.map((elemId) => {
                        const cfg = getElementConfig(elemId);
                        const unlocked = isElementUnlocked(saveRecord, elemId);
                        const isPreviewing = activeElement === elemId;
                        const equippedIdx = loadoutOrder.indexOf(elemId);
                        const isEquipped = equippedIdx >= 0;

                        return (
                          <motion.button
                            key={elemId}
                            type="button"
                            whileHover={{ y: -1.5, scale: 1.04 }}
                            whileTap={{ scale: 0.93 }}
                            transition={SPRING_SNAPPY}
                            onClick={() => onPreviewElement(elemId)}
                            className={`game-chamfer-sm relative flex cursor-pointer items-center justify-center gap-1 py-1.5 text-[8.5px] font-black tracking-wider uppercase transition-colors ${
                              isPreviewing
                                ? 'bg-slate-900 text-white'
                                : unlocked
                                  ? 'bg-slate-950/80 text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                                  : 'bg-slate-950/60 text-slate-600 opacity-60'
                            }`}
                            style={{
                              boxShadow: isPreviewing
                                ? `inset 0 0 0 1.5px ${cfg.emissiveColor}, 0 0 12px ${cfg.primaryColor}55`
                                : isEquipped
                                  ? `inset 0 -2px 0 0 ${cfg.primaryColor}`
                                  : 'inset 0 0 0 1px rgba(148,163,184,0.14)',
                            }}
                            title={`${cfg.name} — Click to bring card to front`}
                          >
                            <ElementEmblem
                              id={elemId}
                              color={unlocked ? cfg.primaryColor : '#64748b'}
                              size={12}
                            />
                            <span className="truncate">{elemId}</span>
                            {isEquipped && (
                              <span
                                className="absolute top-0.5 right-1 h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: cfg.emissiveColor }}
                              />
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                    <p className="text-center text-[8.5px] font-bold tracking-[0.2em] text-slate-400/90 uppercase">
                      ⇄ DRAG / THROW / SCROLL CARD DECK • CLICK ICON TO JUMP
                    </p>
                  </div>
                </section>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>

        {/* CENTER: OPEN 3D HOLOGRAPHIC RIDER SHOWCASE VIEWPORT (Diegetic Brackets + ShimmerText + Camera Rig) */}
        <div className="pointer-events-none relative hidden flex-1 lg:block">
          {/* Subtle Diegetic Viewfinder Corner Brackets flanking the 3D Hero */}
          <div className="pointer-events-none absolute inset-x-10 top-6 bottom-16 opacity-45">
            <span
              className="absolute top-0 left-0 h-5 w-5 border-t-2 border-l-2"
              style={{ borderColor: glowColor }}
            />
            <span
              className="absolute top-0 right-0 h-5 w-5 border-t-2 border-r-2"
              style={{ borderColor: glowColor }}
            />
            <span
              className="absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2"
              style={{ borderColor: glowColor }}
            />
            <span
              className="absolute right-0 bottom-0 h-5 w-5 border-r-2 border-b-2"
              style={{ borderColor: glowColor }}
            />
          </div>

          {/* Animated Center Rider Designation Header with ShimmerTextFX */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${selectedRiderId}-${displayPedestalSubtitle}`}
                initial={{ y: -10, opacity: 0, scale: 0.94 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 8, opacity: 0, scale: 0.96 }}
                transition={SPRING_SNAPPY}
                className="flex flex-col items-center"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-[1px] w-7 opacity-70"
                    style={{ backgroundColor: glowColor }}
                  />
                  <p className="text-[9px] font-black tracking-[0.34em] text-slate-200/90 uppercase drop-shadow">
                    {riderConfig.codeName} // {riderConfig.name}
                  </p>
                  <span
                    className="h-[1px] w-7 opacity-70"
                    style={{ backgroundColor: glowColor }}
                  />
                </div>
                <ShimmerText
                  color={glowColor}
                  shimmerColor="#ffffff"
                  className="font-game-display mt-0.5 text-base font-black tracking-[0.24em] uppercase italic"
                  style={{ filter: `drop-shadow(0 0 14px ${accentColor}aa)` }}
                >
                  {displayPedestalSubtitle}
                </ShimmerText>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Interactive 3D Camera Inspection Dock (Quick Angle Presets + Orbit Hint) */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ ...SPRING_PANEL, delay: 0.12 }}
            className="game-chamfer-sm pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 bg-slate-950/78 px-3 py-1.5 text-[9.5px] font-bold tracking-[0.16em] text-slate-300 uppercase ring-1 ring-white/14 backdrop-blur-md"
          >
            <div className="flex items-center gap-1 border-r border-white/12 pr-2">
              {CAMERA_PRESETS.map((p) => {
                const active = camPreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleCameraPresetClick(p.id)}
                    className={`relative cursor-pointer px-2 py-0.5 font-game-display text-[9px] font-black tracking-wider uppercase transition-colors ${
                      active ? 'text-slate-950' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="hub-cam-preset"
                        transition={SPRING_SNAPPY}
                        className="absolute inset-0 -z-10"
                        style={{
                          backgroundColor: glowColor,
                          boxShadow: `0 0 12px ${accentColor}99`,
                        }}
                      />
                    )}
                    {p.label}
                  </button>
                );
              })}
            </div>
            <span className="text-cyan-300">⟳ DRAG</span>
            <span className="text-slate-600">•</span>
            <span className="text-amber-300">⊕ ZOOM</span>
            {onResetView && (
              <>
                <span className="text-slate-600">•</span>
                <button
                  type="button"
                  onClick={() => handleCameraPresetClick('full')}
                  className="cursor-pointer text-slate-200 transition-colors hover:text-white"
                  title="Reset 3D Camera View"
                >
                  RESET
                </button>
              </>
            )}
          </motion.div>
        </div>

        {/* RIGHT TACTICAL INTEL + SPOTLIGHT BORDER-BEAM DOSSIER + MAGNETIC GLOW DEPLOY */}
        <motion.div
          initial={{ x: 36, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={SPRING_PANEL}
          className="pointer-events-auto flex w-[348px] max-w-full flex-col justify-end gap-2"
        >
          {/* Playable Rider Selector with BorderGlow + Sliding layoutId Neon Plate */}
          <div
            className="game-chamfer-sm game-panel-bezel p-2.5 ring-1 ring-white/10"
            style={{ borderRight: `3px solid ${riderConfig.accentColor}` }}
          >
            <div className="flex items-center justify-between px-0.5">
              <span className="font-game-display text-[9px] font-black tracking-[0.22em] text-slate-300 uppercase">
                RIDER UNIT
              </span>
              <span
                className="text-[9px] font-black tracking-wider uppercase"
                style={{ color: riderConfig.glowColor }}
              >
                {riderConfig.roleTag}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {RIDER_LIST.map((r) => {
                const active = r.id === selectedRiderId;
                return (
                  <motion.button
                    key={r.id}
                    type="button"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    transition={SPRING_SNAPPY}
                    onMouseMove={trackBorderGlow}
                    onClick={() => handleSelectRiderWithGlitch(r.id)}
                    className={`game-chamfer-sm group relative cursor-pointer overflow-hidden px-2.5 py-1.5 text-left transition-colors ${
                      active
                        ? 'text-white'
                        : 'bg-slate-950/75 text-slate-400 hover:bg-slate-900/90 hover:text-slate-100'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      style={{
                        background: `radial-gradient(100px circle at var(--bx, 50%) var(--by, 50%), ${r.glowColor}35, transparent 70%)`,
                      }}
                    />
                    {active && (
                      <motion.div
                        layoutId="rider-unit-highlight"
                        transition={SPRING_SNAPPY}
                        className="pointer-events-none absolute inset-0 -z-10"
                        style={{
                          background: `linear-gradient(125deg, ${r.accentColor}38 0%, rgba(15,23,42,0.96) 100%)`,
                          borderLeft: `3px solid ${r.accentColor}`,
                          boxShadow: `inset 0 0 0 1px ${r.accentColor}99, 0 0 16px ${r.accentColor}38`,
                        }}
                      />
                    )}
                    <div className="relative z-10 flex items-center justify-between text-[8px] font-black tracking-[0.14em] uppercase">
                      <span style={{ color: r.glowColor }}>{r.codeName}</span>
                      <span className="text-slate-400">{r.maxForms} FORMS</span>
                    </div>
                    <p className="font-game-display relative z-10 mt-0.5 truncate text-[10px] font-black tracking-wide uppercase">
                      {r.shortName}
                    </p>
                  </motion.button>
                );
              })}
            </div>
            <div className="mt-1.5 flex items-center justify-between px-0.5 text-[9px] text-slate-300/90">
              <span className="truncate">{riderConfig.passiveSummary}</span>
              <span className="ml-2 shrink-0 font-bold text-emerald-300">{riderConfig.maxHp} HP</span>
            </div>
          </div>

          {/* Active Form Combat Dossier wrapped in Spotlight + Traveling Border Beam + Holo Glitch Flash */}
          <SpotlightBeamPanel
            accentColor={accentColor}
            glowColor={glowColor}
            className="game-scanlines game-corner-brackets p-3"
          >
            <HoloGlitchFlash
              triggerKey={`${selectedRiderId}-${displayWeaponName}-${glitchSeq}`}
              accentColor={accentColor}
            />

            <AnimatePresence mode="wait">
              <motion.div
                key={`${selectedRiderId}-${displayWeaponName}-${previewLevel}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.16 }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-bold tracking-[0.24em] text-cyan-300 uppercase">
                      ARMAMENT SPECS • LV.{previewLevel}
                    </p>
                    <h2 className="font-game-display mt-0.5 text-base font-black tracking-wide text-white uppercase italic">
                      {displayWeaponName}
                    </h2>
                  </div>
                  <span
                    className="game-chamfer-sm shrink-0 px-2 py-0.5 text-[9px] font-black tracking-widest uppercase"
                    style={{
                      backgroundColor: `${accentColor}2b`,
                      color: glowColor,
                      border: `1px solid ${accentColor}77`,
                    }}
                  >
                    {displayWeaponTag}
                  </span>
                </div>

                {/* Live Animated Weapon Telemetry Bars */}
                <div className="mt-2 grid grid-cols-3 gap-2 border-y border-white/10 py-1.5 text-[8.5px]">
                  <div>
                    <div className="flex justify-between font-bold text-slate-300">
                      <span>POWER</span>
                      <span className="text-emerald-300">+{previewMultPct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden bg-slate-900">
                      <motion.div
                        initial={false}
                        animate={{ width: `${statPowerPct}%` }}
                        transition={SPRING_SNAPPY}
                        className="h-full"
                        style={{
                          background: `linear-gradient(90deg, ${accentColor}, ${glowColor})`,
                          boxShadow: `0 0 8px ${accentColor}`,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between font-bold text-slate-300">
                      <span>SPEED</span>
                      <span className="text-cyan-300">
                        {(activeWeaponCfg.attackSpeed * riderConfig.attackSpeedMult).toFixed(2)}×
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden bg-slate-900">
                      <motion.div
                        initial={false}
                        animate={{ width: `${statSpeedPct}%` }}
                        transition={SPRING_SNAPPY}
                        className="h-full bg-gradient-to-r from-cyan-500 to-sky-300"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between font-bold text-slate-300">
                      <span>{isPhantomLocked ? 'CRIT' : 'REACH'}</span>
                      <span className="text-amber-300">
                        {isPhantomLocked
                          ? `${Math.round(riderConfig.baseCritChance * 100)}%`
                          : `${activeWeaponCfg.range.toFixed(1)}m`}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden bg-slate-900">
                      <motion.div
                        initial={false}
                        animate={{ width: `${statReachOrCritPct}%` }}
                        transition={SPRING_SNAPPY}
                        className="h-full bg-gradient-to-r from-amber-500 to-yellow-300"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Combat Arts Keybinds */}
            <div className="mt-2 space-y-1.5 text-[10.5px]">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-amber-500/20 font-game-display text-[10px] font-black text-amber-300 ring-1 ring-amber-400/50">
                  Q
                </span>
                <span className="truncate text-slate-200">
                  <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                    SKILL{' '}
                  </span>
                  {displaySkillName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-cyan-500/20 font-game-display text-[10px] font-black text-cyan-300 ring-1 ring-cyan-400/50">
                  E
                </span>
                <span className="truncate text-slate-200">
                  <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                    PET{' '}
                  </span>
                  {displayPetName}{' '}
                  <span className="text-[9.5px] text-cyan-300/80">({displayPetPassive})</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-amber-400/20 font-game-display text-[10px] font-black text-amber-200 ring-1 ring-amber-300/50">
                  F
                </span>
                <span className="truncate text-slate-200">
                  <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                    HENSHIN{' '}
                  </span>
                  {riderConfig.hasUltimateForm
                    ? 'Super (32s) → Ultimate (25s)'
                    : 'Upgraded Form (38s • +40% DMG)'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-rose-500/20 font-game-display text-[10px] font-black text-rose-300 ring-1 ring-rose-400/50">
                  R
                </span>
                <span className="truncate text-slate-200">
                  <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                    FINISH{' '}
                  </span>
                  {riderConfig.signatureFinisherName ?? previewConfig.finisherName}
                </span>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-1.5 text-[9px] tracking-wide text-slate-400">
              <span className="truncate">
                <span className="font-bold text-slate-300 uppercase">STATUS: </span>
                <span className="font-black" style={{ color: glowColor }}>
                  {displayStatus}
                </span>
                {' • '}
                {isPhantomLocked ? 'FIXED SINGLE FORM' : 'REACTION READY'}
              </span>
            </div>
          </SpotlightBeamPanel>

          {/* DIFFICULTY SELECTOR + MISSION BRIEF + MAGNETIC GLOW DEPLOY BUTTON */}
          <div className="flex flex-col gap-1.5">
            <div className="game-chamfer-sm game-panel-bezel p-2.5 ring-1 ring-white/10">
              <div className="flex items-center justify-between px-0.5">
                <span className="font-game-display text-[9px] font-black tracking-[0.22em] text-slate-300 uppercase">
                  HAZARD LEVEL
                </span>
                <span
                  className="text-[9px] font-black tracking-wider uppercase"
                  style={{ color: diffConfig.accentColor }}
                >
                  {diffConfig.shardRewardMult}× SHARDS
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-4 gap-1">
                {DIFFICULTY_LIST.map((diff) => {
                  const active = diff.id === selectedDifficulty;
                  return (
                    <motion.button
                      key={diff.id}
                      type="button"
                      whileTap={{ scale: 0.94 }}
                      onMouseMove={trackBorderGlow}
                      onClick={() => onSelectDifficulty(diff.id)}
                      className={`game-chamfer-sm group relative cursor-pointer overflow-hidden py-1.5 font-game-display text-[10px] font-black tracking-wider uppercase transition-colors ${
                        active
                          ? 'text-slate-950'
                          : 'bg-slate-950/75 text-slate-400 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      {!active && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                          style={{
                            background: `radial-gradient(64px circle at var(--bx, 50%) var(--by, 50%), ${diff.accentColor}44, transparent 70%)`,
                          }}
                        />
                      )}
                      {active && (
                        <motion.span
                          layoutId="hazard-active-plate"
                          transition={SPRING_SNAPPY}
                          className="pointer-events-none absolute inset-0 -z-10"
                          style={{
                            backgroundColor: diff.accentColor,
                            boxShadow: `0 0 16px ${diff.accentColor}99`,
                          }}
                        />
                      )}
                      <span className="relative z-10">{diff.label}</span>
                    </motion.button>
                  );
                })}
              </div>
              <p className="mt-1.5 truncate px-0.5 text-[9px] text-slate-300/85">
                {diffConfig.tagline}
              </p>
            </div>

            <div className="flex items-center justify-between px-2 text-[10px]">
              <span className="truncate font-bold tracking-wider text-slate-200 uppercase">
                <span style={{ color: selectedStage.accentColor }}>▸ </span>
                {selectedStage.name}
              </span>
              <span className="shrink-0 font-bold text-amber-300">+{scaledShardPreview} ◆</span>
            </div>

            <MagneticGlowButton
              disabled={engineStatus !== 'ready'}
              onClick={onDeploy}
              accentColor={isPhantomLocked ? '#06b6d4' : '#f43f5e'}
              glowColor={isPhantomLocked ? '#67e8f9' : '#fde047'}
              gradient={
                isPhantomLocked
                  ? 'linear-gradient(105deg, #0284c7 0%, #06b6d4 48%, #e11d48 100%)'
                  : 'linear-gradient(105deg, #e11d48 0%, #f97316 52%, #f59e0b 100%)'
              }
              className="w-full px-6 py-3.5 text-center"
            >
              <span className="font-game-display flex items-center justify-center gap-2.5 text-sm font-black tracking-[0.22em] text-white uppercase italic drop-shadow">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
                </svg>
                {engineStatus === 'ready'
                  ? isPhantomLocked
                    ? 'DEPLOY // OVERCLOCK!'
                    : 'DEPLOY // HENSHIN!'
                  : 'INITIALIZING DRIVER...'}
              </span>
            </MagneticGlowButton>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

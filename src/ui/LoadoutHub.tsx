import { useState } from 'react';
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

const SPRING_SNAPPY = { type: 'spring' as const, stiffness: 460, damping: 32, mass: 0.8 };
const SPRING_PANEL = { type: 'spring' as const, stiffness: 320, damping: 28, mass: 0.9 };

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

  // Data-driven animated combat profile percentages (0-100) for AAA Weapon Inspector bars
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

  const moveSlot = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target > 2) return;
    const next = [...loadoutOrder] as [ElementId, ElementId, ElementId];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    onUpdateLoadoutOrder(next);
  };

  const equipElementToSlot = (elemId: ElementId) => {
    if (!isElementUnlocked(saveRecord, elemId)) return;
    const existingIdx = loadoutOrder.indexOf(elemId);
    if (existingIdx >= 0) {
      setEditingSlot(existingIdx as 0 | 1 | 2);
      onPreviewElement(elemId);
      return;
    }
    const next = [...loadoutOrder] as [ElementId, ElementId, ElementId];
    next[editingSlot] = elemId;
    onUpdateLoadoutOrder(next);
    onPreviewElement(elemId);
  };

  const handleUpgrade = (elemId: ElementId) => {
    if (upgradeGemLevel(elemId)) {
      onGemProgressionChanged();
      onPreviewElement(elemId);
    }
  };

  const handleUpgradePhantom = () => {
    if (upgradePhantomCore()) {
      onGemProgressionChanged();
    }
  };

  const handleShardUnlock = (elemId: ElementId) => {
    if (unlockGemWithShards(elemId)) {
      onGemProgressionChanged();
      onPreviewElement(elemId);
    }
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
          background: `linear-gradient(90deg, rgba(2,6,23,0.78) 0%, rgba(2,6,23,0.22) 34%, rgba(2,6,23,0.0) 56%, rgba(2,6,23,0.48) 100%), radial-gradient(ellipse at 52% 94%, ${accentColor}22 0%, transparent 56%)`,
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

        {/* Center: Mission Sector (01-05) + Boss Rush Selector Ribbon with Shared layoutId Laser Track */}
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
                onClick={() => onSelectStage(stage.id)}
                className={`game-chamfer-sm group relative shrink-0 cursor-pointer overflow-hidden px-2.5 py-1.5 text-left transition-colors ${
                  isSelected
                    ? 'text-white'
                    : 'bg-slate-950/65 text-slate-400 hover:bg-slate-900/85 hover:text-slate-100'
                }`}
              >
                {isSelected && (
                  <motion.div
                    layoutId="hub-sector-active"
                    transition={SPRING_SNAPPY}
                    className="pointer-events-none absolute inset-0 -z-10"
                    style={{
                      background: `linear-gradient(180deg, ${stage.accentColor}2e 0%, rgba(15,23,42,0.96) 100%)`,
                      borderBottom: `2px solid ${stage.accentColor}`,
                      boxShadow: `inset 0 0 18px ${stage.accentColor}30`,
                    }}
                  />
                )}
                <div className="flex items-center justify-between gap-1.5 text-[8px] font-bold tracking-[0.12em] uppercase">
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
                <p className="font-game-display mt-0.5 whitespace-nowrap text-[9.5px] font-bold tracking-wide uppercase">
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
        {/* LEFT TACTICAL RAIL: Animated swap between UNIT-01 Deck & UNIT-02 Fixed Overclock Kit */}
        <div className="pointer-events-auto flex w-[404px] max-w-full flex-col min-h-0">
          <AnimatePresence mode="wait">
            {isPhantomLocked ? (
              <motion.aside
                key="rail-phantom"
                initial={{ x: -34, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={SPRING_PANEL}
                className="game-scroll flex h-full flex-col justify-between gap-2.5 overflow-y-auto pr-1"
              >
                {/* FIXED SINGLE-FORM BANNER */}
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-0.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3.5 w-1 bg-cyan-400 shadow-[0_0_10px_#22d3ee]" />
                      <h2 className="font-game-display text-[11px] font-black tracking-[0.2em] text-cyan-200 uppercase">
                        PHANTOM OVERCLOCK KIT
                      </h2>
                    </div>
                    <span className="game-chamfer-sm bg-cyan-500/20 px-2 py-0.5 text-[9px] font-black tracking-wider text-cyan-200 uppercase ring-1 ring-cyan-400/45">
                      SINGLE FORM LOCKED
                    </span>
                  </div>

                  {/* SIGNATURE WEAPON CARD: KUROKAGE CYBER KATANA */}
                  <motion.div
                    whileHover={{ x: 3 }}
                    transition={SPRING_SNAPPY}
                    className="game-chamfer-sm game-panel-bezel game-corner-brackets relative overflow-hidden p-3"
                    style={{
                      borderLeft: '4px solid #06b6d4',
                      boxShadow:
                        'inset 0 0 0 1px rgba(34,211,238,0.45), 0 0 22px rgba(6,182,212,0.2)',
                    }}
                  >
                    <div className="animate-hud-scan pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-cyan-400/12 to-transparent" />
                    <div className="relative z-10 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[9px] font-bold tracking-[0.2em] text-cyan-300 uppercase">
                          SIGNATURE KATANA • LV.{phantomLevel}/{MAX_GEM_LEVEL}
                        </p>
                        <h3 className="font-game-display mt-0.5 text-sm font-black tracking-wide text-white uppercase italic">
                          {displayWeaponName}
                        </h3>
                      </div>
                      {phantomLevel < MAX_GEM_LEVEL ? (
                        <motion.button
                          type="button"
                          whileHover={canUpgradePhantom ? { scale: 1.05 } : undefined}
                          whileTap={canUpgradePhantom ? { scale: 0.94 } : undefined}
                          disabled={!canUpgradePhantom}
                          onClick={handleUpgradePhantom}
                          className="game-chamfer-sm shrink-0 cursor-pointer bg-amber-500/25 px-2.5 py-1 text-[9px] font-black tracking-wider text-amber-200 ring-1 ring-amber-400/60 hover:bg-amber-500/45 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          UPGRADE +{phantomUpgradeCost}◆
                        </motion.button>
                      ) : (
                        <span className="game-chamfer-sm shrink-0 bg-emerald-500/20 px-2 py-1 text-[9px] font-black text-emerald-300">
                          MAX LV.5
                        </span>
                      )}
                    </div>
                    <div className="relative z-10 mt-2 flex items-center justify-between text-[10px]">
                      <div className="flex items-center gap-1">
                        {Array.from({ length: MAX_GEM_LEVEL }).map((_, p) => (
                          <motion.span
                            key={p}
                            animate={{
                              backgroundColor:
                                p < phantomLevel ? '#22d3ee' : 'rgba(148,163,184,0.22)',
                              boxShadow: p < phantomLevel ? '0 0 8px #22d3ee' : 'none',
                            }}
                            className="h-1.5 w-5"
                          />
                        ))}
                      </div>
                      <span className="font-bold text-emerald-300">
                        ATK +{previewMultPct}% • 22% CRIT
                      </span>
                    </div>
                    <p className="relative z-10 mt-1.5 text-[10px] text-slate-300/85">
                      Obsidian-cyan plasma odachi (3.15m reach • 1.24× swift slash). Applies{' '}
                      <span className="font-bold text-cyan-300">MARK</span> on every strike.
                    </p>
                  </motion.div>

                  {/* SIGNATURE PET CARD: KITSUNE-02 CYBER FOX */}
                  <motion.div
                    whileHover={{ x: 3 }}
                    transition={SPRING_SNAPPY}
                    className="game-chamfer-sm game-panel-bezel p-3"
                    style={{
                      borderLeft: '4px solid #38bdf8',
                      boxShadow: 'inset 0 0 0 1px rgba(56,189,248,0.42)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-bold tracking-[0.2em] text-sky-300 uppercase">
                          CONTRACT BEAST [E] • AUTO-RIGGED 9-BONE
                        </p>
                        <h3 className="font-game-display mt-0.5 text-sm font-black tracking-wide text-white uppercase italic">
                          {displayPetName}
                        </h3>
                      </div>
                      <span className="game-chamfer-sm flex items-center gap-1.5 bg-sky-500/20 px-2 py-0.5 text-[9px] font-black text-sky-200 uppercase">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
                        CYBER FOX
                      </span>
                    </div>
                    <p className="mt-1.5 text-[10px] text-cyan-200/90">
                      Passive: <strong>{displayPetPassive}</strong>
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-300/80">
                      Pounces for 2.15× MARK burst, then sprints alongside Unit-02 for 18s firing
                      cyan Fox-Fire Plasma Bolts.
                    </p>
                  </motion.div>
                </section>

                {/* 2-FORM PROGRESSION & SIGNATURE ARTS (NO ELEMENT SELECTION) */}
                <section className="game-chamfer-sm game-panel-bezel flex flex-col gap-2 p-3 ring-1 ring-cyan-400/20">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                    <span className="font-game-display text-[10px] font-bold tracking-[0.18em] text-white uppercase">
                      2-FORM OVERCLOCK MATRIX
                    </span>
                    <span className="text-[9px] font-bold tracking-wider text-rose-300 uppercase">
                      NO ELEMENT SWAP
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    <div className="game-chamfer-sm bg-slate-900/90 p-2 ring-1 ring-cyan-400/30">
                      <p className="text-[8px] font-black tracking-widest text-cyan-300 uppercase">
                        FORM 01 • BASE
                      </p>
                      <p className="font-game-display mt-0.5 text-[11px] font-bold text-white uppercase">
                        BASIC FORM
                      </p>
                      <p className="mt-0.5 text-[9px] text-slate-400">
                        10.0 m/s Sprint • 2.15× Counter
                      </p>
                    </div>
                    <div className="game-chamfer-sm bg-cyan-950/60 p-2 ring-1 ring-cyan-300/60 shadow-[inset_0_0_16px_rgba(34,211,238,0.18)]">
                      <p className="text-[8px] font-black tracking-widest text-rose-300 uppercase">
                        FORM 02 • [F] MAX TIER
                      </p>
                      <p className="font-game-display mt-0.5 text-[11px] font-bold text-cyan-200 uppercase">
                        UPGRADED FORM
                      </p>
                      <p className="mt-0.5 text-[9px] text-cyan-100/80">
                        +40% DMG • 38s • Cyan Afterimage
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1 border-t border-white/10 pt-1.5 text-[10px] text-slate-300">
                    <div className="flex items-center justify-between">
                      <span>
                        <strong className="text-amber-300">[Q]</strong> {displaySkillName}
                      </span>
                      <span className="text-[9px] text-slate-400">5.5s CD • Dash X-Slash</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>
                        <strong className="text-orange-300">[SPACE]</strong> Phantom Kick
                      </span>
                      <span className="text-[9px] text-slate-400">6.0s CD • +75 Break</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>
                        <strong className="text-rose-300">[R]</strong> PHANTOM OMNISLASH
                      </span>
                      <span className="text-[9px] text-cyan-300">
                        Cyber Cage • 6 Clones • Kitsune-02
                      </span>
                    </div>
                  </div>

                  <p className="bg-slate-950/85 px-2.5 py-1.5 text-[9px] leading-relaxed text-slate-400 ring-1 ring-white/5">
                    UNIT-02 PHANTOM beroperasi dengan 1 wujud khusus tanpa pergantian 10 elemen.
                    Pilih <strong className="text-rose-300">UNIT-01 NEXUS</strong> di panel kanan
                    untuk kustomisasi 10 Elemental Cores.
                  </p>
                </section>
              </motion.aside>
            ) : (
              <motion.aside
                key="rail-nexus"
                initial={{ x: -34, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={SPRING_PANEL}
                className="game-scroll flex h-full flex-col justify-between gap-2 overflow-y-auto pr-1"
              >
                {/* SECTION 1: ACTIVE K-DRIVER BELT SLOTS [1] [2] [3] */}
                <section className="flex flex-col gap-1.5">
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
                              className="animate-henshin-sheen pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/12 to-transparent"
                              aria-hidden="true"
                            />
                          )}

                          <div className="relative z-10 flex min-w-0 items-center gap-2.5">
                            {/* Skewed Keycap Slot Trigger */}
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

                {/* SECTION 2: 10-ELEMENT CORE GEM VAULT (Compact 2x5 Cartridges — Tactile Spring Chips!) */}
                <section className="flex flex-1 flex-col justify-center gap-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3.5 w-1 bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
                      <h2 className="font-game-display text-[11px] font-black tracking-[0.2em] text-amber-200 uppercase">
                        ELEMENTAL CORES
                      </h2>
                    </div>
                    <span className="text-[9.5px] tracking-wider text-slate-400 uppercase">
                      LOAD INTO SLOT [{editingSlot + 1}]
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {ALL_ELEMENT_IDS.map((elemId) => {
                      const cfg = getElementConfig(elemId);
                      const unlocked = isElementUnlocked(saveRecord, elemId);
                      const level = getGemLevel(saveRecord, elemId);
                      const upgradeCost = getGemUpgradeCost(level);
                      const equippedIdx = loadoutOrder.indexOf(elemId);
                      const isEquipped = equippedIdx >= 0;
                      const isPreviewing = activeElement === elemId;
                      const canUpgrade =
                        unlocked && level < MAX_GEM_LEVEL && saveRecord.gemShards >= upgradeCost;
                      const canUnlock = !unlocked && saveRecord.gemShards >= GEM_SHARD_UNLOCK_COST;

                      return (
                        <motion.div
                          key={elemId}
                          whileHover={unlocked ? { y: -1.5, scale: 1.015 } : undefined}
                          whileTap={unlocked ? { scale: 0.97 } : undefined}
                          transition={SPRING_SNAPPY}
                          onClick={() => {
                            if (unlocked) equipElementToSlot(elemId);
                          }}
                          className={`game-chamfer-tr game-panel-bezel relative flex flex-col justify-between px-2.5 py-1.5 ${
                            unlocked ? 'cursor-pointer' : 'opacity-65 grayscale-[35%]'
                          }`}
                          style={{
                            borderLeft: `3px solid ${unlocked ? cfg.primaryColor : '#334155'}`,
                            boxShadow: isPreviewing
                              ? `inset 0 0 0 1px ${cfg.primaryColor}dd, 0 0 16px ${cfg.primaryColor}3d`
                              : isEquipped
                                ? `inset 0 0 0 1px ${cfg.primaryColor}66`
                                : 'inset 0 0 0 1px rgba(148,163,184,0.14)',
                          }}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <ElementEmblem
                                id={elemId}
                                color={unlocked ? cfg.primaryColor : '#64748b'}
                                size={14}
                              />
                              <span className="font-game-display truncate text-[10px] font-bold tracking-wider text-white uppercase">
                                {elemId}
                              </span>
                              {unlocked && (
                                <span className="text-[9px] font-bold text-amber-300">L{level}</span>
                              )}
                            </div>
                            {isEquipped ? (
                              <span
                                className="px-1 text-[8px] font-black tracking-wider uppercase"
                                style={{
                                  backgroundColor: `${cfg.primaryColor}36`,
                                  color: cfg.emissiveColor,
                                }}
                              >
                                S{equippedIdx + 1}
                              </span>
                            ) : (
                              <span className="text-[8px] font-semibold tracking-wider text-slate-400 uppercase">
                                {cfg.weapon.archetype === 'RANGED' ? 'RANGED' : cfg.statusApplied}
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex items-center justify-between gap-1">
                            <p className="truncate text-[9px] text-slate-300/80">{cfg.weapon.name}</p>
                            {unlocked ? (
                              level < MAX_GEM_LEVEL ? (
                                <motion.button
                                  type="button"
                                  whileHover={canUpgrade ? { scale: 1.08 } : undefined}
                                  whileTap={canUpgrade ? { scale: 0.92 } : undefined}
                                  disabled={!canUpgrade}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUpgrade(elemId);
                                  }}
                                  className="shrink-0 cursor-pointer bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-amber-200 ring-1 ring-amber-400/45 hover:bg-amber-500/45 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  +{upgradeCost}◆
                                </motion.button>
                              ) : (
                                <span className="shrink-0 bg-emerald-500/20 px-1.5 py-0.5 text-[8px] font-black text-emerald-300">
                                  MAX
                                </span>
                              )
                            ) : (
                              <button
                                type="button"
                                disabled={!canUnlock}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleShardUnlock(elemId);
                                }}
                                className="shrink-0 cursor-pointer bg-violet-500/25 px-1.5 py-0.5 text-[8px] font-bold text-violet-200 ring-1 ring-violet-400/40 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                LOCK {GEM_SHARD_UNLOCK_COST}◆
                              </button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </section>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>

        {/* CENTER: OPEN 3D HOLOGRAPHIC RIDER SHOWCASE VIEWPORT (Diegetic Brackets + Camera Angle Rig) */}
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

          {/* Animated Center Rider Designation Header */}
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
                <p
                  className="font-game-display mt-0.5 text-base font-black tracking-[0.24em] uppercase italic"
                  style={{ color: glowColor, textShadow: `0 0 18px ${accentColor}aa, 0 2px 10px rgba(0,0,0,0.85)` }}
                >
                  {displayPedestalSubtitle}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Interactive 3D Camera Inspection Dock (Quick Angle Presets + Orbit Hint) */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ ...SPRING_PANEL, delay: 0.12 }}
            className="pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 bg-slate-950/78 px-3 py-1.5 text-[9.5px] font-bold tracking-[0.16em] text-slate-300 uppercase ring-1 ring-white/14 backdrop-blur-md game-chamfer-sm"
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

        {/* RIGHT TACTICAL INTEL + RIDER UNIT SWITCHER + DRAMATIC HENSHIN IGNITION TRIGGER */}
        <motion.div
          initial={{ x: 36, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={SPRING_PANEL}
          className="pointer-events-auto flex w-[348px] max-w-full flex-col justify-end gap-2"
        >
          {/* Playable Rider Selector with Sliding Neon layoutId Plate */}
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
                    onClick={() => onSelectRider(r.id)}
                    className={`game-chamfer-sm relative cursor-pointer overflow-hidden px-2.5 py-1.5 text-left transition-colors ${
                      active
                        ? 'text-white'
                        : 'bg-slate-950/75 text-slate-400 hover:bg-slate-900/90 hover:text-slate-100'
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="rider-unit-highlight"
                        transition={SPRING_SNAPPY}
                        className="pointer-events-none absolute inset-0 -z-10"
                        style={{
                          background: `linear-gradient(125deg, ${r.accentColor}35 0%, rgba(15,23,42,0.96) 100%)`,
                          borderLeft: `3px solid ${r.accentColor}`,
                          boxShadow: `inset 0 0 0 1px ${r.accentColor}99, 0 0 16px ${r.accentColor}38`,
                        }}
                      />
                    )}
                    <div className="flex items-center justify-between text-[8px] font-black tracking-[0.14em] uppercase">
                      <span style={{ color: r.glowColor }}>{r.codeName}</span>
                      <span className="text-slate-400">{r.maxForms} FORMS</span>
                    </div>
                    <p className="font-game-display mt-0.5 truncate text-[10px] font-black tracking-wide uppercase">
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

          {/* Active Form Combat Dossier with Animated Spring Stat Bars */}
          <div
            className="game-chamfer game-panel-bezel game-scanlines game-corner-brackets relative overflow-hidden p-3"
            style={{
              borderRight: `3px solid ${accentColor}`,
              boxShadow: `inset 0 0 0 1px ${accentColor}48, 0 14px 36px rgba(2,6,23,0.72)`,
            }}
          >
            {/* Header Row */}
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

            {/* Status + Style Strip */}
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
          </div>

          {/* DIFFICULTY SELECTOR (layoutId Slider) + MISSION BRIEF + KINETIC IGNITION DEPLOY */}
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
                      onClick={() => onSelectDifficulty(diff.id)}
                      className={`game-chamfer-sm relative cursor-pointer overflow-hidden py-1.5 font-game-display text-[10px] font-black tracking-wider uppercase transition-colors ${
                        active
                          ? 'text-slate-950'
                          : 'bg-slate-950/75 text-slate-400 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
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
                      {diff.label}
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

            <motion.button
              type="button"
              disabled={engineStatus !== 'ready'}
              whileHover={engineStatus === 'ready' ? { scale: 1.025, filter: 'brightness(1.1)' } : undefined}
              whileTap={engineStatus === 'ready' ? { scale: 0.965 } : undefined}
              transition={SPRING_SNAPPY}
              onClick={onDeploy}
              className="game-skew-cta group relative w-full cursor-pointer overflow-hidden px-6 py-3.5 text-center disabled:cursor-wait disabled:opacity-50"
              style={{
                background: isPhantomLocked
                  ? 'linear-gradient(105deg, #0284c7 0%, #06b6d4 48%, #e11d48 100%)'
                  : 'linear-gradient(105deg, #e11d48 0%, #f97316 52%, #f59e0b 100%)',
                boxShadow: isPhantomLocked
                  ? '0 0 32px rgba(6, 182, 212, 0.58), inset 0 1px 0 rgba(255,255,255,0.4)'
                  : '0 0 32px rgba(244, 63, 94, 0.58), inset 0 1px 0 rgba(255,255,255,0.4)',
              }}
            >
              {/* Animated Tokusatsu light-sweep beam */}
              <span
                className="animate-henshin-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent"
                aria-hidden="true"
              />
              <span className="font-game-display relative z-10 flex items-center justify-center gap-2.5 text-sm font-black tracking-[0.22em] text-white uppercase italic drop-shadow">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
                </svg>
                {engineStatus === 'ready'
                  ? isPhantomLocked
                    ? 'DEPLOY // OVERCLOCK!'
                    : 'DEPLOY // HENSHIN!'
                  : 'INITIALIZING DRIVER...'}
              </span>
            </motion.button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

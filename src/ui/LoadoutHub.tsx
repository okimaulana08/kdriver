import { useState } from 'react';
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
import { STAGE_LIST, getStageConfig } from '../game/data/stages';
import {
  GEM_SHARD_UNLOCK_COST,
  MAX_GEM_LEVEL,
  getGemLevel,
  getGemUpgradeCost,
  isElementUnlocked,
} from '../game/ProgressionSystem';
import type { DifficultyId, ElementId, StageId, WeaponArchetype } from '../game/types/schema';
import { useGameStore } from '../store/useGameStore';

interface LoadoutHubProps {
  onPreviewElement: (id: ElementId) => void;
  onUpdateLoadoutOrder: (order: [ElementId, ElementId, ElementId]) => void;
  onSelectStage: (stageId: StageId) => void;
  onSelectDifficulty: (difficulty: DifficultyId) => void;
  onGemProgressionChanged: () => void;
  onDeploy: () => void;
  onResetView?: () => void;
}

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

export function LoadoutHub({
  onPreviewElement,
  onUpdateLoadoutOrder,
  onSelectStage,
  onSelectDifficulty,
  onGemProgressionChanged,
  onDeploy,
  onResetView,
}: LoadoutHubProps) {
  const loadoutOrder = useGameStore((s) => s.loadoutOrder);
  const activeElement = useGameStore((s) => s.activeElement);
  const selectedStageId = useGameStore((s) => s.selectedStageId);
  const selectedDifficulty = useGameStore((s) => s.selectedDifficulty);
  const saveRecord = useGameStore((s) => s.saveRecord);
  const engineStatus = useGameStore((s) => s.engineStatus);
  const gamepadConnected = useGameStore((s) => s.gamepadConnected);
  const upgradeGemLevel = useGameStore((s) => s.upgradeGemLevel);
  const unlockGemWithShards = useGameStore((s) => s.unlockGemWithShards);

  const [editingSlot, setEditingSlot] = useState<0 | 1 | 2>(0);

  const previewConfig = getElementConfig(activeElement);
  const previewLevel = getGemLevel(saveRecord, activeElement);
  const previewMultPct = Math.round((getElementLevelDamageMultiplier(previewLevel) - 1) * 100);
  const selectedStage = getStageConfig(selectedStageId);
  const diffConfig = getDifficultyConfig(selectedDifficulty);
  const scaledShardPreview = Math.round(selectedStage.shardReward * diffConfig.shardRewardMult);
  const accentColor = previewConfig.primaryColor;
  const glowColor = previewConfig.emissiveColor;

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

  const handleShardUnlock = (elemId: ElementId) => {
    if (unlockGemWithShards(elemId)) {
      onGemProgressionChanged();
      onPreviewElement(elemId);
    }
  };

  return (
    <div className="font-game-ui pointer-events-none fixed inset-0 z-20 flex flex-col justify-between overflow-hidden">
      {/* Subtle cinematic dark edge vignette so floating HUD elements stay razor-legible without boxing the 3D scene */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'linear-gradient(90deg, rgba(2,6,23,0.72) 0%, rgba(2,6,23,0.22) 38%, rgba(2,6,23,0.02) 64%, rgba(2,6,23,0.42) 100%)',
        }}
      />

      {/* ================= TOP COMMAND BAR ================= */}
      <header className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-b from-slate-950/90 via-slate-950/75 to-transparent px-5 py-2.5 backdrop-blur-sm">
        {/* Game Brand Crest */}
        <div className="flex items-center gap-3">
          <div
            className="game-hex flex h-10 w-11 items-center justify-center shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${accentColor}, #0f172a)`,
              boxShadow: `0 0 18px ${accentColor}66`,
            }}
          >
            <ElementEmblem id={activeElement} color="#ffffff" size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-game-display text-lg font-black tracking-wider text-white italic">
                K-DRIVER
              </span>
              <span
                className="game-chamfer-sm px-2 py-0.5 text-[9px] font-bold tracking-[0.2em] uppercase"
                style={{
                  backgroundColor: `${accentColor}26`,
                  color: glowColor,
                  border: `1px solid ${accentColor}70`,
                }}
              >
                HENSHIN ARMORY
              </span>
            </div>
            <p className="text-[10px] tracking-[0.22em] text-slate-400 uppercase">
              Tokusatsu 3D Action • {gamepadConnected ? 'Gamepad Linked' : 'KBM / Gamepad'}
            </p>
          </div>
        </div>

        {/* Center: Mission Sector + Boss Rush Selector Ribbon */}
        <div className="flex items-center gap-1.5">
          {STAGE_LIST.map((stage, idx) => {
            const isSelected = stage.id === selectedStageId;
            const isCleared = saveRecord.clearedStageIds.includes(stage.id);
            const modeBestRank =
              saveRecord.stageDifficultyBestRanks[
                makeStageDifficultyKey(stage.id, selectedDifficulty)
              ] ?? null;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => onSelectStage(stage.id)}
                className={`game-chamfer-sm group relative cursor-pointer px-3 py-1.5 text-left transition-all ${
                  isSelected
                    ? 'bg-slate-900/95 text-white'
                    : 'bg-slate-950/65 text-slate-400 hover:bg-slate-900/80 hover:text-slate-100'
                }`}
                style={{
                  borderBottom: `2px solid ${isSelected ? stage.accentColor : 'rgba(148,163,184,0.2)'}`,
                  boxShadow: isSelected ? `0 4px 18px ${stage.accentColor}35` : 'none',
                }}
              >
                <div className="flex items-center justify-between gap-2.5 text-[9px] font-bold tracking-[0.15em] uppercase">
                  <span style={{ color: stage.accentColor }}>
                    {stage.isBossRush ? '★ ENDGAME' : `SECTOR 0${idx + 1}`}
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
                      `LV.${stage.recommendedLevel}+`
                    )}
                  </span>
                </div>
                <p className="font-game-display mt-0.5 text-[11px] font-bold tracking-wide uppercase">
                  {stage.name}
                </p>
              </button>
            );
          })}
        </div>

        {/* Right: Pilot Telemetry & Shard Crystal Counter */}
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 border-r border-white/10 pr-3 text-[10px] xl:flex">
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

          <div
            className="game-chamfer-sm flex items-center gap-2 bg-amber-500/15 px-3 py-1.5"
            style={{ border: '1px solid rgba(251, 191, 36, 0.45)' }}
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
          </div>
        </div>
      </header>

      {/* ================= MAIN FLOATING ARMORY WORKSPACE ================= */}
      <div className="flex min-h-0 flex-1 items-stretch justify-between px-4 py-3 sm:px-5">
        {/* LEFT TACTICAL RAIL: Driver Belt Slots + 10-Core Vault (No giant web modal!) */}
        <aside className="game-scroll pointer-events-auto flex w-[410px] max-w-full flex-col justify-between gap-2.5 overflow-y-auto pr-1">
          {/* SECTION 1: ACTIVE K-DRIVER BELT SLOTS [1] [2] [3] */}
          <section className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-0.5">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-1"
                  style={{ backgroundColor: accentColor, boxShadow: `0 0 8px ${accentColor}` }}
                />
                <h2 className="font-game-display text-[11px] font-bold tracking-[0.18em] text-white uppercase">
                  DRIVER BELT DECK
                </h2>
              </div>
              <span className="text-[10px] font-bold tracking-wider text-amber-300 uppercase">
                SLOT [{editingSlot + 1}] SELECTED
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
                  <div
                    key={`${elemId}-${idx}`}
                    onClick={() => {
                      setEditingSlot(idx as 0 | 1 | 2);
                      onPreviewElement(elemId);
                    }}
                    className={`game-chamfer-sm game-hud-surface group relative flex cursor-pointer items-center justify-between px-2.5 py-1.5 transition-all ${
                      isEditing ? 'translate-x-1' : 'hover:translate-x-0.5'
                    }`}
                    style={{
                      borderLeft: `4px solid ${cfg.primaryColor}`,
                      boxShadow: isEditing
                        ? `inset 0 0 0 1px ${cfg.primaryColor}aa, 0 0 18px ${cfg.primaryColor}33`
                        : isPreviewing
                          ? `inset 0 0 0 1px rgba(56,189,248,0.45)`
                          : 'inset 0 0 0 1px rgba(148,163,184,0.18)',
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {/* Skewed Keycap Slot Trigger */}
                      <div
                        className="flex h-8 w-7 shrink-0 -skew-x-12 items-center justify-center font-game-display text-xs font-black shadow"
                        style={{
                          backgroundColor: cfg.primaryColor,
                          color: darkBadgeText ? '#0f172a' : '#ffffff',
                          boxShadow: `0 0 12px ${cfg.primaryColor}66`,
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
                          {/* Level Pips */}
                          <div className="flex items-center gap-0.5" title={`Level ${level}/${MAX_GEM_LEVEL}`}>
                            {Array.from({ length: MAX_GEM_LEVEL }).map((_, p) => (
                              <span
                                key={p}
                                className="h-1.5 w-1.5"
                                style={{
                                  backgroundColor:
                                    p < level ? cfg.emissiveColor : 'rgba(148,163,184,0.22)',
                                }}
                              />
                            ))}
                          </div>
                          <span className="text-[9px] font-bold tracking-wider text-slate-400">
                            {formatArchetype(cfg.weapon.archetype)}
                          </span>
                        </div>
                        <p className="truncate text-[10px] text-slate-300/85">
                          {cfg.weapon.name}{' '}
                          <span className="text-slate-500">//</span>{' '}
                          <span className="text-cyan-300">{cfg.pet.name}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveSlot(idx, -1);
                        }}
                        className="cursor-pointer bg-slate-900/90 px-1.5 py-0.5 text-[9px] text-slate-300 ring-1 ring-white/10 hover:bg-cyan-500/20 hover:text-white disabled:cursor-default disabled:opacity-25"
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
                        className="cursor-pointer bg-slate-900/90 px-1.5 py-0.5 text-[9px] text-slate-300 ring-1 ring-white/10 hover:bg-cyan-500/20 hover:text-white disabled:cursor-default disabled:opacity-25"
                        title="Move Down"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* SECTION 2: 10-ELEMENT CORE GEM VAULT (Compact 2x5 Cartridges — All Visible!) */}
          <section className="flex flex-1 flex-col justify-center gap-1.5">
            <div className="flex items-center justify-between px-0.5">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-1 bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
                <h2 className="font-game-display text-[11px] font-bold tracking-[0.18em] text-amber-200 uppercase">
                  ELEMENTAL CORES
                </h2>
              </div>
              <span className="text-[10px] tracking-wider text-slate-400 uppercase">
                CLICK TO SLOT [{editingSlot + 1}]
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
                  <div
                    key={elemId}
                    onClick={() => {
                      if (unlocked) equipElementToSlot(elemId);
                    }}
                    className={`game-chamfer-tr game-hud-surface relative flex flex-col justify-between px-2.5 py-1.5 transition-all ${
                      unlocked
                        ? 'cursor-pointer hover:brightness-125'
                        : 'opacity-65 grayscale-[35%]'
                    }`}
                    style={{
                      borderLeft: `3px solid ${unlocked ? cfg.primaryColor : '#334155'}`,
                      boxShadow: isPreviewing
                        ? `inset 0 0 0 1px ${cfg.primaryColor}cc, 0 0 14px ${cfg.primaryColor}33`
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
                            backgroundColor: `${cfg.primaryColor}33`,
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
                          <button
                            type="button"
                            disabled={!canUpgrade}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpgrade(elemId);
                            }}
                            className="shrink-0 cursor-pointer bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-amber-200 ring-1 ring-amber-400/40 hover:bg-amber-500/40 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            +{upgradeCost}◆
                          </button>
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
                  </div>
                );
              })}
            </div>
          </section>
        </aside>

        {/* CENTER: OPEN 3D RIDER SHOWCASE STAGE (Subtle corner reticle brackets only) */}
        <div className="pointer-events-none relative hidden flex-1 lg:block">
          <div
            className="absolute top-6 left-1/2 -translate-x-1/2 text-center opacity-80"
          >
            <p className="text-[9px] font-bold tracking-[0.35em] text-slate-300/80 uppercase">
              LIVE FORM PREVIEW
            </p>
            <p
              className="font-game-display text-sm font-black tracking-[0.22em] uppercase italic"
              style={{ color: glowColor, textShadow: `0 0 14px ${accentColor}88` }}
            >
              {previewConfig.name}
            </p>
          </div>

          {/* Interactive 3D Inspection Controls Hint */}
          <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2.5 bg-slate-950/65 px-3.5 py-1.5 text-[10px] font-bold tracking-[0.18em] text-slate-300 uppercase ring-1 ring-white/12 backdrop-blur-sm game-chamfer-sm">
            <span className="text-cyan-300">⟳ DRAG TO ROTATE</span>
            <span className="text-slate-600">•</span>
            <span className="text-amber-300">⊕ SCROLL TO ZOOM</span>
            {onResetView && (
              <>
                <span className="text-slate-600">•</span>
                <button
                  type="button"
                  onClick={onResetView}
                  className="cursor-pointer text-slate-200 transition-colors hover:text-white"
                  title="Reset 3D Camera View"
                >
                  RESET
                </button>
              </>
            )}
          </div>
        </div>

        {/* RIGHT TACTICAL INTEL + DRAMATIC HENSHIN IGNITION TRIGGER */}
        <div className="pointer-events-auto flex w-[340px] max-w-full flex-col justify-end gap-3">
          {/* Active Form Combat Dossier */}
          <div
            className="game-chamfer game-hud-surface game-scanlines relative p-4"
            style={{
              borderRight: `3px solid ${accentColor}`,
              boxShadow: `inset 0 0 0 1px ${accentColor}44, 0 14px 36px rgba(2,6,23,0.65)`,
            }}
          >
            {/* Header Row */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[9px] font-bold tracking-[0.24em] text-cyan-300 uppercase">
                  ARMAMENT SPECS • LV.{previewLevel}
                </p>
                <h2 className="font-game-display mt-0.5 text-base font-black tracking-wide text-white uppercase italic">
                  {previewConfig.weapon.name}
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
                {formatArchetype(previewConfig.weapon.archetype)}
              </span>
            </div>

            {/* ATK & Status Telemetry Bar */}
            <div className="mt-2.5 flex items-center justify-between border-y border-white/10 py-1.5 text-[10px]">
              <span className="font-bold tracking-wider text-slate-300 uppercase">
                STATUS:{' '}
                <span style={{ color: glowColor }}>{previewConfig.statusApplied}</span>
              </span>
              <span className="font-bold text-emerald-300">
                ATK +{previewMultPct}%
              </span>
            </div>

            {/* Combat Arts Keybinds */}
            <div className="mt-2.5 space-y-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-amber-500/20 font-game-display text-[10px] font-black text-amber-300 ring-1 ring-amber-400/50">
                  Q
                </span>
                <span className="truncate text-slate-200">
                  <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                    SKILL{' '}
                  </span>
                  {previewConfig.skill.name}
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
                  {previewConfig.pet.name}{' '}
                  <span className="text-[10px] text-cyan-300/80">
                    ({previewConfig.pet.passiveDescription})
                  </span>
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
                  Super (32s) → Ultimate (25s)
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
                  {previewConfig.finisherName}
                </span>
              </div>
            </div>

            {/* Elemental Reaction Cheat Strip */}
            <div className="mt-2.5 border-t border-white/10 pt-1.5 text-[9px] tracking-wide text-slate-400">
              <span className="font-bold text-slate-300 uppercase">REACTIONS: </span>
              WET+VOLT • WET+PYRO • BURN+VOLT • ROOT+PYRO • MARK+LUX
            </div>
          </div>

          {/* DIFFICULTY SELECTOR (EASY / MEDIUM / HARD / HELL) + MISSION BRIEF + DEPLOY */}
          <div className="flex flex-col gap-2">
            <div className="game-chamfer-sm game-hud-surface p-2.5 ring-1 ring-white/10">
              <div className="flex items-center justify-between px-0.5">
                <span className="font-game-display text-[9px] font-bold tracking-[0.2em] text-slate-300 uppercase">
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
                    <button
                      key={diff.id}
                      type="button"
                      onClick={() => onSelectDifficulty(diff.id)}
                      className={`game-chamfer-sm cursor-pointer py-1.5 font-game-display text-[10px] font-black tracking-wider uppercase transition-all ${
                        active
                          ? 'text-slate-950'
                          : 'bg-slate-950/75 text-slate-400 hover:bg-slate-900 hover:text-white'
                      }`}
                      style={
                        active
                          ? {
                              backgroundColor: diff.accentColor,
                              boxShadow: `0 0 14px ${diff.accentColor}88`,
                            }
                          : { border: '1px solid rgba(148,163,184,0.18)' }
                      }
                    >
                      {diff.label}
                    </button>
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
              <span className="shrink-0 font-bold text-amber-300">
                +{scaledShardPreview} ◆
              </span>
            </div>

            <button
              type="button"
              disabled={engineStatus !== 'ready'}
              onClick={onDeploy}
              className="game-skew-cta group relative w-full cursor-pointer overflow-hidden px-6 py-3.5 text-center transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
              style={{
                background: `linear-gradient(105deg, #e11d48 0%, #f97316 52%, #f59e0b 100%)`,
                boxShadow: `0 0 28px rgba(244, 63, 94, 0.55), inset 0 1px 0 rgba(255,255,255,0.35)`,
              }}
            >
              {/* Animated Tokusatsu light-sweep beam */}
              <span
                className="animate-henshin-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                aria-hidden="true"
              />
              <span className="font-game-display relative z-10 flex items-center justify-center gap-2.5 text-sm font-black tracking-[0.22em] text-white uppercase italic drop-shadow">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
                </svg>
                {engineStatus === 'ready' ? 'DEPLOY // HENSHIN!' : 'INITIALIZING DRIVER...'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

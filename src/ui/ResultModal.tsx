import { motion } from 'framer-motion';
import { getDifficultyConfig } from '../game/data/difficulty';
import { getElementConfig } from '../game/data/elements';
import { getStageConfig } from '../game/data/stages';
import type { RankGrade } from '../game/types/schema';
import { useGameStore } from '../store/useGameStore';

interface ResultModalProps {
  onRetry: () => void;
  onReturnToHub: () => void;
}

const RANK_THEMES: Readonly<
  Record<
    RankGrade,
    { text: string; accent: string; glow: string; label: string }
  >
> = {
  'S+': {
    text: '#fef08a',
    accent: '#f43f5e',
    glow: 'rgba(244, 63, 94, 0.75)',
    label: 'SOVEREIGN LEGEND',
  },
  S: {
    text: '#fde047',
    accent: '#f59e0b',
    glow: 'rgba(251, 191, 36, 0.65)',
    label: 'SUPREME RIDER',
  },
  A: {
    text: '#67e8f9',
    accent: '#06b6d4',
    glow: 'rgba(34, 211, 238, 0.55)',
    label: 'ACE OPERATIVE',
  },
  B: {
    text: '#6ee7b7',
    accent: '#10b981',
    glow: 'rgba(16, 185, 129, 0.45)',
    label: 'COMBAT READY',
  },
  C: {
    text: '#cbd5e1',
    accent: '#64748b',
    glow: 'rgba(148, 163, 184, 0.35)',
    label: 'SURVIVOR',
  },
};

function formatTime(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

/**
 * Tokusatsu Gaming Tactical Mission Debrief Screen — asymmetric chamfered HUD matching LoadoutHub,
 * dramatic impact-stamped Rank Seal, diagonal telemetry blades, and skewed arcade action triggers.
 */
export function ResultModal({ onRetry, onReturnToHub }: ResultModalProps) {
  const result = useGameStore((s) => s.stageResult);
  const saveRecord = useGameStore((s) => s.saveRecord);
  const selectedStageId = useGameStore((s) => s.selectedStageId);

  if (!result) return null;

  const isVictory = result.victory;
  const stage = getStageConfig(result.stageId ?? selectedStageId);
  const diffConfig = getDifficultyConfig(result.difficulty ?? 'medium');
  const rankTheme = RANK_THEMES[result.rank];
  const primaryAccent = isVictory ? '#fbbf24' : '#f43f5e';
  const secondaryAccent = isVictory ? '#22d3ee' : '#fb7185';
  const unlockedCfg = result.unlockedElementDrop
    ? getElementConfig(result.unlockedElementDrop)
    : null;

  return (
    <div className="font-game-ui fixed inset-0 z-30 flex items-center justify-center overflow-hidden p-4 select-none sm:p-6">
      {/* Cinematic Radial Dark Vignette keeping the 3D arena visible behind */}
      <div
        className="pointer-events-none absolute inset-0 backdrop-blur-[4px]"
        style={{
          background: isVictory
            ? 'radial-gradient(ellipse at 50% 42%, rgba(8,18,38,0.62) 0%, rgba(2,6,23,0.9) 82%)'
            : 'radial-gradient(ellipse at 50% 42%, rgba(45,8,20,0.68) 0%, rgba(2,6,23,0.94) 80%)',
        }}
      />

      {/* Subtle Diagonal Speedline Backdrop */}
      <div className="pointer-events-none absolute inset-0 opacity-20">
        <div className="animate-cutin-speedlines h-full w-full" />
      </div>

      {/* Main Asymmetric Tokusatsu Mission Debrief Frame */}
      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="relative z-10 w-full max-w-4xl"
      >
        {/* Top Slanted Status Header Bar */}
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className="game-skew-cta px-3.5 py-0.5 font-game-display text-[10px] font-black tracking-[0.28em] uppercase"
                style={{
                  backgroundColor: primaryAccent,
                  color: isVictory ? '#020617' : '#ffffff',
                  boxShadow: `0 0 22px ${primaryAccent}88`,
                }}
              >
                {isVictory ? '★ OPERATION COMPLETE' : '⚠ RIDER DEFEATED'}
              </span>
              <span className="font-game-display text-[11px] font-bold tracking-[0.22em] text-slate-300 uppercase">
                {stage.name}
              </span>
              <span
                className="game-chamfer-sm px-2.5 py-0.5 font-game-display text-[10px] font-black tracking-[0.2em] text-slate-950 uppercase"
                style={{ backgroundColor: diffConfig.accentColor }}
              >
                {diffConfig.label}
              </span>
              {result.isNewBest && (
                <span className="game-chamfer-sm border border-amber-300/80 bg-amber-400/20 px-2.5 py-0.5 font-game-display text-[10px] font-black tracking-[0.2em] text-amber-200 uppercase">
                  ★ NEW RECORD
                </span>
              )}
            </div>

            <h1
              className="mt-1.5 font-game-display text-4xl leading-none font-black tracking-wider text-white uppercase italic sm:text-5xl"
              style={{
                textShadow: `0 0 28px ${primaryAccent}99, 0 5px 18px rgba(0,0,0,0.95)`,
              }}
            >
              {isVictory ? 'STAGE CLEARED!' : 'MISSION FAILED'}
            </h1>
          </div>

          <div className="hidden items-center gap-3 text-right sm:flex">
            <div className="border-r-2 border-white/15 pr-3">
              <p className="text-[9px] font-bold tracking-[0.24em] text-slate-400 uppercase">
                RECORD BEST
              </p>
              <p className="font-game-display text-sm font-black text-amber-300">
                {saveRecord.bestScore.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold tracking-[0.24em] text-slate-400 uppercase">
                BEST RANK
              </p>
              <p className="font-game-display text-sm font-black text-cyan-300">
                {saveRecord.bestRank ?? '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Main 2-Column Tactical Container */}
        <div
          className="game-chamfer game-hud-surface game-scanlines relative overflow-hidden p-5 sm:p-6"
          style={{
            borderTop: `3px solid ${primaryAccent}`,
            boxShadow: `inset 0 0 0 1px ${primaryAccent}44, 0 24px 60px rgba(0,0,0,0.8)`,
          }}
        >
          {/* Decorative corner slash glow */}
          <div
            className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-20 blur-3xl"
            style={{ backgroundColor: primaryAccent }}
          />

          <div className="relative z-10 grid grid-cols-1 gap-5 md:grid-cols-[240px_1fr]">
            {/* LEFT PILLAR: Dramatic Stamped Rank Seal */}
            <div
              className="game-chamfer-sm relative flex flex-col items-center justify-between overflow-hidden bg-slate-950/75 p-5 text-center"
              style={{
                borderLeft: `3px solid ${rankTheme.accent}`,
                boxShadow: `inset 0 0 0 1px ${rankTheme.accent}44`,
              }}
            >
              <span className="font-game-display text-[10px] font-bold tracking-[0.3em] text-slate-400 uppercase">
                COMBAT EVALUATION
              </span>

              {/* Hexagonal Slammed Rank Emblem */}
              <motion.div
                initial={{ opacity: 0, scale: 2.35, rotate: -18 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22, delay: 0.14 }}
                className="relative my-4 flex h-36 w-36 items-center justify-center"
              >
                <div
                  className="game-hex absolute inset-0 opacity-25"
                  style={{
                    backgroundColor: rankTheme.accent,
                    boxShadow: `0 0 45px ${rankTheme.glow}`,
                  }}
                />
                <div
                  className="game-hex absolute inset-2 flex flex-col items-center justify-center bg-slate-950/90"
                  style={{
                    boxShadow: `inset 0 0 28px ${rankTheme.glow}`,
                  }}
                >
                  <span className="font-game-display text-[9px] font-bold tracking-[0.32em] text-slate-400 uppercase">
                    RANK
                  </span>
                  <span
                    className="font-game-display text-7xl leading-none font-black italic"
                    style={{
                      color: rankTheme.text,
                      textShadow: `0 0 26px ${rankTheme.glow}, 0 4px 12px rgba(0,0,0,0.95)`,
                    }}
                  >
                    {result.rank}
                  </span>
                </div>
              </motion.div>

              <div className="w-full border-t border-white/10 pt-2.5">
                <p
                  className="font-game-display text-xs font-black tracking-[0.22em] uppercase"
                  style={{ color: rankTheme.text }}
                >
                  {rankTheme.label}
                </p>
                <p className="mt-0.5 text-[10px] tracking-wider text-slate-400 uppercase">
                  TOTAL CLEARS: {saveRecord.totalClears}
                </p>
              </div>
            </div>

            {/* RIGHT DECK: Hero Score + Telemetry Blades + Spoils */}
            <div className="flex flex-col justify-between gap-3.5">
              {/* Oversized Score Readout Blade */}
              <div
                className="game-chamfer-sm flex items-center justify-between bg-slate-950/80 px-4 py-3"
                style={{
                  borderLeft: `4px solid ${primaryAccent}`,
                  boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.08)`,
                }}
              >
                <div>
                  <span className="text-[10px] font-bold tracking-[0.26em] text-slate-400 uppercase">
                    TOTAL BATTLE SCORE
                  </span>
                  <p className="font-game-display text-3xl leading-tight font-black tracking-wide text-amber-300 italic sm:text-4xl">
                    {result.score.toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold tracking-[0.24em] text-slate-400 uppercase">
                    CLEAR TIME
                  </span>
                  <p className="font-game-display text-2xl font-black text-white">
                    {formatTime(result.clearTimeSec)}
                  </p>
                </div>
              </div>

              {/* 4 Sharp Chamfered Combat Metrics */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="game-chamfer-sm border-l-2 border-cyan-400 bg-slate-950/75 px-3.5 py-2.5 ring-1 ring-white/8">
                  <span className="text-[9px] font-bold tracking-[0.22em] text-slate-400 uppercase">
                    ELEMENTAL REACTIONS
                  </span>
                  <p className="mt-0.5 font-game-display text-xl font-black text-cyan-300">
                    {result.reactionsTriggered}
                  </p>
                </div>

                <div className="game-chamfer-sm border-l-2 border-rose-400 bg-slate-950/75 px-3.5 py-2.5 ring-1 ring-white/8">
                  <span className="text-[9px] font-bold tracking-[0.22em] text-slate-400 uppercase">
                    DAMAGE TAKEN
                  </span>
                  <p className="mt-0.5 font-game-display text-xl font-black text-rose-300">
                    {result.damageTaken} <span className="text-xs text-rose-300/75">HP</span>
                  </p>
                </div>

                <div className="game-chamfer-sm border-l-2 border-amber-400 bg-slate-950/75 px-3.5 py-2.5 ring-1 ring-white/8">
                  <span className="text-[9px] font-bold tracking-[0.22em] text-slate-400 uppercase">
                    MAX COMBO // DODGES
                  </span>
                  <p className="mt-0.5 font-game-display text-base font-black text-white">
                    {result.maxCombo} HITS{' '}
                    <span className="text-slate-500">//</span>{' '}
                    <span className="text-sky-300">{result.perfectDodges} PD</span>
                  </p>
                </div>

                <div className="game-chamfer-sm border-l-2 border-fuchsia-400 bg-slate-950/75 px-3.5 py-2.5 ring-1 ring-white/8">
                  <span className="text-[9px] font-bold tracking-[0.22em] text-slate-400 uppercase">
                    BOSS FINISHER BONUS
                  </span>
                  <p className="mt-0.5 font-game-display text-sm font-black">
                    {result.defeatedBossWithFinisher ? (
                      <span className="text-amber-300">★ +1,500 ULTIMATE</span>
                    ) : (
                      <span className="text-slate-500">STANDARD CLEAR</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Progression Spoils Strip (Shards + Boss Core Unlock) */}
              <div className="space-y-2">
                <div
                  className="game-chamfer-sm flex items-center justify-between px-4 py-2.5"
                  style={{
                    background:
                      'linear-gradient(90deg, rgba(245,158,11,0.22) 0%, rgba(15,23,42,0.85) 100%)',
                    borderLeft: '4px solid #fbbf24',
                    boxShadow: 'inset 0 0 0 1px rgba(251,191,36,0.35)',
                  }}
                >
                  <span className="font-game-display text-[11px] font-black tracking-[0.2em] text-amber-200 uppercase">
                    ◆ GEM SHARDS ACQUIRED
                  </span>
                  <span className="font-game-display text-sm font-black text-amber-300">
                    +{result.shardsEarned}{' '}
                    <span className="text-[11px] font-bold text-amber-200/75">
                      (VAULT: {saveRecord.gemShards})
                    </span>
                  </span>
                </div>

                {unlockedCfg && (
                  <div
                    className="game-chamfer-sm flex items-center justify-between px-4 py-2.5"
                    style={{
                      background: `linear-gradient(90deg, ${unlockedCfg.primaryColor}38 0%, rgba(15,23,42,0.9) 100%)`,
                      borderLeft: `4px solid ${unlockedCfg.emissiveColor}`,
                      boxShadow: `inset 0 0 0 1px ${unlockedCfg.emissiveColor}77, 0 0 24px ${unlockedCfg.primaryColor}44`,
                    }}
                  >
                    <div>
                      <p
                        className="font-game-display text-[9px] font-black tracking-[0.28em] uppercase"
                        style={{ color: unlockedCfg.emissiveColor }}
                      >
                        ★ BOSS DROP // NEW ELEMENTAL CORE UNLOCKED ★
                      </p>
                      <p className="mt-0.5 font-game-display text-sm font-black text-white uppercase">
                        {unlockedCfg.name} — {unlockedCfg.weapon.name}
                      </p>
                    </div>
                    <span className="text-right text-[11px] font-bold text-cyan-300">
                      PET: {unlockedCfg.pet.name}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Skewed Arcade Action Triggers */}
          <div className="relative z-10 mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center">
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={onRetry}
              className="game-skew-cta group relative flex-1 cursor-pointer overflow-hidden px-6 py-3.5 text-center"
              style={{
                background: isVictory
                  ? 'linear-gradient(105deg, #0284c7 0%, #06b6d4 50%, #f59e0b 100%)'
                  : 'linear-gradient(105deg, #e11d48 0%, #f97316 52%, #f59e0b 100%)',
                boxShadow: `0 0 28px ${primaryAccent}66, inset 0 1px 0 rgba(255,255,255,0.35)`,
              }}
            >
              <span
                className="animate-henshin-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                aria-hidden="true"
              />
              <span className="font-game-display relative z-10 text-sm font-black tracking-[0.24em] text-white uppercase italic drop-shadow">
                ↻ {isVictory ? 'REPLAY SECTOR' : 'RETRY MISSION'}
              </span>
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={onReturnToHub}
              className="game-chamfer-sm flex-1 cursor-pointer bg-slate-900/90 px-6 py-3.5 font-game-display text-xs font-black tracking-[0.22em] text-slate-100 uppercase ring-1 ring-white/20 transition-colors hover:bg-slate-800 hover:text-white"
              style={{
                borderRight: `3px solid ${secondaryAccent}`,
              }}
            >
              ◀ RETURN TO ARMORY HUB
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

import { getElementConfig } from '../game/data/elements';
import { ULTIMATE_FORM_DURATION_SEC } from '../game/entities/PlayerRider';
import { getGemLevel } from '../game/ProgressionSystem';
import type { ElementId, StatusEffectId } from '../game/types/schema';
import { useGameStore } from '../store/useGameStore';
import { FinisherCutIn } from './FinisherCutIn';

const GEM_ACTIVE_CLASSES: Readonly<Record<ElementId, string>> = {
  pyro: 'border-rose-400 bg-rose-500/25 shadow-[0_0_20px_rgba(244,63,94,0.45)] text-rose-100',
  volt: 'border-amber-300 bg-amber-400/25 shadow-[0_0_20px_rgba(250,204,21,0.45)] text-amber-100',
  aqua: 'border-cyan-300 bg-cyan-500/25 shadow-[0_0_20px_rgba(34,211,238,0.45)] text-cyan-100',
  terra: 'border-amber-500 bg-amber-600/25 shadow-[0_0_20px_rgba(245,158,11,0.45)] text-amber-100',
  aero: 'border-teal-300 bg-teal-500/25 shadow-[0_0_20px_rgba(94,234,212,0.45)] text-teal-100',
  flora: 'border-emerald-400 bg-emerald-500/25 shadow-[0_0_20px_rgba(74,222,128,0.45)] text-emerald-100',
  solar: 'border-orange-300 bg-orange-500/25 shadow-[0_0_20px_rgba(251,146,60,0.45)] text-orange-100',
  lunar: 'border-indigo-300 bg-indigo-500/25 shadow-[0_0_20px_rgba(165,180,252,0.45)] text-indigo-100',
  umbra: 'border-purple-400 bg-purple-600/25 shadow-[0_0_20px_rgba(192,132,252,0.45)] text-purple-100',
  lux: 'border-yellow-200 bg-yellow-400/25 shadow-[0_0_20px_rgba(254,240,138,0.45)] text-yellow-100',
};

const STATUS_BADGE_CLASSES: Readonly<Record<StatusEffectId, string>> = {
  BURN: 'border-orange-400/80 bg-orange-500/25 text-orange-200',
  SHOCK: 'border-yellow-300/80 bg-yellow-400/25 text-yellow-200',
  WET: 'border-cyan-400/80 bg-cyan-500/25 text-cyan-200',
  ROOT: 'border-emerald-400/80 bg-emerald-500/25 text-emerald-200',
  MARK: 'border-purple-400/80 bg-purple-500/25 text-purple-200',
};

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function CombatHUD() {
  const loadoutOrder = useGameStore((s) => s.loadoutOrder);
  const activeElement = useGameStore((s) => s.activeElement);
  const formTier = useGameStore((s) => s.formTier);
  const playerHp = useGameStore((s) => s.playerHp);
  const playerMaxHp = useGameStore((s) => s.playerMaxHp);
  const driverGauge = useGameStore((s) => s.driverGauge);
  const overdriveGauge = useGameStore((s) => s.overdriveGauge);
  const superFormRemaining = useGameStore((s) => s.superFormRemaining);
  const finisherCooldown = useGameStore((s) => s.finisherCooldown);
  const riderKickCooldown = useGameStore((s) => s.riderKickCooldown);
  const activePetRemaining = useGameStore((s) => s.activePetRemaining);
  const activeElementPetRemaining = useGameStore((s) => s.activeElementPetRemaining);
  const activePetCount = useGameStore((s) => s.activePetCount);
  const canActivateSuper = useGameStore((s) => s.canActivateSuper);
  const canActivateUltimateForm = useGameStore((s) => s.canActivateUltimateForm);
  const canActivateUltimate = useGameStore((s) => s.canActivateUltimate);
  const warpCounterReady = useGameStore((s) => s.warpCounterReady);
  const ultimateBannerTitle = useGameStore((s) => s.ultimateBannerTitle);
  const finisherCinematicId = useGameStore((s) => s.finisherCinematicId);
  const finisherCinematicElement = useGameStore((s) => s.finisherCinematicElement);
  const finisherCinematicFromUltimate = useGameStore((s) => s.finisherCinematicFromUltimate);

  const comboCount = useGameStore((s) => s.comboCount);
  const reactionCount = useGameStore((s) => s.reactionCount);
  const isLockedOn = useGameStore((s) => s.isLockedOn);
  const waveNumber = useGameStore((s) => s.waveNumber);
  const totalWaves = useGameStore((s) => s.totalWaves);
  const aliveEnemyCount = useGameStore((s) => s.aliveEnemyCount);
  const stageElapsedSec = useGameStore((s) => s.stageElapsedSec);
  const focusedEnemy = useGameStore((s) => s.focusedEnemy);

  const formSwitchCooldown = useGameStore((s) => s.formSwitchCooldown);
  const skillCooldowns = useGameStore((s) => s.skillCooldowns);
  const petCooldowns = useGameStore((s) => s.petCooldowns);
  const reactionBanner = useGameStore((s) => s.reactionBanner);
  const waveBanner = useGameStore((s) => s.waveBanner);
  const saveRecord = useGameStore((s) => s.saveRecord);
  const gamepadConnected = useGameStore((s) => s.gamepadConnected);

  const activeConfig = getElementConfig(activeElement);
  const activeSkillCd = skillCooldowns[activeElement];
  const activePetCd = petCooldowns[activeElement];

  const playerHpPct = Math.max(0, Math.min(100, (playerHp / Math.max(1, playerMaxHp)) * 100));
  const gaugePct = Math.max(
    0,
    Math.min(
      100,
      formTier === 'ULTIMATE'
        ? (superFormRemaining / ULTIMATE_FORM_DURATION_SEC) * 100
        : formTier === 'SUPER'
          ? overdriveGauge
          : driverGauge
    )
  );

  // Hybrid 3-Beat Tokusatsu Ultimate Finisher Cut-In + 3D Climax Letterbox!
  if (ultimateBannerTitle) {
    return (
      <FinisherCutIn
        key={finisherCinematicId}
        elementId={finisherCinematicElement}
        finisherTitle={ultimateBannerTitle}
        fromUltimate={finisherCinematicFromUltimate}
      />
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4">
      {/* Top Bar: Wave Tracker (left) + Focused Enemy/Boss Bar (center) */}
      <div className="relative flex items-start justify-center">
        {/* Top-Left Wave Pill */}
        <div className="absolute top-0 left-0 rounded-xl border border-slate-700/80 bg-slate-950/80 px-3.5 py-2 font-mono text-xs shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="font-black tracking-wider text-cyan-300">
              WAVE {waveNumber} / {totalWaves}
            </span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-200">FOES: {aliveEnemyCount}</span>
            <span className="text-slate-400">•</span>
            <span className="text-amber-300">{formatClock(stageElapsedSec)}</span>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">
            F3: Debug HUD • M: Mute{gamepadConnected ? ' • 🎮 PAD' : ''}
          </p>
        </div>

        {/* Top-Center: Focused Target / Boss HP + Guard / Stagger Bar */}
        <div className="flex flex-col items-center">
          {focusedEnemy ? (
            <div
              className={`rounded-xl border bg-slate-950/85 px-4 py-2.5 shadow-2xl backdrop-blur-md ${
                focusedEnemy.tier === 'BOSS'
                  ? 'w-[460px] border-rose-500/60'
                  : 'w-96 border-indigo-500/45'
              }`}
            >
              <div className="flex items-center justify-between font-mono text-xs">
                <div className="flex items-center gap-2">
                  {focusedEnemy.tier === 'BOSS' && (
                    <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-black text-white uppercase">
                      BOSS • P{focusedEnemy.bossPhase}
                    </span>
                  )}
                  {focusedEnemy.tier === 'ELITE' && (
                    <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[9px] font-black text-white uppercase">
                      ELITE
                    </span>
                  )}
                  <span className="font-bold tracking-wider text-slate-100 uppercase">
                    {focusedEnemy.name}
                  </span>
                </div>
                <span className="text-slate-300">
                  {focusedEnemy.hp} / {focusedEnemy.maxHp}
                </span>
              </div>

              {/* HP Bar */}
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-[width] duration-100 ${
                    focusedEnemy.tier === 'BOSS'
                      ? 'bg-gradient-to-r from-rose-600 via-red-500 to-orange-400'
                      : 'bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-rose-500'
                  }`}
                  style={{
                    width: `${Math.max(0, Math.min(100, (focusedEnemy.hp / Math.max(1, focusedEnemy.maxHp)) * 100))}%`,
                  }}
                />
              </div>

              {/* Guard / Super Armor Bar for Elite & Boss */}
              {focusedEnemy.maxGuard > 0 && (
                <div className="mt-1.5">
                  <div className="flex items-center justify-between font-mono text-[9px]">
                    <span
                      className={
                        focusedEnemy.isStaggered
                          ? 'animate-pulse font-black text-amber-300'
                          : 'text-amber-200/80'
                      }
                    >
                      {focusedEnemy.isStaggered
                        ? '★ STAGGERED! (-50% DEF)'
                        : `SUPER ARMOR GUARD (${focusedEnemy.guard}/${focusedEnemy.maxGuard})`}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-[width] duration-100"
                      style={{
                        width: `${Math.max(0, Math.min(100, (focusedEnemy.guard / Math.max(1, focusedEnemy.maxGuard)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="mt-1.5 flex min-h-5 items-center justify-between gap-2 font-mono text-[10px]">
                <span className={isLockedOn ? 'font-bold text-cyan-300' : 'text-slate-500'}>
                  {isLockedOn ? '◉ TARGET LOCKED' : '○ TAB TO LOCK-ON'}
                </span>

                <div className="flex items-center gap-1.5">
                  {focusedEnemy.statuses.length > 0 ? (
                    focusedEnemy.statuses.map((st) => (
                      <span
                        key={st.id}
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${STATUS_BADGE_CLASSES[st.id]}`}
                      >
                        {st.id} {st.remainingSec.toFixed(1)}s
                      </span>
                    ))
                  ) : focusedEnemy.isTelegraphing ? (
                    <span className="animate-pulse font-bold text-rose-400">
                      ⚠ TELEGRAPH — DODGE!
                    </span>
                  ) : (
                    <span className="text-slate-500">NO STATUS</span>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* Wave / Phase Transition Announcement Banner */}
          {waveBanner ? (
            <div
              key={waveBanner.id}
              className="animate-reaction-banner mt-3 flex flex-col items-center rounded-xl border-2 bg-slate-950/90 px-6 py-2 font-mono shadow-2xl backdrop-blur-md"
              style={{
                borderColor: waveBanner.accentColor,
                boxShadow: `0 0 26px ${waveBanner.accentColor}66`,
              }}
            >
              <span
                className="text-xl font-black tracking-widest uppercase"
                style={{ color: waveBanner.accentColor }}
              >
                {waveBanner.title}
              </span>
              <span className="text-[10px] font-bold tracking-[0.22em] text-slate-200 uppercase">
                {waveBanner.subtitle}
              </span>
            </div>
          ) : null}

          {/* Elemental Reaction Banner */}
          {reactionBanner ? (
            <div
              key={reactionBanner.id}
              className="animate-reaction-banner mt-2 flex flex-col items-center rounded-xl border-2 bg-slate-950/90 px-6 py-2 font-mono shadow-2xl backdrop-blur-md"
              style={{
                borderColor: reactionBanner.accentColor,
                boxShadow: `0 0 28px ${reactionBanner.accentColor}66`,
              }}
            >
              <span
                className="text-2xl font-black tracking-wider uppercase"
                style={{ color: reactionBanner.accentColor }}
              >
                ⚡ {reactionBanner.title}
              </span>
              <span className="mt-0.5 text-[10px] font-bold tracking-[0.2em] text-slate-200 uppercase">
                {reactionBanner.subtitle}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Mid-Right: Combo + Reactions Counter */}
      {(comboCount > 0 || reactionCount > 0) && (
        <div className="fixed top-1/3 right-6 flex flex-col items-end font-mono">
          {comboCount > 0 && (
            <>
              <div className="text-5xl font-black tracking-tighter text-amber-300 italic drop-shadow-[0_0_16px_rgba(251,191,36,0.65)]">
                {comboCount}
                <span className="ml-1 text-lg font-bold text-white not-italic">HITS</span>
              </div>
              <span className="mt-0.5 rounded bg-rose-600/85 px-2 py-0.5 text-[10px] font-bold tracking-[0.2em] text-white uppercase">
                K-DRIVER COMBO
              </span>
            </>
          )}
          {reactionCount > 0 && (
            <span className="mt-2 rounded border border-cyan-400/50 bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold tracking-wider text-cyan-300 uppercase">
              REACTIONS: {reactionCount}
            </span>
          )}
        </div>
      )}

      {/* Contextual [F] Henshin / Ultimate Evolution, [R] Instant Finisher & [LMB] Warp Counter Callouts */}
      {(canActivateSuper || canActivateUltimateForm || canActivateUltimate || warpCounterReady) && (
        <div className="fixed inset-x-0 bottom-30 flex flex-wrap items-center justify-center gap-3">
          {warpCounterReady && (
            <div className="animate-bounce rounded-xl border-2 border-cyan-300 bg-slate-950/92 px-5 py-2 font-mono text-sm font-black tracking-widest text-cyan-200 uppercase shadow-[0_0_28px_rgba(34,211,238,0.75)]">
              ⚡ [LMB] WARP COUNTER! (CRIT 1.65×)
            </div>
          )}
          {canActivateSuper && (
            <div className="animate-pulse rounded-xl border-2 border-amber-300 bg-slate-950/90 px-5 py-2 font-mono text-sm font-black tracking-widest text-amber-300 uppercase shadow-[0_0_28px_rgba(251,191,36,0.65)]">
              ⚡ PRESS [F] — HENSHIN SUPER FORM!
            </div>
          )}
          {canActivateUltimateForm && (
            <div className="animate-pulse rounded-xl border-2 border-rose-400 bg-slate-950/92 px-5 py-2 font-mono text-sm font-black tracking-widest text-rose-300 uppercase shadow-[0_0_32px_rgba(244,63,94,0.75)]">
              ★ PRESS [F] — EVOLVE ULTIMATE FORM!
            </div>
          )}
          {canActivateUltimate && (
            <div className="animate-pulse rounded-xl border-2 border-amber-300 bg-slate-950/92 px-5 py-2 font-mono text-sm font-black tracking-widest text-amber-200 uppercase shadow-[0_0_30px_rgba(251,191,36,0.7)]">
              🔥 PRESS [R] — FINISHER: {activeConfig.finisherName}!
            </div>
          )}
        </div>
      )}

      {/* Bottom Row: Rider Vital Card + 3 Gem Slots + Skill Q / Pet E / Finisher R */}
      <div className="flex items-end justify-between gap-3">
        <div
          className={`w-76 rounded-xl border bg-slate-950/85 p-3.5 font-mono shadow-2xl backdrop-blur-md ${
            formTier === 'ULTIMATE'
              ? 'border-rose-400/90 shadow-[0_0_30px_rgba(244,63,94,0.48)]'
              : formTier === 'SUPER'
                ? 'border-amber-300/80 shadow-[0_0_25px_rgba(251,191,36,0.35)]'
                : 'border-slate-700/80'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-wider text-slate-100 uppercase">
                K-DRIVER
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                  formTier === 'ULTIMATE'
                    ? 'bg-gradient-to-r from-rose-500 to-amber-300 text-slate-950'
                    : formTier === 'SUPER'
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                }`}
              >
                {formTier === 'ULTIMATE'
                  ? `★ ULTIMATE ${superFormRemaining.toFixed(1)}s`
                  : formTier === 'SUPER'
                    ? `SUPER ${superFormRemaining.toFixed(1)}s`
                    : 'BASIC FORM'}
              </span>
            </div>
            <span className="text-xs font-semibold text-emerald-300">
              {playerHp} / {playerMaxHp} HP
            </span>
          </div>

          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-300 transition-[width] duration-150"
              style={{ width: `${playerHpPct}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px]">
            <span
              className={`font-bold tracking-wider uppercase ${
                formTier === 'ULTIMATE'
                  ? 'text-rose-300'
                  : formTier === 'SUPER'
                    ? 'text-amber-300'
                    : 'text-amber-300'
              }`}
            >
              {formTier === 'ULTIMATE'
                ? 'Ultimate Power'
                : formTier === 'SUPER'
                  ? 'Overdrive -> Ult [F]'
                  : 'Driver Gauge [F]'}
            </span>
            <span
              className={`font-bold ${
                canActivateUltimateForm || canActivateSuper
                  ? 'animate-pulse text-amber-300'
                  : 'text-amber-200'
              }`}
            >
              {formTier === 'ULTIMATE'
                ? 'FREE FINISHER [R]'
                : formTier === 'SUPER'
                  ? canActivateUltimateForm
                    ? 'ULT FORM READY [F]!'
                    : `${Math.round(gaugePct)}%`
                  : `${Math.round(gaugePct)}%`}
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-[width] duration-150 ${
                formTier === 'ULTIMATE'
                  ? 'bg-gradient-to-r from-rose-500 via-fuchsia-400 to-amber-300'
                  : formTier === 'SUPER'
                    ? 'bg-gradient-to-r from-rose-500 via-amber-400 to-yellow-200'
                    : 'bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300'
              }`}
              style={{ width: `${gaugePct}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-1.5 text-[10px]">
            <span className="text-slate-400">PASSIVE ({activeConfig.pet.name})</span>
            <span className="font-semibold text-cyan-300">
              {activeConfig.pet.passiveDescription}
            </span>
          </div>
        </div>

        {/* Bottom-Center: Custom-Ordered 3 Elemental Gem Slots */}
        <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/85 px-3 py-2.5 font-mono shadow-2xl backdrop-blur-md">
          {loadoutOrder.map((gemId, idx) => {
            const cfg = getElementConfig(gemId);
            const gemLv = getGemLevel(saveRecord, gemId);
            const isActive = activeElement === gemId;
            const sCd = skillCooldowns[gemId];
            const pCd = petCooldowns[gemId];
            return (
              <div
                key={gemId}
                className={`relative flex w-32 flex-col rounded-lg border px-2.5 py-2 transition-all ${
                  isActive
                    ? GEM_ACTIVE_CLASSES[gemId]
                    : 'border-slate-700/80 bg-slate-900/75 text-slate-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                    [{idx + 1}] {gemId}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] font-bold text-amber-300">L{gemLv}</span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        sCd <= 0 ? 'bg-emerald-400' : 'bg-slate-600'
                      }`}
                    />
                    <span
                      className={`h-2 w-2 rounded-full ${
                        pCd <= 0 ? 'bg-cyan-400' : 'bg-slate-600'
                      }`}
                    />
                  </div>
                </div>
                <span className="mt-1 truncate text-[10px] font-semibold">
                  {cfg.weapon.name}
                </span>
                <span className="text-[9px] tracking-wider opacity-75 uppercase">
                  {cfg.statusApplied}
                </span>

                {!isActive && formSwitchCooldown > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-950/70 text-xs font-bold text-slate-200">
                    {formSwitchCooldown.toFixed(1)}s
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom-Right: Rider Kick (SPACE), Skill (Q), Pet Assist (E) & Instant Finisher (R) */}
        <div className="flex items-center gap-2 font-mono">
          <div
            className={`flex w-32 flex-col rounded-xl border p-2.5 shadow-xl backdrop-blur-md ${
              riderKickCooldown <= 0
                ? 'border-orange-400/85 bg-slate-950/90 text-slate-100 shadow-[0_0_18px_rgba(251,146,60,0.35)]'
                : 'border-slate-800 bg-slate-950/75 text-slate-500'
            }`}
          >
            <div className="flex items-center justify-between text-[10px]">
              <span className="rounded bg-orange-500/25 px-1.5 py-0.5 font-bold text-orange-300">
                SPACE • KICK
              </span>
              <span className="font-bold">
                {riderKickCooldown <= 0 ? 'READY' : `${riderKickCooldown.toFixed(1)}s`}
              </span>
            </div>
            <span className="mt-1.5 truncate text-xs font-bold">Rider Kick</span>
            <span className="text-[10px] text-slate-400">Flying Dive • +75 Break</span>
          </div>

          <div
            className={`flex w-32 flex-col rounded-xl border p-2.5 shadow-xl backdrop-blur-md ${
              activeSkillCd <= 0
                ? 'border-amber-400/70 bg-slate-950/85 text-slate-100'
                : 'border-slate-800 bg-slate-950/75 text-slate-500'
            }`}
          >
            <div className="flex items-center justify-between text-[10px]">
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-bold text-amber-300">
                {formTier !== 'BASIC' ? 'Q • SUPER' : 'Q • SKILL'}
              </span>
              <span className="font-bold">
                {activeSkillCd <= 0 ? 'READY' : `${activeSkillCd.toFixed(1)}s`}
              </span>
            </div>
            <span className="mt-1.5 truncate text-xs font-bold">{activeConfig.skill.name}</span>
            <span className="text-[10px] text-slate-400">
              Applies {activeConfig.statusApplied}
            </span>
          </div>

          <div
            className={`flex w-34 flex-col rounded-xl border p-2.5 shadow-xl backdrop-blur-md ${
              activeElementPetRemaining > 0
                ? 'border-emerald-400/90 bg-slate-950/90 text-slate-100 shadow-[0_0_20px_rgba(52,211,153,0.35)]'
                : activePetCd <= 0
                  ? 'border-cyan-400/70 bg-slate-950/85 text-slate-100'
                  : 'border-slate-800 bg-slate-950/75 text-slate-500'
            }`}
          >
            <div className="flex items-center justify-between text-[10px]">
              <span
                className={`rounded px-1.5 py-0.5 font-bold ${
                  activePetRemaining > 0
                    ? 'bg-emerald-400/25 text-emerald-300'
                    : 'bg-cyan-500/20 text-cyan-300'
                }`}
              >
                {activePetCount > 1 ? `E • PET ×${activePetCount}` : 'E • PET'}
              </span>
              <span
                className={`font-bold ${
                  activeElementPetRemaining > 0 ? 'text-emerald-300' : ''
                }`}
              >
                {activeElementPetRemaining > 0
                  ? 'ACTIVE'
                  : activePetCd <= 0
                    ? 'READY'
                    : `${activePetCd.toFixed(1)}s`}
              </span>
            </div>
            <span className="mt-1.5 truncate text-xs font-bold">{activeConfig.pet.name}</span>
            <span
              className={`text-[10px] ${
                activeElementPetRemaining > 0
                  ? 'font-bold text-emerald-300'
                  : activePetRemaining > 0
                    ? 'text-cyan-300'
                    : 'text-slate-400'
              }`}
            >
              {activeElementPetRemaining > 0
                ? `★ FOLLOW ${activeElementPetRemaining.toFixed(1)}s`
                : activePetCd > 0
                  ? 'Recharging (20s CD)'
                  : activePetRemaining > 0
                    ? `Ready • ${activePetCount} Active`
                    : `Assist + ${activeConfig.pet.appliesStatus}`}
            </span>
          </div>

          <div
            className={`flex w-34 flex-col rounded-xl border p-2.5 shadow-xl backdrop-blur-md ${
              canActivateUltimate
                ? 'border-rose-400 bg-rose-950/80 text-amber-100 shadow-[0_0_22px_rgba(244,63,94,0.5)]'
                : formTier !== 'BASIC'
                  ? 'border-amber-500/40 bg-slate-950/80 text-slate-400'
                  : 'border-slate-800 bg-slate-950/75 text-slate-500'
            }`}
          >
            <div className="flex items-center justify-between text-[10px]">
              <span
                className={`rounded px-1.5 py-0.5 font-bold ${
                  canActivateUltimate
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                R • FINISH
              </span>
              <span className="font-bold">
                {canActivateUltimate
                  ? 'READY!'
                  : formTier === 'BASIC'
                    ? 'SUPER'
                    : `${finisherCooldown.toFixed(1)}s`}
              </span>
            </div>
            <span className="mt-1.5 truncate text-xs font-bold">{activeConfig.finisherName}</span>
            <span className="text-[10px] text-slate-400">
              {formTier === 'ULTIMATE'
                ? 'Free • 1.3× Power'
                : formTier === 'SUPER'
                  ? 'Instant • -7s Super'
                  : 'Need Super Form'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

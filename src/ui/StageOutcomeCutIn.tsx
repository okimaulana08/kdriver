import { useGameStore } from '../store/useGameStore';

/**
 * Full-screen 2.35s Tokusatsu Stage Outcome Cut-In played in dramatic slow-motion orbit
 * immediately before the Mission Debrief Result HUD appears.
 */
export function StageOutcomeCutIn() {
  const cutIn = useGameStore((s) => s.stageOutcomeCutIn);
  if (!cutIn) return null;

  const isVictory = cutIn.victory;
  const accent = isVictory ? '#fbbf24' : '#f43f5e';
  const secondary = isVictory ? '#22d3ee' : '#9f1239';

  return (
    <div
      key={cutIn.id}
      className="pointer-events-none fixed inset-0 z-35 overflow-hidden select-none"
    >
      {/* Atmospheric Screen Tint */}
      <div
        className="absolute inset-0"
        style={{
          background: isVictory
            ? 'radial-gradient(ellipse at center, rgba(251,191,36,0.18) 0%, rgba(2,6,23,0.72) 78%)'
            : 'radial-gradient(ellipse at center, rgba(225,29,72,0.28) 0%, rgba(2,6,23,0.85) 75%)',
        }}
      />

      {/* Slanted Full-Width Dramatic Cut-In Band */}
      <div
        className="animate-outcome-ribbon absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{
          background: isVictory
            ? 'linear-gradient(108deg, rgba(2,6,23,0.92) 0%, rgba(14,116,144,0.42) 48%, rgba(217,119,6,0.35) 100%)'
            : 'linear-gradient(108deg, rgba(2,6,23,0.95) 0%, rgba(136,19,55,0.55) 52%, rgba(2,6,23,0.96) 100%)',
        }}
      >
        {/* High-Speed Diagonal Speedlines */}
        <div className="animate-cutin-speedlines absolute inset-[-10%] opacity-55 mix-blend-screen" />

        {/* Subtle Live-Action Rider Visor Silhouette on Right Edge */}
        <img
          src="/assets/textures/cutin_rider_visor.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-right opacity-30 mix-blend-lighten"
          style={{
            filter: isVictory
              ? 'hue-rotate(28deg) contrast(1.2) saturate(1.15)'
              : 'grayscale(0.55) contrast(1.35) brightness(0.75)',
          }}
        />

        {/* Slanted Razor Top & Bottom Accent Borders */}
        <div
          className="absolute inset-x-[-8%] top-[20%] h-[60%] -skew-y-3 overflow-hidden border-y-4"
          style={{
            borderColor: accent,
            boxShadow: `0 0 55px ${accent}77, inset 0 0 80px ${secondary}55`,
          }}
        >
          {/* Animated Light Sheen Beam */}
          <span
            className="animate-henshin-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3"
            style={{
              background: `linear-gradient(90deg, transparent, ${accent}55, transparent)`,
            }}
          />

          {/* Warning Chevron Strip for Defeat */}
          {!isVictory && (
            <div
              className="absolute inset-x-0 bottom-0 h-3 opacity-60"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(-45deg, #f43f5e 0px, #f43f5e 12px, #020617 12px, #020617 24px)',
              }}
            />
          )}
        </div>

        {/* Center Typography Slam */}
        <div className="animate-outcome-title relative z-10 flex flex-col items-center px-10 text-center">
          <div className="flex items-center gap-3">
            <span
              className="game-skew-cta px-4 py-1 font-game-display text-xs font-black tracking-[0.3em] uppercase"
              style={{
                backgroundColor: accent,
                color: isVictory ? '#020617' : '#ffffff',
                boxShadow: `0 0 24px ${accent}aa`,
              }}
            >
              {isVictory ? '★ MISSION ACCOMPLISHED ★' : '⚠ K-DRIVER SYSTEM CRITICAL'}
            </span>
          </div>

          <h1
            className="mt-3 font-game-display text-6xl leading-none font-black tracking-wider text-white uppercase italic md:text-8xl"
            style={{
              textShadow: `0 0 36px ${accent}, 0 8px 28px rgba(0,0,0,0.95)`,
            }}
          >
            {isVictory ? 'STAGE CLEARED!' : 'MISSION FAILED'}
          </h1>

          <div className="mt-4 flex items-center gap-3">
            <div
              className="h-1 w-24 rounded-full"
              style={{ background: `linear-gradient(90deg, transparent, ${accent})` }}
            />
            <span className="font-game-ui text-sm font-bold tracking-[0.32em] text-slate-100 uppercase">
              {isVictory
                ? `${cutIn.stageName} // ALL THREATS NEUTRALIZED`
                : `${cutIn.stageName} // RIDER DEFEATED`}
            </span>
            <div
              className="h-1 w-24 rounded-full"
              style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
            />
          </div>
        </div>
      </div>

      {/* Cinema Letterbox Framing Bars */}
      <div className="animate-cutin-letterbox fixed inset-x-0 top-0 flex h-14 origin-top items-center justify-between border-b border-white/15 bg-slate-950/95 px-8">
        <span
          className="font-game-display text-[11px] font-black tracking-[0.34em] uppercase"
          style={{ color: accent }}
        >
          {isVictory ? '★ K-DRIVER OPERATION COMPLETE ★' : '⚠ EMERGENCY DISENGAGE ⚠'}
        </span>
        <span className="font-game-ui text-[11px] font-bold tracking-[0.26em] text-slate-400 uppercase">
          {cutIn.stageName}
        </span>
      </div>
      <div className="animate-cutin-letterbox fixed inset-x-0 bottom-0 flex h-14 origin-bottom items-center justify-center border-t border-white/15 bg-slate-950/95 px-8">
        <span className="font-game-ui text-[11px] font-bold tracking-[0.28em] text-slate-300 uppercase">
          COMPILING TACTICAL BATTLE DEBRIEF...
        </span>
      </div>
    </div>
  );
}

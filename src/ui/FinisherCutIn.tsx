import { useState } from 'react';
import { getElementConfig } from '../game/data/elements';
import type { ElementId } from '../game/types/schema';

interface FinisherCutInProps {
  elementId: ElementId;
  finisherTitle: string;
  fromUltimate: boolean;
}

const CUTIN_VISOR_ART_URL = '/assets/textures/cutin_rider_visor.jpg';

/** Calibrated CSS hue-rotate degrees from native Pyro Crimson -> each of the 10 Element palettes */
const CUTIN_HUE_ROTATE_DEG: Readonly<Record<ElementId, number>> = {
  pyro: 0,
  volt: 46,
  aqua: 196,
  terra: 26,
  aero: 162,
  flora: 118,
  solar: 22,
  lunar: 238,
  umbra: 276,
  lux: 48,
};

/**
 * Hybrid 3-Beat Tokusatsu Ultimate Finisher Overlay (3.5s GPU-accelerated CSS timeline, ZERO per-frame React re-renders):
 * - Beat 1 (0.00s - 1.45s): Full-screen slanted Tokusatsu Cut-In (diagonal speedlines + Ultimate Visor close-up + giant angled typography)
 * - Beat 2 (1.45s - 2.45s): Diagonal white-hot energy slash wipe + 2-frame Anime Impact Flash unveiling the Domain-Dimmed 3D Arena Climax!
 * - Beat 3 (2.45s - 3.50s): Sleek cinema letterbox bars framing the Back-Turned Rider Explosion Pose.
 */
export function FinisherCutIn({
  elementId,
  finisherTitle,
  fromUltimate,
}: FinisherCutInProps) {
  const [hasCustomArt, setHasCustomArt] = useState(true);
  const cfg = getElementConfig(elementId);
  const primary = cfg.primaryColor;
  const emissive = cfg.emissiveColor;
  const hueDeg = CUTIN_HUE_ROTATE_DEG[elementId];

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden select-none">
      {/* Beat 1 (0.0s - 1.45s): Full-Screen Slanted Tokusatsu Cut-In Stage */}
      <div
        className="animate-cutin-stage absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{
          background: `radial-gradient(ellipse at 52% 48%, ${primary}cc 0%, #030712f2 68%, #020617 100%)`,
        }}
      >
        {/* High-Velocity Diagonal Tokusatsu Speedlines */}
        <div className="animate-cutin-speedlines absolute inset-[-10%] opacity-65 mix-blend-screen" />

        {/* Elemental Energy Bands Framing the Cut-In Strip */}
        <div
          className="absolute inset-x-[-8%] top-[14%] h-[72%] -skew-y-3 overflow-hidden border-y-4 shadow-[0_0_80px_rgba(0,0,0,0.9)]"
          style={{
            borderColor: emissive,
            background: `linear-gradient(105deg, #020617f5 0%, ${primary}55 48%, #020617f5 100%)`,
            boxShadow: `0 0 60px ${emissive}88, inset 0 0 90px ${primary}66`,
          }}
        >
          {/* Layer A: Live-Action Photorealistic Ultimate Rider Visor Illustration (with automatic fallback) */}
          <div className="animate-cutin-visor absolute inset-0 flex items-center justify-center">
            {hasCustomArt ? (
              <div className="relative h-full w-full">
                <img
                  src={CUTIN_VISOR_ART_URL}
                  alt="Ultimate Rider Visor Cut-In"
                  onError={() => setHasCustomArt(false)}
                  className="h-full w-full object-cover object-right md:object-center"
                  style={{
                    filter:
                      hueDeg === 0
                        ? 'contrast(1.12) saturate(1.12)'
                        : `hue-rotate(${hueDeg}deg) contrast(1.14) saturate(1.22)`,
                  }}
                />
                {/* Subtle Elemental Back-Rim & Spark Accent (preserves rich obsidian blacks & gold metallic speculars!) */}
                <div
                  className="absolute inset-0 mix-blend-screen opacity-28"
                  style={{
                    background: `radial-gradient(circle at 66% 45%, ${emissive} 0%, transparent 52%)`,
                  }}
                />
              </div>
            ) : (
              <svg
                viewBox="0 0 1600 680"
                className="h-full w-full object-cover"
                preserveAspectRatio="xMidYMid slice"
              >
                <defs>
                  <radialGradient id={`eyeGlow-${elementId}`} cx="50%" cy="50%" r="55%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="32%" stopColor={emissive} />
                    <stop offset="78%" stopColor={primary} />
                    <stop offset="100%" stopColor="#020617" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient id={`helmMetal-${elementId}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#1e293b" />
                    <stop offset="45%" stopColor={primary} stopOpacity="0.65" />
                    <stop offset="100%" stopColor="#020617" />
                  </linearGradient>
                  <linearGradient id={`goldCrest-${elementId}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#fef08a" />
                    <stop offset="50%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#fef08a" />
                  </linearGradient>
                  <pattern
                    id={`hexEye-${elementId}`}
                    width="18"
                    height="16"
                    patternUnits="userSpaceOnUse"
                  >
                    <polygon
                      points="9,0 18,4 18,12 9,16 0,12 0,4"
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity="0.35"
                      strokeWidth="1.2"
                    />
                  </pattern>
                </defs>

                {/* Dramatic Backburst Halo */}
                <circle cx="980" cy="340" r="420" fill={`url(#eyeGlow-${elementId})`} opacity="0.35" />

                {/* Angular Tokusatsu Helmet Armor Plates (Hero Right-Offset Portrait Composition) */}
                <g transform="translate(110, 0)">
                  {/* Outer Helmet Brow & Cheek Silhouette */}
                  <polygon
                    points="540,40 1240,40 1320,310 1160,640 620,640 460,310"
                    fill={`url(#helmMetal-${elementId})`}
                    stroke={emissive}
                    strokeWidth="3"
                    strokeOpacity="0.55"
                  />
                  {/* Swept Golden Kuuga/Ultimate Horn Crest */}
                  <polygon
                    points="890,260 660,55 745,55 890,185 1035,55 1120,55"
                    fill={`url(#goldCrest-${elementId})`}
                    opacity="0.92"
                  />
                  {/* Central Forehead O-Signal Gem */}
                  <polygon
                    points="890,192 924,250 890,304 856,250"
                    fill="#ffffff"
                    stroke={emissive}
                    strokeWidth="4"
                  />

                  {/* Left Compound Eye Visor */}
                  <polygon
                    points="565,245 842,300 818,430 612,410"
                    fill={`url(#eyeGlow-${elementId})`}
                    stroke="#ffffff"
                    strokeWidth="3.5"
                  />
                  <polygon
                    points="565,245 842,300 818,430 612,410"
                    fill={`url(#hexEye-${elementId})`}
                  />

                  {/* Right Compound Eye Visor */}
                  <polygon
                    points="1215,245 938,300 962,430 1168,410"
                    fill={`url(#eyeGlow-${elementId})`}
                    stroke="#ffffff"
                    strokeWidth="3.5"
                  />
                  <polygon
                    points="1215,245 938,300 962,430 1168,410"
                    fill={`url(#hexEye-${elementId})`}
                  />

                  {/* Crusher Jaw / Vent Lines */}
                  <polygon
                    points="740,475 890,520 1040,475 1000,595 890,625 780,595"
                    fill="#0f172a"
                    stroke="#94a3b8"
                    strokeWidth="2.5"
                    strokeOpacity="0.6"
                  />
                  <line x1="820" y1="505" x2="840" y2="590" stroke={emissive} strokeWidth="3" strokeOpacity="0.65" />
                  <line x1="890" y1="520" x2="890" y2="610" stroke={emissive} strokeWidth="3.5" strokeOpacity="0.8" />
                  <line x1="960" y1="505" x2="940" y2="590" stroke={emissive} strokeWidth="3" strokeOpacity="0.65" />

                  {/* Intense Anamorphic Visor Lens Flare Streaks */}
                  <rect x="260" y="338" width="1260" height="7" fill="#ffffff" opacity="0.72" />
                  <rect x="420" y="330" width="940" height="22" fill={emissive} opacity="0.34" />
                </g>
              </svg>
            )}
          </div>

          {/* Dark Left Scrim so Angled Giant Typography Always Reads Razor-Sharp */}
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/92 via-slate-950/55 to-transparent" />

          {/* Diagonal Tokusatsu Callout Typography Block (offset safely inside viewport past -8% skew bleed) */}
          <div className="animate-cutin-title relative z-10 flex h-full flex-col justify-center pl-[12%] pr-12 md:pl-[13%] md:pr-20">
            <div className="flex items-center gap-3">
              <span
                className="game-skew-cta px-4 py-1 font-game-display text-[11px] font-black tracking-[0.28em] text-slate-950 uppercase"
                style={{ backgroundColor: emissive }}
              >
                {fromUltimate ? 'GRAND ULTIMATE DRIVE' : 'MAXIMUM OVERDRIVE'}
              </span>
              <span className="font-game-ui text-xs font-bold tracking-[0.24em] text-slate-200 uppercase">
                {cfg.name} // {cfg.pet.name}
              </span>
            </div>

            <h1
              className="mt-3 max-w-3xl font-game-display text-5xl leading-none font-black tracking-wider text-white uppercase italic md:text-7xl"
              style={{
                textShadow: `0 0 28px ${emissive}, 0 6px 24px rgba(0,0,0,0.95)`,
              }}
            >
              {finisherTitle}
            </h1>

            <div className="mt-4 flex items-center gap-3">
              <div
                className="h-1.5 w-44 rounded-full"
                style={{
                  background: `linear-gradient(90deg, #ffffff, ${emissive}, transparent)`,
                }}
              />
              <span
                className="font-game-display text-xs font-bold tracking-[0.34em] uppercase"
                style={{ color: emissive }}
              >
                SYNCHRONIZED FINISHER ENGAGED
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Beat 1 -> Beat 2 Diagonal Blazing Slash Wipe (t = 1.40s - 1.65s) */}
      <div
        className="animate-cutin-slash fixed inset-x-[-20%] top-1/2 -mt-12 h-24"
        style={{
          background: `linear-gradient(180deg, transparent 0%, ${emissive} 28%, #ffffff 50%, ${emissive} 72%, transparent 100%)`,
          boxShadow: `0 0 60px ${emissive}, 0 0 110px #ffffff`,
        }}
      />

      {/* Beat 2 Climax 2-Frame Anime Impact Flash (t = 1.47s - 1.75s) */}
      <div
        className="animate-cutin-impact-flash fixed inset-0 mix-blend-screen"
        style={{
          background: `radial-gradient(circle at 50% 50%, #ffffff 0%, ${emissive}dd 45%, ${primary}99 100%)`,
        }}
      />

      {/* Cinema Letterbox Top & Bottom Bars Across All 3 Beats */}
      <div className="animate-cutin-letterbox fixed inset-x-0 top-0 flex h-16 origin-top items-center justify-between border-b border-white/15 bg-slate-950/95 px-8">
        <span
          className="font-game-display text-[11px] font-black tracking-[0.34em] uppercase"
          style={{ color: emissive }}
        >
          ★ {fromUltimate ? 'GRAND ULTIMATE RIDER FINISHER' : 'ULTIMATE RIDER FINISHER'} ★
        </span>
        <span className="font-game-ui text-[11px] font-bold tracking-[0.26em] text-slate-400 uppercase">
          K-DRIVER // {cfg.weapon.name}
        </span>
      </div>

      <div className="animate-cutin-letterbox fixed inset-x-0 bottom-0 flex h-16 origin-bottom items-center justify-between border-t border-white/15 bg-slate-950/95 px-8">
        <span className="font-game-ui text-[11px] font-bold tracking-[0.26em] text-slate-300 uppercase">
          CONTRACT BEAST: <strong style={{ color: emissive }}>{cfg.pet.name}</strong>
        </span>
        <div className="animate-cutin-climax-caption flex items-center gap-3">
          <span
            className="font-game-display text-lg font-black tracking-[0.18em] uppercase italic"
            style={{ color: emissive, textShadow: `0 0 18px ${emissive}` }}
          >
            ⚡ {finisherTitle}!
          </span>
        </div>
      </div>
    </div>
  );
}

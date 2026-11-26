import { motion } from 'framer-motion';

interface CyberCounterPreloaderProps {
  progress: number;
  label: string;
}

const BOOT_MODULES = [
  { id: 'WASM', label: 'RAPIER3D PHYSICS', threshold: 18 },
  { id: 'PBR', label: 'IBL & PBR MAPS', threshold: 42 },
  { id: 'RIGS', label: 'MOCAP RIDER RIGS', threshold: 70 },
  { id: 'VFX', label: 'GLSL SHADER CACHE', threshold: 92 },
] as const;

/**
 * Framer-inspired Awwwards Counter Preloader + AI Cyber Radar Loader.
 * Features oversized tabular percentage counter, razor top/bottom laser progress rails,
 * subtle dual-Rider visor backdrop flash, rotating cyber hex reticle, and diagonal split-curtain exit reveal.
 */
export function CyberCounterPreloader({ progress, label }: CyberCounterPreloaderProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  const showPhantomFlash = clamped >= 52 && clamped < 84;
  const backdropUrl = showPhantomFlash
    ? '/assets/textures/cutin_phantom_visor.jpg'
    : '/assets/textures/cutin_rider_visor.jpg';
  const accent = showPhantomFlash ? '#22d3ee' : '#f43f5e';

  return (
    <motion.div
      key="cyber-boot-preloader"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden bg-slate-950 select-none"
    >
      {/* Top & Bottom Diagonal Split-Curtain Shutters that part cleanly on exit */}
      <motion.div
        exit={{ y: '-102%' }}
        transition={{ duration: 0.46, ease: [0.76, 0, 0.24, 1] }}
        className="absolute inset-x-0 top-0 h-1/2 bg-slate-950"
      />
      <motion.div
        exit={{ y: '102%' }}
        transition={{ duration: 0.46, ease: [0.76, 0, 0.24, 1] }}
        className="absolute inset-x-0 bottom-0 h-1/2 bg-slate-950"
      />

      {/* Subtle Cycling Tokusatsu Visor Silhouette Backdrop */}
      <motion.img
        key={backdropUrl}
        src={backdropUrl}
        alt=""
        aria-hidden="true"
        initial={{ opacity: 0, scale: 1.08 }}
        animate={{ opacity: 0.24, scale: 1.02 }}
        exit={{ opacity: 0, scale: 1.12 }}
        transition={{ duration: 0.45 }}
        className="absolute inset-0 h-full w-full object-cover object-right mix-blend-lighten"
      />

      {/* Tactical Cyber Micro-Grid + Vignette */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 50% 50%, rgba(15,23,42,0.35) 0%, rgba(2,6,23,0.95) 76%), linear-gradient(rgba(56,189,248,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.06) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 42px 42px, 42px 42px',
        }}
      />

      {/* Top & Bottom Razor Laser Progress Rails */}
      <div className="absolute inset-x-0 top-0 h-1 bg-slate-900">
        <motion.div
          className="h-full"
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          style={{
            background: `linear-gradient(90deg, #06b6d4, ${accent}, #fde047)`,
            boxShadow: `0 0 22px ${accent}`,
          }}
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-900">
        <motion.div
          className="ml-auto h-full"
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          style={{
            background: `linear-gradient(270deg, #06b6d4, ${accent}, #fde047)`,
            boxShadow: `0 0 22px ${accent}`,
          }}
        />
      </div>

      {/* Main Centered Counter + AI Cyber Hex Radar Stage */}
      <motion.div
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ duration: 0.26 }}
        className="relative z-10 flex h-full w-full flex-col justify-between p-8 sm:p-12"
      >
        {/* Top System Header */}
        <div className="flex items-center justify-between font-game-ui text-[10px] font-bold tracking-[0.28em] text-slate-400 uppercase">
          <span className="flex items-center gap-2 text-cyan-300">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
            PROJECT K-DRIVER // HENSHIN ENGINE v2.4
          </span>
          <span className="hidden sm:inline">60HZ FIXED STEP • WEBGL2 PBR</span>
        </div>

        {/* Center AI Cyber Radar Scanner + Oversized Counter */}
        <div className="flex flex-col items-center justify-center gap-6 md:flex-row md:gap-12">
          {/* Rotating AI Cyber Hex Radar */}
          <div className="relative flex h-36 w-36 items-center justify-center">
            <motion.svg
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 5.5, ease: 'linear' }}
              viewBox="0 0 140 140"
              className="absolute inset-0 h-full w-full"
            >
              <circle
                cx="70"
                cy="70"
                r="62"
                fill="none"
                stroke={accent}
                strokeWidth="1.5"
                strokeDasharray="24 14 6 12"
                opacity="0.7"
              />
              <circle
                cx="70"
                cy="70"
                r="48"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1"
                strokeDasharray="10 10"
                opacity="0.55"
              />
            </motion.svg>

            <motion.svg
              animate={{ rotate: -360 }}
              transition={{ repeat: Infinity, duration: 3.4, ease: 'linear' }}
              viewBox="0 0 140 140"
              className="absolute inset-0 h-full w-full"
            >
              <polygon
                points="70,18 114,44 114,96 70,122 26,96 26,44"
                fill="none"
                stroke="#fde047"
                strokeWidth="1.5"
                strokeDasharray="32 18"
                opacity="0.65"
              />
            </motion.svg>

            <div
              className="game-hex flex h-16 w-18 items-center justify-center shadow-2xl"
              style={{
                background: `linear-gradient(135deg, ${accent}, #0f172a)`,
                boxShadow: `0 0 34px ${accent}88`,
              }}
            >
              <span className="font-game-display text-2xl font-black text-white italic">K</span>
            </div>
          </div>

          {/* Oversized Tabular Counter + Subsystem Matrix */}
          <div className="text-center md:text-left">
            <p className="font-game-display text-[10px] font-black tracking-[0.34em] text-cyan-300 uppercase">
              INITIALIZING DRIVER CORE
            </p>
            <div className="mt-1 flex items-baseline justify-center gap-1.5 md:justify-start">
              <span
                className="font-game-display text-7xl leading-none font-black tracking-tight text-white tabular-nums italic sm:text-8xl"
                style={{ textShadow: `0 0 34px ${accent}99` }}
              >
                {String(clamped).padStart(2, '0')}
              </span>
              <span
                className="font-game-display text-2xl font-black italic"
                style={{ color: accent }}
              >
                %
              </span>
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-1.5 md:justify-start">
              {BOOT_MODULES.map((mod) => {
                const online = clamped >= mod.threshold;
                return (
                  <span
                    key={mod.id}
                    className={`game-chamfer-sm px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase transition-all ${
                      online
                        ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50'
                        : 'bg-slate-900/80 text-slate-500 ring-1 ring-white/8'
                    }`}
                  >
                    {online ? '● ' : '○ '}
                    {mod.label}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Telemetry Status Readout */}
        <div className="flex items-center justify-between border-t border-white/10 pt-3 font-mono text-[10px] text-slate-300">
          <span className="truncate pr-4 uppercase">{label}</span>
          <span className="shrink-0 font-bold tracking-[0.2em] text-amber-300 uppercase">
            ARMORY STANDBY
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

import { useGameStore } from '../store/useGameStore';

export function DebugOverlay() {
  const showDebugOverlay = useGameStore((s) => s.showDebugOverlay);
  const screenMode = useGameStore((s) => s.screenMode);
  const engineStatus = useGameStore((s) => s.engineStatus);
  const fps = useGameStore((s) => s.fps);
  const frameTimeMs = useGameStore((s) => s.frameTimeMs);
  const fixedHz = useGameStore((s) => s.fixedHz);
  const timeScale = useGameStore((s) => s.timeScale);
  const hitStopActive = useGameStore((s) => s.hitStopActive);
  const pointerLocked = useGameStore((s) => s.pointerLocked);
  const playerState = useGameStore((s) => s.playerState);
  const formTier = useGameStore((s) => s.formTier);
  const isLockedOn = useGameStore((s) => s.isLockedOn);
  const audioMuted = useGameStore((s) => s.audioMuted);
  const bloomEnabled = useGameStore((s) => s.bloomEnabled);
  const bgmIntensity = useGameStore((s) => s.bgmIntensity);
  const riderRigMode = useGameStore((s) => s.riderRigMode);
  const arenaTheme = useGameStore((s) => s.arenaTheme);
  const gamepadConnected = useGameStore((s) => s.gamepadConnected);
  const lastBufferedAction = useGameStore((s) => s.lastBufferedAction);

  if (!showDebugOverlay) return null;

  const fpsColor =
    fps >= 55 ? 'text-emerald-400' : fps >= 35 ? 'text-amber-400' : 'text-rose-400';

  return (
    <div className="pointer-events-none fixed top-16 left-4 z-30 w-68 rounded-lg border border-cyan-500/35 bg-slate-950/85 p-3 font-mono text-xs shadow-xl backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-1.5">
        <div>
          <p className="text-[10px] tracking-[0.2em] text-cyan-400 uppercase">
            K-DRIVER Telemetry
          </p>
          <p className="text-xs font-bold text-slate-100">
            Phase 5 • PBR IBL • {screenMode}
          </p>
        </div>
        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 uppercase">
          {engineStatus}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-300">
        <span className="text-slate-400">FPS / Frame</span>
        <span className="text-right font-semibold">
          <span className={fpsColor}>{fps} FPS</span>{' '}
          <span className="text-slate-400">({frameTimeMs.toFixed(1)}ms)</span>
        </span>

        <span className="text-slate-400">Loop / Scale</span>
        <span className="text-right text-cyan-300">
          {fixedHz}Hz • {timeScale.toFixed(2)}x{hitStopActive ? ' [STOP]' : ''}
        </span>

        <span className="text-slate-400">FSM / Form</span>
        <span className="text-right font-bold text-amber-300">
          {playerState} • {formTier}
        </span>

        <span className="text-slate-400">Rider Rig</span>
        <span className="text-right text-[11px] font-semibold text-emerald-300">
          {riderRigMode}
        </span>

        <span className="text-slate-400">Lock / Ptr</span>
        <span className="text-right text-[11px]">
          {isLockedOn ? 'LOCK' : 'OFF'} • {pointerLocked ? 'PTR' : 'FREE'}
        </span>

        <span className="text-slate-400">Buffer / Audio</span>
        <span className="text-right text-[11px]">
          {lastBufferedAction ? lastBufferedAction.action : '—'} • {audioMuted ? 'MUTE' : 'ON'}
        </span>

        <span className="text-slate-400">Bloom / BGM</span>
        <span className="text-right text-[11px] text-cyan-300">
          {bloomEnabled ? 'ON (B)' : 'OFF (B)'} • {bgmIntensity}
        </span>

        <span className="text-slate-400">Arena / Input</span>
        <span className="text-right text-[10px] text-amber-300 uppercase">
          {arenaTheme.split('_')[0]} • {gamepadConnected ? 'PAD' : 'KBM'}
        </span>
      </div>
    </div>
  );
}

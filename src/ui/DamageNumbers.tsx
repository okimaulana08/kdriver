import type { FloatingTextKind } from '../game/types/schema';
import { useGameStore } from '../store/useGameStore';

const KIND_STYLES: Readonly<Record<FloatingTextKind, string>> = {
  normal: 'text-2xl font-black text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]',
  crit: 'text-3xl font-black text-amber-300 drop-shadow-[0_0_12px_rgba(251,191,36,0.95)]',
  reaction:
    'text-4xl font-black italic text-yellow-200 drop-shadow-[0_0_18px_rgba(56,189,248,0.95)]',
  dodge:
    'text-2xl font-black tracking-wider text-cyan-300 drop-shadow-[0_0_16px_rgba(34,211,238,0.95)]',
  playerHit: 'text-2xl font-black text-rose-400 drop-shadow-[0_0_10px_rgba(244,63,94,0.9)]',
  heal: 'text-xl font-black text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.9)]',
  info: 'text-sm font-bold tracking-widest text-indigo-300 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]',
};

export function DamageNumbers() {
  const floatingTexts = useGameStore((s) => s.floatingTexts);
  const perfectDodgeFlashId = useGameStore((s) => s.perfectDodgeFlashId);

  return (
    <>
      {perfectDodgeFlashId > 0 && (
        <div
          key={perfectDodgeFlashId}
          className="animate-perfect-dodge-flash pointer-events-none fixed inset-0 z-10 border-4 border-cyan-400/70 bg-radial from-transparent via-cyan-500/10 to-cyan-500/35"
        />
      )}

      <div className="pointer-events-none fixed inset-0 z-15 overflow-hidden">
        {floatingTexts.map((item) => (
          <div
            key={item.id}
            style={{ left: `${item.xPct}%`, top: `${item.yPct}%` }}
            className="animate-float-damage absolute flex flex-col items-center whitespace-nowrap select-none"
          >
            <span className={KIND_STYLES[item.kind]}>{item.text}</span>
            {item.subtext ? (
              <span className="mt-0.5 rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest text-amber-200 uppercase">
                {item.subtext}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

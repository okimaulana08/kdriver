import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';

interface SpotlightBeamPanelProps {
  children: ReactNode;
  accentColor: string;
  glowColor: string;
  className?: string;
  style?: CSSProperties;
  showBeam?: boolean;
  chamferClass?: 'game-chamfer' | 'game-chamfer-sm';
}

/**
 * Framer-inspired Spotlight + Traveling Border Beam Container.
 * Tracks cursor position cleanly via CSS variables (--sx, --sy) with ZERO React re-renders,
 * while a slim GPU-accelerated conic light beam sweeps around the chamfered outer edge.
 */
export function SpotlightBeamPanel({
  children,
  accentColor,
  glowColor,
  className = '',
  style,
  showBeam = true,
  chamferClass = 'game-chamfer',
}: SpotlightBeamPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--sx', `${(e.clientX - rect.left).toFixed(1)}px`);
    el.style.setProperty('--sy', `${(e.clientY - rect.top).toFixed(1)}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={`${chamferClass} group relative overflow-hidden p-[1.5px]`}
      style={{
        boxShadow: `0 16px 40px rgba(2,6,23,0.75), 0 0 24px ${accentColor}28`,
        ...style,
      }}
    >
      {/* Traveling GPU Conic Border Beam */}
      {showBeam && (
        <div
          aria-hidden="true"
          className="animate-border-beam pointer-events-none absolute -inset-[90%] opacity-85"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, transparent 255deg, ${accentColor} 300deg, ${glowColor} 338deg, #ffffff 352deg, transparent 360deg)`,
          }}
        />
      )}

      {/* Subtle static base border fallback */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-35"
        style={{ backgroundColor: accentColor }}
      />

      {/* Inner Chamfered Surface */}
      <div className={`${chamferClass} game-panel-bezel relative h-full w-full overflow-hidden ${className}`}>
        {/* Cursor-Tracking Spotlight Reflection */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(240px circle at var(--sx, 50%) var(--sy, 50%), ${glowColor}24 0%, ${accentColor}0e 42%, transparent 72%)`,
          }}
        />
        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
}

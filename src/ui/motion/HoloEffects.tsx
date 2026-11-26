import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface ShimmerTextProps {
  children: ReactNode;
  color: string;
  shimmerColor?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Framer-inspired ShimmerTextFX: periodic metallic light-glint sweep across display typography.
 */
export function ShimmerText({
  children,
  color,
  shimmerColor = '#ffffff',
  className = '',
  style,
}: ShimmerTextProps) {
  return (
    <span
      className={`animate-shimmer-text inline-block bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage: `linear-gradient(110deg, ${color} 0%, ${color} 38%, ${shimmerColor} 50%, ${color} 62%, ${color} 100%)`,
        backgroundSize: '240% 100%',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

interface HoloGlitchFlashProps {
  triggerKey: string | number;
  accentColor: string;
  className?: string;
}

/**
 * Brief 220ms Tokusatsu Holographic Glitch / RGB Chromatic Slice Flash.
 * Fires cleanly on key changes (e.g., switching Rider Unit, slotting a Ride-Card, or Core Upgrade).
 */
export function HoloGlitchFlash({
  triggerKey,
  accentColor,
  className = '',
}: HoloGlitchFlashProps) {
  return (
    <AnimatePresence>
      <motion.div
        key={String(triggerKey)}
        initial={{ opacity: 0.78, scaleY: 0.92 }}
        animate={{ opacity: 0, scaleY: 1.03 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-30 overflow-hidden mix-blend-screen ${className}`}
      >
        <div
          className="absolute inset-x-0 top-[18%] h-1.5"
          style={{
            background: `linear-gradient(90deg, transparent, #22d3ee, #ffffff, ${accentColor}, transparent)`,
            boxShadow: `0 0 18px ${accentColor}`,
          }}
        />
        <div
          className="absolute inset-x-0 top-[54%] h-3 opacity-65"
          style={{
            background: `linear-gradient(90deg, #f43f5e55, transparent 35%, ${accentColor}88 65%, #22d3ee66)`,
          }}
        />
        <div
          className="absolute inset-x-0 bottom-[20%] h-1"
          style={{
            background: `linear-gradient(90deg, transparent, #ffffff, #f43f5e, transparent)`,
          }}
        />
      </motion.div>
    </AnimatePresence>
  );
}

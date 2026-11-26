import {
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

interface MagneticGlowButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  accentColor?: string;
  glowColor?: string;
  gradient?: string;
  magneticStrength?: number;
  skewed?: boolean;
  title?: string;
}

const MAGNETIC_SPRING = { stiffness: 320, damping: 20, mass: 0.45 };

/**
 * Framer-inspired MagneticGlowButton + BorderGlow + Magic 3D CTA.
 * - Zero React re-renders on pointermove (uses MotionValues + CSS vars --mx/--my)
 * - Subtle spring magnetic attraction toward cursor + cursor-following radial spotlight
 * - Rotating conic border energy beam + diagonal specular light sheen + 3D press detent
 */
export function MagneticGlowButton({
  children,
  onClick,
  disabled = false,
  className = '',
  accentColor = '#f43f5e',
  glowColor = '#fde047',
  gradient = 'linear-gradient(105deg, #e11d48 0%, #f97316 52%, #f59e0b 100%)',
  magneticStrength = 5,
  skewed = true,
  title,
}: MagneticGlowButtonProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const springX = useSpring(rawX, MAGNETIC_SPRING);
  const springY = useSpring(rawY, MAGNETIC_SPRING);

  const handleMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    btnRef.current.style.setProperty('--mx', `${px.toFixed(1)}px`);
    btnRef.current.style.setProperty('--my', `${py.toFixed(1)}px`);
    const nx = (px / Math.max(1, rect.width) - 0.5) * 2;
    const ny = (py / Math.max(1, rect.height) - 0.5) * 2;
    rawX.set(nx * magneticStrength);
    rawY.set(ny * (magneticStrength * 0.6));
  };

  const handleMouseLeave = () => {
    rawX.set(0);
    rawY.set(0);
  };

  const style: CSSProperties = {
    background: gradient,
    boxShadow: `0 0 34px ${accentColor}77, 0 10px 24px -10px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.45)`,
  };

  return (
    <motion.button
      ref={btnRef}
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ x: springX, y: springY, ...style }}
      whileHover={disabled ? undefined : { scale: 1.024 }}
      whileTap={disabled ? undefined : { scale: 0.968, y: 1.5 }}
      transition={{ type: 'spring', stiffness: 460, damping: 28 }}
      className={`${skewed ? 'game-skew-cta' : 'game-chamfer-sm'} magnetic-glow-btn group relative cursor-pointer overflow-hidden disabled:cursor-wait disabled:opacity-50 ${className}`}
    >
      {/* Rotating Conic Energy Border Beam */}
      <span
        aria-hidden="true"
        className="animate-border-beam pointer-events-none absolute -inset-[120%] opacity-55 mix-blend-screen"
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, ${glowColor} 44deg, #ffffff 68deg, transparent 105deg, transparent 220deg, ${accentColor} 275deg, transparent 320deg)`,
        }}
      />

      {/* Inner surface mask keeping border beam crisp on the outer edge */}
      <span
        aria-hidden="true"
        className={`${skewed ? 'game-skew-cta' : 'game-chamfer-sm'} pointer-events-none absolute inset-[2px]`}
        style={{ background: gradient }}
      />

      {/* Cursor-Tracking Radial Spotlight Glow */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background: `radial-gradient(150px circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.42), ${glowColor}28 45%, transparent 72%)`,
          mixBlendMode: 'screen',
        }}
      />

      {/* Animated Diagonal Specular Sheen Sweep */}
      <span
        aria-hidden="true"
        className="animate-henshin-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent"
      />

      {/* Content */}
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
}

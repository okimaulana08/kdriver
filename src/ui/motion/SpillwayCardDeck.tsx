import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';

export interface SpillwayDeckItem {
  readonly id: string;
  readonly accentColor: string;
  readonly glowColor: string;
}

interface SpillwayCardDeckProps<T extends SpillwayDeckItem> {
  items: readonly T[];
  activeId: string;
  onActiveChange: (item: T) => void;
  renderCard: (item: T, ctx: { isFront: boolean; depth: number }) => ReactNode;
  cardHeight?: number;
  peekLayers?: number;
  peekGap?: number;
  peekShrink?: number;
  className?: string;
  ariaLabel?: string;
}

const MODE_REST = 0;
const MODE_HELD = 1;
const MODE_FALL = 2;
const SUBSTEP = 1 / 240;

interface CardBody {
  mode: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  d: number;
  vd: number;
  lx: number;
  ly: number;
  vlx: number;
  vly: number;
  alpha: number;
  age: number;
  seq: number;
}

interface PointerPress {
  id: number;
  x: number;
  y: number;
  moved: boolean;
  trail: Array<{ x: number; y: number; t: number }>;
}

interface HeldState {
  i: number;
  tx: number;
  ty: number;
  gy: number;
}

interface EngineState {
  bodies: CardBody[];
  queue: number[];
  held: HeldState | null;
  press: PointerPress | null;
  hover: boolean;
  leanX: number;
  leanY: number;
  glareX: number;
  glareY: number;
  reducedMotion: boolean;
  raf: number;
  last: number;
  carry: number;
  seq: number;
  wheelCooldown: number;
  boxW: number;
  boxH: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function unit(v: number): number {
  return clamp(v, 0, 1);
}

function freshBody(depth: number): CardBody {
  return {
    mode: MODE_REST,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 0,
    vr: 0,
    d: depth,
    vd: 0,
    lx: 0,
    ly: 0,
    vlx: 0,
    vly: 0,
    alpha: 1,
    age: 0,
    seq: 0,
  };
}

function buildQueueWithFront(count: number, frontIndex: number): number[] {
  const safeFront = count > 0 ? ((frontIndex % count) + count) % count : 0;
  const q: number[] = [];
  for (let offset = 0; offset < count; offset++) {
    q.push((safeFront + offset) % count);
  }
  return q;
}

/**
 * Native React + 240Hz Spring-Gravity Spillway 3D Card Deck.
 * Inspired by Framer's Spillway & CardStack components:
 * - Layered stacked depth cards with progressive scale-shrink & veil dimming
 * - Cursor-tracked 3D perspective hover tilt + iridescent holographic glare
 * - Tactile drag-to-throw with grab-pivot swing, velocity fling, gravity drop & automatic back-of-deck recycle
 * - Wheel scroll, keyboard arrows, and instant jump-to-card animation (zero idle RAF CPU usage)
 */
export function SpillwayCardDeck<T extends SpillwayDeckItem>({
  items,
  activeId,
  onActiveChange,
  renderCard,
  cardHeight = 166,
  peekLayers = 3,
  peekGap = 11,
  peekShrink = 0.048,
  className = '',
  ariaLabel = 'Interactive Ride-Card Deck',
}: SpillwayCardDeckProps<T>) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef<Array<HTMLDivElement | null>>([]);
  const veilEls = useRef<Array<HTMLDivElement | null>>([]);
  const glareEls = useRef<Array<HTMLDivElement | null>>([]);

  const liveRef = useRef({
    items,
    onActiveChange,
    peekLayers,
    peekGap,
    peekShrink,
  });
  liveRef.current = { items, onActiveChange, peekLayers, peekGap, peekShrink };

  const initialFront = Math.max(
    0,
    items.findIndex((it) => it.id === activeId)
  );
  const [frontIndex, setFrontIndex] = useState<number>(initialFront);

  const engineRef = useRef<EngineState | null>(null);
  if (!engineRef.current) {
    const q = buildQueueWithFront(items.length, initialFront);
    const bodies = Array.from({ length: items.length }, () => freshBody(0));
    q.forEach((idx, slot) => {
      bodies[idx]!.d = slot;
    });
    engineRef.current = {
      bodies,
      queue: q,
      held: null,
      press: null,
      hover: false,
      leanX: 0,
      leanY: 0,
      glareX: 50,
      glareY: 50,
      reducedMotion: false,
      raf: 0,
      last: 0,
      carry: 0,
      seq: 0,
      wheelCooldown: 0,
      boxW: 380,
      boxH: cardHeight,
    };
  }

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const E = engineRef.current;
    if (!frame || !E) return;
    E.boxW = frame.offsetWidth || 380;
    E.boxH = frame.offsetHeight || cardHeight;
  }, [cardHeight]);

  const leanGoal = useCallback((slot: number, axis: 'x' | 'y'): number => {
    const E = engineRef.current;
    if (!E || slot !== 0 || !E.hover || E.held || E.reducedMotion) return 0;
    return axis === 'x' ? E.leanX * 7.5 : -E.leanY * 6.2;
  }, []);

  const paint = useCallback(() => {
    const E = engineRef.current;
    if (!E) return;
    const { peekLayers: layers, peekGap: gap, peekShrink: shrink } = liveRef.current;
    const halfH = E.boxH / 2;
    const slotOf: number[] = [];
    E.queue.forEach((idx, slot) => {
      slotOf[idx] = slot;
    });

    for (let i = 0; i < E.bodies.length; i++) {
      const el = cardEls.current[i];
      const b = E.bodies[i];
      if (!el || !b) continue;

      const depth = b.mode === MODE_FALL ? 0 : Math.max(0, b.d);
      const scale = 1 - depth * shrink;
      const lift = -depth * gap - (1 - scale) * halfH * 0.55;
      let alpha = b.alpha;
      if (depth > layers) {
        alpha *= unit(1 - (depth - layers));
      }
      const veil = depth <= 0 ? 0 : 0.62 * Math.min(1, depth / Math.max(1, layers));
      const slot = slotOf[i];
      const isFront = b.mode !== MODE_FALL && slot === 0;
      const z = b.mode === MODE_FALL ? 400 - (b.seq % 200) : 100 - (slot ?? 99);

      el.style.transform =
        `translate3d(${b.x.toFixed(2)}px, ${(b.y + lift).toFixed(2)}px, 0) ` +
        `perspective(1000px) rotateX(${b.ly.toFixed(3)}deg) rotateY(${b.lx.toFixed(3)}deg) ` +
        `rotate(${b.r.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
      el.style.zIndex = String(z);
      el.style.opacity = String(alpha);
      el.style.visibility = alpha <= 0.005 ? 'hidden' : 'visible';
      el.style.pointerEvents = isFront ? 'auto' : 'none';

      const veilEl = veilEls.current[i];
      if (veilEl) {
        veilEl.style.opacity = String(veil);
      }

      const glareEl = glareEls.current[i];
      if (glareEl) {
        if (isFront && E.hover && !E.held) {
          glareEl.style.opacity = '0.62';
          glareEl.style.background = `radial-gradient(circle at ${E.glareX.toFixed(1)}% ${E.glareY.toFixed(1)}%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 36%, transparent 66%)`;
        } else {
          glareEl.style.opacity = '0';
        }
      }
    }
  }, []);

  const recycle = useCallback((idx: number) => {
    const E = engineRef.current;
    if (!E) return;
    const b = E.bodies[idx];
    if (!b) return;
    b.mode = MODE_REST;
    b.x = b.y = b.r = 0;
    b.vx = b.vy = b.vr = 0;
    b.lx = b.ly = b.vlx = b.vly = 0;
    b.alpha = 1;
    if (!E.queue.includes(idx)) {
      E.queue.push(idx);
    }
    b.d = Math.max(E.queue.length - 1, liveRef.current.peekLayers + 1);
    b.vd = 0;
  }, []);

  const snapAll = useCallback(() => {
    const E = engineRef.current;
    if (!E) return;
    for (let k = 0; k < E.bodies.length; k++) {
      if (E.bodies[k]!.mode === MODE_FALL) {
        recycle(k);
      }
    }
    E.queue.forEach((idx, slot) => {
      const b = E.bodies[idx]!;
      b.mode = MODE_REST;
      b.x = b.y = b.r = 0;
      b.vx = b.vy = b.vr = 0;
      b.lx = b.ly = b.vlx = b.vly = 0;
      b.d = slot;
      b.vd = 0;
      b.alpha = 1;
    });
    E.held = null;
  }, [recycle]);

  const integrate = useCallback(
    (dt: number) => {
      const E = engineRef.current;
      if (!E) return;
      const K = 220;
      const zeta = 0.82;
      const C = 2 * Math.sqrt(K) * zeta;
      const Kp = K * 1.3;
      const Cp = 2 * Math.sqrt(Kp) * zeta;
      const halfH = Math.max(1, E.boxH / 2);
      const heldBody = E.held ? E.bodies[E.held.i] : null;
      const pull = heldBody ? Math.min(1, Math.hypot(heldBody.x, heldBody.y) / (E.boxW * 0.72)) : 0;

      for (let slot = 0; slot < E.queue.length; slot++) {
        const b = E.bodies[E.queue[slot]!]!;
        const targetD = slot === 0 ? 0 : Math.max(0, slot - pull * 0.45);
        b.vd += (-K * (b.d - targetD) - C * b.vd) * dt;
        b.d += b.vd * dt;

        if (b.mode === MODE_HELD && E.held) {
          const kh = 540;
          const ch = 2 * Math.sqrt(kh) * 0.82;
          b.vx += (-kh * (b.x - E.held.tx) - ch * b.vx) * dt;
          b.vy += (-kh * (b.y - E.held.ty) - ch * b.vy) * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;

          const swing = -(E.held.gy / halfH) * b.vx * 0.018;
          const rt = clamp(swing + b.x * 0.032, -22, 22);
          const kr = 260;
          b.vr += (-kr * (b.r - rt) - 2 * Math.sqrt(kr) * 0.72 * b.vr) * dt;
          b.r += b.vr * dt;
        } else {
          b.vx += (-Kp * b.x - Cp * b.vx) * dt;
          b.vy += (-Kp * b.y - Cp * b.vy) * dt;
          b.vr += (-Kp * b.r - Cp * b.vr) * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.r += b.vr * dt;
        }

        const tlx = leanGoal(slot, 'x');
        const tly = leanGoal(slot, 'y');
        const kl = 175;
        const cl = 2 * Math.sqrt(kl) * 0.82;
        b.vlx += (-kl * (b.lx - tlx) - cl * b.vlx) * dt;
        b.vly += (-kl * (b.ly - tly) - cl * b.vly) * dt;
        b.lx += b.vlx * dt;
        b.ly += b.vly * dt;
      }

      // Falling / flung cards obey gravity + air drag + smooth fade out
      const gravity = 2850;
      const airLin = Math.exp(-0.4 * dt);
      const airRot = Math.exp(-1.3 * dt);
      let gone: number[] | null = null;

      for (let i = 0; i < E.bodies.length; i++) {
        const b = E.bodies[i]!;
        if (b.mode !== MODE_FALL) continue;
        b.vy += gravity * dt;
        b.vx *= airLin;
        b.vy *= airLin;
        b.vr *= airRot;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.r += b.vr * dt;
        b.age += dt;
        if (b.age > 0.09) {
          b.alpha = Math.max(0, b.alpha - dt * 3.8);
        }
        const out =
          b.alpha <= 0.01 ||
          b.age > 0.75 ||
          Math.abs(b.x) > E.boxW * 1.45 ||
          Math.abs(b.y) > E.boxH * 2.2;
        if (out) {
          (gone ??= []).push(i);
        }
      }

      if (gone) {
        for (let k = 0; k < gone.length; k++) {
          recycle(gone[k]!);
        }
      }
    },
    [leanGoal, recycle]
  );

  const restful = useCallback((): boolean => {
    const E = engineRef.current;
    if (!E || E.held) return false;
    for (let i = 0; i < E.bodies.length; i++) {
      if (E.bodies[i]!.mode === MODE_FALL) return false;
    }
    for (let slot = 0; slot < E.queue.length; slot++) {
      const b = E.bodies[E.queue[slot]!]!;
      if (
        Math.abs(b.d - slot) > 0.002 ||
        Math.abs(b.vd) > 0.01 ||
        Math.abs(b.x) > 0.06 ||
        Math.abs(b.y) > 0.06 ||
        Math.abs(b.vx) > 0.6 ||
        Math.abs(b.vy) > 0.6 ||
        Math.abs(b.r) > 0.02 ||
        Math.abs(b.vr) > 0.1 ||
        Math.abs(b.lx - leanGoal(slot, 'x')) > 0.02 ||
        Math.abs(b.ly - leanGoal(slot, 'y')) > 0.02
      ) {
        return false;
      }
    }
    return true;
  }, [leanGoal]);

  const pin = useCallback(() => {
    const E = engineRef.current;
    if (!E) return;
    E.queue.forEach((idx, slot) => {
      const b = E.bodies[idx]!;
      b.d = slot;
      b.vd = 0;
      b.x = b.y = b.r = 0;
      b.vx = b.vy = b.vr = 0;
      b.lx = leanGoal(slot, 'x');
      b.ly = leanGoal(slot, 'y');
      b.vlx = b.vly = 0;
    });
  }, [leanGoal]);

  const wake = useCallback(() => {
    const E = engineRef.current;
    if (!E || E.raf) return;
    const tick = (now: number) => {
      E.raf = 0;
      const elapsed = E.last ? Math.min(0.045, (now - E.last) / 1000) : 1 / 60;
      E.last = now;
      E.carry += elapsed;
      while (E.carry >= SUBSTEP) {
        integrate(SUBSTEP);
        E.carry -= SUBSTEP;
      }
      const still = restful();
      if (still) {
        pin();
      }
      paint();
      if (still) {
        E.last = 0;
        E.carry = 0;
      } else {
        E.raf = requestAnimationFrame(tick);
      }
    };
    E.raf = requestAnimationFrame(tick);
  }, [integrate, paint, pin, restful]);

  const notifyFront = useCallback((idx: number, emitChange: boolean) => {
    setFrontIndex(idx);
    if (emitChange) {
      const item = liveRef.current.items[idx];
      if (item) {
        liveRef.current.onActiveChange(item);
      }
    }
  }, []);

  const launchFront = useCallback(
    (vx: number, vy: number, vr: number, emitChange: boolean) => {
      const E = engineRef.current;
      if (!E || E.queue.length < 2) return;
      const dropped = E.queue.shift()!;
      const b = E.bodies[dropped]!;
      b.mode = MODE_FALL;
      b.vx = vx;
      b.vy = vy;
      b.vr = vr;
      b.alpha = 1;
      b.age = 0;
      b.seq = ++E.seq;
      if (E.held?.i === dropped) {
        E.held = null;
      }
      if (E.reducedMotion) {
        snapAll();
      }
      const nextFront = E.queue[0] ?? 0;
      notifyFront(nextFront, emitChange);
      paint();
      wake();
    },
    [notifyFront, paint, snapAll, wake]
  );

  const advance = useCallback(() => {
    launchFront(160, 260, -28, true);
  }, [launchFront]);

  const retreat = useCallback(() => {
    const E = engineRef.current;
    if (!E || E.queue.length < 2) return;
    const prevIdx = E.queue.pop()!;
    E.queue.unshift(prevIdx);
    const b = E.bodies[prevIdx]!;
    b.mode = MODE_REST;
    b.d = 0;
    b.vd = 0;
    b.x = -56;
    b.y = 115;
    b.r = -11;
    b.vx = b.vy = b.vr = 0;
    b.alpha = 1;
    if (E.reducedMotion) {
      snapAll();
    }
    notifyFront(prevIdx, true);
    paint();
    wake();
  }, [notifyFront, paint, snapAll, wake]);

  // Sync external activeId selection (e.g., clicking 10-icon quick-jump bar or Belt Slot) with Spillway fling!
  useEffect(() => {
    const E = engineRef.current;
    if (!E || items.length === 0) return;

    // Reshape bodies if item count changed
    if (E.bodies.length !== items.length) {
      const targetIdx = Math.max(
        0,
        items.findIndex((it) => it.id === activeId)
      );
      E.bodies = Array.from({ length: items.length }, () => freshBody(0));
      E.queue = buildQueueWithFront(items.length, targetIdx);
      E.queue.forEach((idx, slot) => {
        E.bodies[idx]!.d = slot;
      });
      E.held = null;
      E.press = null;
      setFrontIndex(targetIdx);
      measure();
      paint();
      return;
    }

    const targetIdx = items.findIndex((it) => it.id === activeId);
    if (targetIdx < 0 || E.queue[0] === targetIdx) return;

    // Recycle any currently falling card cleanly, then fling old front card and bring targetIdx straight to front!
    for (let k = 0; k < E.bodies.length; k++) {
      if (E.bodies[k]!.mode === MODE_FALL) {
        recycle(k);
      }
    }

    const oldFront = E.queue.shift()!;
    const targetPos = E.queue.indexOf(targetIdx);
    if (targetPos >= 0) {
      E.queue.splice(targetPos, 1);
    }
    E.queue.unshift(targetIdx);

    const oldBody = E.bodies[oldFront]!;
    oldBody.mode = MODE_FALL;
    oldBody.vx = 185;
    oldBody.vy = 210;
    oldBody.vr = -26;
    oldBody.alpha = 1;
    oldBody.age = 0;
    oldBody.seq = ++E.seq;

    const targetBody = E.bodies[targetIdx]!;
    targetBody.mode = MODE_REST;
    targetBody.d = Math.min(2, Math.max(0.85, targetBody.d));
    targetBody.x = 0;
    targetBody.y = 0;
    targetBody.r = 0;
    targetBody.alpha = 1;

    if (E.reducedMotion) {
      snapAll();
    }
    setFrontIndex(targetIdx);
    paint();
    wake();
  }, [activeId, items, measure, paint, recycle, snapAll, wake]);

  useLayoutEffect(() => {
    measure();
    paint();
  }, [measure, paint, items.length, cardHeight]);

  useEffect(() => {
    const E = engineRef.current;
    if (!E) return;
    const mq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const updateMotionPref = () => {
      E.reducedMotion = Boolean(mq?.matches);
    };
    updateMotionPref();
    mq?.addEventListener?.('change', updateMotionPref);

    const onResize = () => {
      measure();
      paint();
    };
    window.addEventListener('resize', onResize);

    return () => {
      mq?.removeEventListener?.('change', updateMotionPref);
      window.removeEventListener('resize', onResize);
      if (E.raf) {
        cancelAnimationFrame(E.raf);
        E.raf = 0;
      }
    };
  }, [measure, paint]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, [data-no-drag="true"]')) return;

    const E = engineRef.current;
    if (!E || E.queue.length < 2) return;
    measure();
    E.press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      trail: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer events
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const E = engineRef.current;
    const frame = frameRef.current;
    if (!E || !frame) return;

    if (e.pointerType === 'mouse' && !E.press) {
      const rect = frame.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nx = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        const ny = clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
        E.leanX = nx;
        E.leanY = ny;
        E.glareX = ((nx + 1) * 0.5) * 100;
        E.glareY = ((ny + 1) * 0.5) * 100;
        wake();
      }
    }

    const P = E.press;
    if (!P || P.id !== e.pointerId) return;
    const dx = e.clientX - P.x;
    const dy = e.clientY - P.y;
    P.trail.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (P.trail.length > 8) P.trail.shift();

    if (!P.moved && Math.hypot(dx, dy) > 7) {
      P.moved = true;
      const frontIdx = E.queue[0];
      if (frontIdx !== undefined) {
        const rect = frame.getBoundingClientRect();
        E.bodies[frontIdx]!.mode = MODE_HELD;
        E.held = {
          i: frontIdx,
          tx: dx,
          ty: dy,
          gy: P.y - (rect.top + rect.height / 2),
        };
      }
    }

    if (E.held) {
      E.held.tx = dx;
      E.held.ty = dy;
      wake();
    }
  };

  const releasePointer = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const E = engineRef.current;
    if (!E) return;
    const P = E.press;
    if (!P || P.id !== e.pointerId) return;
    E.press = null;

    if (!P.moved) {
      if (!cancelled) {
        advance();
      }
      wake();
      return;
    }

    const H = E.held;
    if (!H) {
      wake();
      return;
    }

    const b = E.bodies[H.i]!;
    const newest = P.trail[P.trail.length - 1]!;
    let oldest = P.trail[0]!;
    for (let k = P.trail.length - 1; k >= 0; k--) {
      if (newest.t - P.trail[k]!.t > 90) break;
      oldest = P.trail[k]!;
    }
    const span = Math.max(8, newest.t - oldest.t) / 1000;
    let vx = (newest.x - oldest.x) / span;
    let vy = (newest.y - oldest.y) / span;
    const speed = Math.hypot(vx, vy);
    const dist = Math.hypot(b.x, b.y);
    const flung = !cancelled && (speed > 420 || dist > E.boxW * 0.24);
    E.held = null;

    if (flung) {
      if (speed < 780) {
        const len = dist || 1;
        vx += (b.x / len) * (780 - speed);
        vy += (b.y / len) * (780 - speed);
      }
      const halfH = Math.max(1, E.boxH / 2);
      const spin = clamp(-(H.gy / halfH) * vx * 0.22 + vx * 0.05, -520, 520);
      b.mode = MODE_REST;
      launchFront(vx, vy, spin, true);
    } else {
      b.mode = MODE_REST;
      paint();
      wake();
    }
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const E = engineRef.current;
    if (!E || items.length < 2) return;
    const now = performance.now();
    if (now < E.wheelCooldown) return;
    if (Math.abs(e.deltaY) < 12 && Math.abs(e.deltaX) < 12) return;
    E.wheelCooldown = now + 220;
    if (e.deltaY > 0 || e.deltaX > 0) {
      advance();
    } else {
      retreat();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      advance();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      retreat();
    }
  };

  const topSpan = peekLayers * peekGap;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
      className={`relative w-full select-none outline-none ${className}`}
      style={{ paddingTop: topSpan + 2 }}
    >
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => releasePointer(e, false)}
        onPointerCancel={(e) => releasePointer(e, true)}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse' || !engineRef.current) return;
          engineRef.current.hover = true;
          wake();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse' || !engineRef.current) return;
          engineRef.current.hover = false;
          engineRef.current.leanX = 0;
          engineRef.current.leanY = 0;
          wake();
        }}
        className="relative w-full cursor-grab active:cursor-grabbing"
        style={{
          height: cardHeight,
          touchAction: 'none',
        }}
      >
        {items.map((item, idx) => {
          const isFront = idx === frontIndex;
          const depth =
            (idx - frontIndex + items.length) % Math.max(1, items.length);
          return (
            <div
              key={item.id}
              ref={(el) => {
                cardEls.current[idx] = el;
              }}
              className="game-chamfer absolute inset-0 overflow-hidden bg-[#050b18] will-change-transform"
              style={{
                transformOrigin: '50% 50%',
                backfaceVisibility: 'hidden',
                boxShadow: isFront
                  ? `0 22px 44px -16px rgba(0,0,0,0.88), 0 0 26px ${item.accentColor}44`
                  : '0 14px 28px -14px rgba(0,0,0,0.75)',
              }}
            >
              {renderCard(item, { isFront, depth })}

              {/* Iridescent 3D Holo-Glare Layer tracking mouse cursor */}
              <div
                ref={(el) => {
                  glareEls.current[idx] = el;
                }}
                className="pointer-events-none absolute inset-0 opacity-0 mix-blend-screen transition-opacity duration-200"
              />

              {/* Progressive Depth Shading Veil on stacked cards behind front */}
              <div
                ref={(el) => {
                  veilEls.current[idx] = el;
                }}
                className="pointer-events-none absolute inset-0 bg-slate-950 opacity-0"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

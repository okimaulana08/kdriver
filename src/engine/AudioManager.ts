import { Howl, Howler } from 'howler';
import type { ElementId, ReactionId } from '../game/types/schema';

export type BgmIntensity = 'OFF' | 'HUB' | 'COMBAT' | 'BOSS';

// 148 BPM Tokusatsu Synth-Rock bass & heroic lead note tables (D minor / Kamen Rider heroic scale)
const STEP_DURATION_SEC = 60 / 148 / 2; // 8th-note grid (~202ms)
const BASS_PATTERN_COMBAT = [146.83, 146.83, 174.61, 146.83, 130.81, 130.81, 164.81, 110.0];
const LEAD_PATTERN_COMBAT = [587.33, 0, 659.25, 698.46, 587.33, 0, 523.25, 440.0];
const LEAD_PATTERN_BOSS = [880.0, 698.46, 880.0, 1046.5, 987.77, 880.0, 783.99, 659.25];

interface ElementDriverVoiceSpec {
  phrase: string;
  notes: readonly [number, number, number];
  wave: OscillatorType;
}

const ELEMENT_DRIVER_VOICES: Readonly<Record<ElementId, ElementDriverVoiceSpec>> = {
  pyro: { phrase: 'PYRO!', notes: [587.33, 739.99, 880.0], wave: 'triangle' },
  volt: { phrase: 'VOLT!', notes: [659.25, 880.0, 1318.5], wave: 'sawtooth' },
  aqua: { phrase: 'AQUA!', notes: [523.25, 659.25, 1046.5], wave: 'sine' },
  terra: { phrase: 'TERRA!', notes: [293.66, 369.99, 440.0], wave: 'triangle' },
  aero: { phrase: 'AERO!', notes: [698.46, 880.0, 1396.91], wave: 'sine' },
  flora: { phrase: 'FLORA!', notes: [523.25, 659.25, 783.99], wave: 'triangle' },
  solar: { phrase: 'SOLAR!', notes: [587.33, 880.0, 1174.66], wave: 'sawtooth' },
  lunar: { phrase: 'LUNAR!', notes: [493.88, 659.25, 987.77], wave: 'sine' },
  umbra: { phrase: 'UMBRA!', notes: [311.13, 392.0, 622.25], wave: 'sawtooth' },
  lux: { phrase: 'LUX!', notes: [659.25, 987.77, 1567.98], wave: 'triangle' },
};

/**
 * Tokusatsu Audio Engine combining Howler.js external clip hooks with layered
 * Web Audio procedural SFX (belt clicks, Gem chimes, Henshin jingles, elemental slashes)
 * and a dynamic 3-intensity Tokusatsu Combat BGM synthesizer (HUB -> COMBAT -> BOSS/SUPER).
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly externalHowls = new Map<string, Howl>();

  private muted = false;
  private disposed = false;

  // Dynamic BGM scheduler state
  private bgmIntensity: BgmIntensity = 'OFF';
  private bgmTimerId: ReturnType<typeof setInterval> | null = null;
  private bgmNextStepTime = 0;
  private bgmStepIndex = 0;

  public registerExternalClip(key: string, src: string, loop = false, volume = 0.6): void {
    if (this.disposed) return;
    const prev = this.externalHowls.get(key);
    prev?.unload();
    this.externalHowls.set(key, new Howl({ src: [src], loop, volume }));
  }

  public unlock(): void {
    if (this.disposed || typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.36;
      master.connect(ctx.destination);

      const bgm = ctx.createGain();
      bgm.gain.value = 0.22;
      bgm.connect(master);

      this.ctx = ctx;
      this.masterGain = master;
      this.bgmGain = bgm;
      this.noiseBuffer = this.createNoiseBuffer(ctx);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        // Ignore resume errors outside user gesture.
      });
    }

    if (this.bgmIntensity !== 'OFF' && this.bgmTimerId === null) {
      this.startBgmScheduler();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    Howler.mute(muted);
    if (muted) {
      this.cancelDriverSpeech();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.36, this.ctx.currentTime, 0.015);
    }
  }

  public get isMuted(): boolean {
    return this.muted;
  }

  public get currentBgmIntensity(): BgmIntensity {
    return this.bgmIntensity;
  }

  public setBgmIntensity(intensity: BgmIntensity): void {
    if (this.bgmIntensity === intensity) return;
    this.bgmIntensity = intensity;

    if (intensity === 'OFF') {
      this.stopBgmScheduler();
      return;
    }

    if (this.bgmGain && this.ctx) {
      const targetVol = intensity === 'BOSS' ? 0.28 : intensity === 'COMBAT' ? 0.22 : 0.11;
      this.bgmGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.15);
    }

    if (this.ctx && this.ctx.state === 'running' && this.bgmTimerId === null) {
      this.startBgmScheduler();
    }
  }

  /**
   * Element-aware Tokusatsu slash / bow twang / dual-pistol plasma burst SFX across all 10 elements.
   */
  public playSlash(comboStep: 1 | 2 | 3, element: ElementId = 'pyro'): void {
    const ext = this.externalHowls.get(`slash_${element}`);
    if (ext && !this.muted) {
      ext.play();
      return;
    }

    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Dedicated Flora Verdant Longbow elastic string twang + feathered arrow release
    if (element === 'flora') {
      const twang = ctx.createOscillator();
      twang.type = 'triangle';
      twang.frequency.setValueAtTime(comboStep === 3 ? 340 : 280, now);
      twang.frequency.exponentialRampToValueAtTime(118, now + 0.14);
      const tGain = ctx.createGain();
      tGain.gain.setValueAtTime(0.001, now);
      tGain.gain.linearRampToValueAtTime(0.32, now + 0.01);
      tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      twang.connect(tGain);
      tGain.connect(out);
      twang.start(now);
      twang.stop(now + 0.19);

      if (this.noiseBuffer) {
        const zip = ctx.createBufferSource();
        zip.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(3400, now);
        bp.frequency.exponentialRampToValueAtTime(1200, now + 0.12);
        bp.Q.value = 3.2;
        const zGain = ctx.createGain();
        zGain.gain.setValueAtTime(0.32, now);
        zGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        zip.connect(bp);
        bp.connect(zGain);
        zGain.connect(out);
        zip.start(now);
        zip.stop(now + 0.14);
      }
      return;
    }

    // Dedicated Umbra Twin Energy-Pistol plasma shots (comboStep 3 = double-tap twin salvo!)
    if (element === 'umbra') {
      const shots = comboStep === 3 ? 2 : 1;
      for (let s = 0; s < shots; s++) {
        const t = now + s * 0.068;
        const pew = ctx.createOscillator();
        pew.type = 'sawtooth';
        pew.frequency.setValueAtTime(comboStep === 2 ? 1280 : 1480, t);
        pew.frequency.exponentialRampToValueAtTime(210, t + 0.095);

        const pGain = ctx.createGain();
        pGain.gain.setValueAtTime(0.001, t);
        pGain.gain.linearRampToValueAtTime(0.28, t + 0.008);
        pGain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

        pew.connect(pGain);
        pGain.connect(out);
        pew.start(t);
        pew.stop(t + 0.12);

        if (this.noiseBuffer) {
          const snap = ctx.createBufferSource();
          snap.buffer = this.noiseBuffer;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.setValueAtTime(2200, t);
          const sGain = ctx.createGain();
          sGain.gain.setValueAtTime(0.26, t);
          sGain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
          snap.connect(hp);
          hp.connect(sGain);
          sGain.connect(out);
          snap.start(t);
          snap.stop(t + 0.06);
        }
      }
      return;
    }

    if (this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const elemShift =
        element === 'volt' || element === 'lux'
          ? 650
          : element === 'aqua' || element === 'terra'
            ? -250
            : 0;
      const startFreq = (comboStep === 3 ? 1600 : comboStep === 2 ? 2100 : 1850) + elemShift;
      const endFreq = (comboStep === 3 ? 280 : 420) + Math.max(0, elemShift * 0.25);
      filter.frequency.setValueAtTime(Math.max(200, startFreq), now);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(150, endFreq),
        now + (comboStep === 3 ? 0.22 : 0.14)
      );
      filter.Q.value = element === 'aqua' ? 2.8 : 1.6;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(comboStep === 3 ? 0.55 : 0.38, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (comboStep === 3 ? 0.24 : 0.16));

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      noise.start(now);
      noise.stop(now + 0.26);
    }

    // Distinct elemental blade tone + bright steel shimmer harmonic
    const osc = ctx.createOscillator();
    osc.type = element === 'volt' || element === 'solar' ? 'sawtooth' : element === 'aqua' ? 'sine' : 'triangle';
    const baseHz =
      element === 'volt' || element === 'lux'
        ? comboStep === 3
          ? 640
          : 820
        : element === 'aqua' || element === 'lunar'
          ? comboStep === 3
            ? 390
            : 520
          : comboStep === 3
            ? 310
            : 430;
    osc.frequency.setValueAtTime(baseHz, now);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 0.42, now + 0.16);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(comboStep === 3 ? 0.24 : 0.15, now + 0.015);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

    osc.connect(oscGain);
    oscGain.connect(out);
    osc.start(now);
    osc.stop(now + 0.19);

    // Metallic sword shimmer harmonic
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(comboStep === 3 ? 2640 : 2120, now);
    ring.frequency.exponentialRampToValueAtTime(1180, now + 0.11);
    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0.001, now);
    ringGain.gain.linearRampToValueAtTime(comboStep === 3 ? 0.12 : 0.07, now + 0.008);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    ring.connect(ringGain);
    ringGain.connect(out);
    ring.start(now);
    ring.stop(now + 0.13);
  }

  public playHitImpact(isCrit: boolean, isHeavy: boolean): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(isHeavy ? 150 : 185, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + (isHeavy ? 0.16 : 0.11));

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(isHeavy ? 0.75 : 0.55, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + (isHeavy ? 0.18 : 0.12));

    sub.connect(subGain);
    subGain.connect(out);
    sub.start(now);
    sub.stop(now + 0.2);

    if (this.noiseBuffer) {
      const crunch = ctx.createBufferSource();
      crunch.buffer = this.noiseBuffer;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(isCrit ? 1800 : 1100, now);

      const cGain = ctx.createGain();
      cGain.gain.setValueAtTime(isCrit ? 0.48 : 0.3, now);
      cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      crunch.connect(hp);
      hp.connect(cGain);
      cGain.connect(out);
      crunch.start(now);
      crunch.stop(now + 0.09);
    }

    if (isCrit) {
      const chime = ctx.createOscillator();
      chime.type = 'square';
      chime.frequency.setValueAtTime(1180, now);
      chime.frequency.exponentialRampToValueAtTime(1760, now + 0.09);

      const chimeGain = ctx.createGain();
      chimeGain.gain.setValueAtTime(0.18, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      chime.connect(chimeGain);
      chimeGain.connect(out);
      chime.start(now);
      chime.stop(now + 0.15);
    }
  }

  public playDodge(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(3400, now + 0.12);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      src.start(now);
      src.stop(now + 0.16);
    }
  }

  public playPerfectDodge(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const notes = [880, 1318.5];
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(notes[i]!, now + i * 0.035);
      osc.frequency.exponentialRampToValueAtTime(notes[i]! * 1.12, now + 0.28);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now + i * 0.035);
      gain.gain.linearRampToValueAtTime(0.26, now + i * 0.035 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

      osc.connect(gain);
      gain.connect(out);
      osc.start(now + i * 0.035);
      osc.stop(now + 0.38);
    }

    const warp = ctx.createOscillator();
    warp.type = 'triangle';
    warp.frequency.setValueAtTime(220, now);
    warp.frequency.exponentialRampToValueAtTime(52, now + 0.32);

    const warpGain = ctx.createGain();
    warpGain.gain.setValueAtTime(0.4, now);
    warpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    warp.connect(warpGain);
    warpGain.connect(out);
    warp.start(now);
    warp.stop(now + 0.36);
  }

  public playTelegraphCue(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.11;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(i === 0 ? 740 : 988, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);

      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.095);
    }
  }

  public playPlayerHurt(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.22);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playLockOn(engaged: boolean): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(engaged ? 640 : 840, now);
    osc.frequency.exponentialRampToValueAtTime(engaged ? 1120 : 480, now + 0.075);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * Iconic Tokusatsu K-DRIVER mechanical belt latch click + 10-element Gem jingle + Electronic Driver voice!
   */
  public playFormSwitch(element: ElementId, announceVoice = true): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;
    const spec = ELEMENT_DRIVER_VOICES[element];

    // 1. Crisp mechanical belt click transient
    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.setValueAtTime(1850, now);
    click.frequency.exponentialRampToValueAtTime(240, now + 0.025);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.28, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    click.connect(clickGain);
    clickGain.connect(out);
    click.start(now);
    click.stop(now + 0.035);

    // 2. Crystalline Gem chime + 3-note Tokusatsu form jingle unique to all 10 elements
    for (let i = 0; i < spec.notes.length; i++) {
      const t = now + 0.03 + i * 0.048;
      const osc = ctx.createOscillator();
      osc.type = spec.wave;
      osc.frequency.setValueAtTime(spec.notes[i]!, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.18);
    }

    if (announceVoice) {
      this.announceDriverVoice(spec.phrase, 0.92, 1.3);
    }
  }

  public playElementSkill(element: ElementId): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = element === 'volt' ? 'sawtooth' : element === 'pyro' ? 'square' : 'sine';
    const startHz = element === 'pyro' ? 180 : element === 'volt' ? 920 : 420;
    const endHz = element === 'pyro' ? 68 : element === 'volt' ? 220 : 140;
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(endHz, now + 0.34);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.38);

    if (this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(element === 'aqua' ? 750 : 1400, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.36, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(out);
      noise.start(now);
      noise.stop(now + 0.34);
    }
  }

  public playPetSummon(element: ElementId): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const startHz = element === 'pyro' ? 587 : element === 'volt' ? 740 : 440;
    const peakHz = element === 'pyro' ? 1175 : element === 'volt' ? 1480 : 880;
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(peakHz, now + 0.14);
    osc.frequency.exponentialRampToValueAtTime(startHz * 0.85, now + 0.32);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.26, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  public playReaction(reactionId: ReactionId): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(reactionId === 'STEAM_BURST' ? 140 : 190, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.35);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.65, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    sub.connect(subGain);
    subGain.connect(out);
    sub.start(now);
    sub.stop(now + 0.4);

    const sting = ctx.createOscillator();
    sting.type = reactionId === 'ELECTRO_SURGE' ? 'sawtooth' : 'triangle';
    sting.frequency.setValueAtTime(
      reactionId === 'ELECTRO_SURGE' ? 1046 : reactionId === 'OVERLOAD' ? 880 : 659,
      now
    );
    sting.frequency.exponentialRampToValueAtTime(262, now + 0.28);

    const stingGain = ctx.createGain();
    stingGain.gain.setValueAtTime(0.28, now);
    stingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    sting.connect(stingGain);
    stingGain.connect(out);
    sting.start(now);
    sting.stop(now + 0.32);
  }

  public playGuardBreak(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const notes = [1046.5, 784, 523.25];
    for (let i = 0; i < notes.length; i++) {
      const t = now + i * 0.04;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(notes[i]!, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.24, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.24);
    }
  }

  public playShardPickup(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1568, now + 0.11);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playHenshinSuper(voiceCue: string | null = 'HENSHIN! SUPER DRIVE!'): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Belt double-latch lock-in + ascending Tokusatsu Henshin fanfare + activation shockwave
    for (let c = 0; c < 2; c++) {
      const ct = now + c * 0.045;
      const latch = ctx.createOscillator();
      latch.type = 'square';
      latch.frequency.setValueAtTime(c === 0 ? 1950 : 2400, ct);
      latch.frequency.exponentialRampToValueAtTime(320, ct + 0.03);
      const lGain = ctx.createGain();
      lGain.gain.setValueAtTime(0.24, ct);
      lGain.gain.exponentialRampToValueAtTime(0.001, ct + 0.035);
      latch.connect(lGain);
      lGain.connect(out);
      latch.start(ct);
      latch.stop(ct + 0.04);
    }

    const fanfare = [392, 493.9, 587.3, 784, 1046.5];
    for (let i = 0; i < fanfare.length; i++) {
      const t = now + 0.06 + i * 0.082;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(fanfare[i]!, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.44);
    }

    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(160, now + 0.35);
    boom.frequency.exponentialRampToValueAtTime(32, now + 0.85);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.7, now + 0.35);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    boom.connect(boomGain);
    boomGain.connect(out);
    boom.start(now + 0.35);
    boom.stop(now + 0.92);

    if (voiceCue) {
      this.announceDriverVoice(voiceCue, 0.82, 1.18);
    }
  }

  public playHenshinUltimate(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Dramatic Ultimate Awakening harmonic rise + heroic brass chord + K-Driver voice!
    const chord = [293.66, 440.0, 587.33, 739.99, 880.0, 1174.66];
    for (let i = 0; i < chord.length; i++) {
      const t = now + i * 0.065;
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(chord[i]!, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.88);
    }

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(140, now + 0.28);
    sub.frequency.exponentialRampToValueAtTime(28, now + 1.05);
    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(0.75, now + 0.28);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    sub.connect(sGain);
    sGain.connect(out);
    sub.start(now + 0.28);
    sub.stop(now + 1.12);

    this.announceDriverVoice('ULTIMATE AWAKENING!', 0.74, 1.12);
  }

  public playUltimateFinisher(isGrandUltimate = false): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const riser = ctx.createOscillator();
    riser.type = 'sawtooth';
    riser.frequency.setValueAtTime(isGrandUltimate ? 110 : 140, now);
    riser.frequency.exponentialRampToValueAtTime(isGrandUltimate ? 1560 : 1280, now + 1.05);
    const rGain = ctx.createGain();
    rGain.gain.setValueAtTime(0.02, now);
    rGain.gain.linearRampToValueAtTime(isGrandUltimate ? 0.36 : 0.3, now + 1.0);
    rGain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
    riser.connect(rGain);
    rGain.connect(out);
    riser.start(now);
    riser.stop(now + 1.3);

    const chord = isGrandUltimate
      ? [293.66, 440.0, 587.33, 739.99, 880.0, 1174.66]
      : [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < chord.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = isGrandUltimate && i % 2 === 0 ? 'sawtooth' : 'triangle';
      const onset = now + 1.08 + (isGrandUltimate ? i * 0.045 : 0.07);
      osc.frequency.setValueAtTime(chord[i]!, onset);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(isGrandUltimate ? 0.2 : 0.24, onset);
      gain.gain.exponentialRampToValueAtTime(0.001, onset + (isGrandUltimate ? 1.55 : 1.25));
      osc.connect(gain);
      gain.connect(out);
      osc.start(onset);
      osc.stop(onset + 1.6);
    }

    // Grand Ultimate ONLY: dramatic sub-bass Reality Implosion Drop right before Supernova impact!
    if (isGrandUltimate) {
      const drop = ctx.createOscillator();
      drop.type = 'sine';
      drop.frequency.setValueAtTime(190, now + 1.66);
      drop.frequency.exponentialRampToValueAtTime(24, now + 2.38);
      const dGain = ctx.createGain();
      dGain.gain.setValueAtTime(0.001, now + 1.66);
      dGain.gain.linearRampToValueAtTime(0.88, now + 1.88);
      dGain.gain.exponentialRampToValueAtTime(0.001, now + 2.42);
      drop.connect(dGain);
      dGain.connect(out);
      drop.start(now + 1.66);
      drop.stop(now + 2.46);
    }

    this.announceDriverVoice(
      isGrandUltimate ? 'GRAND ULTIMATE! SOVEREIGN FINISHER!' : 'MAXIMUM DRIVE! RIDER KICK!',
      isGrandUltimate ? 0.72 : 0.78,
      isGrandUltimate ? 1.08 : 1.16
    );
  }

  public playRiderKickLaunch(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Explosive upward jet-vault whoosh + belt charge chirp + iconic "RIDER KICK!" voice
    const riser = ctx.createOscillator();
    riser.type = 'sawtooth';
    riser.frequency.setValueAtTime(210, now);
    riser.frequency.exponentialRampToValueAtTime(1180, now + 0.34);
    const rGain = ctx.createGain();
    rGain.gain.setValueAtTime(0.01, now);
    rGain.gain.linearRampToValueAtTime(0.28, now + 0.28);
    rGain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    riser.connect(rGain);
    rGain.connect(out);
    riser.start(now);
    riser.stop(now + 0.46);

    if (this.noiseBuffer) {
      const jet = ctx.createBufferSource();
      jet.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(750, now);
      bp.frequency.exponentialRampToValueAtTime(2800, now + 0.32);
      const jGain = ctx.createGain();
      jGain.gain.setValueAtTime(0.38, now);
      jGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
      jet.connect(bp);
      bp.connect(jGain);
      jGain.connect(out);
      jet.start(now);
      jet.stop(now + 0.38);
    }

    this.announceDriverVoice('RIDER KICK!', 0.84, 1.24);
  }

  public playRiderKickImpact(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Supersonic boot impact thunder + harmonic shock crack
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(220, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.52);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.82, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.56);
    sub.connect(subGain);
    subGain.connect(out);
    sub.start(now);
    sub.stop(now + 0.58);

    if (this.noiseBuffer) {
      const crack = ctx.createBufferSource();
      crack.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1600, now);
      bp.frequency.exponentialRampToValueAtTime(240, now + 0.35);
      const cGain = ctx.createGain();
      cGain.gain.setValueAtTime(0.55, now);
      cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      crack.connect(bp);
      bp.connect(cGain);
      cGain.connect(out);
      crack.start(now);
      crack.stop(now + 0.4);
    }
  }

  public playWarpCounter(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Iconic Tokusatsu Clock-Up / Warp Counter time-zip + gleaming steel slash chime
    const zip = ctx.createOscillator();
    zip.type = 'sawtooth';
    zip.frequency.setValueAtTime(2200, now);
    zip.frequency.exponentialRampToValueAtTime(280, now + 0.08);
    zip.frequency.exponentialRampToValueAtTime(1760, now + 0.18);
    const zGain = ctx.createGain();
    zGain.gain.setValueAtTime(0.28, now);
    zGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    zip.connect(zGain);
    zGain.connect(out);
    zip.start(now);
    zip.stop(now + 0.24);

    const chime = ctx.createOscillator();
    chime.type = 'triangle';
    chime.frequency.setValueAtTime(1318.5, now + 0.05);
    chime.frequency.exponentialRampToValueAtTime(1975.5, now + 0.22);
    const cGain = ctx.createGain();
    cGain.gain.setValueAtTime(0.22, now + 0.05);
    cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    chime.connect(cGain);
    cGain.connect(out);
    chime.start(now + 0.05);
    chime.stop(now + 0.3);

    this.announceDriverVoice('COUNTER!', 0.98, 1.38);
  }

  public playBossHazardErupt(bossId: string): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const isBriar = bossId === 'sylvan_sovereign';
    const osc = ctx.createOscillator();
    osc.type = isBriar ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(isBriar ? 480 : 125, now);
    osc.frequency.exponentialRampToValueAtTime(isBriar ? 110 : 34, now + 0.32);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.38);

    if (this.noiseBuffer) {
      const burst = ctx.createBufferSource();
      burst.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = isBriar ? 'bandpass' : 'lowpass';
      filter.frequency.setValueAtTime(isBriar ? 1850 : 620, now);
      const bGain = ctx.createGain();
      bGain.gain.setValueAtTime(0.45, now);
      bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      burst.connect(filter);
      filter.connect(bGain);
      bGain.connect(out);
      burst.start(now);
      burst.stop(now + 0.32);
    }
  }

  public playStageOutcome(victory: boolean): void {
    if (victory) {
      this.playHenshinSuper('STAGE CLEAR!');
    } else {
      this.playBossPhase2();
      this.announceDriverVoice('MISSION FAILED!', 0.68, 1.05);
    }
  }

  public playBossPhase2(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const roar = ctx.createOscillator();
    roar.type = 'sawtooth';
    roar.frequency.setValueAtTime(135, now);
    roar.frequency.exponentialRampToValueAtTime(42, now + 0.75);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    roar.connect(gain);
    gain.connect(out);
    roar.start(now);
    roar.stop(now + 0.82);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelDriverSpeech();
    this.stopBgmScheduler();
    for (const h of this.externalHowls.values()) {
      h.unload();
    }
    this.externalHowls.clear();
    this.noiseBuffer = null;
    this.masterGain = null;
    this.bgmGain = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {
        // Ignore close errors.
      });
      this.ctx = null;
    }
  }

  private startBgmScheduler(): void {
    if (!this.ctx || this.bgmTimerId !== null) return;
    this.bgmNextStepTime = this.ctx.currentTime + 0.05;
    this.bgmStepIndex = 0;
    this.bgmTimerId = setInterval(() => this.scheduleBgmSteps(), 90);
  }

  private stopBgmScheduler(): void {
    if (this.bgmTimerId !== null) {
      clearInterval(this.bgmTimerId);
      this.bgmTimerId = null;
    }
  }

  private scheduleBgmSteps(): void {
    if (!this.ctx || !this.bgmGain || this.muted || this.ctx.state !== 'running') return;
    if (this.bgmIntensity === 'OFF') return;

    const lookahead = 0.16;
    while (this.bgmNextStepTime < this.ctx.currentTime + lookahead) {
      this.emitBgmStep(this.bgmNextStepTime, this.bgmStepIndex);
      this.bgmStepIndex = (this.bgmStepIndex + 1) % 8;
      this.bgmNextStepTime += STEP_DURATION_SEC;
    }
  }

  private emitBgmStep(time: number, step: number): void {
    if (!this.ctx || !this.bgmGain) return;
    const ctx = this.ctx;
    const out = this.bgmGain;

    // HUB mode: atmospheric low pad pulse on downbeats
    if (this.bgmIntensity === 'HUB') {
      if (step === 0 || step === 4) {
        const pad = ctx.createOscillator();
        pad.type = 'sine';
        pad.frequency.setValueAtTime(step === 0 ? 146.83 : 110.0, time);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.18, time + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, time + STEP_DURATION_SEC * 3.8);
        pad.connect(gain);
        gain.connect(out);
        pad.start(time);
        pad.stop(time + STEP_DURATION_SEC * 4);
      }
      return;
    }

    // COMBAT & BOSS: driving 148 BPM Kamen Rider synth-rock bassline
    const bassFreq = BASS_PATTERN_COMBAT[step]!;
    const bass = ctx.createOscillator();
    bass.type = this.bgmIntensity === 'BOSS' ? 'sawtooth' : 'triangle';
    bass.frequency.setValueAtTime(bassFreq, time);
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(this.bgmIntensity === 'BOSS' ? 880 : 520, time);
    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0.28, time);
    bassGain.gain.exponentialRampToValueAtTime(0.001, time + STEP_DURATION_SEC * 0.9);
    bass.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(out);
    bass.start(time);
    bass.stop(time + STEP_DURATION_SEC);

    // Kick drum on steps 0, 4 (and syncopated 6 in BOSS intensity)
    if (step === 0 || step === 4 || (this.bgmIntensity === 'BOSS' && step === 6)) {
      const kick = ctx.createOscillator();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(125, time);
      kick.frequency.exponentialRampToValueAtTime(40, time + 0.09);
      const kGain = ctx.createGain();
      kGain.gain.setValueAtTime(0.42, time);
      kGain.gain.exponentialRampToValueAtTime(0.001, time + 0.11);
      kick.connect(kGain);
      kGain.connect(out);
      kick.start(time);
      kick.stop(time + 0.12);
    }

    // Snare / hi-hat pulse
    if (this.noiseBuffer && (step === 2 || step === 6 || (this.bgmIntensity === 'BOSS' && step % 2 === 1))) {
      const hat = ctx.createBufferSource();
      hat.buffer = this.noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(step === 2 || step === 6 ? 1800 : 5200, time);
      const hGain = ctx.createGain();
      hGain.gain.setValueAtTime(step === 2 || step === 6 ? 0.16 : 0.06, time);
      hGain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
      hat.connect(hp);
      hp.connect(hGain);
      hGain.connect(out);
      hat.start(time);
      hat.stop(time + 0.08);
    }

    // Heroic Lead Melody (escalates to high-octane octave riff in BOSS / SUPER!)
    const leadFreq =
      this.bgmIntensity === 'BOSS' ? LEAD_PATTERN_BOSS[step]! : LEAD_PATTERN_COMBAT[step]!;
    if (leadFreq > 0) {
      const lead = ctx.createOscillator();
      lead.type = this.bgmIntensity === 'BOSS' ? 'square' : 'triangle';
      lead.frequency.setValueAtTime(leadFreq, time);
      const lGain = ctx.createGain();
      lGain.gain.setValueAtTime(0.001, time);
      lGain.gain.linearRampToValueAtTime(this.bgmIntensity === 'BOSS' ? 0.12 : 0.08, time + 0.015);
      lGain.gain.exponentialRampToValueAtTime(0.001, time + STEP_DURATION_SEC * 0.92);
      lead.connect(lGain);
      lGain.connect(out);
      lead.start(time);
      lead.stop(time + STEP_DURATION_SEC);
    }
  }

  private announceDriverVoice(phrase: string, pitch = 0.86, rate = 1.24): void {
    if (
      this.muted ||
      this.disposed ||
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      return;
    }
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(phrase);
      utter.lang = 'en-US';
      utter.pitch = pitch;
      utter.rate = rate;
      utter.volume = 0.72;
      const voices = synth.getVoices();
      const preferred =
        voices.find((v) => /^en[-_]/i.test(v.lang) && /(david|mark|google us english|daniel)/i.test(v.name)) ??
        voices.find((v) => /^en[-_]/i.test(v.lang));
      if (preferred) {
        utter.voice = preferred;
      }
      synth.speak(utter);
    } catch {
      // Ignore Web Speech errors in restricted/headless contexts.
    }
  }

  private cancelDriverSpeech(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore cancel errors.
    }
  }

  private ensureReady(): { ctx: AudioContext; out: GainNode } | null {
    if (this.disposed || this.muted) return null;
    if (!this.ctx || !this.masterGain) {
      this.unlock();
    }
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') {
      return null;
    }
    return { ctx: this.ctx, out: this.masterGain };
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.35);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      channel[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}

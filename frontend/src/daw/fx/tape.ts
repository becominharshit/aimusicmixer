import type { PluginDescriptor } from '../types';
import type { AudioEnv } from '../engine/audioEnv';
import { RAMP_TC_S } from '../constants';
import { dbToGain, makeSaturationCurve } from '../utils/dsp';
import { BaseDawPlugin } from './BaseDawPlugin';
import { type GraphEnds, biquad, choice, gainNode, preset, pr, safeFreq, stereoNode } from './kit';

/**
 * Two tape machines sharing one `TapeChain`:
 *
 *   pre-gain (drive) -> pre-emphasis shelves -> WaveShaper (4x oversampled) -> de-emphasis shelves
 *     -> head-bump bell -> HF roll-off -> DC blocker -> make-up gain
 *
 * Emphasis/de-emphasis are exact inverses, so small signals pass flat, while loud HF content hits the
 * saturator harder than lows. That is what gives tape its "compressed top end" feel.
 */

interface Formulation {
  name: string;
  a: number; // saturation hardness
  b: number; // asymmetry (even harmonics)
  hfFactor: number; // HF extension relative to speed
}

const FORMULATIONS: Formulation[] = [
  { name: 'Warm Vintage', a: 2.2, b: 0.12, hfFactor: 0.85 },
  { name: 'Hi-Output', a: 1.5, b: 0.04, hfFactor: 1.15 },
  { name: 'Dark Saturated', a: 2.8, b: 0.2, hfFactor: 0.7 },
  { name: 'Modern Clean', a: 1.8, b: 0.05, hfFactor: 1.0 },
];

/** Speed index -> head-bump centre (Hz) and base HF roll-off (Hz). */
const SPEEDS = [
  { label: '7.5 ips', bump: 110, hf: 9000 },
  { label: '15 ips', bump: 62, hf: 15000 },
  { label: '30 ips', bump: 38, hf: 20000 },
];

/** EQ standards: recording time-constants expressed as corner frequencies. */
const EQ_CURVES = [
  { label: 'NAB', hiHz: 3183, hiDb: 8, loHz: 50, loDb: 6 }, // 50 us / 3180 us
  { label: 'CCIR', hiHz: 2274, hiDb: 10, loHz: 50, loDb: 0 }, // 70 us
  { label: 'AES', hiHz: 4547, hiDb: 8, loHz: 50, loDb: 0 }, // 35 us
];

class TapeChain {
  readonly head: GainNode;
  readonly tail: GainNode;
  private readonly pre: GainNode;
  private readonly post: GainNode;
  private readonly preLo: BiquadFilterNode;
  private readonly preHi: BiquadFilterNode;
  private readonly deHi: BiquadFilterNode;
  private readonly deLo: BiquadFilterNode;
  private readonly bump: BiquadFilterNode;
  private readonly lp: BiquadFilterNode;
  private current: { shaper: WaveShaperNode; gate: GainNode } | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private formulation = -1;

  constructor(private readonly env: AudioEnv) {
    const ctx = env.ctx;
    this.head = stereoNode(ctx);
    this.tail = stereoNode(ctx);
    this.pre = gainNode(ctx);
    this.post = gainNode(ctx);
    this.preLo = biquad(ctx, 'lowshelf', 50);
    this.preHi = biquad(ctx, 'highshelf', 3500);
    this.deHi = biquad(ctx, 'highshelf', 3500);
    this.deLo = biquad(ctx, 'lowshelf', 50);
    this.bump = biquad(ctx, 'peaking', 62, 1.1);
    this.lp = biquad(ctx, 'lowpass', 15000, Math.SQRT1_2);
    const dc = biquad(ctx, 'highpass', 12);

    this.head.connect(this.pre);
    this.pre.connect(this.preLo);
    this.preLo.connect(this.preHi);
    // preHi -> [shaper -> gate] -> deHi is created per formulation (see setFormulation)
    this.deHi.connect(this.deLo);
    this.deLo.connect(this.bump);
    this.bump.connect(this.lp);
    this.lp.connect(dc);
    dc.connect(this.post);
    this.post.connect(this.tail);
  }

  private makeShaper(index: number, initialGain: number): { shaper: WaveShaperNode; gate: GainNode } {
    const f = FORMULATIONS[index]!;
    const shaper = this.env.ctx.createWaveShaper();
    // A WaveShaperNode's curve may only be assigned once (per spec), so every formulation gets its own node.
    shaper.curve = makeSaturationCurve(f.a, f.b);
    shaper.oversample = '4x';
    const gate = gainNode(this.env.ctx, initialGain);
    this.preHi.connect(shaper);
    shaper.connect(gate);
    gate.connect(this.deHi);
    return { shaper, gate };
  }

  private disposePair(pair: { shaper: WaveShaperNode; gate: GainNode }): void {
    try {
      this.preHi.disconnect(pair.shaper);
      pair.shaper.disconnect();
      pair.gate.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  /** Swaps tape formulation. In realtime the new shaper fades in while the old one fades out, so it never clicks. */
  private setFormulation(index: number, immediate: boolean): void {
    const i = Math.max(0, Math.min(FORMULATIONS.length - 1, index));
    if (i === this.formulation) return;
    const old = this.current;
    const instant = immediate || this.env.offline || old === null;
    this.formulation = i;
    if (instant) {
      if (old) this.disposePair(old);
      this.current = this.makeShaper(i, 1);
      return;
    }
    const now = this.env.ctx.currentTime;
    const next = this.makeShaper(i, 0);
    next.gate.gain.setTargetAtTime(1, now, RAMP_TC_S);
    old.gate.gain.cancelScheduledValues(now);
    old.gate.gain.setTargetAtTime(0, now, RAMP_TC_S);
    this.current = next;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.disposePair(old);
    }, 250);
    this.timers.add(timer);
  }

  private set(p: AudioParam, v: number, immediate: boolean, tc?: number): void {
    if (immediate || this.env.offline) p.value = v;
    else {
      const t = this.env.ctx.currentTime;
      p.cancelScheduledValues(t);
      p.setTargetAtTime(v, t, tc ?? 0.008);
    }
  }

  configure(
    cfg: { drive: number; formulation: number; speed: number; bump: number; eq?: number },
    immediate: boolean,
  ): void {
    const e = this.env;
    const f = FORMULATIONS[cfg.formulation] ?? FORMULATIONS[0]!;
    const sp = SPEEDS[cfg.speed] ?? SPEEDS[1]!;
    const drive = cfg.drive / 100;

    this.setFormulation(cfg.formulation, immediate);
    this.set(this.pre.gain, dbToGain(drive * 20), immediate, RAMP_TC_S);
    this.set(this.post.gain, dbToGain(-drive * 20 * 0.7), immediate, RAMP_TC_S);

    if (cfg.eq === undefined) {
      this.set(this.preHi.frequency, 3500, immediate);
      this.set(this.deHi.frequency, 3500, immediate);
      this.set(this.preHi.gain, 5, immediate);
      this.set(this.deHi.gain, -5, immediate);
      this.set(this.preLo.gain, 0, immediate);
      this.set(this.deLo.gain, 0, immediate);
    } else {
      const c = EQ_CURVES[cfg.eq] ?? EQ_CURVES[0]!;
      this.set(this.preHi.frequency, safeFreq(e, c.hiHz), immediate);
      this.set(this.deHi.frequency, safeFreq(e, c.hiHz), immediate);
      this.set(this.preHi.gain, c.hiDb, immediate);
      this.set(this.deHi.gain, -c.hiDb, immediate);
      this.set(this.preLo.frequency, c.loHz, immediate);
      this.set(this.deLo.frequency, c.loHz, immediate);
      this.set(this.preLo.gain, c.loDb, immediate);
      this.set(this.deLo.gain, -c.loDb, immediate);
    }

    this.set(this.bump.frequency, sp.bump, immediate);
    this.set(this.bump.gain, (cfg.bump / 100) * 4.5, immediate);
    this.set(this.lp.frequency, safeFreq(e, sp.hf * f.hfFactor), immediate);
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    try {
      this.head.disconnect();
    } catch {
      /* ignore */
    }
  }
}

// ===========================================================================
// 11. MultitrackTapeDeck
// ===========================================================================

export const MULTITRACK_TAPE_DECK_DESCRIPTOR: PluginDescriptor = {
  id: 'multitrack-tape-deck',
  name: 'Multitrack Tape Deck',
  category: 'Tape Machines',
  description: 'Multitrack tape saturation: 4 tape formulations, 3 speeds, drive and head-bump low-end warmth.',
  hasGainReduction: false,
  latencyMs: 0,
  params: [
    choice('formulation', 'Tape', FORMULATIONS.map((f) => f.name), 0),
    choice('speed', 'Speed', SPEEDS.map((s) => s.label), 1),
    pr('drive', 'Drive', 0, 100, 30, '%', 'linear', { decimals: 0 }),
    pr('headBump', 'Head Bump', 0, 100, 50, '%', 'linear', { decimals: 0 }),
    pr('output', 'Output', -12, 12, 0, 'dB', 'linear', { decimals: 1 }),
  ],
  presets: [
    preset('drum-glue', 'Drum Glue', { formulation: 0, speed: 1, drive: 45, headBump: 55 }),
    preset('bass-warmth', 'Bass Warmth', { formulation: 2, speed: 0, drive: 40, headBump: 80 }),
    preset('vocal-sheen', 'Vocal Sheen', { formulation: 1, speed: 2, drive: 25, headBump: 25 }),
    preset('mix-bus-tape', 'Mix Bus Tape', { formulation: 3, speed: 2, drive: 20, headBump: 35 }),
    preset('lo-fi-crunch', 'Lo-Fi Crunch', { formulation: 2, speed: 0, drive: 80, headBump: 60, output: -2 }),
  ],
};

export class MultitrackTapeDeck extends BaseDawPlugin {
  private chain!: TapeChain;
  private outGain!: GainNode;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, MULTITRACK_TAPE_DECK_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    this.chain = new TapeChain(this.env);
    this.outGain = gainNode(this.ctx);
    this.chain.tail.connect(this.outGain);
    return { head: this.chain.head, tail: this.outGain };
  }

  protected applyParams(): void {
    this.chain.configure(
      { drive: this.val('drive'), formulation: this.val('formulation'), speed: this.val('speed'), bump: this.val('headBump') },
      this.initializing,
    );
    this.set(this.outGain.gain, dbToGain(this.val('output')), RAMP_TC_S);
  }

  protected override onDispose(): void {
    this.chain.dispose();
  }
}

// ===========================================================================
// 12. MasteringTapeRecorder
// ===========================================================================

export const MASTERING_TAPE_RECORDER_DESCRIPTOR: PluginDescriptor = {
  id: 'mastering-tape-recorder',
  name: 'Mastering Tape Recorder',
  category: 'Tape Machines',
  description: 'Two-track mastering recorder: NAB / CCIR / AES record-playback EQ curves, drive and output trim.',
  hasGainReduction: false,
  latencyMs: 0,
  params: [
    choice('eqCurve', 'EQ Curve', EQ_CURVES.map((c) => c.label), 0),
    choice('speed', 'Speed', ['15 ips', '30 ips'], 1),
    pr('drive', 'Drive', 0, 100, 25, '%', 'linear', { decimals: 0 }),
    pr('headBump', 'Head Bump', 0, 100, 30, '%', 'linear', { decimals: 0 }),
    pr('output', 'Output', -12, 12, 0, 'dB', 'linear', { decimals: 1 }),
  ],
  presets: [
    preset('transparent-master', 'Transparent Master', { eqCurve: 2, speed: 1, drive: 12, headBump: 15 }),
    preset('nab-warm-glue', 'NAB Warm Glue', { eqCurve: 0, speed: 0, drive: 35, headBump: 50 }),
    preset('ccir-bright-punch', 'CCIR Bright Punch', { eqCurve: 1, speed: 1, drive: 30, headBump: 25 }),
    preset('aes-air', 'AES Air', { eqCurve: 2, speed: 1, drive: 20, headBump: 20, output: 0.5 }),
  ],
};

export class MasteringTapeRecorder extends BaseDawPlugin {
  private chain!: TapeChain;
  private outGain!: GainNode;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, MASTERING_TAPE_RECORDER_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    this.chain = new TapeChain(this.env);
    this.outGain = gainNode(this.ctx);
    this.chain.tail.connect(this.outGain);
    return { head: this.chain.head, tail: this.outGain };
  }

  protected applyParams(): void {
    // Mastering machines run at 15 or 30 ips: map onto the shared speed table (indices 1 and 2).
    this.chain.configure(
      {
        drive: this.val('drive'),
        formulation: 3,
        speed: this.val('speed') + 1,
        bump: this.val('headBump'),
        eq: this.val('eqCurve'),
      },
      this.initializing,
    );
    this.set(this.outGain.gain, dbToGain(this.val('output')), RAMP_TC_S);
  }

  protected override onDispose(): void {
    this.chain.dispose();
  }
}

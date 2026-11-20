import type { ParamCurve, ParamDescriptor, ParamOption, ParamUnit, PluginPreset } from '../types';
import { RAMP_TC_S } from '../constants';
import { type AudioEnv, setParam } from '../engine/audioEnv';
import { clamp, dbToGain, makeSaturationCurve } from '../utils/dsp';

// ---------------------------------------------------------------------------
// Descriptor helpers
// ---------------------------------------------------------------------------

export function pr(
  id: string,
  label: string,
  min: number,
  max: number,
  def: number,
  unit: ParamUnit,
  curve: ParamCurve = 'linear',
  extra: Partial<ParamDescriptor> = {},
): ParamDescriptor {
  return { id, label, min, max, default: def, unit, curve, ...extra };
}

/** Stepped parameter whose value is an index into `labels`. */
export function choice(id: string, label: string, labels: string[], def = 0, group?: string): ParamDescriptor {
  const options: ParamOption[] = labels.map((l, i) => ({ value: i, label: l }));
  const d: ParamDescriptor = { id, label, min: 0, max: labels.length - 1, default: def, unit: 'enum', curve: 'stepped', step: 1, options };
  if (group) d.group = group;
  return d;
}

export function toggle(id: string, label: string, def = false, group?: string): ParamDescriptor {
  const d: ParamDescriptor = { id, label, min: 0, max: 1, default: def ? 1 : 0, unit: 'bool', curve: 'toggle', step: 1 };
  if (group) d.group = group;
  return d;
}

export function preset(id: string, name: string, values: Record<string, number>): PluginPreset {
  return { id, name, values };
}

// ---------------------------------------------------------------------------
// Parameter value helpers (clamp / normalise)
// ---------------------------------------------------------------------------

export function clampParam(d: ParamDescriptor, v: number): number {
  if (!Number.isFinite(v)) return d.default;
  const x = clamp(v, d.min, d.max);
  if (d.curve === 'toggle') return x >= 0.5 ? 1 : 0;
  if (d.curve === 'stepped') {
    if (d.options) {
      let best = d.options[0]!.value;
      let bestDist = Infinity;
      for (const o of d.options) {
        const dist = Math.abs(o.value - x);
        if (dist < bestDist) {
          best = o.value;
          bestDist = dist;
        }
      }
      return best;
    }
    const step = d.step ?? 1;
    return clamp(Math.round(x / step) * step, d.min, d.max);
  }
  if (d.step) return clamp(Math.round(x / d.step) * d.step, d.min, d.max);
  return x;
}

/** Parameter value -> 0..1 knob position (honours the log curve). */
export function paramToNormalized(d: ParamDescriptor, value: number): number {
  const v = clamp(value, d.min, d.max);
  if (d.max === d.min) return 0;
  if (d.curve === 'log' && d.min > 0) return Math.log(v / d.min) / Math.log(d.max / d.min);
  return (v - d.min) / (d.max - d.min);
}

/** 0..1 knob position -> parameter value (snapped / clamped). */
export function normalizedToParam(d: ParamDescriptor, n: number): number {
  const t = clamp(n, 0, 1);
  const raw = d.curve === 'log' && d.min > 0 ? d.min * Math.pow(d.max / d.min, t) : d.min + t * (d.max - d.min);
  return clampParam(d, raw);
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

export interface GraphEnds {
  head: AudioNode;
  tail: AudioNode;
}

export function gainNode(ctx: BaseAudioContext, value = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** A unity gain node that always carries 2 channels (mono is up-mixed to dual-mono). */
export function stereoNode(ctx: BaseAudioContext, value = 1): GainNode {
  const g = gainNode(ctx, value);
  g.channelCount = 2;
  g.channelCountMode = 'explicit';
  g.channelInterpretation = 'speakers';
  return g;
}

export function biquad(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = Math.SQRT1_2, gain = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  f.gain.value = gain;
  return f;
}

/** Connects nodes in series and returns the first/last. */
export function serial(...nodes: AudioNode[]): GraphEnds {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.connect(nodes[i + 1]!);
  return { head: nodes[0]!, tail: nodes[nodes.length - 1]! };
}

/** Keeps a filter frequency safely below Nyquist so BiquadFilterNode never receives an unstable setting. */
export function safeFreq(env: AudioEnv, hz: number): number {
  return clamp(hz, 10, env.sampleRate * 0.45);
}

// ---------------------------------------------------------------------------
// DriveStage: oversampled soft-saturator with transparent bypass at 0
// ---------------------------------------------------------------------------

export type DriveKind = 'tube' | 'soft' | 'tape';

const DRIVE_CURVES: Record<DriveKind, { a: number; b: number }> = {
  tube: { a: 1.8, b: 0.35 },
  soft: { a: 2.2, b: 0 },
  tape: { a: 2.0, b: 0.1 },
};

/**
 * Pre-gain -> WaveShaper (4x oversampled) -> DC blocker -> compensating post-gain.
 * At `amount === 0` the stage is crossfaded out so the module is fully transparent.
 */
export class DriveStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly pre: GainNode;
  private readonly post: GainNode;
  private readonly wet: GainNode;
  private readonly dry: GainNode;

  constructor(
    private readonly env: AudioEnv,
    kind: DriveKind,
    private readonly maxDriveDb = 18,
    private readonly compensation = 0.65,
  ) {
    const ctx = env.ctx;
    this.input = stereoNode(ctx);
    this.output = stereoNode(ctx);
    this.pre = gainNode(ctx);
    this.post = gainNode(ctx);
    this.wet = gainNode(ctx, 0);
    this.dry = gainNode(ctx, 1);
    const shaper = ctx.createWaveShaper();
    const c = DRIVE_CURVES[kind];
    shaper.curve = makeSaturationCurve(c.a, c.b);
    shaper.oversample = '4x';
    const dc = biquad(ctx, 'highpass', 12, Math.SQRT1_2);
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.pre);
    serial(this.pre, shaper, dc, this.post, this.wet).tail.connect(this.output);
  }

  /** `amount` is 0..1. */
  setAmount(amount: number, immediate: boolean): void {
    const a = clamp(amount, 0, 1);
    const engaged = a > 0.002;
    setParam(this.env, this.pre.gain, dbToGain(a * this.maxDriveDb), RAMP_TC_S, immediate);
    setParam(this.env, this.post.gain, dbToGain(-a * this.maxDriveDb * this.compensation), RAMP_TC_S, immediate);
    setParam(this.env, this.wet.gain, engaged ? 1 : 0, RAMP_TC_S, immediate);
    setParam(this.env, this.dry.gain, engaged ? 0 : 1, RAMP_TC_S, immediate);
  }
}

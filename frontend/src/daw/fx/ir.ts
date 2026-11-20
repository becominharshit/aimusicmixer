import { type F32, lerp, mulberry32 } from '../utils/dsp';

/** 0 = Room, 1 = Plate, 2 = Hall */
export type ReverbType = 0 | 1 | 2;

interface IrProfile {
  /** Seconds for the late field to fade in. */
  onsetSec: number;
  /** Early-reflection count and window (seconds). */
  erCount: number;
  erStart: number;
  erEnd: number;
  erGain: number;
  /** One-pole low-pass coefficient at t=0 and t=T60 (higher = brighter). Time-varying = HF decays faster. */
  brightStart: number;
  brightEnd: number;
  /** Late-field density scalar (1 = dense noise). */
  lateGain: number;
}

const PROFILES: Record<ReverbType, IrProfile> = {
  0: { onsetSec: 0.004, erCount: 14, erStart: 0.003, erEnd: 0.05, erGain: 0.9, brightStart: 0.6, brightEnd: 0.14, lateGain: 1 },
  1: { onsetSec: 0.0005, erCount: 0, erStart: 0, erEnd: 0, erGain: 0, brightStart: 0.92, brightEnd: 0.32, lateGain: 1 },
  2: { onsetSec: 0.04, erCount: 9, erStart: 0.02, erEnd: 0.11, erGain: 0.7, brightStart: 0.5, brightEnd: 0.08, lateGain: 1 },
};

export interface GeneratedIr {
  left: F32;
  right: F32;
  length: number;
}

/**
 * Deterministic procedural stereo impulse response.
 * - decorrelated noise per channel with an exponential envelope hitting -60 dB at `decaySec`
 * - frequency-dependent decay (a one-pole low-pass that darkens over time)
 * - sparse early reflections for Room and Hall
 */
export function generateImpulseResponse(type: ReverbType, decaySec: number, sampleRate: number, seed = 0xc0ffee): GeneratedIr {
  const profile = PROFILES[type] ?? PROFILES[0];
  const decay = Math.max(0.1, Math.min(8, decaySec));
  const length = Math.max(64, Math.floor(Math.min(9, decay * 1.1) * sampleRate));
  const channels = [new Float32Array(length), new Float32Array(length)];
  const k60 = 6.907755; // ln(1000): -60 dB

  for (let ch = 0; ch < 2; ch++) {
    const out = channels[ch]!;
    const rng = mulberry32(seed + ch * 7919 + type * 101);
    const onset = Math.max(1, profile.onsetSec * sampleRate);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const env = Math.exp((-k60 * t) / decay);
      const ramp = i < onset ? i / onset : 1;
      const c = lerp(profile.brightStart, profile.brightEnd, Math.min(1, t / decay));
      lp += ((rng() * 2 - 1) - lp) * c;
      out[i] = lp * env * ramp * profile.lateGain;
    }
    for (let e = 0; e < profile.erCount; e++) {
      const pos = Math.floor((profile.erStart + rng() * (profile.erEnd - profile.erStart)) * sampleRate);
      if (pos < length) {
        const sign = rng() < 0.5 ? -1 : 1;
        out[pos] = (out[pos] as number) + sign * profile.erGain * (1 - (e / profile.erCount) * 0.6);
      }
    }
    // cosine fade over the last 5 % so the buffer never ends on a step
    const fade = Math.max(1, Math.floor(length * 0.05));
    for (let i = 0; i < fade; i++) {
      const idx = length - 1 - i;
      out[idx] = (out[idx] as number) * (0.5 - 0.5 * Math.cos((Math.PI * i) / fade));
    }
  }
  return { left: channels[0]!, right: channels[1]!, length };
}

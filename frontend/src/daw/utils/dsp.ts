import { FADER_MIN_DB, METER_FLOOR_DB } from '../constants';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function newF32(length: number) {
  return new Float32Array(length);
}
/** `Float32Array<ArrayBuffer>` on TS >= 5.7 (what Web Audio APIs require); plain `Float32Array` on older TS. */
export type F32 = ReturnType<typeof newF32>;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** dB -> linear gain. Values at or below `FADER_MIN_DB` are treated as -infinity (0). */
export function dbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= FADER_MIN_DB) return 0;
  return Math.pow(10, db / 20);
}

/** Linear gain -> dB, floored at `METER_FLOOR_DB` (never -Infinity). */
export function gainToDb(gain: number, floor: number = METER_FLOOR_DB): number {
  if (!(gain > 1e-9)) return floor;
  const db = 20 * Math.log10(gain);
  return db < floor ? floor : db;
}

/** Equal-power dry/wet law. `mix` is 0..1. */
export function equalPowerMix(mix: number): { dry: number; wet: number } {
  const m = clamp(mix, 0, 1);
  return { dry: Math.cos(m * Math.PI * 0.5), wet: Math.sin(m * Math.PI * 0.5) };
}

/** Bandwidth in octaves -> biquad Q (peaking filters). */
export function bandwidthToQ(octaves: number): number {
  const x = Math.pow(2, clamp(octaves, 0.05, 8));
  return Math.sqrt(x) / (x - 1);
}

/** Deterministic PRNG so generated impulse responses are identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Soft-saturation transfer curve for a `WaveShaperNode`, defined on x in [-1, 1].
 * `y = (tanh(a*x + b) - tanh(b)) / (a * (1 - tanh(b)^2))`
 * - small-signal gain is exactly 1 (derivative at 0), so engaging the stage does not change level
 * - `drive` (a) sets how early it bends; `bias` (b) adds even harmonics (tube/tape asymmetry)
 */
export function makeSaturationCurve(drive: number, bias = 0, size = 2049) {
  const curve = new Float32Array(size);
  const a = Math.max(0.01, drive);
  const tb = Math.tanh(bias);
  const norm = a * (1 - tb * tb);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = (Math.tanh(a * x + bias) - tb) / norm;
  }
  return curve;
}

/** Peak (max abs) of a block. */
export function peakOf(data: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] as number;
    const a = v < 0 ? -v : v;
    if (a > p) p = a;
  }
  return p;
}

/** Waveform overview: max |x| per bucket across all channels, rounded to 3 decimals for compact JSON. */
export function computePeaks(channels: ArrayLike<number>[], buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  const first = channels[0];
  if (!first || first.length === 0) return out;
  const length = first.length;
  const per = length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.max(start + 1, Math.min(length, Math.floor((b + 1) * per)));
    let p = 0;
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = ch[i] as number;
        const a = v < 0 ? -v : v;
        if (a > p) p = a;
      }
    }
    out[b] = Math.round(Math.min(1, p) * 1000) / 1000;
  }
  return out;
}

export function stripExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(0, i) : fileName;
}

export function getExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

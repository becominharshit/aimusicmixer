import type { BandName, GenreType, SpectralBand } from "@/types/report";
import { computeStftPower, welchDensitySpectrum } from "./fft";

export const BAND_DEFINITIONS: Array<[BandName, string, number, number]> = [
  ["sub", "20-60", 20.0, 60.0],
  ["low", "60-250", 60.0, 250.0],
  ["low_mid", "250-800", 250.0, 800.0],
  ["high_mid", "800-4000", 800.0, 4000.0],
  ["presence", "4000-10000", 4000.0, 10000.0],
  ["air", "10000-20000", 10000.0, 20000.0],
];

export const GENRE_RELATIVE_PROFILES: Record<GenreType, Record<BandName, number>> = {
  electronic: { sub: 1.8, low: 3.0, low_mid: 0.4, high_mid: -0.4, presence: -1.6, air: -3.2 },
  pop: { sub: 0.5, low: 2.4, low_mid: 0.8, high_mid: 0.2, presence: -1.2, air: -2.7 },
  hip_hop: { sub: 3.2, low: 3.4, low_mid: 0.2, high_mid: -1.0, presence: -2.1, air: -3.7 },
  rock: { sub: -1.0, low: 2.2, low_mid: 1.6, high_mid: 1.0, presence: -1.1, air: -2.7 },
  acoustic: { sub: -2.8, low: 1.5, low_mid: 2.0, high_mid: 1.1, presence: -0.6, air: -1.2 },
  ambient: { sub: 0.8, low: 1.8, low_mid: 1.4, high_mid: -0.3, presence: -1.6, air: -2.1 },
  other: { sub: 0.8, low: 2.4, low_mid: 0.8, high_mid: 0.0, presence: -1.4, air: -2.6 },
};

export interface SpectralAnalysisResult {
  bands: SpectralBand[];
  bandPeakWindows: Record<BandName, [number, number]>;
}

function computeBandEnergies(
  channelsData: Float64Array[],
  sampleRate: number
): Record<BandName, number> {
  const nSamples = channelsData[0]?.length ?? 0;
  const nperseg = Math.min(16384, Math.max(256, nSamples));

  let avgPsd: Float64Array | null = null;
  let freqs: Float64Array | null = null;
  let df = 1.0;

  for (let c = 0; c < channelsData.length; c++) {
    const res = welchDensitySpectrum(channelsData[c], sampleRate, nperseg, Math.floor(nperseg / 2));
    freqs = res.freqs;
    df = res.df;
    if (!avgPsd) {
      avgPsd = new Float64Array(res.psd);
    } else {
      for (let k = 0; k < avgPsd.length; k++) {
        avgPsd[k] += res.psd[k];
      }
    }
  }

  if (!freqs || !avgPsd) {
    return { sub: -70, low: -70, low_mid: -70, high_mid: -70, presence: -70, air: -70 };
  }

  const nCh = Math.max(1, channelsData.length);
  for (let k = 0; k < avgPsd.length; k++) avgPsd[k] /= nCh;

  const bandEnergies = {} as Record<BandName, number>;
  const nyquist = sampleRate / 2.0;

  for (const [bandName, , fLow, fHigh] of BAND_DEFINITIONS) {
    if (fLow >= nyquist) {
      bandEnergies[bandName] = -70.0;
      continue;
    }
    const upper = Math.min(fHigh, nyquist);
    let bandPower = 0.0;
    let hasBin = false;
    for (let k = 0; k < freqs.length; k++) {
      if (freqs[k] >= fLow && freqs[k] < upper) {
        bandPower += avgPsd[k] * df;
        hasBin = true;
      }
    }
    if (!hasBin) {
      bandEnergies[bandName] = -70.0;
    } else {
      const db = 10.0 * Math.log10(Math.max(bandPower, 1e-12));
      bandEnergies[bandName] = Math.round(Math.max(-70.0, db) * 100) / 100;
    }
  }

  return bandEnergies;
}

function bandPeakWindowFromStft(
  freqs: Float64Array,
  times: Float64Array,
  frames: Float64Array[],
  sampleRate: number,
  durationSec: number,
  fLow: number,
  fHigh: number,
  windowSec = 12.0
): [number, number] {
  if (durationSec <= 2.0 || frames.length === 0) {
    return [0.0, Math.round(durationSec * 100) / 100];
  }

  const upper = Math.min(fHigh, sampleRate / 2.0);
  let kStart = -1;
  let kEnd = -1;
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] >= fLow && freqs[k] < upper) {
      if (kStart === -1) kStart = k;
      kEnd = k;
    }
  }
  if (kStart === -1) {
    return [0.0, Math.round(Math.min(durationSec, windowSec) * 100) / 100];
  }

  let peakIdx = 0;
  let peakVal = -Infinity;
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f];
    let p = 0;
    for (let k = kStart; k <= kEnd; k++) p += frame[k];
    if (p > peakVal) {
      peakVal = p;
      peakIdx = f;
    }
  }

  const centerSec = times[peakIdx] ?? 0.0;
  const half = Math.min(windowSec / 2.0, durationSec / 2.0);
  let startSec = Math.max(0.0, centerSec - half);
  const endSec = Math.min(durationSec, startSec + Math.min(windowSec, durationSec));
  if (endSec - startSec < Math.min(4.0, durationSec)) {
    startSec = Math.max(0.0, endSec - Math.min(windowSec, durationSec));
  }
  return [Math.round(startSec * 10) / 10, Math.round(endSec * 10) / 10];
}

export function buildSpectralBandsFromEnergies(
  bandEnergies: Record<BandName, number>,
  genre: GenreType = "electronic"
): SpectralBand[] {
  const meanEnergy =
    BAND_DEFINITIONS.reduce((acc, [b]) => acc + (bandEnergies[b] ?? -70.0), 0) /
    BAND_DEFINITIONS.length;
  const profile = GENRE_RELATIVE_PROFILES[genre] ?? GENRE_RELATIVE_PROFILES.other;

  return BAND_DEFINITIONS.map(([bandName, rangeHz]) => {
    const energy = bandEnergies[bandName] ?? -70.0;
    const relativeEnergy = energy - meanEnergy;
    const expectedRel = profile[bandName];
    const delta = Math.round((relativeEnergy - expectedRel) * 100) / 100;
    const expectedAbs = meanEnergy + expectedRel;
    return {
      band: bandName,
      range_hz: rangeHz,
      energy_db: energy,
      delta_vs_genre_median_db: delta,
      genre_target_low_db: Math.round((expectedAbs - 2.0) * 100) / 100,
      genre_target_high_db: Math.round((expectedAbs + 2.0) * 100) / 100,
    };
  });
}

export function computeSpectralProfile(
  channelsData: Float64Array[],
  sampleRate: number,
  genre: GenreType = "electronic"
): SpectralAnalysisResult {
  const nSamples = channelsData[0]?.length ?? 0;
  const durationSec = nSamples / Math.max(sampleRate, 1);

  let maxAbs = 0;
  for (let c = 0; c < channelsData.length; c++) {
    const ch = channelsData[c];
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > maxAbs) maxAbs = a;
    }
  }

  if (nSamples === 0 || maxAbs <= 1e-12) {
    const windows = {} as Record<BandName, [number, number]>;
    const bands: SpectralBand[] = BAND_DEFINITIONS.map(([b, r]) => {
      windows[b] = [0.0, Math.round(durationSec * 10) / 10];
      return {
        band: b,
        range_hz: r,
        energy_db: -70.0,
        delta_vs_genre_median_db: 0.0,
        genre_target_low_db: -70.0,
        genre_target_high_db: -70.0,
      };
    });
    return { bands, bandPeakWindows: windows };
  }

  const bandEnergies = computeBandEnergies(channelsData, sampleRate);
  const bands = buildSpectralBandsFromEnergies(bandEnergies, genre);
  const bandPeakWindows = {} as Record<BandName, [number, number]>;

  if (durationSec <= 2.0) {
    for (const [bandName] of BAND_DEFINITIONS) {
      bandPeakWindows[bandName] = [0.0, Math.round(durationSec * 100) / 100];
    }
  } else {
    const stftRes = computeStftPower(channelsData, sampleRate);
    for (const [bandName, , fLow, fHigh] of BAND_DEFINITIONS) {
      bandPeakWindows[bandName] = bandPeakWindowFromStft(
        stftRes.freqs,
        stftRes.times,
        stftRes.frames,
        sampleRate,
        durationSec,
        fLow,
        fHigh
      );
    }
  }

  return { bands, bandPeakWindows };
}

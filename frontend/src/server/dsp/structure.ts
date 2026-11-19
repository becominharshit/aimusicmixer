import type { SongSection } from "@/types/report";

export interface StructureResult {
  bpm: number | null;
  sections: SongSection[];
}

/**
 * Deterministic onset-strength autocorrelation BPM estimator (60-180 BPM).
 */
export function estimateBpm(channelsData: Float64Array[], sampleRate: number): number | null {
  const nSamples = channelsData[0]?.length ?? 0;
  if (nSamples === 0 || sampleRate <= 0) return null;
  const duration = nSamples / sampleRate;
  if (duration < 3.0) return null;

  const mono = new Float64Array(nSamples);
  if (channelsData.length === 1) {
    mono.set(channelsData[0]);
  } else {
    const ch0 = channelsData[0];
    const ch1 = channelsData[1];
    for (let i = 0; i < nSamples; i++) {
      mono[i] = 0.5 * (ch0[i] + ch1[i]);
    }
  }

  let peak = 0;
  for (let i = 0; i < nSamples; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
  }
  if (peak <= 1e-6) return null;

  const hop = Math.max(1, Math.round(sampleRate * 0.02)); // 20 ms hop (~50 Hz envelope)
  const win = Math.max(hop, Math.round(sampleRate * 0.04)); // 40 ms window
  const nFrames = Math.floor((nSamples - win) / hop);
  if (nFrames < 80) return null;

  const rms = new Float64Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const s = f * hop;
    let sumSq = 0;
    for (let i = s; i < s + win; i++) {
      const v = mono[i];
      sumSq += v * v;
    }
    rms[f] = Math.sqrt(sumSq / win + 1e-12);
  }

  const onset = new Float64Array(nFrames);
  let meanO = 0;
  for (let f = 1; f < nFrames; f++) {
    const diff = rms[f] - rms[f - 1];
    onset[f] = diff > 0 ? diff : 0;
    meanO += onset[f];
  }
  meanO /= nFrames;

  let varO = 0;
  for (let f = 0; f < nFrames; f++) {
    const d = onset[f] - meanO;
    varO += d * d;
  }
  const stdO = Math.sqrt(varO / nFrames);
  if (stdO <= 1e-9) return null;

  const onsetNorm = new Float64Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    onsetNorm[f] = (onset[f] - meanO) / stdO;
  }

  const envSr = sampleRate / hop;
  const minLag = Math.max(1, Math.round((envSr * 60.0) / 180.0));
  const maxLag = Math.min(Math.floor(nFrames / 2), Math.round((envSr * 60.0) / 60.0));
  if (maxLag <= minLag) return null;

  let bestLag = minLag;
  let bestScore = -1.0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let powA = 0;
    let powB = 0;
    const len = nFrames - lag;
    for (let i = 0; i < len; i++) {
      const a = onsetNorm[i];
      const b = onsetNorm[i + lag];
      dot += a * b;
      powA += a * a;
      powB += b * b;
    }
    const denom = Math.sqrt(powA * powB);
    if (denom <= 1e-12) continue;
    const score = dot / denom;
    const candBpm = (60.0 * envSr) / lag;
    const z = (candBpm - 118.0) / 32.0;
    const prior = 1.0 + 0.08 * Math.exp(-0.5 * z * z);
    const weighted = score * prior;
    if (weighted > bestScore) {
      bestScore = weighted;
      bestLag = lag;
    }
  }

  if (bestScore < 0.08) return null;

  let bpm = (60.0 * envSr) / bestLag;
  while (bpm < 65.0) bpm *= 2.0;
  while (bpm > 175.0) bpm /= 2.0;
  return Math.round(bpm * 10) / 10;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return -70.0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Coarse deterministic energy-contour song section markers (Intro, Verse, Chorus / Drop, Outro).
 */
export function detectSongSections(
  durationSec: number,
  shortTermLufsSeries: number[]
): SongSection[] {
  if (durationSec <= 0 || shortTermLufsSeries.length === 0) return [];
  const n = shortTermLufsSeries.length;
  if (durationSec < 6.0 || n < 4) {
    const avg = shortTermLufsSeries.reduce((a, b) => a + b, 0) / n;
    return [
      {
        label: "Full Section",
        start_sec: 0.0,
        end_sec: Math.round(durationSec * 10) / 10,
        avg_lufs: Math.round(avg * 10) / 10,
      },
    ];
  }

  // 3-point moving average
  const smooth: number[] = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += shortTermLufsSeries[k];
    smooth.push(sum / (hi - lo + 1));
  }

  const active = smooth.filter((v) => v > -60.0);
  if (active.length === 0) {
    const avg = shortTermLufsSeries.reduce((a, b) => a + b, 0) / n;
    return [
      {
        label: "Quiet / Intro",
        start_sec: 0.0,
        end_sec: Math.round(durationSec * 10) / 10,
        avg_lufs: Math.round(avg * 10) / 10,
      },
    ];
  }

  const p75 = percentile(active, 75);
  const p35 = percentile(active, 35);
  const peakVal = Math.max(...smooth);
  const dropThresh = Math.max(p75, peakVal - 2.5);
  const quietThresh = Math.min(p35, peakVal - 6.0);

  const numSegments = durationSec < 45.0 ? 4 : durationSec < 120.0 ? 5 : 6;
  const rawSections: SongSection[] = [];

  for (let i = 0; i < numSegments; i++) {
    const sSec = (i / numSegments) * durationSec;
    const eSec = ((i + 1) / numSegments) * durationSec;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor((sSec / durationSec) * n)));
    const i1 = Math.max(i0 + 1, Math.min(n, Math.ceil((eSec / durationSec) * n)));
    let segSum = 0;
    for (let k = i0; k < i1; k++) segSum += smooth[k];
    const segAvg = segSum / Math.max(1, i1 - i0);

    let label: string;
    if (i === 0 && segAvg <= quietThresh + 2.0) {
      label = "Intro";
    } else if (i === numSegments - 1 && segAvg <= quietThresh + 2.0) {
      label = "Outro";
    } else if (segAvg >= dropThresh) {
      label = "Chorus / Drop";
    } else if (i === 0) {
      label = "Intro";
    } else if (i === numSegments - 1) {
      label = "Outro";
    } else {
      label = "Verse / Build";
    }

    rawSections.push({
      label,
      start_sec: Math.round(sSec * 10) / 10,
      end_sec: Math.round(eSec * 10) / 10,
      avg_lufs: Math.round(segAvg * 10) / 10,
    });
  }

  const merged: SongSection[] = [];
  for (const sec of rawSections) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === sec.label) {
      const dPrev = Math.max(0.1, prev.end_sec - prev.start_sec);
      const dCur = Math.max(0.1, sec.end_sec - sec.start_sec);
      const blended = (prev.avg_lufs * dPrev + sec.avg_lufs * dCur) / (dPrev + dCur);
      merged[merged.length - 1] = {
        label: prev.label,
        start_sec: prev.start_sec,
        end_sec: sec.end_sec,
        avg_lufs: Math.round(blended * 10) / 10,
      };
    } else {
      merged.push(sec);
    }
  }
  return merged;
}

export function analyzeSongStructure(
  channelsData: Float64Array[],
  sampleRate: number,
  durationSec: number,
  shortTermLufsSeries: number[]
): StructureResult {
  return {
    bpm: estimateBpm(channelsData, sampleRate),
    sections: detectSongSections(durationSec, shortTermLufsSeries),
  };
}

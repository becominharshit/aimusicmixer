export interface LoudnessResult {
  integratedLufs: number;
  shortTermMaxLufs: number;
  momentaryMaxLufs: number;
  loudnessRangeLu: number;
  shortTermLufsSeries: number[];
}

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function makeHighShelfCoeffs(sampleRate: number): BiquadCoeffs {
  const f0 = 1681.974450955533;
  const g = 3.999843853973347;
  const q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = Math.pow(10, g / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0 = 1.0 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2.0 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2.0 * (k * k - 1.0)) / a0,
    a2: (1.0 - k / q + k * k) / a0,
  };
}

function makeHighPassCoeffs(sampleRate: number): BiquadCoeffs {
  const f0 = 38.13547087602444;
  const q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1.0 + k / q + k * k;
  return {
    b0: 1.0 / a0,
    b1: -2.0 / a0,
    b2: 1.0 / a0,
    a1: (2.0 * (k * k - 1.0)) / a0,
    a2: (1.0 - k / q + k * k) / a0,
  };
}

function applyBiquad(input: Float64Array, c: BiquadCoeffs): Float64Array {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

function applyKWeighting(channelsData: Float64Array[], sampleRate: number): Float64Array[] {
  const stage1 = makeHighShelfCoeffs(sampleRate);
  const stage2 = makeHighPassCoeffs(sampleRate);
  return channelsData.map((ch) => applyBiquad(applyBiquad(ch, stage1), stage2));
}

function kWeightedLoudnessSlice(
  kWeighted: Float64Array[],
  start: number,
  end: number
): number {
  const len = Math.max(1, end - start);
  let totalEnergy = 0;
  for (let c = 0; c < kWeighted.length; c++) {
    const ch = kWeighted[c];
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = ch[i];
      sumSq += v * v;
    }
    totalEnergy += sumSq / len;
  }
  if (totalEnergy <= 1e-12) return -70.0;
  const lufs = -0.691 + 10.0 * Math.log10(totalEnergy);
  return Math.max(-70.0, Math.min(10.0, lufs));
}

function kWeightedEnergySlice(
  kWeighted: Float64Array[],
  start: number,
  end: number
): number {
  const len = Math.max(1, end - start);
  let totalEnergy = 0;
  for (let c = 0; c < kWeighted.length; c++) {
    const ch = kWeighted[c];
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = ch[i];
      sumSq += v * v;
    }
    totalEnergy += sumSq / len;
  }
  return totalEnergy;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computeLoudnessMetrics(
  channelsData: Float64Array[],
  sampleRate: number
): LoudnessResult {
  const nSamples = channelsData[0]?.length ?? 0;
  if (nSamples === 0) {
    return {
      integratedLufs: -70.0,
      shortTermMaxLufs: -70.0,
      momentaryMaxLufs: -70.0,
      loudnessRangeLu: 0.0,
      shortTermLufsSeries: [-70.0],
    };
  }

  let maxAbs = 0;
  for (let c = 0; c < channelsData.length; c++) {
    const ch = channelsData[c];
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > maxAbs) maxAbs = a;
    }
  }
  if (maxAbs < 1e-9) {
    const nSecs = Math.max(1, Math.ceil(nSamples / Math.max(sampleRate, 1)));
    return {
      integratedLufs: -70.0,
      shortTermMaxLufs: -70.0,
      momentaryMaxLufs: -70.0,
      loudnessRangeLu: 0.0,
      shortTermLufsSeries: new Array(nSecs).fill(-70.0),
    };
  }

  const durationSec = nSamples / sampleRate;
  const kWeighted = applyKWeighting(channelsData, sampleRate);

  // 400 ms blocks, 100 ms step for ITU-R BS.1770 integrated & momentary max
  const win400 = Math.max(1, Math.round(0.4 * sampleRate));
  const hop100 = Math.max(1, Math.round(0.1 * sampleRate));

  const blockEnergies: number[] = [];
  const blockLoudnesses: number[] = [];

  if (nSamples <= win400) {
    const e = kWeightedEnergySlice(kWeighted, 0, nSamples);
    blockEnergies.push(e);
    blockLoudnesses.push(e <= 1e-12 ? -70.0 : -0.691 + 10.0 * Math.log10(e));
  } else {
    for (let i = 0; i + win400 <= nSamples; i += hop100) {
      const e = kWeightedEnergySlice(kWeighted, i, i + win400);
      blockEnergies.push(e);
      blockLoudnesses.push(e <= 1e-12 ? -70.0 : -0.691 + 10.0 * Math.log10(e));
    }
  }

  const momentaryMax =
    blockLoudnesses.length > 0 ? Math.max(...blockLoudnesses) : -70.0;

  let integrated = -70.0;
  if (durationSec >= 0.41 && blockLoudnesses.length > 0) {
    // Absolute gate (-70 LUFS)
    const absGatedIndices: number[] = [];
    for (let i = 0; i < blockLoudnesses.length; i++) {
      if (blockLoudnesses[i] > -70.0) absGatedIndices.push(i);
    }
    if (absGatedIndices.length > 0) {
      let meanAbsEnergy = 0;
      for (const idx of absGatedIndices) meanAbsEnergy += blockEnergies[idx];
      meanAbsEnergy /= absGatedIndices.length;
      const gammaA = -0.691 + 10.0 * Math.log10(Math.max(meanAbsEnergy, 1e-12));
      const relThreshold = gammaA - 10.0;

      let relSum = 0;
      let relCount = 0;
      for (const idx of absGatedIndices) {
        if (blockLoudnesses[idx] > relThreshold) {
          relSum += blockEnergies[idx];
          relCount++;
        }
      }
      if (relCount > 0) {
        integrated = Math.max(-70.0, -0.691 + 10.0 * Math.log10(relSum / relCount));
      }
    }
  } else {
    integrated = kWeightedLoudnessSlice(kWeighted, 0, nSamples);
  }

  // Short-Term LUFS series (3.0 s sliding window, 1.0 s step)
  const win3s = Math.round(3.0 * sampleRate);
  const step1s = Math.max(1, Math.round(1.0 * sampleRate));
  const shortTermSeries: number[] = [];

  if (nSamples <= win3s) {
    const totalSteps = Math.max(1, Math.ceil(durationSec));
    for (let idx = 0; idx < totalSteps; idx++) {
      const start = Math.min(idx * step1s, Math.max(0, nSamples - 1));
      const end = Math.min(nSamples, start + step1s);
      const val = kWeightedLoudnessSlice(kWeighted, start, end);
      shortTermSeries.push(Math.round(val * 100) / 100);
    }
  } else {
    const nSeconds = Math.ceil(durationSec);
    for (let sec = 0; sec < nSeconds; sec++) {
      let start = sec * step1s;
      let end = Math.min(nSamples, start + win3s);
      if (end - start < Math.max(1, Math.round(0.4 * sampleRate))) {
        start = Math.max(0, nSamples - win3s);
        end = nSamples;
      }
      const val = kWeightedLoudnessSlice(kWeighted, start, end);
      shortTermSeries.push(Math.round(val * 100) / 100);
    }
  }

  const shortTermMax =
    shortTermSeries.length > 0 ? Math.max(...shortTermSeries) : integrated;

  // Loudness Range (LRA) per EBU R128 (3.0 s window, 100 ms/1s step, -20 LU relative gate, P95 - P10)
  let lra = 0.0;
  if (durationSec >= 3.1) {
    const lraStep = Math.max(1, Math.round(0.1 * sampleRate));
    const stVals: number[] = [];
    const stEnergies: number[] = [];
    for (let i = 0; i + win3s <= nSamples; i += lraStep) {
      const e = kWeightedEnergySlice(kWeighted, i, i + win3s);
      const l = e <= 1e-12 ? -70.0 : -0.691 + 10.0 * Math.log10(e);
      if (l > -70.0) {
        stVals.push(l);
        stEnergies.push(e);
      }
    }
    if (stVals.length > 0) {
      const meanE = stEnergies.reduce((a, b) => a + b, 0) / stEnergies.length;
      const absL = -0.691 + 10.0 * Math.log10(Math.max(meanE, 1e-12));
      const relGated = stVals.filter((v) => v >= absL - 20.0).sort((a, b) => a - b);
      if (relGated.length >= 2) {
        lra = Math.max(0.0, percentile(relGated, 95) - percentile(relGated, 10));
      }
    }
  }

  return {
    integratedLufs: Math.round(integrated * 100) / 100,
    shortTermMaxLufs:
      Math.round(Math.max(-70.0, shortTermMax < -69.9 ? momentaryMax : shortTermMax) * 100) /
      100,
    momentaryMaxLufs: Math.round(Math.max(-70.0, momentaryMax) * 100) / 100,
    loudnessRangeLu: Math.round(lra * 100) / 100,
    shortTermLufsSeries: shortTermSeries,
  };
}

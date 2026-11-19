export interface StereoResult {
  phaseCorrelationAvg: number;
  lowEndPhaseCorrelation: number;
  stereoWidthRatio: number;
  phaseCorrelationSeries: number[];
  worstPhaseWindow: [number, number];
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function makeButterworthLowpass2nd(cutoffHz: number, q: number, sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * cutoffHz) / sampleRate);
  const k2 = k * k;
  const a0 = 1 + k / q + k2;
  return {
    b0: k2 / a0,
    b1: (2 * k2) / a0,
    b2: k2 / a0,
    a1: (2 * (k2 - 1)) / a0,
    a2: (1 - k / q + k2) / a0,
  };
}

function makeButterworthHighpass2nd(cutoffHz: number, q: number, sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * cutoffHz) / sampleRate);
  const k2 = k * k;
  const a0 = 1 + k / q + k2;
  return {
    b0: 1 / a0,
    b1: -2 / a0,
    b2: 1 / a0,
    a1: (2 * (k2 - 1)) / a0,
    a2: (1 - k / q + k2) / a0,
  };
}

function applyBiquadCopy(input: Float64Array, bq: Biquad): Float64Array {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = bq.b0 * x0 + bq.b1 * x1 + bq.b2 * x2 - bq.a1 * y1 - bq.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/**
 * 4th-order Butterworth 20-120 Hz bandpass filter (4th-order 20 Hz HPF cascaded with 4th-order 120 Hz LPF)
 * so sub-20 Hz DC offset and infrasonic rumble cannot corrupt low-end phase correlation.
 */
function butterworth4Bandpass20To120Hz(signal: Float64Array, sampleRate: number): Float64Array {
  const q1 = 0.541196100146197;
  const q2 = 1.3065629648763766;
  const hp1 = makeButterworthHighpass2nd(20.0, q1, sampleRate);
  const hp2 = makeButterworthHighpass2nd(20.0, q2, sampleRate);
  const lp1 = makeButterworthLowpass2nd(120.0, q1, sampleRate);
  const lp2 = makeButterworthLowpass2nd(120.0, q2, sampleRate);
  return applyBiquadCopy(
    applyBiquadCopy(applyBiquadCopy(applyBiquadCopy(signal, hp1), hp2), lp1),
    lp2
  );
}

function weightedPearsonCorr(left: Float64Array, right: Float64Array, step: number): number {
  const nSamples = left.length;
  let weightedSum = 0;
  let weightTotal = 0;
  for (let start = 0; start < nSamples; start += step) {
    const end = Math.min(nSamples, start + step);
    const len = end - start;
    if (len < 2) continue;
    let sumL = 0;
    let sumR = 0;
    let eL = 0;
    let eR = 0;
    for (let i = start; i < end; i++) {
      const l = left[i];
      const r = right[i];
      sumL += l;
      sumR += r;
      eL += l * l;
      eR += r * r;
    }
    const blkEnergy = eL + eR;
    if (blkEnergy <= 1e-10) continue;
    const meanL = sumL / len;
    const meanR = sumR / len;
    let cov = 0;
    let varL = 0;
    let varR = 0;
    let close = true;
    for (let i = start; i < end; i++) {
      const dl = left[i] - meanL;
      const dr = right[i] - meanR;
      cov += dl * dr;
      varL += dl * dl;
      varR += dr * dr;
      if (Math.abs(left[i] - right[i]) > 1e-6) close = false;
    }
    const denom = Math.sqrt(varL * varR);
    const corr = denom <= 1e-12 ? (close ? 1.0 : 0.0) : Math.max(-1.0, Math.min(1.0, cov / denom));
    weightedSum += corr * blkEnergy;
    weightTotal += blkEnergy;
  }
  return weightTotal > 1e-12 ? weightedSum / weightTotal : 1.0;
}

function locateWorstPhaseWindow(
  series: number[],
  worstSec: number,
  durationSec: number
): [number, number] {
  if (durationSec <= 2.0 || series.length === 0) {
    return [0.0, Math.round(Math.max(0.1, durationSec) * 10) / 10];
  }
  const threshold = series.some((v) => v < 0.0) ? 0.0 : 0.15;
  const clusters: Array<[number, number, number]> = [];
  let curStart: number | null = null;
  let curEnd: number | null = null;
  let curMin = 1.0;

  for (let sec = 0; sec < series.length; sec++) {
    const val = series[sec];
    if (val < threshold) {
      if (curStart === null) {
        curStart = sec;
        curEnd = sec;
        curMin = val;
      } else if (curEnd !== null && sec - curEnd <= 1) {
        curEnd = sec;
        curMin = Math.min(curMin, val);
      } else if (curEnd !== null) {
        clusters.push([curStart, curEnd, curMin]);
        curStart = sec;
        curEnd = sec;
        curMin = val;
      }
    }
  }
  if (curStart !== null && curEnd !== null) {
    clusters.push([curStart, curEnd, curMin]);
  }

  if (clusters.length > 0) {
    clusters.sort((a, b) => a[2] - b[2] || b[1] - b[0] - (a[1] - a[0]));
    const [cStart, cEnd] = clusters[0];
    const wStart = Math.max(0, cStart);
    let wEnd = Math.min(durationSec, cEnd + 1);
    if (wEnd - wStart < Math.min(2.0, durationSec)) {
      wEnd = Math.min(durationSec, wStart + Math.min(2.0, durationSec));
    }
    return [Math.round(wStart * 10) / 10, Math.round(wEnd * 10) / 10];
  }

  const wStart = Math.max(0.0, worstSec);
  const wEnd = Math.min(durationSec, wStart + Math.min(3.0, durationSec));
  return [Math.round(wStart * 10) / 10, Math.round(Math.max(wStart + 1.0, wEnd) * 10) / 10];
}

export function computeStereoMetrics(
  channelsData: Float64Array[],
  sampleRate: number
): StereoResult {
  const nSamples = channelsData[0]?.length ?? 0;
  const durationSec = nSamples / Math.max(sampleRate, 1);
  const nSeconds = Math.max(1, Math.ceil(durationSec));

  if (nSamples === 0 || channelsData.length < 2) {
    return {
      phaseCorrelationAvg: 1.0,
      lowEndPhaseCorrelation: 1.0,
      stereoWidthRatio: 0.0,
      phaseCorrelationSeries: new Array(nSeconds).fill(1.0),
      worstPhaseWindow: [0.0, Math.round(durationSec * 10) / 10],
    };
  }

  const left = channelsData[0];
  const right = channelsData[1];
  const step = Math.max(1, sampleRate);

  const series: number[] = [];
  let midEnergy = 0;
  let sideEnergy = 0;
  let weightedCorrSum = 0;
  let weightSum = 0;
  let worstCorr = 1.0;
  let worstSec = 0;

  for (let sec = 0; sec < nSeconds; sec++) {
    const start = sec * step;
    const end = Math.min(nSamples, start + step);
    const len = end - start;

    let sumL = 0;
    let sumR = 0;
    let lEnergy = 0;
    let rEnergy = 0;

    for (let i = start; i < end; i++) {
      const l = left[i];
      const r = right[i];
      const mid = 0.5 * (l + r);
      const side = 0.5 * (l - r);
      midEnergy += mid * mid;
      sideEnergy += side * side;
      lEnergy += l * l;
      rEnergy += r * r;
      sumL += l;
      sumR += r;
    }

    if (len < 2) {
      series.push(series.length > 0 ? series[series.length - 1] : 1.0);
      continue;
    }

    const blockEnergy = lEnergy + rEnergy;
    if (blockEnergy <= 1e-10) {
      series.push(1.0);
      continue;
    }

    const meanL = sumL / len;
    const meanR = sumR / len;
    let cov = 0;
    let varL = 0;
    let varR = 0;
    let allClose = true;
    for (let i = start; i < end; i++) {
      const dl = left[i] - meanL;
      const dr = right[i] - meanR;
      cov += dl * dr;
      varL += dl * dl;
      varR += dr * dr;
      if (Math.abs(left[i] - right[i]) > 1e-6) allClose = false;
    }

    const denom = Math.sqrt(varL * varR);
    const corr =
      denom <= 1e-12
        ? allClose
          ? 1.0
          : 0.0
        : Math.max(-1.0, Math.min(1.0, cov / denom));

    series.push(Math.round(corr * 1000) / 1000);
    weightedCorrSum += corr * blockEnergy;
    weightSum += blockEnergy;
    if (corr < worstCorr) {
      worstCorr = corr;
      worstSec = sec;
    }
  }

  const totalMs = midEnergy + sideEnergy;
  if (totalMs <= 1e-12) {
    return {
      phaseCorrelationAvg: 1.0,
      lowEndPhaseCorrelation: 1.0,
      stereoWidthRatio: 0.0,
      phaseCorrelationSeries: new Array(nSeconds).fill(1.0),
      worstPhaseWindow: [0.0, Math.round(durationSec * 10) / 10],
    };
  }

  const widthRatio = Math.max(0.0, Math.min(1.0, sideEnergy / totalMs));
  const avgCorr =
    weightSum > 1e-12 ? Math.max(-1.0, Math.min(1.0, weightedCorrSum / weightSum)) : 1.0;

  let lowEndCorr = avgCorr;
  if (sampleRate > 250 && nSamples >= 64) {
    const lowL = butterworth4Bandpass20To120Hz(left, sampleRate);
    const lowR = butterworth4Bandpass20To120Hz(right, sampleRate);
    lowEndCorr = Math.max(-1.0, Math.min(1.0, weightedPearsonCorr(lowL, lowR, step)));
  }

  return {
    phaseCorrelationAvg: Math.round(avgCorr * 1000) / 1000,
    lowEndPhaseCorrelation: Math.round(lowEndCorr * 1000) / 1000,
    stereoWidthRatio: Math.round(widthRatio * 1000) / 1000,
    phaseCorrelationSeries: series,
    worstPhaseWindow: locateWorstPhaseWindow(series, worstSec, durationSec),
  };
}

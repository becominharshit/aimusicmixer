import type {
  AnalysisContext,
  AnalysisReport,
  ArtistVisionTag,
  BandName,
  Finding,
  GenreType,
  GlobalMetrics,
  SpectralBand,
  StageType,
  StreamingEstimate,
} from "@/types/report";

const GENRE_MEDIANS: Record<GenreType, Record<BandName, number>> = {
  electronic: { sub: -21.0, low: -18.5, low_mid: -21.0, high_mid: -22.5, presence: -25.0, air: -31.5 },
  pop: { sub: -23.0, low: -19.5, low_mid: -20.5, high_mid: -21.5, presence: -24.5, air: -31.0 },
  hip_hop: { sub: -19.5, low: -18.0, low_mid: -21.5, high_mid: -23.0, presence: -26.0, air: -32.5 },
  rock: { sub: -26.0, low: -20.0, low_mid: -19.5, high_mid: -20.5, presence: -24.0, air: -32.0 },
  acoustic: { sub: -30.0, low: -22.0, low_mid: -20.0, high_mid: -22.0, presence: -26.5, air: -33.5 },
  ambient: { sub: -25.0, low: -21.0, low_mid: -21.5, high_mid: -24.0, presence: -28.0, air: -34.0 },
  other: { sub: -23.0, low: -19.5, low_mid: -20.5, high_mid: -22.0, presence: -25.5, air: -32.0 },
};

const BAND_DEFS: Array<{ band: BandName; range: string; lowHz: number; highHz: number; label: string }> = [
  { band: "sub", range: "20-60", lowHz: 20, highHz: 60, label: "Sub-Bass" },
  { band: "low", range: "60-250", lowHz: 60, highHz: 250, label: "Low End" },
  { band: "low_mid", range: "250-800", lowHz: 250, highHz: 800, label: "Low-Mids" },
  { band: "high_mid", range: "800-4000", lowHz: 800, highHz: 4000, label: "Upper-Mids" },
  { band: "presence", range: "4000-10000", lowHz: 4000, highHz: 10000, label: "Presence" },
  { band: "air", range: "10000-20000", lowHz: 10000, highHz: 20000, label: "Air / Top End" },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toDb(linear: number, floor = -120): number {
  if (!Number.isFinite(linear) || linear <= 1e-9) return floor;
  return Math.max(floor, 20 * Math.log10(linear));
}

function fmtSigned(v: number, digits = 2): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

/**
 * Lightweight 2nd-order digital biquad filter (Direct Form II Transposed) used for
 * ITU-R BS.1770-4 K-weighting and 20-120 Hz low-end phase correlation in pure browser JS.
 */
function applyBiquad(
  input: Float32Array,
  b0: number,
  b1: number,
  b2: number,
  a1: number,
  a2: number
): Float32Array {
  const out = new Float32Array(input.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

function highShelfCoeffs(fs: number, f0: number, gainDb: number, q: number) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const alpha = sinW / (2 * q);
  const sqrtA = Math.sqrt(A);
  const a0 = A + 1 - (A - 1) * cosW + 2 * sqrtA * alpha;
  return {
    b0: (A * (A + 1 + (A - 1) * cosW + 2 * sqrtA * alpha)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cosW)) / a0,
    b2: (A * (A + 1 + (A - 1) * cosW - 2 * sqrtA * alpha)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cosW)) / a0,
    a2: (A + 1 - (A - 1) * cosW - 2 * sqrtA * alpha) / a0,
  };
}

function highPassCoeffs(fs: number, f0: number, q: number) {
  const w0 = (2 * Math.PI * f0) / fs;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const alpha = sinW / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosW) / (2 * a0),
    b1: -(1 + cosW) / a0,
    b2: (1 + cosW) / (2 * a0),
    a1: (-2 * cosW) / a0,
    a2: (1 - alpha) / a0,
  };
}

function lowPassCoeffs(fs: number, f0: number, q: number) {
  const w0 = (2 * Math.PI * f0) / fs;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const alpha = sinW / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosW) / (2 * a0),
    b1: (1 - cosW) / a0,
    b2: (1 - cosW) / (2 * a0),
    a1: (-2 * cosW) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * Radix-2 Cooley-Tukey FFT magnitude spectrum for deterministic 6-band balance calculation.
 */
function fftMagnitudeSq(frame: Float32Array): Float32Array {
  const n = frame.length;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    real[i] = frame[i] * win;
  }

  let j = 0;
  for (let i = 0; i < n; i += 1) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k += 1) {
        const angle = step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const idx1 = i + k;
        const idx2 = idx1 + half;
        const tr = wr * real[idx2] - wi * imag[idx2];
        const ti = wr * imag[idx2] + wi * real[idx2];
        real[idx2] = real[idx1] - tr;
        imag[idx2] = imag[idx1] - ti;
        real[idx1] += tr;
        imag[idx1] += ti;
      }
    }
  }

  const out = new Float32Array(n / 2);
  const scale = 1 / (n * n);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (real[i] * real[i] + imag[i] * imag[i]) * scale;
  }
  return out;
}

export interface ClientWebAudioAnalysisResult {
  report: AnalysisReport;
  audioBuffer: AudioBuffer;
  objectUrl: string;
}

/**
 * Pure deterministic DSP analyzer operating directly on decoded PCM channels.
 * Decoupled from browser AudioContext so it is 100% unit-testable in Vitest/Node as well as browser.
 */
export function analyzePcmChannelsLocal(params: {
  channels: Float32Array[];
  sampleRate: number;
  filename: string;
  genre: GenreType;
  stage: StageType;
  artistVision: ArtistVisionTag[];
  playbackUrl: string;
}): AnalysisReport {
  const { channels, sampleRate, filename, genre, stage, artistVision, playbackUrl } = params;
  const chL = channels[0] ?? new Float32Array(0);
  const chR = channels.length > 1 ? channels[1] : chL;
  const totalSamples = chL.length;
  const durationSec = Math.max(0.05, totalSamples / Math.max(1, sampleRate));

  // 1. Sample peak & 4x cubic Catmull-Rom inter-sample true peak estimate + clipping timestamps
  let maxSamplePeak = 0;
  let maxTruePeak = 0;
  const clipSet = new Set<number>();
  let rmsSum = 0;

  for (let c = 0; c < Math.min(2, channels.length); c += 1) {
    const buf = channels[c];
    for (let i = 0; i < buf.length; i += 1) {
      const s = buf[i];
      const absS = Math.abs(s);
      if (absS > maxSamplePeak) maxSamplePeak = absS;
      if (absS > maxTruePeak) maxTruePeak = absS;
      rmsSum += s * s;

      // 4x cubic interpolation around hot samples (> 0.65 linear) for fast true-peak detection
      if (absS > 0.65 && i >= 1 && i < buf.length - 2) {
        const xm1 = buf[i - 1];
        const x0 = buf[i];
        const x1 = buf[i + 1];
        const x2 = buf[i + 2];
        for (const t of [0.25, 0.5, 0.75]) {
          const t2 = t * t;
          const t3 = t2 * t;
          const interp =
            0.5 *
            (2 * x0 +
              (-xm1 + x1) * t +
              (2 * xm1 - 5 * x0 + 4 * x1 - x2) * t2 +
              (-xm1 + 3 * x0 - 3 * x1 + x2) * t3);
          const absI = Math.abs(interp);
          if (absI > maxTruePeak) maxTruePeak = absI;
          if (absI > 0.9885) {
            clipSet.add(Math.round((i / sampleRate) * 2) / 2);
          }
        }
      } else if (absS > 0.9885) {
        clipSet.add(Math.round((i / sampleRate) * 2) / 2);
      }
    }
  }

  const samplePeakDbfs = round2(toDb(maxSamplePeak));
  const truePeakDbtp = round2(toDb(maxTruePeak));
  const rmsDb = toDb(Math.sqrt(rmsSum / Math.max(1, totalSamples * Math.min(2, channels.length))));
  const clippingTimestamps = Array.from(clipSet).sort((a, b) => a - b).slice(0, 24);

  // 2. ITU-R BS.1770-4 K-weighted Loudness (High-shelf +4dB @ 1681Hz + HPF @ 38Hz)
  const hs = highShelfCoeffs(sampleRate, 1681.97, 4.0, 0.7071);
  const hp = highPassCoeffs(sampleRate, 38.13, 0.5003);
  const kChL = applyBiquad(applyBiquad(chL, hs.b0, hs.b1, hs.b2, hs.a1, hs.a2), hp.b0, hp.b1, hp.b2, hp.a1, hp.a2);
  const kChR =
    channels.length > 1
      ? applyBiquad(applyBiquad(chR, hs.b0, hs.b1, hs.b2, hs.a1, hs.a2), hp.b0, hp.b1, hp.b2, hp.a1, hp.a2)
      : kChL;

  const blockSamples = Math.max(1, Math.round(sampleRate * 0.4));
  const hopSamples = Math.max(1, Math.round(sampleRate * 0.1));
  const blockPowers: number[] = [];
  for (let start = 0; start + blockSamples <= totalSamples; start += hopSamples) {
    let eL = 0;
    let eR = 0;
    for (let i = start; i < start + blockSamples; i += 1) {
      eL += kChL[i] * kChL[i];
      eR += kChR[i] * kChR[i];
    }
    const power = channels.length > 1 ? (eL + eR) / blockSamples : eL / blockSamples;
    blockPowers.push(power);
  }
  const absThreshold = Math.pow(10, (-70 + 0.691) / 10);
  const aboveAbs = blockPowers.filter((p) => p > absThreshold);
  let integratedLufs = -70.0;
  if (aboveAbs.length > 0) {
    const meanAbs = aboveAbs.reduce((a, b) => a + b, 0) / aboveAbs.length;
    const relThreshold = meanAbs * Math.pow(10, -10 / 10);
    const gated = aboveAbs.filter((p) => p >= relThreshold);
    const finalMean = (gated.length > 0 ? gated : aboveAbs).reduce((a, b) => a + b, 0) / Math.max(1, gated.length || aboveAbs.length);
    integratedLufs = round2(Math.max(-70, -0.691 + 10 * Math.log10(Math.max(1e-12, finalMean))));
  }

  // Short-term 3s LUFS & 1s Phase series
  const secCount = Math.max(1, Math.ceil(durationSec));
  const shortTermLufsSeries: number[] = [];
  const phaseSeries: number[] = [];
  let shortTermMaxLufs = -70.0;
  let worstPhaseSec = 0;
  let worstPhaseVal = 1.0;

  for (let s = 0; s < secCount; s += 1) {
    const stStart = Math.max(0, Math.floor((s - 1.5) * sampleRate));
    const stEnd = Math.min(totalSamples, Math.floor((s + 1.5) * sampleRate));
    let stEnergy = 0;
    const stLen = Math.max(1, stEnd - stStart);
    for (let i = stStart; i < stEnd; i += 1) {
      stEnergy += channels.length > 1 ? kChL[i] * kChL[i] + kChR[i] * kChR[i] : kChL[i] * kChL[i];
    }
    const stLufs = round2(Math.max(-70, -0.691 + 10 * Math.log10(Math.max(1e-12, stEnergy / stLen))));
    shortTermLufsSeries.push(stLufs);
    if (stLufs > shortTermMaxLufs) shortTermMaxLufs = stLufs;

    const pStart = Math.floor(s * sampleRate);
    const pEnd = Math.min(totalSamples, Math.floor((s + 1) * sampleRate));
    let lr = 0;
    let ll = 0;
    let rr = 0;
    for (let i = pStart; i < pEnd; i += 1) {
      lr += chL[i] * chR[i];
      ll += chL[i] * chL[i];
      rr += chR[i] * chR[i];
    }
    const denom = Math.sqrt(ll * rr);
    const corr = denom > 1e-9 ? Math.max(-1, Math.min(1, lr / denom)) : 1.0;
    phaseSeries.push(round2(corr));
    if (corr < worstPhaseVal) {
      worstPhaseVal = corr;
      worstPhaseSec = s;
    }
  }

  const validSt = shortTermLufsSeries.filter((v) => v > -65).sort((a, b) => a - b);
  const loudnessRangeLu =
    validSt.length >= 4
      ? round2(
          Math.max(
            0,
            validSt[Math.min(validSt.length - 1, Math.floor(validSt.length * 0.95))] -
              validSt[Math.floor(validSt.length * 0.1)]
          )
        )
      : 0;

  // Global & sub-120 Hz stereo correlation
  let sumLR = 0;
  let sumLL = 0;
  let sumRR = 0;
  let sumMidSq = 0;
  let sumSideSq = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    const l = chL[i];
    const r = chR[i];
    sumLR += l * r;
    sumLL += l * l;
    sumRR += r * r;
    const mid = 0.5 * (l + r);
    const side = 0.5 * (l - r);
    sumMidSq += mid * mid;
    sumSideSq += side * side;
  }
  const phaseCorrelationAvg =
    Math.sqrt(sumLL * sumRR) > 1e-9 ? round2(sumLR / Math.sqrt(sumLL * sumRR)) : 1.0;
  const stereoWidthRatio =
    sumMidSq + sumSideSq > 1e-9 ? round2(Math.sqrt(sumSideSq) / Math.sqrt(sumMidSq + sumSideSq)) : 0;

  const lp120 = lowPassCoeffs(sampleRate, 120, 0.7071);
  const subL = applyBiquad(chL, lp120.b0, lp120.b1, lp120.b2, lp120.a1, lp120.a2);
  const subR = channels.length > 1 ? applyBiquad(chR, lp120.b0, lp120.b1, lp120.b2, lp120.a1, lp120.a2) : subL;
  let subLR = 0;
  let subLL = 0;
  let subRR = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    subLR += subL[i] * subR[i];
    subLL += subL[i] * subL[i];
    subRR += subR[i] * subR[i];
  }
  const lowEndPhaseCorrelation =
    Math.sqrt(subLL * subRR) > 1e-9 ? round2(subLR / Math.sqrt(subLL * subRR)) : 1.0;

  // 3. Waveform peaks (240 bins)
  const numBins = Math.min(240, Math.max(1, totalSamples));
  const waveformPeaks: number[][] = [];
  for (let b = 0; b < numBins; b += 1) {
    const s = Math.floor((b * totalSamples) / numBins);
    const e = Math.max(s + 1, Math.floor(((b + 1) * totalSamples) / numBins));
    let mn = 0;
    let mx = 0;
    for (let i = s; i < e; i += 1) {
      const m = channels.length > 1 ? 0.5 * (chL[i] + chR[i]) : chL[i];
      if (m < mn) mn = m;
      if (m > mx) mx = m;
    }
    waveformPeaks.push([Math.round(mn * 10000) / 10000, Math.round(mx * 10000) / 10000]);
  }

  // 4. 6-Band FFT Spectral Profile (sampled evenly up to 48 frames of 2048 samples)
  const fftSize = 2048;
  const maxFrames = 48;
  const frameStep = Math.max(fftSize, Math.floor(Math.max(1, totalSamples - fftSize) / maxFrames));
  const bandAccum: Record<BandName, number> = {
    sub: 0,
    low: 0,
    low_mid: 0,
    high_mid: 0,
    presence: 0,
    air: 0,
  };
  let frameCount = 0;
  const frameBuf = new Float32Array(fftSize);
  const binHz = sampleRate / fftSize;

  for (let pos = 0; pos + fftSize <= totalSamples && frameCount < maxFrames; pos += frameStep) {
    for (let i = 0; i < fftSize; i += 1) {
      frameBuf[i] = channels.length > 1 ? 0.5 * (chL[pos + i] + chR[pos + i]) : chL[pos + i];
    }
    const magSq = fftMagnitudeSq(frameBuf);
    for (const def of BAND_DEFS) {
      const b0 = Math.max(1, Math.floor(def.lowHz / binHz));
      const b1 = Math.min(magSq.length - 1, Math.ceil(def.highHz / binHz));
      let e = 0;
      for (let b = b0; b <= b1; b += 1) {
        e += magSq[b];
      }
      bandAccum[def.band] += e;
    }
    frameCount += 1;
  }

  const medians = GENRE_MEDIANS[genre] ?? GENRE_MEDIANS.electronic;
  const spectralBands: SpectralBand[] = BAND_DEFS.map((def) => {
    const avgE = bandAccum[def.band] / Math.max(1, frameCount);
    const energyDb = round2(Math.max(-60, 10 * Math.log10(Math.max(1e-12, avgE))));
    const median = medians[def.band];
    return {
      band: def.band,
      range_hz: def.range,
      energy_db: energyDb,
      delta_vs_genre_median_db: round2(energyDb - median),
      genre_target_low_db: round2(median - 2.0),
      genre_target_high_db: round2(median + 2.0),
    };
  });

  // 5. Dynamics & Streaming Normalization
  const crestFactorDb = round2(Math.max(0, samplePeakDbfs - rmsDb));
  const plrDb = round2(Math.max(0, truePeakDbtp - integratedLufs));
  const psrDb = round2(Math.max(0, truePeakDbtp - shortTermMaxLufs));

  const globalMetrics: GlobalMetrics = {
    integrated_lufs: integratedLufs,
    short_term_max_lufs: round2(shortTermMaxLufs),
    momentary_max_lufs: round2(Math.min(0, shortTermMaxLufs + 1.8)),
    loudness_range_lu: loudnessRangeLu,
    sample_peak_dbfs: samplePeakDbfs,
    true_peak_dbtp: truePeakDbtp,
    crest_factor_db: crestFactorDb,
    plr_db: plrDb,
    psr_db: psrDb,
    transient_punch_db: round2(Math.min(12, Math.max(2, crestFactorDb * 0.55))),
    phase_correlation_avg: phaseCorrelationAvg,
    low_end_phase_correlation: lowEndPhaseCorrelation,
    stereo_width_ratio: stereoWidthRatio,
  };

  const spotifyGain = round2(-14.0 - integratedLufs);
  const appleGain = round2(-16.0 - integratedLufs);
  const ytGain = round2(Math.min(0, -14.0 - integratedLufs));
  const streamingEstimates: StreamingEstimate[] = [
    {
      platform: "Spotify (Normal -14 LUFS)",
      estimated_gain_db: spotifyGain,
      limiter_engaged_warning: spotifyGain > 0.2 && truePeakDbtp + spotifyGain > -1.0,
      assumption_note: `Local preview estimate: ${fmtSigned(spotifyGain, 1)} dB shift toward -14 LUFS target.`,
    },
    {
      platform: "Apple Music (Sound Check -16 LUFS)",
      estimated_gain_db: appleGain,
      limiter_engaged_warning: appleGain > 0.2 && truePeakDbtp + appleGain > -1.0,
      assumption_note: `Local preview estimate: ${fmtSigned(appleGain, 1)} dB shift toward -16 LUFS reference.`,
    },
    {
      platform: "YouTube (-14 LUFS, Downward Only)",
      estimated_gain_db: ytGain,
      limiter_engaged_warning: false,
      assumption_note: `YouTube attenuates tracks louder than -14 LUFS (${fmtSigned(ytGain, 1)} dB).`,
    },
  ];

  // 6. Deterministic Local Findings
  const findings: Finding[] = [];
  const loudestSec = shortTermLufsSeries.reduce(
    (best, val, idx, arr) => (val > arr[best] ? idx : best),
    0
  );
  const loudEnd = Math.min(round2(durationSec), round2(loudestSec + 8));

  if (integratedLufs <= -68.0 && samplePeakDbfs <= -90.0) {
    findings.push({
      evidence_id: "ev_silence_01",
      category: "technical_validation",
      severity: "alert",
      classification: "objective_defect",
      confidence: "measured",
      title: "Digital Silence Detected Across File",
      timestamp_start_sec: 0,
      timestamp_end_sec: round2(durationSec),
      measured_value: `${integratedLufs.toFixed(1)} LUFS / ${samplePeakDbfs.toFixed(1)} dBFS`,
      what_happened: "No audible signal above -90 dBFS was detected in the local Web Audio buffer.",
      why_it_matters: "A muted master bus or wrong export locator produces a silent audio render.",
      listen_prompt: "Press Play to confirm the render is silent.",
      what_to_try: "Check your DAW master fader and export loop braces before re-bouncing.",
      recheck_target: "Re-export peaking between -6.0 and -1.0 dBTP.",
    });
  } else {
    if (truePeakDbtp > -0.1) {
      const clipTs = clippingTimestamps[0] ?? loudestSec;
      findings.push({
        evidence_id: "ev_true_peak_01",
        category: "true_peak",
        severity: "alert",
        classification: "objective_defect",
        confidence: "estimated",
        title: `Inter-Sample Clipping Risk (${fmtSigned(truePeakDbtp)} dBTP)`,
        timestamp_start_sec: clipTs,
        timestamp_end_sec: Math.min(round2(durationSec), round2(clipTs + 6)),
        measured_value: `${fmtSigned(truePeakDbtp)} dBTP (Sample peak ${fmtSigned(samplePeakDbfs)} dBFS)`,
        what_happened: `Local 4x cubic interpolation detects inter-sample overs reaching ${fmtSigned(truePeakDbtp)} dBTP.`,
        why_it_matters: "DAC reconstruction and AAC/MP3 streaming encoders clip inter-sample overs into brittle distortion.",
        listen_prompt: `Audition near ${Math.floor(clipTs / 60)}:${String(Math.floor(clipTs % 60)).padStart(2, "0")} on Smartphone preview.`,
        what_to_try: "Enable oversampled True Peak limiting with a -1.0 dBTP ceiling or pull back your master bus by 3 dB.",
        recheck_target: "Confirm True Peak lands below -1.0 dBTP once Precision DSP finishes.",
      });
    } else {
      findings.push({
        evidence_id: "ev_true_peak_safe_01",
        category: "true_peak",
        severity: "safe",
        classification: "stylistic_choice",
        confidence: "estimated",
        title: `Healthy Peak Headroom (${fmtSigned(truePeakDbtp)} dBTP)`,
        timestamp_start_sec: loudestSec,
        timestamp_end_sec: loudEnd,
        measured_value: `${fmtSigned(truePeakDbtp)} dBTP (Sample peak ${fmtSigned(samplePeakDbfs)} dBFS)`,
        what_happened: `Estimated True Peak remains below ceiling at ${fmtSigned(truePeakDbtp)} dBTP.`,
        why_it_matters: "Headroom discipline protects transients during streaming transcodes.",
        listen_prompt: "Audition the loudest chorus/drop to confirm clean transient clarity.",
        what_to_try: "Keep your current output ceiling while balancing midrange clarity.",
        recheck_target: "Maintain <= -1.0 dBTP (master) or <= -3.0 dBTP (unmastered mix).",
      });
    }

    if (phaseCorrelationAvg < 0.0 || lowEndPhaseCorrelation < 0.3) {
      findings.push({
        evidence_id: phaseCorrelationAvg < 0.0 ? "ev_phase_01" : "ev_phase_low_01",
        category: "stereo_phase",
        severity: phaseCorrelationAvg < 0.0 || lowEndPhaseCorrelation < 0.0 ? "alert" : "caution",
        classification: "objective_defect",
        confidence: "measured",
        band_name: lowEndPhaseCorrelation < 0.3 ? "sub" : null,
        title:
          phaseCorrelationAvg < 0.0
            ? `Severe Stereo Phase Cancellation (${fmtSigned(phaseCorrelationAvg)})`
            : `Wide / Uncentered Sub-Bass Below 120 Hz (${fmtSigned(lowEndPhaseCorrelation)})`,
        timestamp_start_sec: worstPhaseSec,
        timestamp_end_sec: Math.min(round2(durationSec), round2(worstPhaseSec + 6)),
        measured_value: `Avg ${fmtSigned(phaseCorrelationAvg)} / <120Hz ${fmtSigned(lowEndPhaseCorrelation)}`,
        what_happened: "Significant out-of-phase or stereo sub-bass energy detected in local L/R correlation.",
        why_it_matters: "Opposite-polarity L/R audio collapses in mono on smartphones and club PA subwoofers.",
        listen_prompt: "Toggle Mono Fold in the bottom transport dock to hear bass/lead cancellation.",
        what_to_try: "Insert a Mid/Side EQ and high-pass the Side channel at 110–130 Hz.",
        recheck_target: "Bring 20-120 Hz correlation above +0.70.",
      });
    } else {
      findings.push({
        evidence_id: "ev_phase_safe_01",
        category: "stereo_phase",
        severity: "safe",
        classification: "stylistic_choice",
        confidence: "measured",
        title: `Solid Mono Phase Translation (${fmtSigned(phaseCorrelationAvg)})`,
        timestamp_start_sec: loudestSec,
        timestamp_end_sec: loudEnd,
        measured_value: `Avg ${fmtSigned(phaseCorrelationAvg)}, <120Hz ${fmtSigned(lowEndPhaseCorrelation)}`,
        what_happened: "L/R phase correlation stays positive across full spectrum and sub-120 Hz.",
        why_it_matters: "Positive phase ensures consistent punch across mono speakers and club systems.",
        listen_prompt: "Toggle Stereo vs. Mono Fold to confirm snare and sub weight stay locked.",
        what_to_try: "Keep sub frequencies centered below 120 Hz as you refine spatial FX.",
        recheck_target: "Keep correlation above +0.40.",
      });
    }

    const worstBand = [...spectralBands].sort(
      (a, b) => Math.abs(b.delta_vs_genre_median_db) - Math.abs(a.delta_vs_genre_median_db)
    )[0];
    if (worstBand && Math.abs(worstBand.delta_vs_genre_median_db) >= 2.5) {
      const def = BAND_DEFS.find((b) => b.band === worstBand.band)!;
      const d = worstBand.delta_vs_genre_median_db;
      findings.push({
        evidence_id: `ev_tonal_${worstBand.band}_01`,
        category: "tonal_balance",
        severity: Math.abs(d) >= 5.0 ? "alert" : "caution",
        classification: "stylistic_choice",
        confidence: "estimated",
        band_name: worstBand.band,
        title: `${def.label} ${d > 0 ? "Buildup" : "Recessed"} (${def.range} Hz: ${fmtSigned(d, 1)} dB)`,
        timestamp_start_sec: loudestSec,
        timestamp_end_sec: loudEnd,
        measured_value: `${fmtSigned(d, 1)} dB vs ${genre} median`,
        what_happened: `Local FFT measures ${fmtSigned(d, 1)} dB relative to typical ${genre} spectral balance in ${def.range} Hz.`,
        why_it_matters: "Broad tonal tilt shifts how clearly vocals, drums, and bass translate across small speakers.",
        listen_prompt: "Switch between Full Range, Laptop, and Smartphone previews in the transport dock.",
        what_to_try:
          d > 0
            ? `Test a broad -1.5 to -2.5 dB EQ trim in ${def.range} Hz on the dominant bus.`
            : `Restore +1.0 to +2.0 dB gently in ${def.range} Hz if the mix feels veiled.`,
        recheck_target: `Confirm ${def.range} Hz delta settles within +/-2.0 dB.`,
      });
    }
  }

  const sevRank: Record<string, number> = { alert: 0, caution: 1, safe: 2 };
  findings.sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3));

  const context: AnalysisContext = {
    genre,
    stage,
    artist_vision: artistVision,
    has_user_stems: false,
    stem_count: 0,
  };

  return {
    schema_version: "1.0.0",
    session_id: `local_${Date.now().toString(36)}`,
    report_id: `rep_local_${Math.random().toString(36).slice(2, 10)}`,
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    context,
    audio_metadata: {
      filename,
      duration_sec: round2(durationSec),
      sample_rate_hz: sampleRate,
      channels: Math.min(2, channels.length || 1),
      bit_depth: 24,
      playback_proxy_url: playbackUrl,
      waveform_peaks: waveformPeaks,
      clipping_timestamps_sec: clippingTimestamps,
      bpm: null,
      sections: [],
    },
    global_metrics: globalMetrics,
    streaming_estimates: streamingEstimates,
    spectral_bands: spectralBands,
    time_series: {
      step_sec: 1.0,
      short_term_lufs: shortTermLufsSeries,
      phase_correlation: phaseSeries,
    },
    findings,
    stem_analysis: null,
    revision_comparison: null,
    privacy_audit: {
      raw_audio_sent_to_ai: false,
      external_ai_enabled: false,
      training_opt_in: false,
      retention_policy:
        "Local Web Audio Preview computed 100% in your browser while Precision DSP backend wakes up.",
    },
    analysis_source: "local_web_audio_preview",
  };
}

export async function analyzeFileWithWebAudioFallback(params: {
  file: File;
  genre: GenreType;
  stage: StageType;
  artistVision: ArtistVisionTag[];
}): Promise<ClientWebAudioAnalysisResult> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await params.file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, audioBuffer.numberOfChannels); c += 1) {
      channels.push(audioBuffer.getChannelData(c));
    }
    const objectUrl = URL.createObjectURL(params.file);
    const report = analyzePcmChannelsLocal({
      channels,
      sampleRate: audioBuffer.sampleRate,
      filename: params.file.name || "local_mix.wav",
      genre: params.genre,
      stage: params.stage,
      artistVision: params.artistVision,
      playbackUrl: objectUrl,
    });
    return { report, audioBuffer, objectUrl };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

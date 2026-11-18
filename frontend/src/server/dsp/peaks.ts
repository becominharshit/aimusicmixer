import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PeakResult {
  samplePeakDbfs: number;
  truePeakDbtp: number;
  ffmpegTruePeakDbtp: number | null;
  clippingTimestampsSec: number[];
}

function linearToDb(amplitude: number): number {
  if (amplitude <= 1e-12) return -120.0;
  return 20.0 * Math.log10(amplitude);
}

function measureSamplePeakLinear(channelsData: Float64Array[]): number {
  let maxVal = 0.0;
  for (let c = 0; c < channelsData.length; c++) {
    const ch = channelsData[c];
    for (let i = 0; i < ch.length; i++) {
      const abs = Math.abs(ch[i]);
      if (abs > maxVal) maxVal = abs;
    }
  }
  return maxVal;
}

/**
 * Chunked 4x windowed-sinc polyphase FIR oversampled True Peak estimation
 * with direct oversampled clipping timestamp detection (>= 0.0 dBTP / 1.0 linear).
 */
function measure4xPolyphaseTruePeakAndClips(
  channelsData: Float64Array[],
  sampleRate: number,
  clipThresholdLin = 1.0
): { polyDbtp: number; clippingTimestampsSec: number[] } {
  const halfTaps = 12;
  const phases = [0.25, 0.5, 0.75].map((frac) => {
    const kernel = new Float64Array(halfTaps * 2);
    let sum = 0;
    for (let k = -halfTaps + 1; k <= halfTaps; k++) {
      const x = k - frac;
      const sinc = Math.abs(x) < 1e-9 ? 1.0 : Math.sin(Math.PI * x) / (Math.PI * x);
      const u = (k - frac + halfTaps) / (2 * halfTaps);
      const win = 0.5 * (1 - Math.cos(2 * Math.PI * u));
      const w = sinc * win;
      kernel[k + halfTaps - 1] = w;
      sum += w;
    }
    if (sum > 0) {
      for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
    }
    return kernel;
  });

  let maxPeak = measureSamplePeakLinear(channelsData);
  if (maxPeak <= 1e-12) {
    return { polyDbtp: -120.0, clippingTimestampsSec: [] };
  }

  const gate = Math.min(maxPeak * 0.25, 0.7);
  const nSamples = channelsData[0]?.length ?? 0;
  const timestamps: number[] = [];
  let lastTs = -1.0;

  for (let i = 0; i < nSamples; i++) {
    let anyAboveGate = false;
    let sampleClipped = false;
    for (let c = 0; c < channelsData.length; c++) {
      const v = Math.abs(channelsData[c][i]);
      const vNext = i + 1 < nSamples ? Math.abs(channelsData[c][i + 1]) : 0;
      if (v >= clipThresholdLin) sampleClipped = true;
      if (v >= gate || vNext >= gate) anyAboveGate = true;
    }
    if (!anyAboveGate) continue;

    let oversampledClipped = sampleClipped;
    for (let c = 0; c < channelsData.length; c++) {
      const ch = channelsData[c];
      for (let p = 0; p < 3; p++) {
        const kernel = phases[p];
        let acc = 0;
        for (let k = -halfTaps + 1; k <= halfTaps; k++) {
          const idx = i + k;
          if (idx >= 0 && idx < nSamples) {
            acc += ch[idx] * kernel[k + halfTaps - 1];
          }
        }
        const absAcc = Math.abs(acc);
        if (absAcc > maxPeak) maxPeak = absAcc;
        if (absAcc >= clipThresholdLin) oversampledClipped = true;
      }
    }

    if (oversampledClipped && timestamps.length < 50) {
      const ts = Math.round((i / Math.max(sampleRate, 1)) * 100) / 100;
      if (ts - lastTs >= 0.5) {
        timestamps.push(ts);
        lastTs = ts;
      }
    }
  }

  return { polyDbtp: linearToDb(maxPeak), clippingTimestampsSec: timestamps };
}

async function measureFfmpegEbur128TruePeak(sourcePath?: string): Promise<number | null> {
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-nostats", "-i", sourcePath, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
      { timeout: 45000, maxBuffer: 4 * 1024 * 1024 }
    );
    const match = stderr.match(
      /True peak:\s*(?:\r?\n)+\s*Peak:\s*([+-]?\d+(?:\.\d+)?)\s*dBFS/
    );
    if (match) {
      const val = Number.parseFloat(match[1]);
      return Number.isFinite(val) ? val : null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function computePeakMetrics(
  channelsData: Float64Array[],
  sampleRate: number,
  sourcePath?: string
): Promise<PeakResult> {
  const samplePeakLin = measureSamplePeakLinear(channelsData);
  if (channelsData.length === 0 || channelsData[0].length === 0 || samplePeakLin <= 1e-12) {
    return {
      samplePeakDbfs: -120.0,
      truePeakDbtp: -120.0,
      ffmpegTruePeakDbtp: null,
      clippingTimestampsSec: [],
    };
  }

  const samplePeakDbfs = linearToDb(samplePeakLin);
  let truePeakDbtp = samplePeakDbfs;
  let ffmpegDbtp: number | null = null;
  let clipTimes: number[] = [];

  try {
    const { polyDbtp, clippingTimestampsSec } = measure4xPolyphaseTruePeakAndClips(
      channelsData,
      sampleRate
    );
    truePeakDbtp = Math.max(samplePeakDbfs, polyDbtp);
    clipTimes = clippingTimestampsSec;
  } catch {
    ffmpegDbtp = await measureFfmpegEbur128TruePeak(sourcePath);
    if (ffmpegDbtp !== null && Number.isFinite(ffmpegDbtp)) {
      truePeakDbtp = Math.max(samplePeakDbfs, ffmpegDbtp);
    }
  }

  return {
    samplePeakDbfs: Math.round(samplePeakDbfs * 100) / 100,
    truePeakDbtp: Math.round(truePeakDbtp * 100) / 100,
    ffmpegTruePeakDbtp: ffmpegDbtp !== null ? Math.round(ffmpegDbtp * 100) / 100 : null,
    clippingTimestampsSec: clipTimes,
  };
}

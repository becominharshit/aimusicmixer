export interface DynamicsResult {
  crestFactorDb: number;
  plrDb: number;
  psrDb: number;
  rmsDbfs: number;
  transientPunchDb: number;
}

export function computeTransientPunchDb(
  channelsData: Float64Array[],
  sampleRate = 44100
): number {
  const nSamples = channelsData[0]?.length ?? 0;
  if (nSamples === 0 || sampleRate <= 0) return 0.0;

  const mono = new Float64Array(nSamples);
  if (channelsData.length === 1) {
    mono.set(channelsData[0]);
  } else {
    const ch0 = channelsData[0];
    const ch1 = channelsData[1];
    for (let i = 0; i < nSamples; i++) mono[i] = 0.5 * (ch0[i] + ch1[i]);
  }

  let maxAbs = 0;
  for (let i = 0; i < nSamples; i++) {
    const a = Math.abs(mono[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs <= 1e-6) return 0.0;

  const fastWin = Math.max(16, Math.round(sampleRate * 0.01)); // 10 ms attack
  const slowWin = Math.max(fastWin * 4, Math.round(sampleRate * 0.2)); // 200 ms body
  const nBlocks = Math.floor(nSamples / slowWin);
  if (nBlocks < 1) {
    let sumSq = 0;
    for (let i = 0; i < nSamples; i++) sumSq += mono[i] * mono[i];
    const rms = Math.sqrt(sumSq / nSamples + 1e-12);
    const db = Math.max(0.0, Math.min(24.0, 20.0 * Math.log10(Math.max(maxAbs, 1e-12) / Math.max(rms, 1e-12))));
    return Math.round(db * 100) / 100;
  }

  const subCount = Math.max(1, Math.floor(slowWin / fastWin));
  const silenceGate = Math.pow(10, -45.0 / 20.0);
  const ratiosDb: number[] = [];

  for (let b = 0; b < nBlocks; b++) {
    const blockStart = b * slowWin;
    let bodySq = 0;
    for (let i = blockStart; i < blockStart + slowWin; i++) {
      bodySq += mono[i] * mono[i];
    }
    const bodyRms = Math.sqrt(bodySq / slowWin + 1e-12);
    if (bodyRms < silenceGate) continue;

    let maxFastRms = 0;
    for (let s = 0; s < subCount; s++) {
      const fStart = blockStart + s * fastWin;
      let fSq = 0;
      for (let i = fStart; i < fStart + fastWin; i++) {
        fSq += mono[i] * mono[i];
      }
      const fRms = Math.sqrt(fSq / fastWin + 1e-12);
      if (fRms > maxFastRms) maxFastRms = fRms;
    }

    const ratio = 20.0 * Math.log10(Math.max(maxFastRms, 1e-12) / Math.max(bodyRms, 1e-12));
    ratiosDb.push(Math.max(0.0, Math.min(24.0, ratio)));
  }

  if (ratiosDb.length === 0) return 0.0;
  ratiosDb.sort((a, b) => a - b);
  const idx = 0.8 * (ratiosDb.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const p80 = lo === hi ? ratiosDb[lo] : ratiosDb[lo] * (1 - (idx - lo)) + ratiosDb[hi] * (idx - lo);
  return Math.round(p80 * 100) / 100;
}

export function computeDynamicsMetrics(
  channelsData: Float64Array[],
  samplePeakDbfs: number,
  truePeakDbtp: number,
  shortTermMaxLufs: number,
  integratedLufs?: number,
  sampleRate = 44100
): DynamicsResult {
  const nSamples = channelsData[0]?.length ?? 0;
  const nChannels = channelsData.length;
  if (nSamples === 0 || nChannels === 0) {
    return { crestFactorDb: 0.0, plrDb: 0.0, psrDb: 0.0, rmsDbfs: -120.0, transientPunchDb: 0.0 };
  }

  // Silence-gated chunked RMS: exclude chunks below -60 dBFS (mean_sq < 1e-6)
  // so digital silence/fades do not artificially inflate Crest Factor.
  const chunkLen = 16384;
  let peakLin = 0.0;
  let gatedSumSq = 0.0;
  let gatedCount = 0;
  let totalSumSq = 0.0;
  let totalCount = 0;

  for (let start = 0; start < nSamples; start += chunkLen) {
    const end = Math.min(nSamples, start + chunkLen);
    let cSumSq = 0.0;
    const cCount = (end - start) * nChannels;
    for (let c = 0; c < nChannels; c++) {
      const ch = channelsData[c];
      for (let i = start; i < end; i++) {
        const v = ch[i];
        const abs = Math.abs(v);
        if (abs > peakLin) peakLin = abs;
        cSumSq += v * v;
      }
    }
    totalSumSq += cSumSq;
    totalCount += cCount;
    if (cCount > 0 && cSumSq / cCount >= 1e-6) {
      gatedSumSq += cSumSq;
      gatedCount += cCount;
    }
  }

  if (peakLin <= 1e-12) {
    return { crestFactorDb: 0.0, plrDb: 0.0, psrDb: 0.0, rmsDbfs: -120.0, transientPunchDb: 0.0 };
  }

  const activeSumSq = gatedCount > 0 ? gatedSumSq : totalSumSq;
  const activeCount = gatedCount > 0 ? gatedCount : totalCount;
  const rms = Math.sqrt(activeSumSq / Math.max(1, activeCount));
  const rmsDbfs = 20.0 * Math.log10(Math.max(rms, 1e-12));
  const crestFactor = Math.max(0.0, samplePeakDbfs - rmsDbfs);
  const psr = shortTermMaxLufs > -69.5 ? Math.max(0.0, truePeakDbtp - shortTermMaxLufs) : 0.0;
  const plr =
    integratedLufs !== undefined && integratedLufs > -69.5
      ? Math.max(0.0, truePeakDbtp - integratedLufs)
      : psr;
  const transientPunchDb = computeTransientPunchDb(channelsData, sampleRate);

  return {
    crestFactorDb: Math.round(crestFactor * 100) / 100,
    plrDb: Math.round(plr * 100) / 100,
    psrDb: Math.round(psr * 100) / 100,
    rmsDbfs: Math.round(rmsDbfs * 100) / 100,
    transientPunchDb,
  };
}

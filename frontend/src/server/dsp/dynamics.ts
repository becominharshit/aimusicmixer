export interface DynamicsResult {
  crestFactorDb: number;
  plrDb: number;
  psrDb: number;
  rmsDbfs: number;
}

export function computeDynamicsMetrics(
  channelsData: Float64Array[],
  samplePeakDbfs: number,
  truePeakDbtp: number,
  shortTermMaxLufs: number,
  integratedLufs?: number
): DynamicsResult {
  const nSamples = channelsData[0]?.length ?? 0;
  const nChannels = channelsData.length;
  if (nSamples === 0 || nChannels === 0) {
    return { crestFactorDb: 0.0, plrDb: 0.0, psrDb: 0.0, rmsDbfs: -120.0 };
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
    return { crestFactorDb: 0.0, plrDb: 0.0, psrDb: 0.0, rmsDbfs: -120.0 };
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

  return {
    crestFactorDb: Math.round(crestFactor * 100) / 100,
    plrDb: Math.round(plr * 100) / 100,
    psrDb: Math.round(psr * 100) / 100,
    rmsDbfs: Math.round(rmsDbfs * 100) / 100,
  };
}

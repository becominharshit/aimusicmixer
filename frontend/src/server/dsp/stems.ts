import fsp from "node:fs/promises";
import path from "node:path";
import type { BandName, StemAnalysis, StemMetric, StemOverlapPair, StemSumResidual } from "@/types/report";
import { fftInPlace, hannWindow, nextPowerOf2, resampleChannelLinear, welchDensitySpectrum } from "./fft";
import { AudioIngestionError, type LoadedAudio, loadAudioFile } from "./ingest";
import { computeLoudnessMetrics } from "./loudness";
import { computePeakMetrics } from "./peaks";
import { BAND_DEFINITIONS } from "./spectrum";
import { computeStereoMetrics } from "./stereo";

function spectralCentroidAndBands(
  channelsData: Float64Array[],
  sampleRate: number
): { centroid: number; bands: Record<string, number> } {
  const nSamples = channelsData[0]?.length ?? 0;
  let maxAbs = 0;
  for (let c = 0; c < channelsData.length; c++) {
    const ch = channelsData[c];
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > maxAbs) maxAbs = a;
    }
  }
  if (nSamples === 0 || maxAbs <= 1e-12) {
    const empty: Record<string, number> = {};
    for (const [b] of BAND_DEFINITIONS) empty[b] = -70.0;
    return { centroid: 0.0, bands: empty };
  }

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
      for (let k = 0; k < avgPsd.length; k++) avgPsd[k] += res.psd[k];
    }
  }
  if (!freqs || !avgPsd) {
    const empty: Record<string, number> = {};
    for (const [b] of BAND_DEFINITIONS) empty[b] = -70.0;
    return { centroid: 0.0, bands: empty };
  }
  const nCh = Math.max(1, channelsData.length);
  let totalP = 0;
  let weightedFreq = 0;
  for (let k = 0; k < avgPsd.length; k++) {
    const pBin = (avgPsd[k] / nCh) * df;
    avgPsd[k] = pBin;
    totalP += pBin;
    weightedFreq += freqs[k] * pBin;
  }
  const centroid = totalP > 1e-12 ? weightedFreq / totalP : 0.0;

  const nyquist = sampleRate / 2.0;
  const bandEnergies: Record<string, number> = {};
  for (const [bandName, , fLow, fHigh] of BAND_DEFINITIONS) {
    if (fLow >= nyquist) {
      bandEnergies[bandName] = -70.0;
      continue;
    }
    const upper = Math.min(fHigh, nyquist);
    let pBand = 0;
    let hasBin = false;
    for (let k = 0; k < freqs.length; k++) {
      if (freqs[k] >= fLow && freqs[k] < upper) {
        pBand += avgPsd[k];
        hasBin = true;
      }
    }
    bandEnergies[bandName] = hasBin
      ? Math.round(Math.max(-70.0, 10.0 * Math.log10(Math.max(pBand, 1e-12))) * 100) / 100
      : -70.0;
  }

  return { centroid: Math.round(centroid * 10) / 10, bands: bandEnergies };
}

function cleanStemName(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return base.replace(/[_-]+/g, " ").trim() || filename;
}

function detectFirstOnsetSec(channelsData: Float64Array[], sampleRate: number, threshold = 0.01): number | null {
  const n = channelsData[0]?.length ?? 0;
  if (n === 0 || sampleRate <= 0) return null;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channelsData.length; c++) {
      if (Math.abs(channelsData[c][i]) >= threshold) {
        return Math.round((i / sampleRate) * 1000) / 1000;
      }
    }
  }
  return null;
}

function monoMix(channelsData: Float64Array[], length: number): Float64Array {
  const out = new Float64Array(length);
  if (channelsData.length === 1) {
    out.set(channelsData[0].subarray(0, length));
  } else {
    const ch0 = channelsData[0];
    const ch1 = channelsData[1];
    for (let i = 0; i < length; i++) out[i] = 0.5 * (ch0[i] + ch1[i]);
  }
  return out;
}

/**
 * Memory-bounded chunked band cross-correlation across overlapping 16384-sample FFT frames.
 */
function bandCrossCorrelation(
  monoA: Float64Array,
  monoB: Float64Array,
  sampleRate: number,
  fLow: number,
  fHigh: number
): number | null {
  const n = Math.min(monoA.length, monoB.length);
  if (n < 64 || sampleRate <= 0) return null;

  const frameLen = Math.min(16384, nextPowerOf2(Math.max(256, Math.min(n, 16384))));
  const hop = Math.max(256, Math.floor(frameLen / 2));
  const win = hannWindow(frameLen);
  const df = sampleRate / frameLen;
  const upper = Math.min(fHigh, sampleRate / 2.0);
  const kLow = Math.max(1, Math.ceil(fLow / df));
  const kHigh = Math.min(frameLen / 2, Math.floor(upper / df));
  if (kHigh < kLow) return null;

  const reA = new Float64Array(frameLen);
  const imA = new Float64Array(frameLen);
  const reB = new Float64Array(frameLen);
  const imB = new Float64Array(frameLen);

  let crossReal = 0;
  let powA = 0;
  let powB = 0;

  for (let start = 0; start < n; start += hop) {
    const end = Math.min(n, start + frameLen);
    const len = end - start;
    reA.fill(0);
    imA.fill(0);
    reB.fill(0);
    imB.fill(0);
    for (let i = 0; i < len; i++) {
      reA[i] = monoA[start + i] * win[i];
      reB[i] = monoB[start + i] * win[i];
    }
    fftInPlace(reA, imA);
    fftInPlace(reB, imB);

    for (let k = kLow; k <= kHigh; k++) {
      const ar = reA[k];
      const ai = imA[k];
      const br = reB[k];
      const bi = imB[k];
      crossReal += ar * br + ai * bi;
      powA += ar * ar + ai * ai;
      powB += br * br + bi * bi;
    }
    if (end >= n) break;
  }

  const denom = Math.sqrt(powA * powB);
  if (denom <= 1e-12) return 0.0;
  const corr = Math.max(-1.0, Math.min(1.0, crossReal / denom));
  return Math.round(corr * 1000) / 1000;
}

export async function analyzeUserStems(
  stemFiles: Array<[string, string]>,
  mixAudio: LoadedAudio | null = null,
  maxTotalBytes?: number
): Promise<StemAnalysis> {
  if (stemFiles.length < 2 || stemFiles.length > 8) {
    throw new AudioIngestionError(
      `Stem analysis requires between 2 and 8 user-supplied stems (received ${stemFiles.length}).`
    );
  }

  let totalBytes = 0;
  for (const [, p] of stemFiles) {
    const st = await fsp.stat(p).catch(() => null);
    if (st) totalBytes += st.size;
  }
  if (maxTotalBytes !== undefined && totalBytes > maxTotalBytes) {
    throw new AudioIngestionError(
      `Total stem upload (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) exceeds limit.`
    );
  }

  const loaded: Array<{ filename: string; path: string; audio: LoadedAudio }> = [];
  const onsetsSec: number[] = [];
  for (const [filename, filePath] of stemFiles) {
    const audio = await loadAudioFile(filePath);
    loaded.push({ filename, path: filePath, audio });
    const onset = detectFirstOnsetSec(audio.channelsData, audio.sampleRate);
    if (onset !== null) onsetsSec.push(onset);
  }

  const durations = loaded.map((item) => item.audio.durationSec);
  const sampleRates = Array.from(new Set(loaded.map((item) => item.audio.sampleRate))).sort(
    (a, b) => a - b
  );
  const channelCounts = Array.from(new Set(loaded.map((item) => item.audio.channels))).sort(
    (a, b) => a - b
  );
  const maxDeltaMs = Math.round((Math.max(...durations) - Math.min(...durations)) * 1000.0 * 100) / 100;
  const warnings: string[] = [];

  if (sampleRates.length > 1) {
    warnings.push(
      `Mixed stem sample rates detected ([${sampleRates.join(", ")}] Hz); resampled to ${loaded[0].audio.sampleRate} Hz for sum & phase interaction.`
    );
  }
  if (channelCounts.length > 1) {
    warnings.push(
      `Mixed stem channel counts detected ([${channelCounts.join(", ")}] channels: mono + stereo). Verify intended panning/routing on mono stems.`
    );
  }

  const alignmentPassed = maxDeltaMs <= 50.0;
  if (!alignmentPassed) {
    warnings.push(
      `Stem duration mismatch of ${maxDeltaMs.toFixed(1)} ms exceeds the 50 ms alignment tolerance. Export all stems from the same bar 1 bounce point.`
    );
  }

  if (onsetsSec.length >= 2) {
    const onsetSpreadMs = (Math.max(...onsetsSec) - Math.min(...onsetsSec)) * 1000.0;
    if (onsetSpreadMs > 50.0 && onsetSpreadMs <= 1500.0) {
      warnings.push(
        `Acoustic stem onsets diverge by ${onsetSpreadMs.toFixed(0)} ms across stems. Verify stems weren't trimmed or shifted despite matching durations.`
      );
    }
  }

  if (mixAudio) {
    const avgDur = durations.reduce((a, b) => a + b, 0) / durations.length;
    const mixDeltaMs = Math.abs(mixAudio.durationSec - avgDur) * 1000.0;
    if (mixDeltaMs > 100.0) {
      warnings.push(
        `Stems differ from primary stereo mix duration by ${mixDeltaMs.toFixed(0)} ms; residual metric is approximate.`
      );
    }
  }

  const stemMetrics: StemMetric[] = [];
  for (let idx = 0; idx < loaded.length; idx++) {
    const { filename, audio } = loaded[idx];
    const loudness = computeLoudnessMetrics(audio.channelsData, audio.sampleRate);
    const peaks = await computePeakMetrics(audio.channelsData, audio.sampleRate);
    const stereo = computeStereoMetrics(audio.channelsData, audio.sampleRate);
    const { centroid, bands } = spectralCentroidAndBands(audio.channelsData, audio.sampleRate);
    stemMetrics.push({
      stem_id: `stem_${idx + 1}`,
      name: cleanStemName(filename),
      filename,
      duration_sec: audio.durationSec,
      sample_rate_hz: audio.sampleRate,
      channels: audio.channels,
      integrated_lufs: loudness.integratedLufs,
      sample_peak_dbfs: peaks.samplePeakDbfs,
      true_peak_dbtp: peaks.truePeakDbtp,
      headroom_db: Math.round((0.0 - peaks.truePeakDbtp) * 100) / 100,
      phase_correlation_avg: stereo.phaseCorrelationAvg,
      spectral_centroid_hz: centroid,
      band_energies_db: bands,
    });
  }

  const refSr = loaded[0].audio.sampleRate;
  const resampledMonos: Float64Array[] = loaded.map((item) => {
    const resampledChans =
      item.audio.sampleRate === refSr
        ? item.audio.channelsData
        : item.audio.channelsData.map((ch) =>
            resampleChannelLinear(ch, item.audio.sampleRate, refSr)
          );
    return monoMix(resampledChans, resampledChans[0]?.length ?? 0);
  });

  const overlapPairs: StemOverlapPair[] = [];
  const bandRangeMap = Object.fromEntries(BAND_DEFINITIONS.map(([b, r]) => [b, r])) as Record<
    BandName,
    string
  >;
  let pairIdx = 0;

  for (let i = 0; i < stemMetrics.length; i++) {
    for (let j = i + 1; j < stemMetrics.length; j++) {
      const sa = stemMetrics[i];
      const sb = stemMetrics[j];
      for (const [bandName, rangeHz, fLow, fHigh] of BAND_DEFINITIONS) {
        if (!["sub", "low", "low_mid", "high_mid"].includes(bandName)) continue;
        const ea = sa.band_energies_db[bandName] ?? -70.0;
        const eb = sb.band_energies_db[bandName] ?? -70.0;
        if (ea > -32.0 && eb > -32.0 && Math.abs(ea - eb) <= 7.0) {
          const minE = Math.min(ea, eb);
          const score = Math.round(Math.max(0.0, Math.min(1.0, (minE + 36.0) / 24.0)) * 100) / 100;
          if (score >= 0.45) {
            pairIdx += 1;
            const combinedLinear = Math.pow(10, ea / 10.0) + Math.pow(10, eb / 10.0);
            const combinedDb = 10.0 * Math.log10(Math.max(combinedLinear, 1e-12));
            const excess = Math.round((combinedDb - Math.max(ea, eb)) * 100) / 100;
            const phaseCorr = alignmentPassed
              ? bandCrossCorrelation(resampledMonos[i], resampledMonos[j], refSr, fLow, fHigh)
              : null;
            const phaseRisk = phaseCorr !== null && phaseCorr < -0.15;
            const severity =
              phaseRisk || (score >= 0.78 && ["sub", "low", "low_mid"].includes(bandName))
                ? "alert"
                : "caution";
            const phaseClause = phaseRisk
              ? ` Band phase interaction measures ${phaseCorr! >= 0 ? "+" : ""}${phaseCorr!.toFixed(2)} (possible cancellation when summed).`
              : phaseCorr !== null
                ? ` Band phase interaction measures ${phaseCorr >= 0 ? "+" : ""}${phaseCorr.toFixed(2)}.`
                : "";
            overlapPairs.push({
              evidence_id: `ev_stem_overlap_${String(pairIdx).padStart(2, "0")}`,
              stem_a: sa.name,
              stem_b: sb.name,
              band: bandName,
              range_hz: bandRangeMap[bandName],
              overlap_score: score,
              combined_excess_db: excess,
              phase_interaction_corr: phaseCorr,
              phase_cancellation_risk: phaseRisk,
              severity,
              note: `Possible frequency masking in ${rangeHz} Hz between '${sa.name}' (${ea.toFixed(1)} dB) and '${sb.name}' (${eb.toFixed(1)} dB).${phaseClause} Audition both soloed together before deciding if carving 1.5–3 dB or checking polarity improves clarity.`,
            });
          }
        }
      }
    }
  }

  overlapPairs.sort((a, b) => b.overlap_score - a.overlap_score);
  const topPairs = overlapPairs.slice(0, 8);

  let residual: StemSumResidual | null = null;
  if (mixAudio && alignmentPassed) {
    const targetSr = mixAudio.sampleRate;
    const targetChannels = mixAudio.channels;
    const alignedArrays: Float64Array[][] = loaded.map(({ audio }) => {
      const chans =
        audio.sampleRate === targetSr
          ? audio.channelsData
          : audio.channelsData.map((ch) => resampleChannelLinear(ch, audio.sampleRate, targetSr));
      if (chans.length === 1 && targetChannels === 2) {
        return [chans[0], chans[0]];
      }
      if (chans.length === 2 && targetChannels === 1) {
        const m = new Float64Array(chans[0].length);
        for (let i = 0; i < m.length; i++) m[i] = 0.5 * (chans[0][i] + chans[1][i]);
        return [m];
      }
      return chans;
    });

    const minLen = Math.min(
      mixAudio.channelsData[0].length,
      ...alignedArrays.map((a) => a[0]?.length ?? 0)
    );
    if (minLen > 0) {
      let mixSumSq = 0;
      let sumSumSq = 0;
      let mixPeak = 0;
      let sumPeak = 0;
      let dot = 0;
      let sumM = 0;
      let sumS = 0;
      const totalEl = minLen * targetChannels;

      for (let c = 0; c < targetChannels; c++) {
        const mCh = mixAudio.channelsData[c];
        for (let i = 0; i < minLen; i++) {
          const mv = mCh[i];
          let sv = 0;
          for (let a = 0; a < alignedArrays.length; a++) {
            sv += alignedArrays[a][c][i];
          }
          mixSumSq += mv * mv;
          sumSumSq += sv * sv;
          dot += mv * sv;
          sumM += mv;
          sumS += sv;
          const absM = Math.abs(mv);
          const absS = Math.abs(sv);
          if (absM > mixPeak) mixPeak = absM;
          if (absS > sumPeak) sumPeak = absS;
        }
      }

      const mixRms = Math.sqrt(mixSumSq / Math.max(1, totalEl));
      const sumRms = Math.sqrt(sumSumSq / Math.max(1, totalEl));
      const rmsDiff =
        20.0 * Math.log10(Math.max(mixRms, 1e-12)) - 20.0 * Math.log10(Math.max(sumRms, 1e-12));
      const peakDiff =
        20.0 * Math.log10(Math.max(mixPeak, 1e-12)) - 20.0 * Math.log10(Math.max(sumPeak, 1e-12));

      const cov = dot - (sumM * sumS) / totalEl;
      const varM = Math.max(0, mixSumSq - (sumM * sumM) / totalEl);
      const varS = Math.max(0, sumSumSq - (sumS * sumS) / totalEl);
      const denom = Math.sqrt(varM * varS);
      const corr = denom > 1e-12 ? Math.max(-1.0, Math.min(1.0, cov / denom)) : 0.0;

      residual = {
        rms_diff_db: Math.round(rmsDiff * 100) / 100,
        peak_diff_db: Math.round(peakDiff * 100) / 100,
        correlation_with_mix: Math.round(corr * 1000) / 1000,
        note: "Difference between the stereo mixdown and raw stem sum typically reflects master-bus compression, saturation, limiting, or return-track effects.",
      };
    }
  }

  return {
    alignment_passed: alignmentPassed,
    max_duration_delta_ms: maxDeltaMs,
    alignment_warnings: warnings,
    stems: stemMetrics,
    overlap_matrix: topPairs,
    stem_sum_residual: residual,
  };
}

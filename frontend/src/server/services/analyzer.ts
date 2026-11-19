import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type {
  AnalysisContext,
  AnalysisReport,
  BandName,
  GlobalMetrics,
} from "@/types/report";
import { computeDynamicsMetrics } from "../dsp/dynamics";
import { createPlaybackProxy, loadAudioFile, type LoadedAudio } from "../dsp/ingest";
import { computeLoudnessMetrics } from "../dsp/loudness";
import { computePeakMetrics } from "../dsp/peaks";
import { buildSpectralBandsFromEnergies, computeSpectralProfile } from "../dsp/spectrum";
import { computeStereoMetrics } from "../dsp/stereo";
import { analyzeSongStructure } from "../dsp/structure";
import { computeStreamingEstimates, evaluateMixFindings } from "../rules/evaluator";
import type { CachedDspSnapshot } from "./sessionStore";

export async function analyzeAudioToReport(params: {
  sessionId: string;
  sourcePath: string;
  originalFilename: string;
  proxyDir: string;
  proxyName: string;
  proxyUrl: string;
  context: AnalysisContext;
  maxFileBytes?: number;
}): Promise<{ report: AnalysisReport; loaded: LoadedAudio; snapshot: CachedDspSnapshot; proxyPath: string }> {
  const loaded = await loadAudioFile(params.sourcePath, params.maxFileBytes);
  const proxyPath = await createPlaybackProxy(params.sourcePath, params.proxyDir, params.proxyName);

  const loudness = computeLoudnessMetrics(loaded.channelsData, loaded.sampleRate);
  const peaks = await computePeakMetrics(loaded.channelsData, loaded.sampleRate, params.sourcePath);
  const dynamics = computeDynamicsMetrics(
    loaded.channelsData,
    peaks.samplePeakDbfs,
    peaks.truePeakDbtp,
    loudness.shortTermMaxLufs,
    loudness.integratedLufs,
    loaded.sampleRate
  );
  const spectral = computeSpectralProfile(
    loaded.channelsData,
    loaded.sampleRate,
    params.context.genre
  );
  const stereo = computeStereoMetrics(loaded.channelsData, loaded.sampleRate);
  const structure = analyzeSongStructure(
    loaded.channelsData,
    loaded.sampleRate,
    loaded.durationSec,
    loudness.shortTermLufsSeries
  );

  const globalMetrics: GlobalMetrics = {
    integrated_lufs: loudness.integratedLufs,
    short_term_max_lufs: loudness.shortTermMaxLufs,
    momentary_max_lufs: loudness.momentaryMaxLufs,
    loudness_range_lu: loudness.loudnessRangeLu,
    sample_peak_dbfs: peaks.samplePeakDbfs,
    true_peak_dbtp: peaks.truePeakDbtp,
    crest_factor_db: dynamics.crestFactorDb,
    plr_db: dynamics.plrDb,
    psr_db: dynamics.psrDb,
    transient_punch_db: dynamics.transientPunchDb,
    phase_correlation_avg: stereo.phaseCorrelationAvg,
    low_end_phase_correlation: stereo.lowEndPhaseCorrelation,
    stereo_width_ratio: stereo.stereoWidthRatio,
  };

  const streamingEstimates = computeStreamingEstimates(globalMetrics);
  const findings = evaluateMixFindings(
    params.context,
    loaded.durationSec,
    loudness,
    peaks,
    dynamics,
    spectral,
    stereo
  );

  const nPts = Math.max(
    loudness.shortTermLufsSeries.length,
    stereo.phaseCorrelationSeries.length
  );
  const stSeries = [...loudness.shortTermLufsSeries];
  const phSeries = [...stereo.phaseCorrelationSeries];
  while (stSeries.length < nPts) stSeries.push(stSeries.at(-1) ?? -70.0);
  while (phSeries.length < nPts) phSeries.push(phSeries.at(-1) ?? 1.0);

  const actualProxyFilename = path.basename(proxyPath);
  const finalProxyUrl = `${params.proxyUrl.replace(/\/[^/]+$/, "")}/${actualProxyFilename}`;

  const report: AnalysisReport = {
    schema_version: "1.0.0",
    session_id: params.sessionId,
    report_id: `rep_${crypto.randomBytes(4).toString("hex")}`,
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    context: params.context,
    audio_metadata: {
      filename: params.originalFilename,
      duration_sec: loaded.durationSec,
      sample_rate_hz: loaded.sampleRate,
      channels: loaded.channels,
      bit_depth: loaded.bitDepth,
      playback_proxy_url: finalProxyUrl,
      waveform_peaks: loaded.waveformPeaks,
      clipping_timestamps_sec: peaks.clippingTimestampsSec,
      bpm: structure.bpm,
      sections: structure.sections,
    },
    global_metrics: globalMetrics,
    streaming_estimates: streamingEstimates,
    spectral_bands: spectral.bands,
    time_series: {
      step_sec: 1.0,
      short_term_lufs: stSeries.slice(0, nPts),
      phase_correlation: phSeries.slice(0, nPts),
    },
    findings,
    stem_analysis: null,
    revision_comparison: null,
    privacy_audit: {
      raw_audio_sent_to_ai: false,
      external_ai_enabled: false,
      training_opt_in: false,
      retention_policy: "Zero raw audio transmitted to external AI by default.",
    },
  };

  const bandEnergiesDb = Object.fromEntries(
    spectral.bands.map((b) => [b.band, b.energy_db])
  ) as Record<BandName, number>;

  const snapshot: CachedDspSnapshot = {
    durationSec: loaded.durationSec,
    loudness,
    peaks,
    dynamics,
    spectral,
    stereo,
    bandEnergiesDb,
    bpm: structure.bpm,
    sections: structure.sections,
  };

  return { report, loaded, snapshot, proxyPath };
}

export function reevaluateReportContext(
  report: AnalysisReport,
  snapshot: CachedDspSnapshot | null,
  newContext: AnalysisContext
): AnalysisReport {
  report.context = newContext;
  const bandEnergies =
    snapshot?.bandEnergiesDb ??
    (Object.fromEntries(report.spectral_bands.map((b) => [b.band, b.energy_db])) as Record<
      BandName,
      number
    >);

  const updatedBands = buildSpectralBandsFromEnergies(bandEnergies, newContext.genre);
  report.spectral_bands = updatedBands;

  if (snapshot) {
    report.streaming_estimates = computeStreamingEstimates(report.global_metrics);
    report.findings = evaluateMixFindings(
      newContext,
      snapshot.durationSec,
      snapshot.loudness,
      snapshot.peaks,
      snapshot.dynamics,
      {
        bands: updatedBands,
        bandPeakWindows: snapshot.spectral.bandPeakWindows,
      },
      snapshot.stereo
    );
  }
  return report;
}

export async function readProxyFileBytes(proxyPath: string): Promise<Buffer> {
  if (!fs.existsSync(proxyPath)) {
    throw new Error(`Proxy file missing: ${proxyPath}`);
  }
  return fsp.readFile(proxyPath);
}

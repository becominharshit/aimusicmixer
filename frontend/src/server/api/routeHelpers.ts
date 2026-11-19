import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import type {
  AnalysisContext,
  AnalysisReport,
  ArtistVisionTag,
  GenreType,
  GlobalMetrics,
  SpectralBand,
  StageType,
} from "@/types/report";
import { serverConfig } from "../config";
import { computeDynamicsMetrics } from "../dsp/dynamics";
import {
  AudioIngestionError,
  UnsupportedAudioMediaError,
  createPlaybackProxy,
  loadAudioFile,
} from "../dsp/ingest";
import { computeLoudnessMetrics } from "../dsp/loudness";
import { computePeakMetrics } from "../dsp/peaks";
import { buildSpectralBandsFromEnergies, computeSpectralProfile } from "../dsp/spectrum";
import { computeStereoMetrics } from "../dsp/stereo";
import { computeStreamingEstimates, evaluateMixFindings } from "../rules/evaluator";
import type {
  DemoMixCacheEntry,
  SessionRecord,
  Sha256CachedAnalysis,
} from "../services/sessionStore";
import { sessionStore } from "../services/sessionStore";

export const DSP_CONCURRENCY_LIMIT = 2;

class AsyncSemaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly maxConcurrent: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const dspSemaphore = new AsyncSemaphore(DSP_CONCURRENCY_LIMIT);

export function withDspSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  return dspSemaphore.run(fn);
}

const execFileAsync = promisify(execFile);

const VALID_VISION_TAGS = new Set<string>(["punchy", "warm", "aggressive", "wide", "dynamic"]);
const VALID_GENRES = new Set<GenreType>([
  "electronic",
  "pop",
  "hip_hop",
  "rock",
  "acoustic",
  "ambient",
  "other",
]);
const VALID_STAGES = new Set<StageType>(["unmastered_mix", "final_master"]);

export function extractVerifiedJwtSub(request: Request): string | null {
  const authHeader = (request.headers.get("authorization") ?? "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf-8")) as Record<
      string,
      unknown
    >;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<
      string,
      unknown
    >;
    const sub = payload.sub;
    if (typeof sub !== "string" || !sub.trim()) return null;
    if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;

    const secret = serverConfig.supabaseJwtSecret;
    if (secret) {
      if (header.alg !== "HS256") return null;
      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${parts[0]}.${parts[1]}`)
        .digest();
      const actual = Buffer.from(parts[2], "base64url");
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return null;
      }
    }

    return sub.trim();
  } catch {
    return null;
  }
}

function extractAuthenticatedSubject(request: Request): string | null {
  const sub = extractVerifiedJwtSub(request);
  if (!sub) return null;
  const digest = crypto.createHash("sha256").update(sub).digest("hex").slice(0, 16);
  return `user:${digest}`;
}

export function assertSessionAccess(rec: SessionRecord, request: Request): void {
  if (!rec.ownerUserId) return;
  const callerSub = extractVerifiedJwtSub(request);
  if (callerSub !== rec.ownerUserId) {
    throw new HttpStatusError(403, "Forbidden: you do not have permission to access this session.");
  }
}

export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    for (const hop of fwd.split(",")) {
      const ip = hop.trim();
      if (ip) return ip;
    }
  }
  return request.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

export function rateLimitErrorResponse(request: Request, bucket: string): NextResponse | null {
  const authSubject = extractAuthenticatedSubject(request);
  const identity = authSubject ?? getClientIp(request);
  const { allowed, retryAfterSec } = sessionStore.checkRateLimit(
    identity,
    bucket,
    authSubject !== null
  );
  if (allowed) return null;
  return NextResponse.json(
    {
      detail: `Rate limit exceeded for ${bucket}. Please wait ${retryAfterSec}s before retrying.`,
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    }
  );
}

export function parseGenre(raw: unknown): GenreType {
  const s = String(raw ?? "electronic").trim().toLowerCase() as GenreType;
  return VALID_GENRES.has(s) ? s : "electronic";
}

export function parseStage(raw: unknown): StageType {
  const s = String(raw ?? "unmastered_mix").trim().toLowerCase() as StageType;
  return VALID_STAGES.has(s) ? s : "unmastered_mix";
}

export function parseArtistVision(raw: unknown): ArtistVisionTag[] {
  const str = String(raw ?? "").trim();
  if (!str) return [];
  let items: string[];
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) {
      items = parsed.map((x) => String(x).trim().toLowerCase());
    } else {
      items = [String(parsed).trim().toLowerCase()];
    }
  } catch {
    items = str
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
  }
  return items.filter((t): t is ArtistVisionTag => VALID_VISION_TAGS.has(t));
}

export function tmpUploadPath(prefix: string, safeName: string): string {
  fs.mkdirSync(serverConfig.tmpUploadsDir, { recursive: true });
  const base = path.basename(safeName || "upload.wav");
  return path.join(
    serverConfig.tmpUploadsDir,
    `${prefix}_${crypto.randomBytes(4).toString("hex")}_${base}`
  );
}

export async function saveUploadedFileBoundedWithHash(
  file: File,
  targetPath: string,
  maxBytes: number
): Promise<{ bytes: number; sha256: string }> {
  if (file.size > maxBytes) {
    throw new HttpStatusError(
      413,
      `File '${file.name || "upload"}' exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`
    );
  }
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const arrayBuf = await file.arrayBuffer();
  if (arrayBuf.byteLength > maxBytes) {
    throw new HttpStatusError(
      413,
      `File '${file.name || "upload"}' exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`
    );
  }
  const buf = Buffer.from(arrayBuf);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  await fsp.writeFile(targetPath, buf);
  return { bytes: buf.byteLength, sha256 };
}

export async function saveUploadedFileBounded(
  file: File,
  targetPath: string,
  maxBytes: number
): Promise<number> {
  const { bytes } = await saveUploadedFileBoundedWithHash(file, targetPath, maxBytes);
  return bytes;
}

export class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

export function proxyFilenameInDir(proxyDir: string, stem: string): string {
  if (fs.existsSync(path.join(proxyDir, `${stem}.m4a`))) {
    return `${stem}.m4a`;
  }
  return `${stem}.wav`;
}

export async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 3000 });
    await execFileAsync("ffprobe", ["-version"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function buildReferencePayload(
  sessionId: string,
  rec: SessionRecord,
  refPath: string,
  refFilename: string
): Promise<Record<string, unknown>> {
  const loaded = await loadAudioFile(refPath, serverConfig.maxSingleFileBytes);
  const loudness = computeLoudnessMetrics(loaded.channelsData, loaded.sampleRate);
  const peaks = await computePeakMetrics(loaded.channelsData, loaded.sampleRate, refPath);
  const dynamics = computeDynamicsMetrics(
    loaded.channelsData,
    peaks.samplePeakDbfs,
    peaks.truePeakDbtp,
    loudness.shortTermMaxLufs,
    loudness.integratedLufs,
    loaded.sampleRate
  );
  const genre: GenreType = rec.primaryReport?.context.genre ?? "electronic";
  const spectral = computeSpectralProfile(loaded.channelsData, loaded.sampleRate, genre);
  const stereo = computeStereoMetrics(loaded.channelsData, loaded.sampleRate);

  const proxyDir = path.join(rec.directory, "proxies");
  const actualProxyPath = await createPlaybackProxy(refPath, proxyDir, "reference");
  const actualProxy = path.basename(actualProxyPath);
  rec.proxyFiles.set(actualProxy, actualProxyPath);
  rec.referenceAudioPath = actualProxyPath;

  const refMetrics: GlobalMetrics = {
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

  return {
    reference_filename: refFilename,
    integrated_lufs: loudness.integratedLufs,
    true_peak_dbtp: peaks.truePeakDbtp,
    duration_sec: loaded.durationSec,
    playback_proxy_url: `/api/v1/sessions/${sessionId}/proxy/${actualProxy}`,
    waveform_peaks: loaded.waveformPeaks,
    global_metrics: refMetrics,
    spectral_bands: spectral.bands,
  };
}

export async function instantiateReportFromCachedDemo(params: {
  sessionId: string;
  originalFilename: string;
  proxyDir: string;
  proxyName: string;
  context: AnalysisContext;
  cached: DemoMixCacheEntry;
}): Promise<{ report: AnalysisReport; proxyPath: string }> {
  await fsp.mkdir(params.proxyDir, { recursive: true });
  const actualProxyName = `${params.proxyName}${params.cached.proxyExt}`;
  const proxyPath = path.join(params.proxyDir, actualProxyName);
  await fsp.writeFile(proxyPath, params.cached.proxyBytes);

  const updatedBands: SpectralBand[] = buildSpectralBandsFromEnergies(
    params.cached.snapshot.bandEnergiesDb,
    params.context.genre
  );
  const streamingEstimates = computeStreamingEstimates(params.cached.globalMetrics);
  const findings = evaluateMixFindings(
    params.context,
    params.cached.snapshot.durationSec,
    params.cached.snapshot.loudness,
    params.cached.snapshot.peaks,
    params.cached.snapshot.dynamics,
    {
      bands: updatedBands,
      bandPeakWindows: params.cached.snapshot.spectral.bandPeakWindows,
    },
    params.cached.snapshot.stereo
  );

  const report: AnalysisReport = {
    schema_version: "1.0.0",
    session_id: params.sessionId,
    report_id: `rep_${crypto.randomBytes(4).toString("hex")}`,
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    context: params.context,
    audio_metadata: {
      filename: params.originalFilename,
      duration_sec: params.cached.loaded.durationSec,
      sample_rate_hz: params.cached.loaded.sampleRate,
      channels: params.cached.loaded.channels,
      bit_depth: params.cached.loaded.bitDepth,
      playback_proxy_url: `/api/v1/sessions/${params.sessionId}/proxy/${actualProxyName}`,
      waveform_peaks: params.cached.loaded.waveformPeaks,
      clipping_timestamps_sec: [...params.cached.snapshot.peaks.clippingTimestampsSec],
      bpm: params.cached.snapshot.bpm ?? null,
      sections: params.cached.snapshot.sections ? [...params.cached.snapshot.sections] : [],
    },
    global_metrics: { ...params.cached.globalMetrics },
    streaming_estimates: streamingEstimates,
    spectral_bands: updatedBands,
    time_series: {
      step_sec: params.cached.timeSeries.step_sec,
      short_term_lufs: [...params.cached.timeSeries.short_term_lufs],
      phase_correlation: [...params.cached.timeSeries.phase_correlation],
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

  return { report, proxyPath };
}

export async function instantiateReportFromSha256Cache(params: {
  sessionId: string;
  originalFilename: string;
  proxyDir: string;
  proxyName: string;
  context: AnalysisContext;
  cached: Sha256CachedAnalysis;
}): Promise<{ report: AnalysisReport; proxyPath: string }> {
  await fsp.mkdir(params.proxyDir, { recursive: true });
  const actualProxyName = `${params.proxyName}${params.cached.proxyExt}`;
  const proxyPath = path.join(params.proxyDir, actualProxyName);
  await fsp.writeFile(proxyPath, params.cached.proxyBytes);

  const updatedBands: SpectralBand[] = buildSpectralBandsFromEnergies(
    params.cached.snapshot.bandEnergiesDb,
    params.context.genre
  );
  const streamingEstimates = computeStreamingEstimates(params.cached.globalMetrics);
  const findings = evaluateMixFindings(
    params.context,
    params.cached.snapshot.durationSec,
    params.cached.snapshot.loudness,
    params.cached.snapshot.peaks,
    params.cached.snapshot.dynamics,
    {
      bands: updatedBands,
      bandPeakWindows: params.cached.snapshot.spectral.bandPeakWindows,
    },
    params.cached.snapshot.stereo
  );

  const report: AnalysisReport = {
    schema_version: "1.0.0",
    session_id: params.sessionId,
    report_id: `rep_${crypto.randomBytes(4).toString("hex")}`,
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    context: params.context,
    audio_metadata: {
      filename: params.originalFilename,
      duration_sec: params.cached.durationSec,
      sample_rate_hz: params.cached.sampleRate,
      channels: params.cached.channels,
      bit_depth: params.cached.bitDepth,
      playback_proxy_url: `/api/v1/sessions/${params.sessionId}/proxy/${actualProxyName}`,
      waveform_peaks: params.cached.waveformPeaks.map((pair) => [...pair]),
      clipping_timestamps_sec: [...params.cached.snapshot.peaks.clippingTimestampsSec],
      bpm: params.cached.snapshot.bpm ?? null,
      sections: params.cached.snapshot.sections ? [...params.cached.snapshot.sections] : [],
    },
    global_metrics: { ...params.cached.globalMetrics },
    streaming_estimates: streamingEstimates,
    spectral_bands: updatedBands,
    time_series: {
      step_sec: params.cached.timeSeries.step_sec,
      short_term_lufs: [...params.cached.timeSeries.short_term_lufs],
      phase_correlation: [...params.cached.timeSeries.phase_correlation],
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

  return { report, proxyPath };
}

export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof HttpStatusError) {
    return NextResponse.json({ detail: err.message }, { status: err.status });
  }
  if (err instanceof UnsupportedAudioMediaError) {
    return NextResponse.json({ detail: err.message }, { status: 415 });
  }
  if (err instanceof AudioIngestionError) {
    return NextResponse.json({ detail: err.message }, { status: 422 });
  }
  console.error("[MixBench Route Error]", err);
  return NextResponse.json(
    { detail: "Internal server error. Please retry your request." },
    { status: 500 }
  );
}

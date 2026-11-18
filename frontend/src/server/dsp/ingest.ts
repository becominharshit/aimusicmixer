import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ALLOWED_EXTENSIONS = new Set([
  ".wav",
  ".flac",
  ".mp3",
  ".aiff",
  ".aif",
  ".ogg",
  ".m4a",
  ".aac",
]);

export class AudioIngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioIngestionError";
  }
}

export interface LoadedAudio {
  channelsData: Float64Array[];
  sampleRate: number;
  channels: number;
  bitDepth: number;
  durationSec: number;
  waveformPeaks: number[][];
}

interface ProbeResult {
  sampleRate: number;
  channels: number;
  durationSec: number;
  bitDepth: number;
  codecName: string;
}

export async function runFfprobe(filePath: string): Promise<ProbeResult> {
  let stdout = "";
  try {
    const res = await execFileAsync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }
    );
    stdout = res.stdout;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new AudioIngestionError("ffprobe binary is not available on PATH.");
    }
    throw new AudioIngestionError("Corrupt or unrecognized audio container/header.");
  }

  if (!stdout.trim()) {
    throw new AudioIngestionError("Corrupt or unrecognized audio container/header.");
  }

  let data: { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new AudioIngestionError("Could not parse audio stream metadata.");
  }

  const audioStreams = (data.streams ?? []).filter((s) => s.codec_type === "audio");
  if (audioStreams.length === 0) {
    throw new AudioIngestionError("No valid audio stream found in uploaded file.");
  }

  const stream = audioStreams[0];
  const fmt = data.format ?? {};
  const sampleRate = Number.parseInt(String(stream.sample_rate ?? 0), 10) || 0;
  const channels = Number.parseInt(String(stream.channels ?? 0), 10) || 0;
  const durationSec = Number.parseFloat(String(stream.duration ?? fmt.duration ?? 0)) || 0;
  const codecName = String(stream.codec_name ?? "");

  let bitDepth =
    Number.parseInt(String(stream.bits_per_raw_sample ?? stream.bits_per_sample ?? 0), 10) ||
    (codecName.includes("24") ? 24 : codecName.includes("32") || codecName.includes("f32") ? 32 : 16);
  if (bitDepth <= 0) bitDepth = 16;

  if (sampleRate <= 0 || channels <= 0) {
    throw new AudioIngestionError("Invalid sample rate or channel count in audio stream.");
  }
  if (durationSec < 0.05) {
    throw new AudioIngestionError("Audio clip is too short (< 50 ms) or contains an empty stream.");
  }

  return { sampleRate, channels, durationSec, bitDepth, codecName };
}

function computeWaveformPeaks(channelsData: Float64Array[], numBins = 240): number[][] {
  if (channelsData.length === 0 || channelsData[0].length === 0) return [];
  const totalSamples = channelsData[0].length;
  const actualBins = Math.min(numBins, totalSamples);
  const peaks: number[][] = [];
  const ch0 = channelsData[0];
  const ch1 = channelsData.length > 1 ? channelsData[1] : null;

  for (let b = 0; b < actualBins; b++) {
    const start = Math.floor((b * totalSamples) / actualBins);
    const end = Math.floor(((b + 1) * totalSamples) / actualBins);
    if (end <= start) {
      peaks.push([0, 0]);
      continue;
    }
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = start; i < end; i++) {
      const sample = ch1 ? 0.5 * (ch0[i] + ch1[i]) : ch0[i];
      if (sample < minVal) minVal = sample;
      if (sample > maxVal) maxVal = sample;
    }
    peaks.push([
      Math.round(minVal * 10000) / 10000,
      Math.round(maxVal * 10000) / 10000,
    ]);
  }
  return peaks;
}

export async function loadAudioFile(filePath: string, maxBytes?: number): Promise<LoadedAudio> {
  if (!fs.existsSync(filePath)) {
    throw new AudioIngestionError("Uploaded audio file could not be found on disk.");
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AudioIngestionError(
      `Unsupported audio extension '${ext}'. Allowed: WAV, FLAC, MP3, AIFF, OGG, M4A.`
    );
  }
  const stat = await fsp.stat(filePath);
  if (stat.size <= 0) {
    throw new AudioIngestionError("Uploaded audio file is empty (0 bytes).");
  }
  if (maxBytes !== undefined && stat.size > maxBytes) {
    throw new AudioIngestionError(
      `File exceeds size limit (${(stat.size / (1024 * 1024)).toFixed(1)} MB).`
    );
  }

  const probe = await runFfprobe(filePath);
  const outChannels = Math.min(2, probe.channels);
  const tmpRaw = path.join(os.tmpdir(), `mixbench_pcm_${crypto.randomUUID()}.f32`);

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        filePath,
        "-vn",
        "-ac",
        String(outChannels),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        tmpRaw,
      ],
      { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }
    );

    const rawBuf = await fsp.readFile(tmpRaw);
    const totalFloats = Math.floor(rawBuf.byteLength / 4);
    const numSamples = Math.floor(totalFloats / outChannels);
    if (numSamples === 0) {
      throw new AudioIngestionError("Decoded audio contains zero samples.");
    }

    const floatView = new Float32Array(
      rawBuf.buffer,
      rawBuf.byteOffset,
      numSamples * outChannels
    );
    const channelsData: Float64Array[] = Array.from(
      { length: outChannels },
      () => new Float64Array(numSamples)
    );

    if (outChannels === 1) {
      const dst = channelsData[0];
      for (let i = 0; i < numSamples; i++) {
        dst[i] = floatView[i];
      }
    } else {
      const dstL = channelsData[0];
      const dstR = channelsData[1];
      for (let i = 0; i < numSamples; i++) {
        const base = i * 2;
        dstL[i] = floatView[base];
        dstR[i] = floatView[base + 1];
      }
    }

    const actualDuration = numSamples / probe.sampleRate;
    if (actualDuration < 0.05) {
      throw new AudioIngestionError("Decoded audio is shorter than 50 ms.");
    }

    return {
      channelsData,
      sampleRate: probe.sampleRate,
      channels: outChannels,
      bitDepth: probe.bitDepth,
      durationSec: Math.round(actualDuration * 1000) / 1000,
      waveformPeaks: computeWaveformPeaks(channelsData),
    };
  } catch (err) {
    if (err instanceof AudioIngestionError) throw err;
    throw new AudioIngestionError("Failed to decode audio stream.");
  } finally {
    await fsp.rm(tmpRaw, { force: true }).catch(() => undefined);
  }
}

export async function createPlaybackProxy(
  sourcePath: string,
  targetDir: string,
  stemName = "proxy"
): Promise<string> {
  await fsp.mkdir(targetDir, { recursive: true });
  const m4aPath = path.join(targetDir, `${stemName}.m4a`);

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        sourcePath,
        "-vn",
        "-ar",
        "44100",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        m4aPath,
      ],
      { timeout: 60000 }
    );
    const stat = await fsp.stat(m4aPath).catch(() => null);
    if (stat && stat.size > 0) {
      return m4aPath;
    }
  } catch {
    // Fallback to WAV proxy
  }

  const wavPath = path.join(targetDir, `${stemName}.wav`);
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      sourcePath,
      "-vn",
      "-ar",
      "44100",
      "-acodec",
      "pcm_s16le",
      wavPath,
    ],
    { timeout: 60000 }
  );
  return wavPath;
}

export async function extractAudioClip(
  sourcePath: string,
  targetPath: string,
  startSec = 0.0,
  durationSec = 25.0
): Promise<string> {
  const safeStart = Math.max(0.0, startSec).toFixed(2);
  const safeDur = Math.max(3.0, Math.min(30.0, durationSec)).toFixed(2);

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-ss",
        safeStart,
        "-t",
        safeDur,
        "-i",
        sourcePath,
        "-vn",
        "-ar",
        "44100",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        targetPath,
      ],
      { timeout: 30000 }
    );
    if (fs.existsSync(targetPath)) {
      return targetPath;
    }
  } catch {
    // Fallback to AAC m4a if libmp3lame is unavailable
  }

  const aacTarget = targetPath.replace(/\.[^.]+$/, ".m4a");
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-ss",
      safeStart,
      "-t",
      safeDur,
      "-i",
      sourcePath,
      "-vn",
      "-ar",
      "44100",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      aacTarget,
    ],
    { timeout: 30000 }
  );
  return aacTarget;
}

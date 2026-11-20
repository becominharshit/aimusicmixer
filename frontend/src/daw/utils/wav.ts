import type { WavBitDepth } from '../types';
import { mulberry32 } from './dsp';

export interface WavEncodeOptions {
  bitDepth: WavBitDepth;
  /** TPDF dither before quantising to 16-bit (ignored for 24-bit). Default true for 16-bit. */
  dither?: boolean;
}

export interface WavEncodeResult {
  bytes: Uint8Array<ArrayBuffer>;
  /** Highest absolute sample value (linear) before clipping. */
  peak: number;
  /** Count of samples whose magnitude exceeded 1.0 and were hard-clipped. */
  clippedSamples: number;
}

export interface WavHeaderInfo {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataBytes: number;
  dataOffset: number;
  frames: number;
  riffSize: number;
}

const WAV_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Encodes planar float channels into a canonical RIFF/WAVE file (PCM, little-endian).
 * 16-bit and 24-bit integer PCM are supported. Samples are clamped to [-1, 1].
 */
export function encodeWav(
  channels: ArrayLike<number>[],
  sampleRate: number,
  options: WavEncodeOptions,
): WavEncodeResult {
  const numChannels = channels.length;
  if (numChannels < 1) throw new Error('encodeWav: at least one channel is required');
  const frames = channels[0]!.length;
  for (const ch of channels) {
    if (ch.length !== frames) throw new Error('encodeWav: all channels must have the same length');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('encodeWav: invalid sample rate');

  const bitDepth = options.bitDepth;
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error(`encodeWav: unsupported bit depth ${String(bitDepth)}`);
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  if (WAV_HEADER_BYTES - 8 + dataBytes > 0xffffffff) throw new Error('encodeWav: file exceeds 4 GiB WAV limit');

  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const dither = bitDepth === 16 && (options.dither ?? true);
  const rand = mulberry32(0x5eed);
  const scale = bitDepth === 16 ? 32767 : 8388607;
  let peak = 0;
  let clipped = 0;
  let offset = WAV_HEADER_BYTES;

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = channels[c]![i] as number;
      if (!Number.isFinite(s)) s = 0;
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
      if (a > 1) {
        clipped++;
        s = s < 0 ? -1 : 1;
      }
      let q: number;
      if (dither) {
        // TPDF dither, +/-1 LSB, then round-to-nearest
        q = Math.round(s * scale + (rand() - rand()));
      } else {
        q = Math.round(s * scale);
      }
      if (q > scale) q = scale;
      else if (q < -scale - 1) q = -scale - 1;

      if (bitDepth === 16) {
        view.setInt16(offset, q, true);
        offset += 2;
      } else {
        const u = q < 0 ? q + 0x1000000 : q;
        view.setUint8(offset, u & 0xff);
        view.setUint8(offset + 1, (u >> 8) & 0xff);
        view.setUint8(offset + 2, (u >> 16) & 0xff);
        offset += 3;
      }
    }
  }

  return { bytes: new Uint8Array(buffer), peak, clippedSamples: clipped };
}

/** Parses and validates a canonical PCM WAV header. Throws on any structural problem. */
export function parseWavHeader(data: ArrayBuffer | Uint8Array): WavHeaderInfo {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < WAV_HEADER_BYTES) throw new Error('WAV: file shorter than 44-byte header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== 'RIFF') throw new Error('WAV: missing RIFF tag');
  if (tag(8) !== 'WAVE') throw new Error('WAV: missing WAVE tag');
  if (tag(12) !== 'fmt ') throw new Error('WAV: missing fmt chunk');
  const riffSize = view.getUint32(4, true);
  const audioFormat = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const byteRate = view.getUint32(28, true);
  const blockAlign = view.getUint16(32, true);
  const bitsPerSample = view.getUint16(34, true);
  if (tag(36) !== 'data') throw new Error('WAV: missing data chunk');
  const dataBytes = view.getUint32(40, true);

  if (riffSize !== bytes.byteLength - 8) throw new Error(`WAV: RIFF size ${riffSize} does not match file length`);
  if (dataBytes !== bytes.byteLength - WAV_HEADER_BYTES) throw new Error('WAV: data chunk size does not match file length');
  if (blockAlign !== (channels * bitsPerSample) / 8) throw new Error('WAV: bad block align');
  if (byteRate !== sampleRate * blockAlign) throw new Error('WAV: bad byte rate');
  if (dataBytes % blockAlign !== 0) throw new Error('WAV: data is not a whole number of frames');

  return {
    audioFormat,
    channels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    dataBytes,
    dataOffset: WAV_HEADER_BYTES,
    frames: dataBytes / blockAlign,
    riffSize,
  };
}

/** Decodes a PCM16/24 WAV produced by `encodeWav` back to planar floats (used by tests and analysis tooling). */
export function decodeWavPcm(data: ArrayBuffer | Uint8Array): { sampleRate: number; channels: Float32Array[] } {
  const info = parseWavHeader(data);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chans = Array.from({ length: info.channels }, () => new Float32Array(info.frames));
  let o = info.dataOffset;
  for (let i = 0; i < info.frames; i++) {
    for (let c = 0; c < info.channels; c++) {
      if (info.bitsPerSample === 16) {
        chans[c]![i] = view.getInt16(o, true) / 32768;
        o += 2;
      } else if (info.bitsPerSample === 24) {
        let v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
        if (v & 0x800000) v -= 0x1000000;
        chans[c]![i] = v / 8388608;
        o += 3;
      } else {
        throw new Error(`WAV: unsupported bit depth ${info.bitsPerSample}`);
      }
    }
  }
  return { sampleRate: info.sampleRate, channels: chans };
}

/** Browser helper: trigger a file download for a Blob (no DOM styling involved). */
export function triggerDownload(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

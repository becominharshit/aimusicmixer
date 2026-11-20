/**
 * Strict TypeScript contracts for the MixLearn headless Web DAW core.
 *
 * Everything in `ProjectState` is plain JSON (no -Infinity, no NaN, no class
 * instances) so it can be stored directly in a Supabase `jsonb` column.
 */

// ---------------------------------------------------------------------------
// Plugin metadata (drives auto-rendered knobs / sliders in the UI)
// ---------------------------------------------------------------------------

export type PluginCategory = 'Compressors' | 'Equalizers' | 'Tape Machines' | 'Spatial' | 'Utilities';

export type PluginId =
  | 'optical-comp'
  | 'tube-optical-comp'
  | 'vca-bus-comp'
  | 'fet-comp'
  | 'stereo-vari-mu-comp'
  | 'preamp-eq'
  | 'proportional-q-eq'
  | 'ten-band-graphic-eq'
  | 'passive-program-eq'
  | 'midrange-sculptor-eq'
  | 'multitrack-tape-deck'
  | 'mastering-tape-recorder'
  | 'gain-staging-utility'
  | 'studio-reverb'
  | 'stereo-delay'
  | 'master-limiter';

export type ParamUnit = 'dB' | 'Hz' | 'ms' | 's' | '%' | 'ratio' | 'oct' | 'Q' | 'x' | 'none' | 'enum' | 'bool';

/**
 * - `linear`  : value maps linearly to knob travel
 * - `log`     : value maps logarithmically (frequencies, times). `min` must be > 0
 * - `stepped` : integer / snapped values; if `options` is present the value is an index into it
 * - `toggle`  : 0 or 1
 */
export type ParamCurve = 'linear' | 'log' | 'stepped' | 'toggle';

export interface ParamOption {
  value: number;
  label: string;
}

export interface ParamDescriptor {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  unit: ParamUnit;
  curve: ParamCurve;
  /** Snap increment for linear/stepped params without `options`. */
  step?: number;
  /** Labelled choices for `stepped` params (value is the option's `value`). */
  options?: ParamOption[];
  /** Optional UI grouping hint (e.g. "Low", "Mid", "High", "Sidechain"). */
  group?: string;
  /** Suggested number of decimals when displaying the value. */
  decimals?: number;
}

export interface PluginPreset {
  id: string;
  name: string;
  /** Partial overlay on top of parameter defaults. */
  values: Record<string, number>;
}

export interface PluginDescriptor {
  id: PluginId;
  name: string;
  category: PluginCategory;
  description: string;
  params: ParamDescriptor[];
  presets: PluginPreset[];
  /** True when `getGainReductionDb()` returns something meaningful. */
  hasGainReduction: boolean;
  /** Processing latency in milliseconds (0 for everything except the lookahead limiter). */
  latencyMs: number;
}

export type AbSlot = 'A' | 'B';

/** Serializable state of one plugin instance. */
export interface PluginState {
  instanceId: string;
  pluginId: PluginId;
  bypass: boolean;
  /** Phase-inverted dry/wet monitor: you hear ONLY what the plugin changes. */
  deltaListen: boolean;
  /** -24..+24 dB. */
  inputTrimDb: number;
  /** -24..+24 dB. */
  outputTrimDb: number;
  abSlot: AbSlot;
  paramsA: Record<string, number>;
  paramsB: Record<string, number>;
  /** Id of the last preset loaded into the active slot (cleared by any manual edit). */
  presetId: string | null;
}

/** Public surface shared by EVERY plugin module. */
export interface DawAudioPlugin {
  readonly instanceId: string;
  readonly descriptor: PluginDescriptor;
  readonly input: AudioNode;
  readonly output: AudioNode;

  readonly bypass: boolean;
  setBypass(bypass: boolean): void;

  readonly abSlot: AbSlot;
  toggleAB(): AbSlot;
  setAbSlot(slot: AbSlot): void;
  copyAToB(): void;
  copyBToA(): void;

  readonly deltaListen: boolean;
  setDeltaListen(enabled: boolean): void;

  readonly inputTrimDb: number;
  readonly outputTrimDb: number;
  setInputTrimDb(db: number): number;
  setOutputTrimDb(db: number): number;

  getParam(id: string): number;
  getParams(): Record<string, number>;
  /** Clamps to the descriptor range and returns the value actually applied. */
  setParam(id: string, value: number): number;
  loadPreset(presetId: string): boolean;

  /** Positive dB of gain reduction (0 = none). Zero-allocation. */
  getGainReductionDb(): number;
  /** RMS output level in dBFS. Zero-allocation after the first call. */
  getVuLevelDb(): number;

  getState(): PluginState;
  setState(state: Partial<PluginState>): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Project state
// ---------------------------------------------------------------------------

/** Reference to the audio behind a track. The bytes live in IndexedDB, keyed by (projectId, trackId). */
export interface TrackAudioRef {
  fileName: string;
  mimeType: string;
  byteLength: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
}

/** Clip placement on the timeline plus non-destructive trim (all values in seconds). */
export interface TrackClip {
  /** Timeline position where the (trimmed) clip starts. */
  startSec: number;
  /** Seconds removed from the start of the source audio. */
  trimStartSec: number;
  /** Seconds removed from the end of the source audio. */
  trimEndSec: number;
}

export interface TrackState {
  id: string;
  name: string;
  audio: TrackAudioRef | null;
  /** -24..+24 dB, applied before the insert chain. */
  inputGainDb: number;
  /** Ø polarity invert. */
  phaseInvert: boolean;
  /** Ordered insert FX chain (index 0 processes first). */
  inserts: PluginState[];
  /** -100 (= -inf) .. +6 dB. */
  faderDb: number;
  /** -1 (L) .. +1 (R). */
  pan: number;
  mute: boolean;
  solo: boolean;
  /** Send A (Reverb return) amount, 0..1 linear. */
  sendA: number;
  /** Send B (Delay return) amount, 0..1 linear. */
  sendB: number;
  clip: TrackClip;
  /** Waveform overview: max absolute amplitude per bucket (0..1), `PEAKS_RESOLUTION` buckets. */
  peaks: number[];
}

export type ReturnId = 'returnA' | 'returnB';

export interface ReturnState {
  id: ReturnId;
  name: string;
  kind: 'reverb' | 'delay';
  /** Return device rack. Index 0 is the Studio Reverb (A) / Stereo Delay (B) created by default. */
  inserts: PluginState[];
  faderDb: number;
  mute: boolean;
}

export interface MasterState {
  faderDb: number;
  /** Ordered master FX chain (runs before the safety limiter). */
  inserts: PluginState[];
  /** Always-last True-Peak safety limiter. `bypass === true` disables it. */
  limiter: PluginState;
}

export interface TransportSettings {
  loopEnabled: boolean;
  loopStartSec: number;
  loopEndSec: number;
}

export interface ProjectState {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sampleRate: number;
  tracks: TrackState[];
  returnA: ReturnState;
  returnB: ReturnState;
  master: MasterState;
  transport: TransportSettings;
}

// ---------------------------------------------------------------------------
// Meter telemetry
// ---------------------------------------------------------------------------

/** All level values are dBFS (floor -120). `gainReductionDb` is positive dB of reduction. */
export interface ChannelMeter {
  peakL: number;
  peakR: number;
  peakHoldL: number;
  peakHoldR: number;
  rmsL: number;
  rmsR: number;
  gainReductionDb: number;
}

/**
 * Re-used, mutated-in-place telemetry object returned by `getMeterFrame()`.
 * Never store it across frames; read the values you need inside your rAF callback.
 */
export interface MeterFrame {
  /** `performance.now()` at the time the frame was filled. */
  timestamp: number;
  positionSec: number;
  trackCount: number;
  /** Track ids in the same order as `tracks` (only reallocated when the track list changes). */
  trackIds: string[];
  tracks: ChannelMeter[];
  returnA: ChannelMeter;
  returnB: ChannelMeter;
  master: ChannelMeter;
  /** Gain reduction of the always-on safety limiter alone (`master.gainReductionDb` also includes the master FX chain). */
  safetyLimiterGainReductionDb: number;
}

/** Live plugin telemetry filled in place by `getPluginMeters`. */
export interface PluginMeterReadout {
  gainReductionDb: number;
  vuDb: number;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type WavBitDepth = 16 | 24;

export interface ExportOptions {
  bitDepth?: WavBitDepth;
  /** Render range start (default 0). */
  startSec?: number;
  /** Render range end (default: end of the last clip). */
  endSec?: number;
  /** Extra seconds appended for reverb/delay tails. Default: automatic. */
  tailSec?: number;
  /** Output sample rate (default: the live context's rate). */
  sampleRate?: number;
  /** TPDF dither when quantising to 16-bit (default true). */
  dither?: boolean;
  fileName?: string;
  /** Called with 0..1 while rendering (only for longer renders). */
  onProgress?: (progress: number) => void;
}

export interface MixdownResult {
  blob: Blob;
  /** Same bytes as `blob`, wrapped as a File ready for `onSendToAnalyzer(file)`. */
  file: File;
  fileName: string;
  durationSec: number;
  sampleRate: number;
  bitDepth: WavBitDepth;
  channels: number;
  byteLength: number;
  /** Highest sample peak of the rendered mix in dBFS. */
  peakDb: number;
  /** Number of samples that exceeded full scale before quantisation (hard-clipped). */
  clippedSamples: number;
}

// ---------------------------------------------------------------------------
// Controller-facing types
// ---------------------------------------------------------------------------

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** Present when the storage backend can provide it cheaply (the Supabase list query does not). */
  trackCount?: number;
}

export type ExportStatus = 'idle' | 'rendering' | 'done' | 'error';

/** Identifies which device rack an operation targets: a track id, `'master'`, `'returnA'` or `'returnB'`. */
export type ChainId = string;

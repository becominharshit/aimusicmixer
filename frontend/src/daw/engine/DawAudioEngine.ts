import type {
  AbSlot,
  ChainId,
  ChannelMeter,
  ExportOptions,
  MeterFrame,
  MixdownResult,
  PluginId,
  PluginMeterReadout,
  PluginState,
  ProjectState,
  ReturnId,
  TrackClip,
  TrackState,
  TransportSettings,
  WavBitDepth,
} from '../types';
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  ACCEPTED_AUDIO_MIME,
  CHAIN_MASTER,
  FADER_MAX_DB,
  FADER_MIN_DB,
  FADE_OUT_S,
  INPUT_GAIN_MAX_DB,
  INPUT_GAIN_MIN_DB,
  METER_FLOOR_DB,
  PEAKS_RESOLUTION,
  SCHEDULER_INTERVAL_MS,
  SCHEDULE_AHEAD_S,
  SEEK_LEAD_S,
  START_LEAD_S,
} from '../constants';
import type { BaseDawPlugin } from '../fx/BaseDawPlugin';
import { createPlugin } from '../fx/registry';
import { clamp, computePeaks, getExtension, gainToDb, stripExtension } from '../utils/dsp';
import { nowIso } from '../utils/ids';
import { encodeWav } from '../utils/wav';
import { type AudioEnv, createAudioEnv, ensureWorklets } from './audioEnv';
import { MixerGraph, type TrackStrip } from './MixerGraph';
import {
  computeProjectDuration,
  createPluginState,
  createProjectState,
  createTrackState,
  getChain,
  trackClipDurationSec,
  validateProjectState,
  withChain,
  withTrack,
} from './projectState';
import { type ScheduledSource, scheduleSegments } from './scheduler';
import { limiterLatencySec } from './workletSource';

export class DawImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DawImportError';
  }
}

export class DawExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DawExportError';
  }
}

export interface EngineOptions {
  /** Provide your own context (it must be created from a user gesture or resumed later by `play()`). */
  audioContext?: AudioContext;
  /** Custom context factory (defaults to `new AudioContext({ latencyHint: 'interactive' })`). */
  contextFactory?: () => AudioContext;
  /** Custom offline context factory, mostly for tests. */
  offlineContextFactory?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
  initialState?: ProjectState;
}

export interface TransportSnapshot {
  playing: boolean;
  loopEnabled: boolean;
  loopStartSec: number;
  loopEndSec: number;
  durationSec: number;
}

export interface TrackAudioEvent {
  trackId: string;
  blob: Blob;
  reason: 'import' | 'relink';
}

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private listeners = new Set<Listener<T>>();
  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(value: T): void {
    for (const l of Array.from(this.listeners)) l(value);
  }
  get size(): number {
    return this.listeners.size;
  }
}

function newChannelMeter(): ChannelMeter {
  return {
    peakL: METER_FLOOR_DB,
    peakR: METER_FLOOR_DB,
    peakHoldL: METER_FLOOR_DB,
    peakHoldR: METER_FLOOR_DB,
    rmsL: METER_FLOOR_DB,
    rmsR: METER_FLOOR_DB,
    gainReductionDb: 0,
  };
}

const MIN_LOOP_SEC = 0.05;

/**
 * Real-time multi-track Web Audio engine. 100 % headless: owns the AudioContext, the routing graph, transport,
 * metering and offline bounce. `ProjectState` is the single source of truth; every mutation produces a new
 * immutable state object and notifies subscribers.
 */
export class DawAudioEngine {
  private readonly options: EngineOptions;
  private ctx: AudioContext | null = null;
  private env: AudioEnv | null = null;
  private graph: MixerGraph | null = null;
  private initPromise: Promise<void> | null = null;

  private state: ProjectState;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly blobs = new Map<string, Blob>();

  private readonly stateEmitter = new Emitter<ProjectState>();
  private readonly transportEmitter = new Emitter<TransportSnapshot>();
  private readonly audioEmitter = new Emitter<TrackAudioEvent>();
  private readonly endedEmitter = new Emitter<void>();

  // ---- transport
  private playing = false;
  private pausedPos = 0;
  private anchorCtx = 0;
  private anchorPos = 0;
  private pendingAnchors: Array<{ ctxTime: number; pos: number }> = [];
  private wrapAt: number | null = null;
  private sources: ScheduledSource[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  // ---- metering (pre-allocated)
  private meterBuf = new Float32Array(2048);
  private frame: MeterFrame;
  private frameStrips: TrackStrip[] = [];
  private structureVersion = 0;
  private frameVersion = -1;

  constructor(options: EngineOptions = {}) {
    this.options = options;
    this.state = options.initialState ? validateProjectState(options.initialState) : createProjectState();
    this.frame = {
      timestamp: 0,
      positionSec: 0,
      trackCount: 0,
      trackIds: [],
      tracks: [],
      returnA: newChannelMeter(),
      returnB: newChannelMeter(),
      master: newChannelMeter(),
      safetyLimiterGainReductionDb: 0,
    };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  get isReady(): boolean {
    return this.graph !== null;
  }

  /** Creates the AudioContext, registers the DSP worklets and builds the graph. Idempotent. */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const ctx = this.options.audioContext ?? this.options.contextFactory?.() ?? new AudioContext({ latencyHint: 'interactive' });
      await ensureWorklets(ctx);
      this.ctx = ctx;
      this.env = createAudioEnv(ctx, false);
      this.graph = new MixerGraph(this.env, this.state, ctx.destination);
      this.structureVersion++;
      this.emitTransport();
    })().catch((e) => {
      this.initPromise = null;
      throw e;
    });
    return this.initPromise;
  }

  getContext(): AudioContext | null {
    return this.ctx;
  }

  dispose(): void {
    this.stopTimer();
    this.stopSources(0.005);
    this.playing = false;
    this.graph?.dispose();
    this.graph = null;
    if (this.ctx && !this.options.audioContext) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.env = null;
    this.initPromise = null;
  }

  // =========================================================================
  // State access
  // =========================================================================

  getState(): ProjectState {
    return this.state;
  }

  /** Subscribe to every project-state change. Returns an unsubscribe function. */
  subscribe(listener: Listener<ProjectState>): () => void {
    return this.stateEmitter.on(listener);
  }

  subscribeTransport(listener: Listener<TransportSnapshot>): () => void {
    return this.transportEmitter.on(listener);
  }

  /** Fires after a track's audio file has been decoded (use it to store the Blob in IndexedDB). */
  onTrackAudio(listener: Listener<TrackAudioEvent>): () => void {
    return this.audioEmitter.on(listener);
  }

  onEnded(listener: Listener<void>): () => void {
    return this.endedEmitter.on(listener);
  }

  getTransport(): TransportSnapshot {
    const t = this.state.transport;
    return {
      playing: this.playing,
      loopEnabled: t.loopEnabled,
      loopStartSec: t.loopStartSec,
      loopEndSec: t.loopEndSec,
      durationSec: this.getDurationSec(),
    };
  }

  /** Replaces the whole project (New / Open). Audio buffers are cleared; re-attach them with `attachTrackBlob`. */
  loadProject(next: ProjectState): void {
    const state = validateProjectState(next);
    this.stopTimer();
    this.stopSources(0.005);
    this.playing = false;
    this.pausedPos = 0;
    this.buffers.clear();
    this.blobs.clear();
    this.state = state;
    if (this.ctx && this.env) {
      this.graph?.dispose();
      this.graph = new MixerGraph(this.env, this.state, this.ctx.destination);
    }
    this.structureVersion++;
    this.stateEmitter.emit(this.state);
    this.emitTransport();
  }

  private commit(next: ProjectState, structural = false): void {
    this.state = { ...next, updatedAt: nowIso() };
    if (structural) this.structureVersion++;
    this.stateEmitter.emit(this.state);
  }

  private emitTransport(): void {
    if (this.transportEmitter.size > 0) this.transportEmitter.emit(this.getTransport());
  }

  private requireGraph(): MixerGraph {
    if (!this.graph) throw new Error('DawAudioEngine is not initialised: await engine.init() first');
    return this.graph;
  }

  setProjectName(name: string): void {
    this.commit({ ...this.state, name: name.trim() || 'Untitled Project' });
  }

  // =========================================================================
  // Transport
  // =========================================================================

  isPlaying(): boolean {
    return this.playing;
  }

  getDurationSec(): number {
    return computeProjectDuration(this.state);
  }

  /** Current playhead in seconds. Cheap enough to call every animation frame. */
  getPositionSec(): number {
    if (!this.playing || !this.ctx) return this.pausedPos;
    const t = this.ctx.currentTime;
    this.resolveAnchors(t);
    const pos = this.anchorPos + (t - this.anchorCtx);
    return pos < this.anchorPos ? this.anchorPos : pos;
  }

  async play(): Promise<void> {
    // Resume synchronously inside the user gesture before awaiting anything else.
    const early = this.ctx?.resume();
    await this.init();
    const ctx = this.ctx!;
    await (early ?? ctx.resume());
    if (this.playing) return;
    let pos = this.pausedPos;
    const loop = this.activeLoop();
    if (!(loop && pos < loop.end) && pos >= this.getDurationSec() - 0.001) pos = 0;
    this.startFrom(pos, START_LEAD_S);
    this.playing = true;
    this.startTimer();
    this.emitTransport();
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedPos = this.getPositionSec();
    this.halt();
  }

  stop(): void {
    this.pausedPos = 0;
    if (this.playing) this.halt();
    else this.emitTransport();
  }

  seek(sec: number): void {
    const pos = clamp(Number.isFinite(sec) ? sec : 0, 0, Math.max(this.getDurationSec(), 0));
    if (this.playing) {
      this.stopSources(FADE_OUT_S);
      this.startFrom(pos, SEEK_LEAD_S);
    } else {
      this.pausedPos = pos;
    }
  }

  setLoop(startSec: number, endSec: number, enabled: boolean): void {
    const start = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
    let end = Math.max(start, Number.isFinite(endSec) ? endSec : 0);
    let on = enabled;
    if (end - start < MIN_LOOP_SEC) {
      on = false;
      end = Math.max(end, start);
    }
    const transport: TransportSettings = { loopEnabled: on, loopStartSec: start, loopEndSec: end };
    this.commit({ ...this.state, transport });
    if (this.playing) this.restartAtCurrent();
    this.emitTransport();
  }

  private activeLoop(): { start: number; end: number } | null {
    const t = this.state.transport;
    return t.loopEnabled && t.loopEndSec - t.loopStartSec >= MIN_LOOP_SEC ? { start: t.loopStartSec, end: t.loopEndSec } : null;
  }

  private startFrom(pos: number, lead: number): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph) return;
    const when = ctx.currentTime + lead;
    const loop = this.activeLoop();
    const wrapEnd: number | null = loop !== null && pos < loop.end ? loop.end : null;
    const to: number = wrapEnd ?? Infinity;
    this.sources.push(
      ...scheduleSegments(ctx, graph, this.state.tracks, this.buffers, pos, to, when, 0.006, (s) => this.dropSource(s)),
    );
    this.anchorCtx = when;
    this.anchorPos = pos;
    this.pendingAnchors = [];
    this.wrapAt = wrapEnd !== null ? when + (wrapEnd - pos) : null;
  }

  private restartAtCurrent(): void {
    const pos = this.getPositionSec();
    this.stopSources(FADE_OUT_S);
    this.startFrom(pos, SEEK_LEAD_S);
  }

  private resolveAnchors(t: number): void {
    while (this.pendingAnchors.length > 0 && t >= this.pendingAnchors[0]!.ctxTime) {
      const a = this.pendingAnchors.shift()!;
      this.anchorCtx = a.ctxTime;
      this.anchorPos = a.pos;
    }
  }

  private halt(): void {
    this.stopTimer();
    this.stopSources(FADE_OUT_S);
    this.playing = false;
    this.pendingAnchors = [];
    this.wrapAt = null;
    this.emitTransport();
  }

  private dropSource(s: ScheduledSource): void {
    const i = this.sources.indexOf(s);
    if (i >= 0) this.sources.splice(i, 1);
  }

  private stopSources(fadeSec: number, onlyTrackId?: string): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.sources = [];
      return;
    }
    const now = ctx.currentTime;
    const keep: ScheduledSource[] = [];
    for (const s of this.sources) {
      if (onlyTrackId && s.trackId !== onlyTrackId) {
        keep.push(s);
        continue;
      }
      try {
        const g = s.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + fadeSec);
        s.src.stop(now + fadeSec + 0.005);
      } catch {
        /* already stopped */
      }
    }
    this.sources = keep;
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Look-ahead scheduler: queues loop iterations ahead of time and detects the end of the song. */
  private tick(): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!this.playing || !ctx || !graph) return;
    const t = ctx.currentTime;
    this.resolveAnchors(t);
    const loop = this.activeLoop();
    if (loop && this.wrapAt !== null) {
      let wrapAt: number = this.wrapAt;
      let guard = 0;
      while (wrapAt - t < SCHEDULE_AHEAD_S && guard++ < 64) {
        const when: number = wrapAt;
        this.sources.push(
          ...scheduleSegments(ctx, graph, this.state.tracks, this.buffers, loop.start, loop.end, when, 0, (s) => this.dropSource(s)),
        );
        this.pendingAnchors.push({ ctxTime: when, pos: loop.start });
        wrapAt = when + (loop.end - loop.start);
      }
      this.wrapAt = wrapAt;
    } else if (!loop) {
      if (this.getPositionSec() >= this.getDurationSec() + 0.05) {
        this.pausedPos = 0;
        this.halt();
        this.endedEmitter.emit();
      }
    }
  }

  // =========================================================================
  // Tracks
  // =========================================================================

  /** Adds an empty track. Use `importFile` to create a track from an audio file. */
  addTrack(init: { name?: string } = {}): string {
    const track = createTrackState({ name: init.name ?? `Track ${this.state.tracks.length + 1}` });
    this.addTrackState(track);
    return track.id;
  }

  private addTrackState(track: TrackState): void {
    this.graph?.addTrack(track);
    this.graph?.syncTrack(track, this.state.tracks.some((t) => t.solo), true);
    this.commit({ ...this.state, tracks: [...this.state.tracks, track] }, true);
    this.emitTransport();
  }

  removeTrack(trackId: string): void {
    if (!this.state.tracks.some((t) => t.id === trackId)) return;
    this.stopSources(0.005, trackId);
    this.graph?.removeTrack(trackId);
    this.buffers.delete(trackId);
    this.blobs.delete(trackId);
    this.commit({ ...this.state, tracks: this.state.tracks.filter((t) => t.id !== trackId) }, true);
    this.syncMixer();
    this.emitTransport();
  }

  /** Moves a track to a new index in the mixer order. */
  moveTrack(trackId: string, toIndex: number): void {
    const from = this.state.tracks.findIndex((t) => t.id === trackId);
    if (from < 0) return;
    const tracks = this.state.tracks.slice();
    const [t] = tracks.splice(from, 1);
    tracks.splice(clamp(toIndex, 0, tracks.length), 0, t!);
    this.commit({ ...this.state, tracks }, true);
  }

  /** Reorders tracks to match `orderedIds` (ids not mentioned keep their relative order at the end). */
  reorderTracks(orderedIds: string[]): void {
    const byId = new Map(this.state.tracks.map((t) => [t.id, t] as const));
    const ordered: TrackState[] = [];
    for (const id of orderedIds) {
      const t = byId.get(id);
      if (t) {
        ordered.push(t);
        byId.delete(id);
      }
    }
    for (const t of this.state.tracks) if (byId.has(t.id)) ordered.push(t);
    this.commit({ ...this.state, tracks: ordered }, true);
  }

  private updateTrack(trackId: string, patch: Partial<TrackState>, mixer: 'track' | 'all' | 'none' = 'track'): void {
    if (!this.state.tracks.some((t) => t.id === trackId)) return;
    this.commit(withTrack(this.state, trackId, patch));
    if (mixer === 'all') this.syncMixer();
    else if (mixer === 'track') {
      const track = this.state.tracks.find((t) => t.id === trackId)!;
      this.graph?.syncTrack(track, this.state.tracks.some((t) => t.solo));
    }
  }

  private syncMixer(): void {
    this.graph?.syncMixer(this.state);
  }

  setTrackName(trackId: string, name: string): void {
    this.updateTrack(trackId, { name: name.trim() || 'Audio' }, 'none');
  }
  setTrackInputGain(trackId: string, db: number): void {
    this.updateTrack(trackId, { inputGainDb: clamp(db, INPUT_GAIN_MIN_DB, INPUT_GAIN_MAX_DB) });
  }
  setTrackPhaseInvert(trackId: string, invert: boolean): void {
    this.updateTrack(trackId, { phaseInvert: invert });
  }
  setTrackFader(trackId: string, db: number): void {
    this.updateTrack(trackId, { faderDb: clamp(db, FADER_MIN_DB, FADER_MAX_DB) });
  }
  setTrackPan(trackId: string, pan: number): void {
    this.updateTrack(trackId, { pan: clamp(pan, -1, 1) });
  }
  setTrackMute(trackId: string, mute: boolean): void {
    this.updateTrack(trackId, { mute });
  }
  /** Soloing silences every non-soloed track (returns and master are unaffected). */
  setTrackSolo(trackId: string, solo: boolean): void {
    this.updateTrack(trackId, { solo }, 'all');
  }
  setTrackSend(trackId: string, send: 'A' | 'B', amount: number): void {
    const v = clamp(amount, 0, 1);
    this.updateTrack(trackId, send === 'A' ? { sendA: v } : { sendB: v });
  }

  /** Non-destructive clip placement and trim (seconds). */
  setTrackClip(trackId: string, patch: Partial<TrackClip>): void {
    const t = this.state.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const dur = t.audio?.durationSec ?? 0;
    const trimStart = clamp(patch.trimStartSec ?? t.clip.trimStartSec, 0, dur);
    const trimEnd = clamp(patch.trimEndSec ?? t.clip.trimEndSec, 0, Math.max(0, dur - trimStart));
    const clip: TrackClip = { startSec: Math.max(0, patch.startSec ?? t.clip.startSec), trimStartSec: trimStart, trimEndSec: trimEnd };
    this.updateTrack(trackId, { clip }, 'none');
    if (this.playing) this.restartAtCurrent();
    this.emitTransport();
  }

  // ---- audio import ---------------------------------------------------------

  private assertSupported(file: Blob & { name?: string }): void {
    const ext = getExtension(file.name ?? '');
    const okExt = (ACCEPTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
    const okMime = (ACCEPTED_AUDIO_MIME as readonly string[]).includes((file.type ?? '').toLowerCase());
    if (!okExt && !okMime) {
      throw new DawImportError(`Unsupported file type "${ext || file.type || 'unknown'}". Use .wav, .mp3, .flac or .ogg.`);
    }
  }

  private async decode(blob: Blob): Promise<AudioBuffer> {
    await this.init();
    const data = await blob.arrayBuffer();
    try {
      return await this.ctx!.decodeAudioData(data);
    } catch (e) {
      throw new DawImportError(`This file could not be decoded: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Decodes a .wav/.mp3/.flac/.ogg file into an AudioBuffer and adds it as a new track. Returns the track id. */
  async importFile(file: File | Blob, opts: { name?: string; startSec?: number } = {}): Promise<string> {
    const named = file as Blob & { name?: string };
    this.assertSupported(named);
    const buffer = await this.decode(file);
    const fileName = named.name || opts.name || 'audio.wav';
    const track = createTrackState({
      name: opts.name ?? (stripExtension(fileName) || 'Audio'),
      audio: {
        fileName,
        mimeType: file.type || 'audio/wav',
        byteLength: file.size,
        durationSec: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
      },
      peaks: this.peaksFor(buffer),
      clip: { startSec: Math.max(0, opts.startSec ?? 0), trimStartSec: 0, trimEndSec: 0 },
    });
    this.buffers.set(track.id, buffer);
    this.blobs.set(track.id, file);
    this.addTrackState(track);
    this.audioEmitter.emit({ trackId: track.id, blob: file, reason: 'import' });
    if (this.playing) this.restartAtCurrent();
    return track.id;
  }

  /**
   * Attaches audio to an existing track without changing project state (used when re-opening a saved project:
   * the Blob comes from IndexedDB). Returns false if decoding fails.
   */
  async attachTrackBlob(trackId: string, blob: Blob): Promise<boolean> {
    if (!this.state.tracks.some((t) => t.id === trackId)) return false;
    try {
      const buffer = await this.decode(blob);
      this.buffers.set(trackId, buffer);
      this.blobs.set(trackId, blob);
      if (this.playing) this.restartAtCurrent();
      this.emitTransport();
      return true;
    } catch {
      return false;
    }
  }

  /** Replaces a track's audio (relink on another device, or swap the take). Updates the audio ref and peaks. */
  async relinkTrackAudio(trackId: string, file: File | Blob): Promise<void> {
    const track = this.state.tracks.find((t) => t.id === trackId);
    if (!track) throw new DawImportError('Track not found');
    const named = file as Blob & { name?: string };
    this.assertSupported(named);
    const buffer = await this.decode(file);
    this.buffers.set(trackId, buffer);
    this.blobs.set(trackId, file);
    const dur = buffer.duration;
    const trimStart = Math.min(track.clip.trimStartSec, dur);
    this.updateTrack(
      trackId,
      {
        audio: {
          fileName: named.name || track.audio?.fileName || 'audio.wav',
          mimeType: file.type || track.audio?.mimeType || 'audio/wav',
          byteLength: file.size,
          durationSec: dur,
          sampleRate: buffer.sampleRate,
          channels: buffer.numberOfChannels,
        },
        peaks: this.peaksFor(buffer),
        clip: { ...track.clip, trimStartSec: trimStart, trimEndSec: Math.min(track.clip.trimEndSec, Math.max(0, dur - trimStart)) },
      },
      'none',
    );
    this.audioEmitter.emit({ trackId, blob: file, reason: 'relink' });
    if (this.playing) this.restartAtCurrent();
    this.emitTransport();
  }

  private peaksFor(buffer: AudioBuffer): number[] {
    const chans: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    return computePeaks(chans, PEAKS_RESOLUTION);
  }

  hasTrackAudio(trackId: string): boolean {
    return this.buffers.has(trackId);
  }

  getTrackBlob(trackId: string): Blob | undefined {
    return this.blobs.get(trackId);
  }

  getTrackBuffer(trackId: string): AudioBuffer | undefined {
    return this.buffers.get(trackId);
  }

  /** Tracks that reference audio (per project state) but have no decoded buffer yet, e.g. blob missing on this device. */
  getTracksMissingAudio(): string[] {
    return this.state.tracks.filter((t) => t.audio !== null && !this.buffers.has(t.id)).map((t) => t.id);
  }

  // =========================================================================
  // Returns & master
  // =========================================================================

  setReturnFader(id: ReturnId, db: number): void {
    const key = id;
    const r = this.state[key];
    this.commit({ ...this.state, [key]: { ...r, faderDb: clamp(db, FADER_MIN_DB, FADER_MAX_DB) } });
    this.graph?.syncReturn(this.state[key]);
  }

  setReturnMute(id: ReturnId, mute: boolean): void {
    const r = this.state[id];
    this.commit({ ...this.state, [id]: { ...r, mute } });
    this.graph?.syncReturn(this.state[id]);
  }

  setMasterFader(db: number): void {
    this.commit({ ...this.state, master: { ...this.state.master, faderDb: clamp(db, FADER_MIN_DB, FADER_MAX_DB) } });
    this.graph?.syncMaster(this.state.master);
  }

  // =========================================================================
  // Device racks (insert FX chains)
  // =========================================================================

  private findPlugin(chainId: ChainId, instanceId: string): BaseDawPlugin | undefined {
    const g = this.requireGraph();
    const inChain = g.getChain(chainId)?.find(instanceId);
    if (inChain) return inChain;
    if (chainId === CHAIN_MASTER && g.safety.instanceId === instanceId) return g.safety;
    return undefined;
  }

  private mustFind(chainId: ChainId, instanceId: string): BaseDawPlugin {
    const p = this.findPlugin(chainId, instanceId);
    if (!p) throw new Error(`Plugin ${instanceId} not found in chain "${chainId}"`);
    return p;
  }

  /** Writes a live plugin's state back into the project state. */
  private commitPlugin(chainId: ChainId, plugin: BaseDawPlugin): void {
    const g = this.requireGraph();
    const ps = plugin.getState();
    if (plugin === g.safety) {
      this.commit({ ...this.state, master: { ...this.state.master, limiter: ps } });
      return;
    }
    const chain = getChain(this.state, chainId);
    if (!chain) return;
    this.commit(withChain(this.state, chainId, chain.map((p) => (p.instanceId === ps.instanceId ? ps : p))));
  }

  private commitChain(chainId: ChainId): void {
    const chain = this.requireGraph().getChain(chainId);
    if (!chain) return;
    this.commit(withChain(this.state, chainId, chain.list().map((p) => p.getState())));
  }

  /** Adds a plugin to a chain (`trackId`, `'master'`, `'returnA'` or `'returnB'`). Returns the new instance id. */
  addPlugin(chainId: ChainId, pluginId: PluginId, index?: number, values?: Record<string, number>): string {
    const g = this.requireGraph();
    const chain = g.getChain(chainId);
    if (!chain) throw new Error(`Unknown chain "${chainId}"`);
    const plugin = createPlugin(pluginId, g.env, createPluginState(pluginId, values));
    chain.insert(plugin, index ?? chain.list().length);
    this.commitChain(chainId);
    return plugin.instanceId;
  }

  removePlugin(chainId: ChainId, instanceId: string): void {
    const chain = this.requireGraph().getChain(chainId);
    const removed = chain?.remove(instanceId);
    if (!removed) return;
    removed.dispose();
    this.commitChain(chainId);
  }

  movePlugin(chainId: ChainId, instanceId: string, toIndex: number): void {
    const chain = this.requireGraph().getChain(chainId);
    if (chain?.move(instanceId, toIndex)) this.commitChain(chainId);
  }

  setPluginParam(chainId: ChainId, instanceId: string, paramId: string, value: number): number {
    const p = this.mustFind(chainId, instanceId);
    const v = p.setParam(paramId, value);
    this.commitPlugin(chainId, p);
    return v;
  }

  setPluginBypass(chainId: ChainId, instanceId: string, bypass: boolean): void {
    const p = this.mustFind(chainId, instanceId);
    p.setBypass(bypass);
    this.commitPlugin(chainId, p);
  }

  setPluginDeltaListen(chainId: ChainId, instanceId: string, enabled: boolean): void {
    const p = this.mustFind(chainId, instanceId);
    p.setDeltaListen(enabled);
    this.commitPlugin(chainId, p);
  }

  togglePluginAB(chainId: ChainId, instanceId: string): AbSlot {
    const p = this.mustFind(chainId, instanceId);
    const slot = p.toggleAB();
    this.commitPlugin(chainId, p);
    return slot;
  }

  copyPluginAToB(chainId: ChainId, instanceId: string): void {
    const p = this.mustFind(chainId, instanceId);
    p.copyAToB();
    this.commitPlugin(chainId, p);
  }

  setPluginInputTrim(chainId: ChainId, instanceId: string, db: number): number {
    const p = this.mustFind(chainId, instanceId);
    const v = p.setInputTrimDb(db);
    this.commitPlugin(chainId, p);
    return v;
  }

  setPluginOutputTrim(chainId: ChainId, instanceId: string, db: number): number {
    const p = this.mustFind(chainId, instanceId);
    const v = p.setOutputTrimDb(db);
    this.commitPlugin(chainId, p);
    return v;
  }

  loadPluginPreset(chainId: ChainId, instanceId: string, presetId: string): boolean {
    const p = this.mustFind(chainId, instanceId);
    const ok = p.loadPreset(presetId);
    if (ok) this.commitPlugin(chainId, p);
    return ok;
  }

  /** Reads live GR + VU for one plugin into `out` (no allocation). Returns false if the plugin does not exist. */
  getPluginMeters(chainId: ChainId, instanceId: string, out: PluginMeterReadout): boolean {
    if (!this.graph) return false;
    const p = this.findPlugin(chainId, instanceId);
    if (!p) return false;
    out.gainReductionDb = p.getGainReductionDb();
    out.vuDb = p.getVuLevelDb();
    return true;
  }

  getPluginState(chainId: ChainId, instanceId: string): PluginState | undefined {
    return this.findPlugin(chainId, instanceId)?.getState();
  }

  // =========================================================================
  // Metering
  // =========================================================================

  private rebuildFrame(): void {
    const g = this.graph;
    this.frameStrips = [];
    const ids: string[] = [];
    const meters: ChannelMeter[] = [];
    for (const t of this.state.tracks) {
      const strip = g?.strips.get(t.id);
      if (!strip) continue;
      this.frameStrips.push(strip);
      ids.push(t.id);
      meters.push(newChannelMeter());
    }
    this.frame.trackIds = ids;
    this.frame.tracks = meters;
    this.frame.trackCount = ids.length;
    this.frameVersion = this.structureVersion;
  }

  /**
   * Fills and returns a single re-used telemetry object (zero allocation at steady state).
   * Call it from `requestAnimationFrame`, draw to `<canvas>`, and do not keep the reference across frames.
   */
  getMeterFrame(): MeterFrame {
    const g = this.graph;
    const f = this.frame;
    if (!g) return f;
    if (this.frameVersion !== this.structureVersion) this.rebuildFrame();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    f.timestamp = now;
    f.positionSec = this.getPositionSec();
    const buf = this.meterBuf;
    for (let i = 0; i < this.frameStrips.length; i++) {
      const s = this.frameStrips[i]!;
      const m = f.tracks[i]!;
      s.meter.read(m, buf, now);
      m.gainReductionDb = s.chain.getGainReductionDb();
    }
    g.returnA.meter.read(f.returnA, buf, now);
    f.returnA.gainReductionDb = g.returnA.chain.getGainReductionDb();
    g.returnB.meter.read(f.returnB, buf, now);
    f.returnB.gainReductionDb = g.returnB.chain.getGainReductionDb();
    g.masterMeter.read(f.master, buf, now);
    const limiterGr = g.safety.bypass ? 0 : g.safety.getGainReductionDb();
    f.safetyLimiterGainReductionDb = limiterGr;
    f.master.gainReductionDb = g.masterChain.getGainReductionDb() + limiterGr;
    return f;
  }

  resetPeakHolds(): void {
    const g = this.graph;
    if (!g) return;
    for (const s of g.strips.values()) s.meter.resetHold();
    g.returnA.meter.resetHold();
    g.returnB.meter.resetHold();
    g.masterMeter.resetHold();
  }

  // =========================================================================
  // Offline bounce
  // =========================================================================

  /**
   * Renders the full mix (all clips, faders, pans, mute/solo, sends, return racks, master chain and the
   * safety limiter) through an OfflineAudioContext and encodes it as a 16/24-bit WAV.
   * The result carries both a `Blob` (for download) and a `File` (for `onSendToAnalyzer(file)`).
   */
  async exportMixdownWav(options: ExportOptions = {}): Promise<MixdownResult> {
    await this.init();
    const state = this.state;
    const bitDepth: WavBitDepth = options.bitDepth ?? 24;
    const sampleRate = Math.round(options.sampleRate ?? this.ctx!.sampleRate);
    const total = computeProjectDuration(state);
    const playable = state.tracks.filter((t) => this.buffers.has(t.id) && trackClipDurationSec(t) > 0);
    if (playable.length === 0 || total <= 0) throw new DawExportError('Nothing to export: the project has no audio.');

    const start = clamp(options.startSec ?? 0, 0, total);
    const end = clamp(options.endSec ?? total, start, total);
    if (end - start <= 0) throw new DawExportError('Export range is empty.');
    const tail = Math.max(0, options.tailSec ?? estimateTailSec(state));

    const latency = Math.round(limiterLatencySec(sampleRate) * sampleRate);
    const bodyFrames = Math.ceil((end - start + tail) * sampleRate);
    const frames = bodyFrames + latency;

    const offline = this.options.offlineContextFactory
      ? this.options.offlineContextFactory(2, frames, sampleRate)
      : new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate });
    await ensureWorklets(offline);
    const env = createAudioEnv(offline, true);
    const graph = new MixerGraph(env, state, offline.destination);
    graph.syncMixer(state, true);
    scheduleSegments(offline, graph, state.tracks, this.buffers, start, end, 0, 0);

    if (options.onProgress && frames > sampleRate * 8) {
      const steps = 10;
      for (let i = 1; i < steps; i++) {
        const t = Math.floor((frames * (i / steps)) / 128) * 128;
        if (t <= 0 || t >= frames) continue;
        const p = i / steps;
        offline
          .suspend(t / sampleRate)
          .then(() => {
            options.onProgress?.(p);
            return offline.resume();
          })
          .catch(() => undefined);
      }
    }

    const rendered = await offline.startRendering();
    graph.dispose();
    options.onProgress?.(1);

    // The look-ahead limiter delays everything by `latency` samples: drop them so the file starts at t = 0.
    const left = rendered.getChannelData(0).subarray(latency, latency + bodyFrames);
    const right = (rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0)).subarray(
      latency,
      latency + bodyFrames,
    );
    const wav = encodeWav([left, right], sampleRate, { bitDepth, dither: options.dither ?? true });
    const fileName = ensureWavName(options.fileName ?? `${state.name || 'mixdown'}.wav`);
    const blob = new Blob([wav.bytes], { type: 'audio/wav' });
    const file = new File([blob], fileName, { type: 'audio/wav', lastModified: Date.now() });
    return {
      blob,
      file,
      fileName,
      durationSec: bodyFrames / sampleRate,
      sampleRate,
      bitDepth,
      channels: 2,
      byteLength: wav.bytes.byteLength,
      peakDb: gainToDb(wav.peak),
      clippedSamples: wav.clippedSamples,
    };
  }
}

function ensureWavName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'mixdown';
  return /\.wav$/i.test(clean) ? clean : `${clean}.wav`;
}

/** Rough reverb/delay tail so the bounce is not cut off. */
export function estimateTailSec(state: ProjectState): number {
  const pluginTail = (p: PluginState): number => {
    if (p.bypass) return 0;
    const v = p.abSlot === 'A' ? p.paramsA : p.paramsB;
    if (p.pluginId === 'studio-reverb') return (v.decay ?? 2) + (v.preDelay ?? 0) / 1000;
    if (p.pluginId === 'stereo-delay') {
      const t = Math.max(v.timeL ?? 0, v.timeR ?? 0) / 1000;
      const fb = Math.min(0.95, Math.max(0, (v.feedback ?? 0) / 100));
      if (fb < 0.01) return t;
      return t * (1 + Math.log(0.001) / Math.log(fb));
    }
    return 0;
  };
  let tail = 0.25;
  const sendA = state.tracks.some((t) => t.sendA > 0.001);
  const sendB = state.tracks.some((t) => t.sendB > 0.001);
  const chains: PluginState[][] = [state.master.inserts, ...state.tracks.map((t) => t.inserts)];
  if (sendA) chains.push(state.returnA.inserts);
  if (sendB) chains.push(state.returnB.inserts);
  for (const c of chains) for (const p of c) tail = Math.max(tail, pluginTail(p) + 0.25);
  return Math.min(12, tail);
}

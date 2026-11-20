import type {
  AbSlot,
  ChainId,
  ExportOptions,
  ExportStatus,
  MeterFrame,
  MixdownResult,
  PluginId,
  PluginMeterReadout,
  ProjectState,
  ProjectSummary,
  ReturnId,
  TrackClip,
} from '../types';
import { DawAudioEngine, type EngineOptions, type TransportSnapshot } from '../engine/DawAudioEngine';
import { type AudioBlobCache, createAudioBlobCache } from '../storage/audioBlobCache';
import {
  type AutoSaveSnapshot,
  AutoSaver,
  type ProjectStorageAdapter,
  type ProjectStore,
  createLocalStorageProjectAdapter,
  createMemoryProjectAdapter,
  createProjectStore,
} from '../storage/projectStore';

export interface DawControllerOptions {
  /** Persistence backend (Supabase adapter in the MixLearn app). Defaults to localStorage, else memory. */
  adapter?: ProjectStorageAdapter;
  /** Audio blob cache. Defaults to IndexedDB, else memory. */
  audioCache?: AudioBlobCache;
  autosaveDelayMs?: number;
  engine?: EngineOptions;
  /** Called with the rendered WAV `File` by `sendMixdownToAnalyzer()`. */
  onSendToAnalyzer?: (wavFile: File) => void | Promise<void>;
  /** Flush pending auto-save when the tab is hidden or closed (default true). */
  flushOnPageHide?: boolean;
}

export interface MixdownSummary {
  fileName: string;
  durationSec: number;
  byteLength: number;
  sampleRate: number;
  bitDepth: number;
  peakDb: number;
  clippedSamples: number;
  finishedAt: number;
}

export interface ExportSnapshot {
  status: ExportStatus;
  /** 0..1 */
  progress: number;
  error: string | null;
  lastResult: MixdownSummary | null;
}

/** Immutable, referentially stable snapshot consumed through `useSyncExternalStore`. */
export interface DawSnapshot {
  /** Engine initialised (AudioContext created, worklets loaded). */
  ready: boolean;
  project: ProjectState;
  transport: TransportSnapshot;
  autosave: AutoSaveSnapshot;
  /** Tracks whose audio blob is not on this device and must be relinked. */
  missingAudioTrackIds: string[];
  loadingProject: boolean;
  export: ExportSnapshot;
  /** Last non-fatal error message (import failure, storage failure...). */
  error: string | null;
}

const ACTION_NAMES = [
  'init',
  'play',
  'pause',
  'stop',
  'togglePlay',
  'seek',
  'setLoop',
  'importFile',
  'addTrack',
  'removeTrack',
  'moveTrack',
  'reorderTracks',
  'renameTrack',
  'setTrackInputGain',
  'setTrackPhaseInvert',
  'setTrackFader',
  'setTrackPan',
  'setTrackMute',
  'setTrackSolo',
  'setTrackSend',
  'setTrackClip',
  'relinkTrackAudio',
  'setReturnFader',
  'setReturnMute',
  'setMasterFader',
  'addPlugin',
  'removePlugin',
  'movePlugin',
  'setPluginParam',
  'setPluginBypass',
  'togglePluginAB',
  'copyPluginAToB',
  'setPluginDeltaListen',
  'setPluginInputTrim',
  'setPluginOutputTrim',
  'loadPluginPreset',
  'newProject',
  'openProject',
  'listProjects',
  'saveNow',
  'duplicateProject',
  'deleteProject',
  'renameProject',
  'exportMixdownWav',
  'sendMixdownToAnalyzer',
  'setOnSendToAnalyzer',
  'getMeterFrame',
  'getPositionSec',
  'getPluginMeters',
  'resetPeakHolds',
  'clearError',
] as const;

/** Every Ableton-workflow action, bound and stable across renders. */
export type DawActions = Pick<DawController, (typeof ACTION_NAMES)[number]>;

function sameTransport(a: TransportSnapshot, b: TransportSnapshot): boolean {
  return (
    a.playing === b.playing &&
    a.loopEnabled === b.loopEnabled &&
    a.loopStartSec === b.loopStartSec &&
    a.loopEndSec === b.loopEndSec &&
    a.durationSec === b.durationSec
  );
}

/**
 * Framework-agnostic application controller: engine + storage + auto-save + export in one object.
 * React hooks are thin `useSyncExternalStore` wrappers around `subscribe` / `getSnapshot`.
 */
export class DawController {
  readonly engine: DawAudioEngine;
  readonly store: ProjectStore;
  readonly audioCache: AudioBlobCache;
  readonly autosaver: AutoSaver;
  /** All actions as stable bound functions (safe to destructure and to pass as props). */
  readonly actions: DawActions;

  private snapshot: DawSnapshot;
  private readonly listeners = new Set<() => void>();
  private onSendToAnalyzerCb: ((file: File) => void | Promise<void>) | undefined;
  private lastMixdown: MixdownResult | null = null;
  private suppressAutosave = false;
  private initPromise: Promise<void> | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(options: DawControllerOptions = {}) {
    this.engine = new DawAudioEngine(options.engine);
    this.audioCache = options.audioCache ?? createAudioBlobCache();
    let adapter = options.adapter;
    if (!adapter) {
      try {
        adapter = createLocalStorageProjectAdapter();
      } catch {
        adapter = createMemoryProjectAdapter();
      }
    }
    this.store = createProjectStore({
      adapter,
      audioCache: this.audioCache,
      ...(options.autosaveDelayMs !== undefined ? { autosaveDelayMs: options.autosaveDelayMs } : {}),
    });
    this.autosaver = this.store.createAutoSaver();
    this.onSendToAnalyzerCb = options.onSendToAnalyzer;

    this.snapshot = {
      ready: false,
      project: this.engine.getState(),
      transport: this.engine.getTransport(),
      autosave: this.autosaver.getSnapshot(),
      missingAudioTrackIds: [],
      loadingProject: false,
      export: { status: 'idle', progress: 0, error: null, lastResult: null },
      error: null,
    };

    this.disposers.push(
      this.engine.subscribe((project) => {
        if (!this.suppressAutosave) this.autosaver.schedule(project);
        this.update({ project });
      }),
      this.engine.subscribeTransport((transport) => {
        if (!sameTransport(transport, this.snapshot.transport)) this.update({ transport });
      }),
      this.engine.onTrackAudio(({ trackId, blob }) => {
        const projectId = this.engine.getState().id;
        this.audioCache.put(projectId, trackId, blob).catch((e: unknown) => {
          this.update({ error: `Audio could not be cached on this device: ${e instanceof Error ? e.message : String(e)}` });
        });
        if (this.snapshot.missingAudioTrackIds.includes(trackId)) {
          this.update({ missingAudioTrackIds: this.snapshot.missingAudioTrackIds.filter((id) => id !== trackId) });
        }
      }),
      this.autosaver.subscribe((autosave) => this.update({ autosave })),
    );

    if ((options.flushOnPageHide ?? true) && typeof document !== 'undefined' && typeof window !== 'undefined') {
      const flush = () => {
        void this.autosaver.flush();
      };
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') flush();
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', flush);
      this.disposers.push(() => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', flush);
      });
    }

    const actions: Record<string, unknown> = {};
    for (const name of ACTION_NAMES) {
      const fn = this[name] as (...args: unknown[]) => unknown;
      actions[name] = fn.bind(this);
    }
    this.actions = actions as unknown as DawActions;
  }

  // =========================================================================
  // Store contract for useSyncExternalStore
  // =========================================================================

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DawSnapshot => this.snapshot;

  private update(patch: Partial<DawSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of Array.from(this.listeners)) l();
  }

  private fail(e: unknown): never {
    const message = e instanceof Error ? e.message : String(e);
    this.update({ error: message });
    throw e instanceof Error ? e : new Error(message);
  }

  clearError(): void {
    if (this.snapshot.error !== null) this.update({ error: null });
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /** Creates the AudioContext, loads the DSP worklets, optionally opens a saved project. Idempotent. */
  init(initialProjectId?: string): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.engine.init();
      this.update({ ready: true, transport: this.engine.getTransport() });
      if (initialProjectId) await this.openProject(initialProjectId);
    })().catch((e) => {
      this.initPromise = null;
      this.update({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    });
    return this.initPromise;
  }

  dispose(): void {
    void this.autosaver.flush().finally(() => this.autosaver.dispose());
    for (const d of this.disposers.splice(0)) d();
    this.engine.dispose();
    this.listeners.clear();
  }

  // =========================================================================
  // Transport
  // =========================================================================

  play = async (): Promise<void> => {
    try {
      await this.engine.play();
    } catch (e) {
      this.fail(e);
    }
  };
  pause(): void {
    this.engine.pause();
  }
  stop(): void {
    this.engine.stop();
  }
  async togglePlay(): Promise<void> {
    if (this.engine.isPlaying()) this.engine.pause();
    else await this.play();
  }
  seek(sec: number): void {
    this.engine.seek(sec);
  }
  setLoop(startSec: number, endSec: number, enabled: boolean): void {
    this.engine.setLoop(startSec, endSec, enabled);
  }
  getPositionSec(): number {
    return this.engine.getPositionSec();
  }

  // =========================================================================
  // Tracks
  // =========================================================================

  async importFile(file: File | Blob, options?: { name?: string; startSec?: number }): Promise<string> {
    try {
      return await this.engine.importFile(file, options);
    } catch (e) {
      return this.fail(e);
    }
  }
  addTrack(options?: { name?: string }): string {
    return this.engine.addTrack(options);
  }
  removeTrack(trackId: string): void {
    const projectId = this.engine.getState().id;
    this.engine.removeTrack(trackId);
    void this.audioCache.delete(projectId, trackId).catch(() => undefined);
    if (this.snapshot.missingAudioTrackIds.includes(trackId)) {
      this.update({ missingAudioTrackIds: this.snapshot.missingAudioTrackIds.filter((id) => id !== trackId) });
    }
  }
  moveTrack(trackId: string, toIndex: number): void {
    this.engine.moveTrack(trackId, toIndex);
  }
  reorderTracks(orderedIds: string[]): void {
    this.engine.reorderTracks(orderedIds);
  }
  renameTrack(trackId: string, name: string): void {
    this.engine.setTrackName(trackId, name);
  }
  setTrackInputGain(trackId: string, db: number): void {
    this.engine.setTrackInputGain(trackId, db);
  }
  setTrackPhaseInvert(trackId: string, invert: boolean): void {
    this.engine.setTrackPhaseInvert(trackId, invert);
  }
  setTrackFader(trackId: string, db: number): void {
    this.engine.setTrackFader(trackId, db);
  }
  setTrackPan(trackId: string, pan: number): void {
    this.engine.setTrackPan(trackId, pan);
  }
  setTrackMute(trackId: string, mute: boolean): void {
    this.engine.setTrackMute(trackId, mute);
  }
  setTrackSolo(trackId: string, solo: boolean): void {
    this.engine.setTrackSolo(trackId, solo);
  }
  setTrackSend(trackId: string, send: 'A' | 'B', amount: number): void {
    this.engine.setTrackSend(trackId, send, amount);
  }
  setTrackClip(trackId: string, patch: Partial<TrackClip>): void {
    this.engine.setTrackClip(trackId, patch);
  }
  /** Provide the audio file again for a track whose blob is missing on this device (or to swap the take). */
  async relinkTrackAudio(trackId: string, file: File | Blob): Promise<void> {
    try {
      await this.engine.relinkTrackAudio(trackId, file);
    } catch (e) {
      this.fail(e);
    }
  }

  // =========================================================================
  // Returns & master
  // =========================================================================

  setReturnFader(id: ReturnId, db: number): void {
    this.engine.setReturnFader(id, db);
  }
  setReturnMute(id: ReturnId, mute: boolean): void {
    this.engine.setReturnMute(id, mute);
  }
  setMasterFader(db: number): void {
    this.engine.setMasterFader(db);
  }

  // =========================================================================
  // Device rack
  // =========================================================================

  /** `chainId` is a track id, `'master'`, `'returnA'` or `'returnB'`. */
  addPlugin(chainId: ChainId, pluginId: PluginId, index?: number, values?: Record<string, number>): string {
    try {
      return this.engine.addPlugin(chainId, pluginId, index, values);
    } catch (e) {
      return this.fail(e);
    }
  }
  removePlugin(chainId: ChainId, instanceId: string): void {
    this.engine.removePlugin(chainId, instanceId);
  }
  movePlugin(chainId: ChainId, instanceId: string, toIndex: number): void {
    this.engine.movePlugin(chainId, instanceId, toIndex);
  }
  setPluginParam(chainId: ChainId, instanceId: string, paramId: string, value: number): number {
    return this.engine.setPluginParam(chainId, instanceId, paramId, value);
  }
  setPluginBypass(chainId: ChainId, instanceId: string, bypass: boolean): void {
    this.engine.setPluginBypass(chainId, instanceId, bypass);
  }
  togglePluginAB(chainId: ChainId, instanceId: string): AbSlot {
    return this.engine.togglePluginAB(chainId, instanceId);
  }
  copyPluginAToB(chainId: ChainId, instanceId: string): void {
    this.engine.copyPluginAToB(chainId, instanceId);
  }
  setPluginDeltaListen(chainId: ChainId, instanceId: string, enabled: boolean): void {
    this.engine.setPluginDeltaListen(chainId, instanceId, enabled);
  }
  setPluginInputTrim(chainId: ChainId, instanceId: string, db: number): number {
    return this.engine.setPluginInputTrim(chainId, instanceId, db);
  }
  setPluginOutputTrim(chainId: ChainId, instanceId: string, db: number): number {
    return this.engine.setPluginOutputTrim(chainId, instanceId, db);
  }
  loadPluginPreset(chainId: ChainId, instanceId: string, presetId: string): boolean {
    return this.engine.loadPluginPreset(chainId, instanceId, presetId);
  }

  // =========================================================================
  // Project lifecycle
  // =========================================================================

  private async loadIntoEngine(state: ProjectState): Promise<void> {
    this.suppressAutosave = true;
    try {
      await this.engine.init();
      this.engine.loadProject(state);
    } finally {
      this.suppressAutosave = false;
    }
    this.autosaver.reset();
    const missing: string[] = [];
    await Promise.all(
      state.tracks
        .filter((t) => t.audio !== null)
        .map(async (t) => {
          let ok = false;
          try {
            const blob = await this.audioCache.get(state.id, t.id);
            ok = blob !== null && (await this.engine.attachTrackBlob(t.id, blob));
          } catch {
            ok = false;
          }
          if (!ok) missing.push(t.id);
        }),
    );
    this.update({ project: this.engine.getState(), transport: this.engine.getTransport(), missingAudioTrackIds: missing, loadingProject: false });
  }

  /** Starts a new, empty project. With `persist: false` it is not written until the first edit auto-saves it. */
  async newProject(name?: string, options: { persist?: boolean } = {}): Promise<ProjectState> {
    this.update({ loadingProject: true });
    try {
      await this.autosaver.flush();
      const state = await this.store.createProject(name, { persist: options.persist ?? true, sampleRate: this.engine.getContext()?.sampleRate ?? 48000 });
      await this.loadIntoEngine(state);
      return state;
    } catch (e) {
      this.update({ loadingProject: false });
      return this.fail(e);
    }
  }

  /** Opens a saved project: loads JSON, rebuilds the graph, then re-attaches audio from IndexedDB (missing blobs are flagged). */
  async openProject(id: string): Promise<ProjectState> {
    this.update({ loadingProject: true });
    try {
      await this.autosaver.flush();
      const state = await this.store.openProject(id);
      await this.loadIntoEngine(state);
      return state;
    } catch (e) {
      this.update({ loadingProject: false });
      return this.fail(e);
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    try {
      return await this.store.listProjects();
    } catch (e) {
      return this.fail(e);
    }
  }

  /** Saves right now (bypasses the 2 s debounce). */
  async saveNow(): Promise<void> {
    this.autosaver.schedule(this.engine.getState());
    await this.autosaver.flush();
  }

  async duplicateProject(id?: string, newName?: string): Promise<ProjectState> {
    try {
      if (!id || id === this.engine.getState().id) await this.saveNow();
      return await this.store.duplicateProject(id ?? this.engine.getState().id, newName);
    } catch (e) {
      return this.fail(e);
    }
  }

  async deleteProject(id: string): Promise<void> {
    try {
      const isCurrent = id === this.engine.getState().id;
      if (isCurrent) this.autosaver.cancel();
      await this.store.deleteProject(id);
      if (isCurrent) await this.newProject(undefined, { persist: false });
    } catch (e) {
      this.fail(e);
    }
  }

  renameProject(name: string): void {
    this.engine.setProjectName(name);
  }

  // =========================================================================
  // Export / analyzer
  // =========================================================================

  setOnSendToAnalyzer(cb: ((wavFile: File) => void | Promise<void>) | undefined): void {
    this.onSendToAnalyzerCb = cb;
  }

  getLastMixdown(): MixdownResult | null {
    return this.lastMixdown;
  }

  /** Offline-renders the whole mix + master chain to WAV. Returns `{ blob, file, ... }`. */
  async exportMixdownWav(options: ExportOptions = {}): Promise<MixdownResult> {
    this.update({ export: { ...this.snapshot.export, status: 'rendering', progress: 0, error: null } });
    try {
      const result = await this.engine.exportMixdownWav({
        ...options,
        onProgress: (p) => {
          this.update({ export: { ...this.snapshot.export, status: 'rendering', progress: p } });
          options.onProgress?.(p);
        },
      });
      this.lastMixdown = result;
      const summary: MixdownSummary = {
        fileName: result.fileName,
        durationSec: result.durationSec,
        byteLength: result.byteLength,
        sampleRate: result.sampleRate,
        bitDepth: result.bitDepth,
        peakDb: result.peakDb,
        clippedSamples: result.clippedSamples,
        finishedAt: Date.now(),
      };
      this.update({ export: { status: 'done', progress: 1, error: null, lastResult: summary } });
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.update({ export: { ...this.snapshot.export, status: 'error', error: message } });
      throw e;
    }
  }

  /** Renders the mix and hands the WAV `File` to the registered `onSendToAnalyzer` callback. */
  async sendMixdownToAnalyzer(options: ExportOptions = {}): Promise<MixdownResult> {
    if (!this.onSendToAnalyzerCb) {
      return this.fail(new Error('No onSendToAnalyzer callback is registered. Pass one to the controller options or call setOnSendToAnalyzer().'));
    }
    const result = await this.exportMixdownWav({ bitDepth: 24, ...options });
    await this.onSendToAnalyzerCb(result.file);
    return result;
  }

  // =========================================================================
  // Meters (no React state involved)
  // =========================================================================

  getMeterFrame(): MeterFrame {
    return this.engine.getMeterFrame();
  }
  getPluginMeters(chainId: ChainId, instanceId: string, out: PluginMeterReadout): boolean {
    return this.engine.getPluginMeters(chainId, instanceId, out);
  }
  resetPeakHolds(): void {
    this.engine.resetPeakHolds();
  }
}

// ---------------------------------------------------------------------------
// Shared default instance (what the hooks use when you do not pass a controller)
// ---------------------------------------------------------------------------

let defaultController: DawController | null = null;

/** Lazily creates a process-wide controller. Options are only used by the first call. */
export function getDefaultDawController(options?: DawControllerOptions): DawController {
  if (!defaultController) defaultController = new DawController(options);
  return defaultController;
}

export function setDefaultDawController(controller: DawController | null): void {
  defaultController = controller;
}

export function createDawController(options?: DawControllerOptions): DawController {
  return new DawController(options);
}

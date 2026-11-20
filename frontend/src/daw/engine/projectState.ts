import type {
  MasterState,
  PluginId,
  PluginState,
  ProjectState,
  ReturnId,
  ReturnState,
  TrackAudioRef,
  TrackClip,
  TrackState,
  TransportSettings,
} from '../types';
import {
  CHAIN_MASTER,
  CHAIN_RETURN_A,
  CHAIN_RETURN_B,
  FADER_MAX_DB,
  FADER_MIN_DB,
  INPUT_GAIN_MAX_DB,
  INPUT_GAIN_MIN_DB,
  PEAKS_RESOLUTION,
  PROJECT_SCHEMA_VERSION,
  TRIM_MAX_DB,
  TRIM_MIN_DB,
} from '../constants';
import { clampParam } from '../fx/kit';
import { getPluginDescriptor, isPluginId } from '../fx/registry';
import { clamp } from '../utils/dsp';
import { nowIso, uid } from '../utils/ids';

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Fresh PluginState with descriptor defaults (optionally overlaying a preset or explicit values). */
export function createPluginState(pluginId: PluginId, values: Record<string, number> = {}, instanceId?: string): PluginState {
  const d = getPluginDescriptor(pluginId);
  const params: Record<string, number> = {};
  for (const p of d.params) {
    const raw = values[p.id];
    params[p.id] = raw === undefined ? p.default : clampParam(p, raw);
  }
  return {
    instanceId: instanceId ?? uid(),
    pluginId,
    bypass: false,
    deltaListen: false,
    inputTrimDb: 0,
    outputTrimDb: 0,
    abSlot: 'A',
    paramsA: { ...params },
    paramsB: { ...params },
    presetId: null,
  };
}

export function createTrackState(init: Partial<TrackState> & { id?: string; name?: string } = {}): TrackState {
  return {
    id: init.id ?? uid(),
    name: init.name ?? 'Audio',
    audio: init.audio ?? null,
    inputGainDb: init.inputGainDb ?? 0,
    phaseInvert: init.phaseInvert ?? false,
    inserts: init.inserts ?? [],
    faderDb: init.faderDb ?? 0,
    pan: init.pan ?? 0,
    mute: init.mute ?? false,
    solo: init.solo ?? false,
    sendA: init.sendA ?? 0,
    sendB: init.sendB ?? 0,
    clip: init.clip ?? { startSec: 0, trimStartSec: 0, trimEndSec: 0 },
    peaks: init.peaks ?? new Array<number>(PEAKS_RESOLUTION).fill(0),
  };
}

export function createReturnState(id: ReturnId): ReturnState {
  if (id === 'returnA') {
    return {
      id,
      name: 'A Reverb',
      kind: 'reverb',
      inserts: [createPluginState('studio-reverb', { type: 1, decay: 1.8, preDelay: 20, mix: 100 })],
      faderDb: 0,
      mute: false,
    };
  }
  return {
    id,
    name: 'B Delay',
    kind: 'delay',
    inserts: [createPluginState('stereo-delay', { mode: 1, timeL: 375, feedback: 35, mix: 100 })],
    faderDb: 0,
    mute: false,
  };
}

export function createMasterState(): MasterState {
  return {
    faderDb: 0,
    inserts: [],
    limiter: createPluginState('master-limiter', { ceiling: -1, input: 0, release: 100 }),
  };
}

export function createProjectState(init: { id?: string; name?: string; sampleRate?: number } = {}): ProjectState {
  const now = nowIso();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: init.id ?? uid(),
    name: init.name ?? 'Untitled Project',
    createdAt: now,
    updatedAt: now,
    sampleRate: init.sampleRate ?? 48000,
    tracks: [],
    returnA: createReturnState('returnA'),
    returnB: createReturnState('returnB'),
    master: createMasterState(),
    transport: { loopEnabled: false, loopStartSec: 0, loopEndSec: 0 },
  };
}

// ---------------------------------------------------------------------------
// Derived values & immutable updaters
// ---------------------------------------------------------------------------

export function trackClipDurationSec(track: TrackState): number {
  if (!track.audio) return 0;
  return Math.max(0, track.audio.durationSec - track.clip.trimStartSec - track.clip.trimEndSec);
}

export function trackEndSec(track: TrackState): number {
  return track.clip.startSec + trackClipDurationSec(track);
}

/** End of the last clip on the timeline. */
export function computeProjectDuration(state: ProjectState): number {
  let end = 0;
  for (const t of state.tracks) end = Math.max(end, trackEndSec(t));
  return end;
}

export function getChain(state: ProjectState, chainId: string): PluginState[] | undefined {
  if (chainId === CHAIN_MASTER) return state.master.inserts;
  if (chainId === CHAIN_RETURN_A) return state.returnA.inserts;
  if (chainId === CHAIN_RETURN_B) return state.returnB.inserts;
  return state.tracks.find((t) => t.id === chainId)?.inserts;
}

export function withChain(state: ProjectState, chainId: string, inserts: PluginState[]): ProjectState {
  if (chainId === CHAIN_MASTER) return { ...state, master: { ...state.master, inserts } };
  if (chainId === CHAIN_RETURN_A) return { ...state, returnA: { ...state.returnA, inserts } };
  if (chainId === CHAIN_RETURN_B) return { ...state, returnB: { ...state.returnB, inserts } };
  return { ...state, tracks: state.tracks.map((t) => (t.id === chainId ? { ...t, inserts } : t)) };
}

export function withTrack(state: ProjectState, trackId: string, patch: Partial<TrackState>): ProjectState {
  return { ...state, tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) };
}

export function cloneProject(state: ProjectState): ProjectState {
  return JSON.parse(JSON.stringify(state)) as ProjectState;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeProject(state: ProjectState): string {
  return JSON.stringify(state);
}

export function deserializeProject(input: string | unknown): ProjectState {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      throw new ProjectValidationError(`Project JSON could not be parsed: ${(e as Error).message}`);
    }
  }
  return validateProjectState(raw);
}

// ---------------------------------------------------------------------------
// Validation / sanitising (never trusts stored data: clamps ranges, fills defaults, drops unknown plugins)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function sanitizePluginState(raw: unknown): PluginState | null {
  if (!isObj(raw) || !isPluginId(raw.pluginId)) return null;
  const pluginId = raw.pluginId;
  const d = getPluginDescriptor(pluginId);
  const params = (src: unknown): Record<string, number> => {
    const o = isObj(src) ? src : {};
    const out: Record<string, number> = {};
    for (const p of d.params) out[p.id] = clampParam(p, num(o[p.id], p.default));
    return out;
  };
  return {
    instanceId: str(raw.instanceId, '') || uid(),
    pluginId,
    bypass: bool(raw.bypass, false),
    deltaListen: bool(raw.deltaListen, false),
    inputTrimDb: clamp(num(raw.inputTrimDb, 0), TRIM_MIN_DB, TRIM_MAX_DB),
    outputTrimDb: clamp(num(raw.outputTrimDb, 0), TRIM_MIN_DB, TRIM_MAX_DB),
    abSlot: raw.abSlot === 'B' ? 'B' : 'A',
    paramsA: params(raw.paramsA),
    paramsB: params(raw.paramsB),
    presetId: typeof raw.presetId === 'string' ? raw.presetId : null,
  };
}

function sanitizeChain(raw: unknown): PluginState[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginState[] = [];
  for (const r of raw) {
    const p = sanitizePluginState(r);
    if (p) out.push(p);
  }
  return out;
}

function sanitizeAudio(raw: unknown): TrackAudioRef | null {
  if (!isObj(raw)) return null;
  return {
    fileName: str(raw.fileName, 'audio'),
    mimeType: str(raw.mimeType, 'audio/wav'),
    byteLength: Math.max(0, num(raw.byteLength, 0)),
    durationSec: Math.max(0, num(raw.durationSec, 0)),
    sampleRate: Math.max(1, num(raw.sampleRate, 48000)),
    channels: clamp(Math.round(num(raw.channels, 2)), 1, 32),
  };
}

function sanitizeClip(raw: unknown, audio: TrackAudioRef | null): TrackClip {
  const o = isObj(raw) ? raw : {};
  const dur = audio?.durationSec ?? Infinity;
  const trimStart = clamp(num(o.trimStartSec, 0), 0, Number.isFinite(dur) ? dur : 1e9);
  const trimEnd = clamp(num(o.trimEndSec, 0), 0, Number.isFinite(dur) ? Math.max(0, dur - trimStart) : 1e9);
  return { startSec: Math.max(0, num(o.startSec, 0)), trimStartSec: trimStart, trimEndSec: trimEnd };
}

function sanitizePeaks(raw: unknown): number[] {
  if (!Array.isArray(raw)) return new Array<number>(PEAKS_RESOLUTION).fill(0);
  return raw.slice(0, 8192).map((v) => clamp(num(v, 0), 0, 1));
}

function sanitizeTrack(raw: unknown): TrackState | null {
  if (!isObj(raw)) return null;
  const audio = sanitizeAudio(raw.audio);
  return {
    id: str(raw.id, '') || uid(),
    name: str(raw.name, 'Audio'),
    audio,
    inputGainDb: clamp(num(raw.inputGainDb, 0), INPUT_GAIN_MIN_DB, INPUT_GAIN_MAX_DB),
    phaseInvert: bool(raw.phaseInvert, false),
    inserts: sanitizeChain(raw.inserts),
    faderDb: clamp(num(raw.faderDb, 0), FADER_MIN_DB, FADER_MAX_DB),
    pan: clamp(num(raw.pan, 0), -1, 1),
    mute: bool(raw.mute, false),
    solo: bool(raw.solo, false),
    sendA: clamp(num(raw.sendA, 0), 0, 1),
    sendB: clamp(num(raw.sendB, 0), 0, 1),
    clip: sanitizeClip(raw.clip, audio),
    peaks: sanitizePeaks(raw.peaks),
  };
}

function sanitizeReturn(raw: unknown, id: ReturnId): ReturnState {
  const def = createReturnState(id);
  if (!isObj(raw)) return def;
  const inserts = Array.isArray(raw.inserts) ? sanitizeChain(raw.inserts) : def.inserts;
  return {
    id,
    name: str(raw.name, def.name),
    kind: def.kind,
    inserts,
    faderDb: clamp(num(raw.faderDb, 0), FADER_MIN_DB, FADER_MAX_DB),
    mute: bool(raw.mute, false),
  };
}

function sanitizeMaster(raw: unknown): MasterState {
  const def = createMasterState();
  if (!isObj(raw)) return def;
  let limiter = sanitizePluginState(raw.limiter);
  if (!limiter || limiter.pluginId !== 'master-limiter') limiter = def.limiter;
  return { faderDb: clamp(num(raw.faderDb, 0), FADER_MIN_DB, FADER_MAX_DB), inserts: sanitizeChain(raw.inserts), limiter };
}

function sanitizeTransport(raw: unknown): TransportSettings {
  const o = isObj(raw) ? raw : {};
  const start = Math.max(0, num(o.loopStartSec, 0));
  const end = Math.max(start, num(o.loopEndSec, 0));
  return { loopEnabled: bool(o.loopEnabled, false) && end > start, loopStartSec: start, loopEndSec: end };
}

/** Validates arbitrary data (e.g. a Supabase `jsonb` row) into a safe `ProjectState`, or throws `ProjectValidationError`. */
export function validateProjectState(raw: unknown): ProjectState {
  if (!isObj(raw)) throw new ProjectValidationError('Project state must be an object');
  const version = num(raw.schemaVersion, NaN);
  if (!Number.isFinite(version)) throw new ProjectValidationError('Project state is missing schemaVersion');
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new ProjectValidationError(`Project was saved by a newer version (schema ${version} > ${PROJECT_SCHEMA_VERSION})`);
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) throw new ProjectValidationError('Project state is missing an id');
  if (!Array.isArray(raw.tracks)) throw new ProjectValidationError('Project state is missing the tracks array');

  const tracks: TrackState[] = [];
  const seen = new Set<string>();
  for (const t of raw.tracks) {
    const s = sanitizeTrack(t);
    if (!s) continue;
    if (seen.has(s.id)) s.id = uid();
    seen.add(s.id);
    tracks.push(s);
  }
  const now = nowIso();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: raw.id,
    name: str(raw.name, 'Untitled Project'),
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
    sampleRate: Math.max(8000, num(raw.sampleRate, 48000)),
    tracks,
    returnA: sanitizeReturn(raw.returnA, 'returnA'),
    returnB: sanitizeReturn(raw.returnB, 'returnB'),
    master: sanitizeMaster(raw.master),
    transport: sanitizeTransport(raw.transport),
  };
}

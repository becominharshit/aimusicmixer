/**
 * mixlearn-web-daw-core: headless Web DAW core. Public API barrel.
 */

// ---- contracts
export type * from './types';
export * from './constants';

// ---- engine
export { DawAudioEngine, DawImportError, DawExportError, estimateTailSec } from './engine/DawAudioEngine';
export type { EngineOptions, TransportSnapshot, TrackAudioEvent } from './engine/DawAudioEngine';
export { MixerGraph, PluginChain, StripMeter } from './engine/MixerGraph';
export { createAudioEnv, ensureWorklets, configureWorklets, setParam, DawWorkletUnavailableError } from './engine/audioEnv';
export type { AudioEnv, WorkletConfig } from './engine/audioEnv';
export { DAW_WORKLET_SOURCE, limiterLatencySec } from './engine/workletSource';
export { planClipSegment, scheduleSegments } from './engine/scheduler';
export type { ClipSegment, ScheduledSource } from './engine/scheduler';
export {
  ProjectValidationError,
  cloneProject,
  computeProjectDuration,
  createMasterState,
  createPluginState,
  createProjectState,
  createReturnState,
  createTrackState,
  deserializeProject,
  getChain,
  serializeProject,
  trackClipDurationSec,
  trackEndSec,
  validateProjectState,
} from './engine/projectState';

// ---- FX
export { BaseDawPlugin } from './fx/BaseDawPlugin';
export {
  PLUGIN_CATEGORIES,
  PLUGIN_LIST,
  PLUGIN_REGISTRY,
  createPlugin,
  getPluginDescriptor,
  isPluginId,
} from './fx/registry';
export type { PluginRegistryEntry } from './fx/registry';
export { clampParam, normalizedToParam, paramToNormalized } from './fx/kit';
export { generateImpulseResponse } from './fx/ir';
export {
  OpticalComp,
  TubeOpticalComp,
  VcaBusComp,
  FetComp,
  StereoVariMuComp,
} from './fx/compressors';
export {
  PreampEq,
  ProportionalQEq,
  TenBandGraphicEq,
  PassiveProgramEq,
  MidrangeSculptorEq,
  GRAPHIC_BANDS_HZ,
} from './fx/equalizers';
export { MultitrackTapeDeck, MasteringTapeRecorder } from './fx/tape';
export { StudioReverb, StereoDelay } from './fx/spatial';
export { GainStagingUtility, MasterLimiter } from './fx/utilities';

// ---- storage
export {
  AutoSaver,
  ProjectNotFoundError,
  createLocalStorageProjectAdapter,
  createMemoryProjectAdapter,
  createProjectStore,
  createSupabaseProjectAdapter,
} from './storage/projectStore';
export type {
  AutoSaveSnapshot,
  ProjectStorageAdapter,
  ProjectStore,
  ProjectStoreOptions,
  StorageLike,
  SupabaseAdapterOptions,
  SupabaseLikeClient,
} from './storage/projectStore';
export { createAudioBlobCache, createIndexedDbAudioCache, createMemoryAudioCache } from './storage/audioBlobCache';
export type { AudioBlobCache, IndexedDbCacheOptions } from './storage/audioBlobCache';

// ---- controller
export {
  DawController,
  createDawController,
  getDefaultDawController,
  setDefaultDawController,
} from './controller/DawController';
export type {
  DawActions,
  DawControllerOptions,
  DawSnapshot,
  ExportSnapshot,
  MixdownSummary,
} from './controller/DawController';

// ---- React hooks (headless)
export { useDawController } from './hooks/useDawController';
export type { UseDawControllerOptions, UseDawControllerResult } from './hooks/useDawController';
export { useDawProject, useDawProjectSelector, shallowEqual } from './hooks/useDawProject';
export type { DawProjectView } from './hooks/useDawProject';
export { useDawEngine } from './hooks/useDawEngine';
export type { UseDawEngineResult } from './hooks/useDawEngine';
export { useDawMeters } from './hooks/useDawMeters';
export type { UseDawMetersResult } from './hooks/useDawMeters';

// ---- utilities
export { encodeWav, decodeWavPcm, parseWavHeader, triggerDownload } from './utils/wav';
export type { WavEncodeOptions, WavEncodeResult, WavHeaderInfo } from './utils/wav';
export { dbToGain, gainToDb, computePeaks } from './utils/dsp';

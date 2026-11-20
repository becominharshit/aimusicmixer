import type { PluginCategory, PluginDescriptor, PluginId, PluginState } from '../types';
import type { AudioEnv } from '../engine/audioEnv';
import type { BaseDawPlugin } from './BaseDawPlugin';
import {
  FET_COMP_DESCRIPTOR,
  FetComp,
  OPTICAL_COMP_DESCRIPTOR,
  OpticalComp,
  STEREO_VARI_MU_COMP_DESCRIPTOR,
  StereoVariMuComp,
  TUBE_OPTICAL_COMP_DESCRIPTOR,
  TubeOpticalComp,
  VCA_BUS_COMP_DESCRIPTOR,
  VcaBusComp,
} from './compressors';
import {
  MIDRANGE_SCULPTOR_EQ_DESCRIPTOR,
  MidrangeSculptorEq,
  PASSIVE_PROGRAM_EQ_DESCRIPTOR,
  PREAMP_EQ_DESCRIPTOR,
  PROPORTIONAL_Q_EQ_DESCRIPTOR,
  PassiveProgramEq,
  PreampEq,
  ProportionalQEq,
  TEN_BAND_GRAPHIC_EQ_DESCRIPTOR,
  TenBandGraphicEq,
} from './equalizers';
import {
  MASTERING_TAPE_RECORDER_DESCRIPTOR,
  MULTITRACK_TAPE_DECK_DESCRIPTOR,
  MasteringTapeRecorder,
  MultitrackTapeDeck,
} from './tape';
import { STEREO_DELAY_DESCRIPTOR, STUDIO_REVERB_DESCRIPTOR, StereoDelay, StudioReverb } from './spatial';
import {
  GAIN_STAGING_UTILITY_DESCRIPTOR,
  GainStagingUtility,
  MASTER_LIMITER_DESCRIPTOR,
  MasterLimiter,
} from './utilities';

export interface PluginRegistryEntry {
  id: PluginId;
  descriptor: PluginDescriptor;
  create: (env: AudioEnv, instanceId?: string) => BaseDawPlugin;
}

function entry(descriptor: PluginDescriptor, create: PluginRegistryEntry['create']): PluginRegistryEntry {
  return { id: descriptor.id, descriptor, create };
}

/** Display order for a plugin-browser. */
export const PLUGIN_CATEGORIES: readonly PluginCategory[] = ['Compressors', 'Equalizers', 'Tape Machines', 'Spatial', 'Utilities'];

/**
 * Central catalog grouped by category: bind your Ableton-style left-hand plugin browser to this.
 * Each entry carries a full `PluginDescriptor` (parameters with min/max/default/unit/curve + presets), so knobs and
 * sliders can be auto-rendered for any module.
 */
export const PLUGIN_REGISTRY: Readonly<Record<PluginCategory, readonly PluginRegistryEntry[]>> = {
  Compressors: [
    entry(OPTICAL_COMP_DESCRIPTOR, (e, i) => new OpticalComp(e, i)),
    entry(TUBE_OPTICAL_COMP_DESCRIPTOR, (e, i) => new TubeOpticalComp(e, i)),
    entry(VCA_BUS_COMP_DESCRIPTOR, (e, i) => new VcaBusComp(e, i)),
    entry(FET_COMP_DESCRIPTOR, (e, i) => new FetComp(e, i)),
    entry(STEREO_VARI_MU_COMP_DESCRIPTOR, (e, i) => new StereoVariMuComp(e, i)),
  ],
  Equalizers: [
    entry(PREAMP_EQ_DESCRIPTOR, (e, i) => new PreampEq(e, i)),
    entry(PROPORTIONAL_Q_EQ_DESCRIPTOR, (e, i) => new ProportionalQEq(e, i)),
    entry(TEN_BAND_GRAPHIC_EQ_DESCRIPTOR, (e, i) => new TenBandGraphicEq(e, i)),
    entry(PASSIVE_PROGRAM_EQ_DESCRIPTOR, (e, i) => new PassiveProgramEq(e, i)),
    entry(MIDRANGE_SCULPTOR_EQ_DESCRIPTOR, (e, i) => new MidrangeSculptorEq(e, i)),
  ],
  'Tape Machines': [
    entry(MULTITRACK_TAPE_DECK_DESCRIPTOR, (e, i) => new MultitrackTapeDeck(e, i)),
    entry(MASTERING_TAPE_RECORDER_DESCRIPTOR, (e, i) => new MasteringTapeRecorder(e, i)),
  ],
  Spatial: [
    entry(STUDIO_REVERB_DESCRIPTOR, (e, i) => new StudioReverb(e, i)),
    entry(STEREO_DELAY_DESCRIPTOR, (e, i) => new StereoDelay(e, i)),
  ],
  Utilities: [
    entry(GAIN_STAGING_UTILITY_DESCRIPTOR, (e, i) => new GainStagingUtility(e, i)),
    entry(MASTER_LIMITER_DESCRIPTOR, (e, i) => new MasterLimiter(e, i)),
  ],
};

/** Flat list of every registry entry (16 modules). */
export const PLUGIN_LIST: readonly PluginRegistryEntry[] = PLUGIN_CATEGORIES.flatMap((c) => PLUGIN_REGISTRY[c]);

const BY_ID = new Map<PluginId, PluginRegistryEntry>(PLUGIN_LIST.map((e) => [e.id, e]));

export function isPluginId(id: unknown): id is PluginId {
  return typeof id === 'string' && BY_ID.has(id as PluginId);
}

export function getPluginDescriptor(id: PluginId): PluginDescriptor {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`Unknown plugin id "${String(id)}"`);
  return e.descriptor;
}

/** Instantiate a plugin and (optionally) restore saved state instantly. */
export function createPlugin(id: PluginId, env: AudioEnv, state?: Partial<PluginState>): BaseDawPlugin {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`Unknown plugin id "${String(id)}"`);
  const plugin = e.create(env, state?.instanceId);
  if (state) plugin.restoreState(state);
  return plugin;
}

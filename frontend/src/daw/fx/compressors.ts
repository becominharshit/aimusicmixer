import type { PluginDescriptor } from '../types';
import type { AudioEnv } from '../engine/audioEnv';
import { dbToGain } from '../utils/dsp';
import { BaseDawPlugin } from './BaseDawPlugin';
import { WorkletDynamics } from './DynamicsStage';
import { DriveStage, type GraphEnds, biquad, choice, gainNode, preset, pr, serial, toggle } from './kit';
import { RAMP_TC_S } from '../constants';

/**
 * Five compressors. All of them sit on the same `mlx-dynamics` AudioWorklet core (log-domain, soft-knee,
 * program-dependent release, stereo link / Mid-Side) and differ in detector, timing laws, colour stages and controls.
 */

// ===========================================================================
// 1. OpticalComp : smooth, program-dependent optical leveling
// ===========================================================================

export const OPTICAL_COMP_DESCRIPTOR: PluginDescriptor = {
  id: 'optical-comp',
  name: 'Optical Comp',
  category: 'Compressors',
  description: 'Smooth, program-dependent optical leveling amplifier. One Peak Reduction control, gentle two-stage release.',
  hasGainReduction: true,
  latencyMs: 0,
  params: [
    pr('peakReduction', 'Peak Reduction', 0, 100, 40, 'none', 'linear', { decimals: 0 }),
    pr('makeup', 'Gain', -12, 24, 0, 'dB', 'linear', { decimals: 1 }),
    choice('mode', 'Mode', ['Compress', 'Limit'], 0),
    pr('sidechainHpf', 'Sidechain HPF', 20, 400, 20, 'Hz', 'log', { decimals: 0, group: 'Sidechain' }),
    pr('mix', 'Mix', 0, 100, 100, '%', 'linear', { decimals: 0 }),
  ],
  presets: [
    preset('vocal-leveler', 'Vocal Leveler', { peakReduction: 45, makeup: 3, mode: 0, sidechainHpf: 80 }),
    preset('bass-control', 'Bass Control', { peakReduction: 55, makeup: 4, mode: 0, sidechainHpf: 20 }),
    preset('gentle-bus', 'Gentle Bus', { peakReduction: 22, makeup: 1, mode: 0, sidechainHpf: 100 }),
    preset('limit-smash', 'Limit Smash', { peakReduction: 70, makeup: 5, mode: 1, sidechainHpf: 60, mix: 60 }),
  ],
};

export class OpticalComp extends BaseDawPlugin {
  private dyn!: WorkletDynamics;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, OPTICAL_COMP_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    this.dyn = new WorkletDynamics(this.env, 'mlx-dynamics');
    return { head: this.dyn.node, tail: this.dyn.node };
  }

  protected applyParams(): void {
    const d = this.dyn;
    const limit = this.val('mode') >= 0.5;
    const thr = -2 - this.val('peakReduction') * 0.38;
    this.set(d.p('threshold'), thr);
    this.set(d.p('threshold2'), thr);
    this.set(d.p('ratio'), limit ? 12 : 3);
    this.set(d.p('knee'), limit ? 8 : 18);
    this.set(d.p('attack'), 10);
    this.set(d.p('release'), 150);
    this.set(d.p('adaptive'), 1);
    this.set(d.p('detector'), 2);
    this.set(d.p('link'), 1);
    this.set(d.p('ms'), 0);
    this.set(d.p('makeup'), this.val('makeup'));
    this.set(d.p('mix'), this.val('mix') / 100);
    this.set(d.p('scHpf'), this.val('sidechainHpf'));
  }

  override getGainReductionDb(): number {
    return this.dyn.getGainReductionDb();
  }

  protected override onDispose(): void {
    this.dyn.dispose();
  }
}

// ===========================================================================
// 2. TubeOpticalComp : tube harmonic stage + optical compression
// ===========================================================================

export const TUBE_OPTICAL_COMP_DESCRIPTOR: PluginDescriptor = {
  id: 'tube-optical-comp',
  name: 'Tube Optical Comp',
  category: 'Compressors',
  description: 'Warm triode-style WaveShaper stage ahead of a smooth optical compressor. Even-harmonic colour plus leveling.',
  hasGainReduction: true,
  latencyMs: 0,
  params: [
    pr('drive', 'Tube Drive', 0, 100, 30, '%', 'linear', { decimals: 0, group: 'Tube' }),
    pr('warmth', 'Warmth', 0, 100, 40, '%', 'linear', { decimals: 0, group: 'Tube' }),
    pr('peakReduction', 'Peak Reduction', 0, 100, 40, 'none', 'linear', { decimals: 0, group: 'Compressor' }),
    pr('makeup', 'Gain', -12, 24, 0, 'dB', 'linear', { decimals: 1, group: 'Compressor' }),
    choice('mode', 'Mode', ['Compress', 'Limit'], 0, 'Compressor'),
    pr('mix', 'Mix', 0, 100, 100, '%', 'linear', { decimals: 0 }),
  ],
  presets: [
    preset('warm-vocal', 'Warm Vocal', { drive: 35, warmth: 50, peakReduction: 42, makeup: 3 }),
    preset('fat-bass', 'Fat Bass', { drive: 50, warmth: 65, peakReduction: 50, makeup: 4 }),
    preset('mix-bus-glow', 'Mix Bus Glow', { drive: 20, warmth: 30, peakReduction: 20, makeup: 1 }),
    preset('crunchy-drums', 'Crunchy Drums', { drive: 70, warmth: 40, peakReduction: 55, makeup: 3, mode: 1, mix: 70 }),
  ],
};

export class TubeOpticalComp extends BaseDawPlugin {
  private dyn!: WorkletDynamics;
  private tube!: DriveStage;
  private lowShelf!: BiquadFilterNode;
  private highShelf!: BiquadFilterNode;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, TUBE_OPTICAL_COMP_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    const ctx = this.ctx;
    this.tube = new DriveStage(this.env, 'tube', 15, 0.6);
    this.lowShelf = biquad(ctx, 'lowshelf', 120);
    this.highShelf = biquad(ctx, 'highshelf', 9000);
    this.dyn = new WorkletDynamics(this.env, 'mlx-dynamics');
    const rest = serial(this.tube.output, this.lowShelf, this.highShelf, this.dyn.node);
    return { head: this.tube.input, tail: rest.tail };
  }

  protected applyParams(): void {
    const d = this.dyn;
    const limit = this.val('mode') >= 0.5;
    const warmth = this.val('warmth') / 100;
    this.tube.setAmount(this.val('drive') / 100, this.initializing);
    this.set(this.lowShelf.gain, warmth * 3);
    this.set(this.highShelf.gain, -warmth * 2);
    const thr = -2 - this.val('peakReduction') * 0.38;
    this.set(d.p('threshold'), thr);
    this.set(d.p('threshold2'), thr);
    this.set(d.p('ratio'), limit ? 12 : 3);
    this.set(d.p('knee'), limit ? 8 : 18);
    this.set(d.p('attack'), 10);
    this.set(d.p('release'), 150);
    this.set(d.p('adaptive'), 1);
    this.set(d.p('detector'), 2);
    this.set(d.p('link'), 1);
    this.set(d.p('ms'), 0);
    this.set(d.p('makeup'), this.val('makeup'));
    this.set(d.p('mix'), this.val('mix') / 100);
    this.set(d.p('scHpf'), 60);
  }

  override getGainReductionDb(): number {
    return this.dyn.getGainReductionDb();
  }

  protected override onDispose(): void {
    this.dyn.dispose();
  }
}

// ===========================================================================
// 3. VcaBusComp : bus glue
// ===========================================================================

export const VCA_BUS_COMP_DESCRIPTOR: PluginDescriptor = {
  id: 'vca-bus-comp',
  name: 'VCA Bus Comp',
  category: 'Compressors',
  description: 'Clean, punchy VCA-style bus compressor for glue. RMS-ish detector, stereo-linked, parallel mix.',
  hasGainReduction: true,
  latencyMs: 0,
  params: [
    pr('threshold', 'Threshold', -40, 0, -14, 'dB', 'linear', { decimals: 1 }),
    pr('ratio', 'Ratio', 1.1, 20, 2, 'ratio', 'log', { decimals: 1 }),
    pr('attack', 'Attack', 0.1, 100, 10, 'ms', 'log', { decimals: 1 }),
    pr('release', 'Release', 30, 1200, 300, 'ms', 'log', { decimals: 0 }),
    toggle('autoRelease', 'Auto Release', false),
    pr('scHpf', 'Sidechain HPF', 20, 300, 60, 'Hz', 'log', { decimals: 0, group: 'Sidechain' }),
    pr('knee', 'Knee', 0, 12, 3, 'dB', 'linear', { decimals: 1 }),
    pr('makeup', 'Makeup', 0, 24, 2, 'dB', 'linear', { decimals: 1 }),
    pr('mix', 'Mix', 0, 100, 100, '%', 'linear', { decimals: 0 }),
  ],
  presets: [
    preset('mix-glue-2-1', 'Mix Glue 2:1', { threshold: -14, ratio: 2, attack: 30, release: 300, autoRelease: 1, makeup: 2 }),
    preset('drum-bus-punch', 'Drum Bus Punch', { threshold: -18, ratio: 4, attack: 10, release: 150, makeup: 4, scHpf: 90 }),
    preset('master-subtle', 'Master Subtle', { threshold: -10, ratio: 1.5, attack: 30, release: 200, autoRelease: 1, makeup: 1 }),
    preset('parallel-smash', 'Parallel Smash', { threshold: -28, ratio: 10, attack: 3, release: 120, makeup: 8, mix: 35 }),
    preset('vocal-bus', 'Vocal Bus', { threshold: -16, ratio: 3, attack: 15, release: 250, makeup: 3, scHpf: 120 }),
  ],
};

export class VcaBusComp extends BaseDawPlugin {
  private dyn!: WorkletDynamics;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, VCA_BUS_COMP_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    this.dyn = new WorkletDynamics(this.env, 'mlx-dynamics');
    return { head: this.dyn.node, tail: this.dyn.node };
  }

  protected applyParams(): void {
    const d = this.dyn;
    this.set(d.p('threshold'), this.val('threshold'));
    this.set(d.p('threshold2'), this.val('threshold'));
    this.set(d.p('ratio'), this.val('ratio'));
    this.set(d.p('attack'), this.val('attack'));
    this.set(d.p('release'), this.val('release'));
    this.set(d.p('knee'), this.val('knee'));
    this.set(d.p('makeup'), this.val('makeup'));
    this.set(d.p('mix'), this.val('mix') / 100);
    this.set(d.p('detector'), 1);
    this.set(d.p('link'), 1);
    this.set(d.p('ms'), 0);
    this.set(d.p('adaptive'), this.val('autoRelease') >= 0.5 ? 0.5 : 0);
    this.set(d.p('scHpf'), this.val('scHpf'));
  }

  override getGainReductionDb(): number {
    return this.dyn.getGainReductionDb();
  }

  protected override onDispose(): void {
    this.dyn.dispose();
  }
}

// ===========================================================================
// 4. FetComp : fast 1176-style
// ===========================================================================

const FET_RATIOS = [4, 8, 12, 20];

export const FET_COMP_DESCRIPTOR: PluginDescriptor = {
  id: 'fet-comp',
  name: 'FET Comp',
  category: 'Compressors',
  description: 'Fast FET-style compressor with fixed threshold: drive the Input to compress harder. 4 ratios, 2 circuit modes.',
  hasGainReduction: true,
  latencyMs: 0,
  params: [
    pr('input', 'Input', 0, 36, 12, 'dB', 'linear', { decimals: 1 }),
    pr('output', 'Output', -24, 12, 0, 'dB', 'linear', { decimals: 1 }),
    pr('attack', 'Attack', 0.02, 0.8, 0.2, 'ms', 'log', { decimals: 2 }),
    pr('release', 'Release', 50, 1100, 250, 'ms', 'log', { decimals: 0 }),
    choice('ratio', 'Ratio', ['4:1', '8:1', '12:1', '20:1'], 0),
    choice('mode', 'Circuit', ['Classic', 'Modern'], 0),
    pr('mix', 'Mix', 0, 100, 100, '%', 'linear', { decimals: 0 }),
  ],
  presets: [
    preset('vocal-grab', 'Vocal Grab', { input: 14, output: -2, attack: 0.3, release: 200, ratio: 0, mode: 0 }),
    preset('drum-room-smash', 'Drum Room Smash', { input: 26, output: -6, attack: 0.5, release: 120, ratio: 3, mode: 0, mix: 45 }),
    preset('bass-tamer', 'Bass Tamer', { input: 12, output: 0, attack: 0.4, release: 300, ratio: 1, mode: 1 }),
    preset('snare-snap', 'Snare Snap', { input: 18, output: -3, attack: 0.8, release: 100, ratio: 1, mode: 1 }),
  ],
};

export class FetComp extends BaseDawPlugin {
  private dyn!: WorkletDynamics;
  private inGain!: GainNode;
  private outGain!: GainNode;
  private colour!: DriveStage;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, FET_COMP_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    this.inGain = gainNode(this.ctx);
    this.dyn = new WorkletDynamics(this.env, 'mlx-dynamics');
    this.colour = new DriveStage(this.env, 'soft', 9, 0.4);
    this.outGain = gainNode(this.ctx);
    serial(this.inGain, this.dyn.node, this.colour.input);
    this.colour.output.connect(this.outGain);
    return { head: this.inGain, tail: this.outGain };
  }

  protected applyParams(): void {
    const d = this.dyn;
    const classic = this.val('mode') < 0.5;
    const ratio = FET_RATIOS[Math.round(this.val('ratio'))] ?? 4;
    this.set(this.inGain.gain, dbToGain(this.val('input')), RAMP_TC_S);
    this.set(this.outGain.gain, dbToGain(this.val('output')), RAMP_TC_S);
    this.set(d.p('threshold'), -12);
    this.set(d.p('threshold2'), -12);
    this.set(d.p('ratio'), ratio);
    this.set(d.p('knee'), classic ? 6 : 1);
    this.set(d.p('attack'), this.val('attack'));
    this.set(d.p('release'), this.val('release'));
    this.set(d.p('adaptive'), classic ? 0.35 : 0);
    this.set(d.p('detector'), 0);
    this.set(d.p('link'), 1);
    this.set(d.p('ms'), 0);
    this.set(d.p('makeup'), 0);
    this.set(d.p('mix'), this.val('mix') / 100);
    this.set(d.p('scHpf'), classic ? 90 : 20);
    this.colour.setAmount(classic ? 0.3 : 0, this.initializing);
  }

  override getGainReductionDb(): number {
    return this.dyn.getGainReductionDb();
  }

  protected override onDispose(): void {
    this.dyn.dispose();
  }
}

// ===========================================================================
// 5. StereoVariMuComp : L/R linked or Mid/Side independent
// ===========================================================================

export const STEREO_VARI_MU_COMP_DESCRIPTOR: PluginDescriptor = {
  id: 'stereo-vari-mu-comp',
  name: 'Stereo Vari-Mu Comp',
  category: 'Compressors',
  description:
    'Gentle variable-mu style stereo compressor with a very wide knee and tube colour. Run it L/R-linked, or Mid/Side with independent thresholds.',
  hasGainReduction: true,
  latencyMs: 0,
  params: [
    choice('mode', 'Stereo Mode', ['L/R Linked', 'Mid/Side'], 0),
    pr('threshold', 'Threshold (L/R or Mid)', -40, 0, -16, 'dB', 'linear', { decimals: 1 }),
    pr('sideThreshold', 'Side Threshold', -40, 0, -16, 'dB', 'linear', { decimals: 1 }),
    pr('ratio', 'Ratio', 1.5, 8, 2.5, 'ratio', 'log', { decimals: 1 }),
    pr('attack', 'Attack', 0.2, 60, 8, 'ms', 'log', { decimals: 1 }),
    pr('release', 'Release', 50, 2000, 500, 'ms', 'log', { decimals: 0 }),
    pr('makeup', 'Makeup', 0, 24, 2, 'dB', 'linear', { decimals: 1 }),
    pr('colour', 'Tube Colour', 0, 100, 25, '%', 'linear', { decimals: 0 }),
    pr('mix', 'Mix', 0, 100, 100, '%', 'linear', { decimals: 0 }),
  ],
  presets: [
    preset('mastering-glue', 'Mastering Glue', { mode: 0, threshold: -14, sideThreshold: -14, ratio: 2, attack: 12, release: 600, makeup: 2, colour: 20 }),
    preset('ms-widen-control', 'M/S Width Control', { mode: 1, threshold: -12, sideThreshold: -20, ratio: 2.5, attack: 10, release: 500, makeup: 2 }),
    preset('tame-the-sides', 'Tame The Sides', { mode: 1, threshold: -8, sideThreshold: -24, ratio: 3, attack: 6, release: 400, makeup: 1 }),
    preset('mix-bus-warmth', 'Mix Bus Warmth', { mode: 0, threshold: -18, sideThreshold: -18, ratio: 3, attack: 8, release: 450, makeup: 3, colour: 45 }),
  ],
};

export class StereoVariMuComp extends BaseDawPlugin {
  private dyn!: WorkletDynamics;
  private colour!: DriveStage;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, STEREO_VARI_MU_COMP_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    this.dyn = new WorkletDynamics(this.env, 'mlx-dynamics');
    this.colour = new DriveStage(this.env, 'tube', 9, 0.8);
    this.dyn.node.connect(this.colour.input);
    return { head: this.dyn.node, tail: this.colour.output };
  }

  protected applyParams(): void {
    const d = this.dyn;
    const ms = this.val('mode') >= 0.5;
    this.set(d.p('ms'), ms ? 1 : 0);
    this.set(d.p('link'), ms ? 0 : 1);
    this.set(d.p('threshold'), this.val('threshold'));
    this.set(d.p('threshold2'), ms ? this.val('sideThreshold') : this.val('threshold'));
    this.set(d.p('ratio'), this.val('ratio'));
    this.set(d.p('knee'), 20);
    this.set(d.p('attack'), this.val('attack'));
    this.set(d.p('release'), this.val('release'));
    this.set(d.p('adaptive'), 0.4);
    this.set(d.p('detector'), 1);
    this.set(d.p('makeup'), this.val('makeup'));
    this.set(d.p('mix'), this.val('mix') / 100);
    this.set(d.p('scHpf'), 30);
    this.colour.setAmount(this.val('colour') / 100, this.initializing);
  }

  override getGainReductionDb(): number {
    return this.dyn.getGainReductionDb();
  }

  protected override onDispose(): void {
    this.dyn.dispose();
  }
}

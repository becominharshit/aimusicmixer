import type { PluginDescriptor } from '../types';
import type { AudioEnv } from '../engine/audioEnv';
import { RAMP_TC_S } from '../constants';
import { limiterLatencySec } from '../engine/workletSource';
import { dbToGain } from '../utils/dsp';
import { BaseDawPlugin } from './BaseDawPlugin';
import { WorkletDynamics } from './DynamicsStage';
import { type GraphEnds, gainNode, preset, pr, stereoNode, toggle } from './kit';

// ===========================================================================
// 13. GainStagingUtility : trim, phase, width, mono fold
// ===========================================================================

export const GAIN_STAGING_UTILITY_DESCRIPTOR: PluginDescriptor = {
  id: 'gain-staging-utility',
  name: 'Gain Staging Utility',
  category: 'Utilities',
  description: 'Trim in dB, polarity invert, stereo width (0-200 %) and mono fold for gain staging and mono-compatibility checks.',
  hasGainReduction: false,
  latencyMs: 0,
  params: [
    pr('trim', 'Trim', -24, 24, 0, 'dB', 'linear', { decimals: 1 }),
    toggle('phase', 'Phase Invert (Ø)'),
    pr('width', 'Stereo Width', 0, 200, 100, '%', 'linear', { decimals: 0 }),
    toggle('monoFold', 'Mono Fold'),
  ],
  presets: [
    preset('unity', 'Unity', {}),
    preset('mono-check', 'Mono Check', { monoFold: 1 }),
    preset('widen-20', 'Widen +20 %', { width: 120 }),
    preset('narrow-bass-bus', 'Narrow Bus', { width: 70 }),
    preset('flip-polarity', 'Flip Polarity', { phase: 1 }),
  ],
};

export class GainStagingUtility extends BaseDawPlugin {
  private ll!: GainNode;
  private rl!: GainNode;
  private lr!: GainNode;
  private rr!: GainNode;
  private polarity!: GainNode;
  private trim!: GainNode;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, GAIN_STAGING_UTILITY_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    const c = this.ctx;
    const head = stereoNode(c);
    const split = c.createChannelSplitter(2);
    const merge = c.createChannelMerger(2);
    this.ll = gainNode(c);
    this.rl = gainNode(c);
    this.lr = gainNode(c);
    this.rr = gainNode(c);
    head.connect(split);
    // L' = a*L + b*R, R' = b*L + a*R  with a = (1+w)/2, b = (1-w)/2   (Mid/Side width in one matrix)
    split.connect(this.ll, 0);
    split.connect(this.lr, 0);
    split.connect(this.rl, 1);
    split.connect(this.rr, 1);
    this.ll.connect(merge, 0, 0);
    this.rl.connect(merge, 0, 0);
    this.lr.connect(merge, 0, 1);
    this.rr.connect(merge, 0, 1);
    this.polarity = gainNode(c);
    this.trim = gainNode(c);
    merge.connect(this.polarity);
    this.polarity.connect(this.trim);
    return { head, tail: this.trim };
  }

  protected applyParams(): void {
    const mono = this.val('monoFold') >= 0.5;
    const w = mono ? 0 : this.val('width') / 100;
    const a = (1 + w) / 2;
    const b = (1 - w) / 2;
    this.set(this.ll.gain, a, RAMP_TC_S);
    this.set(this.rr.gain, a, RAMP_TC_S);
    this.set(this.rl.gain, b, RAMP_TC_S);
    this.set(this.lr.gain, b, RAMP_TC_S);
    this.set(this.polarity.gain, this.val('phase') >= 0.5 ? -1 : 1, RAMP_TC_S);
    this.set(this.trim.gain, dbToGain(this.val('trim')), RAMP_TC_S);
  }
}

// ===========================================================================
// 16. MasterLimiter : look-ahead true-peak-aware brickwall
// ===========================================================================

export const MASTER_LIMITER_DESCRIPTOR: PluginDescriptor = {
  id: 'master-limiter',
  name: 'Master Limiter',
  category: 'Utilities',
  description:
    'Look-ahead brickwall limiter with 4x inter-sample (true-peak estimate) detection. Output never exceeds the ceiling. 2 ms look-ahead.',
  hasGainReduction: true,
  latencyMs: 2,
  params: [
    pr('ceiling', 'Ceiling', -3, -0.1, -1, 'dB', 'linear', { decimals: 1, step: 0.1 }),
    pr('input', 'Input Drive', 0, 18, 0, 'dB', 'linear', { decimals: 1 }),
    pr('release', 'Release', 10, 1000, 100, 'ms', 'log', { decimals: 0 }),
  ],
  presets: [
    preset('transparent', 'Transparent', { ceiling: -1, input: 2, release: 200 }),
    preset('loud-streaming', 'Loud (Streaming)', { ceiling: -1, input: 6, release: 80 }),
    preset('safety-only', 'Safety Only', { ceiling: -0.3, input: 0, release: 150 }),
    preset('punchy-master', 'Punchy Master', { ceiling: -0.5, input: 4, release: 40 }),
  ],
};

export class MasterLimiter extends BaseDawPlugin {
  private drive!: GainNode;
  private lim!: WorkletDynamics;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, MASTER_LIMITER_DESCRIPTOR, instanceId);
    this.init();
  }

  protected override latencySec(): number {
    return limiterLatencySec(this.env.sampleRate);
  }

  protected buildGraph(): GraphEnds {
    this.drive = gainNode(this.ctx);
    this.lim = new WorkletDynamics(this.env, 'mlx-limiter');
    this.drive.connect(this.lim.node);
    return { head: this.drive, tail: this.lim.node };
  }

  protected applyParams(): void {
    this.set(this.drive.gain, dbToGain(this.val('input')), RAMP_TC_S);
    this.set(this.lim.p('ceiling'), this.val('ceiling'));
    this.set(this.lim.p('release'), this.val('release'));
  }

  override getGainReductionDb(): number {
    return this.lim.getGainReductionDb();
  }

  protected override onDispose(): void {
    this.lim.dispose();
  }
}

import type { PluginDescriptor } from '../types';
import type { AudioEnv } from '../engine/audioEnv';
import { RAMP_TC_S } from '../constants';
import { equalPowerMix } from '../utils/dsp';
import { BaseDawPlugin } from './BaseDawPlugin';
import { type ReverbType, generateImpulseResponse } from './ir';
import { type GraphEnds, biquad, choice, gainNode, preset, pr, safeFreq, stereoNode } from './kit';

// ===========================================================================
// 14. StudioReverb : ConvolverNode with procedurally generated IRs
// ===========================================================================

const REVERB_TYPES = ['Room', 'Plate', 'Hall'];

export const STUDIO_REVERB_DESCRIPTOR: PluginDescriptor = {
  id: 'studio-reverb',
  name: 'Studio Reverb',
  category: 'Spatial',
  description: 'Convolution reverb with generated Room / Plate / Hall impulse responses, pre-delay, damping and low-cut.',
  hasGainReduction: false,
  latencyMs: 0,
  params: [
    choice('type', 'Type', REVERB_TYPES, 1),
    pr('decay', 'Decay', 0.2, 6, 1.8, 's', 'log', { decimals: 2 }),
    pr('preDelay', 'Pre-Delay', 0, 200, 20, 'ms', 'linear', { decimals: 0 }),
    pr('damping', 'Damping', 0, 100, 35, '%', 'linear', { decimals: 0 }),
    pr('lowCut', 'Low Cut', 20, 600, 120, 'Hz', 'log', { decimals: 0 }),
    pr('mix', 'Mix', 0, 100, 30, '%', 'linear', { decimals: 0 }),
  ],
  presets: [
    preset('vocal-plate', 'Vocal Plate', { type: 1, decay: 1.6, preDelay: 25, damping: 30, lowCut: 150, mix: 100 }),
    preset('snare-room', 'Snare Room', { type: 0, decay: 0.6, preDelay: 5, damping: 45, lowCut: 200, mix: 100 }),
    preset('big-hall', 'Big Hall', { type: 2, decay: 3.8, preDelay: 40, damping: 50, lowCut: 180, mix: 100 }),
    preset('tight-ambience', 'Tight Ambience', { type: 0, decay: 0.35, preDelay: 0, damping: 55, lowCut: 250, mix: 25 }),
    preset('lush-master-air', 'Lush Master Air', { type: 1, decay: 2.2, preDelay: 30, damping: 55, lowCut: 300, mix: 8 }),
  ],
};

export class StudioReverb extends BaseDawPlugin {
  private preDelay!: DelayNode;
  private convA!: ConvolverNode;
  private convB!: ConvolverNode;
  private gateA!: GainNode;
  private gateB!: GainNode;
  private lowCut!: BiquadFilterNode;
  private damp!: BiquadFilterNode;
  private dryMix!: GainNode;
  private wetMix!: GainNode;
  private active: 'A' | 'B' = 'A';
  private loadedKey = '';
  private irTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, STUDIO_REVERB_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    const c = this.ctx;
    const head = stereoNode(c);
    const tail = stereoNode(c);
    this.dryMix = gainNode(c);
    this.wetMix = gainNode(c);
    this.preDelay = c.createDelay(0.5);
    this.convA = c.createConvolver();
    this.convB = c.createConvolver();
    this.gateA = gainNode(c, 1);
    this.gateB = gainNode(c, 0);
    this.lowCut = biquad(c, 'highpass', 120);
    this.damp = biquad(c, 'lowpass', 12000);

    head.connect(this.dryMix);
    this.dryMix.connect(tail);
    head.connect(this.preDelay);
    this.preDelay.connect(this.convA);
    this.preDelay.connect(this.convB);
    this.convA.connect(this.gateA);
    this.convB.connect(this.gateB);
    this.gateA.connect(this.lowCut);
    this.gateB.connect(this.lowCut);
    this.lowCut.connect(this.damp);
    this.damp.connect(this.wetMix);
    this.wetMix.connect(tail);
    return { head, tail };
  }

  protected applyParams(changedId?: string): void {
    const e = this.env;
    const { dry, wet } = equalPowerMix(this.val('mix') / 100);
    this.set(this.dryMix.gain, dry, RAMP_TC_S);
    this.set(this.wetMix.gain, wet, RAMP_TC_S);
    this.set(this.preDelay.delayTime, this.val('preDelay') / 1000, 0.03);
    // damping 0..100 % -> low-pass 20 kHz .. 1.5 kHz (exponential)
    const dampHz = 20000 * Math.pow(1500 / 20000, this.val('damping') / 100);
    this.set(this.damp.frequency, safeFreq(e, dampHz));
    this.set(this.lowCut.frequency, safeFreq(e, this.val('lowCut')));

    if (changedId === undefined || changedId === 'type' || changedId === 'decay') this.requestImpulse();
  }

  private requestImpulse(): void {
    const type = Math.round(this.val('type')) as ReverbType;
    // quantise decay so dragging the knob re-uses cached IRs
    const decay = Math.round(this.val('decay') * 10) / 10;
    const key = `${type}:${decay}:${this.env.sampleRate}`;
    if (key === this.loadedKey) return;
    if (this.irTimer) clearTimeout(this.irTimer);
    this.irTimer = null;
    if (this.initializing || this.env.offline || this.env.irCache.has(key)) {
      this.loadImpulse(key, type, decay);
    } else {
      // Debounce: generating a multi-second IR takes a few ms, so wait for the knob to settle.
      this.irTimer = setTimeout(() => {
        this.irTimer = null;
        this.loadImpulse(key, type, decay);
      }, 90);
    }
  }

  private loadImpulse(key: string, type: ReverbType, decay: number): void {
    let buffer = this.env.irCache.get(key);
    if (!buffer) {
      const ir = generateImpulseResponse(type, decay, this.env.sampleRate);
      buffer = this.ctx.createBuffer(2, ir.length, this.env.sampleRate);
      buffer.copyToChannel(ir.left, 0);
      buffer.copyToChannel(ir.right, 1);
      this.env.irCache.set(key, buffer);
    }
    const first = this.loadedKey === '' || this.initializing || this.env.offline;
    const target = first ? this.convA : this.active === 'A' ? this.convB : this.convA;
    target.buffer = buffer;
    if (first) {
      this.convB.buffer = buffer;
      this.active = 'A';
      this.gateA.gain.value = 1;
      this.gateB.gain.value = 0;
    } else {
      const toB = this.active === 'A';
      const now = this.ctx.currentTime;
      const up = toB ? this.gateB.gain : this.gateA.gain;
      const down = toB ? this.gateA.gain : this.gateB.gain;
      up.cancelScheduledValues(now);
      down.cancelScheduledValues(now);
      up.setTargetAtTime(1, now, 0.03);
      down.setTargetAtTime(0, now, 0.03);
      this.active = toB ? 'B' : 'A';
    }
    this.loadedKey = key;
  }

  protected override onDispose(): void {
    if (this.irTimer) clearTimeout(this.irTimer);
    this.irTimer = null;
  }
}

// ===========================================================================
// 15. StereoDelay : L/R and ping-pong
// ===========================================================================

export const STEREO_DELAY_DESCRIPTOR: PluginDescriptor = {
  id: 'stereo-delay',
  name: 'Stereo Delay',
  category: 'Spatial',
  description: 'Stereo (independent L/R) or ping-pong delay with feedback, high-pass / low-pass in the feedback loop and wet/dry mix.',
  hasGainReduction: false,
  latencyMs: 0,
  params: [
    choice('mode', 'Mode', ['Stereo', 'Ping-Pong'], 1),
    pr('timeL', 'Time L', 10, 2000, 375, 'ms', 'log', { decimals: 0 }),
    pr('timeR', 'Time R', 10, 2000, 500, 'ms', 'log', { decimals: 0 }),
    pr('feedback', 'Feedback', 0, 95, 35, '%', 'linear', { decimals: 0 }),
    pr('highPass', 'High-Pass', 20, 2000, 120, 'Hz', 'log', { decimals: 0 }),
    pr('lowPass', 'Low-Pass', 500, 20000, 6500, 'Hz', 'log', { decimals: 0 }),
    pr('mix', 'Mix', 0, 100, 30, '%', 'linear', { decimals: 0 }),
  ],
  presets: [
    preset('slapback', 'Slapback', { mode: 0, timeL: 90, timeR: 110, feedback: 12, lowPass: 5000, mix: 100 }),
    preset('quarter-ping-pong', 'Ping-Pong 1/4', { mode: 1, timeL: 375, feedback: 38, lowPass: 6000, mix: 100 }),
    preset('dotted-echo', 'Dotted Echo', { mode: 0, timeL: 375, timeR: 562, feedback: 40, highPass: 200, lowPass: 5500, mix: 100 }),
    preset('wide-ambient', 'Wide Ambient', { mode: 1, timeL: 520, feedback: 55, highPass: 250, lowPass: 4500, mix: 100 }),
  ],
};

export class StereoDelay extends BaseDawPlugin {
  private dL!: DelayNode;
  private dR!: DelayNode;
  private fbL!: GainNode;
  private fbR!: GainNode;
  private loopFilters: BiquadFilterNode[] = [];
  private ppL!: DelayNode;
  private ppR!: DelayNode;
  private ppFb!: GainNode;
  private stGate!: GainNode;
  private ppGate!: GainNode;
  private dryMix!: GainNode;
  private wetMix!: GainNode;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, STEREO_DELAY_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    const c = this.ctx;
    const head = stereoNode(c);
    const tail = stereoNode(c);
    this.dryMix = gainNode(c);
    this.wetMix = gainNode(c);
    this.stGate = stereoNode(c, 1);
    this.ppGate = stereoNode(c, 0);
    head.connect(this.dryMix);
    this.dryMix.connect(tail);

    const lpHp = () => {
      const hp = biquad(c, 'highpass', 120);
      const lp = biquad(c, 'lowpass', 6500);
      hp.connect(lp);
      this.loopFilters.push(hp, lp);
      return { hp, lp };
    };

    // --- independent stereo network
    const split = c.createChannelSplitter(2);
    const merge = c.createChannelMerger(2);
    head.connect(split);
    this.dL = c.createDelay(2);
    this.dR = c.createDelay(2);
    this.fbL = gainNode(c, 0.35);
    this.fbR = gainNode(c, 0.35);
    split.connect(this.dL, 0);
    split.connect(this.dR, 1);
    const fl = lpHp();
    const fr = lpHp();
    this.dL.connect(fl.hp);
    fl.lp.connect(this.fbL);
    this.fbL.connect(this.dL);
    this.dR.connect(fr.hp);
    fr.lp.connect(this.fbR);
    this.fbR.connect(this.dR);
    this.dL.connect(merge, 0, 0);
    this.dR.connect(merge, 0, 1);
    merge.connect(this.stGate);

    // --- ping-pong network: mono in -> L -> R -> feedback -> L
    const mono = gainNode(c);
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    mono.channelInterpretation = 'speakers';
    head.connect(mono);
    this.ppL = c.createDelay(2);
    this.ppR = c.createDelay(2);
    this.ppFb = gainNode(c, 0.35);
    const fp = lpHp();
    const ppMerge = c.createChannelMerger(2);
    mono.connect(this.ppL);
    this.ppL.connect(this.ppR);
    this.ppR.connect(fp.hp);
    fp.lp.connect(this.ppFb);
    this.ppFb.connect(this.ppL);
    this.ppL.connect(ppMerge, 0, 0);
    this.ppR.connect(ppMerge, 0, 1);
    ppMerge.connect(this.ppGate);

    this.stGate.connect(this.wetMix);
    this.ppGate.connect(this.wetMix);
    this.wetMix.connect(tail);
    return { head, tail };
  }

  protected applyParams(): void {
    const e = this.env;
    const pingPong = this.val('mode') >= 0.5;
    const fb = this.val('feedback') / 100;
    const tL = this.val('timeL') / 1000;
    const tR = this.val('timeR') / 1000;
    const { dry, wet } = equalPowerMix(this.val('mix') / 100);
    this.set(this.dryMix.gain, dry, RAMP_TC_S);
    this.set(this.wetMix.gain, wet, RAMP_TC_S);
    this.set(this.stGate.gain, pingPong ? 0 : 1, RAMP_TC_S);
    this.set(this.ppGate.gain, pingPong ? 1 : 0, RAMP_TC_S);
    this.set(this.dL.delayTime, tL, 0.03);
    this.set(this.dR.delayTime, tR, 0.03);
    this.set(this.ppL.delayTime, tL, 0.03);
    this.set(this.ppR.delayTime, tL, 0.03);
    this.set(this.fbL.gain, fb, RAMP_TC_S);
    this.set(this.fbR.gain, fb, RAMP_TC_S);
    this.set(this.ppFb.gain, fb, RAMP_TC_S);
    const hp = safeFreq(e, this.val('highPass'));
    const lp = safeFreq(e, this.val('lowPass'));
    for (let i = 0; i < this.loopFilters.length; i += 2) {
      this.set(this.loopFilters[i]!.frequency, hp);
      this.set(this.loopFilters[i + 1]!.frequency, lp);
    }
  }
}

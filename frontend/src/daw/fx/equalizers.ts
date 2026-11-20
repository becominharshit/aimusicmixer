import type { PluginDescriptor } from '../types';
import type { AudioEnv } from '../engine/audioEnv';
import { bandwidthToQ } from '../utils/dsp';
import { BaseDawPlugin } from './BaseDawPlugin';
import { DriveStage, type GraphEnds, biquad, choice, preset, pr, safeFreq, serial } from './kit';

/** Five equalizers built from chains of `BiquadFilterNode`s. */

const GAIN_RANGE = 15;

// ===========================================================================
// 6. PreampEq : HPF + 3-band musical shelf/bell + preamp drive
// ===========================================================================

export const PREAMP_EQ_DESCRIPTOR: PluginDescriptor = {
  id: 'preamp-eq',
  name: 'Preamp EQ',
  category: 'Equalizers',
  description: 'Console-style channel strip EQ: high-pass, low shelf, mid bell, high shelf, plus a transformer/preamp drive stage.',
  hasGainReduction: false,
  latencyMs: 0,
  params: [
    pr('drive', 'Preamp Drive', 0, 100, 0, '%', 'linear', { decimals: 0, group: 'Preamp' }),
    pr('hpf', 'High-Pass (20 = off)', 20, 400, 20, 'Hz', 'log', { decimals: 0, group: 'HPF' }),
    pr('lowFreq', 'Low Freq', 30, 400, 100, 'Hz', 'log', { decimals: 0, group: 'Low' }),
    pr('lowGain', 'Low Gain', -GAIN_RANGE, GAIN_RANGE, 0, 'dB', 'linear', { decimals: 1, group: 'Low' }),
    pr('midFreq', 'Mid Freq', 200, 8000, 1500, 'Hz', 'log', { decimals: 0, group: 'Mid' }),
    pr('midGain', 'Mid Gain', -GAIN_RANGE, GAIN_RANGE, 0, 'dB', 'linear', { decimals: 1, group: 'Mid' }),
    pr('midQ', 'Mid Q', 0.2, 4, 0.9, 'Q', 'log', { decimals: 2, group: 'Mid' }),
    pr('highFreq', 'High Freq', 2000, 16000, 8000, 'Hz', 'log', { decimals: 0, group: 'High' }),
    pr('highGain', 'High Gain', -GAIN_RANGE, GAIN_RANGE, 0, 'dB', 'linear', { decimals: 1, group: 'High' }),
  ],
  presets: [
    preset('vocal-air', 'Vocal Air', { hpf: 90, lowFreq: 120, lowGain: -1, midFreq: 3000, midGain: 2, highFreq: 12000, highGain: 3.5, drive: 15 }),
    preset('kick-weight', 'Kick Weight', { hpf: 30, lowFreq: 60, lowGain: 4, midFreq: 400, midGain: -3, midQ: 1.2, highFreq: 5000, highGain: 1.5, drive: 20 }),
    preset('clean-up-mud', 'Clean Up Mud', { hpf: 70, lowFreq: 200, lowGain: -2, midFreq: 350, midGain: -3, midQ: 1.4 }),
    preset('warm-tone', 'Warm Tone', { hpf: 40, lowFreq: 100, lowGain: 2, highFreq: 9000, highGain: -1.5, drive: 35 }),
  ],
};

export class PreampEq extends BaseDawPlugin {
  private drive!: DriveStage;
  private hpf!: BiquadFilterNode;
  private low!: BiquadFilterNode;
  private mid!: BiquadFilterNode;
  private high!: BiquadFilterNode;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, PREAMP_EQ_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    const ctx = this.ctx;
    this.drive = new DriveStage(this.env, 'tube', 18, 0.7);
    this.hpf = biquad(ctx, 'highpass', 1);
    this.low = biquad(ctx, 'lowshelf', 100);
    this.mid = biquad(ctx, 'peaking', 1500, 0.9);
    this.high = biquad(ctx, 'highshelf', 8000);
    const rest = serial(this.drive.output, this.hpf, this.low, this.mid, this.high);
    return { head: this.drive.input, tail: rest.tail };
  }

  protected applyParams(): void {
    const e = this.env;
    this.drive.setAmount(this.val('drive') / 100, this.initializing);
    const hpf = this.val('hpf');
    this.set(this.hpf.frequency, hpf <= 20 ? 1 : safeFreq(e, hpf));
    this.set(this.low.frequency, safeFreq(e, this.val('lowFreq')));
    this.set(this.low.gain, this.val('lowGain'));
    this.set(this.mid.frequency, safeFreq(e, this.val('midFreq')));
    this.set(this.mid.gain, this.val('midGain'));
    this.set(this.mid.Q, this.val('midQ'));
    this.set(this.high.frequency, safeFreq(e, this.val('highFreq')));
    this.set(this.high.gain, this.val('highGain'));
  }
}

// ===========================================================================
// 7. ProportionalQEq : Q narrows proportionally with boost/cut
// ===========================================================================

export const PROPORTIONAL_Q_EQ_DESCRIPTOR: PluginDescriptor = {
  id: 'proportional-q-eq',
  name: 'Proportional-Q EQ',
  category: 'Equalizers',
  description: '3-band EQ whose bandwidth automatically narrows as you boost or cut harder: subtle moves stay broad and musical.',
  hasGainReduction: false,
  latencyMs: 0,
  params: [
    pr('lowFreq', 'Low Freq', 30, 500, 100, 'Hz', 'log', { decimals: 0, group: 'Low' }),
    pr('lowGain', 'Low Gain', -GAIN_RANGE, GAIN_RANGE, 0, 'dB', 'linear', { decimals: 1, group: 'Low' }),
    pr('midFreq', 'Mid Freq', 200, 5000, 1000, 'Hz', 'log', { decimals: 0, group: 'Mid' }),
    pr('midGain', 'Mid Gain', -GAIN_RANGE, GAIN_RANGE, 0, 'dB', 'linear', { decimals: 1, group: 'Mid' }),
    pr('highFreq', 'High Freq', 2000, 16000, 8000, 'Hz', 'log', { decimals: 0, group: 'High' }),
    pr('highGain', 'High Gain', -GAIN_RANGE, GAIN_RANGE, 0, 'dB', 'linear', { decimals: 1, group: 'High' }),
    pr('baseQ', 'Base Q', 0.3, 2, 0.6, 'Q', 'log', { decimals: 2 }),
    pr('proportion', 'Proportion', 0, 100, 70, '%', 'linear', { decimals: 0 }),
  ],
  presets: [
    preset('broad-smile', 'Broad Smile', { lowFreq: 80, lowGain: 3, midFreq: 1000, midGain: -2, highFreq: 10000, highGain: 3 }),
    preset('mix-bus-tilt', 'Mix Bus Tilt', { lowFreq: 100, lowGain: 1.5, midFreq: 2000, midGain: 0, highFreq: 12000, highGain: 1.5, proportion: 40 }),
    preset('surgical-notch', 'Surgical Notch', { midFreq: 800, midGain: -9, baseQ: 1.2, proportion: 100 }),
    preset('presence-lift', 'Presence Lift', { midFreq: 3500, midGain: 3, highFreq: 12000, highGain: 2 }),
  ],
};

export class ProportionalQEq extends BaseDawPlugin {
  private bands: BiquadFilterNode[] = [];

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, PROPORTIONAL_Q_EQ_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    this.bands = [biquad(this.ctx, 'peaking', 100), biquad(this.ctx, 'peaking', 1000), biquad(this.ctx, 'peaking', 8000)];
    return serial(...this.bands);
  }

  protected applyParams(): void {
    const baseQ = this.val('baseQ');
    const prop = this.val('proportion') / 100;
    const names = ['low', 'mid', 'high'] as const;
    names.forEach((n, i) => {
      const band = this.bands[i]!;
      const gain = this.val(`${n}Gain`);
      // Q grows with |gain|: at full proportion and 15 dB the band is 3.5x narrower than at 0 dB.
      const q = baseQ * (1 + prop * (Math.abs(gain) / GAIN_RANGE) * 2.5);
      this.set(band.frequency, safeFreq(this.env, this.val(`${n}Freq`)));
      this.set(band.gain, gain);
      this.set(band.Q, q);
    });
  }
}

// ===========================================================================
// 8. TenBandGraphicEq
// ===========================================================================

export const GRAPHIC_BANDS_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
const GRAPHIC_IDS = ['g31', 'g62', 'g125', 'g250', 'g500', 'g1k', 'g2k', 'g4k', 'g8k', 'g16k'] as const;
const GRAPHIC_LABELS = ['31 Hz', '62 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', '8 kHz', '16 kHz'];

export const TEN_BAND_GRAPHIC_EQ_DESCRIPTOR: PluginDescriptor = {
  id: 'ten-band-graphic-eq',
  name: '10-Band Graphic EQ',
  category: 'Equalizers',
  description: 'Ten octave-spaced sliders from 31 Hz to 16 kHz, +/-12 dB.',
  hasGainReduction: false,
  latencyMs: 0,
  params: GRAPHIC_IDS.map((id, i) => pr(id, GRAPHIC_LABELS[i]!, -12, 12, 0, 'dB', 'linear', { decimals: 1, step: 0.5 })),
  presets: [
    preset('smile-curve', 'Smile Curve', { g31: 3, g62: 3.5, g125: 2, g250: -1, g500: -2, g1k: -1.5, g2k: 0, g4k: 1.5, g8k: 3, g16k: 3.5 }),
    preset('vocal-presence', 'Vocal Presence', { g125: -2, g250: -1, g1k: 1, g2k: 2.5, g4k: 3, g8k: 1.5 }),
    preset('low-end-cleanup', 'Low-End Clean-Up', { g31: -6, g62: -2, g125: 0, g250: -3.5, g500: -1 }),
    preset('air-lift', 'Air Lift', { g4k: 1, g8k: 3, g16k: 5 }),
    preset('flat', 'Flat', {}),
  ],
};

export class TenBandGraphicEq extends BaseDawPlugin {
  private bands: BiquadFilterNode[] = [];

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, TEN_BAND_GRAPHIC_EQ_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    this.bands = GRAPHIC_BANDS_HZ.map((f) => biquad(this.ctx, 'peaking', safeFreq(this.env, f), Math.SQRT2));
    return serial(...this.bands);
  }

  protected applyParams(): void {
    GRAPHIC_IDS.forEach((id, i) => this.set(this.bands[i]!.gain, this.val(id)));
  }
}

// ===========================================================================
// 9. PassiveProgramEq : Pultec-style simultaneous boost + attenuation
// ===========================================================================

const LOW_FREQS = [20, 30, 60, 100];
const HIGH_BOOST_FREQS = [3000, 4000, 5000, 8000, 10000, 12000, 16000];
const HIGH_ATTEN_FREQS = [5000, 10000, 20000];

export const PASSIVE_PROGRAM_EQ_DESCRIPTOR: PluginDescriptor = {
  id: 'passive-program-eq',
  name: 'Passive Program EQ',
  category: 'Equalizers',
  description:
    'Passive-style program EQ. Low boost and low attenuation work at the same frequency at the same time for the classic fat-but-tight low end. Broad high boost, high shelf cut, tube make-up stage.',
  hasGainReduction: false,
  latencyMs: 0,
  params: [
    choice('lowFreq', 'Low Freq (Hz)', LOW_FREQS.map(String), 2, 'Low'),
    pr('lowBoost', 'Low Boost', 0, 10, 0, 'none', 'linear', { decimals: 1, group: 'Low' }),
    pr('lowAtten', 'Low Atten', 0, 10, 0, 'none', 'linear', { decimals: 1, group: 'Low' }),
    choice('highBoostFreq', 'High Boost Freq (kHz)', HIGH_BOOST_FREQS.map((f) => String(f / 1000)), 3, 'High'),
    pr('highBoost', 'High Boost', 0, 10, 0, 'none', 'linear', { decimals: 1, group: 'High' }),
    pr('bandwidth', 'Bandwidth', 0, 10, 5, 'none', 'linear', { decimals: 1, group: 'High' }),
    choice('highAttenFreq', 'High Atten Freq (kHz)', HIGH_ATTEN_FREQS.map((f) => String(f / 1000)), 1, 'High'),
    pr('highAtten', 'High Atten', 0, 10, 0, 'none', 'linear', { decimals: 1, group: 'High' }),
    pr('tube', 'Tube Make-up', 0, 100, 0, '%', 'linear', { decimals: 0 }),
  ],
  presets: [
    preset('fat-kick-low-end', 'Fat Low End (boost + cut)', { lowFreq: 2, lowBoost: 6, lowAtten: 4 }),
    preset('silky-top', 'Silky Top', { highBoostFreq: 5, highBoost: 4, bandwidth: 7, highAtten: 1.5, highAttenFreq: 1 }),
    preset('master-sweetener', 'Master Sweetener', { lowFreq: 1, lowBoost: 2.5, lowAtten: 1.5, highBoostFreq: 6, highBoost: 3, bandwidth: 8, tube: 15 }),
    preset('vocal-sheen', 'Vocal Sheen', { highBoostFreq: 3, highBoost: 3.5, bandwidth: 4, tube: 20 }),
  ],
};

export class PassiveProgramEq extends BaseDawPlugin {
  private lowBoostShelf!: BiquadFilterNode;
  private lowBump!: BiquadFilterNode;
  private lowAttenShelf!: BiquadFilterNode;
  private highBell!: BiquadFilterNode;
  private highAttenShelf!: BiquadFilterNode;
  private tube!: DriveStage;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, PASSIVE_PROGRAM_EQ_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    const c = this.ctx;
    this.lowBoostShelf = biquad(c, 'lowshelf', 60);
    this.lowBump = biquad(c, 'peaking', 60, 0.8);
    this.lowAttenShelf = biquad(c, 'lowshelf', 120);
    this.highBell = biquad(c, 'peaking', 8000, 1);
    this.highAttenShelf = biquad(c, 'highshelf', 10000);
    this.tube = new DriveStage(this.env, 'tube', 6, 0.5);
    const rest = serial(this.lowBoostShelf, this.lowBump, this.lowAttenShelf, this.highBell, this.highAttenShelf, this.tube.input);
    return { head: rest.head, tail: this.tube.output };
  }

  protected applyParams(): void {
    const e = this.env;
    const lowF = LOW_FREQS[Math.round(this.val('lowFreq'))] ?? 60;
    const boost = this.val('lowBoost');
    const atten = this.val('lowAtten');
    // Boost shelf + a gentle resonant bump at the corner, attenuation shelf one octave higher:
    // net result is the classic "bump below, dip above" low-end shape.
    this.set(this.lowBoostShelf.frequency, safeFreq(e, lowF));
    this.set(this.lowBoostShelf.gain, boost * 1.35);
    this.set(this.lowBump.frequency, safeFreq(e, lowF * 1.1));
    this.set(this.lowBump.gain, boost * 0.3);
    this.set(this.lowAttenShelf.frequency, safeFreq(e, lowF * 2.2));
    this.set(this.lowAttenShelf.gain, -atten * 1.75);

    const hf = HIGH_BOOST_FREQS[Math.round(this.val('highBoostFreq'))] ?? 8000;
    const bw = this.val('bandwidth') / 10; // 0 = sharp, 1 = broad
    const q = 2.5 * Math.pow(0.4 / 2.5, bw);
    this.set(this.highBell.frequency, safeFreq(e, hf));
    this.set(this.highBell.Q, q);
    this.set(this.highBell.gain, this.val('highBoost') * 1.6);

    const af = HIGH_ATTEN_FREQS[Math.round(this.val('highAttenFreq'))] ?? 10000;
    this.set(this.highAttenShelf.frequency, safeFreq(e, af));
    this.set(this.highAttenShelf.gain, -this.val('highAtten') * 2);

    this.tube.setAmount(this.val('tube') / 100, this.initializing);
  }
}

// ===========================================================================
// 10. MidrangeSculptorEq : focused mid / presence bells with bandwidth control
// ===========================================================================

export const MIDRANGE_SCULPTOR_EQ_DESCRIPTOR: PluginDescriptor = {
  id: 'midrange-sculptor-eq',
  name: 'Midrange Sculptor EQ',
  category: 'Equalizers',
  description: 'Two focused bells, Mid (150 Hz-2.5 kHz) and Presence (2-9 kHz), each with its own bandwidth in octaves.',
  hasGainReduction: false,
  latencyMs: 0,
  params: [
    pr('midFreq', 'Mid Freq', 150, 2500, 600, 'Hz', 'log', { decimals: 0, group: 'Mid' }),
    pr('midGain', 'Mid Gain', -GAIN_RANGE, GAIN_RANGE, 0, 'dB', 'linear', { decimals: 1, group: 'Mid' }),
    pr('midBw', 'Mid Bandwidth', 0.2, 3, 1, 'oct', 'linear', { decimals: 2, group: 'Mid' }),
    pr('presFreq', 'Presence Freq', 2000, 9000, 4000, 'Hz', 'log', { decimals: 0, group: 'Presence' }),
    pr('presGain', 'Presence Gain', -GAIN_RANGE, GAIN_RANGE, 0, 'dB', 'linear', { decimals: 1, group: 'Presence' }),
    pr('presBw', 'Presence Bandwidth', 0.2, 3, 1, 'oct', 'linear', { decimals: 2, group: 'Presence' }),
  ],
  presets: [
    preset('remove-boxiness', 'Remove Boxiness', { midFreq: 350, midGain: -4, midBw: 0.8 }),
    preset('vocal-forward', 'Vocal Forward', { midFreq: 1000, midGain: 1.5, midBw: 1.4, presFreq: 3500, presGain: 3, presBw: 1.1 }),
    preset('guitar-bite', 'Guitar Bite', { midFreq: 800, midGain: -2, midBw: 1.5, presFreq: 4500, presGain: 3.5, presBw: 0.9 }),
    preset('de-harsh', 'De-Harsh', { presFreq: 3000, presGain: -4, presBw: 0.5 }),
  ],
};

export class MidrangeSculptorEq extends BaseDawPlugin {
  private mid!: BiquadFilterNode;
  private pres!: BiquadFilterNode;

  constructor(env: AudioEnv, instanceId?: string) {
    super(env, MIDRANGE_SCULPTOR_EQ_DESCRIPTOR, instanceId);
    this.init();
  }

  protected buildGraph(): GraphEnds {
    this.mid = biquad(this.ctx, 'peaking', 600);
    this.pres = biquad(this.ctx, 'peaking', 4000);
    return serial(this.mid, this.pres);
  }

  protected applyParams(): void {
    const e = this.env;
    this.set(this.mid.frequency, safeFreq(e, this.val('midFreq')));
    this.set(this.mid.gain, this.val('midGain'));
    this.set(this.mid.Q, bandwidthToQ(this.val('midBw')));
    this.set(this.pres.frequency, safeFreq(e, this.val('presFreq')));
    this.set(this.pres.gain, this.val('presGain'));
    this.set(this.pres.Q, bandwidthToQ(this.val('presBw')));
  }
}

import type { ChannelMeter, MasterState, PluginState, ProjectState, ReturnState, TrackState } from '../types';
import {
  CHAIN_MASTER,
  CHAIN_RETURN_A,
  CHAIN_RETURN_B,
  METER_FFT_SIZE,
  METER_FLOOR_DB,
  PARAM_TC_S,
  PEAK_FALL_DB_PER_S,
  PEAK_HOLD_MS,
  RAMP_TC_S,
} from '../constants';
import type { BaseDawPlugin } from '../fx/BaseDawPlugin';
import { gainNode, stereoNode } from '../fx/kit';
import { createPlugin } from '../fx/registry';
import { type F32, clamp, dbToGain, gainToDb } from '../utils/dsp';
import { type AudioEnv, setParam } from './audioEnv';

// ---------------------------------------------------------------------------
// Meter plumbing (zero allocation per read)
// ---------------------------------------------------------------------------

const scratch = { peak: 0, rms: 0 };

function measure(an: AnalyserNode, buf: F32): void {
  an.getFloatTimeDomainData(buf);
  let pk = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] as number;
    const a = v < 0 ? -v : v;
    if (a > pk) pk = a;
    sum += v * v;
  }
  scratch.peak = pk;
  scratch.rms = Math.sqrt(sum / buf.length);
}

/** Stereo peak / RMS / peak-hold tap (post-fader). */
export class StripMeter {
  private readonly split: ChannelSplitterNode;
  private readonly anL: AnalyserNode;
  private readonly anR: AnalyserNode;
  private holdL = METER_FLOOR_DB;
  private holdR = METER_FLOOR_DB;
  private holdAtL = 0;
  private holdAtR = 0;
  private lastTs = 0;

  constructor(env: AudioEnv, tap: AudioNode) {
    const c = env.ctx;
    this.split = c.createChannelSplitter(2);
    this.anL = c.createAnalyser();
    this.anR = c.createAnalyser();
    for (const a of [this.anL, this.anR]) {
      a.fftSize = METER_FFT_SIZE;
      a.smoothingTimeConstant = 0;
      a.connect(env.sink);
    }
    tap.connect(this.split);
    this.split.connect(this.anL, 0);
    this.split.connect(this.anR, 1);
  }

  read(out: ChannelMeter, buf: F32, now: number): void {
    const dt = this.lastTs === 0 ? 0 : (now - this.lastTs) / 1000;
    this.lastTs = now;

    measure(this.anL, buf);
    const pL = gainToDb(scratch.peak);
    out.peakL = pL;
    out.rmsL = gainToDb(scratch.rms);
    if (pL >= this.holdL) {
      this.holdL = pL;
      this.holdAtL = now;
    } else if (now - this.holdAtL > PEAK_HOLD_MS) {
      this.holdL = Math.max(pL, this.holdL - PEAK_FALL_DB_PER_S * dt);
    }
    out.peakHoldL = this.holdL;

    measure(this.anR, buf);
    const pR = gainToDb(scratch.peak);
    out.peakR = pR;
    out.rmsR = gainToDb(scratch.rms);
    if (pR >= this.holdR) {
      this.holdR = pR;
      this.holdAtR = now;
    } else if (now - this.holdAtR > PEAK_HOLD_MS) {
      this.holdR = Math.max(pR, this.holdR - PEAK_FALL_DB_PER_S * dt);
    }
    out.peakHoldR = this.holdR;
  }

  resetHold(): void {
    this.holdL = METER_FLOOR_DB;
    this.holdR = METER_FLOOR_DB;
  }

  dispose(): void {
    try {
      this.split.disconnect();
      this.anL.disconnect();
      this.anR.disconnect();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Ordered plugin chain
// ---------------------------------------------------------------------------

/** An ordered series of plugins between two unity gain nodes; re-wires itself when the order changes. */
export class PluginChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private plugins: BaseDawPlugin[] = [];
  private links: Array<[AudioNode, AudioNode]> = [];

  constructor(ctx: BaseAudioContext) {
    this.input = stereoNode(ctx);
    this.output = stereoNode(ctx);
    this.input.connect(this.output);
    this.links.push([this.input, this.output]);
  }

  list(): readonly BaseDawPlugin[] {
    return this.plugins;
  }

  find(instanceId: string): BaseDawPlugin | undefined {
    return this.plugins.find((p) => p.instanceId === instanceId);
  }

  indexOf(instanceId: string): number {
    return this.plugins.findIndex((p) => p.instanceId === instanceId);
  }

  insert(plugin: BaseDawPlugin, index: number): void {
    const i = clamp(index, 0, this.plugins.length);
    const next = this.plugins.slice();
    next.splice(i, 0, plugin);
    this.relink(next);
  }

  remove(instanceId: string): BaseDawPlugin | undefined {
    const i = this.indexOf(instanceId);
    if (i < 0) return undefined;
    const next = this.plugins.slice();
    const [removed] = next.splice(i, 1);
    this.relink(next);
    return removed;
  }

  move(instanceId: string, toIndex: number): boolean {
    const from = this.indexOf(instanceId);
    if (from < 0) return false;
    const next = this.plugins.slice();
    const [p] = next.splice(from, 1);
    next.splice(clamp(toIndex, 0, next.length), 0, p!);
    this.relink(next);
    return true;
  }

  private relink(next: BaseDawPlugin[]): void {
    for (const [a, b] of this.links) {
      try {
        a.disconnect(b);
      } catch {
        /* not connected */
      }
    }
    this.links = [];
    this.plugins = next;
    let prev: AudioNode = this.input;
    for (const p of next) {
      prev.connect(p.input);
      this.links.push([prev, p.input]);
      prev = p.output;
    }
    prev.connect(this.output);
    this.links.push([prev, this.output]);
  }

  /** Sum of positive gain reduction across every plugin in the chain. */
  getGainReductionDb(): number {
    let gr = 0;
    for (const p of this.plugins) if (p.descriptor.hasGainReduction) gr += p.getGainReductionDb();
    return gr;
  }

  dispose(): void {
    for (const p of this.plugins) p.dispose();
    this.plugins = [];
    for (const n of [this.input, this.output]) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Strips
// ---------------------------------------------------------------------------

export interface TrackStrip {
  id: string;
  /** Clips connect here. Carries input trim + polarity. */
  input: GainNode;
  chain: PluginChain;
  fader: GainNode;
  panner: StereoPannerNode;
  /** Mute / solo gate. */
  gate: GainNode;
  sendA: GainNode;
  sendB: GainNode;
  meter: StripMeter;
}

export interface ReturnStrip {
  id: 'returnA' | 'returnB';
  input: GainNode;
  chain: PluginChain;
  fader: GainNode;
  gate: GainNode;
  meter: StripMeter;
}

function buildPlugins(env: AudioEnv, chain: PluginChain, states: PluginState[]): void {
  states.forEach((s, i) => chain.insert(createPlugin(s.pluginId, env, s), i));
}

/**
 * The complete routing graph for one project, built against any `BaseAudioContext`
 * (live or offline):
 *
 *   Source -> Input Trim + Phase -> Insert FX Chain -> Fader -> Panner -> Mute/Solo gate ─┬─► Master In
 *                                                                                         ├─► Send A -> Return A (reverb) ─► Master In
 *                                                                                         └─► Send B -> Return B (delay)  ─► Master In
 *   Master In -> Master FX Chain -> Master Fader -> True-Peak Safety Limiter -> Meter -> Destination
 */
export class MixerGraph {
  readonly env: AudioEnv;
  readonly masterIn: GainNode;
  readonly masterChain: PluginChain;
  readonly masterFader: GainNode;
  readonly safety: BaseDawPlugin;
  readonly masterMeter: StripMeter;
  readonly returnA: ReturnStrip;
  readonly returnB: ReturnStrip;
  readonly strips = new Map<string, TrackStrip>();

  constructor(env: AudioEnv, state: ProjectState, destination: AudioNode) {
    this.env = env;
    const c = env.ctx;

    this.masterIn = stereoNode(c);
    this.masterChain = new PluginChain(c);
    this.masterFader = gainNode(c);
    this.safety = createPlugin('master-limiter', env, state.master.limiter);
    const masterOut = stereoNode(c);
    this.masterIn.connect(this.masterChain.input);
    this.masterChain.output.connect(this.masterFader);
    this.masterFader.connect(this.safety.input);
    this.safety.output.connect(masterOut);
    masterOut.connect(destination);
    this.masterMeter = new StripMeter(env, masterOut);
    buildPlugins(env, this.masterChain, state.master.inserts);

    this.returnA = this.buildReturn(state.returnA);
    this.returnB = this.buildReturn(state.returnB);

    for (const t of state.tracks) this.addTrack(t);
    this.syncMixer(state);
  }

  private buildReturn(state: ReturnState): ReturnStrip {
    const c = this.env.ctx;
    const input = stereoNode(c);
    const chain = new PluginChain(c);
    const fader = gainNode(c);
    const gate = gainNode(c);
    input.connect(chain.input);
    chain.output.connect(fader);
    fader.connect(gate);
    gate.connect(this.masterIn);
    const meter = new StripMeter(this.env, gate);
    buildPlugins(this.env, chain, state.inserts);
    return { id: state.id, input, chain, fader, gate, meter };
  }

  addTrack(track: TrackState): TrackStrip {
    const c = this.env.ctx;
    const input = stereoNode(c);
    const chain = new PluginChain(c);
    const fader = gainNode(c);
    const panner = c.createStereoPanner();
    const gate = gainNode(c);
    const sendA = gainNode(c, 0);
    const sendB = gainNode(c, 0);
    input.connect(chain.input);
    chain.output.connect(fader);
    fader.connect(panner);
    panner.connect(gate);
    gate.connect(this.masterIn);
    gate.connect(sendA);
    gate.connect(sendB);
    sendA.connect(this.returnA.input);
    sendB.connect(this.returnB.input);
    const meter = new StripMeter(this.env, gate);
    buildPlugins(this.env, chain, track.inserts);
    const strip: TrackStrip = { id: track.id, input, chain, fader, panner, gate, sendA, sendB, meter };
    this.strips.set(track.id, strip);
    return strip;
  }

  removeTrack(id: string): void {
    const s = this.strips.get(id);
    if (!s) return;
    this.strips.delete(id);
    s.meter.dispose();
    s.chain.dispose();
    for (const n of [s.input, s.fader, s.panner, s.gate, s.sendA, s.sendB]) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  getChain(chainId: string): PluginChain | undefined {
    if (chainId === CHAIN_MASTER) return this.masterChain;
    if (chainId === CHAIN_RETURN_A) return this.returnA.chain;
    if (chainId === CHAIN_RETURN_B) return this.returnB.chain;
    return this.strips.get(chainId)?.chain;
  }

  // ---- mixer parameter sync ------------------------------------------------

  private set(p: AudioParam, v: number, tc: number, immediate: boolean): void {
    setParam(this.env, p, v, tc, immediate);
  }

  /** Applies fader/pan/mute/solo/sends/trim/phase for one track. `anySolo` is the project-wide solo state. */
  syncTrack(track: TrackState, anySolo: boolean, immediate = false): void {
    const s = this.strips.get(track.id);
    if (!s) return;
    const audible = !track.mute && (!anySolo || track.solo);
    this.set(s.input.gain, dbToGain(track.inputGainDb) * (track.phaseInvert ? -1 : 1), RAMP_TC_S, immediate);
    this.set(s.fader.gain, dbToGain(track.faderDb), PARAM_TC_S, immediate);
    this.set(s.panner.pan, clamp(track.pan, -1, 1), PARAM_TC_S, immediate);
    this.set(s.gate.gain, audible ? 1 : 0, RAMP_TC_S, immediate);
    this.set(s.sendA.gain, clamp(track.sendA, 0, 1), PARAM_TC_S, immediate);
    this.set(s.sendB.gain, clamp(track.sendB, 0, 1), PARAM_TC_S, immediate);
  }

  syncReturn(r: ReturnState, immediate = false): void {
    const strip = r.id === 'returnA' ? this.returnA : this.returnB;
    this.set(strip.fader.gain, dbToGain(r.faderDb), PARAM_TC_S, immediate);
    this.set(strip.gate.gain, r.mute ? 0 : 1, RAMP_TC_S, immediate);
  }

  syncMaster(m: MasterState, immediate = false): void {
    this.set(this.masterFader.gain, dbToGain(m.faderDb), PARAM_TC_S, immediate);
  }

  /** Re-applies every mixer value (needed whenever solo changes, since it affects other tracks). */
  syncMixer(state: ProjectState, immediate = false): void {
    const anySolo = state.tracks.some((t) => t.solo);
    for (const t of state.tracks) this.syncTrack(t, anySolo, immediate);
    this.syncReturn(state.returnA, immediate);
    this.syncReturn(state.returnB, immediate);
    this.syncMaster(state.master, immediate);
  }

  dispose(): void {
    for (const id of Array.from(this.strips.keys())) this.removeTrack(id);
    for (const r of [this.returnA, this.returnB]) {
      r.meter.dispose();
      r.chain.dispose();
      for (const n of [r.input, r.fader, r.gate]) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    }
    this.masterMeter.dispose();
    this.masterChain.dispose();
    this.safety.dispose();
    for (const n of [this.masterIn, this.masterFader]) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

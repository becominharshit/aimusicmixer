import type { AbSlot, DawAudioPlugin, ParamDescriptor, PluginDescriptor, PluginId, PluginState } from '../types';
import { METER_FLOOR_DB, RAMP_TC_S, TRIM_MAX_DB, TRIM_MIN_DB } from '../constants';
import { type AudioEnv, setParam } from '../engine/audioEnv';
import { type F32, clamp, dbToGain, gainToDb } from '../utils/dsp';
import { uid } from '../utils/ids';
import { type GraphEnds, clampParam, gainNode, stereoNode } from './kit';

/**
 * Shared "pro" wrapper around every module.
 *
 *   input ─┬─► inTrim ─► [ plugin graph ] ─► outTrim ─► procGain ─┬─► output
 *          └─► (latency delay) ─► dryGain ───────────────────────┘
 *
 *  - bypass      : procGain -> 0, dryGain -> +1 (bit-exact dry path, time-aligned)
 *  - deltaListen : procGain -> +1, dryGain -> -1 (phase-inverted dry cancels the unchanged signal,
 *                  so only the processed delta is audible)
 *  - every gain change is a 15 ms exponential ramp, so toggling never clicks
 *
 * Subclasses implement `buildGraph()` and `applyParams()` and call `this.init()` last in their constructor.
 */
export abstract class BaseDawPlugin implements DawAudioPlugin {
  readonly instanceId: string;
  readonly descriptor: PluginDescriptor;
  readonly input: GainNode;
  readonly output: GainNode;

  protected readonly env: AudioEnv;
  protected readonly ctx: BaseAudioContext;
  /** True while the graph is being constructed or state is being restored: params are written instantly. */
  protected initializing = true;

  private readonly inTrim: GainNode;
  private readonly outTrim: GainNode;
  private readonly procGain: GainNode;
  private readonly dryGain: GainNode;
  private readonly paramMap = new Map<string, ParamDescriptor>();
  private slots: Record<AbSlot, Record<string, number>> = { A: {}, B: {} };
  private ab: AbSlot = 'A';
  private isBypassed = false;
  private isDelta = false;
  private inTrimDb = 0;
  private outTrimDb = 0;
  private presetId: string | null = null;
  private vu: { analyser: AnalyserNode; buf: F32 } | null = null;

  protected constructor(env: AudioEnv, descriptor: PluginDescriptor, instanceId?: string) {
    this.env = env;
    this.ctx = env.ctx;
    this.descriptor = descriptor;
    this.instanceId = instanceId ?? uid();
    for (const p of descriptor.params) {
      this.paramMap.set(p.id, p);
      this.slots.A[p.id] = p.default;
      this.slots.B[p.id] = p.default;
    }
    this.input = stereoNode(env.ctx);
    this.output = stereoNode(env.ctx);
    this.inTrim = gainNode(env.ctx);
    this.outTrim = gainNode(env.ctx);
    this.procGain = gainNode(env.ctx, 1);
    this.dryGain = gainNode(env.ctx, 0);
  }

  // ---- subclass contract ---------------------------------------------------

  /** Create the processing nodes and return the first/last. Called once from `init()`. */
  protected abstract buildGraph(): GraphEnds;
  /** Push the active slot's parameter values into the audio graph with `this.set(...)`. */
  protected abstract applyParams(changedId?: string): void;
  /** Processing latency in seconds so the dry path can be time-aligned. */
  protected latencySec(): number {
    return 0;
  }
  /** Release timers etc. */
  protected onDispose(): void {}

  // ---- lifecycle -----------------------------------------------------------

  protected init(): void {
    const { head, tail } = this.buildGraph();
    this.input.connect(this.inTrim);
    this.inTrim.connect(head);
    tail.connect(this.outTrim);
    this.outTrim.connect(this.procGain);
    this.procGain.connect(this.output);

    const latency = this.latencySec();
    if (latency > 0) {
      const d = this.ctx.createDelay(Math.max(0.05, latency * 2));
      d.delayTime.value = latency;
      this.input.connect(d);
      d.connect(this.dryGain);
    } else {
      this.input.connect(this.dryGain);
    }
    this.dryGain.connect(this.output);

    this.applyAll();
    this.initializing = false;
  }

  protected set(param: AudioParam, value: number, tc?: number): void {
    setParam(this.env, param, value, tc, this.initializing);
  }

  /** Current value of a parameter in the active A/B slot. */
  protected val(id: string): number {
    const v = this.slots[this.ab][id];
    if (v === undefined) throw new Error(`${this.descriptor.id}: unknown parameter "${id}"`);
    return v;
  }

  private applyAll(): void {
    this.applyParams();
    this.set(this.inTrim.gain, dbToGain(this.inTrimDb), RAMP_TC_S);
    this.set(this.outTrim.gain, dbToGain(this.outTrimDb), RAMP_TC_S);
    this.updateRouting();
  }

  private updateRouting(): void {
    const bypass = this.isBypassed;
    const delta = this.isDelta && !bypass;
    this.set(this.procGain.gain, bypass ? 0 : 1, RAMP_TC_S);
    this.set(this.dryGain.gain, bypass ? 1 : delta ? -1 : 0, RAMP_TC_S);
  }

  // ---- bypass / delta / trims ---------------------------------------------

  get bypass(): boolean {
    return this.isBypassed;
  }
  setBypass(bypass: boolean): void {
    this.isBypassed = bypass;
    this.updateRouting();
  }

  get deltaListen(): boolean {
    return this.isDelta;
  }
  setDeltaListen(enabled: boolean): void {
    this.isDelta = enabled;
    this.updateRouting();
  }

  get inputTrimDb(): number {
    return this.inTrimDb;
  }
  setInputTrimDb(db: number): number {
    this.inTrimDb = Number.isFinite(db) ? clamp(db, TRIM_MIN_DB, TRIM_MAX_DB) : 0;
    this.set(this.inTrim.gain, dbToGain(this.inTrimDb), RAMP_TC_S);
    return this.inTrimDb;
  }

  get outputTrimDb(): number {
    return this.outTrimDb;
  }
  setOutputTrimDb(db: number): number {
    this.outTrimDb = Number.isFinite(db) ? clamp(db, TRIM_MIN_DB, TRIM_MAX_DB) : 0;
    this.set(this.outTrim.gain, dbToGain(this.outTrimDb), RAMP_TC_S);
    return this.outTrimDb;
  }

  // ---- A/B -----------------------------------------------------------------

  get abSlot(): AbSlot {
    return this.ab;
  }
  setAbSlot(slot: AbSlot): void {
    if (slot === this.ab) return;
    this.ab = slot;
    this.presetId = null;
    this.applyParams();
  }
  toggleAB(): AbSlot {
    this.setAbSlot(this.ab === 'A' ? 'B' : 'A');
    return this.ab;
  }
  copyAToB(): void {
    this.slots.B = { ...this.slots.A };
    if (this.ab === 'B') this.applyParams();
  }
  copyBToA(): void {
    this.slots.A = { ...this.slots.B };
    if (this.ab === 'A') this.applyParams();
  }

  // ---- parameters & presets -------------------------------------------------

  getParam(id: string): number {
    return this.val(id);
  }
  getParams(): Record<string, number> {
    return { ...this.slots[this.ab] };
  }
  setParam(id: string, value: number): number {
    const d = this.paramMap.get(id);
    if (!d) throw new Error(`${this.descriptor.id}: unknown parameter "${id}"`);
    const v = clampParam(d, value);
    this.slots[this.ab][id] = v;
    this.presetId = null;
    this.applyParams(id);
    return v;
  }
  loadPreset(presetId: string): boolean {
    const preset = this.descriptor.presets.find((p) => p.id === presetId);
    if (!preset) return false;
    const next: Record<string, number> = {};
    for (const d of this.descriptor.params) {
      const raw = preset.values[d.id];
      next[d.id] = raw === undefined ? d.default : clampParam(d, raw);
    }
    this.slots[this.ab] = next;
    this.presetId = presetId;
    this.applyParams();
    return true;
  }

  // ---- metering ------------------------------------------------------------

  getGainReductionDb(): number {
    return 0;
  }

  getVuLevelDb(): number {
    if (!this.vu) {
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      this.output.connect(analyser);
      analyser.connect(this.env.sink);
      this.vu = { analyser, buf: new Float32Array(1024) };
      return METER_FLOOR_DB;
    }
    const { analyser, buf } = this.vu;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] as number;
      sum += v * v;
    }
    return gainToDb(Math.sqrt(sum / buf.length));
  }

  // ---- state ---------------------------------------------------------------

  getState(): PluginState {
    return {
      instanceId: this.instanceId,
      pluginId: this.descriptor.id as PluginId,
      bypass: this.isBypassed,
      deltaListen: this.isDelta,
      inputTrimDb: this.inTrimDb,
      outputTrimDb: this.outTrimDb,
      abSlot: this.ab,
      paramsA: { ...this.slots.A },
      paramsB: { ...this.slots.B },
      presetId: this.presetId,
    };
  }

  setState(state: Partial<PluginState>): void {
    const sanitize = (raw: Record<string, number> | undefined): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const d of this.descriptor.params) {
        const v = raw?.[d.id];
        out[d.id] = typeof v === 'number' ? clampParam(d, v) : d.default;
      }
      return out;
    };
    if (state.paramsA) this.slots.A = sanitize(state.paramsA);
    if (state.paramsB) this.slots.B = sanitize(state.paramsB);
    if (state.abSlot === 'A' || state.abSlot === 'B') this.ab = state.abSlot;
    if (typeof state.bypass === 'boolean') this.isBypassed = state.bypass;
    if (typeof state.deltaListen === 'boolean') this.isDelta = state.deltaListen;
    if (typeof state.inputTrimDb === 'number') this.inTrimDb = clamp(state.inputTrimDb, TRIM_MIN_DB, TRIM_MAX_DB);
    if (typeof state.outputTrimDb === 'number') this.outTrimDb = clamp(state.outputTrimDb, TRIM_MIN_DB, TRIM_MAX_DB);
    if (state.presetId !== undefined) this.presetId = state.presetId;
    this.applyAll();
  }

  /** Like `setState`, but writes every value instantly (no ramps). Used when (re)building a graph from saved state. */
  restoreState(state: Partial<PluginState>): void {
    const was = this.initializing;
    this.initializing = true;
    try {
      this.setState(state);
    } finally {
      this.initializing = was;
    }
  }

  dispose(): void {
    this.onDispose();
    for (const n of [this.input, this.output, this.inTrim, this.outTrim, this.procGain, this.dryGain]) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    if (this.vu) {
      try {
        this.vu.analyser.disconnect();
      } catch {
        /* ignore */
      }
      this.vu = null;
    }
  }
}

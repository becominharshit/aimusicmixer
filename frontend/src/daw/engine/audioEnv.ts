import { PARAM_TC_S } from '../constants';
import { DAW_WORKLET_SOURCE } from './workletSource';

/**
 * Everything a plugin or the mixer graph needs to build nodes in a given context.
 * The same graph code runs against a live `AudioContext` and an `OfflineAudioContext`.
 */
export interface AudioEnv {
  readonly ctx: BaseAudioContext;
  /** True for `OfflineAudioContext`: parameter changes are applied instantly (no ramps from node defaults). */
  readonly offline: boolean;
  readonly sampleRate: number;
  /** A silent (gain 0) node connected to the destination. Analysers feed it so they are always pulled. */
  readonly sink: GainNode;
  /** Generated impulse responses, keyed by type/decay/sampleRate. */
  readonly irCache: Map<string, AudioBuffer>;
}

export function createAudioEnv(ctx: BaseAudioContext, offline: boolean): AudioEnv {
  const sink = ctx.createGain();
  sink.gain.value = 0;
  sink.connect(ctx.destination);
  return { ctx, offline, sampleRate: ctx.sampleRate, sink, irCache: new Map() };
}

/**
 * Smooth parameter change: cancels pending automation and eases to `value` with an exponential
 * `setTargetAtTime` ramp. In offline contexts, or when `immediate` is set (node construction), the value is
 * written directly so nothing ramps from the node default.
 */
export function setParam(env: AudioEnv, param: AudioParam, value: number, tc: number = PARAM_TC_S, immediate = false): void {
  if (!Number.isFinite(value)) return;
  if (immediate || env.offline) {
    param.value = value;
    return;
  }
  const t = env.ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setTargetAtTime(value, t, tc);
}

// ---------------------------------------------------------------------------
// Worklet loading
// ---------------------------------------------------------------------------

export interface WorkletConfig {
  /** URL of a static file containing `DAW_WORKLET_SOURCE` (use when CSP forbids `blob:` URLs). */
  moduleUrl?: string;
  /** Fully custom loader (used by the Node test-suite). Receives the processor source. */
  loader?: (ctx: BaseAudioContext, source: string) => Promise<void>;
}

let workletConfig: WorkletConfig = {};
const loadedContexts = new WeakSet<BaseAudioContext>();

export function configureWorklets(config: WorkletConfig): void {
  workletConfig = { ...config };
}

export class DawWorkletUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DawWorkletUnavailableError';
  }
}

/** Registers the dynamics + limiter processors on a context. Safe to call repeatedly. */
export async function ensureWorklets(ctx: BaseAudioContext): Promise<void> {
  if (loadedContexts.has(ctx)) return;
  if (workletConfig.loader) {
    await workletConfig.loader(ctx, DAW_WORKLET_SOURCE);
    loadedContexts.add(ctx);
    return;
  }
  const worklet = (ctx as { audioWorklet?: AudioWorklet }).audioWorklet;
  if (!worklet) {
    throw new DawWorkletUnavailableError(
      'AudioWorklet is not available. It requires a secure context (https:// or localhost) and a modern browser.',
    );
  }
  if (workletConfig.moduleUrl) {
    await worklet.addModule(workletConfig.moduleUrl);
  } else {
    const blob = new Blob([DAW_WORKLET_SOURCE], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await worklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  loadedContexts.add(ctx);
}

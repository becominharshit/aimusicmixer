import type { AudioEnv } from '../engine/audioEnv';

/**
 * Thin wrapper around the `mlx-dynamics` / `mlx-limiter` AudioWorkletNodes.
 * Output 0 is audio, output 1 is a mono control signal carrying gain reduction in positive dB,
 * which we read through an AnalyserNode into a pre-allocated buffer (no allocation per read).
 */
export class WorkletDynamics {
  readonly node: AudioWorkletNode;
  private readonly analyser: AnalyserNode;
  private readonly buf = new Float32Array(32);

  constructor(env: AudioEnv, processor: 'mlx-dynamics' | 'mlx-limiter') {
    this.node = new AudioWorkletNode(env.ctx, processor, {
      numberOfInputs: 1,
      numberOfOutputs: 2,
      outputChannelCount: [2, 1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.analyser = env.ctx.createAnalyser();
    this.analyser.fftSize = 32;
    this.analyser.smoothingTimeConstant = 0;
    this.node.connect(this.analyser, 1);
    this.analyser.connect(env.sink);
  }

  p(name: string): AudioParam {
    const p = this.node.parameters.get(name);
    if (!p) throw new Error(`Worklet parameter "${name}" does not exist`);
    return p;
  }

  /** Positive dB of gain reduction (mean of the last 32 samples). */
  getGainReductionDb(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] as number;
    const gr = sum / this.buf.length;
    return gr > 0 && Number.isFinite(gr) ? gr : 0;
  }

  dispose(): void {
    try {
      this.node.disconnect();
      this.analyser.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/**
 * AudioWorklet DSP, shipped as a string so the package needs no bundler plugin.
 * It is loaded through a Blob URL (see `worklets.ts`). If your CSP forbids `blob:` workers,
 * write `DAW_WORKLET_SOURCE` to a static file and call `configureWorklets({ moduleUrl })`.
 *
 * IMPORTANT: this string must not contain backticks or `${`.
 *
 * Processors
 * ----------
 * mlx-dynamics : feed-forward log-domain compressor.
 *   - detector: 0 peak, 1 RMS (10 ms), 2 optical-style RMS (30 ms)
 *   - soft knee (Giannoulis gain computer), attack/release smoothing in the dB domain
 *   - program-dependent ("adaptive") release that lengthens with gain-reduction depth
 *   - stereo link 0..1 and L/R or Mid/Side operation, sidechain HPF, parallel mix
 *   - output 1 carries gain reduction (positive dB) as a control signal for zero-allocation readout
 *
 * mlx-limiter : look-ahead brickwall limiter.
 *   - 4x inter-sample (true-peak estimate) detection using Catmull-Rom interpolation
 *   - 2 ms look-ahead, window-minimum + boxcar smoothing (guarantees no overshoot), exponential release
 *   - hard clamp at the ceiling as a last line of defence
 *   - output 1 carries gain reduction (positive dB)
 */
export const DAW_WORKLET_SOURCE = String.raw`
'use strict';

function mlxGainComputer(lvl, thr, invR, knee) {
  var over = lvl - thr;
  if (knee <= 0) return over > 0 ? over * (1 - invR) : 0;
  var hk = knee * 0.5;
  if (over < -hk) return 0;
  if (over > hk) return over * (1 - invR);
  var x = over + hk;
  return (1 - invR) * x * x / (2 * knee);
}

class MlxDynamics extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    var k = 'k-rate';
    return [
      { name: 'threshold',  defaultValue: -18, minValue: -80,  maxValue: 0,    automationRate: k },
      { name: 'threshold2', defaultValue: -18, minValue: -80,  maxValue: 0,    automationRate: k },
      { name: 'ratio',      defaultValue: 4,   minValue: 1,    maxValue: 100,  automationRate: k },
      { name: 'attack',     defaultValue: 10,  minValue: 0.01, maxValue: 500,  automationRate: k },
      { name: 'release',    defaultValue: 100, minValue: 1,    maxValue: 5000, automationRate: k },
      { name: 'knee',       defaultValue: 6,   minValue: 0,    maxValue: 40,   automationRate: k },
      { name: 'makeup',     defaultValue: 0,   minValue: -24,  maxValue: 48,   automationRate: k },
      { name: 'mix',        defaultValue: 1,   minValue: 0,    maxValue: 1,    automationRate: k },
      { name: 'detector',   defaultValue: 0,   minValue: 0,    maxValue: 2,    automationRate: k },
      { name: 'link',       defaultValue: 1,   minValue: 0,    maxValue: 1,    automationRate: k },
      { name: 'ms',         defaultValue: 0,   minValue: 0,    maxValue: 1,    automationRate: k },
      { name: 'adaptive',   defaultValue: 0,   minValue: 0,    maxValue: 1,    automationRate: k },
      { name: 'scHpf',      defaultValue: 20,  minValue: 1,    maxValue: 2000, automationRate: k }
    ];
  }

  constructor() {
    super();
    this.msq = new Float64Array(2);
    this.gr = new Float64Array(2);
    this.hx = new Float64Array(2);
    this.hy = new Float64Array(2);
  }

  process(inputs, outputs, p) {
    var input = inputs[0];
    var output = outputs[0];
    var grOut = outputs[1];
    if (!output || output.length === 0) return true;
    var n = output[0].length;
    if (!input || input.length === 0) {
      this.gr[0] = 0; this.gr[1] = 0;
      return true;
    }
    var inL = input[0];
    var inR = input.length > 1 ? input[1] : input[0];
    var outL = output[0];
    var outR = output.length > 1 ? output[1] : output[0];
    var grBuf = grOut && grOut.length > 0 ? grOut[0] : null;

    var th0 = p.threshold[0], th1 = p.threshold2[0];
    var ratio = p.ratio[0], att = p.attack[0], rel = p.release[0], knee = p.knee[0];
    var mk = p.makeup[0], mix = p.mix[0];
    var det = Math.round(p.detector[0]);
    var link = p.link[0];
    var msMode = p.ms[0] >= 0.5;
    var adaptive = p.adaptive[0];
    var hpf = p.scHpf[0];

    var sr = sampleRate;
    var atkC = Math.exp(-1 / (0.001 * att * sr));
    var relSamples = 0.001 * rel * sr;
    var relC = Math.exp(-1 / relSamples);
    var rmsTc = det === 2 ? 0.030 : 0.010;
    var rmsC = 1 - Math.exp(-1 / (rmsTc * sr));
    var useHp = hpf > 20;
    var hpA = useHp ? Math.exp(-2 * Math.PI * hpf / sr) : 0;
    var invR = 1 / ratio;

    var msq = this.msq, gr = this.gr, hx = this.hx, hy = this.hy;

    for (var i = 0; i < n; i++) {
      var l = inL[i], r = inR[i];
      var a, b;
      if (msMode) { a = 0.5 * (l + r); b = 0.5 * (l - r); } else { a = l; b = r; }

      var sa = a, sb = b;
      if (useHp) {
        sa = hpA * (hy[0] + a - hx[0]); hx[0] = a; hy[0] = sa;
        sb = hpA * (hy[1] + b - hx[1]); hx[1] = b; hy[1] = sb;
      }

      var la, lb;
      if (det === 0) {
        la = sa < 0 ? -sa : sa;
        lb = sb < 0 ? -sb : sb;
      } else {
        msq[0] += (sa * sa - msq[0]) * rmsC;
        msq[1] += (sb * sb - msq[1]) * rmsC;
        if (msq[0] < 1e-20) msq[0] = 0;
        if (msq[1] < 1e-20) msq[1] = 0;
        la = Math.sqrt(msq[0]);
        lb = Math.sqrt(msq[1]);
      }
      var da = 20 * Math.log10(la + 1e-9);
      var dbb = 20 * Math.log10(lb + 1e-9);
      if (link > 0) {
        var mx = da > dbb ? da : dbb;
        da += (mx - da) * link;
        dbb += (mx - dbb) * link;
      }

      var ta = mlxGainComputer(da, th0, invR, knee);
      var tb = mlxGainComputer(dbb, th1, invR, knee);

      var g0 = gr[0];
      if (ta > g0) { g0 = ta + (g0 - ta) * atkC; }
      else {
        var rc = relC;
        if (adaptive > 0) {
          var depth = g0 * 0.1; if (depth > 1) depth = 1;
          rc = Math.exp(-1 / (relSamples * (1 + adaptive * 7 * depth)));
        }
        g0 = ta + (g0 - ta) * rc;
      }
      var g1 = gr[1];
      if (tb > g1) { g1 = tb + (g1 - tb) * atkC; }
      else {
        var rc2 = relC;
        if (adaptive > 0) {
          var depth2 = g1 * 0.1; if (depth2 > 1) depth2 = 1;
          rc2 = Math.exp(-1 / (relSamples * (1 + adaptive * 7 * depth2)));
        }
        g1 = tb + (g1 - tb) * rc2;
      }
      if (!(g0 === g0) || !(g1 === g1)) { g0 = 0; g1 = 0; msq[0] = 0; msq[1] = 0; }
      gr[0] = g0; gr[1] = g1;

      var wa = a * Math.pow(10, (mk - g0) * 0.05);
      var wb = b * Math.pow(10, (mk - g1) * 0.05);
      var wl, wr;
      if (msMode) { wl = wa + wb; wr = wa - wb; } else { wl = wa; wr = wb; }
      var yl = l + (wl - l) * mix;
      var yr = r + (wr - r) * mix;
      outL[i] = yl === yl ? yl : 0;
      outR[i] = yr === yr ? yr : 0;
      if (grBuf) grBuf[i] = g0 > g1 ? g0 : g1;
    }
    return true;
  }
}
registerProcessor('mlx-dynamics', MlxDynamics);

var MLX_T1 = [0.25, 0.5, 0.75];

class MlxLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    var k = 'k-rate';
    return [
      { name: 'ceiling', defaultValue: -1,  minValue: -24, maxValue: 0,    automationRate: k },
      { name: 'release', defaultValue: 100, minValue: 1,   maxValue: 2000, automationRate: k }
    ];
  }

  constructor() {
    super();
    var L = Math.max(2, Math.round(0.002 * sampleRate));
    this.L = L;
    this.dl0 = new Float32Array(L);
    this.dl1 = new Float32Array(L);
    this.hist = new Float32Array(4);
    this.reqRing = new Float32Array(L).fill(1);
    this.minRing = new Float32Array(L).fill(1);
    this.w = 0;
    this.g = 1;
  }

  process(inputs, outputs, p) {
    var input = inputs[0];
    var output = outputs[0];
    var grOut = outputs[1];
    if (!output || output.length === 0) return true;
    var n = output[0].length;
    var hasIn = input && input.length > 0;
    var inL = hasIn ? input[0] : null;
    var inR = hasIn ? (input.length > 1 ? input[1] : input[0]) : null;
    var outL = output[0];
    var outR = output.length > 1 ? output[1] : output[0];

    var c = Math.pow(10, p.ceiling[0] / 20);
    var relC = Math.exp(-1 / (0.001 * p.release[0] * sampleRate));
    var L = this.L, w = this.w, g = this.g;
    var dl0 = this.dl0, dl1 = this.dl1, hist = this.hist, req = this.reqRing, mr = this.minRing;
    var gmin = 1;

    for (var i = 0; i < n; i++) {
      var x0 = inL ? inL[i] : 0;
      var x1 = inR ? inR[i] : 0;

      // --- true-peak estimate: sample peak + 4x Catmull-Rom inter-sample points
      var pk = x0 < 0 ? -x0 : x0;
      var ax1 = x1 < 0 ? -x1 : x1;
      if (ax1 > pk) pk = ax1;
      for (var ch = 0; ch < 2; ch++) {
        var x = ch === 0 ? x0 : x1;
        var h0 = hist[ch * 2], h1 = hist[ch * 2 + 1];
        var p3 = 2 * x - h1;
        for (var k = 0; k < 3; k++) {
          var t = MLX_T1[k], t2 = t * t, t3 = t2 * t;
          var v = 0.5 * ((2 * h1) + (x - h0) * t + (2 * h0 - 5 * h1 + 4 * x - p3) * t2 + (3 * h1 - h0 - 3 * x + p3) * t3);
          var av = v < 0 ? -v : v;
          if (av > pk) pk = av;
        }
        hist[ch * 2] = h1;
        hist[ch * 2 + 1] = x;
      }

      var rq = pk > c ? c / pk : 1;
      req[w] = rq;
      var m = 1;
      for (var j = 0; j < L; j++) { if (req[j] < m) m = req[j]; }
      mr[w] = m;
      var sum = 0;
      for (var q = 0; q < L; q++) sum += mr[q];
      var s = sum / L;

      if (s < g) g = s; else g = g + (s - g) * (1 - relC);
      if (g < gmin) gmin = g;

      dl0[w] = x0; dl1[w] = x1;
      var rp = w + 1; if (rp >= L) rp = 0;
      var y0 = dl0[rp] * g, y1 = dl1[rp] * g;
      if (y0 > c) y0 = c; else if (y0 < -c) y0 = -c;
      if (y1 > c) y1 = c; else if (y1 < -c) y1 = -c;
      outL[i] = y0;
      outR[i] = y1;

      w++; if (w >= L) w = 0;
    }
    this.w = w; this.g = g;
    if (grOut && grOut.length > 0) {
      var grDb = gmin < 1 ? -20 * Math.log10(gmin) : 0;
      grOut[0].fill(grDb);
    }
    return true;
  }
}
registerProcessor('mlx-limiter', MlxLimiter);
`;

/** Look-ahead (in seconds) of the limiter at a given sample rate: (L - 1) / sampleRate, matching the worklet. */
export function limiterLatencySec(sampleRate: number): number {
  const L = Math.max(2, Math.round(0.002 * sampleRate));
  return (L - 1) / sampleRate;
}

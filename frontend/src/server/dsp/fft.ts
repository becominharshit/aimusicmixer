/**
 * Zero-dependency Radix-2 Cooley-Tukey FFT, ENBW-normalized Welch PSD, STFT, and resampling utilities.
 */

export function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function hannWindow(length: number): Float64Array {
  const win = new Float64Array(length);
  if (length <= 1) {
    if (length === 1) win[0] = 1;
    return win;
  }
  const denom = length - 1;
  for (let i = 0; i < length; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
  }
  return win;
}

/**
 * In-place Radix-2 Cooley-Tukey FFT. `re` and `im` must have length equal to a power of 2.
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;

  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = re[i];
      const ti = im[i];
      re[i] = re[j];
      im[i] = im[j];
      re[j] = tr;
      im[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angleStep = (-2 * Math.PI) / size;
    const wStepRe = Math.cos(angleStep);
    const wStepIm = Math.sin(angleStep);

    for (let start = 0; start < n; start += size) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let k = 0; k < half; k++) {
        const evenIdx = start + k;
        const oddIdx = evenIdx + half;
        const oddRe = re[oddIdx];
        const oddIm = im[oddIdx];

        const tRe = wRe * oddRe - wIm * oddIm;
        const tIm = wRe * oddIm + wIm * oddRe;

        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;

        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Compute one-sided Welch power spectral density (matching scipy.signal.welch(..., window='hann', scaling='density')).
 * Integrating over frequency bins via sum(psd[mask]) * df properly accounts for ENBW.
 */
export function welchDensitySpectrum(
  signal: Float64Array,
  sampleRate: number,
  npersegInput = 16384,
  noverlapInput?: number
): { freqs: Float64Array; psd: Float64Array; df: number } {
  const n = signal.length;
  const rawSeg = Math.min(npersegInput, Math.max(256, n));
  const nfft = nextPowerOf2(rawSeg);
  const segLen = Math.min(n, nfft);
  const hop = Math.max(1, segLen - (noverlapInput ?? Math.floor(segLen / 2)));

  const win = hannWindow(segLen);
  let winSqSum = 0;
  for (let i = 0; i < segLen; i++) {
    winSqSum += win[i] * win[i];
  }
  const psdScale = Math.max(1e-12, sampleRate * winSqSum);

  const numBins = nfft / 2 + 1;
  const accPsd = new Float64Array(numBins);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);

  let numSegments = 0;
  for (let start = 0; start + segLen <= n || numSegments === 0; start += hop) {
    re.fill(0);
    im.fill(0);

    const end = Math.min(n, start + segLen);
    const actualLen = end - start;
    let mean = 0;
    for (let i = 0; i < actualLen; i++) {
      mean += signal[start + i];
    }
    mean /= Math.max(1, actualLen);

    for (let i = 0; i < actualLen; i++) {
      re[i] = (signal[start + i] - mean) * win[i];
    }

    fftInPlace(re, im);

    accPsd[0] += (re[0] * re[0] + im[0] * im[0]) / psdScale;
    for (let k = 1; k < numBins - 1; k++) {
      accPsd[k] += (2 * (re[k] * re[k] + im[k] * im[k])) / psdScale;
    }
    const last = numBins - 1;
    accPsd[last] += (re[last] * re[last] + im[last] * im[last]) / psdScale;
    numSegments++;

    if (start + segLen >= n) break;
  }

  const freqs = new Float64Array(numBins);
  const df = sampleRate / nfft;
  for (let k = 0; k < numBins; k++) {
    freqs[k] = k * df;
    accPsd[k] /= Math.max(1, numSegments);
  }

  return { freqs, psd: accPsd, df };
}

/**
 * Compute single-pass power-summed STFT across channels so all 6 bands localize peaks from one transform.
 */
export function computeStftPower(
  channelsData: Float64Array[],
  sampleRate: number
): { freqs: Float64Array; times: Float64Array; frames: Float64Array[] } {
  const nSamples = channelsData[0]?.length ?? 0;
  const rawSeg = Math.min(4096, Math.max(256, nSamples));
  const nfft = nextPowerOf2(rawSeg);
  const segLen = Math.min(nSamples, nfft);
  const hop = Math.max(256, Math.floor(segLen / 2));
  const win = hannWindow(segLen);
  const numBins = nfft / 2 + 1;
  const df = sampleRate / nfft;

  const freqs = new Float64Array(numBins);
  for (let k = 0; k < numBins; k++) freqs[k] = k * df;

  const frameTimes: number[] = [];
  const frames: Float64Array[] = [];
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);

  for (let start = 0; start < nSamples; start += hop) {
    const end = Math.min(nSamples, start + segLen);
    const actualLen = end - start;
    if (actualLen < 64 && frames.length > 0) break;

    const framePower = new Float64Array(numBins);
    for (let c = 0; c < channelsData.length; c++) {
      const ch = channelsData[c];
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < actualLen; i++) {
        re[i] = ch[start + i] * win[i];
      }
      fftInPlace(re, im);
      framePower[0] += re[0] * re[0] + im[0] * im[0];
      for (let k = 1; k < numBins - 1; k++) {
        framePower[k] += re[k] * re[k] + im[k] * im[k];
      }
      framePower[numBins - 1] +=
        re[numBins - 1] * re[numBins - 1] + im[numBins - 1] * im[numBins - 1];
    }
    frames.push(framePower);
    frameTimes.push((start + actualLen * 0.5) / sampleRate);
    if (end >= nSamples) break;
  }

  return {
    freqs,
    times: Float64Array.from(frameTimes),
    frames,
  };
}

/**
 * Resample channel array from srcSr to dstSr using linear interpolation (used for stem alignment).
 */
export function resampleChannelLinear(
  channel: Float64Array,
  srcSr: number,
  dstSr: number
): Float64Array {
  if (srcSr === dstSr || channel.length === 0) {
    return channel;
  }
  const outLen = Math.max(1, Math.round((channel.length * dstSr) / srcSr));
  const out = new Float64Array(outLen);
  const ratio = srcSr / dstSr;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = channel[Math.min(idx, channel.length - 1)];
    const s1 = channel[Math.min(idx + 1, channel.length - 1)];
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

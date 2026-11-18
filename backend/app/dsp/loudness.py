from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.signal import lfilter


@dataclass
class LoudnessResult:
    integrated_lufs: float
    short_term_max_lufs: float
    momentary_max_lufs: float
    loudness_range_lu: float
    short_term_lufs_series: list[float]


def _bs1770_k_weighting_coeffs(sample_rate: int) -> tuple[tuple[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]:
    """Compute exact ITU-R BS.1770-4 two-stage K-weighting biquad coefficients for any sample rate."""
    sr = float(max(sample_rate, 8000))

    # Stage 1: pre-filter high shelf (+4 dB acoustic head-shadowing curve)
    f0_1 = 1681.974450955533
    g_db = 3.999843853973347
    q_1 = 0.7071752369554196
    k_1 = math.tan(math.pi * f0_1 / sr)
    vh = 10.0 ** (g_db / 20.0)
    vb = vh ** 0.4996667741545416
    a0_1 = 1.0 + k_1 / q_1 + k_1 * k_1
    b1_stage = np.array(
        [
            (vh + vb * k_1 / q_1 + k_1 * k_1) / a0_1,
            (2.0 * (k_1 * k_1 - vh)) / a0_1,
            (vh - vb * k_1 / q_1 + k_1 * k_1) / a0_1,
        ],
        dtype=np.float64,
    )
    a1_stage = np.array(
        [
            1.0,
            (2.0 * (k_1 * k_1 - 1.0)) / a0_1,
            (1.0 - k_1 / q_1 + k_1 * k_1) / a0_1,
        ],
        dtype=np.float64,
    )

    # Stage 2: Revised Low-frequency B-weighting (RLB) 2nd-order high-pass
    f0_2 = 38.13547087602444
    q_2 = 0.5003270373238773
    k_2 = math.tan(math.pi * f0_2 / sr)
    a0_2 = 1.0 + k_2 / q_2 + k_2 * k_2
    b2_stage = np.array(
        [
            1.0 / a0_2,
            -2.0 / a0_2,
            1.0 / a0_2,
        ],
        dtype=np.float64,
    )
    a2_stage = np.array(
        [
            1.0,
            (2.0 * (k_2 * k_2 - 1.0)) / a0_2,
            (1.0 - k_2 / q_2 + k_2 * k_2) / a0_2,
        ],
        dtype=np.float64,
    )

    return (b1_stage, a1_stage), (b2_stage, a2_stage)


def _apply_k_weighting(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Single-pass ITU-R BS.1770-4 K-weighting via public scipy.signal.lfilter."""
    arr = samples[:, np.newaxis] if samples.ndim == 1 else samples
    (b1, a1), (b2, a2) = _bs1770_k_weighting_coeffs(sample_rate)
    out = np.empty_like(arr, dtype=np.float32)
    for ch in range(arr.shape[1]):
        sig = np.asarray(arr[:, ch], dtype=np.float64)
        stage1 = lfilter(b1, a1, sig)
        stage2 = lfilter(b2, a2, stage1)
        out[:, ch] = stage2.astype(np.float32)
    return out


def _k_weighted_loudness(block: np.ndarray) -> float:
    # Channel weights G = [1.0, 1.0] for mono/stereo per ITU-R BS.1770
    arr = np.asarray(block, dtype=np.float64)
    mean_sq = np.mean(np.square(arr), axis=0)
    total_energy = float(np.sum(mean_sq))
    if total_energy <= 1e-12:
        return -70.0
    lufs = -0.691 + 10.0 * math.log10(total_energy)
    return float(max(-70.0, min(10.0, lufs)))


def compute_loudness_metrics(samples: np.ndarray, sample_rate: int) -> LoudnessResult:
    """Compute ITU-R BS.1770-4 integrated LUFS, EBU R128 LRA, short-term series, and momentary max in one K-weighted pass."""
    n_samples = samples.shape[0] if samples.size > 0 else 0
    if n_samples == 0 or float(np.max(np.abs(samples))) < 1e-9:
        n_secs = max(1, int(math.ceil(n_samples / max(sample_rate, 1))))
        return LoudnessResult(
            integrated_lufs=-70.0,
            short_term_max_lufs=-70.0,
            momentary_max_lufs=-70.0,
            loudness_range_lu=0.0,
            short_term_lufs_series=[-70.0] * n_secs,
        )

    duration_sec = n_samples / max(sample_rate, 1)
    k_weighted = _apply_k_weighting(samples, sample_rate)

    # Precompute cumulative per-sample summed-channel squared energy in float64
    # for O(1) window loudness lookups without allocating copies.
    chan_sq_sum = np.sum(np.square(k_weighted, dtype=np.float64), axis=1)
    cumsum = np.empty(n_samples + 1, dtype=np.float64)
    cumsum[0] = 0.0
    np.cumsum(chan_sq_sum, out=cumsum[1:])
    del chan_sq_sum, k_weighted

    def _window_energy(start: int, end: int) -> float:
        length = max(1, end - start)
        return max(0.0, float((cumsum[end] - cumsum[start]) / length))

    def _energy_to_lufs(energy: float) -> float:
        if energy <= 1e-12:
            return -70.0
        return float(max(-70.0, min(10.0, -0.691 + 10.0 * math.log10(energy))))

    # 1. Momentary blocks (400 ms window, 100 ms step) & Integrated BS.1770-4 gated LUFS
    win_400 = max(1, int(round(0.4 * sample_rate)))
    hop_100 = max(1, int(round(0.1 * sample_rate)))

    if n_samples <= win_400:
        e0 = _window_energy(0, n_samples)
        block_energies = np.array([e0], dtype=np.float64)
    else:
        starts = np.arange(0, n_samples - win_400 + 1, hop_100, dtype=np.int64)
        block_energies = (cumsum[starts + win_400] - cumsum[starts]) / float(win_400)

    block_loudnesses = np.where(
        block_energies > 1e-12,
        -0.691 + 10.0 * np.log10(np.maximum(block_energies, 1e-12)),
        -70.0,
    )
    momentary_max = float(np.max(block_loudnesses)) if block_loudnesses.size > 0 else -70.0

    if duration_sec >= 0.41 and block_loudnesses.size > 0:
        abs_mask = block_loudnesses > -70.0
        if np.any(abs_mask):
            gamma_a = -0.691 + 10.0 * math.log10(max(float(np.mean(block_energies[abs_mask])), 1e-12))
            rel_mask = abs_mask & (block_loudnesses > (gamma_a - 10.0))
            if np.any(rel_mask):
                integrated = max(
                    -70.0,
                    -0.691 + 10.0 * math.log10(max(float(np.mean(block_energies[rel_mask])), 1e-12)),
                )
            else:
                integrated = -70.0
        else:
            integrated = -70.0
    else:
        integrated = _energy_to_lufs(_window_energy(0, n_samples))

    # 2. Loudness Range (EBU R128: 3.0 s window, 100 ms step, >= 3.1 s duration)
    win_3s = max(1, int(round(3.0 * sample_rate)))
    lra = 0.0
    if duration_sec >= 3.1 and n_samples >= win_3s:
        lra_starts = np.arange(0, n_samples - win_3s + 1, hop_100, dtype=np.int64)
        st_energies = (cumsum[lra_starts + win_3s] - cumsum[lra_starts]) / float(win_3s)
        st_loud = np.where(
            st_energies > 1e-12,
            -0.691 + 10.0 * np.log10(np.maximum(st_energies, 1e-12)),
            -70.0,
        )
        abs_st_mask = st_loud > -70.0
        if np.any(abs_st_mask):
            abs_mean_e = float(np.mean(st_energies[abs_st_mask]))
            abs_l = -0.691 + 10.0 * math.log10(max(abs_mean_e, 1e-12))
            rel_st = st_loud[abs_st_mask & (st_loud >= abs_l - 20.0)]
            if rel_st.size >= 2:
                lra = max(0.0, float(np.percentile(rel_st, 95) - np.percentile(rel_st, 10)))

    # 3. Short-Term LUFS series (3.0 s sliding window, 1.0 s step)
    step_1s = max(1, int(round(1.0 * sample_rate)))
    short_term_series: list[float] = []
    if n_samples <= win_3s:
        total_steps = max(1, int(math.ceil(duration_sec)))
        for idx in range(total_steps):
            start = min(idx * step_1s, max(0, n_samples - 1))
            end = min(n_samples, start + step_1s)
            short_term_series.append(round(_energy_to_lufs(_window_energy(start, end)), 2))
    else:
        n_seconds = int(math.ceil(duration_sec))
        min_tail = max(1, int(round(0.4 * sample_rate)))
        for sec in range(n_seconds):
            start = sec * step_1s
            end = min(n_samples, start + win_3s)
            if end - start < min_tail:
                start = max(0, n_samples - win_3s)
                end = n_samples
            short_term_series.append(round(_energy_to_lufs(_window_energy(start, end)), 2))

    short_term_max = max(short_term_series) if short_term_series else integrated

    return LoudnessResult(
        integrated_lufs=round(float(integrated), 2),
        short_term_max_lufs=round(
            float(max(-70.0, momentary_max if short_term_max < -69.9 else short_term_max)),
            2,
        ),
        momentary_max_lufs=round(float(max(-70.0, momentary_max)), 2),
        loudness_range_lu=round(float(lra), 2),
        short_term_lufs_series=short_term_series,
    )

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np
import pyloudnorm as pyln


@dataclass
class LoudnessResult:
    integrated_lufs: float
    short_term_max_lufs: float
    momentary_max_lufs: float
    loudness_range_lu: float
    short_term_lufs_series: list[float]


def _apply_k_weighting(samples: np.ndarray, meter: pyln.Meter) -> np.ndarray:
    weighted = samples.copy()
    if weighted.ndim == 1:
        weighted = weighted[:, np.newaxis]
    for _, filter_stage in meter._filters.items():
        for ch in range(weighted.shape[1]):
            weighted[:, ch] = filter_stage.apply_filter(weighted[:, ch])
    return weighted


def _k_weighted_loudness(block: np.ndarray) -> float:
    # Channel weights G = [1.0, 1.0] for mono/stereo per ITU-R BS.1770
    mean_sq = np.mean(np.square(block), axis=0)
    total_energy = float(np.sum(mean_sq))
    if total_energy <= 1e-12:
        return -70.0
    lufs = -0.691 + 10.0 * np.log10(total_energy)
    return float(max(-70.0, min(10.0, lufs)))


def compute_loudness_metrics(samples: np.ndarray, sample_rate: int) -> LoudnessResult:
    """Compute ITU-R BS.1770 integrated LUFS, LRA, short-term series, and momentary max."""
    if samples.size == 0 or float(np.max(np.abs(samples))) < 1e-9:
        n_secs = max(1, int(np.ceil(len(samples) / max(sample_rate, 1))))
        return LoudnessResult(
            integrated_lufs=-70.0,
            short_term_max_lufs=-70.0,
            momentary_max_lufs=-70.0,
            loudness_range_lu=0.0,
            short_term_lufs_series=[-70.0] * n_secs,
        )

    data = samples[:, 0] if (samples.ndim == 2 and samples.shape[1] == 1) else samples
    duration_sec = len(samples) / sample_rate

    meter = pyln.Meter(sample_rate)
    k_weighted = _apply_k_weighting(samples, meter)

    if duration_sec >= 0.41:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            integrated = float(meter.integrated_loudness(data))
            if not np.isfinite(integrated):
                integrated = -70.0
            integrated = max(-70.0, integrated)
    else:
        integrated = _k_weighted_loudness(k_weighted)

    # Momentary max (400 ms blocks, 100 ms step)
    if getattr(meter, "blockwise_loudness", None):
        finite_blocks = [float(v) for v in meter.blockwise_loudness if np.isfinite(v)]
        momentary_max = max(finite_blocks) if finite_blocks else integrated
    else:
        win_400 = max(1, int(round(0.4 * sample_rate)))
        hop_100 = max(1, int(round(0.1 * sample_rate)))
        if len(k_weighted) <= win_400:
            momentary_max = _k_weighted_loudness(k_weighted)
        else:
            momentary_vals = [
                _k_weighted_loudness(k_weighted[i : i + win_400])
                for i in range(0, len(k_weighted) - win_400 + 1, hop_100)
            ]
            momentary_max = max(momentary_vals) if momentary_vals else integrated

    # Loudness Range (LRA) requires >= 3.0 s in ITU-R BS.1770 / EBU R128
    lra = 0.0
    if duration_sec >= 3.1:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", category=RuntimeWarning)
                raw_lra = float(meter.loudness_range(data))
                if np.isfinite(raw_lra) and raw_lra >= 0.0:
                    lra = raw_lra
        except Exception:
            lra = 0.0

    # Short-Term LUFS series (3.0 s sliding window, 1.0 s step)
    win_3s = int(round(3.0 * sample_rate))
    step_1s = max(1, int(round(1.0 * sample_rate)))
    short_term_series: list[float] = []

    if len(k_weighted) <= win_3s:
        total_steps = max(1, int(np.ceil(duration_sec)))
        for idx in range(total_steps):
            start = min(idx * step_1s, max(0, len(k_weighted) - 1))
            end = min(len(k_weighted), start + step_1s)
            short_term_series.append(round(_k_weighted_loudness(k_weighted[start:end]), 2))
        short_term_max = max(short_term_series) if short_term_series else integrated
    else:
        n_seconds = int(np.ceil(duration_sec))
        for sec in range(n_seconds):
            center = sec * step_1s
            start = max(0, center)
            end = min(len(k_weighted), start + win_3s)
            if end - start < max(1, int(0.4 * sample_rate)):
                start = max(0, len(k_weighted) - win_3s)
                end = len(k_weighted)
            short_term_series.append(round(_k_weighted_loudness(k_weighted[start:end]), 2))
        short_term_max = max(short_term_series) if short_term_series else integrated

    return LoudnessResult(
        integrated_lufs=round(float(integrated), 2),
        short_term_max_lufs=round(float(max(-70.0, momentary_max if short_term_max < -69.9 else short_term_max)), 2),
        momentary_max_lufs=round(float(max(-70.0, momentary_max)), 2),
        loudness_range_lu=round(float(lra), 2),
        short_term_lufs_series=short_term_series,
    )

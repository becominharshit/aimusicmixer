from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import butter, sosfilt


@dataclass
class StereoResult:
    phase_correlation_avg: float
    low_end_phase_correlation: float
    stereo_width_ratio: float
    phase_correlation_series: list[float]
    worst_phase_window: tuple[float, float]


def _pearson_corr_weighted(left: np.ndarray, right: np.ndarray, step: int) -> float:
    n_samples = left.shape[0]
    weighted_sum = 0.0
    weight_total = 0.0
    for start in range(0, n_samples, step):
        end = min(n_samples, start + step)
        if end - start < 2:
            continue
        l_blk = np.asarray(left[start:end], dtype=np.float64)
        r_blk = np.asarray(right[start:end], dtype=np.float64)
        block_energy = float(np.sum(l_blk * l_blk) + np.sum(r_blk * r_blk))
        if block_energy <= 1e-10:
            continue
        lc = l_blk - np.mean(l_blk)
        rc = r_blk - np.mean(r_blk)
        denom = float(np.sqrt(np.sum(lc * lc) * np.sum(rc * rc)))
        if denom <= 1e-12:
            corr = 1.0 if np.allclose(l_blk, r_blk, atol=1e-6) else 0.0
        else:
            corr = float(np.clip(np.sum(lc * rc) / denom, -1.0, 1.0))
        weighted_sum += corr * block_energy
        weight_total += block_energy
    return (weighted_sum / weight_total) if weight_total > 1e-12 else 1.0


def _locate_worst_phase_window(
    series: list[float],
    worst_sec: int,
    duration_sec: float,
) -> tuple[float, float]:
    """Group contiguous negative/low-correlation 1s slices into an accurate localization window."""
    if duration_sec <= 2.0 or not series:
        return (0.0, round(max(0.1, duration_sec), 1))

    threshold = 0.0 if any(v < 0.0 for v in series) else 0.15
    clusters: list[tuple[int, int, float]] = []
    cur_start: int | None = None
    cur_end: int | None = None
    cur_min = 1.0

    for sec, val in enumerate(series):
        if val < threshold:
            if cur_start is None:
                cur_start = sec
                cur_end = sec
                cur_min = val
            elif cur_end is not None and sec - cur_end <= 1:
                cur_end = sec
                cur_min = min(cur_min, val)
            else:
                assert cur_end is not None
                clusters.append((cur_start, cur_end, cur_min))
                cur_start = sec
                cur_end = sec
                cur_min = val

    if cur_start is not None and cur_end is not None:
        clusters.append((cur_start, cur_end, cur_min))

    if clusters:
        # Select cluster containing the lowest correlation (tie-break: longest span)
        clusters.sort(key=lambda c: (c[2], -(c[1] - c[0])))
        c_start, c_end, _ = clusters[0]
        w_start = float(max(0, c_start))
        w_end = min(duration_sec, float(c_end + 1))
        if w_end - w_start < min(2.0, duration_sec):
            w_end = min(duration_sec, w_start + min(2.0, duration_sec))
        return (round(w_start, 1), round(w_end, 1))

    w_start = max(0.0, float(worst_sec))
    w_end = min(duration_sec, w_start + min(3.0, duration_sec))
    return (round(w_start, 1), round(max(w_start + 1.0, w_end), 1))


def compute_stereo_metrics(samples: np.ndarray, sample_rate: int) -> StereoResult:
    """Compute Mid/Side width, 1s Pearson correlation, contiguous worst-phase window, and <120Hz sub phase correlation."""
    n_samples = samples.shape[0]
    duration_sec = n_samples / max(sample_rate, 1)
    n_seconds = max(1, int(np.ceil(duration_sec)))

    if samples.size == 0 or samples.ndim == 1 or samples.shape[1] == 1:
        return StereoResult(
            phase_correlation_avg=1.0,
            low_end_phase_correlation=1.0,
            stereo_width_ratio=0.0,
            phase_correlation_series=[1.0] * n_seconds,
            worst_phase_window=(0.0, round(duration_sec, 1)),
        )

    left = samples[:, 0]
    right = samples[:, 1]

    step = max(1, sample_rate)
    series: list[float] = []
    mid_energy = 0.0
    side_energy = 0.0
    weighted_corr_sum = 0.0
    weight_sum = 0.0
    worst_corr = 1.0
    worst_sec = 0

    for sec in range(n_seconds):
        start = sec * step
        end = min(n_samples, start + step)
        l_blk = np.asarray(left[start:end], dtype=np.float64)
        r_blk = np.asarray(right[start:end], dtype=np.float64)
        mid_blk = 0.5 * (l_blk + r_blk)
        side_blk = 0.5 * (l_blk - r_blk)
        mid_energy += float(np.sum(mid_blk * mid_blk))
        side_energy += float(np.sum(side_blk * side_blk))

        if end - start < 2:
            series.append(series[-1] if series else 1.0)
            continue

        block_energy = float(np.sum(l_blk * l_blk) + np.sum(r_blk * r_blk))
        if block_energy <= 1e-10:
            series.append(1.0)
            continue

        l_centered = l_blk - np.mean(l_blk)
        r_centered = r_blk - np.mean(r_blk)
        denom = float(np.sqrt(np.sum(l_centered * l_centered) * np.sum(r_centered * r_centered)))
        if denom <= 1e-12:
            corr = 1.0 if np.allclose(l_blk, r_blk, atol=1e-6) else 0.0
        else:
            corr = float(np.clip(np.sum(l_centered * r_centered) / denom, -1.0, 1.0))

        series.append(round(corr, 3))
        weighted_corr_sum += corr * block_energy
        weight_sum += block_energy
        if corr < worst_corr:
            worst_corr = corr
            worst_sec = sec

    total_ms = mid_energy + side_energy
    if total_ms <= 1e-12:
        return StereoResult(
            phase_correlation_avg=1.0,
            low_end_phase_correlation=1.0,
            stereo_width_ratio=0.0,
            phase_correlation_series=[1.0] * n_seconds,
            worst_phase_window=(0.0, round(duration_sec, 1)),
        )

    width_ratio = float(side_energy / total_ms)
    avg_corr = (weighted_corr_sum / weight_sum) if weight_sum > 1e-12 else 1.0

    # Dedicated sub-bass (20-120 Hz) L/R phase correlation via 4th-order Butterworth bandpass
    low_end_corr = avg_corr
    if sample_rate > 250 and n_samples >= 64:
        try:
            sos = butter(4, [20.0, 120.0], btype="bandpass", fs=sample_rate, output="sos")
            low_l = sosfilt(sos, np.asarray(left, dtype=np.float64))
            low_r = sosfilt(sos, np.asarray(right, dtype=np.float64))
            low_end_corr = _pearson_corr_weighted(low_l, low_r, step)
            del low_l, low_r
        except Exception:
            low_end_corr = avg_corr

    worst_window = _locate_worst_phase_window(series, worst_sec, duration_sec)

    return StereoResult(
        phase_correlation_avg=round(float(np.clip(avg_corr, -1.0, 1.0)), 3),
        low_end_phase_correlation=round(float(np.clip(low_end_corr, -1.0, 1.0)), 3),
        stereo_width_ratio=round(float(np.clip(width_ratio, 0.0, 1.0)), 3),
        phase_correlation_series=series,
        worst_phase_window=worst_window,
    )

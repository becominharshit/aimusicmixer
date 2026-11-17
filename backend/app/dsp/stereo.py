from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class StereoResult:
    phase_correlation_avg: float
    stereo_width_ratio: float
    phase_correlation_series: list[float]
    worst_phase_window: tuple[float, float]


def compute_stereo_metrics(samples: np.ndarray, sample_rate: int) -> StereoResult:
    """Compute Mid/Side stereo width ratio and 1-second rolling Pearson phase correlation."""
    n_samples = samples.shape[0]
    duration_sec = n_samples / max(sample_rate, 1)
    n_seconds = max(1, int(np.ceil(duration_sec)))

    if samples.size == 0:
        return StereoResult(
            phase_correlation_avg=1.0,
            stereo_width_ratio=0.0,
            phase_correlation_series=[1.0] * n_seconds,
            worst_phase_window=(0.0, round(duration_sec, 1)),
        )

    if samples.ndim == 1 or samples.shape[1] == 1:
        return StereoResult(
            phase_correlation_avg=1.0,
            stereo_width_ratio=0.0,
            phase_correlation_series=[1.0] * n_seconds,
            worst_phase_window=(0.0, round(duration_sec, 1)),
        )

    left = samples[:, 0]
    right = samples[:, 1]

    # Compute Mid/Side energy and rolling Pearson correlation per 1s slice without full-track copies
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
        l_blk = left[start:end]
        r_blk = right[start:end]
        mid_blk = 0.5 * (l_blk + r_blk)
        side_blk = 0.5 * (l_blk - r_blk)
        mid_energy += float(np.sum(mid_blk * mid_blk))
        side_energy += float(np.sum(side_blk * side_blk))

        if end - start < 2:
            series.append(series[-1] if series else 1.0)
            continue

        l_energy = float(np.sum(l_blk * l_blk))
        r_energy = float(np.sum(r_blk * r_blk))
        block_energy = l_energy + r_energy
        if block_energy <= 1e-10:
            series.append(1.0)
            continue

        l_centered = l_blk - np.mean(l_blk)
        r_centered = r_blk - np.mean(r_blk)
        denom = float(np.sqrt(np.sum(l_centered * l_centered) * np.sum(r_centered * r_centered)))
        if denom <= 1e-12:
            # Handle DC or identical steady-state channels cleanly
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
            stereo_width_ratio=0.0,
            phase_correlation_series=[1.0] * n_seconds,
            worst_phase_window=(0.0, round(duration_sec, 1)),
        )
    width_ratio = float(side_energy / total_ms)

    avg_corr = (weighted_corr_sum / weight_sum) if weight_sum > 1e-12 else 1.0
    w_start = max(0.0, float(worst_sec - 2))
    w_end = min(duration_sec, float(worst_sec + 6))

    return StereoResult(
        phase_correlation_avg=round(float(np.clip(avg_corr, -1.0, 1.0)), 3),
        stereo_width_ratio=round(float(np.clip(width_ratio, 0.0, 1.0)), 3),
        phase_correlation_series=series,
        worst_phase_window=(round(w_start, 1), round(max(w_start + 1.0, w_end), 1)),
    )

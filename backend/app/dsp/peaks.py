from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly


@dataclass
class PeakResult:
    sample_peak_dbfs: float
    true_peak_dbtp: float
    ffmpeg_true_peak_dbtp: float | None
    clipping_timestamps_sec: list[float]


def _linear_to_db(amplitude: float) -> float:
    if amplitude <= 1e-12:
        return -120.0
    return float(20.0 * np.log10(amplitude))


def _measure_4x_resample_poly_peak(samples: np.ndarray) -> float:
    """Measure 4x polyphase FIR oversampled True Peak across chunked windows."""
    if samples.size == 0 or float(np.max(np.abs(samples))) <= 1e-12:
        return -120.0

    chunk_len = 262144
    pad = 256
    n_samples = samples.shape[0]
    max_oversampled = 0.0

    for start in range(0, n_samples, chunk_len):
        end = min(n_samples, start + chunk_len)
        ctx_start = max(0, start - pad)
        ctx_end = min(n_samples, end + pad)
        chunk = samples[ctx_start:ctx_end]

        oversampled = resample_poly(chunk, up=4, down=1, axis=0)
        trim_left = (start - ctx_start) * 4
        trim_right = trim_left + (end - start) * 4
        core = oversampled[trim_left:trim_right]
        if core.size > 0:
            peak = float(np.max(np.abs(core)))
            if peak > max_oversampled:
                max_oversampled = peak

    return _linear_to_db(max_oversampled)


def _measure_ffmpeg_ebur128_true_peak(source_path: Path | None) -> float | None:
    if source_path is None or not source_path.exists():
        return None
    cmd = [
        "ffmpeg",
        "-nostats",
        "-i",
        str(source_path),
        "-filter_complex",
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=45)
    except Exception:
        return None
    output = proc.stderr or ""
    # FFmpeg ebur128 summary prints: "True peak:\n    Peak:       -0.1 dBFS"
    match = re.search(r"True peak:\s*(?:\r?\n)+\s*Peak:\s*([+-]?\d+(?:\.\d+)?)\s*dBFS", output)
    if match:
        return float(match.group(1))
    return None


def _find_clipping_timestamps(samples: np.ndarray, sample_rate: int, threshold: float = 0.999) -> list[float]:
    if samples.size == 0:
        return []
    clipped_mask = np.max(np.abs(samples), axis=1) >= threshold if samples.ndim == 2 else np.abs(samples) >= threshold
    indices = np.flatnonzero(clipped_mask)
    if indices.size == 0:
        return []
    timestamps: list[float] = []
    last_ts = -1.0
    for idx in indices:
        ts = round(float(idx / sample_rate), 2)
        if ts - last_ts >= 0.5:
            timestamps.append(ts)
            last_ts = ts
            if len(timestamps) >= 50:
                break
    return timestamps


def compute_peak_metrics(
    samples: np.ndarray,
    sample_rate: int,
    source_path: Path | None = None,
) -> PeakResult:
    """Measure sample peak (dBFS), 4x polyphase True Peak (dBTP), and FFmpeg ebur128 cross-check."""
    if samples.size == 0 or float(np.max(np.abs(samples))) <= 1e-12:
        return PeakResult(
            sample_peak_dbfs=-120.0,
            true_peak_dbtp=-120.0,
            ffmpeg_true_peak_dbtp=None,
            clipping_timestamps_sec=[],
        )

    sample_peak_lin = float(np.max(np.abs(samples)))
    sample_peak_dbfs = _linear_to_db(sample_peak_lin)
    poly_dbtp = _measure_4x_resample_poly_peak(samples)
    ffmpeg_dbtp = _measure_ffmpeg_ebur128_true_peak(source_path)

    candidates = [sample_peak_dbfs, poly_dbtp]
    if ffmpeg_dbtp is not None and np.isfinite(ffmpeg_dbtp):
        candidates.append(ffmpeg_dbtp)
    true_peak_dbtp = max(candidates)

    clip_times = _find_clipping_timestamps(samples, sample_rate)

    return PeakResult(
        sample_peak_dbfs=round(sample_peak_dbfs, 2),
        true_peak_dbtp=round(true_peak_dbtp, 2),
        ffmpeg_true_peak_dbtp=round(ffmpeg_dbtp, 2) if ffmpeg_dbtp is not None else None,
        clipping_timestamps_sec=clip_times,
    )

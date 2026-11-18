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


def _chunk_peak_abs(samples: np.ndarray, block_len: int) -> float:
    """Measure max absolute amplitude across chunks without full-track array copies."""
    if samples.size == 0:
        return 0.0
    max_val = 0.0
    n_samples = samples.shape[0]
    step = max(1, block_len)
    for start in range(0, n_samples, step):
        chunk = samples[start : start + step]
        c_max = max(abs(float(chunk.min())), abs(float(chunk.max())))
        if c_max > max_val:
            max_val = c_max
    return max_val


def _measure_4x_resample_poly_peak_and_clips(
    samples: np.ndarray,
    sample_rate: int = 48000,
    clip_threshold_lin: float = 1.0,
) -> tuple[float, list[float]]:
    """
    Measure 4x polyphase FIR oversampled True Peak across chunked 10-second windows
    and collect clipping timestamps directly from the 4x oversampled waveform (>= 0.0 dBTP).
    """
    chunk_len = max(4096, int(sample_rate * 10))
    if samples.size == 0 or _chunk_peak_abs(samples, chunk_len) <= 1e-12:
        return -120.0, []

    pad = 256
    n_samples = samples.shape[0]
    max_oversampled = 0.0
    timestamps: list[float] = []
    last_ts = -1.0

    for start in range(0, n_samples, chunk_len):
        end = min(n_samples, start + chunk_len)
        ctx_start = max(0, start - pad)
        ctx_end = min(n_samples, end + pad)
        chunk = np.asarray(samples[ctx_start:ctx_end], dtype=np.float32)

        oversampled = resample_poly(chunk, up=4, down=1, axis=0)
        trim_left = (start - ctx_start) * 4
        trim_right = trim_left + (end - start) * 4
        core = oversampled[trim_left:trim_right]
        if core.size > 0:
            peak = max(abs(float(core.min())), abs(float(core.max())))
            if peak > max_oversampled:
                max_oversampled = peak

            if peak >= clip_threshold_lin and len(timestamps) < 50:
                if core.ndim == 2:
                    clipped_mask = (np.max(core, axis=1) >= clip_threshold_lin) | (
                        np.min(core, axis=1) <= -clip_threshold_lin
                    )
                else:
                    clipped_mask = (core >= clip_threshold_lin) | (core <= -clip_threshold_lin)
                indices = np.flatnonzero(clipped_mask)
                oversampled_sr = 4.0 * max(sample_rate, 1)
                for local_idx in indices:
                    ts = round(float((start / max(sample_rate, 1)) + (int(local_idx) / oversampled_sr)), 2)
                    if ts - last_ts >= 0.5:
                        timestamps.append(ts)
                        last_ts = ts
                        if len(timestamps) >= 50:
                            break
        del oversampled, core

    return _linear_to_db(max_oversampled), timestamps


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
    match = re.search(r"True peak:\s*(?:\r?\n)+\s*Peak:\s*([+-]?\d+(?:\.\d+)?)\s*dBFS", output)
    if match:
        return float(match.group(1))
    return None


def _find_sample_clipping_timestamps(
    samples: np.ndarray,
    sample_rate: int,
    threshold: float = 0.999,
) -> list[float]:
    if samples.size == 0:
        return []
    chunk_len = max(4096, int(sample_rate * 10))
    n_samples = samples.shape[0]
    timestamps: list[float] = []
    last_ts = -1.0

    for start in range(0, n_samples, chunk_len):
        chunk = samples[start : start + chunk_len]
        if chunk.ndim == 2:
            clipped_mask = (np.max(chunk, axis=1) >= threshold) | (np.min(chunk, axis=1) <= -threshold)
        else:
            clipped_mask = (chunk >= threshold) | (chunk <= -threshold)
        indices = np.flatnonzero(clipped_mask)
        for local_idx in indices:
            ts = round(float((start + int(local_idx)) / sample_rate), 2)
            if ts - last_ts >= 0.5:
                timestamps.append(ts)
                last_ts = ts
                if len(timestamps) >= 50:
                    return timestamps
    return timestamps


def compute_peak_metrics(
    samples: np.ndarray,
    sample_rate: int,
    source_path: Path | None = None,
) -> PeakResult:
    """
    Measure sample peak (dBFS) and 4x polyphase FIR True Peak (dBTP).
    Uses FFmpeg ebur128 only as an exception fallback so audio is decoded once.
    """
    block_len = max(4096, int(sample_rate * 10))
    sample_peak_lin = _chunk_peak_abs(samples, block_len)
    if samples.size == 0 or sample_peak_lin <= 1e-12:
        return PeakResult(
            sample_peak_dbfs=-120.0,
            true_peak_dbtp=-120.0,
            ffmpeg_true_peak_dbtp=None,
            clipping_timestamps_sec=[],
        )

    sample_peak_dbfs = _linear_to_db(sample_peak_lin)
    ffmpeg_dbtp: float | None = None
    clip_times: list[float] = []

    try:
        poly_dbtp, clip_times = _measure_4x_resample_poly_peak_and_clips(samples, sample_rate)
        true_peak_dbtp = max(sample_peak_dbfs, poly_dbtp)
    except Exception:
        ffmpeg_dbtp = _measure_ffmpeg_ebur128_true_peak(source_path)
        true_peak_dbtp = max(sample_peak_dbfs, ffmpeg_dbtp) if ffmpeg_dbtp is not None else sample_peak_dbfs
        clip_times = _find_sample_clipping_timestamps(samples, sample_rate)

    return PeakResult(
        sample_peak_dbfs=round(sample_peak_dbfs, 2),
        true_peak_dbtp=round(true_peak_dbtp, 2),
        ffmpeg_true_peak_dbtp=round(ffmpeg_dbtp, 2) if ffmpeg_dbtp is not None else None,
        clipping_timestamps_sec=clip_times,
    )

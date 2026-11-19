from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class SectionMarker:
    label: str
    start_sec: float
    end_sec: float
    avg_lufs: float


@dataclass
class StructureResult:
    bpm: float | None
    sections: list[SectionMarker]


def estimate_bpm(audio: np.ndarray, sample_rate: int) -> float | None:
    """Fast deterministic onset-strength autocorrelation BPM estimator (60-180 BPM)."""
    if audio.size == 0 or sample_rate <= 0:
        return None
    mono = audio if audio.ndim == 1 else np.mean(audio, axis=1)
    duration = mono.shape[0] / float(sample_rate)
    if duration < 3.0 or float(np.max(np.abs(mono))) <= 1e-6:
        return None

    # 20 ms frame hop (50 Hz envelope sample rate)
    hop = max(1, int(round(sample_rate * 0.02)))
    win = max(hop, int(round(sample_rate * 0.04)))
    n_frames = (mono.shape[0] - win) // hop
    if n_frames < 80:
        return None

    # Compute RMS energy envelope in vectorized chunks
    starts = np.arange(n_frames) * hop
    rms = np.empty(n_frames, dtype=np.float64)
    for idx, s in enumerate(starts):
        seg = mono[s : s + win]
        rms[idx] = float(np.sqrt(np.mean(seg * seg) + 1e-12))

    # Half-wave rectified first-order difference = onset strength novelty curve
    onset = np.maximum(0.0, np.diff(rms, prepend=rms[0]))
    mean_o = float(np.mean(onset))
    std_o = float(np.std(onset))
    if std_o <= 1e-9:
        return None
    onset_norm = (onset - mean_o) / std_o

    env_sr = sample_rate / float(hop)  # ~50 Hz
    min_lag = max(1, int(round(env_sr * 60.0 / 180.0)))  # 180 BPM
    max_lag = min(n_frames // 2, int(round(env_sr * 60.0 / 60.0)))  # 60 BPM
    if max_lag <= min_lag:
        return None

    # Normalized autocorrelation across tempo lag range
    best_lag = min_lag
    best_score = -1.0
    for lag in range(min_lag, max_lag + 1):
        a = onset_norm[:-lag]
        b = onset_norm[lag:]
        denom = float(np.sqrt(np.dot(a, a) * np.dot(b, b)))
        if denom <= 1e-12:
            continue
        score = float(np.dot(a, b) / denom)
        # Gentle prior favoring common production tempos (85-145 BPM) to avoid half/double-time jumps
        cand_bpm = 60.0 * env_sr / float(lag)
        prior = 1.0 + 0.08 * np.exp(-0.5 * ((cand_bpm - 118.0) / 32.0) ** 2)
        weighted = score * float(prior)
        if weighted > best_score:
            best_score = weighted
            best_lag = lag

    if best_score < 0.08:
        return None

    bpm = 60.0 * env_sr / float(best_lag)
    # Fold into standard 65-175 BPM range
    while bpm < 65.0:
        bpm *= 2.0
    while bpm > 175.0:
        bpm /= 2.0
    return round(float(bpm), 1)


def detect_song_sections(
    duration_sec: float,
    short_term_lufs_series: list[float],
) -> list[SectionMarker]:
    """Coarse deterministic energy-contour section markers (Intro, Verse, Chorus/Drop, Outro)."""
    if duration_sec <= 0.0 or not short_term_lufs_series:
        return []

    n = len(short_term_lufs_series)
    if duration_sec < 6.0 or n < 4:
        avg = float(np.mean(short_term_lufs_series))
        return [
            SectionMarker(
                label="Full Section",
                start_sec=0.0,
                end_sec=round(duration_sec, 1),
                avg_lufs=round(avg, 1),
            )
        ]

    arr = np.asarray(short_term_lufs_series, dtype=np.float64)
    # Smooth with a 3-second moving average
    kernel = np.ones(min(3, n), dtype=np.float64) / float(min(3, n))
    smooth = np.convolve(arr, kernel, mode="same")

    active_mask = smooth > -60.0
    if not np.any(active_mask):
        return [
            SectionMarker(
                label="Quiet / Intro",
                start_sec=0.0,
                end_sec=round(duration_sec, 1),
                avg_lufs=round(float(np.mean(arr)), 1),
            )
        ]

    p75 = float(np.percentile(smooth[active_mask], 75))
    p35 = float(np.percentile(smooth[active_mask], 35))
    peak_val = float(np.max(smooth))
    drop_thresh = max(p75, peak_val - 2.5)
    quiet_thresh = min(p35, peak_val - 6.0)

    # Divide track into 4-6 balanced time windows and classify by smoothed energy relative to track contour
    num_segments = 4 if duration_sec < 45.0 else (5 if duration_sec < 120.0 else 6)
    edges = np.linspace(0.0, duration_sec, num_segments + 1)

    raw_sections: list[SectionMarker] = []
    for i in range(num_segments):
        s_sec = float(edges[i])
        e_sec = float(edges[i + 1])
        i0 = max(0, min(n - 1, int(np.floor((s_sec / duration_sec) * n))))
        i1 = max(i0 + 1, min(n, int(np.ceil((e_sec / duration_sec) * n))))
        seg_avg = float(np.mean(smooth[i0:i1]))

        if i == 0 and seg_avg <= quiet_thresh + 2.0:
            label = "Intro"
        elif i == num_segments - 1 and seg_avg <= quiet_thresh + 2.0:
            label = "Outro"
        elif seg_avg >= drop_thresh:
            label = "Chorus / Drop"
        elif i == 0:
            label = "Intro"
        elif i == num_segments - 1:
            label = "Outro"
        else:
            label = "Verse / Build"

        raw_sections.append(
            SectionMarker(
                label=label,
                start_sec=round(s_sec, 1),
                end_sec=round(e_sec, 1),
                avg_lufs=round(seg_avg, 1),
            )
        )

    # Merge adjacent identical labels for cleaner timeline display
    merged: list[SectionMarker] = []
    for sec in raw_sections:
        if merged and merged[-1].label == sec.label:
            prev = merged[-1]
            dur_prev = max(0.1, prev.end_sec - prev.start_sec)
            dur_cur = max(0.1, sec.end_sec - sec.start_sec)
            blended_lufs = (prev.avg_lufs * dur_prev + sec.avg_lufs * dur_cur) / (
                dur_prev + dur_cur
            )
            merged[-1] = SectionMarker(
                label=prev.label,
                start_sec=prev.start_sec,
                end_sec=sec.end_sec,
                avg_lufs=round(blended_lufs, 1),
            )
        else:
            merged.append(sec)

    return merged


def analyze_song_structure(
    audio: np.ndarray,
    sample_rate: int,
    duration_sec: float,
    short_term_lufs_series: list[float],
) -> StructureResult:
    return StructureResult(
        bpm=estimate_bpm(audio, sample_rate),
        sections=detect_song_sections(duration_sec, short_term_lufs_series),
    )

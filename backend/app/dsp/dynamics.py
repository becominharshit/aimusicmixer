from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class DynamicsResult:
    crest_factor_db: float
    plr_db: float
    psr_db: float
    rms_dbfs: float


def compute_dynamics_metrics(
    samples: np.ndarray,
    sample_peak_dbfs: float,
    true_peak_dbtp: float,
    short_term_max_lufs: float,
    integrated_lufs: float | None = None,
) -> DynamicsResult:
    if samples.size == 0:
        return DynamicsResult(crest_factor_db=0.0, plr_db=0.0, psr_db=0.0, rms_dbfs=-120.0)

    # Chunked RMS calculation avoids allocating a full-track float64 square copy in RAM
    chunk_len = 262144
    n_samples = samples.shape[0]
    peak_lin = 0.0
    sum_sq = 0.0
    for start in range(0, n_samples, chunk_len):
        chunk = samples[start : start + chunk_len]
        c_max = max(abs(float(chunk.min())), abs(float(chunk.max())))
        if c_max > peak_lin:
            peak_lin = c_max
        sum_sq += float(np.sum(chunk * chunk))

    if peak_lin <= 1e-12:
        return DynamicsResult(crest_factor_db=0.0, plr_db=0.0, psr_db=0.0, rms_dbfs=-120.0)

    rms = float(np.sqrt(sum_sq / max(1, samples.size)))
    rms_dbfs = float(20.0 * np.log10(max(rms, 1e-12)))
    crest_factor = max(0.0, sample_peak_dbfs - rms_dbfs)
    psr = max(0.0, true_peak_dbtp - short_term_max_lufs) if short_term_max_lufs > -69.5 else 0.0
    if integrated_lufs is not None and integrated_lufs > -69.5:
        plr = max(0.0, true_peak_dbtp - integrated_lufs)
    else:
        plr = psr

    return DynamicsResult(
        crest_factor_db=round(crest_factor, 2),
        plr_db=round(plr, 2),
        psr_db=round(psr, 2),
        rms_dbfs=round(rms_dbfs, 2),
    )

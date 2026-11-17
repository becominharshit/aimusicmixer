from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class DynamicsResult:
    crest_factor_db: float
    psr_db: float
    rms_dbfs: float


def compute_dynamics_metrics(
    samples: np.ndarray,
    sample_peak_dbfs: float,
    true_peak_dbtp: float,
    short_term_max_lufs: float,
) -> DynamicsResult:
    if samples.size == 0 or float(np.max(np.abs(samples))) <= 1e-12:
        return DynamicsResult(crest_factor_db=0.0, psr_db=0.0, rms_dbfs=-120.0)

    rms = float(np.sqrt(np.mean(np.square(samples))))
    rms_dbfs = float(20.0 * np.log10(max(rms, 1e-12)))
    crest_factor = max(0.0, sample_peak_dbfs - rms_dbfs)
    psr = max(0.0, true_peak_dbtp - short_term_max_lufs) if short_term_max_lufs > -69.5 else 0.0

    return DynamicsResult(
        crest_factor_db=round(crest_factor, 2),
        psr_db=round(psr, 2),
        rms_dbfs=round(rms_dbfs, 2),
    )

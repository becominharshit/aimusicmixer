from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import stft, welch

from app.schemas.report import BandName, GenreType, SpectralBand

BAND_DEFINITIONS: list[tuple[BandName, str, float, float]] = [
    ("sub", "20-60", 20.0, 60.0),
    ("low", "60-250", 60.0, 250.0),
    ("low_mid", "250-800", 250.0, 800.0),
    ("high_mid", "800-4000", 800.0, 4000.0),
    ("presence", "4000-10000", 4000.0, 10000.0),
    ("air", "10000-20000", 10000.0, 20000.0),
]

# Genre median relative offsets (dB relative to mean band energy across the 6 bands).
# Using relative spectral tilt keeps tonal balance invariant to overall track gain.
GENRE_RELATIVE_PROFILES: dict[GenreType, dict[BandName, float]] = {
    "electronic": {
        "sub": 1.8,
        "low": 3.0,
        "low_mid": 0.4,
        "high_mid": -0.4,
        "presence": -1.6,
        "air": -3.2,
    },
    "pop": {
        "sub": 0.5,
        "low": 2.4,
        "low_mid": 0.8,
        "high_mid": 0.2,
        "presence": -1.2,
        "air": -2.7,
    },
    "hip_hop": {
        "sub": 3.2,
        "low": 3.4,
        "low_mid": 0.2,
        "high_mid": -1.0,
        "presence": -2.1,
        "air": -3.7,
    },
    "rock": {
        "sub": -1.0,
        "low": 2.2,
        "low_mid": 1.6,
        "high_mid": 1.0,
        "presence": -1.1,
        "air": -2.7,
    },
    "acoustic": {
        "sub": -2.8,
        "low": 1.5,
        "low_mid": 2.0,
        "high_mid": 1.1,
        "presence": -0.6,
        "air": -1.2,
    },
    "ambient": {
        "sub": 0.8,
        "low": 1.8,
        "low_mid": 1.4,
        "high_mid": -0.3,
        "presence": -1.6,
        "air": -2.1,
    },
    "other": {
        "sub": 0.8,
        "low": 2.4,
        "low_mid": 0.8,
        "high_mid": 0.0,
        "presence": -1.4,
        "air": -2.6,
    },
}


@dataclass
class SpectralAnalysisResult:
    bands: list[SpectralBand]
    band_peak_windows: dict[BandName, tuple[float, float]]


def _compute_band_energies(samples: np.ndarray, sample_rate: int) -> dict[BandName, float]:
    n_samples = samples.shape[0]
    nperseg = min(16384, max(256, n_samples))
    n_channels = samples.shape[1] if samples.ndim == 2 else 1

    # Average power spectrum across channels (preserves stereo total energy without phase cancellation)
    avg_power = None
    freqs = None
    for ch in range(n_channels):
        sig = samples[:, ch] if samples.ndim == 2 else samples
        f, pxx = welch(
            sig,
            fs=sample_rate,
            window="hann",
            nperseg=nperseg,
            noverlap=nperseg // 2,
            scaling="spectrum",
        )
        freqs = f
        avg_power = pxx if avg_power is None else (avg_power + pxx)

    assert freqs is not None and avg_power is not None
    avg_power = avg_power / max(1, n_channels)

    band_energies: dict[BandName, float] = {}
    nyquist = sample_rate / 2.0
    for band_name, _, f_low, f_high in BAND_DEFINITIONS:
        if f_low >= nyquist:
            band_energies[band_name] = -70.0
            continue
        upper = min(f_high, nyquist)
        mask = (freqs >= f_low) & (freqs < upper)
        if not np.any(mask):
            band_energies[band_name] = -70.0
            continue
        band_power = float(np.sum(avg_power[mask]))
        db = float(10.0 * np.log10(max(band_power, 1e-12)))
        band_energies[band_name] = round(max(-70.0, db), 2)
    return band_energies


def detect_band_peak_window(
    samples: np.ndarray,
    sample_rate: int,
    f_low: float,
    f_high: float,
    window_sec: float = 12.0,
) -> tuple[float, float]:
    """Locate the time window [start_sec, end_sec] where a frequency band has peak energy."""
    duration_sec = samples.shape[0] / max(sample_rate, 1)
    if duration_sec <= 2.0:
        return (0.0, round(duration_sec, 2))

    # Power-sum channels to avoid mid-side cancellation in STFT localization
    nperseg = min(4096, max(256, samples.shape[0]))
    hop = max(256, nperseg // 2)
    n_channels = samples.shape[1] if samples.ndim == 2 else 1

    power_spec = None
    freqs = None
    times = None
    for ch in range(n_channels):
        sig = samples[:, ch] if samples.ndim == 2 else samples
        f, t, zxx = stft(sig, fs=sample_rate, nperseg=nperseg, noverlap=nperseg - hop)
        p = np.square(np.abs(zxx))
        freqs = f
        times = t
        power_spec = p if power_spec is None else (power_spec + p)

    assert freqs is not None and times is not None and power_spec is not None
    mask = (freqs >= f_low) & (freqs < min(f_high, sample_rate / 2.0))
    if not np.any(mask) or len(times) == 0:
        return (0.0, round(min(duration_sec, window_sec), 2))

    band_time_power = np.sum(power_spec[mask, :], axis=0)
    peak_idx = int(np.argmax(band_time_power))
    center_sec = float(times[peak_idx])
    half = min(window_sec / 2.0, duration_sec / 2.0)
    start_sec = max(0.0, center_sec - half)
    end_sec = min(duration_sec, start_sec + min(window_sec, duration_sec))
    if end_sec - start_sec < min(4.0, duration_sec):
        start_sec = max(0.0, end_sec - min(window_sec, duration_sec))
    return (round(start_sec, 1), round(end_sec, 1))


def compute_spectral_profile(
    samples: np.ndarray,
    sample_rate: int,
    genre: GenreType = "electronic",
) -> SpectralAnalysisResult:
    """Compute 6-band octave energy profile and genre-relative balance deltas."""
    if samples.size == 0 or float(np.max(np.abs(samples))) <= 1e-12:
        bands = [
            SpectralBand(
                band=b,
                range_hz=r,
                energy_db=-70.0,
                delta_vs_genre_median_db=0.0,
                genre_target_low_db=-70.0,
                genre_target_high_db=-70.0,
            )
            for b, r, _, _ in BAND_DEFINITIONS
        ]
        windows = {b: (0.0, round(len(samples) / max(sample_rate, 1), 1)) for b, _, _, _ in BAND_DEFINITIONS}
        return SpectralAnalysisResult(bands=bands, band_peak_windows=windows)

    band_energies = _compute_band_energies(samples, sample_rate)
    mean_energy = float(np.mean(list(band_energies.values())))
    profile = GENRE_RELATIVE_PROFILES.get(genre, GENRE_RELATIVE_PROFILES["other"])

    bands: list[SpectralBand] = []
    windows: dict[BandName, tuple[float, float]] = {}

    for band_name, range_hz, f_low, f_high in BAND_DEFINITIONS:
        energy = band_energies[band_name]
        relative_energy = energy - mean_energy
        expected_rel = profile[band_name]
        delta = round(relative_energy - expected_rel, 2)
        expected_abs = mean_energy + expected_rel
        bands.append(
            SpectralBand(
                band=band_name,
                range_hz=range_hz,
                energy_db=energy,
                delta_vs_genre_median_db=delta,
                genre_target_low_db=round(expected_abs - 2.0, 2),
                genre_target_high_db=round(expected_abs + 2.0, 2),
            )
        )
        windows[band_name] = detect_band_peak_window(samples, sample_rate, f_low, f_high)

    return SpectralAnalysisResult(bands=bands, band_peak_windows=windows)

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly, welch

from app.dsp.ingest import AudioIngestionError, LoadedAudio, load_audio_file
from app.dsp.loudness import compute_loudness_metrics
from app.dsp.peaks import compute_peak_metrics
from app.dsp.spectrum import BAND_DEFINITIONS
from app.dsp.stereo import compute_stereo_metrics
from app.schemas.report import BandName, StemAnalysis, StemMetric, StemOverlapPair, StemSumResidual


def _spectral_centroid_and_bands(samples: np.ndarray, sample_rate: int) -> tuple[float, dict[str, float]]:
    if samples.size == 0 or float(np.max(np.abs(samples))) <= 1e-12:
        return 0.0, {b: -70.0 for b, _, _, _ in BAND_DEFINITIONS}

    nperseg = min(16384, max(256, samples.shape[0]))
    n_channels = samples.shape[1] if samples.ndim == 2 else 1
    avg_power = None
    freqs = None
    for ch in range(n_channels):
        sig = samples[:, ch] if samples.ndim == 2 else samples
        f, pxx = welch(sig, fs=sample_rate, window="hann", nperseg=nperseg, scaling="spectrum")
        freqs = f
        avg_power = pxx if avg_power is None else (avg_power + pxx)
    assert freqs is not None and avg_power is not None
    avg_power = avg_power / max(1, n_channels)

    total_p = float(np.sum(avg_power))
    centroid = float(np.sum(freqs * avg_power) / total_p) if total_p > 1e-12 else 0.0

    band_energies: dict[str, float] = {}
    nyquist = sample_rate / 2.0
    for band_name, _, f_low, f_high in BAND_DEFINITIONS:
        if f_low >= nyquist:
            band_energies[band_name] = -70.0
            continue
        mask = (freqs >= f_low) & (freqs < min(f_high, nyquist))
        if not np.any(mask):
            band_energies[band_name] = -70.0
            continue
        p_band = float(np.sum(avg_power[mask]))
        band_energies[band_name] = round(max(-70.0, float(10.0 * np.log10(max(p_band, 1e-12)))), 2)

    return round(centroid, 1), band_energies


def _clean_stem_name(filename: str) -> str:
    stem = Path(filename).stem
    return stem.replace("_", " ").replace("-", " ").strip() or filename


def _resample_audio(samples: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr:
        return samples
    g = math.gcd(src_sr, dst_sr)
    up = dst_sr // g
    down = src_sr // g
    return resample_poly(samples, up=up, down=down, axis=0)


def _band_cross_correlation(
    sig_a: np.ndarray,
    sig_b: np.ndarray,
    sample_rate: int,
    f_low: float,
    f_high: float,
) -> float | None:
    """Measure normalized Pearson cross-correlation between two stems inside a target frequency band."""
    n = min(sig_a.shape[0], sig_b.shape[0])
    if n < 64 or sample_rate <= 0:
        return None
    mono_a = np.mean(sig_a[:n], axis=1) if sig_a.ndim == 2 else sig_a[:n]
    mono_b = np.mean(sig_b[:n], axis=1) if sig_b.ndim == 2 else sig_b[:n]

    freqs = np.fft.rfftfreq(n, d=1.0 / sample_rate)
    fa = np.fft.rfft(mono_a)
    fb = np.fft.rfft(mono_b)
    mask = (freqs >= f_low) & (freqs < min(f_high, sample_rate / 2.0))
    if not np.any(mask):
        return None

    fa_band = fa[mask]
    fb_band = fb[mask]
    denom = float(np.sqrt(np.sum(np.abs(fa_band) ** 2) * np.sum(np.abs(fb_band) ** 2)))
    if denom <= 1e-12:
        return 0.0
    corr = float(np.real(np.sum(fa_band * np.conj(fb_band))) / denom)
    return round(float(np.clip(corr, -1.0, 1.0)), 3)


def analyze_user_stems(
    stem_files: list[tuple[str, Path]],
    mix_audio: LoadedAudio | None = None,
    max_total_bytes: int | None = None,
) -> StemAnalysis:
    """Analyze 2-8 user-provided stems with alignment verification, overlap checks, and phase interaction."""
    if len(stem_files) < 2 or len(stem_files) > 8:
        raise AudioIngestionError(
            f"Stem analysis requires between 2 and 8 user-supplied stems (received {len(stem_files)})."
        )

    total_bytes = sum(path.stat().st_size for _, path in stem_files if path.exists())
    if max_total_bytes is not None and total_bytes > max_total_bytes:
        raise AudioIngestionError(
            f"Total stem upload ({total_bytes / (1024 * 1024):.1f} MB) exceeds limit."
        )

    loaded: list[tuple[str, Path, LoadedAudio]] = []
    for filename, path in stem_files:
        audio = load_audio_file(path)
        loaded.append((filename, path, audio))

    durations = [item[2].duration_sec for item in loaded]
    sample_rates = {item[2].sample_rate for item in loaded}
    channel_counts = {item[2].channels for item in loaded}
    max_delta_ms = round((max(durations) - min(durations)) * 1000.0, 2)
    warnings: list[str] = []

    if len(sample_rates) > 1:
        warnings.append(
            f"Mixed stem sample rates detected ({sorted(sample_rates)} Hz); resampled to {loaded[0][2].sample_rate} Hz for sum & phase interaction."
        )

    if len(channel_counts) > 1:
        warnings.append(
            f"Mixed stem channel counts detected ({sorted(channel_counts)} channels: mono + stereo). Verify intended panning/routing on mono stems."
        )

    alignment_passed = max_delta_ms <= 50.0
    if not alignment_passed:
        warnings.append(
            f"Stem duration mismatch of {max_delta_ms:.1f} ms exceeds the 50 ms alignment tolerance. Export all stems from the same bar 1 bounce point."
        )

    if mix_audio is not None:
        mix_delta_ms = abs(mix_audio.duration_sec - float(np.mean(durations))) * 1000.0
        if mix_delta_ms > 100.0:
            warnings.append(
                f"Stems differ from primary stereo mix duration by {mix_delta_ms:.0f} ms; residual metric is approximate."
            )

    stem_metrics: list[StemMetric] = []
    for idx, (filename, path, audio) in enumerate(loaded):
        loudness = compute_loudness_metrics(audio.samples, audio.sample_rate)
        peaks = compute_peak_metrics(audio.samples, audio.sample_rate, source_path=None)
        stereo = compute_stereo_metrics(audio.samples, audio.sample_rate)
        centroid, bands = _spectral_centroid_and_bands(audio.samples, audio.sample_rate)
        stem_metrics.append(
            StemMetric(
                stem_id=f"stem_{idx + 1}",
                name=_clean_stem_name(filename),
                filename=filename,
                duration_sec=audio.duration_sec,
                sample_rate_hz=audio.sample_rate,
                channels=audio.channels,
                integrated_lufs=loudness.integrated_lufs,
                sample_peak_dbfs=peaks.sample_peak_dbfs,
                true_peak_dbtp=peaks.true_peak_dbtp,
                headroom_db=round(0.0 - peaks.true_peak_dbtp, 2),
                phase_correlation_avg=stereo.phase_correlation_avg,
                spectral_centroid_hz=centroid,
                band_energies_db=bands,
            )
        )

    # Pre-align stems to common sample rate for phase interaction analysis
    ref_sr = loaded[0][2].sample_rate
    resampled_arrays = [
        _resample_audio(audio.samples, audio.sample_rate, ref_sr)
        for _, _, audio in loaded
    ]

    # Pairwise frequency-band overlap & phase interaction detection
    # Strictly flags *potential* spectral overlap/masking, never claims definitive psychoacoustic proof.
    overlap_pairs: list[StemOverlapPair] = []
    band_range_map: dict[BandName, str] = {b: r for b, r, _, _ in BAND_DEFINITIONS}
    pair_idx = 0
    for i in range(len(stem_metrics)):
        for j in range(i + 1, len(stem_metrics)):
            sa = stem_metrics[i]
            sb = stem_metrics[j]
            for band_name, range_hz, f_low, f_high in BAND_DEFINITIONS:
                if band_name not in {"sub", "low", "low_mid", "high_mid"}:
                    continue
                ea = sa.band_energies_db.get(band_name, -70.0)
                eb = sb.band_energies_db.get(band_name, -70.0)
                if ea > -32.0 and eb > -32.0 and abs(ea - eb) <= 7.0:
                    min_e = min(ea, eb)
                    score = round(float(np.clip((min_e + 36.0) / 24.0, 0.0, 1.0)), 2)
                    if score >= 0.45:
                        pair_idx += 1
                        combined_linear = 10 ** (ea / 10.0) + 10 ** (eb / 10.0)
                        combined_db = 10.0 * np.log10(max(combined_linear, 1e-12))
                        excess = round(float(combined_db - max(ea, eb)), 2)
                        phase_corr = (
                            _band_cross_correlation(
                                resampled_arrays[i],
                                resampled_arrays[j],
                                ref_sr,
                                f_low,
                                f_high,
                            )
                            if alignment_passed
                            else None
                        )
                        phase_risk = phase_corr is not None and phase_corr < -0.15
                        severity = (
                            "alert"
                            if (phase_risk or (score >= 0.78 and band_name in {"sub", "low", "low_mid"}))
                            else "caution"
                        )
                        phase_clause = (
                            f" Band phase interaction measures {phase_corr:+.2f} (possible cancellation when summed)."
                            if phase_risk
                            else (
                                f" Band phase interaction measures {phase_corr:+.2f}."
                                if phase_corr is not None
                                else ""
                            )
                        )
                        overlap_pairs.append(
                            StemOverlapPair(
                                evidence_id=f"ev_stem_overlap_{pair_idx:02d}",
                                stem_a=sa.name,
                                stem_b=sb.name,
                                band=band_name,
                                range_hz=band_range_map[band_name],
                                overlap_score=score,
                                combined_excess_db=excess,
                                phase_interaction_corr=phase_corr,
                                phase_cancellation_risk=phase_risk,
                                severity=severity,
                                note=(
                                    f"Possible frequency masking in {range_hz} Hz between '{sa.name}' ({ea:.1f} dB) and '{sb.name}' ({eb:.1f} dB).{phase_clause} "
                                    f"Audition both soloed together before deciding if carving 1.5–3 dB or checking polarity improves clarity."
                                ),
                            )
                        )

    # Sort strongest overlaps first, cap cleanly to top 8
    overlap_pairs.sort(key=lambda x: x.overlap_score, reverse=True)
    overlap_pairs = overlap_pairs[:8]

    # Compare stem sum against stereo mix if present & alignment passed
    residual: StemSumResidual | None = None
    if mix_audio is not None and alignment_passed:
        target_sr = mix_audio.sample_rate
        aligned_arrays: list[np.ndarray] = []
        for _, _, audio in loaded:
            arr = _resample_audio(audio.samples, audio.sample_rate, target_sr)
            if arr.shape[1] == 1 and mix_audio.channels == 2:
                arr = np.repeat(arr, 2, axis=1)
            elif arr.shape[1] == 2 and mix_audio.channels == 1:
                arr = np.mean(arr, axis=1, keepdims=True)
            aligned_arrays.append(arr)

        min_len = min(mix_audio.samples.shape[0], *(a.shape[0] for a in aligned_arrays))
        if min_len > 0:
            stem_sum = np.zeros_like(mix_audio.samples[:min_len])
            for arr in aligned_arrays:
                stem_sum += arr[:min_len]
            mix_slice = mix_audio.samples[:min_len]
            mix_rms = float(np.sqrt(np.mean(np.square(mix_slice))))
            sum_rms = float(np.sqrt(np.mean(np.square(stem_sum))))
            rms_diff = float(20.0 * np.log10(max(mix_rms, 1e-12)) - 20.0 * np.log10(max(sum_rms, 1e-12)))
            mix_peak = float(np.max(np.abs(mix_slice)))
            sum_peak = float(np.max(np.abs(stem_sum)))
            peak_diff = float(20.0 * np.log10(max(mix_peak, 1e-12)) - 20.0 * np.log10(max(sum_peak, 1e-12)))

            m_flat = mix_slice.ravel() - np.mean(mix_slice)
            s_flat = stem_sum.ravel() - np.mean(stem_sum)
            denom = float(np.sqrt(np.sum(np.square(m_flat)) * np.sum(np.square(s_flat))))
            corr = float(np.clip(np.sum(m_flat * s_flat) / denom, -1.0, 1.0)) if denom > 1e-12 else 0.0

            residual = StemSumResidual(
                rms_diff_db=round(rms_diff, 2),
                peak_diff_db=round(peak_diff, 2),
                correlation_with_mix=round(corr, 3),
                note=(
                    "Difference between the stereo mixdown and raw stem sum typically reflects master-bus compression, saturation, limiting, or return-track effects."
                ),
            )

    return StemAnalysis(
        alignment_passed=alignment_passed,
        max_duration_delta_ms=max_delta_ms,
        alignment_warnings=warnings,
        stems=stem_metrics,
        overlap_matrix=overlap_pairs,
        stem_sum_residual=residual,
    )

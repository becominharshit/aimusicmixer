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
    avg_psd = None
    freqs = None
    for ch in range(n_channels):
        sig = samples[:, ch] if samples.ndim == 2 else samples
        f, pxx = welch(
            np.asarray(sig, dtype=np.float64),
            fs=sample_rate,
            window="hann",
            nperseg=nperseg,
            noverlap=nperseg // 2,
            scaling="density",
        )
        freqs = f
        avg_psd = pxx if avg_psd is None else (avg_psd + pxx)
    assert freqs is not None and avg_psd is not None
    avg_psd = avg_psd / max(1, n_channels)
    df = float(freqs[1] - freqs[0]) if len(freqs) > 1 else 1.0

    total_p = float(np.sum(avg_psd) * df)
    centroid = float((np.sum(freqs * avg_psd) * df) / total_p) if total_p > 1e-12 else 0.0

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
        p_band = float(np.sum(avg_psd[mask]) * df)
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
    return resample_poly(samples, up=up, down=down, axis=0).astype(np.float32, copy=False)


def _detect_first_onset_sec(samples: np.ndarray, sample_rate: int, threshold: float = 0.01) -> float | None:
    """Return timestamp (seconds) of the first sample exceeding -40 dBFS."""
    if samples.size == 0 or sample_rate <= 0:
        return None
    chunk_len = 65536
    for start in range(0, samples.shape[0], chunk_len):
        chunk = samples[start : start + chunk_len]
        peak = np.max(np.abs(chunk), axis=1) if chunk.ndim == 2 else np.abs(chunk)
        hits = np.flatnonzero(peak >= threshold)
        if hits.size > 0:
            return round(float((start + int(hits[0])) / sample_rate), 3)
    return None


def _band_cross_correlation(
    sig_a: np.ndarray,
    sig_b: np.ndarray,
    sample_rate: int,
    f_low: float,
    f_high: float,
) -> float | None:
    """
    Measure normalized Pearson cross-correlation between two stems inside a target frequency band
    using chunked overlapping FFT frames to stay memory-bounded on 512 MB containers.
    """
    n = min(sig_a.shape[0], sig_b.shape[0])
    if n < 64 or sample_rate <= 0:
        return None

    frame_len = min(16384, max(256, n))
    hop = max(256, frame_len // 2)
    freqs = np.fft.rfftfreq(frame_len, d=1.0 / sample_rate)
    mask = (freqs >= f_low) & (freqs < min(f_high, sample_rate / 2.0))
    if not np.any(mask):
        return None

    window = np.hanning(frame_len).astype(np.float64)
    cross_real = 0.0
    pow_a = 0.0
    pow_b = 0.0

    start = 0
    while start < n:
        end = min(n, start + frame_len)
        seg_a = sig_a[start:end]
        seg_b = sig_b[start:end]
        ma = np.mean(seg_a, axis=1, dtype=np.float64) if seg_a.ndim == 2 else np.asarray(seg_a, dtype=np.float64)
        mb = np.mean(seg_b, axis=1, dtype=np.float64) if seg_b.ndim == 2 else np.asarray(seg_b, dtype=np.float64)

        if len(ma) < frame_len:
            pad = frame_len - len(ma)
            ma = np.pad(ma, (0, pad))
            mb = np.pad(mb, (0, pad))

        fa = np.fft.rfft(ma * window)[mask]
        fb = np.fft.rfft(mb * window)[mask]
        cross_real += float(np.real(np.sum(fa * np.conj(fb))))
        pow_a += float(np.sum(np.abs(fa) ** 2))
        pow_b += float(np.sum(np.abs(fb) ** 2))
        if end >= n:
            break
        start += hop

    denom = math.sqrt(pow_a * pow_b)
    if denom <= 1e-12:
        return 0.0
    corr = cross_real / denom
    return round(float(np.clip(corr, -1.0, 1.0)), 3)


def analyze_user_stems(
    stem_files: list[tuple[str, Path]],
    mix_audio: LoadedAudio | None = None,
    max_total_bytes: int | None = None,
) -> StemAnalysis:
    """Analyze 2-8 user-provided stems with duration + onset alignment checks, overlap checks, and streamed residual."""
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
    onsets_sec: list[float] = []
    for filename, path in stem_files:
        audio = load_audio_file(path)
        loaded.append((filename, path, audio))
        onset = _detect_first_onset_sec(audio.samples, audio.sample_rate)
        if onset is not None:
            onsets_sec.append(onset)

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

    # Acoustic onset sanity check: flag abrupt small shift (50ms..1500ms) across active stems with matching lengths
    if len(onsets_sec) >= 2:
        onset_spread_ms = (max(onsets_sec) - min(onsets_sec)) * 1000.0
        if 50.0 < onset_spread_ms <= 1500.0:
            warnings.append(
                f"Acoustic stem onsets diverge by {onset_spread_ms:.0f} ms across stems. Verify stems weren't trimmed or shifted despite matching durations."
            )

    if mix_audio is not None:
        mix_delta_ms = abs(mix_audio.duration_sec - float(np.mean(durations))) * 1000.0
        if mix_delta_ms > 100.0:
            warnings.append(
                f"Stems differ from primary stereo mix duration by {mix_delta_ms:.0f} ms; residual metric is approximate."
            )

    stem_metrics: list[StemMetric] = []
    for idx, (filename, _, audio) in enumerate(loaded):
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

    ref_sr = loaded[0][2].sample_rate
    resampled_arrays = [
        _resample_audio(audio.samples, audio.sample_rate, ref_sr)
        for _, _, audio in loaded
    ]

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
                        combined_db = 10.0 * math.log10(max(combined_linear, 1e-12))
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

    overlap_pairs.sort(key=lambda x: x.overlap_score, reverse=True)
    overlap_pairs = overlap_pairs[:8]

    # Streamed 32-bit float chunk accumulation for stem sum residual (low RAM footprint)
    residual: StemSumResidual | None = None
    if mix_audio is not None and alignment_passed:
        target_sr = mix_audio.sample_rate
        target_channels = mix_audio.channels
        aligned_refs: list[np.ndarray] = []
        for idx, (_, _, audio) in enumerate(loaded):
            if audio.sample_rate == target_sr:
                aligned_refs.append(audio.samples)
            elif ref_sr == target_sr:
                aligned_refs.append(resampled_arrays[idx])
            else:
                aligned_refs.append(_resample_audio(audio.samples, audio.sample_rate, target_sr))

        min_len = min(mix_audio.samples.shape[0], *(a.shape[0] for a in aligned_refs))
        if min_len > 0:
            chunk_len = 65536
            mix_sum_sq = 0.0
            stem_sum_sq = 0.0
            mix_peak = 0.0
            sum_peak = 0.0
            mix_dot_stem = 0.0
            mix_sum_val = 0.0
            stem_sum_val = 0.0
            total_elem = 0

            for start in range(0, min_len, chunk_len):
                end = min(min_len, start + chunk_len)
                seg_len = end - start
                mix_seg = np.asarray(mix_audio.samples[start:end], dtype=np.float32)
                stem_acc = np.zeros((seg_len, target_channels), dtype=np.float32)

                for arr in aligned_refs:
                    a_seg = arr[start:end]
                    if a_seg.shape[1] == 1 and target_channels == 2:
                        stem_acc += np.repeat(a_seg, 2, axis=1)
                    elif a_seg.shape[1] == 2 and target_channels == 1:
                        stem_acc += np.mean(a_seg, axis=1, keepdims=True, dtype=np.float32)
                    else:
                        stem_acc += a_seg[:, :target_channels]

                mix_f64 = mix_seg.astype(np.float64)
                stem_f64 = stem_acc.astype(np.float64)

                mix_sum_sq += float(np.sum(mix_f64 * mix_f64))
                stem_sum_sq += float(np.sum(stem_f64 * stem_f64))
                mix_dot_stem += float(np.sum(mix_f64 * stem_f64))
                mix_sum_val += float(np.sum(mix_f64))
                stem_sum_val += float(np.sum(stem_f64))
                total_elem += mix_f64.size

                m_pk = max(abs(float(mix_seg.min())), abs(float(mix_seg.max())))
                s_pk = max(abs(float(stem_acc.min())), abs(float(stem_acc.max())))
                if m_pk > mix_peak:
                    mix_peak = m_pk
                if s_pk > sum_peak:
                    sum_peak = s_pk

            mix_rms = math.sqrt(mix_sum_sq / max(1, total_elem))
            sum_rms = math.sqrt(stem_sum_sq / max(1, total_elem))
            rms_diff = (20.0 * math.log10(max(mix_rms, 1e-12))) - (20.0 * math.log10(max(sum_rms, 1e-12)))
            peak_diff = (20.0 * math.log10(max(mix_peak, 1e-12))) - (20.0 * math.log10(max(sum_peak, 1e-12)))

            # Pearson correlation across streamed sums
            n_el = max(1, total_elem)
            cov = mix_dot_stem - (mix_sum_val * stem_sum_val) / n_el
            var_m = max(0.0, mix_sum_sq - (mix_sum_val * mix_sum_val) / n_el)
            var_s = max(0.0, stem_sum_sq - (stem_sum_val * stem_sum_val) / n_el)
            denom = math.sqrt(var_m * var_s)
            corr = float(np.clip(cov / denom, -1.0, 1.0)) if denom > 1e-12 else 0.0

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

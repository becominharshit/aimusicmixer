from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.dsp import (
    LoadedAudio,
    compute_dynamics_metrics,
    compute_loudness_metrics,
    compute_peak_metrics,
    compute_spectral_profile,
    compute_stereo_metrics,
    create_playback_proxy,
    load_audio_file,
)
from app.rules import compute_streaming_estimates, evaluate_mix_findings
from app.schemas.report import (
    AnalysisContext,
    AnalysisReport,
    AudioMetadata,
    GlobalMetrics,
    PrivacyAudit,
    TimeSeries,
)


def analyze_audio_to_report(
    session_id: str,
    source_path: Path,
    original_filename: str,
    proxy_dir: Path,
    proxy_name: str,
    proxy_url: str,
    context: AnalysisContext,
    max_file_bytes: int | None = None,
) -> tuple[AnalysisReport, LoadedAudio]:
    """Run the full deterministic DSP pipeline on a single mix file."""
    loaded = load_audio_file(source_path, max_bytes=max_file_bytes)
    create_playback_proxy(source_path, proxy_dir, stem_name=proxy_name)

    loudness = compute_loudness_metrics(loaded.samples, loaded.sample_rate)
    peaks = compute_peak_metrics(loaded.samples, loaded.sample_rate, source_path=source_path)
    dynamics = compute_dynamics_metrics(
        loaded.samples,
        sample_peak_dbfs=peaks.sample_peak_dbfs,
        true_peak_dbtp=peaks.true_peak_dbtp,
        short_term_max_lufs=loudness.short_term_max_lufs,
        integrated_lufs=loudness.integrated_lufs,
    )
    spectral = compute_spectral_profile(loaded.samples, loaded.sample_rate, genre=context.genre)
    stereo = compute_stereo_metrics(loaded.samples, loaded.sample_rate)

    global_metrics = GlobalMetrics(
        integrated_lufs=loudness.integrated_lufs,
        short_term_max_lufs=loudness.short_term_max_lufs,
        momentary_max_lufs=loudness.momentary_max_lufs,
        loudness_range_lu=loudness.loudness_range_lu,
        sample_peak_dbfs=peaks.sample_peak_dbfs,
        true_peak_dbtp=peaks.true_peak_dbtp,
        crest_factor_db=dynamics.crest_factor_db,
        plr_db=dynamics.plr_db,
        psr_db=dynamics.psr_db,
        phase_correlation_avg=stereo.phase_correlation_avg,
        stereo_width_ratio=stereo.stereo_width_ratio,
    )

    streaming_estimates = compute_streaming_estimates(global_metrics)
    findings = evaluate_mix_findings(
        context=context,
        duration_sec=loaded.duration_sec,
        loudness=loudness,
        peaks=peaks,
        dynamics=dynamics,
        spectral=spectral,
        stereo=stereo,
    )

    # Align time-series lengths cleanly
    n_pts = max(len(loudness.short_term_lufs_series), len(stereo.phase_correlation_series))
    st_series = list(loudness.short_term_lufs_series)
    ph_series = list(stereo.phase_correlation_series)
    while len(st_series) < n_pts:
        st_series.append(st_series[-1] if st_series else -70.0)
    while len(ph_series) < n_pts:
        ph_series.append(ph_series[-1] if ph_series else 1.0)

    report = AnalysisReport(
        schema_version="1.0.0",
        session_id=session_id,
        report_id=f"rep_{uuid.uuid4().hex[:8]}",
        created_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        context=context,
        audio_metadata=AudioMetadata(
            filename=original_filename,
            duration_sec=loaded.duration_sec,
            sample_rate_hz=loaded.sample_rate,
            channels=loaded.channels,
            bit_depth=loaded.bit_depth,
            playback_proxy_url=proxy_url,
            waveform_peaks=loaded.waveform_peaks,
            clipping_timestamps_sec=peaks.clipping_timestamps_sec,
        ),
        global_metrics=global_metrics,
        streaming_estimates=streaming_estimates,
        spectral_bands=spectral.bands,
        time_series=TimeSeries(
            step_sec=1.0,
            short_term_lufs=st_series[:n_pts],
            phase_correlation=ph_series[:n_pts],
        ),
        findings=findings,
        stem_analysis=None,
        revision_comparison=None,
        privacy_audit=PrivacyAudit(),
    )
    return report, loaded

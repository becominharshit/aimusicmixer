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
from app.dsp.spectrum import build_spectral_bands_from_energies
from app.dsp.structure import analyze_song_structure
from app.rules import compute_streaming_estimates, evaluate_mix_findings
from app.schemas.report import (
    AnalysisContext,
    AnalysisReport,
    AudioMetadata,
    GlobalMetrics,
    PrivacyAudit,
    SongSection,
    TimeSeries,
)
from app.services.session_store import CachedDspSnapshot


def analyze_audio_to_report(
    session_id: str,
    source_path: Path,
    original_filename: str,
    proxy_dir: Path,
    proxy_name: str,
    proxy_url: str,
    context: AnalysisContext,
    max_file_bytes: int | None = None,
    return_snapshot: bool = False,
) -> tuple[AnalysisReport, LoadedAudio] | tuple[AnalysisReport, LoadedAudio, CachedDspSnapshot]:
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
        sample_rate=loaded.sample_rate,
    )
    spectral = compute_spectral_profile(loaded.samples, loaded.sample_rate, genre=context.genre)
    stereo = compute_stereo_metrics(loaded.samples, loaded.sample_rate)
    structure = analyze_song_structure(
        loaded.samples,
        loaded.sample_rate,
        loaded.duration_sec,
        loudness.short_term_lufs_series,
    )
    section_models = [
        SongSection(
            label=sec.label,
            start_sec=sec.start_sec,
            end_sec=sec.end_sec,
            avg_lufs=sec.avg_lufs,
        )
        for sec in structure.sections
    ]

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
        transient_punch_db=dynamics.transient_punch_db,
        phase_correlation_avg=stereo.phase_correlation_avg,
        low_end_phase_correlation=stereo.low_end_phase_correlation,
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
            bpm=structure.bpm,
            sections=section_models,
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

    if return_snapshot:
        snapshot = CachedDspSnapshot(
            duration_sec=loaded.duration_sec,
            loudness=loudness,
            peaks=peaks,
            dynamics=dynamics,
            spectral=spectral,
            stereo=stereo,
            band_energies_db={b.band: b.energy_db for b in spectral.bands},
            bpm=structure.bpm,
            sections=section_models,
        )
        return report, loaded, snapshot
    return report, loaded


def reevaluate_report_context(
    report: AnalysisReport,
    snapshot: CachedDspSnapshot | None,
    new_context: AnalysisContext,
) -> AnalysisReport:
    """Recompute genre-relative spectral deltas and pedagogical findings from cached telemetry in <1 ms."""
    report.context = new_context

    band_energies = (
        snapshot.band_energies_db
        if snapshot is not None
        else {b.band: b.energy_db for b in report.spectral_bands}
    )
    updated_bands = build_spectral_bands_from_energies(band_energies, new_context.genre)
    report.spectral_bands = updated_bands

    if snapshot is not None:
        from app.dsp.spectrum import SpectralAnalysisResult

        updated_spectral = SpectralAnalysisResult(
            bands=updated_bands,
            band_peak_windows=snapshot.spectral.band_peak_windows,
        )
        report.streaming_estimates = compute_streaming_estimates(report.global_metrics)
        report.findings = evaluate_mix_findings(
            context=new_context,
            duration_sec=snapshot.duration_sec,
            loudness=snapshot.loudness,
            peaks=snapshot.peaks,
            dynamics=snapshot.dynamics,
            spectral=updated_spectral,
            stereo=snapshot.stereo,
        )
    return report

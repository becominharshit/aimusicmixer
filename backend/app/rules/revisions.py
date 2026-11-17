from __future__ import annotations

from app.schemas.report import (
    AnalysisReport,
    Finding,
    RevisionComparison,
    RevisionFindingStatus,
    RevisionMetricDeltas,
)

SEVERITY_SCORE = {"safe": 0, "caution": 1, "alert": 2}


def compare_revisions(
    baseline: AnalysisReport,
    revised: AnalysisReport,
) -> RevisionComparison:
    """Compare Mix v1 vs Mix v2 across global telemetry, 6-band balance, and findings."""
    bm = baseline.global_metrics
    rm = revised.global_metrics

    b_bands = {b.band: b.energy_db for b in baseline.spectral_bands}
    r_bands = {b.band: b.energy_db for b in revised.spectral_bands}
    band_deltas = {
        band: round(r_bands.get(band, -70.0) - b_bands.get(band, -70.0), 2)
        for band in b_bands
    }

    metric_deltas = RevisionMetricDeltas(
        integrated_lufs_delta=round(rm.integrated_lufs - bm.integrated_lufs, 2),
        true_peak_dbtp_delta=round(rm.true_peak_dbtp - bm.true_peak_dbtp, 2),
        loudness_range_lu_delta=round(rm.loudness_range_lu - bm.loudness_range_lu, 2),
        crest_factor_db_delta=round(rm.crest_factor_db - bm.crest_factor_db, 2),
        psr_db_delta=round(rm.psr_db - bm.psr_db, 2),
        phase_correlation_delta=round(rm.phase_correlation_avg - bm.phase_correlation_avg, 3),
        band_deltas_db=band_deltas,
    )

    revised_by_id: dict[str, Finding] = {f.evidence_id: f for f in revised.findings}
    statuses: list[RevisionFindingStatus] = []

    for bf in baseline.findings:
        rf = revised_by_id.get(bf.evidence_id)
        if bf.severity == "safe" and rf is not None and rf.severity == "safe":
            statuses.append(
                RevisionFindingStatus(
                    evidence_id=bf.evidence_id,
                    title=bf.title,
                    category=bf.category,
                    status="unchanged",
                    baseline_value=bf.measured_value,
                    revised_value=rf.measured_value,
                    summary="Remained within target range in v2.",
                )
            )
            continue

        if rf is None:
            # Issue disappeared in v2 (e.g., ev_low_buildup resolved or true peak became safe)
            statuses.append(
                RevisionFindingStatus(
                    evidence_id=bf.evidence_id,
                    title=bf.title,
                    category=bf.category,
                    status="improved",
                    baseline_value=bf.measured_value,
                    revised_value="Within target range in v2",
                    summary=f"Resolved: '{bf.title}' no longer exceeds threshold in the revised mix.",
                )
            )
            continue

        b_score = SEVERITY_SCORE[bf.severity]
        r_score = SEVERITY_SCORE[rf.severity]
        if r_score < b_score:
            status = "improved"
            summary = f"Severity reduced from {bf.severity} to {rf.severity}."
        elif r_score > b_score:
            status = "regressed"
            summary = f"Severity increased from {bf.severity} to {rf.severity}."
        else:
            # Same severity bucket — inspect numeric improvement where measurable
            if bf.category == "true_peak" and rm.true_peak_dbtp < bm.true_peak_dbtp - 0.3:
                status = "improved"
                summary = f"Headroom improved by {bm.true_peak_dbtp - rm.true_peak_dbtp:.2f} dBTP."
            elif bf.category == "tonal_balance":
                band_key = bf.evidence_id.replace("ev_tonal_", "").replace("_01", "")
                b_d = next((abs(b.delta_vs_genre_median_db) for b in baseline.spectral_bands if b.band == band_key), None)
                r_d = next((abs(b.delta_vs_genre_median_db) for b in revised.spectral_bands if b.band == band_key), None)
                if b_d is not None and r_d is not None and r_d < b_d - 0.5:
                    status = "improved"
                    summary = f"Band deviation narrowed from {b_d:.1f} dB to {r_d:.1f} dB."
                elif b_d is not None and r_d is not None and r_d > b_d + 0.5:
                    status = "regressed"
                    summary = f"Band deviation widened from {b_d:.1f} dB to {r_d:.1f} dB."
                else:
                    status = "unchanged"
                    summary = "Measurement stayed within +/-0.5 dB of v1."
            else:
                status = "unchanged"
                summary = "Metric remained in the same diagnostic tier."

        statuses.append(
            RevisionFindingStatus(
                evidence_id=bf.evidence_id,
                title=bf.title,
                category=bf.category,
                status=status,
                baseline_value=bf.measured_value,
                revised_value=rf.measured_value,
                summary=summary,
            )
        )

    # Also surface any brand-new warning introduced in v2
    baseline_ids = {bf.evidence_id for bf in baseline.findings}
    for rf in revised.findings:
        if rf.evidence_id not in baseline_ids and rf.severity != "safe":
            statuses.append(
                RevisionFindingStatus(
                    evidence_id=rf.evidence_id,
                    title=rf.title,
                    category=rf.category,
                    status="regressed",
                    baseline_value="Not flagged in v1",
                    revised_value=rf.measured_value,
                    summary=f"New issue introduced in v2: {rf.title}.",
                )
            )

    return RevisionComparison(
        baseline_report_id=baseline.report_id,
        revised_report_id=revised.report_id,
        baseline_filename=baseline.audio_metadata.filename,
        revised_filename=revised.audio_metadata.filename,
        revised_playback_proxy_url=revised.audio_metadata.playback_proxy_url,
        metric_deltas=metric_deltas,
        finding_statuses=statuses,
    )

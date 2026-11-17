from __future__ import annotations

import shutil

import pytest
from fastapi import HTTPException

from app.api.v1.routes import (
    clear_session,
    compare_demo_revised_mix,
    create_demo_session,
    get_mock_report,
    health_check,
    load_demo_reference_track,
    load_demo_stems,
    run_ai_mentor,
    stream_playback_proxy,
    update_user_reported_context,
)
from app.core.config import settings
from app.dsp import AudioIngestionError
from app.schemas.report import AnalysisContext, AnalysisReport, MentorRequest, UserReportedContext
from app.services import analyze_audio_to_report, session_store


def test_health_and_mock_schema_contract() -> None:
    health = health_check()
    assert health["status"] == "ok"
    assert health["ffmpeg_available"] is True

    mock_report = get_mock_report()
    parsed = AnalysisReport.model_validate(mock_report.model_dump())
    assert parsed.schema_version == "1.0.0"
    assert parsed.context.has_user_stems is False
    assert parsed.stem_analysis is None


def test_end_to_end_session_demo_stems_revision_mentor_and_cleanup() -> None:
    demo_v1 = settings.sample_assets_dir / "unmastered_mix_v1.wav"
    assert demo_v1.exists()

    # 1. Create real demo session via full deterministic DSP pipeline
    report = create_demo_session(
        genre="electronic",
        stage="unmastered_mix",
        artist_vision='["punchy","wide"]',
    )
    sid = report.session_id
    assert report.context.has_user_stems is False
    assert report.stem_analysis is None
    assert len(report.findings) >= 3
    assert report.audio_metadata.sample_rate_hz == 48000

    # Playback proxy file resolves cleanly via FileResponse route
    proxy_name = report.audio_metadata.playback_proxy_url.rsplit("/", 1)[-1]
    proxy_resp = stream_playback_proxy(sid, proxy_name)
    assert proxy_resp.path.exists()
    assert proxy_resp.path.stat().st_size > 1024

    # 2. Load reference track -> integrated LUFS available for matching
    ref_meta = load_demo_reference_track(sid)
    assert ref_meta["reference_filename"] == "reference_track.wav"
    assert -25.0 <= ref_meta["integrated_lufs"] <= -5.0

    # 3. Load aligned demo stems -> unlocks stem analysis with pairwise overlap
    stem_report = load_demo_stems(sid)
    assert stem_report.context.has_user_stems is True
    assert stem_report.context.stem_count == 4
    assert stem_report.stem_analysis is not None
    assert stem_report.stem_analysis.alignment_passed is True
    assert len(stem_report.stem_analysis.overlap_matrix) >= 1

    # 4. Compare Mix v2 -> confirms measurable improvements
    v2_report = compare_demo_revised_mix(sid)
    assert v2_report.revision_comparison is not None
    assert v2_report.revision_comparison.metric_deltas.true_peak_dbtp_delta < 0.0
    assert any(
        fs.status == "improved"
        for fs in v2_report.revision_comparison.finding_statuses
    )

    # 5. Update DAW user-reported context
    ctx_report = update_user_reported_context(
        sid,
        UserReportedContext(
            daw="Ableton Live 12",
            bus_routing="Drum Bus -> Mix Bus",
            plugin_notes="Limiter bypassed",
        ),
    )
    assert ctx_report.context.user_reported_context is not None
    assert ctx_report.context.user_reported_context.source_tag == "user_reported_context"

    # 6. Offline Mentor with privacy defaults (Toggle A/B/C off)
    mentor_resp = run_ai_mentor(
        sid,
        MentorRequest(
            allow_metrics_ai=False,
            allow_audio_ai=False,
            allow_training_opt_in=False,
        ),
    )
    assert mentor_resp.mode == "deterministic_fallback"
    assert mentor_resp.privacy_audit.raw_audio_sent_to_ai is False
    assert mentor_resp.privacy_audit.external_ai_enabled is False
    valid_ids = {f.evidence_id for f in v2_report.findings} | {
        o.evidence_id for o in (v2_report.stem_analysis.overlap_matrix if v2_report.stem_analysis else [])
    }
    assert all(eid in valid_ids for eid in mentor_resp.cited_evidence_ids)

    # 7. Clear session deletes temp files
    cleared = clear_session(sid)
    assert cleared["deleted"] is True
    assert session_store.get_session(sid) is None


def test_corrupt_upload_rejected_and_missing_session_404(tmp_path) -> None:
    bad = tmp_path / "broken.wav"
    bad.write_bytes(b"NOT_VALID_WAV_HEADER_12345")
    with pytest.raises(AudioIngestionError):
        analyze_audio_to_report(
            session_id="sess_bad",
            source_path=bad,
            original_filename="broken.wav",
            proxy_dir=tmp_path / "proxies",
            proxy_name="proxy",
            proxy_url="/api/v1/sessions/sess_bad/proxy/proxy.m4a",
            context=AnalysisContext(),
        )
    shutil.rmtree(tmp_path, ignore_errors=True)

    with pytest.raises(HTTPException) as exc_info:
        load_demo_stems("sess_nonexistent_999")
    assert exc_info.value.status_code == 404

from __future__ import annotations

import json
import shutil
import tempfile
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.routes import (
    analyze_mix,
    analyze_stems_endpoint,
    clear_session,
    compare_demo_revised_mix,
    compare_reports_endpoint,
    create_demo_session,
    get_mock_report,
    health_check,
    load_demo_reference_track,
    load_demo_stems,
    run_ai_mentor,
    standalone_ai_mentor,
    stream_playback_proxy,
    update_user_reported_context,
)
from app.core.config import settings
from app.dsp import AudioIngestionError
from app.schemas.report import (
    AnalysisContext,
    AnalysisReport,
    CompareReportsRequest,
    MentorRequest,
    MentorStandaloneRequest,
    UserReportedContext,
)
from app.services import analyze_audio_to_report, session_store


def test_health_and_mock_schema_contract() -> None:
    health = health_check()
    assert health["status"] == "ok"
    assert health["ffmpeg_available"] is True
    assert "gemini_model" in health

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
    assert report.global_metrics.plr_db > 0.0

    # Playback proxy file resolves cleanly via FileResponse route
    proxy_name = report.audio_metadata.playback_proxy_url.rsplit("/", 1)[-1]
    proxy_resp = stream_playback_proxy(sid, proxy_name)
    assert proxy_resp.path.exists()
    assert proxy_resp.path.stat().st_size > 1024

    # 2. Load reference track -> includes full global_metrics & spectral_bands
    ref_meta = load_demo_reference_track(sid)
    assert ref_meta["reference_filename"] == "reference_track.wav"
    assert -25.0 <= ref_meta["integrated_lufs"] <= -5.0
    assert "global_metrics" in ref_meta
    assert len(ref_meta["spectral_bands"]) == 6

    # 3. Load aligned demo stems -> unlocks stem analysis with pairwise overlap
    stem_report = load_demo_stems(sid)
    assert stem_report.context.has_user_stems is True
    assert stem_report.context.stem_count == 4
    assert stem_report.stem_analysis is not None
    assert stem_report.stem_analysis.alignment_passed is True
    assert len(stem_report.stem_analysis.overlap_matrix) >= 1

    # 4. Compare Mix v2 -> confirms measurable improvements & standalone /api/compare contract
    v2_report = compare_demo_revised_mix(sid)
    assert v2_report.revision_comparison is not None
    assert v2_report.revision_comparison.metric_deltas.true_peak_dbtp_delta < 0.0
    assert any(
        fs.status == "improved"
        for fs in v2_report.revision_comparison.finding_statuses
    )

    rec = session_store.get_session(sid)
    assert rec is not None and rec.revised_report is not None
    stateless_comp = compare_reports_endpoint(
        CompareReportsRequest(baseline=v2_report, revised=rec.revised_report)
    )
    assert stateless_comp.metric_deltas.true_peak_dbtp_delta == v2_report.revision_comparison.metric_deltas.true_peak_dbtp_delta

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


class _MemUpload:
    def __init__(self, data: bytes, filename: str) -> None:
        self._buf = BytesIO(data)
        self.filename = filename

    async def read(self, size: int = -1) -> bytes:
        return self._buf.read(size)


def _run_coro_sync(coro):
    while True:
        try:
            coro.send(None)
        except StopIteration as stop:
            return stop.value


def test_upload_analyze_and_stems_try_finally_cleanup_and_consent(tmp_path: Path, monkeypatch) -> None:
    demo_v1 = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo" / "demo-flawed-v1.wav"
    assert demo_v1.exists()

    raw_bytes = demo_v1.read_bytes()
    upload = _MemUpload(raw_bytes, "demo-flawed-v1.wav")
    report = _run_coro_sync(
        analyze_mix(
            file=upload,  # type: ignore[arg-type]
            genre="electronic",
            stage="unmastered_mix",
            artist_vision='["punchy"]',
            daw="",
            bus_routing="",
            plugin_notes="",
        )
    )
    try:
        # Raw uploaded WAV files inside mixbench_uploads must be removed via try...finally
        upload_dir = Path(tempfile.gettempdir()) / "mixbench_uploads"
        leftover = list(upload_dir.glob("*demo-flawed-v1.wav")) if upload_dir.exists() else []
        assert leftover == []
        assert report.audio_metadata.filename == "demo-flawed-v1.wav"
        assert report.context.has_user_stems is False

        # Standalone /api/analyze/stems returns StemAnalysis and enforces 2-8 bounds
        stems_dir = settings.sample_assets_dir / "stems"
        stem_files = [
            _MemUpload(p.read_bytes(), p.name)
            for p in sorted(stems_dir.glob("*.wav"))[:2]
        ]
        stem_res = _run_coro_sync(analyze_stems_endpoint(files=stem_files, session_id=None))  # type: ignore[arg-type]
        assert stem_res.alignment_passed is True
        assert len(stem_res.stems) == 2

        # Reject < 2 stems
        with pytest.raises(HTTPException) as exc:
            _run_coro_sync(
                analyze_stems_endpoint(
                    files=[_MemUpload(raw_bytes[:4096], "single.wav")],  # type: ignore[arg-type]
                    session_id=None,
                )
            )
        assert exc.value.status_code == 422

        # Standalone /api/mentor with allow_metrics_ai=False NEVER sends external API or audio
        offline_advice = standalone_ai_mentor(
            MentorStandaloneRequest(
                report=report,
                allow_metrics_ai=False,
                allow_audio_ai=True,
                allow_training_opt_in=False,
                question="What should I fix first?",
            )
        )
        assert offline_advice.mode == "deterministic_fallback"
        assert offline_advice.privacy_audit.raw_audio_sent_to_ai is False
        assert offline_advice.privacy_audit.external_ai_enabled is False

        # Mocked Gemini API client call verifies structured JSON + store=False + metrics-only privacy audit
        import google.genai as real_genai

        from app import ai as _ai_pkg  # noqa: F401

        captured: dict = {}

        class FakeInteractions:
            def create(self, **kwargs):
                captured.update(kwargs)
                valid_eid = report.findings[0].evidence_id
                payload = json.dumps(
                    {
                        "summary": "Grounded test summary.",
                        "vision_alignment_note": "Respects punchy vision.",
                        "prioritized_actions": [
                            {
                                "evidence_id": valid_eid,
                                "priority": 1,
                                "headline": "Pull pre-master bus down 3 dB",
                                "coaching_note": "Fixes ISP clipping.",
                                "daw_experiment": "Lower master bus fader by 3 dB.",
                                "verification_step": "Confirm <= -3 dBTP.",
                            }
                        ],
                    }
                )
                return SimpleNamespace(output_text=payload)

        class FakeClient:
            def __init__(self, api_key: str) -> None:
                self.interactions = FakeInteractions()

        monkeypatch.setattr(settings, "gemini_api_key", "test-key-123")
        monkeypatch.setattr(real_genai, "Client", FakeClient)

        gemini_resp = standalone_ai_mentor(
            MentorStandaloneRequest(
                session_id=report.session_id,
                allow_metrics_ai=True,
                allow_audio_ai=False,
                allow_training_opt_in=False,
                question="Verify clipping",
            )
        )
        assert gemini_resp.mode == "gemini_metrics_only", gemini_resp.summary
        assert gemini_resp.privacy_audit.raw_audio_sent_to_ai is False
        assert gemini_resp.privacy_audit.external_ai_enabled is True
        assert captured.get("store") is False
        assert isinstance(captured.get("input"), str)
    finally:
        clear_session(report.session_id)


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

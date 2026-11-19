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
    ContextUpdateRequest,
    MentorRequest,
    MentorStandaloneRequest,
)
from app.services import analyze_audio_to_report, session_store


def _fake_request(headers: dict[str, str] | None = None, host: str = "127.0.0.1"):
    return SimpleNamespace(headers=headers or {}, client=SimpleNamespace(host=host))


def _make_unsigned_jwt(sub: str) -> str:
    import base64

    def _b64(obj: dict) -> str:
        raw = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    return f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64({'sub': sub})}.sig"


def test_health_and_mock_schema_contract() -> None:
    from app.main import root

    assert root() == {"status": "ok", "service": "mixbench-dsp"}

    health = health_check()
    assert health["status"] == "ok"
    assert health["ffmpeg_available"] is True
    assert health["gemini_model"] == "gemini-4-hydrogen"
    assert settings.max_single_file_mb == 50
    assert settings.max_stem_total_mb == 150

    mock_report = get_mock_report()
    parsed = AnalysisReport.model_validate(mock_report.model_dump())
    assert parsed.schema_version == "1.0.0"
    assert parsed.context.has_user_stems is False
    assert parsed.stem_analysis is None


def test_end_to_end_session_demo_stems_revision_mentor_and_cleanup() -> None:
    demo_v1 = settings.sample_assets_dir / "unmastered_mix_v1.wav"
    assert demo_v1.exists()

    # 1. Create real demo session via full deterministic DSP pipeline
    req = _fake_request()
    report = create_demo_session(
        request=req,  # type: ignore[arg-type]
        genre="electronic",
        stage="unmastered_mix",
        artist_vision='["punchy","wide"]',
    )
    sid = report.session_id
    assert len(sid) > 20  # Full 128-bit unpredictable session ID
    assert report.context.has_user_stems is False
    assert report.stem_analysis is None
    assert len(report.findings) >= 3
    assert report.audio_metadata.sample_rate_hz == 48000
    assert report.global_metrics.plr_db > 0.0

    # Playback proxy file resolves cleanly via FileResponse route
    proxy_name = report.audio_metadata.playback_proxy_url.rsplit("/", 1)[-1]
    proxy_resp = stream_playback_proxy(sid, proxy_name, req)  # type: ignore[arg-type]
    assert proxy_resp.path.exists()
    assert proxy_resp.path.stat().st_size > 1024

    # 2. Load reference track -> includes full global_metrics & spectral_bands
    ref_meta = load_demo_reference_track(sid, req)  # type: ignore[arg-type]
    assert ref_meta["reference_filename"] == "reference_track.wav"
    assert -25.0 <= ref_meta["integrated_lufs"] <= -5.0
    assert "global_metrics" in ref_meta
    assert len(ref_meta["spectral_bands"]) == 6

    # 3. Load aligned demo stems -> unlocks stem analysis with pairwise overlap
    stem_report = load_demo_stems(sid, req)  # type: ignore[arg-type]
    assert stem_report.context.has_user_stems is True
    assert stem_report.context.stem_count == 4
    assert stem_report.stem_analysis is not None
    assert stem_report.stem_analysis.alignment_passed is True
    assert len(stem_report.stem_analysis.overlap_matrix) >= 1

    # 4. Compare Mix v2 -> confirms measurable improvements & standalone /api/compare contract
    v2_report = compare_demo_revised_mix(sid, req)  # type: ignore[arg-type]
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

    # 5. Update DAW user-reported context AND re-evaluate genre/stage instantly without re-upload
    ctx_report = update_user_reported_context(
        sid,
        ContextUpdateRequest(
            genre="rock",
            stage="final_master",
            artist_vision=["dynamic"],
            daw="Ableton Live 12",
            bus_routing="Drum Bus -> Mix Bus",
            plugin_notes="Limiter bypassed",
        ),
        req,  # type: ignore[arg-type]
    )
    assert ctx_report.context.genre == "rock"
    assert ctx_report.context.stage == "final_master"
    assert ctx_report.context.user_reported_context is not None
    assert ctx_report.context.user_reported_context.source_tag == "user_reported_context"

    # 6. Offline Mentor with privacy defaults (Toggle A/B/C off)
    mentor_resp = _run_coro_sync(
        run_ai_mentor(
            sid,
            MentorRequest(
                allow_metrics_ai=False,
                allow_audio_ai=False,
                allow_training_opt_in=False,
            ),
            req,  # type: ignore[arg-type]
        )
    )
    assert mentor_resp.mode == "deterministic_fallback"
    assert mentor_resp.privacy_audit.raw_audio_sent_to_ai is False
    assert mentor_resp.privacy_audit.external_ai_enabled is False
    valid_ids = {f.evidence_id for f in ctx_report.findings} | {
        o.evidence_id for o in (ctx_report.stem_analysis.overlap_matrix if ctx_report.stem_analysis else [])
    }
    assert all(eid in valid_ids for eid in mentor_resp.cited_evidence_ids)

    # 7. Clear session deletes temp files
    cleared = clear_session(sid, req)  # type: ignore[arg-type]
    assert cleared["deleted"] is True
    assert session_store.get_session(sid) is None


class _MemUpload:
    def __init__(self, data: bytes, filename: str) -> None:
        self._buf = BytesIO(data)
        self.filename = filename

    async def read(self, size: int = -1) -> bytes:
        return self._buf.read(size)


def _run_coro_sync(coro):
    import asyncio

    return asyncio.run(coro)


def test_upload_analyze_and_stems_try_finally_cleanup_and_consent(tmp_path: Path, monkeypatch) -> None:
    demo_v1 = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo" / "demo-flawed-v1.wav"
    assert demo_v1.exists()

    raw_bytes = demo_v1.read_bytes()
    upload = _MemUpload(raw_bytes, "demo-flawed-v1.wav")
    req = _fake_request()
    report = _run_coro_sync(
        analyze_mix(
            request=req,  # type: ignore[arg-type]
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

        # Persisted primary proxy path survives RAM eviction and reloads transparently
        rec = session_store.get_session(report.session_id)
        assert rec is not None
        assert rec.primary_audio_path is not None and rec.primary_audio_path.exists()
        rec.primary_loaded = None
        reloaded = session_store.get_or_reload_primary_audio(rec)
        assert reloaded is not None and reloaded.duration_sec > 1.0

        # Standalone /api/analyze/stems returns StemAnalysis and enforces 2-8 bounds
        stems_dir = settings.sample_assets_dir / "stems"
        stem_files = [
            _MemUpload(p.read_bytes(), p.name)
            for p in sorted(stems_dir.glob("*.wav"))[:2]
        ]
        stem_res = _run_coro_sync(
            analyze_stems_endpoint(request=req, files=stem_files, session_id=None)  # type: ignore[arg-type]
        )
        assert stem_res.alignment_passed is True
        assert len(stem_res.stems) == 2

        # Reject < 2 stems
        with pytest.raises(HTTPException) as exc:
            _run_coro_sync(
                analyze_stems_endpoint(
                    request=req,  # type: ignore[arg-type]
                    files=[_MemUpload(raw_bytes[:4096], "single.wav")],  # type: ignore[arg-type]
                    session_id=None,
                )
            )
        assert exc.value.status_code == 422

        # Standalone /api/mentor with allow_metrics_ai=False NEVER sends external API or audio
        offline_advice = _run_coro_sync(
            standalone_ai_mentor(
                MentorStandaloneRequest(
                    report=report,
                    allow_metrics_ai=False,
                    allow_audio_ai=True,
                    allow_training_opt_in=False,
                    question="What should I fix first?",
                ),
                req,  # type: ignore[arg-type]
            )
        )
        assert offline_advice.mode == "deterministic_fallback"
        assert offline_advice.privacy_audit.raw_audio_sent_to_ai is False
        assert offline_advice.privacy_audit.external_ai_enabled is False

        # Mocked Gemini client.models.generate_content verifies structured JSON + temperature=0.2 + metrics-only privacy audit
        import google.genai as real_genai

        captured: dict = {}

        class FakeModels:
            def generate_content(self, **kwargs):
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
                return SimpleNamespace(text=payload)

        class FakeClient:
            def __init__(self, api_key: str, http_options=None) -> None:
                captured["http_options"] = http_options
                self.models = FakeModels()

        monkeypatch.setattr(settings, "gemini_api_key", "test-key-123")
        monkeypatch.setattr(real_genai, "Client", FakeClient)

        gemini_resp = _run_coro_sync(
            standalone_ai_mentor(
                MentorStandaloneRequest(
                    session_id=report.session_id,
                    allow_metrics_ai=True,
                    allow_audio_ai=False,
                    allow_training_opt_in=False,
                    question="Verify clipping",
                ),
                req,  # type: ignore[arg-type]
            )
        )
        assert gemini_resp.mode == "gemini_metrics_only", gemini_resp.summary
        assert gemini_resp.fallback_reason is None
        assert gemini_resp.privacy_audit.raw_audio_sent_to_ai is False
        assert gemini_resp.privacy_audit.external_ai_enabled is True
        assert captured.get("model") == settings.gemini_model
        assert captured.get("config").thinking_config is not None
        assert str(captured.get("config").thinking_config.thinking_level).lower().endswith("minimal")
    finally:
        clear_session(report.session_id, req)  # type: ignore[arg-type]


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
        load_demo_stems("sess_nonexistent_999", _fake_request())  # type: ignore[arg-type]
    assert exc_info.value.status_code == 404


def test_oversized_upload_returns_413_and_cleans_up(monkeypatch) -> None:
    monkeypatch.setattr(settings, "max_single_file_mb", 1)
    oversized_bytes = b"0" * (1024 * 1024 + 64)
    upload = _MemUpload(oversized_bytes, "too_big.wav")

    uploads_dir = Path(tempfile.gettempdir()) / "mixbench_uploads"
    before_files = set(uploads_dir.iterdir()) if uploads_dir.exists() else set()

    with pytest.raises(HTTPException) as exc_info:
        _run_coro_sync(
            analyze_mix(
                request=_fake_request(),  # type: ignore[arg-type]
                file=upload,  # type: ignore[arg-type]
                genre="electronic",
                stage="unmastered_mix",
                artist_vision="[]",
                daw="",
                bus_routing="",
                plugin_notes="",
            )
        )

    assert exc_info.value.status_code == 413
    after_files = set(uploads_dir.iterdir()) if uploads_dir.exists() else set()
    assert after_files == before_files


def test_gemini_api_error_triggers_deterministic_fallback(monkeypatch) -> None:
    import google.genai as real_genai

    mock_report = get_mock_report()

    class BrokenModels:
        def generate_content(self, **kwargs):
            raise RuntimeError("404 NOT_FOUND: model not found")

    class BrokenClient:
        def __init__(self, api_key: str, http_options=None) -> None:
            self.models = BrokenModels()

    monkeypatch.setattr(settings, "gemini_api_key", "test-key-123")
    monkeypatch.setattr(real_genai, "Client", BrokenClient)

    resp = _run_coro_sync(
        standalone_ai_mentor(
            MentorStandaloneRequest(
                report=mock_report,
                allow_metrics_ai=True,
                allow_audio_ai=False,
                allow_training_opt_in=False,
                question="Help me fix clipping",
            ),
            _fake_request(),  # type: ignore[arg-type]
        )
    )
    assert resp.mode == "deterministic_fallback"
    assert resp.fallback_reason is not None and "RuntimeError" in resp.fallback_reason
    assert "Offline Mentor fallback" in resp.summary


def test_gemini_timeout_triggers_deterministic_fallback_without_blocking(monkeypatch) -> None:
    import time

    import google.genai as real_genai

    from app.ai import generate_mentor_advice_async

    mock_report = get_mock_report()

    class HangingModels:
        def generate_content(self, **kwargs):
            time.sleep(0.4)
            return SimpleNamespace(text="{}")

    class HangingClient:
        def __init__(self, api_key: str, http_options=None) -> None:
            self.models = HangingModels()

    monkeypatch.setattr(settings, "gemini_api_key", "test-key-123")
    monkeypatch.setattr(real_genai, "Client", HangingClient)

    async def _timed_call():
        started = time.monotonic()
        result = await generate_mentor_advice_async(
            report=mock_report,
            request=MentorRequest(
                allow_metrics_ai=True,
                allow_audio_ai=False,
                allow_training_opt_in=False,
                question="Fix headroom",
            ),
            timeout_sec=0.05,
        )
        return result, time.monotonic() - started

    resp, elapsed = _run_coro_sync(_timed_call())
    assert elapsed < 0.35
    assert resp.mode == "deterministic_fallback"
    assert resp.fallback_reason is not None and "Timeout" in resp.fallback_reason


def test_cors_and_memory_cap_configuration() -> None:
    from fastapi.middleware.cors import CORSMiddleware

    from app.core.config import Settings
    from app.main import app

    s_star = Settings(allowed_origins="https://mixbench.vercel.app, *")
    assert "*" in s_star.cors_origin_list

    s_explicit = Settings(allowed_origins="https://mixbench.vercel.app/, http://localhost:3000/")
    assert s_explicit.cors_origin_list == ["https://mixbench.vercel.app", "http://localhost:3000"]

    cors_layers = [m for m in app.user_middleware if m.cls is CORSMiddleware]
    assert len(cors_layers) == 1
    opts = cors_layers[0].kwargs
    if "*" in opts.get("allow_origins", []):
        assert opts.get("allow_credentials") is False


def test_demo_session_cache_hit_populates_downstream_state() -> None:
    req = _fake_request()
    first = create_demo_session(
        request=req,  # type: ignore[arg-type]
        genre="electronic",
        stage="unmastered_mix",
        artist_vision='["punchy"]',
    )
    second = create_demo_session(
        request=req,  # type: ignore[arg-type]
        genre="electronic",
        stage="unmastered_mix",
        artist_vision='["punchy"]',
    )
    try:
        assert first.session_id != second.session_id
        rec_second = session_store.get_session(second.session_id)
        assert rec_second is not None
        assert rec_second.primary_report is not None
        assert rec_second.primary_snapshot is not None
        assert rec_second.primary_audio_path is not None and rec_second.primary_audio_path.exists()
        assert len(rec_second.proxy_files) >= 1

        # Downstream proxy stream and reference A/B work on cached demo session
        proxy_name = second.audio_metadata.playback_proxy_url.rsplit("/", 1)[-1]
        proxy_resp = stream_playback_proxy(second.session_id, proxy_name, req)  # type: ignore[arg-type]
        assert proxy_resp.path.exists()
        ref_meta = load_demo_reference_track(second.session_id, req)  # type: ignore[arg-type]
        assert ref_meta["reference_filename"] == "reference_track.wav"
    finally:
        clear_session(first.session_id, req)  # type: ignore[arg-type]
        clear_session(second.session_id, req)  # type: ignore[arg-type]


def test_proxy_aware_rate_limiter_uses_xff_and_auth_buckets() -> None:
    from app.api.v1.routes import _extract_client_rate_key

    req_xff = _fake_request(headers={"x-forwarded-for": "203.0.113.42, 10.0.0.1"})
    key = _extract_client_rate_key(req_xff)  # type: ignore[arg-type]
    assert key == "203.0.113.42"

    req_auth = _fake_request(
        headers={"authorization": f"Bearer {_make_unsigned_jwt('user-rate-001')}"}
    )
    auth_key = _extract_client_rate_key(req_auth)  # type: ignore[arg-type]
    assert auth_key.startswith("user:")


def test_gemini_minimal_thinking_level_retries_once_with_low(monkeypatch) -> None:
    import google.genai as real_genai

    mock_report = get_mock_report()
    seen_levels: list[str] = []

    class RetryModels:
        def generate_content(self, **kwargs):
            level = str(kwargs["config"].thinking_config.thinking_level).lower()
            seen_levels.append(level)
            if "minimal" in level:
                raise ValueError("Invalid thinking_level enum value: minimal is not supported")
            valid_eid = mock_report.findings[0].evidence_id
            payload = json.dumps(
                {
                    "summary": "Retried cleanly with low thinking_level.",
                    "vision_alignment_note": "Matches punchy vision.",
                    "prioritized_actions": [
                        {
                            "evidence_id": valid_eid,
                            "priority": 1,
                            "headline": "Trim low-mid buildup",
                            "coaching_note": "Retried cleanly.",
                            "daw_experiment": "Cut 2 dB @ 300 Hz.",
                            "verification_step": "Re-upload and check delta.",
                        }
                    ],
                }
            )
            return SimpleNamespace(text=payload)

    class RetryClient:
        def __init__(self, api_key: str, http_options=None) -> None:
            self.models = RetryModels()

    monkeypatch.setattr(settings, "gemini_api_key", "test-key-123")
    monkeypatch.setattr(real_genai, "Client", RetryClient)

    resp = _run_coro_sync(
        standalone_ai_mentor(
            MentorStandaloneRequest(
                report=mock_report,
                allow_metrics_ai=True,
                allow_audio_ai=False,
                allow_training_opt_in=False,
                question="Check low-mid buildup",
            ),
            _fake_request(),  # type: ignore[arg-type]
        )
    )
    assert resp.mode == "gemini_metrics_only"
    assert len(seen_levels) == 2
    assert "minimal" in seen_levels[0]
    assert "low" in seen_levels[1]


def test_magic_byte_validation_rejects_disguised_non_audio_with_415() -> None:
    disguised_html = _MemUpload(b"<html><body><script>alert(1)</script></body></html>", "evil.wav")
    with pytest.raises(HTTPException) as exc_info:
        _run_coro_sync(
            analyze_mix(
                request=_fake_request(),  # type: ignore[arg-type]
                file=disguised_html,  # type: ignore[arg-type]
                genre="electronic",
                stage="unmastered_mix",
                artist_vision="[]",
                daw="",
                bus_routing="",
                plugin_notes="",
            )
        )
    assert exc_info.value.status_code == 415


def test_sha256_dedup_cache_and_finding_classifications() -> None:
    demo_v1 = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo" / "demo-flawed-v1.wav"
    raw_bytes = demo_v1.read_bytes()
    req = _fake_request()

    r1 = _run_coro_sync(
        analyze_mix(
            request=req,  # type: ignore[arg-type]
            file=_MemUpload(raw_bytes, "dup_check.wav"),  # type: ignore[arg-type]
            genre="electronic",
            stage="unmastered_mix",
            artist_vision='["punchy"]',
            daw="",
            bus_routing="",
            plugin_notes="",
        )
    )
    r2 = _run_coro_sync(
        analyze_mix(
            request=req,  # type: ignore[arg-type]
            file=_MemUpload(raw_bytes, "dup_check.wav"),  # type: ignore[arg-type]
            genre="electronic",
            stage="unmastered_mix",
            artist_vision='["punchy"]',
            daw="",
            bus_routing="",
            plugin_notes="",
        )
    )
    try:
        assert r1.session_id != r2.session_id
        assert r1.global_metrics.integrated_lufs == r2.global_metrics.integrated_lufs
        assert r1.global_metrics.true_peak_dbtp == r2.global_metrics.true_peak_dbtp
        assert all(f.classification in {"objective_defect", "stylistic_choice"} for f in r1.findings)
    finally:
        clear_session(r1.session_id, req)  # type: ignore[arg-type]
        clear_session(r2.session_id, req)  # type: ignore[arg-type]


def test_session_ownership_enforces_403_across_users() -> None:
    from app.api.v1.routes import _assert_session_access

    req_owner = _fake_request(
        headers={"authorization": f"Bearer {_make_unsigned_jwt('user-a-uuid')}"}
    )
    req_other = _fake_request(
        headers={"authorization": f"Bearer {_make_unsigned_jwt('user-b-uuid')}"}
    )
    req_anon = _fake_request()

    report = create_demo_session(
        request=req_owner,  # type: ignore[arg-type]
        genre="electronic",
        stage="unmastered_mix",
        artist_vision='["punchy"]',
    )
    try:
        rec = session_store.get_session(report.session_id)
        assert rec is not None
        assert rec.owner_user_id == "user-a-uuid"

        # Same owner succeeds
        _assert_session_access(rec, req_owner)  # type: ignore[arg-type]

        # Different user or anonymous caller gets 403 Forbidden
        with pytest.raises(HTTPException) as exc_other:
            _assert_session_access(rec, req_other)  # type: ignore[arg-type]
        assert exc_other.value.status_code == 403

        with pytest.raises(HTTPException) as exc_anon:
            _assert_session_access(rec, req_anon)  # type: ignore[arg-type]
        assert exc_anon.value.status_code == 403
    finally:
        clear_session(report.session_id, req_owner)  # type: ignore[arg-type]


def test_security_headers_middleware_attached() -> None:
    from starlette.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    assert res.headers.get("x-content-type-options") == "nosniff"
    assert res.headers.get("x-frame-options") == "DENY"
    assert res.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "permissions-policy" in res.headers
    assert "content-security-policy" in res.headers



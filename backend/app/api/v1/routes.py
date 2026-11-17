from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.ai import generate_mentor_advice
from app.core.config import settings
from app.dsp import (
    AudioIngestionError,
    analyze_user_stems,
    compute_loudness_metrics,
    compute_peak_metrics,
    create_playback_proxy,
    load_audio_file,
)
from app.rules import compare_revisions
from app.schemas.report import (
    AnalysisContext,
    AnalysisReport,
    ArtistVisionTag,
    Finding,
    GenreType,
    GlobalMetrics,
    MentorRequest,
    MentorResponse,
    PrivacyAudit,
    SpectralBand,
    StageType,
    StreamingEstimate,
    TimeSeries,
    UserReportedContext,
)
from app.services import analyze_audio_to_report, session_store

router = APIRouter(prefix="/api/v1", tags=["v1"])

VALID_VISION_TAGS: set[str] = {"punchy", "warm", "aggressive", "wide", "dynamic"}


def _parse_artist_vision(raw: str) -> list[ArtistVisionTag]:
    if not raw or not raw.strip():
        return []
    items: list[str]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            items = [str(x).strip().lower() for x in parsed]
        else:
            items = [str(parsed).strip().lower()]
    except json.JSONDecodeError:
        items = [part.strip().lower() for part in raw.split(",") if part.strip()]
    return [tag for tag in items if tag in VALID_VISION_TAGS]  # type: ignore[misc]


async def _save_upload_bounded(upload: UploadFile, target_path: Path, max_bytes: int) -> int:
    total = 0
    chunk_size = 1024 * 1024
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with target_path.open("wb") as out:
        while True:
            chunk = await upload.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                out.close()
                target_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"File '{upload.filename or 'upload'}' exceeds the {max_bytes // (1024 * 1024)} MB limit.",
                )
            out.write(chunk)
    return total


def _proxy_filename(proxy_dir: Path, stem: str) -> str:
    if (proxy_dir / f"{stem}.m4a").exists():
        return f"{stem}.m4a"
    return f"{stem}.wav"


@router.get("/health")
def health_check() -> dict:
    return {
        "status": "ok",
        "version": "1.0.0",
        "ffmpeg_available": shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None,
        "gemini_configured": bool(settings.gemini_api_key.strip()),
    }


@router.get("/analyze/mock", response_model=AnalysisReport)
def get_mock_report() -> AnalysisReport:
    return AnalysisReport(
        schema_version="1.0.0",
        session_id="sess_mock_01",
        report_id="rep_9f8a7b6c",
        created_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        context=AnalysisContext(
            genre="electronic",
            stage="unmastered_mix",
            artist_vision=["punchy", "wide"],
            has_user_stems=False,
            stem_count=0,
        ),
        audio_metadata={
            "filename": "track_v1.wav",
            "duration_sec": 194.5,
            "sample_rate_hz": 48000,
            "channels": 2,
            "bit_depth": 24,
            "playback_proxy_url": "/api/v1/sessions/sess_mock_01/proxy/proxy.m4a",
            "waveform_peaks": [[-0.4, 0.42], [-0.62, 0.58], [-0.71, 0.74], [-0.55, 0.51]],
            "clipping_timestamps_sec": [],
        },
        global_metrics=GlobalMetrics(
            integrated_lufs=-16.4,
            short_term_max_lufs=-12.1,
            momentary_max_lufs=-10.3,
            loudness_range_lu=6.8,
            sample_peak_dbfs=-1.8,
            true_peak_dbtp=-1.5,
            crest_factor_db=14.6,
            psr_db=11.2,
            phase_correlation_avg=0.78,
            stereo_width_ratio=0.42,
        ),
        streaming_estimates=[
            StreamingEstimate(
                platform="Spotify (Normal -14 LUFS)",
                estimated_gain_db=2.4,
                limiter_engaged_warning=True,
                assumption_note=(
                    "Assumes Normal loudness mode (-14 LUFS target). Positive gain (+2.4 dB) would push true peak above -1.0 dBTP; client limiter may reduce peaks."
                ),
            )
        ],
        spectral_bands=[
            SpectralBand(band="sub", range_hz="20-60", energy_db=-22.1, delta_vs_genre_median_db=1.2),
            SpectralBand(band="low", range_hz="60-250", energy_db=-18.4, delta_vs_genre_median_db=3.4),
            SpectralBand(band="low_mid", range_hz="250-800", energy_db=-21.0, delta_vs_genre_median_db=0.5),
            SpectralBand(band="high_mid", range_hz="800-4000", energy_db=-23.5, delta_vs_genre_median_db=-1.1),
            SpectralBand(band="presence", range_hz="4000-10000", energy_db=-26.8, delta_vs_genre_median_db=-0.8),
            SpectralBand(band="air", range_hz="10000-20000", energy_db=-34.2, delta_vs_genre_median_db=-1.5),
        ],
        time_series=TimeSeries(
            step_sec=1.0,
            short_term_lufs=[-24.1, -18.2, -14.5],
            phase_correlation=[0.92, 0.81, 0.45],
        ),
        findings=[
            Finding(
                evidence_id="ev_low_buildup_01",
                category="tonal_balance",
                severity="caution",
                confidence="measured",
                title="Low-End Buildup Around 60–250 Hz",
                timestamp_start_sec=64.0,
                timestamp_end_sec=82.0,
                measured_value="+3.4 dB above genre reference range",
                what_happened="Energy between 60 Hz and 250 Hz rises +3.4 dB above typical electronic unmastered mixes during the main drop.",
                why_it_matters="Excess low-end energy consumes headroom early and can sound muddy or boomy on laptop and phone speakers.",
                listen_prompt="Jump to 01:04 and toggle the Laptop and Smartphone translation previews to hear if the kick and bass blur together.",
                what_to_try="Check high-pass filters on non-bass elements around 100–140 Hz or apply a gentle 1.5–2.5 dB dynamic EQ dip near 140 Hz.",
                recheck_target="Re-export and verify 60–250 Hz band energy moves closer to 0 to +1.5 dB relative balance.",
            )
        ],
        stem_analysis=None,
        revision_comparison=None,
        privacy_audit=PrivacyAudit(),
    )


@router.post("/analyze", response_model=AnalysisReport)
async def analyze_mix(
    file: UploadFile = File(...),
    genre: GenreType = Form("electronic"),
    stage: StageType = Form("unmastered_mix"),
    artist_vision: str = Form("[]"),
    daw: str = Form(""),
    bus_routing: str = Form(""),
    plugin_notes: str = Form(""),
) -> AnalysisReport:
    rec = session_store.create_session()
    safe_name = Path(file.filename or "mix.wav").name
    target_path = rec.directory / f"primary_{uuid.uuid4().hex[:6]}_{safe_name}"

    try:
        await _save_upload_bounded(file, target_path, settings.max_single_file_bytes)
        user_ctx = (
            UserReportedContext(daw=daw.strip(), bus_routing=bus_routing.strip(), plugin_notes=plugin_notes.strip())
            if (daw.strip() or bus_routing.strip() or plugin_notes.strip())
            else None
        )
        context = AnalysisContext(
            genre=genre,
            stage=stage,
            artist_vision=_parse_artist_vision(artist_vision),
            has_user_stems=False,
            stem_count=0,
            user_reported_context=user_ctx,
        )
        proxy_dir = rec.directory / "proxies"
        report, loaded = analyze_audio_to_report(
            session_id=rec.session_id,
            source_path=target_path,
            original_filename=safe_name,
            proxy_dir=proxy_dir,
            proxy_name="proxy",
            proxy_url=f"/api/v1/sessions/{rec.session_id}/proxy/proxy",
            context=context,
            max_file_bytes=settings.max_single_file_bytes,
        )
        actual_proxy = _proxy_filename(proxy_dir, "proxy")
        report.audio_metadata.playback_proxy_url = f"/api/v1/sessions/{rec.session_id}/proxy/{actual_proxy}"
        rec.proxy_files[actual_proxy] = proxy_dir / actual_proxy
        rec.primary_audio_path = target_path
        rec.primary_loaded = loaded
        rec.primary_report = report
        return report
    except AudioIngestionError as exc:
        session_store.delete_session(rec.session_id)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HTTPException:
        session_store.delete_session(rec.session_id)
        raise
    except Exception as exc:
        session_store.delete_session(rec.session_id)
        raise HTTPException(status_code=500, detail=f"Audio analysis failed: {exc}") from exc


@router.post("/sessions/demo", response_model=AnalysisReport)
def create_demo_session(
    genre: GenreType = Form("electronic"),
    stage: StageType = Form("unmastered_mix"),
    artist_vision: str = Form('["punchy","wide"]'),
) -> AnalysisReport:
    demo_src = settings.sample_assets_dir / "unmastered_mix_v1.wav"
    if not demo_src.exists():
        raise HTTPException(status_code=404, detail="Sample demo mix asset has not been generated yet.")

    rec = session_store.create_session()
    target_path = rec.directory / "unmastered_mix_v1.wav"
    shutil.copy2(demo_src, target_path)

    context = AnalysisContext(
        genre=genre,
        stage=stage,
        artist_vision=_parse_artist_vision(artist_vision),
        has_user_stems=False,
        stem_count=0,
    )
    proxy_dir = rec.directory / "proxies"
    report, loaded = analyze_audio_to_report(
        session_id=rec.session_id,
        source_path=target_path,
        original_filename="unmastered_mix_v1.wav",
        proxy_dir=proxy_dir,
        proxy_name="proxy",
        proxy_url=f"/api/v1/sessions/{rec.session_id}/proxy/proxy",
        context=context,
    )
    actual_proxy = _proxy_filename(proxy_dir, "proxy")
    report.audio_metadata.playback_proxy_url = f"/api/v1/sessions/{rec.session_id}/proxy/{actual_proxy}"
    rec.proxy_files[actual_proxy] = proxy_dir / actual_proxy
    rec.primary_audio_path = target_path
    rec.primary_loaded = loaded
    rec.primary_report = report
    return report


@router.post("/sessions/{session_id}/reference")
async def upload_reference_track(
    session_id: str,
    file: UploadFile = File(...),
) -> dict:
    rec = session_store.get_session(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")

    safe_name = Path(file.filename or "reference.wav").name
    ref_path = rec.directory / f"reference_{uuid.uuid4().hex[:6]}_{safe_name}"
    await _save_upload_bounded(file, ref_path, settings.max_single_file_bytes)

    try:
        loaded = load_audio_file(ref_path, max_bytes=settings.max_single_file_bytes)
        loudness = compute_loudness_metrics(loaded.samples, loaded.sample_rate)
        peaks = compute_peak_metrics(loaded.samples, loaded.sample_rate, source_path=ref_path)
        proxy_dir = rec.directory / "proxies"
        create_playback_proxy(ref_path, proxy_dir, stem_name="reference")
        actual_proxy = _proxy_filename(proxy_dir, "reference")
        rec.proxy_files[actual_proxy] = proxy_dir / actual_proxy
        rec.reference_audio_path = ref_path

        return {
            "reference_filename": safe_name,
            "integrated_lufs": loudness.integrated_lufs,
            "true_peak_dbtp": peaks.true_peak_dbtp,
            "duration_sec": loaded.duration_sec,
            "playback_proxy_url": f"/api/v1/sessions/{session_id}/proxy/{actual_proxy}",
            "waveform_peaks": loaded.waveform_peaks,
        }
    except AudioIngestionError as exc:
        ref_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/reference/demo")
def load_demo_reference_track(session_id: str) -> dict:
    rec = session_store.get_session(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    demo_ref = settings.sample_assets_dir / "reference_track.wav"
    if not demo_ref.exists():
        raise HTTPException(status_code=404, detail="Demo reference track missing.")

    ref_path = rec.directory / "reference_track.wav"
    shutil.copy2(demo_ref, ref_path)
    loaded = load_audio_file(ref_path)
    loudness = compute_loudness_metrics(loaded.samples, loaded.sample_rate)
    peaks = compute_peak_metrics(loaded.samples, loaded.sample_rate, source_path=ref_path)
    proxy_dir = rec.directory / "proxies"
    create_playback_proxy(ref_path, proxy_dir, stem_name="reference")
    actual_proxy = _proxy_filename(proxy_dir, "reference")
    rec.proxy_files[actual_proxy] = proxy_dir / actual_proxy
    rec.reference_audio_path = ref_path

    return {
        "reference_filename": "reference_track.wav",
        "integrated_lufs": loudness.integrated_lufs,
        "true_peak_dbtp": peaks.true_peak_dbtp,
        "duration_sec": loaded.duration_sec,
        "playback_proxy_url": f"/api/v1/sessions/{session_id}/proxy/{actual_proxy}",
        "waveform_peaks": loaded.waveform_peaks,
    }


@router.post("/sessions/{session_id}/stems", response_model=AnalysisReport)
async def upload_user_stems(
    session_id: str,
    files: list[UploadFile] = File(...),
) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")

    if len(files) < 2 or len(files) > 8:
        raise HTTPException(
            status_code=422,
            detail=f"Upload between 2 and 8 original stems (received {len(files)}).",
        )

    stems_dir = rec.directory / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)
    saved_stems: list[tuple[str, Path]] = []
    running_total = 0

    for idx, f in enumerate(files):
        safe_name = Path(f.filename or f"stem_{idx + 1}.wav").name
        stem_path = stems_dir / f"{idx:02d}_{safe_name}"
        size = await _save_upload_bounded(f, stem_path, settings.max_single_file_bytes)
        running_total += size
        if running_total > settings.max_stem_total_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Combined stems exceed the {settings.max_stem_total_mb} MB session limit.",
            )
        saved_stems.append((safe_name, stem_path))

    try:
        stem_analysis = analyze_user_stems(
            saved_stems,
            mix_audio=rec.primary_loaded,
            max_total_bytes=settings.max_stem_total_bytes,
        )
    except AudioIngestionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    rec.primary_report.context.has_user_stems = True
    rec.primary_report.context.stem_count = len(saved_stems)
    rec.primary_report.stem_analysis = stem_analysis
    return rec.primary_report


@router.post("/sessions/{session_id}/stems/demo", response_model=AnalysisReport)
def load_demo_stems(session_id: str) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")

    demo_stems_dir = settings.sample_assets_dir / "stems"
    stem_paths = sorted(demo_stems_dir.glob("*.wav"))
    if len(stem_paths) < 2:
        raise HTTPException(status_code=404, detail="Demo stems are not available.")

    saved_stems = [(p.name, p) for p in stem_paths]
    stem_analysis = analyze_user_stems(saved_stems, mix_audio=rec.primary_loaded)
    rec.primary_report.context.has_user_stems = True
    rec.primary_report.context.stem_count = len(saved_stems)
    rec.primary_report.stem_analysis = stem_analysis
    return rec.primary_report


@router.post("/sessions/{session_id}/compare", response_model=AnalysisReport)
async def compare_revised_mix(
    session_id: str,
    file: UploadFile = File(...),
) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")

    safe_name = Path(file.filename or "mix_v2.wav").name
    v2_path = rec.directory / f"v2_{uuid.uuid4().hex[:6]}_{safe_name}"
    await _save_upload_bounded(file, v2_path, settings.max_single_file_bytes)

    try:
        proxy_dir = rec.directory / "proxies"
        revised_report, _ = analyze_audio_to_report(
            session_id=session_id,
            source_path=v2_path,
            original_filename=safe_name,
            proxy_dir=proxy_dir,
            proxy_name="v2",
            proxy_url=f"/api/v1/sessions/{session_id}/proxy/v2",
            context=rec.primary_report.context.model_copy(deep=True),
            max_file_bytes=settings.max_single_file_bytes,
        )
        actual_proxy = _proxy_filename(proxy_dir, "v2")
        revised_report.audio_metadata.playback_proxy_url = f"/api/v1/sessions/{session_id}/proxy/{actual_proxy}"
        rec.proxy_files[actual_proxy] = proxy_dir / actual_proxy
        rec.revised_audio_path = v2_path
        rec.revised_report = revised_report

        comparison = compare_revisions(rec.primary_report, revised_report)
        rec.primary_report.revision_comparison = comparison
        return rec.primary_report
    except AudioIngestionError as exc:
        v2_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/compare/demo", response_model=AnalysisReport)
def compare_demo_revised_mix(session_id: str) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")

    v2_src = settings.sample_assets_dir / "revised_mix_v2.wav"
    if not v2_src.exists():
        raise HTTPException(status_code=404, detail="Demo revised_mix_v2.wav missing.")

    v2_path = rec.directory / "revised_mix_v2.wav"
    shutil.copy2(v2_src, v2_path)
    proxy_dir = rec.directory / "proxies"
    revised_report, _ = analyze_audio_to_report(
        session_id=session_id,
        source_path=v2_path,
        original_filename="revised_mix_v2.wav",
        proxy_dir=proxy_dir,
        proxy_name="v2",
        proxy_url=f"/api/v1/sessions/{session_id}/proxy/v2",
        context=rec.primary_report.context.model_copy(deep=True),
    )
    actual_proxy = _proxy_filename(proxy_dir, "v2")
    revised_report.audio_metadata.playback_proxy_url = f"/api/v1/sessions/{session_id}/proxy/{actual_proxy}"
    rec.proxy_files[actual_proxy] = proxy_dir / actual_proxy
    rec.revised_audio_path = v2_path
    rec.revised_report = revised_report

    comparison = compare_revisions(rec.primary_report, revised_report)
    rec.primary_report.revision_comparison = comparison
    return rec.primary_report


@router.post("/sessions/{session_id}/context", response_model=AnalysisReport)
def update_user_reported_context(
    session_id: str,
    payload: UserReportedContext,
) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    rec.primary_report.context.user_reported_context = UserReportedContext(
        daw=payload.daw.strip(),
        bus_routing=payload.bus_routing.strip(),
        plugin_notes=payload.plugin_notes.strip(),
        source_tag="user_reported_context",
    )
    return rec.primary_report


@router.post("/sessions/{session_id}/mentor", response_model=MentorResponse)
def run_ai_mentor(
    session_id: str,
    payload: MentorRequest,
) -> MentorResponse:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")

    advice = generate_mentor_advice(
        report=rec.primary_report,
        request=payload,
        primary_audio_path=rec.primary_audio_path,
    )
    rec.primary_report.privacy_audit = advice.privacy_audit
    return advice


@router.get("/sessions/{session_id}/proxy/{proxy_filename}")
def stream_playback_proxy(session_id: str, proxy_filename: str) -> FileResponse:
    rec = session_store.get_session(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    proxy_path = rec.proxy_files.get(proxy_filename)
    if proxy_path is None or not proxy_path.exists():
        # Safe check inside session proxy dir
        candidate = (rec.directory / "proxies" / Path(proxy_filename).name).resolve()
        if not candidate.exists() or candidate.parent != (rec.directory / "proxies").resolve():
            raise HTTPException(status_code=404, detail="Audio playback proxy not found.")
        proxy_path = candidate

    media_type = "audio/mp4" if proxy_path.suffix.lower() == ".m4a" else "audio/wav"
    return FileResponse(proxy_path, media_type=media_type, filename=proxy_path.name)


@router.delete("/sessions/{session_id}")
def clear_session(session_id: str) -> dict:
    deleted = session_store.delete_session(session_id)
    return {"deleted": deleted, "session_id": session_id}

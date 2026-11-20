from __future__ import annotations

import asyncio
import base64
import copy
import hashlib
import hmac
import json
import logging
import shutil
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from app.ai import build_deterministic_mentor_response, generate_mentor_advice_async
from app.ai.mentor import GEMINI_REQUEST_TIMEOUT_SEC
from app.core.config import settings
from app.dsp import (
    AudioIngestionError,
    LoadedAudio,
    UnsupportedAudioMediaError,
    analyze_user_stems,
    compute_dynamics_metrics,
    compute_loudness_metrics,
    compute_peak_metrics,
    compute_spectral_profile,
    compute_stereo_metrics,
    create_playback_proxy,
    load_audio_file,
    validate_audio_magic_bytes,
)
from app.dsp.spectrum import build_spectral_bands_from_energies
from app.rules import compare_revisions, compute_streaming_estimates, evaluate_mix_findings
from app.schemas.report import (
    AnalysisContext,
    AnalysisReport,
    ArtistVisionTag,
    AudioMetadata,
    CompareDemoFallbackRequest,
    CompareReportsRequest,
    ContextUpdateRequest,
    Finding,
    GenreType,
    GlobalMetrics,
    MentorRequest,
    MentorResponse,
    MentorStandaloneRequest,
    PrivacyAudit,
    RevisionComparison,
    SpectralBand,
    StageType,
    StemAnalysis,
    StreamingEstimate,
    TimeSeries,
    UserReportedContext,
)
from app.services import (
    CachedDspSnapshot,
    SessionRecord,
    Sha256CachedAnalysis,
    analyze_audio_to_report,
    reevaluate_report_context,
    session_store,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["v1"])
compat_router = APIRouter(tags=["compat"])

VALID_VISION_TAGS: set[str] = {"punchy", "warm", "aggressive", "wide", "dynamic"}

# Bound concurrent CPU-heavy DSP analysis tasks to prevent OOM/CPU starvation under traffic bursts
DSP_CONCURRENCY_LIMIT = 2
_dsp_semaphore = asyncio.Semaphore(DSP_CONCURRENCY_LIMIT)

# In-memory per-IP / per-authenticated-user sliding-window rate limiter with periodic pruning
_rate_lock = threading.Lock()
_rate_buckets: dict[tuple[str, str], list[float]] = {}
_rate_last_prune: float = 0.0

# In-memory cache for static demo fixture DSP results
_demo_cache_lock = threading.Lock()
_demo_mix_cache: dict[str, tuple[float, LoadedAudio, CachedDspSnapshot, GlobalMetrics, TimeSeries, bytes, str]] = {}
_demo_ref_cache: dict[str, tuple[float, dict, bytes, str]] = {}
_demo_stem_cache: dict[str, tuple[tuple[tuple[str, float], ...], StemAnalysis]] = {}


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def _extract_verified_jwt_sub(request: Request) -> str | None:
    """
    Extract and verify a signed-in Supabase user's `sub` UUID from the Authorization Bearer JWT.
    When SUPABASE_JWT_SECRET is configured, HS256 signature verification is strictly enforced.
    """
    auth_header = (request.headers.get("authorization") or "").strip()
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header[7:].strip()
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        header = json.loads(_b64url_decode(parts[0]))
        payload = json.loads(_b64url_decode(parts[1]))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        return None
    exp = payload.get("exp")
    if isinstance(exp, (int, float)) and exp < time.time():
        return None

    secret = settings.supabase_jwt_secret.strip()
    if secret:
        if header.get("alg") != "HS256":
            return None
        signing_input = f"{parts[0]}.{parts[1]}".encode("ascii")
        expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        try:
            actual_sig = _b64url_decode(parts[2])
        except Exception:
            return None
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None

    return sub.strip()


def _extract_authenticated_subject(request: Request) -> str | None:
    """Optionally identify a signed-in Supabase user from Bearer JWT for higher rate-limit quota."""
    sub = _extract_verified_jwt_sub(request)
    if not sub:
        return None
    digest = hashlib.sha256(sub.encode("utf-8")).hexdigest()[:16]
    return f"user:{digest}"


def _assert_session_access(rec: SessionRecord, request: Request) -> None:
    """Enforce per-user isolation on authenticated sessions across proxy, mentor, context, and delete routes."""
    if not rec.owner_user_id:
        return
    caller_sub = _extract_verified_jwt_sub(request)
    if caller_sub != rec.owner_user_id:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: you do not have permission to access this session.",
        )


def _extract_client_ip(request: Request) -> str:
    """Extract the real external client IP from X-Forwarded-For behind Render/Vercel proxies."""
    xff = (request.headers.get("x-forwarded-for") or "").strip()
    if xff:
        for hop in xff.split(","):
            ip = hop.strip()
            if ip:
                return ip
    x_real = (request.headers.get("x-real-ip") or "").strip()
    if x_real:
        return x_real
    return request.client.host if request.client else "unknown"


def _extract_client_rate_key(request: Request) -> str:
    """Return the canonical rate-limit identity key (authenticated user subject or client IP)."""
    return _extract_authenticated_subject(request) or _extract_client_ip(request)


def _prune_rate_buckets(now: float, window: float) -> None:
    global _rate_last_prune
    if (now - _rate_last_prune) < max(window, 30.0) and len(_rate_buckets) < 512:
        return
    _rate_last_prune = now
    stale_keys = [
        k for k, timestamps in _rate_buckets.items() if not timestamps or (now - timestamps[-1]) >= window
    ]
    for k in stale_keys:
        _rate_buckets.pop(k, None)


def enforce_rate_limit(bucket: str):
    def _dependency(request: Request) -> None:
        auth_subject = _extract_authenticated_subject(request)
        identity = auth_subject or _extract_client_ip(request)
        now = time.monotonic()
        window = float(settings.rate_limit_window_seconds)
        limit = (
            settings.rate_limit_auth_max_requests
            if auth_subject is not None
            else settings.rate_limit_max_requests
        )
        key = (identity, bucket)
        with _rate_lock:
            _prune_rate_buckets(now, window)
            hits = [ts for ts in _rate_buckets.get(key, []) if (now - ts) < window]
            if len(hits) >= limit:
                retry_after = max(1, int(window - (now - hits[0])))
                _rate_buckets[key] = hits
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit exceeded for {bucket}. Please wait {retry_after}s before retrying.",
                    headers={"Retry-After": str(retry_after)},
                )
            hits.append(now)
            _rate_buckets[key] = hits

    return _dependency


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


async def _save_upload_bounded(upload: UploadFile, target_path: Path, max_bytes: int) -> tuple[int, str]:
    """Stream upload to disk while enforcing byte cap and computing incremental SHA-256 hash."""
    total = 0
    chunk_size = 1024 * 1024
    hasher = hashlib.sha256()
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
            hasher.update(chunk)
            out.write(chunk)
    return total, hasher.hexdigest()


def _proxy_filename(proxy_dir: Path, stem: str) -> str:
    if (proxy_dir / f"{stem}.m4a").exists():
        return f"{stem}.m4a"
    return f"{stem}.wav"


@compat_router.get("/health")
@compat_router.get("/api/health")
@router.get("/health")
def health_check() -> dict:
    return {
        "status": "ok",
        "version": "1.0.0",
        "contract_version": "1.0.0",
        "ffmpeg_available": shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None,
        "gemini_configured": bool(settings.gemini_api_key.strip()),
        "gemini_model": settings.gemini_model,
        "dsp_concurrency_limit": DSP_CONCURRENCY_LIMIT,
        "sha256_cache_entries": session_store.sha256_cache_size,
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
            low_end_phase_correlation=0.96,
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
                band_name="low",
                title="Low-End Buildup Around 60–250 Hz",
                timestamp_start_sec=64.0,
                timestamp_end_sec=82.0,
                measured_value="+3.4 dB above genre reference range",
                what_happened="Energy between 60 Hz and 250 Hz rises +3.4 dB above typical electronic unmastered mixes during the main drop.",
                why_it_matters="Excess low-end energy consumes headroom early and can sound muddy or boomy on laptop and phone speakers.",
                listen_prompt="Jump to 01:04 and toggle the Laptop and Smartphone translation previews to hear if the kick and bass blur together.",
                what_to_try="Check high-pass filters on non-bass instruments around 100–140 Hz or apply a gentle 1.5–2.5 dB dynamic EQ dip near 140 Hz.",
                recheck_target="Re-export and verify 60–250 Hz band energy moves closer to 0 to +1.5 dB relative balance.",
            )
        ],
        stem_analysis=None,
        revision_comparison=None,
        privacy_audit=PrivacyAudit(),
    )


def _tmp_upload_path(prefix: str, safe_name: str) -> Path:
    tmp_dir = Path(tempfile.gettempdir()) / "mixbench_uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    return tmp_dir / f"{prefix}_{uuid.uuid4().hex[:8]}_{safe_name}"


def _build_reference_payload(
    session_id: str,
    rec,
    ref_path: Path,
    ref_filename: str,
) -> dict:
    loaded = load_audio_file(ref_path, max_bytes=settings.max_single_file_bytes)
    loudness = compute_loudness_metrics(loaded.samples, loaded.sample_rate)
    peaks = compute_peak_metrics(loaded.samples, loaded.sample_rate, source_path=ref_path)
    dynamics = compute_dynamics_metrics(
        loaded.samples,
        sample_peak_dbfs=peaks.sample_peak_dbfs,
        true_peak_dbtp=peaks.true_peak_dbtp,
        short_term_max_lufs=loudness.short_term_max_lufs,
        integrated_lufs=loudness.integrated_lufs,
        sample_rate=loaded.sample_rate,
    )
    genre: GenreType = rec.primary_report.context.genre if rec.primary_report else "electronic"
    spectral = compute_spectral_profile(loaded.samples, loaded.sample_rate, genre=genre)
    stereo = compute_stereo_metrics(loaded.samples, loaded.sample_rate)

    proxy_dir = rec.directory / "proxies"
    create_playback_proxy(ref_path, proxy_dir, stem_name="reference")
    actual_proxy = _proxy_filename(proxy_dir, "reference")
    rec.proxy_files[actual_proxy] = proxy_dir / actual_proxy
    rec.reference_audio_path = proxy_dir / actual_proxy

    ref_metrics = GlobalMetrics(
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
    return {
        "reference_filename": ref_filename,
        "integrated_lufs": loudness.integrated_lufs,
        "true_peak_dbtp": peaks.true_peak_dbtp,
        "duration_sec": loaded.duration_sec,
        "playback_proxy_url": f"/api/v1/sessions/{session_id}/proxy/{actual_proxy}",
        "waveform_peaks": loaded.waveform_peaks,
        "global_metrics": ref_metrics.model_dump(mode="json"),
        "spectral_bands": [b.model_dump(mode="json") for b in spectral.bands],
    }


@compat_router.post(
    "/api/analyze",
    response_model=AnalysisReport,
    dependencies=[Depends(enforce_rate_limit("analyze"))],
)
@router.post(
    "/analyze",
    response_model=AnalysisReport,
    dependencies=[Depends(enforce_rate_limit("analyze"))],
)
async def analyze_mix(
    request: Request,
    file: UploadFile = File(...),
    genre: GenreType = Form("electronic"),
    stage: StageType = Form("unmastered_mix"),
    artist_vision: str = Form("[]"),
    daw: str = Form(""),
    bus_routing: str = Form(""),
    plugin_notes: str = Form(""),
) -> AnalysisReport:
    owner_user_id = _extract_verified_jwt_sub(request)
    rec = session_store.create_session(owner_user_id=owner_user_id)
    safe_name = Path(file.filename or "mix.wav").name
    tmp_upload_path = _tmp_upload_path("primary", safe_name)

    try:
        _, sha256_hex = await _save_upload_bounded(file, tmp_upload_path, settings.max_single_file_bytes)
        validate_audio_magic_bytes(tmp_upload_path)
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

        cached_hash_entry = session_store.get_cached_analysis_by_hash(sha256_hex)
        if cached_hash_entry is not None:
            report, proxy_path = _instantiate_report_from_cached_entry(
                session_id=rec.session_id,
                original_filename=safe_name,
                proxy_dir=proxy_dir,
                proxy_name="proxy",
                context=context,
                duration_sec=cached_hash_entry.duration_sec,
                sample_rate=cached_hash_entry.sample_rate,
                channels=cached_hash_entry.channels,
                bit_depth=cached_hash_entry.bit_depth,
                waveform_peaks=cached_hash_entry.waveform_peaks,
                snapshot=cached_hash_entry.snapshot,
                global_metrics=cached_hash_entry.global_metrics,
                time_series=cached_hash_entry.time_series,
                proxy_bytes=cached_hash_entry.proxy_bytes,
                proxy_ext=cached_hash_entry.proxy_ext,
            )
            actual_proxy = proxy_path.name
            rec.proxy_files[actual_proxy] = proxy_path
            rec.primary_audio_path = proxy_path
            rec.primary_loaded = None
            rec.primary_report = report
            rec.primary_snapshot = cached_hash_entry.snapshot
            return report

        async with _dsp_semaphore:
            report, loaded, snapshot = await asyncio.to_thread(
                analyze_audio_to_report,
                session_id=rec.session_id,
                source_path=tmp_upload_path,
                original_filename=safe_name,
                proxy_dir=proxy_dir,
                proxy_name="proxy",
                proxy_url=f"/api/v1/sessions/{rec.session_id}/proxy/proxy",
                context=context,
                max_file_bytes=settings.max_single_file_bytes,
                return_snapshot=True,
            )

        actual_proxy = _proxy_filename(proxy_dir, "proxy")
        proxy_path = proxy_dir / actual_proxy
        report.audio_metadata.playback_proxy_url = f"/api/v1/sessions/{rec.session_id}/proxy/{actual_proxy}"
        rec.proxy_files[actual_proxy] = proxy_path
        # Persist the compressed proxy path on the session record so RAM-evicted sessions reload cleanly
        rec.primary_audio_path = proxy_path
        rec.primary_loaded = loaded
        rec.primary_report = report
        rec.primary_snapshot = snapshot

        if proxy_path.exists():
            session_store.set_cached_analysis_by_hash(
                sha256_hex,
                Sha256CachedAnalysis(
                    sha256=sha256_hex,
                    duration_sec=loaded.duration_sec,
                    sample_rate=loaded.sample_rate,
                    channels=loaded.channels,
                    bit_depth=loaded.bit_depth,
                    waveform_peaks=loaded.waveform_peaks,
                    snapshot=snapshot,
                    global_metrics=copy.deepcopy(report.global_metrics),
                    time_series=copy.deepcopy(report.time_series),
                    proxy_bytes=proxy_path.read_bytes(),
                    proxy_ext=proxy_path.suffix,
                ),
            )
        return report
    except UnsupportedAudioMediaError as exc:
        session_store.delete_session(rec.session_id)
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except AudioIngestionError as exc:
        session_store.delete_session(rec.session_id)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HTTPException:
        session_store.delete_session(rec.session_id)
        raise
    except Exception as exc:
        session_store.delete_session(rec.session_id)
        logger.exception("Audio analysis failed for upload '%s'", safe_name)
        raise HTTPException(
            status_code=500,
            detail="Audio analysis failed due to an internal processing error.",
        ) from exc
    finally:
        tmp_upload_path.unlink(missing_ok=True)


def _instantiate_report_from_cached_entry(
    session_id: str,
    original_filename: str,
    proxy_dir: Path,
    proxy_name: str,
    context: AnalysisContext,
    duration_sec: float,
    sample_rate: int,
    channels: int,
    bit_depth: int,
    waveform_peaks: list[list[float]],
    snapshot: CachedDspSnapshot,
    global_metrics: GlobalMetrics,
    time_series: TimeSeries,
    proxy_bytes: bytes,
    proxy_ext: str,
) -> tuple[AnalysisReport, Path]:
    proxy_dir.mkdir(parents=True, exist_ok=True)
    actual_proxy_name = f"{proxy_name}{proxy_ext}"
    proxy_path = proxy_dir / actual_proxy_name
    proxy_path.write_bytes(proxy_bytes)

    updated_bands = build_spectral_bands_from_energies(snapshot.band_energies_db, context.genre)
    from app.dsp.spectrum import SpectralAnalysisResult

    spectral_res = SpectralAnalysisResult(
        bands=updated_bands,
        band_peak_windows=snapshot.spectral.band_peak_windows,
    )
    streaming_estimates = compute_streaming_estimates(global_metrics)
    findings = evaluate_mix_findings(
        context=context,
        duration_sec=snapshot.duration_sec,
        loudness=snapshot.loudness,
        peaks=snapshot.peaks,
        dynamics=snapshot.dynamics,
        spectral=spectral_res,
        stereo=snapshot.stereo,
    )
    report = AnalysisReport(
        schema_version="1.0.0",
        session_id=session_id,
        report_id=f"rep_{uuid.uuid4().hex[:8]}",
        created_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        context=context,
        audio_metadata=AudioMetadata(
            filename=original_filename,
            duration_sec=duration_sec,
            sample_rate_hz=sample_rate,
            channels=channels,
            bit_depth=bit_depth,
            playback_proxy_url=f"/api/v1/sessions/{session_id}/proxy/{actual_proxy_name}",
            waveform_peaks=copy.deepcopy(waveform_peaks),
            clipping_timestamps_sec=list(snapshot.peaks.clipping_timestamps_sec),
            bpm=snapshot.bpm,
            sections=copy.deepcopy(snapshot.sections),
        ),
        global_metrics=copy.deepcopy(global_metrics),
        streaming_estimates=streaming_estimates,
        spectral_bands=updated_bands,
        time_series=copy.deepcopy(time_series),
        findings=findings,
        stem_analysis=None,
        revision_comparison=None,
        privacy_audit=PrivacyAudit(),
    )
    return report, proxy_path


def _instantiate_report_from_cached_demo(
    session_id: str,
    original_filename: str,
    proxy_dir: Path,
    proxy_name: str,
    context: AnalysisContext,
    loaded: LoadedAudio,
    snapshot: CachedDspSnapshot,
    global_metrics: GlobalMetrics,
    time_series: TimeSeries,
    proxy_bytes: bytes,
    proxy_ext: str,
) -> tuple[AnalysisReport, Path]:
    return _instantiate_report_from_cached_entry(
        session_id=session_id,
        original_filename=original_filename,
        proxy_dir=proxy_dir,
        proxy_name=proxy_name,
        context=context,
        duration_sec=loaded.duration_sec,
        sample_rate=loaded.sample_rate,
        channels=loaded.channels,
        bit_depth=loaded.bit_depth,
        waveform_peaks=loaded.waveform_peaks,
        snapshot=snapshot,
        global_metrics=global_metrics,
        time_series=time_series,
        proxy_bytes=proxy_bytes,
        proxy_ext=proxy_ext,
    )


@router.post(
    "/sessions/demo",
    response_model=AnalysisReport,
    dependencies=[Depends(enforce_rate_limit("demo"))],
)
def create_demo_session(
    request: Request,
    genre: GenreType = Form("electronic"),
    stage: StageType = Form("unmastered_mix"),
    artist_vision: str = Form('["punchy","wide"]'),
) -> AnalysisReport:
    demo_src = settings.sample_assets_dir / "unmastered_mix_v1.wav"
    if not demo_src.exists():
        raise HTTPException(status_code=404, detail="Sample demo mix asset has not been generated yet.")

    rec = session_store.create_session(owner_user_id=_extract_verified_jwt_sub(request))
    context = AnalysisContext(
        genre=genre,
        stage=stage,
        artist_vision=_parse_artist_vision(artist_vision),
        has_user_stems=False,
        stem_count=0,
    )
    proxy_dir = rec.directory / "proxies"
    src_mtime = demo_src.stat().st_mtime
    cache_key = str(demo_src.resolve())

    with _demo_cache_lock:
        cached = _demo_mix_cache.get(cache_key)

    if cached is not None and cached[0] == src_mtime:
        _, loaded, snapshot, gm, ts, proxy_bytes, proxy_ext = cached
        report, proxy_path = _instantiate_report_from_cached_demo(
            session_id=rec.session_id,
            original_filename="unmastered_mix_v1.wav",
            proxy_dir=proxy_dir,
            proxy_name="proxy",
            context=context,
            loaded=loaded,
            snapshot=snapshot,
            global_metrics=gm,
            time_series=ts,
            proxy_bytes=proxy_bytes,
            proxy_ext=proxy_ext,
        )
        actual_proxy = proxy_path.name
    else:
        report, loaded, snapshot = analyze_audio_to_report(
            session_id=rec.session_id,
            source_path=demo_src,
            original_filename="unmastered_mix_v1.wav",
            proxy_dir=proxy_dir,
            proxy_name="proxy",
            proxy_url=f"/api/v1/sessions/{rec.session_id}/proxy/proxy",
            context=context,
            return_snapshot=True,
        )
        actual_proxy = _proxy_filename(proxy_dir, "proxy")
        proxy_path = proxy_dir / actual_proxy
        report.audio_metadata.playback_proxy_url = f"/api/v1/sessions/{rec.session_id}/proxy/{actual_proxy}"
        if proxy_path.exists():
            with _demo_cache_lock:
                _demo_mix_cache[cache_key] = (
                    src_mtime,
                    loaded,
                    snapshot,
                    report.global_metrics,
                    report.time_series,
                    proxy_path.read_bytes(),
                    proxy_path.suffix,
                )

    rec.proxy_files[actual_proxy] = proxy_path
    rec.primary_audio_path = proxy_path
    rec.primary_loaded = loaded
    rec.primary_report = report
    rec.primary_snapshot = snapshot
    return report


@router.post("/sessions/{session_id}/reference")
async def upload_reference_track(
    session_id: str,
    request: Request,
    file: UploadFile = File(...),
) -> dict:
    rec = session_store.get_session(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    _assert_session_access(rec, request)

    safe_name = Path(file.filename or "reference.wav").name
    tmp_ref_path = _tmp_upload_path("reference", safe_name)

    try:
        await _save_upload_bounded(file, tmp_ref_path, settings.max_single_file_bytes)
        validate_audio_magic_bytes(tmp_ref_path)
        async with _dsp_semaphore:
            return await asyncio.to_thread(_build_reference_payload, session_id, rec, tmp_ref_path, safe_name)
    except UnsupportedAudioMediaError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except AudioIngestionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        tmp_ref_path.unlink(missing_ok=True)


@router.post("/sessions/{session_id}/reference/demo")
def load_demo_reference_track(session_id: str, request: Request) -> dict:
    rec = session_store.get_session(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    _assert_session_access(rec, request)
    demo_ref = settings.sample_assets_dir / "reference_track.wav"
    if not demo_ref.exists():
        raise HTTPException(status_code=404, detail="Demo reference track missing.")

    ref_mtime = demo_ref.stat().st_mtime
    cache_key = str(demo_ref.resolve())
    with _demo_cache_lock:
        cached = _demo_ref_cache.get(cache_key)

    if cached is not None and cached[0] == ref_mtime:
        _, payload_tpl, proxy_bytes, proxy_name = cached
        proxy_dir = rec.directory / "proxies"
        proxy_dir.mkdir(parents=True, exist_ok=True)
        proxy_path = proxy_dir / proxy_name
        proxy_path.write_bytes(proxy_bytes)
        rec.proxy_files[proxy_name] = proxy_path
        rec.reference_audio_path = proxy_path
        payload = copy.deepcopy(payload_tpl)
        payload["playback_proxy_url"] = f"/api/v1/sessions/{session_id}/proxy/{proxy_name}"
        genre: GenreType = rec.primary_report.context.genre if rec.primary_report else "electronic"
        band_energies = {b["band"]: b["energy_db"] for b in payload["spectral_bands"]}
        recomputed = build_spectral_bands_from_energies(band_energies, genre)
        payload["spectral_bands"] = [b.model_dump(mode="json") for b in recomputed]
        return payload

    payload = _build_reference_payload(session_id, rec, demo_ref, "reference_track.wav")
    proxy_name = _proxy_filename(rec.directory / "proxies", "reference")
    proxy_path = rec.directory / "proxies" / proxy_name
    if proxy_path.exists():
        with _demo_cache_lock:
            _demo_ref_cache[cache_key] = (ref_mtime, copy.deepcopy(payload), proxy_path.read_bytes(), proxy_name)
    return payload


async def _analyze_uploaded_stems_to_temp(
    files: list[UploadFile],
    rec=None,
) -> tuple[StemAnalysis, int]:
    if len(files) < 2 or len(files) > 8:
        raise HTTPException(
            status_code=422,
            detail=f"Upload between 2 and 8 original stems (received {len(files)}).",
        )

    with tempfile.TemporaryDirectory(prefix="mixbench_stems_") as tmp_dir:
        stems_dir = Path(tmp_dir)
        saved_stems: list[tuple[str, Path]] = []
        running_total = 0

        for idx, f in enumerate(files):
            safe_name = Path(f.filename or f"stem_{idx + 1}.wav").name
            stem_path = stems_dir / f"{idx:02d}_{safe_name}"
            size, _ = await _save_upload_bounded(f, stem_path, settings.max_single_file_bytes)
            running_total += size
            if running_total > settings.max_stem_total_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"Combined stems exceed the {settings.max_stem_total_mb} MB session limit.",
                )
            try:
                validate_audio_magic_bytes(stem_path)
            except UnsupportedAudioMediaError as exc:
                raise HTTPException(status_code=415, detail=str(exc)) from exc
            saved_stems.append((safe_name, stem_path))

        try:
            async with _dsp_semaphore:
                mix_audio = (
                    await asyncio.to_thread(session_store.get_or_reload_primary_audio, rec)
                    if rec is not None
                    else None
                )
                stem_analysis = await asyncio.to_thread(
                    analyze_user_stems,
                    saved_stems,
                    mix_audio=mix_audio,
                    max_total_bytes=settings.max_stem_total_bytes,
                )
            return stem_analysis, len(saved_stems)
        except UnsupportedAudioMediaError as exc:
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        except AudioIngestionError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/sessions/{session_id}/stems",
    response_model=AnalysisReport,
    dependencies=[Depends(enforce_rate_limit("stems"))],
)
async def upload_user_stems(
    session_id: str,
    request: Request,
    files: list[UploadFile] = File(...),
) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    _assert_session_access(rec, request)

    stem_analysis, count = await _analyze_uploaded_stems_to_temp(files, rec=rec)
    rec.primary_report.context.has_user_stems = True
    rec.primary_report.context.stem_count = count
    rec.primary_report.stem_analysis = stem_analysis
    return rec.primary_report


@compat_router.post(
    "/api/analyze/stems",
    dependencies=[Depends(enforce_rate_limit("stems"))],
)
async def analyze_stems_endpoint(
    request: Request,
    files: list[UploadFile] = File(...),
    session_id: str | None = Form(None),
) -> AnalysisReport | StemAnalysis:
    if session_id:
        rec = session_store.get_session(session_id)
        if rec is None or rec.primary_report is None:
            raise HTTPException(status_code=404, detail="Session expired or not found.")
        _assert_session_access(rec, request)
        stem_analysis, count = await _analyze_uploaded_stems_to_temp(files, rec=rec)
        rec.primary_report.context.has_user_stems = True
        rec.primary_report.context.stem_count = count
        rec.primary_report.stem_analysis = stem_analysis
        return rec.primary_report

    stem_analysis, _ = await _analyze_uploaded_stems_to_temp(files, rec=None)
    return stem_analysis


@router.post("/sessions/{session_id}/stems/demo", response_model=AnalysisReport)
def load_demo_stems(session_id: str, request: Request) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    _assert_session_access(rec, request)

    demo_stems_dir = settings.sample_assets_dir / "stems"
    stem_paths = sorted(demo_stems_dir.glob("*.wav"))
    if len(stem_paths) < 2:
        raise HTTPException(status_code=404, detail="Demo stems are not available.")

    saved_stems = [(p.name, p) for p in stem_paths]
    sig = tuple((p.name, p.stat().st_mtime) for p in stem_paths)
    mix_sig = rec.primary_report.audio_metadata.filename
    cache_key = f"{demo_stems_dir.resolve()}::{mix_sig}"

    with _demo_cache_lock:
        cached = _demo_stem_cache.get(cache_key)

    if cached is not None and cached[0] == sig:
        stem_analysis = copy.deepcopy(cached[1])
    else:
        mix_audio = session_store.get_or_reload_primary_audio(rec)
        stem_analysis = analyze_user_stems(saved_stems, mix_audio=mix_audio)
        with _demo_cache_lock:
            _demo_stem_cache[cache_key] = (sig, copy.deepcopy(stem_analysis))

    rec.primary_report.context.has_user_stems = True
    rec.primary_report.context.stem_count = len(saved_stems)
    rec.primary_report.stem_analysis = stem_analysis
    return rec.primary_report


@router.post(
    "/sessions/{session_id}/compare",
    response_model=AnalysisReport,
    dependencies=[Depends(enforce_rate_limit("compare"))],
)
async def compare_revised_mix(
    session_id: str,
    request: Request,
    file: UploadFile = File(...),
) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    _assert_session_access(rec, request)

    safe_name = Path(file.filename or "mix_v2.wav").name
    tmp_v2_path = _tmp_upload_path("v2", safe_name)

    try:
        await _save_upload_bounded(file, tmp_v2_path, settings.max_single_file_bytes)
        validate_audio_magic_bytes(tmp_v2_path)
        proxy_dir = rec.directory / "proxies"
        async with _dsp_semaphore:
            revised_report, _ = await asyncio.to_thread(
                analyze_audio_to_report,
                session_id=session_id,
                source_path=tmp_v2_path,
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
        rec.revised_audio_path = proxy_dir / actual_proxy
        rec.revised_report = revised_report

        comparison = compare_revisions(rec.primary_report, revised_report)
        rec.primary_report.revision_comparison = comparison
        return rec.primary_report
    except UnsupportedAudioMediaError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except AudioIngestionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        tmp_v2_path.unlink(missing_ok=True)


def _build_demo_v2_report(
    *,
    session_id: str,
    context: AnalysisContext,
    proxy_dir: Path | None = None,
    proxy_url_override: str | None = None,
) -> tuple[AnalysisReport, Path | None, str]:
    """Analyze or hydrate the cached demo revised_mix_v2.wav fixture for deterministic v1 -> v2 checks."""
    v2_src = settings.sample_assets_dir / "revised_mix_v2.wav"
    if not v2_src.exists():
        raise HTTPException(status_code=404, detail="Demo revised_mix_v2.wav missing.")

    src_mtime = v2_src.stat().st_mtime
    cache_key = str(v2_src.resolve())
    with _demo_cache_lock:
        cached = _demo_mix_cache.get(cache_key)

    temp_proxy_dir: Path | None = None
    target_proxy_dir = proxy_dir
    if target_proxy_dir is None:
        temp_proxy_dir = Path(tempfile.mkdtemp(prefix="mixbench_demo_v2_"))
        target_proxy_dir = temp_proxy_dir

    try:
        if cached is not None and cached[0] == src_mtime:
            _, loaded, snapshot, gm, ts, proxy_bytes, proxy_ext = cached
            revised_report, proxy_path = _instantiate_report_from_cached_demo(
                session_id=session_id,
                original_filename="revised_mix_v2.wav",
                proxy_dir=target_proxy_dir,
                proxy_name="v2",
                context=context.model_copy(deep=True),
                loaded=loaded,
                snapshot=snapshot,
                global_metrics=gm,
                time_series=ts,
                proxy_bytes=proxy_bytes,
                proxy_ext=proxy_ext,
            )
            actual_proxy = proxy_path.name
        else:
            revised_report, loaded, snapshot = analyze_audio_to_report(
                session_id=session_id,
                source_path=v2_src,
                original_filename="revised_mix_v2.wav",
                proxy_dir=target_proxy_dir,
                proxy_name="v2",
                proxy_url=proxy_url_override or f"/api/v1/sessions/{session_id}/proxy/v2",
                context=context.model_copy(deep=True),
                return_snapshot=True,
            )
            actual_proxy = _proxy_filename(target_proxy_dir, "v2")
            proxy_path = target_proxy_dir / actual_proxy
            revised_report.audio_metadata.playback_proxy_url = (
                proxy_url_override or f"/api/v1/sessions/{session_id}/proxy/{actual_proxy}"
            )
            if proxy_path.exists():
                with _demo_cache_lock:
                    _demo_mix_cache[cache_key] = (
                        src_mtime,
                        loaded,
                        snapshot,
                        revised_report.global_metrics,
                        revised_report.time_series,
                        proxy_path.read_bytes(),
                        proxy_path.suffix,
                    )

        if proxy_url_override:
            revised_report.audio_metadata.playback_proxy_url = proxy_url_override
        return revised_report, (None if temp_proxy_dir is not None else proxy_path), actual_proxy
    finally:
        if temp_proxy_dir is not None:
            shutil.rmtree(temp_proxy_dir, ignore_errors=True)


@compat_router.post(
    "/api/compare",
    response_model=RevisionComparison,
    dependencies=[Depends(enforce_rate_limit("compare"))],
)
def compare_reports_endpoint(payload: CompareReportsRequest) -> RevisionComparison:
    """Stateless deterministic comparison between a baseline v1 report and revised v2 (or cached demo v2) report."""
    revised = payload.revised
    if revised is None:
        revised, _, _ = _build_demo_v2_report(
            session_id=payload.baseline.session_id,
            context=payload.baseline.context,
            proxy_dir=None,
            proxy_url_override="/demo/demo-revised-v2.wav",
        )
    return compare_revisions(payload.baseline, revised)


@router.post("/sessions/{session_id}/compare/demo", response_model=AnalysisReport)
def compare_demo_revised_mix(
    session_id: str,
    request: Request,
    payload: CompareDemoFallbackRequest | None = Body(default=None),
) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        if isinstance(payload, CompareDemoFallbackRequest) and payload.baseline is not None:
            baseline = payload.baseline.model_copy(deep=True)
            revised_report, _, _ = _build_demo_v2_report(
                session_id=baseline.session_id,
                context=baseline.context,
                proxy_dir=None,
                proxy_url_override="/demo/demo-revised-v2.wav",
            )
            baseline.revision_comparison = compare_revisions(baseline, revised_report)
            return baseline
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    _assert_session_access(rec, request)

    proxy_dir = rec.directory / "proxies"
    revised_report, proxy_path, actual_proxy = _build_demo_v2_report(
        session_id=session_id,
        context=rec.primary_report.context,
        proxy_dir=proxy_dir,
    )

    if proxy_path is not None:
        rec.proxy_files[actual_proxy] = proxy_path
        rec.revised_audio_path = proxy_path
    rec.revised_report = revised_report

    comparison = compare_revisions(rec.primary_report, revised_report)
    rec.primary_report.revision_comparison = comparison
    return rec.primary_report


@router.post(
    "/sessions/{session_id}/context",
    response_model=AnalysisReport,
    dependencies=[Depends(enforce_rate_limit("context"))],
)
def update_user_reported_context(
    session_id: str,
    payload: ContextUpdateRequest,
    request: Request,
) -> AnalysisReport:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    _assert_session_access(rec, request)

    cur_ctx = rec.primary_report.context.model_copy(deep=True)
    if payload.genre is not None:
        cur_ctx.genre = payload.genre
    if payload.stage is not None:
        cur_ctx.stage = payload.stage
    if payload.artist_vision is not None:
        cur_ctx.artist_vision = payload.artist_vision

    has_notes = any(
        val is not None
        for val in (payload.daw, payload.bus_routing, payload.plugin_notes)
    )
    if has_notes:
        existing_notes = cur_ctx.user_reported_context or UserReportedContext()
        cur_ctx.user_reported_context = UserReportedContext(
            daw=(payload.daw if payload.daw is not None else existing_notes.daw).strip(),
            bus_routing=(
                payload.bus_routing if payload.bus_routing is not None else existing_notes.bus_routing
            ).strip(),
            plugin_notes=(
                payload.plugin_notes if payload.plugin_notes is not None else existing_notes.plugin_notes
            ).strip(),
            source_tag="user_reported_context",
        )

    reevaluate_report_context(rec.primary_report, rec.primary_snapshot, cur_ctx)
    if rec.revised_report is not None:
        rec.primary_report.revision_comparison = compare_revisions(rec.primary_report, rec.revised_report)
    return rec.primary_report


async def _run_mentor_with_guaranteed_fallback(
    *,
    report: AnalysisReport,
    mentor_request: MentorRequest,
    primary_audio_path: Path | None = None,
    fallback_proxy_path: Path | None = None,
) -> MentorResponse:
    """Invoke generate_mentor_advice_async under the shared 35.0s asyncio.wait_for guard."""
    try:
        return await asyncio.wait_for(
            generate_mentor_advice_async(
                report=report,
                request=mentor_request,
                primary_audio_path=primary_audio_path,
                fallback_proxy_path=fallback_proxy_path,
                timeout_sec=GEMINI_REQUEST_TIMEOUT_SEC,
            ),
            timeout=GEMINI_REQUEST_TIMEOUT_SEC + 0.5,
        )
    except (asyncio.TimeoutError, TimeoutError):
        return build_deterministic_mentor_response(
            report,
            mentor_request,
            fallback_reason=f"Offline Mentor fallback (Timeout after {int(round(GEMINI_REQUEST_TIMEOUT_SEC))}s)",
        )
    except Exception as exc:
        logger.warning("AI Mix Mentor route fallback (%s): %s", type(exc).__name__, exc)
        return build_deterministic_mentor_response(
            report,
            mentor_request,
            fallback_reason=f"Offline Mentor fallback ({type(exc).__name__})",
        )


@router.post(
    "/sessions/{session_id}/mentor",
    response_model=MentorResponse,
    dependencies=[Depends(enforce_rate_limit("mentor"))],
)
async def run_ai_mentor(
    session_id: str,
    payload: MentorRequest,
    request: Request,
) -> MentorResponse:
    rec = session_store.get_session(session_id)
    if rec is None or rec.primary_report is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    _assert_session_access(rec, request)

    fallback_proxy = rec.proxy_files.get("proxy.m4a") or rec.proxy_files.get("proxy.wav")
    advice = await _run_mentor_with_guaranteed_fallback(
        report=rec.primary_report,
        mentor_request=payload,
        primary_audio_path=rec.primary_audio_path or fallback_proxy,
        fallback_proxy_path=fallback_proxy,
    )
    rec.primary_report.privacy_audit = advice.privacy_audit
    return advice


@compat_router.post(
    "/api/mentor",
    response_model=MentorResponse,
    dependencies=[Depends(enforce_rate_limit("mentor"))],
)
async def standalone_ai_mentor(payload: MentorStandaloneRequest, request: Request) -> MentorResponse:
    req = MentorRequest(
        allow_metrics_ai=payload.allow_metrics_ai,
        allow_audio_ai=payload.allow_audio_ai,
        allow_training_opt_in=payload.allow_training_opt_in,
        question=payload.question,
        conversation_history=payload.conversation_history,
    )
    if payload.session_id:
        rec = session_store.get_session(payload.session_id)
        if rec is not None and rec.primary_report is not None:
            _assert_session_access(rec, request)
            fallback_proxy = rec.proxy_files.get("proxy.m4a") or rec.proxy_files.get("proxy.wav")
            advice = await _run_mentor_with_guaranteed_fallback(
                report=payload.report or rec.primary_report,
                mentor_request=req,
                primary_audio_path=rec.primary_audio_path or fallback_proxy,
                fallback_proxy_path=fallback_proxy,
            )
            rec.primary_report.privacy_audit = advice.privacy_audit
            return advice
        if payload.report is None:
            raise HTTPException(status_code=404, detail="Session expired or not found.")

    if payload.report is None:
        raise HTTPException(status_code=422, detail="Provide either 'session_id' or a full DSP 'report'.")

    # Standalone JSON-only call cannot transmit audio bytes without a session proxy
    if req.allow_audio_ai:
        req = MentorRequest(
            allow_metrics_ai=req.allow_metrics_ai,
            allow_audio_ai=False,
            allow_training_opt_in=req.allow_training_opt_in,
            question=req.question,
            conversation_history=req.conversation_history,
        )
    return await _run_mentor_with_guaranteed_fallback(
        report=payload.report,
        mentor_request=req,
    )


@router.get("/sessions/{session_id}/proxy/{proxy_filename}")
def stream_playback_proxy(session_id: str, proxy_filename: str, request: Request) -> FileResponse:
    rec = session_store.get_session(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Session expired or not found.")
    _assert_session_access(rec, request)
    proxy_path = rec.proxy_files.get(proxy_filename)
    if proxy_path is None or not proxy_path.exists():
        candidate = (rec.directory / "proxies" / Path(proxy_filename).name).resolve()
        if not candidate.exists() or candidate.parent != (rec.directory / "proxies").resolve():
            raise HTTPException(status_code=404, detail="Audio playback proxy not found.")
        proxy_path = candidate

    media_type = "audio/mp4" if proxy_path.suffix.lower() == ".m4a" else "audio/wav"
    return FileResponse(proxy_path, media_type=media_type, filename=proxy_path.name)


@router.delete("/sessions/{session_id}")
def clear_session(session_id: str, request: Request) -> dict:
    rec = session_store.get_session(session_id)
    if rec is not None:
        _assert_session_access(rec, request)
    deleted = session_store.delete_session(session_id)
    return {"deleted": deleted, "session_id": session_id}

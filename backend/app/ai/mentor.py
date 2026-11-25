from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path

from pydantic import BaseModel, Field

from app.core.config import settings
from app.dsp.ingest import extract_audio_clip
from app.schemas.report import (
    AnalysisReport,
    MentorAction,
    MentorRequest,
    MentorResponse,
    PrivacyAudit,
)

logger = logging.getLogger(__name__)

GEMINI_PER_ATTEMPT_TIMEOUT_SEC = 15.0
GEMINI_PER_ATTEMPT_TIMEOUT_MS = int(GEMINI_PER_ATTEMPT_TIMEOUT_SEC * 1000)
GEMINI_REQUEST_TIMEOUT_SEC = 30.0
GEMINI_REQUEST_TIMEOUT_MS = int(GEMINI_REQUEST_TIMEOUT_SEC * 1000)
GEMINI_TRANSIENT_RETRY_DELAYS_SEC: tuple[float, ...] = (1.5,)


class MentorLLMOutput(BaseModel):
    summary: str = Field(description="Concise 2-3 sentence coaching summary grounded in the measured DSP telemetry.")
    vision_alignment_note: str = Field(
        description="How the artist's creative profile tags align or trade off with physical headroom/translation limits."
    )
    prioritized_actions: list[MentorAction] = Field(
        description="Ordered DAW learning experiments. Every evidence_id MUST match one present in the DSP report."
    )


def _valid_evidence_ids(report: AnalysisReport) -> set[str]:
    ids = {f.evidence_id for f in report.findings}
    if report.stem_analysis:
        ids.update(pair.evidence_id for pair in report.stem_analysis.overlap_matrix)
    return ids


def _vision_note(report: AnalysisReport) -> str:
    vision = report.context.artist_vision
    if not vision:
        return (
            f"No creative profile tags selected; guidance targets clean {report.context.genre} "
            f"({report.context.stage.replace('_', ' ')}) translation without altering your artistic balance."
        )
    tags = ", ".join(tag.title() for tag in vision)
    parts: list[str] = [f"Selected Artist Vision ({tags}) informs trade-offs without hiding physical limits."]
    if "aggressive" in vision:
        parts.append(
            "Intentional harmonic density is respected, though inter-sample clipping (> -0.1 dBTP) is never suppressed."
        )
    if "warm" in vision:
        parts.append("Gentle high-frequency roll-off can fit a Warm character as long as midrange clarity translates on Laptop/Phone.")
    if "wide" in vision:
        parts.append("Stereo width is encouraged above ~200 Hz while keeping sub-bass centered for mono translation.")
    if "punchy" in vision or "dynamic" in vision:
        parts.append("Preserving PSR (>= 7 dB) and transient crest keeps kick/snare snap alive under streaming normalization.")
    return " ".join(parts)


def select_audio_clip_start_sec(report: AnalysisReport, clip_duration_sec: float = 25.0) -> float:
    """
    Pick the highest-leverage 25s window for opt-in multimodal Gemini listening:
    1) Highest-severity finding (alert -> caution -> safe) that has a localized non-zero start timestamp.
    2) Else fall back to the short-term LUFS peak (chorus/drop) rather than defaulting blindly to t=0.0.
    """
    duration = max(0.0, float(report.audio_metadata.duration_sec))
    max_start = max(0.0, duration - clip_duration_sec)
    severity_rank = {"alert": 0, "caution": 1, "safe": 2}
    ordered = sorted(report.findings, key=lambda f: severity_rank.get(f.severity, 3))
    for f in ordered:
        if f.timestamp_start_sec > 0.0:
            return round(min(max_start, max(0.0, f.timestamp_start_sec)), 2)

    series = report.time_series.short_term_lufs
    if series:
        step = max(0.1, float(report.time_series.step_sec or 1.0))
        peak_idx = max(range(len(series)), key=lambda i: series[i])
        peak_sec = peak_idx * step
        if peak_sec > 0.0:
            start = max(0.0, peak_sec - min(5.0, clip_duration_sec * 0.2))
            return round(min(max_start, start), 2)

    return 0.0


def build_deterministic_mentor_response(
    report: AnalysisReport,
    request: MentorRequest,
    fallback_reason: str | None = None,
) -> MentorResponse:
    """Offline deterministic mentor guaranteed to work with zero external API keys or network."""
    m = report.global_metrics
    top_findings = report.findings[:3]

    actions: list[MentorAction] = []
    for idx, finding in enumerate(top_findings, start=1):
        actions.append(
            MentorAction(
                evidence_id=finding.evidence_id,
                priority=idx,
                headline=finding.title,
                coaching_note=f"{finding.what_happened} {finding.why_it_matters}",
                daw_experiment=f"{finding.listen_prompt} Then test: {finding.what_to_try}",
                verification_step=finding.recheck_target,
            )
        )

    if report.stem_analysis and report.stem_analysis.overlap_matrix and len(actions) < 4:
        top_overlap = report.stem_analysis.overlap_matrix[0]
        actions.append(
            MentorAction(
                evidence_id=top_overlap.evidence_id,
                priority=len(actions) + 1,
                headline=f"Check {top_overlap.stem_a} vs {top_overlap.stem_b} ({top_overlap.range_hz} Hz)",
                coaching_note=top_overlap.note,
                daw_experiment=f"Solo {top_overlap.stem_a} and {top_overlap.stem_b} together and toggle a narrow 2 dB EQ dip on the secondary element.",
                verification_step="Re-upload updated stems to confirm overlap score decreases.",
            )
        )

    summary_prefix = f"[{fallback_reason}] " if fallback_reason else ""
    summary = (
        f"{summary_prefix}Measured {m.integrated_lufs:.1f} LUFS integrated, {m.true_peak_dbtp:+.2f} dBTP True Peak, "
        f"LRA {m.loudness_range_lu:.1f} LU, and {m.phase_correlation_avg:+.2f} average phase correlation across "
        f"'{report.audio_metadata.filename}'. Prioritize fixing any Alert items first, auditioning in the Device Lab before exporting v2."
    )
    if request.question.strip():
        summary += f" Focused on your question: '{request.question.strip()}'."

    cited = [a.evidence_id for a in actions]
    return MentorResponse(
        mode="deterministic_fallback",
        model_used="deterministic-dsp-mentor-v1",
        fallback=True,
        source="offline_deterministic",
        fallback_reason=fallback_reason,
        summary=summary,
        vision_alignment_note=_vision_note(report),
        prioritized_actions=actions,
        cited_evidence_ids=cited,
        privacy_audit=PrivacyAudit(
            raw_audio_sent_to_ai=False,
            external_ai_enabled=False,
            training_opt_in=bool(request.allow_training_opt_in),
            retention_policy="100% local deterministic coaching; zero audio or telemetry left this server.",
        ),
    )


def _sanitized_metrics_payload(report: AnalysisReport) -> dict:
    """Strip local paths/proxies and emit strictly structured DSP numbers and findings."""
    payload = report.model_dump(mode="json")
    payload.get("audio_metadata", {}).pop("playback_proxy_url", None)
    payload.get("audio_metadata", {}).pop("waveform_peaks", None)
    if not report.context.has_user_stems:
        payload["stem_analysis"] = None
    return payload


def _build_prompts(report: AnalysisReport, request: MentorRequest) -> tuple[str, str]:
    sanitized_json = json.dumps(_sanitized_metrics_payload(report), indent=2)
    system_rules = (
        "You are Mixit AI Suggestions, a concise, practical mixing and DAW assistant.\n"
        "CRITICAL RULES:\n"
        "1. Only cite evidence_id values that exist verbatim in the provided DSP report.\n"
        "2. Keep every field short, direct, and actionable — zero fluff, zero essay paragraphs (summary <= 2 sentences; each coaching_note, daw_experiment, and verification_step <= 1 crisp sentence).\n"
        "3. Reference exact parameter moves (Hz, Q, dB, ratio, ms, ceiling dBTP) and map fixes directly to Mixit Web DAW modules when relevant (Proportional-Q EQ, VCA/FET/Opto/Multiband Compressor, Tape Deck, Master Limiter, Stereo Imager, De-Esser, Saturation) or the user's stated DAW.\n"
        "4. Never invent instrument names (kick, vocals, bass, snare) unless `context.has_user_stems` is true and those stems appear in `stem_analysis.stems`.\n"
        "5. Treat `context.user_reported_context` strictly as unverified user context and never fabricate unmeasured DSP figures or out-of-range timestamps.\n"
        "6. Respect `context.artist_vision` creatively while NEVER suppressing Alert-level clipping (> -0.1 dBTP) or negative phase correlation.\n"
    )
    history_block = ""
    if request.conversation_history:
        recent_turns = request.conversation_history[-8:]
        formatted = "\n".join(
            f"{'Artist' if turn.role == 'user' else 'Mentor'}: {turn.content.strip()}"
            for turn in recent_turns
            if turn.content.strip()
        )
        if formatted:
            history_block = f"Previous Coaching Thread:\n{formatted}\n\n"

    user_prompt = (
        f"{history_block}"
        f"Artist Question: {request.question.strip() or 'Give me the highest-leverage next steps to improve this mix.'}\n\n"
        f"Structured DSP Report JSON:\n{sanitized_json}"
    )
    return system_rules, user_prompt


def _extract_audio_bytes_and_cleanup(
    report: AnalysisReport,
    clip_source: Path,
) -> tuple[bytes, str, float]:
    """Extract a 25s clip, load bytes into memory, and immediately unlink all temp files."""
    tmp_paths: list[Path] = []
    try:
        clip_start_sec = select_audio_clip_start_sec(report, clip_duration_sec=25.0)
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tf:
            placeholder_clip = Path(tf.name)
        tmp_paths.append(placeholder_clip)
        actual_clip = extract_audio_clip(clip_source, placeholder_clip, start_sec=clip_start_sec, duration_sec=25.0)
        if actual_clip != placeholder_clip:
            tmp_paths.append(actual_clip)
        audio_bytes = actual_clip.read_bytes()
        mime = "audio/mp3" if actual_clip.suffix.lower() == ".mp3" else "audio/aac"
        return audio_bytes, mime, clip_start_sec
    finally:
        for path in tmp_paths:
            path.unlink(missing_ok=True)


def _is_transient_gemini_error(exc: Exception) -> bool:
    """Return True when an upstream GenAI error is a transient 429/503 capacity/availability spike."""
    code = getattr(exc, "code", None)
    if code is None:
        code = getattr(exc, "status_code", None)
    if code in (429, 503):
        return True
    msg = f"{type(exc).__name__}: {exc}".lower()
    return any(
        token in msg
        for token in (
            "503",
            "429",
            "unavailable",
            "resource_exhausted",
            "rate limit",
            "too many requests",
            "service unavailable",
            "overloaded",
            "high demand",
        )
    )


def _invoke_gemini_sync(
    report: AnalysisReport,
    request: MentorRequest,
    clip_source: Path | None,
    use_audio: bool,
    timeout_sec: float = GEMINI_REQUEST_TIMEOUT_SEC,
) -> MentorResponse:
    """Synchronous Google GenAI SDK invocation executed off the event loop via asyncio.to_thread."""
    from google import genai
    from google.genai import types

    deadline = time.monotonic() + max(timeout_sec, 0.05)
    valid_ids = _valid_evidence_ids(report)
    system_rules, user_prompt = _build_prompts(report, request)

    per_attempt_timeout_sec = min(GEMINI_PER_ATTEMPT_TIMEOUT_SEC, max(timeout_sec, 0.05))
    per_attempt_timeout_ms = max(50, int(per_attempt_timeout_sec * 1000))
    http_options = types.HttpOptions(timeout=per_attempt_timeout_ms)
    client = genai.Client(api_key=settings.gemini_api_key.strip(), http_options=http_options)

    contents: object = user_prompt
    if use_audio and clip_source is not None:
        audio_bytes, mime, clip_start_sec = _extract_audio_bytes_and_cleanup(report, clip_source)
        contents = [
            f"{user_prompt}\n\nAttached is an explicitly consented 25-second snippet starting at {clip_start_sec:.1f}s.",
            types.Part.from_bytes(data=audio_bytes, mime_type=mime),
        ]

    # Prefer thinking_level="minimal" for lowest structured JSON latency; safely retry once
    # with thinking_level="low" if the installed SDK or gemini-4-hydrogen endpoint rejects "minimal".
    def _build_config(level: str | None) -> types.GenerateContentConfig:
        cfg_kwargs: dict[str, object] = {
            "system_instruction": system_rules,
            "response_mime_type": "application/json",
            "response_schema": MentorLLMOutput,
            "http_options": http_options,
        }
        if level is not None:
            cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=level)
        return types.GenerateContentConfig(**cfg_kwargs)

    def _is_unsupported_thinking_level_error(exc: Exception) -> bool:
        msg = f"{type(exc).__name__}: {exc}".lower()
        return any(
            token in msg
            for token in (
                "thinking_level",
                "thinkinglevel",
                "thinking level",
                "minimal",
                "invalid_argument",
                "unsupported",
                "enum",
                "400",
            )
        )

    def _generate_with_thinking_fallback() -> object:
        try:
            config = _build_config("minimal")
            try:
                return client.models.generate_content(
                    model=settings.gemini_model,
                    contents=contents,
                    config=config,
                )
            except Exception as minimal_exc:
                if not _is_unsupported_thinking_level_error(minimal_exc):
                    raise
                logger.info(
                    "AI Mix Mentor thinking_level='minimal' rejected (%s: %s); retrying once with thinking_level='low'.",
                    type(minimal_exc).__name__,
                    minimal_exc,
                )
                try:
                    low_config = _build_config("low")
                except Exception:
                    low_config = _build_config(None)
                return client.models.generate_content(
                    model=settings.gemini_model,
                    contents=contents,
                    config=low_config,
                )
        except (TypeError, ValueError) as cfg_exc:
            logger.info(
                "AI Mix Mentor SDK rejected thinking_level='minimal' (%s: %s); falling back to thinking_level='low'.",
                type(cfg_exc).__name__,
                cfg_exc,
            )
            try:
                low_config = _build_config("low")
            except Exception:
                low_config = _build_config(None)
            return client.models.generate_content(
                model=settings.gemini_model,
                contents=contents,
                config=low_config,
            )

    response: object | None = None
    max_attempts = len(GEMINI_TRANSIENT_RETRY_DELAYS_SEC) + 1
    for attempt in range(max_attempts):
        remaining = deadline - time.monotonic()
        if remaining <= 0.01:
            raise TimeoutError("AI Mix Mentor total request budget exceeded")
        attempt_timeout = min(per_attempt_timeout_sec, remaining)
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            future = pool.submit(_generate_with_thinking_fallback)
            response = future.result(timeout=attempt_timeout)
            break
        except (FuturesTimeoutError, TimeoutError) as timeout_exc:
            # Never retry on timeouts — immediately fall back to Offline Deterministic Mentor.
            raise TimeoutError(
                f"Gemini SDK attempt timed out after {attempt_timeout:.1f}s"
            ) from timeout_exc
        except Exception as exc:
            if attempt >= len(GEMINI_TRANSIENT_RETRY_DELAYS_SEC) or not _is_transient_gemini_error(exc):
                raise
            delay = GEMINI_TRANSIENT_RETRY_DELAYS_SEC[attempt]
            remaining_after_err = deadline - time.monotonic()
            # Keep at least 0.5s after sleep inside the 30s request budget.
            if remaining_after_err <= delay + 0.5:
                raise
            logger.warning(
                "AI Mix Mentor transient %s (attempt %d/%d); retrying in %.1fs.",
                type(exc).__name__,
                attempt + 1,
                max_attempts,
                delay,
            )
            time.sleep(delay)
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    assert response is not None

    raw_output = (getattr(response, "text", None) or "").strip() or "{}"
    parsed = MentorLLMOutput.model_validate_json(raw_output)

    # Verify every evidence_id exists in the deterministic DSP report
    verified_actions: list[MentorAction] = []
    for idx, action in enumerate(parsed.prioritized_actions, start=1):
        if action.evidence_id in valid_ids:
            action.priority = idx
            verified_actions.append(action)

    if not verified_actions:
        return build_deterministic_mentor_response(
            report,
            request,
            fallback_reason="Evidence guardrail switched to deterministic output",
        )

    mode = "gemini_multimodal_audio" if use_audio else "gemini_metrics_only"
    retention_note = (
        "Sent metrics JSON + 25s audio snippet via stateless generate_content. Training opt-in flag tracked independently."
        if use_audio
        else "Sent structured numerical DSP JSON only (zero audio bytes transmitted) via stateless generate_content."
    )
    return MentorResponse(
        mode=mode,
        model_used=settings.gemini_model,
        fallback=False,
        source="gemini_live",
        fallback_reason=None,
        summary=parsed.summary,
        vision_alignment_note=parsed.vision_alignment_note,
        prioritized_actions=verified_actions,
        cited_evidence_ids=[a.evidence_id for a in verified_actions],
        privacy_audit=PrivacyAudit(
            raw_audio_sent_to_ai=use_audio,
            external_ai_enabled=True,
            training_opt_in=bool(request.allow_training_opt_in),
            retention_policy=retention_note,
        ),
    )


def _resolve_clip_source(
    primary_audio_path: Path | None,
    fallback_proxy_path: Path | None,
) -> Path | None:
    if primary_audio_path is not None and primary_audio_path.exists():
        return primary_audio_path
    if fallback_proxy_path is not None and fallback_proxy_path.exists():
        return fallback_proxy_path
    return None


def _format_fallback_note(exc: Exception) -> str:
    """Format a concise, user-safe diagnostic note for ClientError, ServerError, TimeoutError, or generic exceptions."""
    exc_name = type(exc).__name__
    status_code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return f"Offline Mentor fallback (Timeout after {int(round(GEMINI_REQUEST_TIMEOUT_SEC))}s)"
    if exc_name in {"ClientError", "ServerError", "APIError"}:
        code_suffix = f" {status_code}" if status_code is not None else ""
        return f"Offline Mentor fallback ({exc_name}{code_suffix})"
    try:
        from google.genai import errors as genai_errors

        if isinstance(exc, (genai_errors.ClientError, genai_errors.ServerError, genai_errors.APIError)):
            code_suffix = f" {status_code}" if status_code is not None else ""
            return f"Offline Mentor fallback ({exc_name}{code_suffix})"
    except Exception:
        pass
    return f"Offline Mentor fallback ({exc_name})"


def generate_mentor_advice(
    report: AnalysisReport,
    request: MentorRequest,
    primary_audio_path: Path | None = None,
    fallback_proxy_path: Path | None = None,
) -> MentorResponse:
    """Synchronous mentor entry point preserving backward compatibility for direct unit calls."""
    if not request.allow_metrics_ai:
        return build_deterministic_mentor_response(report, request)

    if not settings.gemini_api_key.strip():
        return build_deterministic_mentor_response(
            report,
            request,
            fallback_reason="Offline Mentor active (GEMINI_API_KEY not configured)",
        )

    clip_source = _resolve_clip_source(primary_audio_path, fallback_proxy_path)
    use_audio = bool(request.allow_audio_ai and clip_source is not None)

    try:
        return _invoke_gemini_sync(report, request, clip_source, use_audio)
    except Exception as exc:
        note = _format_fallback_note(exc)
        logger.warning("AI Mix Mentor fallback (%s): %s", type(exc).__name__, exc)
        return build_deterministic_mentor_response(
            report,
            request,
            fallback_reason=note,
        )


async def generate_mentor_advice_async(
    report: AnalysisReport,
    request: MentorRequest,
    primary_audio_path: Path | None = None,
    fallback_proxy_path: Path | None = None,
    timeout_sec: float = GEMINI_REQUEST_TIMEOUT_SEC,
) -> MentorResponse:
    """
    Async FastAPI mentor entry point:
    - Enforces three-tier consent before any network call.
    - Offloads synchronous Google GenAI SDK work via asyncio.to_thread so the event loop never blocks.
    - Enforces a strict 35.0s timeout with asyncio.wait_for and returns deterministic fallback immediately on
      TimeoutError, ClientError, ServerError, or any other Exception.
    """
    if not request.allow_metrics_ai:
        return build_deterministic_mentor_response(report, request)

    if not settings.gemini_api_key.strip():
        return build_deterministic_mentor_response(
            report,
            request,
            fallback_reason="Offline Mentor active (GEMINI_API_KEY not configured)",
        )

    clip_source = _resolve_clip_source(primary_audio_path, fallback_proxy_path)
    use_audio = bool(request.allow_audio_ai and clip_source is not None)

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_invoke_gemini_sync, report, request, clip_source, use_audio, timeout_sec),
            timeout=timeout_sec,
        )
    except (asyncio.TimeoutError, TimeoutError):
        logger.warning(
            "AI Mix Mentor timed out after %.1fs (model=%s, use_audio=%s); returning deterministic Offline Mentor fallback.",
            timeout_sec,
            settings.gemini_model,
            use_audio,
        )
        return build_deterministic_mentor_response(
            report,
            request,
            fallback_reason=f"Offline Mentor fallback (Timeout after {int(round(timeout_sec))}s)",
        )
    except Exception as exc:
        note = _format_fallback_note(exc)
        logger.warning("AI Mix Mentor fallback (%s): %s", type(exc).__name__, exc)
        return build_deterministic_mentor_response(
            report,
            request,
            fallback_reason=note,
        )

from __future__ import annotations

import base64
import json
import tempfile
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


def _extract_interaction_text(interaction: object) -> str:
    text = getattr(interaction, "output_text", None)
    if isinstance(text, str) and text.strip():
        return text
    steps = getattr(interaction, "steps", None) or []
    parts: list[str] = []
    for step in steps:
        if getattr(step, "type", None) == "model_output":
            for block in getattr(step, "content", None) or []:
                block_text = getattr(block, "text", None)
                if isinstance(block_text, str):
                    parts.append(block_text)
    return "".join(parts).strip() or "{}"


def generate_mentor_advice(
    report: AnalysisReport,
    request: MentorRequest,
    primary_audio_path: Path | None = None,
    fallback_proxy_path: Path | None = None,
) -> MentorResponse:
    """Enforce three-tier consent and evidence-id grounding before calling Gemini Interactions API."""
    # Toggle A must be explicitly enabled before any external Gemini call occurs
    if not request.allow_metrics_ai:
        return build_deterministic_mentor_response(report, request)

    if not settings.gemini_api_key.strip():
        return build_deterministic_mentor_response(
            report,
            request,
            fallback_reason="Offline Mentor active (GEMINI_API_KEY not configured)",
        )

    valid_ids = _valid_evidence_ids(report)
    sanitized_json = json.dumps(_sanitized_metrics_payload(report), indent=2)

    system_rules = (
        "You are MixBench Mentor, a privacy-first mix and mastering teacher.\n"
        "CRITICAL RULES:\n"
        "1. Only cite evidence_id values that exist verbatim in the provided DSP report.\n"
        "2. Never invent instrument names (kick, vocals, bass, snare) unless `context.has_user_stems` is true and those stems appear in `stem_analysis.stems`.\n"
        "3. Treat `context.user_reported_context` (DAW/routing/plugin notes) strictly as unverified user context — never measured audio proof — and never fabricate plugin knob values.\n"
        "4. Never invent timestamps outside the track duration or fabricate unmeasured DSP figures.\n"
        "5. Respect `context.artist_vision` creatively while NEVER suppressing Alert-level clipping (> -0.1 dBTP) or negative phase correlation.\n"
        "6. Follow the learn-by-doing loop: What happened -> Why it matters -> Listen -> Experiment in DAW -> Recheck.\n"
    )
    user_prompt = (
        f"Artist Question: {request.question.strip() or 'Give me the highest-leverage next steps to improve this mix.'}\n\n"
        f"Structured DSP Report JSON:\n{sanitized_json}"
    )

    clip_source = (
        primary_audio_path
        if primary_audio_path is not None and primary_audio_path.exists()
        else (fallback_proxy_path if fallback_proxy_path is not None and fallback_proxy_path.exists() else None)
    )
    use_audio = bool(request.allow_audio_ai and clip_source is not None)
    input_content: list[dict] | str = user_prompt
    tmp_clip: Path | None = None

    try:
        from google import genai

        client = genai.Client(api_key=settings.gemini_api_key.strip())

        if use_audio and clip_source is not None:
            top_ts = report.findings[0].timestamp_start_sec if report.findings else 0.0
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tf:
                tmp_clip = Path(tf.name)
            actual_clip = extract_audio_clip(clip_source, tmp_clip, start_sec=top_ts, duration_sec=25.0)
            tmp_clip = actual_clip
            audio_bytes = actual_clip.read_bytes()
            mime = "audio/mp3" if actual_clip.suffix.lower() == ".mp3" else "audio/aac"
            input_content = [
                {
                    "type": "text",
                    "text": user_prompt + "\n\nAttached is an explicitly consented 25-second snippet around the top finding.",
                },
                {
                    "type": "audio",
                    "data": base64.b64encode(audio_bytes).decode("utf-8"),
                    "mime_type": mime,
                },
            ]

        interaction = client.interactions.create(
            model=settings.gemini_model,
            system_instruction=system_rules,
            input=input_content,
            response_format=[
                {
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": MentorLLMOutput.model_json_schema(),
                }
            ],
            store=False,
        )
        raw_output = _extract_interaction_text(interaction)
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
            "Sent metrics JSON + 25s audio snippet with store=False. No-training is independent from ephemeral API processing."
            if use_audio
            else "Sent structured numerical DSP JSON only (zero audio bytes transmitted) with store=False. No-training is independent from ephemeral API processing."
        )
        return MentorResponse(
            mode=mode,
            model_used=settings.gemini_model,
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
    except Exception as exc:
        return build_deterministic_mentor_response(
            report,
            request,
            fallback_reason=f"Offline Mentor fallback ({type(exc).__name__})",
        )
    finally:
        if tmp_clip is not None:
            tmp_clip.unlink(missing_ok=True)

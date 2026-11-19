import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import type {
  AnalysisReport,
  MentorAction,
  MentorRequest,
  MentorResponse,
} from "@/types/report";
import { serverConfig } from "../config";
import { extractAudioClip } from "../dsp/ingest";

const GEMINI_TIMEOUT_MS = 35_000;

interface MentorLLMOutput {
  summary: string;
  vision_alignment_note: string;
  prioritized_actions: MentorAction[];
}

function validEvidenceIds(report: AnalysisReport): Set<string> {
  const ids = new Set(report.findings.map((f) => f.evidence_id));
  if (report.stem_analysis) {
    for (const pair of report.stem_analysis.overlap_matrix) {
      ids.add(pair.evidence_id);
    }
  }
  return ids;
}

function buildVisionNote(report: AnalysisReport): string {
  const vision = report.context.artist_vision;
  if (!vision || vision.length === 0) {
    return `No creative profile tags selected; guidance targets clean ${report.context.genre} (${report.context.stage.replace(/_/g, " ")}) translation without altering your artistic balance.`;
  }
  const tags = vision.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(", ");
  const parts = [`Selected Artist Vision (${tags}) informs trade-offs without hiding physical limits.`];
  if (vision.includes("aggressive")) {
    parts.push("Intentional harmonic density is respected, though inter-sample clipping (> -0.1 dBTP) is never suppressed.");
  }
  if (vision.includes("warm")) {
    parts.push("Gentle high-frequency roll-off can fit a Warm character as long as midrange clarity translates on Laptop/Phone.");
  }
  if (vision.includes("wide")) {
    parts.push("Stereo width is encouraged above ~200 Hz while keeping sub-bass centered for mono translation.");
  }
  if (vision.includes("punchy") || vision.includes("dynamic")) {
    parts.push("Preserving PSR (>= 7 dB) and transient crest keeps kick/snare snap alive under streaming normalization.");
  }
  return parts.join(" ");
}

export function selectAudioClipStartSec(report: AnalysisReport, clipDurationSec = 25.0): number {
  const duration = Math.max(0.0, report.audio_metadata.duration_sec);
  const maxStart = Math.max(0.0, duration - clipDurationSec);
  const rank: Record<string, number> = { alert: 0, caution: 1, safe: 2 };
  const ordered = [...report.findings].sort(
    (a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)
  );
  for (const f of ordered) {
    if (f.timestamp_start_sec > 0.0) {
      return Math.round(Math.min(maxStart, Math.max(0.0, f.timestamp_start_sec)) * 100) / 100;
    }
  }

  const series = report.time_series.short_term_lufs;
  if (series.length > 0) {
    const step = Math.max(0.1, report.time_series.step_sec || 1.0);
    let peakIdx = 0;
    for (let i = 1; i < series.length; i++) {
      if (series[i] > series[peakIdx]) peakIdx = i;
    }
    const peakSec = peakIdx * step;
    if (peakSec > 0.0) {
      const start = Math.max(0.0, peakSec - Math.min(5.0, clipDurationSec * 0.2));
      return Math.round(Math.min(maxStart, start) * 100) / 100;
    }
  }

  return 0.0;
}

export function buildDeterministicMentorResponse(
  report: AnalysisReport,
  request: MentorRequest,
  fallbackReason: string | null = null
): MentorResponse {
  const m = report.global_metrics;
  const topFindings = report.findings.slice(0, 3);

  const actions: MentorAction[] = topFindings.map((finding, idx) => ({
    evidence_id: finding.evidence_id,
    priority: idx + 1,
    headline: finding.title,
    coaching_note: `${finding.what_happened} ${finding.why_it_matters}`,
    daw_experiment: `${finding.listen_prompt} Then test: ${finding.what_to_try}`,
    verification_step: finding.recheck_target,
  }));

  if (
    report.stem_analysis &&
    report.stem_analysis.overlap_matrix.length > 0 &&
    actions.length < 4
  ) {
    const topOverlap = report.stem_analysis.overlap_matrix[0];
    actions.push({
      evidence_id: topOverlap.evidence_id,
      priority: actions.length + 1,
      headline: `Check ${topOverlap.stem_a} vs ${topOverlap.stem_b} (${topOverlap.range_hz} Hz)`,
      coaching_note: topOverlap.note,
      daw_experiment: `Solo ${topOverlap.stem_a} and ${topOverlap.stem_b} together and toggle a narrow 2 dB EQ dip on the secondary element.`,
      verification_step: "Re-upload updated stems to confirm overlap score decreases.",
    });
  }

  const prefix = fallbackReason ? `[${fallbackReason}] ` : "";
  const fmtSigned = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
  let summary =
    `${prefix}Measured ${m.integrated_lufs.toFixed(1)} LUFS integrated, ${fmtSigned(m.true_peak_dbtp)} dBTP True Peak, ` +
    `LRA ${m.loudness_range_lu.toFixed(1)} LU, and ${fmtSigned(m.phase_correlation_avg)} average phase correlation across ` +
    `'${report.audio_metadata.filename}'. Prioritize fixing any Alert items first, auditioning in the Device Lab before exporting v2.`;
  if (request.question.trim()) {
    summary += ` Focused on your question: '${request.question.trim()}'.`;
  }

  return {
    mode: "deterministic_fallback",
    model_used: "deterministic-dsp-mentor-v1",
    fallback_reason: fallbackReason,
    summary,
    vision_alignment_note: buildVisionNote(report),
    prioritized_actions: actions,
    cited_evidence_ids: actions.map((a) => a.evidence_id),
    privacy_audit: {
      raw_audio_sent_to_ai: false,
      external_ai_enabled: false,
      training_opt_in: Boolean(request.allow_training_opt_in),
      retention_policy: "100% local deterministic coaching; zero audio or telemetry left this server.",
    },
  };
}

function sanitizedMetricsPayload(report: AnalysisReport): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  const meta = clone.audio_metadata as Record<string, unknown> | undefined;
  if (meta) {
    delete meta.playback_proxy_url;
    delete meta.waveform_peaks;
  }
  if (!report.context.has_user_stems) {
    clone.stem_analysis = null;
  }
  return clone;
}

export async function generateMentorAdvice(
  report: AnalysisReport,
  request: MentorRequest,
  primaryAudioPath: string | null = null,
  fallbackProxyPath: string | null = null
): Promise<MentorResponse> {
  if (!request.allow_metrics_ai) {
    return buildDeterministicMentorResponse(report, request);
  }

  const apiKey = serverConfig.geminiApiKey;
  if (!apiKey) {
    return buildDeterministicMentorResponse(
      report,
      request,
      "Offline Mentor active (GEMINI_API_KEY not configured)"
    );
  }

  const validIds = validEvidenceIds(report);
  const sanitizedJson = JSON.stringify(sanitizedMetricsPayload(report), null, 2);

  const systemRules =
    "You are MixBench Mentor, a privacy-first mix and mastering teacher.\n" +
    "CRITICAL RULES:\n" +
    "1. Only cite evidence_id values that exist verbatim in the provided DSP report.\n" +
    "2. Never invent instrument names (kick, vocals, bass, snare) unless `context.has_user_stems` is true and those stems appear in `stem_analysis.stems`.\n" +
    "3. Treat `context.user_reported_context` (DAW/routing/plugin notes) strictly as unverified user context — never measured audio proof — and never fabricate plugin knob values.\n" +
    "4. Never invent timestamps outside the track duration or fabricate unmeasured DSP figures.\n" +
    "5. Respect `context.artist_vision` creatively while NEVER suppressing Alert-level clipping (> -0.1 dBTP) or negative phase correlation.\n" +
    "6. Follow the learn-by-doing loop: What happened -> Why it matters -> Listen -> Experiment in DAW -> Recheck.\n";

  let historyBlock = "";
  if (request.conversation_history && request.conversation_history.length > 0) {
    const formatted = request.conversation_history
      .slice(-8)
      .filter((t) => t.content.trim().length > 0)
      .map((t) => `${t.role === "user" ? "Artist" : "Mentor"}: ${t.content.trim()}`)
      .join("\n");
    if (formatted) {
      historyBlock = `Previous Coaching Thread:\n${formatted}\n\n`;
    }
  }

  const userPrompt =
    `${historyBlock}` +
    `Artist Question: ${request.question.trim() || "Give me the highest-leverage next steps to improve this mix."}\n\n` +
    `Structured DSP Report JSON:\n${sanitizedJson}`;

  const clipSource =
    primaryAudioPath && fs.existsSync(primaryAudioPath)
      ? primaryAudioPath
      : fallbackProxyPath && fs.existsSync(fallbackProxyPath)
        ? fallbackProxyPath
        : null;
  const useAudio = Boolean(request.allow_audio_ai && clipSource !== null);
  const tmpPaths: string[] = [];

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: GEMINI_TIMEOUT_MS,
        headers: { "User-Agent": "aistudio-build" },
      },
    });

    let contents: string | Array<string | { inlineData: { data: string; mimeType: string } }> =
      userPrompt;

    if (useAudio && clipSource) {
      const clipStartSec = selectAudioClipStartSec(report, 25.0);
      const rawClipTarget = path.join(os.tmpdir(), `mixbench_clip_${crypto.randomUUID()}.mp3`);
      tmpPaths.push(rawClipTarget);
      const actualClipPath = await extractAudioClip(clipSource, rawClipTarget, clipStartSec, 25.0);
      if (actualClipPath !== rawClipTarget) {
        tmpPaths.push(actualClipPath);
      }
      const audioBytes = await fsp.readFile(actualClipPath);
      const mimeType = actualClipPath.toLowerCase().endsWith(".mp3") ? "audio/mp3" : "audio/aac";
      // Remove temporary clip files immediately once read into memory
      for (const p of tmpPaths.splice(0, tmpPaths.length)) {
        await fsp.rm(p, { force: true }).catch(() => undefined);
      }
      contents = [
        `${userPrompt}\n\nAttached is an explicitly consented 25-second snippet starting at ${clipStartSec.toFixed(1)}s.`,
        {
          inlineData: {
            data: audioBytes.toString("base64"),
            mimeType,
          },
        },
      ];
    }

    const controller = new AbortController();
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        controller.abort();
        const err = new Error(`AI Mix Mentor timed out after ${GEMINI_TIMEOUT_MS / 1000}s`);
        err.name = "TimeoutError";
        reject(err);
      }, GEMINI_TIMEOUT_MS);
    });

    let response;
    try {
      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          vision_alignment_note: { type: Type.STRING },
          prioritized_actions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                evidence_id: { type: Type.STRING },
                priority: { type: Type.INTEGER },
                headline: { type: Type.STRING },
                coaching_note: { type: Type.STRING },
                daw_experiment: { type: Type.STRING },
                verification_step: { type: Type.STRING },
              },
              required: [
                "evidence_id",
                "priority",
                "headline",
                "coaching_note",
                "daw_experiment",
                "verification_step",
              ],
            },
          },
        },
        required: ["summary", "vision_alignment_note", "prioritized_actions"],
      };

      const callGenerate = (level: ThinkingLevel) =>
        ai.models.generateContent({
          model: serverConfig.geminiModel,
          contents,
          config: {
            systemInstruction: systemRules,
            responseMimeType: "application/json",
            thinkingConfig: {
              thinkingLevel: level,
            },
            abortSignal: controller.signal,
            responseSchema,
          },
        });

      const isUnsupportedMinimalError = (err: unknown): boolean => {
        const msg = `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.toLowerCase();
        return (
          msg.includes("thinking") ||
          msg.includes("minimal") ||
          msg.includes("invalid_argument") ||
          msg.includes("unsupported") ||
          msg.includes("400")
        );
      };

      const generateWithFallback = async () => {
        const minimalLevel = (ThinkingLevel as Record<string, ThinkingLevel>).MINIMAL;
        if (!minimalLevel) {
          return callGenerate(ThinkingLevel.LOW);
        }
        try {
          return await callGenerate(minimalLevel);
        } catch (minimalErr) {
          if (controller.signal.aborted || !isUnsupportedMinimalError(minimalErr)) {
            throw minimalErr;
          }
          console.info(
            "[MixBench Mentor] thinkingLevel='minimal' rejected; retrying once with thinkingLevel='low'."
          );
          return callGenerate(ThinkingLevel.LOW);
        }
      };

      response = await Promise.race([generateWithFallback(), timeoutPromise]);
    } finally {
      if (timerId !== null) clearTimeout(timerId);
    }

    const rawText = (response.text ?? "").trim() || "{}";
    const parsed = JSON.parse(rawText) as MentorLLMOutput;
    const verifiedActions: MentorAction[] = [];
    for (const action of parsed.prioritized_actions ?? []) {
      if (action && validIds.has(action.evidence_id)) {
        verifiedActions.push({
          evidence_id: action.evidence_id,
          priority: verifiedActions.length + 1,
          headline: String(action.headline ?? ""),
          coaching_note: String(action.coaching_note ?? ""),
          daw_experiment: String(action.daw_experiment ?? ""),
          verification_step: String(action.verification_step ?? ""),
        });
      }
    }

    if (verifiedActions.length === 0) {
      return buildDeterministicMentorResponse(
        report,
        request,
        "Evidence guardrail switched to deterministic output"
      );
    }

    const mode = useAudio ? "gemini_multimodal_audio" : "gemini_metrics_only";
    const retentionNote = useAudio
      ? "Sent metrics JSON + 25s audio snippet via stateless generateContent. Training opt-in flag tracked independently."
      : "Sent structured numerical DSP JSON only (zero audio bytes transmitted) via stateless generateContent.";

    return {
      mode,
      model_used: serverConfig.geminiModel,
      fallback_reason: null,
      summary: String(parsed.summary ?? ""),
      vision_alignment_note: String(parsed.vision_alignment_note ?? buildVisionNote(report)),
      prioritized_actions: verifiedActions,
      cited_evidence_ids: verifiedActions.map((a) => a.evidence_id),
      privacy_audit: {
        raw_audio_sent_to_ai: useAudio,
        external_ai_enabled: true,
        training_opt_in: Boolean(request.allow_training_opt_in),
        retention_policy: retentionNote,
      },
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const errName = isTimeout
      ? `Timeout after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s`
      : err instanceof Error
        ? err.name || "Error"
        : "Error";
    console.warn(
      `AI Mix Mentor fallback (${errName}): ${err instanceof Error ? err.message : String(err)}`
    );
    return buildDeterministicMentorResponse(
      report,
      request,
      `Offline Mentor fallback (${errName})`
    );
  } finally {
    for (const p of tmpPaths) {
      await fsp.rm(p, { force: true }).catch(() => undefined);
    }
  }
}

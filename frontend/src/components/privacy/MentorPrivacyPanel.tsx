"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, MessageSquare, RotateCcw, ShieldCheck, Sliders, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_PRIVACY_PREFERENCES,
  type PrivacyPreferences,
} from "@/lib/supabase/storage";
import type { AnalysisReport, MentorChatTurn, MentorRequest, MentorResponse } from "@/types/report";

const QUICK_DAW_PROMPTS = [
  "How do I apply these fixes with FL Studio stock plugins?",
  "Give me an Ableton Live 12 EQ Eight & Glue Compressor chain.",
  "How should I clean this up using Logic Pro Channel EQ & Multipressor?",
  "How do I tighten the <120 Hz sub phase without losing punch?",
];

interface MentorPrivacyPanelProps {
  report: AnalysisReport;
  mentorAdvice: MentorResponse | null;
  isAskingMentor: boolean;
  mentorError?: string | null;
  onDismissMentorError?: () => void;
  onAskMentor: (req: MentorRequest) => void;
  onSaveDawContext: (ctx: { daw: string; bus_routing: string; plugin_notes: string }) => void;
  onJumpToEvidence: (evidenceId: string) => void;
  privacyPrefs?: PrivacyPreferences;
  onPrivacyPrefsChange?: (prefs: PrivacyPreferences) => void;
  privacySaveState?: "idle" | "saving" | "saved" | "error";
  isSignedIn?: boolean;
}

export function MentorPrivacyPanel({
  report,
  mentorAdvice,
  isAskingMentor,
  mentorError = null,
  onDismissMentorError,
  onAskMentor,
  onSaveDawContext,
  onJumpToEvidence,
  privacyPrefs,
  onPrivacyPrefsChange,
  privacySaveState = "idle",
  isSignedIn = false,
}: MentorPrivacyPanelProps) {
  const [localPrefs, setLocalPrefs] = useState<PrivacyPreferences>(DEFAULT_PRIVACY_PREFERENCES);
  const effectivePrefs = privacyPrefs ?? localPrefs;
  const allowMetricsAi = effectivePrefs.allowMetricsAi;
  const allowAudioAi = effectivePrefs.allowMetricsAi && effectivePrefs.allowAudioAi;
  const allowTrainingOptIn = effectivePrefs.allowTrainingOptIn;

  const updatePrefs = (next: PrivacyPreferences) => {
    const normalized: PrivacyPreferences = {
      allowMetricsAi: next.allowMetricsAi,
      allowAudioAi: next.allowMetricsAi ? next.allowAudioAi : false,
      allowTrainingOptIn: next.allowTrainingOptIn,
    };
    if (!privacyPrefs) {
      setLocalPrefs(normalized);
    }
    onPrivacyPrefsChange?.(normalized);
  };

  const [question, setQuestion] = useState("");
  const [conversationHistory, setConversationHistory] = useState<MentorChatTurn[]>([]);
  const lastAdviceRef = useRef<MentorResponse | null>(null);
  const lastRequestRef = useRef<MentorRequest | null>(null);
  const lastReportIdRef = useRef<string>(report.report_id);

  // Reset multi-turn coaching thread when switching to a different report
  useEffect(() => {
    if (lastReportIdRef.current !== report.report_id) {
      lastReportIdRef.current = report.report_id;
      setConversationHistory([]);
      lastAdviceRef.current = null;
      lastRequestRef.current = null;
    }
  }, [report.report_id]);

  // Append newly received mentor response into conversation history
  useEffect(() => {
    if (mentorAdvice && mentorAdvice !== lastAdviceRef.current) {
      lastAdviceRef.current = mentorAdvice;
      setConversationHistory((prev) => [
        ...prev.slice(-9),
        { role: "assistant", content: mentorAdvice.summary },
      ]);
    }
  }, [mentorAdvice]);

  const [daw, setDaw] = useState(report.context.user_reported_context?.daw || "");
  const [busRouting, setBusRouting] = useState(
    report.context.user_reported_context?.bus_routing || ""
  );
  const [pluginNotes, setPluginNotes] = useState(
    report.context.user_reported_context?.plugin_notes || ""
  );
  const [contextSaved, setContextSaved] = useState(false);

  const handleToggleMetrics = (next: boolean) => {
    updatePrefs({
      allowMetricsAi: next,
      allowAudioAi: next ? allowAudioAi : false,
      allowTrainingOptIn,
    });
  };

  const submitQuestion = (
    overrideQuestion?: string,
    overrideConsent?: { allowMetricsAi: boolean; allowAudioAi: boolean }
  ) => {
    const activeQuestion = (overrideQuestion ?? question).trim();
    const nextHistory = activeQuestion
      ? [...conversationHistory.slice(-9), { role: "user" as const, content: activeQuestion }]
      : conversationHistory;

    if (activeQuestion) {
      setConversationHistory(nextHistory);
      setQuestion("");
    }

    const reqPayload: MentorRequest = {
      allow_metrics_ai: overrideConsent ? overrideConsent.allowMetricsAi : allowMetricsAi,
      allow_audio_ai: overrideConsent ? overrideConsent.allowAudioAi : allowAudioAi,
      allow_training_opt_in: allowTrainingOptIn,
      question: activeQuestion,
      conversation_history: conversationHistory.slice(-8),
    };
    lastRequestRef.current = reqPayload;
    onDismissMentorError?.();
    onAskMentor(reqPayload);
  };

  const modeAttribution =
    mentorAdvice?.mode === "gemini_multimodal_audio"
      ? "Live Gemini 4 Audio + Metrics"
      : mentorAdvice?.mode === "gemini_metrics_only"
        ? "Live Gemini 4 Metrics Only"
        : "Offline Deterministic";

  return (
    <div className="min-w-0 space-y-4">
      {/* Three-Tier Independent Granular Privacy Controls */}
      <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold text-[#182220]">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#3A7269]" aria-hidden="true" />
            Privacy &amp; AI Data Consent Controls
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {privacySaveState === "saved" && (
              <span className="inline-flex items-center gap-1 bg-[#ECFDF3] px-2 py-0.5 text-[10px] font-semibold text-[#15803D] squircle-inner">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Saved to profile
              </span>
            )}
            {privacySaveState === "error" && (
              <span className="inline-flex items-center gap-1 bg-[#FFF1F3] px-2 py-0.5 text-[10px] font-semibold text-[#BE123C] squircle-inner">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                Sync failed
              </span>
            )}
            <span className="bg-[#ECFDF3] px-2 py-0.5 text-[10px] font-semibold text-[#15803D] squircle-inner">
              {isSignedIn ? "Synced to Profile (Default Off)" : "Default Off"}
            </span>
          </div>
        </div>

        <div className="space-y-2.5 text-xs">
          <div className="flex items-start justify-between gap-3 bg-[#F5F5F7] p-3 squircle-inner">
            <div className="min-w-0 space-y-0.5">
              <div className="font-semibold text-[#182220]">
                1. Numerical DSP Metrics &amp; Evidence IDs
              </div>
              <p className="text-[11px] leading-relaxed text-[#52605D]">
                Sends structured DSP numbers and <code className="text-[#182220]">evidence_id</code> tags only. Zero audio leaves your session.
              </p>
            </div>
            <Switch
              checked={allowMetricsAi}
              onCheckedChange={handleToggleMetrics}
              aria-label="Toggle A Metrics-Only AI Mentor"
            />
          </div>

          <div className="flex items-start justify-between gap-3 bg-[#F5F5F7] p-3 squircle-inner">
            <div className="min-w-0 space-y-0.5">
              <div className="font-semibold text-[#182220]">
                2. Direct Audio Snippet Analysis
              </div>
              <p className="text-[11px] leading-relaxed text-[#52605D]">
                Separate opt-in required before sending a compressed 25s clip around the highest-severity section to external Gemini APIs.
              </p>
            </div>
            <Switch
              checked={allowAudioAi}
              disabled={!allowMetricsAi}
              onCheckedChange={(checked) =>
                updatePrefs({
                  allowMetricsAi,
                  allowAudioAi: checked,
                  allowTrainingOptIn,
                })
              }
              aria-label="Toggle B Direct Audio Listening Opt-In"
            />
          </div>

          <div className="flex items-start justify-between gap-3 bg-[#F5F5F7] p-3 squircle-inner">
            <div className="min-w-0 space-y-0.5">
              <div className="font-semibold text-[#182220]">
                3. Model Training Permission
              </div>
              <p className="text-[11px] leading-relaxed text-[#52605D]">
                Strictly OFF by default. API calls use <code className="text-[#182220]">store=false</code>; model training never occurs unless explicitly enabled.
              </p>
            </div>
            <Switch
              checked={allowTrainingOptIn}
              onCheckedChange={(checked) =>
                updatePrefs({
                  allowMetricsAi,
                  allowAudioAi,
                  allowTrainingOptIn: checked,
                })
              }
              aria-label="Toggle C Future Model Training Opt-In"
            />
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="mentor-question" className="block text-[11px] font-medium text-[#52605D]">
              {conversationHistory.length > 0
                ? "Ask a follow-up question (grounded in DSP JSON & clip)"
                : "Ask your Mix Mentor (optional)"}
            </label>
            {conversationHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setConversationHistory([])}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-[#52605D] hover:text-[#182220] cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Reset thread
              </button>
            )}
          </div>
          <textarea
            id="mentor-question"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g., How should I address the 250 Hz low-mid buildup in FL Studio or Ableton without losing punch?"
            className="w-full resize-none bg-[#FAFAFA] px-3 py-2 text-xs text-[#182220] hairline-border squircle-inner focus:border-[#3A7269] focus:outline-none"
          />

          {/* Quick DAW Follow-Up Chips */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_DAW_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={isAskingMentor}
                onClick={() => submitQuestion(prompt)}
                className="bg-[#F5F5F7] px-2 py-1 text-left text-[10px] font-medium text-[#52605D] hover:bg-[#EBF3F1] hover:text-[#182220] hairline-border squircle-inner cursor-pointer transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            className="w-full"
            disabled={isAskingMentor}
            onClick={() => submitQuestion()}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {isAskingMentor
              ? "Generating Coaching..."
              : allowMetricsAi
                ? allowAudioAi
                  ? "Ask Gemini 4 Mentor (Metrics + 25s Audio)"
                  : "Ask Gemini 4 Mentor (Metrics JSON Only)"
                : "Run Offline Deterministic Mentor"}
          </Button>

          {mentorError && (
            <div
              role="alert"
              data-testid="mentor-error-notice"
              className="space-y-2 bg-[#FEF7EC] p-3 text-[11px] text-[#B45309] border border-[rgba(180,83,9,0.24)] squircle-inner"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <p className="leading-relaxed break-words">{mentorError}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={isAskingMentor}
                  onClick={() => {
                    const lastReq = lastRequestRef.current;
                    if (lastReq) {
                      onDismissMentorError?.();
                      onAskMentor(lastReq);
                    } else {
                      submitQuestion();
                    }
                  }}
                  className="bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#182220] hairline-border hover:border-[rgba(58,114,105,0.45)] squircle-inner cursor-pointer disabled:opacity-50"
                >
                  Retry Request
                </button>
                <button
                  type="button"
                  disabled={isAskingMentor}
                  onClick={() =>
                    submitQuestion(lastRequestRef.current?.question ?? question, {
                      allowMetricsAi: false,
                      allowAudioAi: false,
                    })
                  }
                  className="bg-[#EBF3F1] px-2.5 py-1 text-[11px] font-semibold text-[#3A7269] hover:bg-[#DFECE9] squircle-inner cursor-pointer disabled:opacity-50"
                >
                  Run Offline Fallback Now
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Multi-Turn Coaching Thread */}
      {conversationHistory.length > 1 && (
        <div className="min-w-0 bg-[#FFFFFF] p-4 hairline-border squircle-inner space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#182220]">
              <MessageSquare className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
              Follow-Up Thread ({Math.ceil(conversationHistory.length / 2)} turns)
            </span>
          </div>
          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
            {conversationHistory.map((turn, idx) => (
              <div
                key={`${turn.role}-${idx}`}
                className={`p-2.5 text-[11px] leading-relaxed squircle-inner break-words ${
                  turn.role === "user"
                    ? "bg-[#EBF3F1] text-[#182220] ml-4"
                    : "bg-[#F5F5F7] text-[#52605D] mr-4"
                }`}
              >
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3A7269]">
                  {turn.role === "user" ? "You" : "Mix Mentor"}
                </div>
                {turn.content}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mentor Advice Output */}
      {mentorAdvice && (
        <div className="min-w-0 bg-[#FFFFFF] p-4 hairline-border squircle-inner space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#182220]">
              Coaching Brief
            </span>
            <span
              className={`max-w-full break-words px-2 py-0.5 text-[10px] font-medium squircle-inner ${
                mentorAdvice.mode === "deterministic_fallback"
                  ? "bg-[#F5F5F7] text-[#52605D]"
                  : "bg-[#EBF3F1] text-[#3A7269]"
              }`}
            >
              {modeAttribution} · {mentorAdvice.model_used}
            </span>
          </div>

          {mentorAdvice.fallback_reason && (
            <div className="flex items-start gap-2 bg-[#FEF7EC] p-2.5 text-[11px] text-[#B45309] border border-[rgba(180,83,9,0.22)] squircle-inner">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="break-words">{mentorAdvice.fallback_reason}</span>
            </div>
          )}

          <p className="text-xs leading-relaxed text-[#182220] break-words">{mentorAdvice.summary}</p>
          <p className="bg-[#F5F5F7] p-2.5 text-[11px] text-[#52605D] squircle-inner break-words">
            <strong className="text-[#182220]">Artist Vision Framing: </strong>
            {mentorAdvice.vision_alignment_note}
          </p>

          <div className="space-y-2">
            {mentorAdvice.prioritized_actions.map((action) => (
              <div
                key={action.evidence_id}
                className="bg-[#FAFAFA] p-3 hairline-border squircle-inner space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#182220] break-words">
                    {action.headline}
                  </span>
                  <button
                    type="button"
                    onClick={() => onJumpToEvidence(action.evidence_id)}
                    className="shrink-0 bg-[#EBF3F1] px-2 py-0.5 text-[10px] font-medium text-[#3A7269] hover:bg-[#DFECE9] tabular-telemetry squircle-inner cursor-pointer"
                  >
                    {action.evidence_id}
                  </button>
                </div>
                <p className="text-[11px] text-[#52605D] break-words">{action.coaching_note}</p>
                <p className="text-[11px] text-[#182220] break-words">
                  <strong>Experiment:</strong> {action.daw_experiment}
                </p>
                <p className="text-[11px] text-[#52605D] break-words">
                  <strong>Recheck:</strong> {action.verification_step}
                </p>
              </div>
            ))}
          </div>

          <div className="border-t border-[rgba(24,34,32,0.06)] pt-2 text-[10px] leading-relaxed text-[#52605D] break-words">
            <div>
              Audit: raw_audio_sent_to_ai={String(mentorAdvice.privacy_audit.raw_audio_sent_to_ai)} ·{" "}
              external_ai_enabled={String(mentorAdvice.privacy_audit.external_ai_enabled)} ·{" "}
              training_opt_in={String(mentorAdvice.privacy_audit.training_opt_in)}
            </div>
            <div>{mentorAdvice.privacy_audit.retention_policy}</div>
          </div>
        </div>
      )}

      {/* DAW / Plugin Chain Context Drawer (user_reported_context) */}
      <div className="bg-[#F5F5F7] p-4 hairline-border squircle-inner space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#182220]">
            <Sliders className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
            DAW &amp; Chain Context
          </span>
          <span className="text-[10px] text-[#52605D] tabular-telemetry">
            user_reported_context
          </span>
        </div>
        <input
          type="text"
          value={daw}
          onChange={(e) => {
            setDaw(e.target.value);
            setContextSaved(false);
          }}
          placeholder="DAW (e.g., Ableton Live 12, Logic Pro)"
          aria-label="DAW Name"
          className="w-full bg-[#FFFFFF] px-3 py-1.5 text-xs text-[#182220] hairline-border squircle-inner"
        />
        <input
          type="text"
          value={busRouting}
          onChange={(e) => {
            setBusRouting(e.target.value);
            setContextSaved(false);
          }}
          placeholder="Bus routing (e.g., Drum Bus -> Glue Comp -> Mix Bus)"
          aria-label="Bus Routing"
          className="w-full bg-[#FFFFFF] px-3 py-1.5 text-xs text-[#182220] hairline-border squircle-inner"
        />
        <input
          type="text"
          value={pluginNotes}
          onChange={(e) => {
            setPluginNotes(e.target.value);
            setContextSaved(false);
          }}
          placeholder="Plugin notes (unverified user context)"
          aria-label="Plugin Notes"
          className="w-full bg-[#FFFFFF] px-3 py-1.5 text-xs text-[#182220] hairline-border squircle-inner"
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              onSaveDawContext({ daw, bus_routing: busRouting, plugin_notes: pluginNotes });
              setContextSaved(true);
            }}
          >
            Save DAW Context
          </Button>
          {contextSaved && (
            <span className="text-[11px] font-medium text-[#15803D]">
              Saved as user_reported_context
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

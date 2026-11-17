"use client";

import React, { useState } from "react";
import { ShieldCheck, Sliders, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { AnalysisReport, MentorRequest, MentorResponse } from "@/types/report";

interface MentorPrivacyPanelProps {
  report: AnalysisReport;
  mentorAdvice: MentorResponse | null;
  isAskingMentor: boolean;
  onAskMentor: (req: MentorRequest) => void;
  onSaveDawContext: (ctx: { daw: string; bus_routing: string; plugin_notes: string }) => void;
  onJumpToEvidence: (evidenceId: string) => void;
}

export function MentorPrivacyPanel({
  report,
  mentorAdvice,
  isAskingMentor,
  onAskMentor,
  onSaveDawContext,
  onJumpToEvidence,
}: MentorPrivacyPanelProps) {
  const [allowMetricsAi, setAllowMetricsAi] = useState(false);
  const [allowAudioAi, setAllowAudioAi] = useState(false);
  const [allowTrainingOptIn, setAllowTrainingOptIn] = useState(false);
  const [question, setQuestion] = useState("");

  const [daw, setDaw] = useState(report.context.user_reported_context?.daw || "");
  const [busRouting, setBusRouting] = useState(
    report.context.user_reported_context?.bus_routing || ""
  );
  const [pluginNotes, setPluginNotes] = useState(
    report.context.user_reported_context?.plugin_notes || ""
  );
  const [contextSaved, setContextSaved] = useState(false);

  const handleToggleMetrics = (next: boolean) => {
    setAllowMetricsAi(next);
    if (!next) {
      setAllowAudioAi(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Three-Tier Independent Granular Privacy Controls */}
      <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold text-[#182220]">
            <ShieldCheck className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
            Privacy &amp; AI Data Consent Controls
          </span>
          <span className="bg-[#ECFDF3] px-2 py-0.5 text-[10px] font-semibold text-[#15803D] squircle-inner">
            Default Off
          </span>
        </div>

        <div className="space-y-2.5 text-xs">
          <div className="flex items-start justify-between gap-3 bg-[#F5F5F7] p-3 squircle-inner">
            <div className="space-y-0.5">
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
            <div className="space-y-0.5">
              <div className="font-semibold text-[#182220]">
                2. Direct Audio Snippet Analysis
              </div>
              <p className="text-[11px] leading-relaxed text-[#52605D]">
                Separate opt-in required before sending a compressed 25s clip around the top issue to external Gemini APIs.
              </p>
            </div>
            <Switch
              checked={allowAudioAi}
              disabled={!allowMetricsAi}
              onCheckedChange={setAllowAudioAi}
              aria-label="Toggle B Direct Audio Listening Opt-In"
            />
          </div>

          <div className="flex items-start justify-between gap-3 bg-[#F5F5F7] p-3 squircle-inner">
            <div className="space-y-0.5">
              <div className="font-semibold text-[#182220]">
                3. Model Training Permission
              </div>
              <p className="text-[11px] leading-relaxed text-[#52605D]">
                Strictly OFF by default. API calls use <code className="text-[#182220]">store=false</code> (ephemeral processing is not identical to zero retention); model training never occurs unless explicitly enabled.
              </p>
            </div>
            <Switch
              checked={allowTrainingOptIn}
              onCheckedChange={setAllowTrainingOptIn}
              aria-label="Toggle C Future Model Training Opt-In"
            />
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <label htmlFor="mentor-question" className="block text-[11px] font-medium text-[#52605D]">
            Ask your Mix Mentor (optional)
          </label>
          <textarea
            id="mentor-question"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g., How should I address the 250 Hz low-mid buildup without losing punch?"
            className="w-full resize-none bg-[#FAFAFA] px-3 py-2 text-xs text-[#182220] hairline-border squircle-inner focus:border-[#3A7269] focus:outline-none"
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="w-full"
            disabled={isAskingMentor}
            onClick={() =>
              onAskMentor({
                allow_metrics_ai: allowMetricsAi,
                allow_audio_ai: allowAudioAi,
                allow_training_opt_in: allowTrainingOptIn,
                question,
              })
            }
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {isAskingMentor
              ? "Generating Coaching..."
              : allowMetricsAi
                ? allowAudioAi
                  ? "Ask Gemini Mentor (Metrics + 25s Audio)"
                  : "Ask Gemini Mentor (Metrics JSON Only)"
                : "Run Offline Deterministic Mentor"}
          </Button>
        </div>
      </div>

      {/* Mentor Advice Output */}
      {mentorAdvice && (
        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#182220]">
              Coaching Brief
            </span>
            <span className="bg-[#EBF3F1] px-2 py-0.5 text-[10px] font-medium text-[#3A7269] squircle-inner">
              {mentorAdvice.mode.replaceAll("_", " ")} · {mentorAdvice.model_used}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-[#182220]">{mentorAdvice.summary}</p>
          <p className="bg-[#F5F5F7] p-2.5 text-[11px] text-[#52605D] squircle-inner">
            <strong className="text-[#182220]">Artist Vision Framing: </strong>
            {mentorAdvice.vision_alignment_note}
          </p>

          <div className="space-y-2">
            {mentorAdvice.prioritized_actions.map((action) => (
              <div
                key={action.evidence_id}
                className="bg-[#FAFAFA] p-3 hairline-border squircle-inner space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#182220]">
                    {action.headline}
                  </span>
                  <button
                    type="button"
                    onClick={() => onJumpToEvidence(action.evidence_id)}
                    className="bg-[#EBF3F1] px-2 py-0.5 text-[10px] font-medium text-[#3A7269] hover:bg-[#DFECE9] tabular-telemetry squircle-inner cursor-pointer"
                  >
                    {action.evidence_id}
                  </button>
                </div>
                <p className="text-[11px] text-[#52605D]">{action.coaching_note}</p>
                <p className="text-[11px] text-[#182220]">
                  <strong>Experiment:</strong> {action.daw_experiment}
                </p>
                <p className="text-[11px] text-[#52605D]">
                  <strong>Recheck:</strong> {action.verification_step}
                </p>
              </div>
            ))}
          </div>

          <div className="border-t border-[rgba(24,34,32,0.06)] pt-2 text-[10px] leading-relaxed text-[#52605D]">
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
        <div className="flex items-center justify-between gap-2">
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

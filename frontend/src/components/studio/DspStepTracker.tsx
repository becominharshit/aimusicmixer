"use client";

import React from "react";
import { Check, Cpu, Loader2, Sparkles, X } from "lucide-react";

export type DspPipelineStageStatus = "pending" | "active" | "done" | "error";

export interface DspPipelineStep {
  id: string;
  label: string;
  shortLabel: string;
  status: DspPipelineStageStatus;
  elapsedMs?: number | null;
}

export const DEFAULT_DSP_PIPELINE_STEPS: Array<{ id: string; label: string; shortLabel: string }> = [
  { id: "decode", label: "Audio Decode & Hash", shortLabel: "Decode & Hash" },
  { id: "loudness", label: "ITU-R Loudness & Punch", shortLabel: "LUFS & Punch" },
  { id: "peak_phase", label: "4x True Peak & 20–120 Hz Phase", shortLabel: "True Peak & Phase" },
  { id: "spectral", label: "6-Band Spectral FFT & BPM", shortLabel: "6-Band FFT & BPM" },
  { id: "mentor", label: "Gemini 4 Hydrogen Mentor", shortLabel: "Gemini 4 Mentor" },
];

interface DspStepTrackerProps {
  /** 0..4 active stage index (or 5 when all done). */
  activeStageIndex: number;
  /** Optional explicit per-stage elapsed ms map keyed by step id. */
  stageElapsedMs?: Partial<Record<string, number>>;
  /** Optional upload progress 0..100 shown during decode stage. */
  uploadPercent?: number | null;
  /** Whether stage 5 (Gemini Mentor) is currently running live. */
  mentorActive?: boolean;
  /** Whether stage 5 completed. */
  mentorCompleted?: boolean;
  /** Optional status caption. */
  statusLabel?: string;
  /** Compact mode for embedding inside MentorDrawer. */
  compact?: boolean;
  /** Instant cancel handler during long uploads/analyses. */
  onCancel?: () => void;
  className?: string;
}

export function DspStepTracker({
  activeStageIndex,
  stageElapsedMs = {},
  uploadPercent = null,
  mentorActive = false,
  mentorCompleted = false,
  statusLabel,
  compact = false,
  onCancel,
  className = "",
}: DspStepTrackerProps) {
  const steps: DspPipelineStep[] = DEFAULT_DSP_PIPELINE_STEPS.map((step, idx) => {
    let status: DspPipelineStageStatus = "pending";
    if (idx === 4) {
      if (mentorCompleted) status = "done";
      else if (mentorActive || activeStageIndex === 4) status = "active";
      else if (activeStageIndex > 4) status = "done";
      else status = "pending";
    } else if (idx < activeStageIndex) {
      status = "done";
    } else if (idx === activeStageIndex) {
      status = "active";
    }
    return {
      ...step,
      status,
      elapsedMs: stageElapsedMs[step.id] ?? null,
    };
  });

  return (
    <div
      data-testid="dsp-step-tracker"
      className={`studio-card squircle-outer overflow-hidden ${compact ? "p-3" : "p-4 sm:p-5"} ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[var(--studio-mint)]" />
          <span className="tabular-telemetry text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)]">
            {statusLabel || "Deterministic DSP Signal Chain"}
          </span>
          {typeof uploadPercent === "number" && uploadPercent < 100 ? (
            <span className="tabular-telemetry rounded bg-[var(--studio-mint-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--studio-mint)]">
              {uploadPercent}%
            </span>
          ) : null}
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--studio-vermilion)] hover:text-[var(--studio-vermilion)]"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        ) : null}
      </div>

      {/* 5-Stage Tactile Rail — wraps cleanly on 390px mobile with zero horizontal overflow */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5 sm:gap-2.5">
        {steps.map((step, index) => {
          const isDone = step.status === "done";
          const isActive = step.status === "active";
          const isMentor = step.id === "mentor";

          return (
            <div
              key={step.id}
              data-stage-id={step.id}
              data-stage-status={step.status}
              className={`relative flex flex-col justify-between rounded-xl border p-2.5 transition-all ${
                isActive
                  ? isMentor
                    ? "border-[var(--studio-amber)] bg-[var(--studio-amber-soft)]"
                    : "border-[var(--studio-mint)] bg-[var(--studio-mint-soft)]"
                  : isDone
                    ? "border-[var(--border-strong)] bg-[var(--bg-inset)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-inset)]/60 opacity-70"
              }`}
            >
              {/* Top rail beam */}
              <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-[var(--border-hairline)]">
                {isActive ? (
                  <div className="signal-beam-active h-full w-full rounded-full" />
                ) : isDone ? (
                  <div
                    className="h-full w-full rounded-full"
                    style={{
                      backgroundColor: isMentor ? "var(--studio-amber)" : "var(--studio-mint)",
                    }}
                  />
                ) : null}
              </div>

              <div className="flex items-start justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md tabular-telemetry text-[10px] font-bold ${
                      isDone
                        ? "bg-[var(--studio-mint)] text-[#0B0D11]"
                        : isActive
                          ? isMentor
                            ? "bg-[var(--studio-amber)] text-[#0B0D11]"
                            : "bg-[var(--studio-mint)] text-[#0B0D11]"
                          : "bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-hairline)]"
                    }`}
                  >
                    {isDone ? (
                      <Check className="h-3 w-3 stroke-[2.75]" />
                    ) : isActive ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isMentor ? (
                      <Sparkles className="h-3 w-3" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="truncate text-[11px] font-semibold leading-tight text-[var(--text-primary)]">
                    {compact ? step.shortLabel : step.label}
                  </span>
                </div>
              </div>

              <div className="mt-1.5 flex items-center justify-between">
                <span className="tabular-telemetry text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {isDone ? "Verified" : isActive ? "Running" : isMentor ? "Opt-In" : "Queued"}
                </span>
                {typeof step.elapsedMs === "number" && step.elapsedMs > 0 ? (
                  <span className="tabular-telemetry text-[10px] font-semibold text-[var(--text-secondary)]">
                    {step.elapsedMs >= 1000
                      ? `${(step.elapsedMs / 1000).toFixed(1)}s`
                      : `${Math.round(step.elapsedMs)}ms`}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

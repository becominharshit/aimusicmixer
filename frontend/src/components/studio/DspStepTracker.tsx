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
  { id: "decode", label: "1. Decode", shortLabel: "1. Decode" },
  { id: "loudness", label: "2. Loudness", shortLabel: "2. Loudness" },
  { id: "peak_phase", label: "3. Peaks & Phase", shortLabel: "3. Peaks & Phase" },
  { id: "spectral", label: "4. Spectrum", shortLabel: "4. Spectrum" },
  { id: "mentor", label: "5. AI Suggestions", shortLabel: "5. AI Suggestions" },
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

  const currentActiveStep = steps.find((s) => s.status === "active") ?? null;

  return (
    <div
      data-testid="dsp-step-tracker"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className={`studio-card overflow-hidden ${compact ? "p-3" : "p-4 sm:p-5"} ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[#FFE01B]" aria-hidden="true" />
          <span className="tabular-telemetry text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]">
            {statusLabel || "Deterministic DSP Signal Chain"}
          </span>
          {typeof uploadPercent === "number" && uploadPercent < 100 ? (
            <span className="tabular-telemetry border border-[#0A0A0A] bg-[#FFE01B] px-1.5 py-0.5 text-[10px] font-bold text-[#0A0A0A]">
              {uploadPercent}%
            </span>
          ) : null}
          {currentActiveStep ? (
            <span className="sr-only">Currently running {currentActiveStep.label}</span>
          ) : null}
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel active DSP analysis"
            className="inline-flex items-center gap-1 border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 py-1 text-xs font-bold uppercase text-[var(--text-secondary)] transition-colors hover:border-[#FF3B1F] hover:bg-[#FF3B1F] hover:text-[#0A0A0A] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Cancel
          </button>
        ) : null}
      </div>

      {/* Crisp Swiss 5-Step Horizontal Progress Rail */}
      <div className="grid grid-cols-1 gap-0 border border-[var(--border-hairline)] sm:grid-cols-5 sm:divide-x sm:divide-[var(--border-hairline)]">
        {steps.map((step, index) => {
          const isDone = step.status === "done";
          const isActive = step.status === "active";
          const isMentor = step.id === "mentor";

          return (
            <div
              key={step.id}
              data-stage-id={step.id}
              data-stage-status={step.status}
              className={`relative flex flex-col justify-between border-b border-[var(--border-hairline)] p-2.5 transition-colors last:border-b-0 sm:border-b-0 ${
                isActive
                  ? "bg-[var(--studio-yellow-soft)]"
                  : isDone
                    ? "bg-[var(--bg-elevated)]"
                    : "bg-[var(--bg-inset)]/70 opacity-75"
              }`}
            >
              {/* Top rail beam */}
              <div className="mb-2 h-1 w-full overflow-hidden bg-[var(--border-hairline)]">
                {isActive ? (
                  <div className="signal-beam-active h-full w-full" />
                ) : isDone ? (
                  <div
                    className="h-full w-full"
                    style={{
                      backgroundColor: isMentor ? "#FFE01B" : "#22C58B",
                    }}
                  />
                ) : null}
              </div>

              <div className="flex items-start justify-between gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center tabular-telemetry text-[10px] font-bold ${
                      isDone
                        ? "bg-[#22C58B] text-[#0A0A0A]"
                        : isActive
                          ? "bg-[#FFE01B] text-[#0A0A0A]"
                          : "border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                    }`}
                  >
                    {isDone ? (
                      <Check className="h-3 w-3 stroke-[2.75]" aria-hidden="true" />
                    ) : isActive ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    ) : isMentor ? (
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      `0${index + 1}`
                    )}
                  </span>
                  <span className="text-[11px] font-bold leading-tight text-[var(--text-primary)] whitespace-nowrap">
                    {compact ? step.shortLabel : step.label}
                  </span>
                </div>
              </div>

              <div className="mt-1.5 flex items-center justify-between">
                <span className="tabular-telemetry text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
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

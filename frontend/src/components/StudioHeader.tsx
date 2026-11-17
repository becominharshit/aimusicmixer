"use client";

import React from "react";
import { motion } from "motion/react";
import { ShieldCheck, Trash2, Sparkles } from "lucide-react";
import { STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import { formatTimecode } from "@/lib/utils";
import type { AnalysisReport } from "@/types/report";

export type WorkspaceMode = "simple" | "advanced";

interface StudioHeaderProps {
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  report: AnalysisReport | null;
  onClearSession: () => void;
}

export function StudioHeader({
  mode,
  onModeChange,
  report,
  onClearSession,
}: StudioHeaderProps) {
  const privacyLabel = report?.privacy_audit.raw_audio_sent_to_ai
    ? "Audio AI Opt-In"
    : report?.privacy_audit.external_ai_enabled
      ? "Metrics-Only AI"
      : "Local DSP Only";

  return (
    <header className="border-b border-[rgba(24,34,32,0.08)] bg-[#FAFAFA]/92 backdrop-blur-md sm:sticky sm:top-0 sm:z-40">
      <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center bg-[#3A7269] text-white squircle-inner">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="text-white"
            >
              <path
                d="M4 12h2.5l2-6 3 12 2.5-9 2 3H20"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-[family-name:var(--font-heading)] text-base font-bold tracking-[-0.02em] text-[#182220]">
                MixBench
              </span>
              <span className="hidden rounded-full bg-[#EBF3F1] px-2 py-0.5 text-[11px] font-medium text-[#3A7269] sm:inline-flex">
                v1.0
              </span>
            </div>
            <p className="text-xs text-[#52605D]">
              Learn mixing &amp; mastering by doing
            </p>
          </div>
        </div>

        {/* Simple <-> Advanced Mode Switcher */}
        <nav
          aria-label="Workspace mode"
          className="relative inline-flex items-center bg-[#F5F5F7] p-1 hairline-border squircle-inner"
        >
          {(
            [
              { id: "simple", label: "Simple Mix Check" },
              { id: "advanced", label: "Advanced Mix Check" },
            ] as const
          ).map((item) => {
            const active = mode === item.id;
            return (
              <motion.button
                key={item.id}
                type="button"
                whileTap={TACTILE_TAP}
                onClick={() => onModeChange(item.id)}
                className={`relative z-10 px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 sm:text-sm cursor-pointer squircle-inner ${
                  active ? "text-[#182220]" : "text-[#52605D] hover:text-[#182220]"
                }`}
                aria-pressed={active}
              >
                {active && (
                  <motion.span
                    layoutId="workspace-mode-pill"
                    transition={STUDIO_SPRING}
                    className="absolute inset-0 -z-10 bg-[#FFFFFF] hairline-border squircle-inner shadow-2xs"
                  />
                )}
                {item.label}
              </motion.button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          {report && (
            <div className="hidden items-center gap-2 bg-[#FFFFFF] px-3 py-1.5 text-xs hairline-border squircle-inner lg:flex">
              <span className="max-w-[180px] truncate font-medium text-[#182220]">
                {report.audio_metadata.filename}
              </span>
              <span className="text-[#52605D] tabular-telemetry">
                {(report.audio_metadata.sample_rate_hz / 1000).toFixed(1)} kHz ·{" "}
                {report.audio_metadata.bit_depth}-bit ·{" "}
                {formatTimecode(report.audio_metadata.duration_sec)}
              </span>
            </div>
          )}

          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium squircle-inner ${
              report?.privacy_audit.raw_audio_sent_to_ai
                ? "bg-[#FEF7EC] text-[#B45309] border border-[rgba(180,83,9,0.25)]"
                : report?.privacy_audit.external_ai_enabled
                  ? "bg-[#EBF3F1] text-[#3A7269] border border-[rgba(58,114,105,0.22)]"
                  : "bg-[#FFFFFF] text-[#15803D] hairline-border"
            }`}
          >
            {report?.privacy_audit.external_ai_enabled ? (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{privacyLabel}</span>
          </div>

          {report && (
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={onClearSession}
              className="inline-flex items-center gap-1.5 bg-[#FFFFFF] px-2.5 py-1.5 text-xs font-medium text-[#52605D] hover:text-[#BE123C] hairline-border hover:border-[rgba(190,18,60,0.3)] squircle-inner cursor-pointer transition-colors"
              title="Delete ephemeral audio session immediately"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Clear Session</span>
            </motion.button>
          )}
        </div>
      </div>
    </header>
  );
}

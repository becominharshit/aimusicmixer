"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { STUDIO_EASE, STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import { formatTimecode } from "@/lib/utils";
import type { AnalysisReport, BackendHealth } from "@/types/report";

export type WorkspaceMode = "simple" | "advanced";
export type HealthStatus = "checking" | "waking" | "online" | "offline";

interface StudioHeaderProps {
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  report: AnalysisReport | null;
  onClearSession: () => void;
  healthStatus: HealthStatus;
  healthData: BackendHealth | null;
  healthError: string | null;
  wakeAttempt?: number;
  wakeMaxAttempts?: number;
  onRetryHealth: () => void;
}

export function StudioHeader({
  mode,
  onModeChange,
  report,
  onClearSession,
  healthStatus,
  healthData,
  healthError,
  wakeAttempt = 0,
  wakeMaxAttempts = 15,
  onRetryHealth,
}: StudioHeaderProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [popoverOpen]);

  const privacyLabel = report?.privacy_audit.raw_audio_sent_to_ai
    ? "Audio AI Opt-In"
    : report?.privacy_audit.external_ai_enabled
      ? "Metrics-Only AI"
      : "Zero Audio Sent";

  const statusText =
    healthStatus === "online"
      ? "DSP Engine Online"
      : healthStatus === "waking"
        ? "Waking DSP Engine (~45s)…"
        : healthStatus === "offline"
          ? "Backend Unreachable — Check API URL"
          : "Checking DSP Engine";

  return (
    <header className="border-b border-[rgba(24,34,32,0.08)] bg-[#FAFAFA]/94 backdrop-blur-md sm:sticky sm:top-0 sm:z-40">
      <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-[#3A7269] text-white squircle-inner">
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

        {/* Simple <-> Advanced Mode Switcher (SSR immediate, zero CLS) */}
        <nav
          aria-label="Workspace mode"
          className="relative inline-flex min-h-[38px] items-center bg-[#F5F5F7] p-1 hairline-border squircle-inner"
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

        <div className="flex flex-wrap items-center gap-2">
          {report && (
            <div className="hidden items-center gap-2 bg-[#FFFFFF] px-3 py-1.5 text-xs hairline-border squircle-inner xl:flex">
              <span className="max-w-[160px] truncate font-medium text-[#182220]">
                {report.audio_metadata.filename}
              </span>
              <span className="text-[#52605D] tabular-telemetry">
                {(report.audio_metadata.sample_rate_hz / 1000).toFixed(1)} kHz ·{" "}
                {report.audio_metadata.bit_depth}-bit ·{" "}
                {formatTimecode(report.audio_metadata.duration_sec)}
              </span>
            </div>
          )}

          {/* Privacy Mode Indicator */}
          {report && (
            <div
              className={`hidden items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium squircle-inner sm:inline-flex ${
                report.privacy_audit.raw_audio_sent_to_ai
                  ? "bg-[#FEF7EC] text-[#B45309] border border-[rgba(180,83,9,0.25)]"
                  : report.privacy_audit.external_ai_enabled
                    ? "bg-[#EBF3F1] text-[#3A7269] border border-[rgba(58,114,105,0.22)]"
                    : "bg-[#FFFFFF] text-[#182220] hairline-border"
              }`}
            >
              {report.privacy_audit.external_ai_enabled ? (
                <Sparkles className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
              )}
              <span>{privacyLabel}</span>
            </div>
          )}

          {/* Live Backend Health Status Pill + Actionable Diagnostic Popover */}
          <div ref={popoverRef} className="relative">
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={() => setPopoverOpen((prev) => !prev)}
              aria-expanded={popoverOpen}
              className={`inline-flex min-h-[32px] items-center gap-2 px-3 py-1.5 text-xs font-medium squircle-inner cursor-pointer transition-colors ${
                healthStatus === "online"
                  ? "bg-[#FFFFFF] text-[#182220] hairline-border hover:border-[rgba(58,114,105,0.35)]"
                  : healthStatus === "waking"
                    ? "bg-[#FEF7EC] text-[#B45309] border border-[rgba(180,83,9,0.28)] hover:bg-[#FDEFD9]"
                    : healthStatus === "offline"
                      ? "bg-[#FFF1F3] text-[#BE123C] border border-[rgba(190,18,60,0.28)] hover:bg-[#FFE4E8]"
                      : "bg-[#F5F5F7] text-[#52605D] hairline-border"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  healthStatus === "online"
                    ? "bg-[#3A7269]"
                    : healthStatus === "waking"
                      ? "bg-[#D97706] animate-pulse"
                      : healthStatus === "offline"
                        ? "bg-[#BE123C]"
                        : "bg-[#52605D]/50 animate-pulse"
                }`}
              />
              <span>{statusText}</span>
            </motion.button>

            <AnimatePresence>
              {popoverOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: STUDIO_EASE }}
                  role="dialog"
                  aria-label="DSP backend connection diagnostics"
                  className="absolute right-0 mt-2 w-80 bg-[#FFFFFF] p-4 hairline-border squircle-outer shadow-sm z-50 space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[#182220]">
                      {healthStatus === "online" ? (
                        <CheckCircle2 className="h-4 w-4 text-[#15803D]" aria-hidden="true" />
                      ) : healthStatus === "waking" ? (
                        <RefreshCw className="h-4 w-4 text-[#B45309] animate-spin" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-[#BE123C]" aria-hidden="true" />
                      )}
                      DSP Engine Diagnostics
                    </span>
                    <button
                      type="button"
                      onClick={onRetryHealth}
                      className="inline-flex items-center gap-1 bg-[#EBF3F1] px-2 py-1 text-[11px] font-medium text-[#3A7269] hover:bg-[#DFECE9] squircle-inner cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                      Retry
                    </button>
                  </div>

                  <div className="space-y-1.5 bg-[#F5F5F7] p-2.5 squircle-inner">
                    <div className="text-[11px] text-[#52605D]">Configured API Endpoint</div>
                    <div className="break-all font-mono text-[11px] text-[#182220]">
                      {API_BASE_URL}/health
                    </div>
                  </div>

                  {healthStatus === "online" && healthData ? (
                    <div className="space-y-1 text-[11px] text-[#52605D]">
                      <div className="flex justify-between">
                        <span>FFmpeg / ffprobe</span>
                        <span className="font-medium text-[#15803D]">
                          {healthData.ffmpeg_available ? "Available" : "Missing"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Gemini Mentor Key</span>
                        <span className="font-medium text-[#182220]">
                          {healthData.gemini_configured
                            ? `Configured (${healthData.gemini_model || "gemini-2.5-flash"})`
                            : "Offline Fallback Mode"}
                        </span>
                      </div>
                    </div>
                  ) : healthStatus === "waking" ? (
                    <div className="space-y-1.5 text-[11px] text-[#52605D]">
                      <p className="font-medium text-[#B45309]">
                        Cold-starting DSP container ({wakeAttempt > 0 ? `retry ${wakeAttempt}/${wakeMaxAttempts}` : "connecting…"}).
                      </p>
                      <p>
                        Retrying <code className="text-[#182220]">/health</code> automatically every 5 seconds for up to 75 seconds while the backend boots.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 text-[11px] text-[#52605D]">
                      <p className="text-[#BE123C] font-medium">
                        {healthError || "Could not establish HTTP connection to FastAPI DSP backend."}
                      </p>
                      <p>
                        Start the Python backend (<code className="text-[#182220]">uvicorn app.main:app --port 8000</code>) or set{" "}
                        <code className="text-[#182220]">NEXT_PUBLIC_API_URL</code> and{" "}
                        <code className="text-[#182220]">ALLOWED_ORIGINS</code> in your deployment environment. MixBench never substitutes fake metrics when offline.
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {report && (
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={onClearSession}
              className="inline-flex min-h-[32px] items-center gap-1.5 bg-[#FFFFFF] px-2.5 py-1.5 text-xs font-medium text-[#52605D] hover:text-[#BE123C] hairline-border hover:border-[rgba(190,18,60,0.3)] squircle-inner cursor-pointer transition-colors"
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

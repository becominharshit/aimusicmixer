"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  Download,
  History,
  Link2,
  LogIn,
  LogOut,
  Moon,
  Printer,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  Trash2,
  User,
} from "lucide-react";
import { deriveAutoFixEqBands } from "@/components/FindingCard";
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
  supabaseConfigured?: boolean;
  userEmail?: string | null;
  savedCount?: number;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
  onOpenHistory?: () => void;
  onOpenSignedOutHistory?: () => void;
  onShareReviewLink?: () => Promise<boolean>;
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
  wakeMaxAttempts = 24,
  onRetryHealth,
  supabaseConfigured = false,
  userEmail = null,
  savedCount = 0,
  onOpenAuth,
  onSignOut,
  onOpenHistory,
  onOpenSignedOutHistory,
  onShareReviewLink,
}: StudioHeaderProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setIsDarkTheme(document.documentElement.classList.contains("dark"));
    }
  }, []);

  const handleToggleTheme = () => {
    if (typeof document === "undefined") return;
    const nextDark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", nextDark);
    setIsDarkTheme(nextDark);
    try {
      window.localStorage.setItem("mixbench_theme", nextDark ? "dark" : "light");
    } catch {
      // Ignore storage quota / private mode
    }
  };

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

  const handleExportJson = () => {
    if (!report) return;
    const safeName = report.audio_metadata.filename
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_");
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `MixBench_${safeName || "session"}_${report.report_id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportEqPreset = () => {
    if (!report) return;
    const bands = deriveAutoFixEqBands(report.findings);
    const safeName = report.audio_metadata.filename
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_");
    const presetPayload = {
      schema: "mixbench.daw_eq_preset.v1",
      generated_at: new Date().toISOString(),
      track: report.audio_metadata.filename,
      genre: report.context.genre,
      stage: report.context.stage,
      bpm: report.audio_metadata.bpm ?? null,
      notes:
        "Starting-point corrective EQ & M/S sub-bass mono-maker settings derived strictly from deterministic DSP measurements. Apply subtly and A/B level-matched in your DAW.",
      parametric_eq_bands: bands.map((b, idx) => ({
        band_index: idx + 1,
        evidence_id: b.id,
        type: b.filterType ?? "peaking",
        frequency_hz: b.freqHz,
        q: b.q,
        gain_db: b.gainDb,
      })),
      mid_side_sub_mono_maker: {
        enabled: (report.global_metrics.low_end_phase_correlation ?? 1) < 0.45,
        side_highpass_hz: 100,
        slope_db_per_oct: 12,
        measured_sub_20_120hz_corr: report.global_metrics.low_end_phase_correlation ?? null,
      },
      true_peak_limiter_target: {
        ceiling_dbtp: report.context.stage === "unmastered_mix" ? -3.0 : -1.0,
        measured_true_peak_dbtp: report.global_metrics.true_peak_dbtp,
      },
    };
    const blob = new Blob([JSON.stringify(presetPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `MixBench_EQ_Preset_${safeName || "session"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleShareClick = async () => {
    if (!onShareReviewLink || isSharing) return;
    setIsSharing(true);
    try {
      const copied = await onShareReviewLink();
      if (copied) {
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2600);
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handlePrintPdf = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  const privacyLabel = report?.privacy_audit.raw_audio_sent_to_ai
    ? "Audio AI Opt-In"
    : report?.privacy_audit.external_ai_enabled
      ? "Metrics-Only AI"
      : "Zero Audio Sent";

  const statusText =
    healthStatus === "online"
      ? "DSP Engine Online"
      : healthStatus === "waking"
        ? "Waking DSP Engine…"
        : healthStatus === "offline"
          ? "Backend Unreachable — Check API URL"
          : "Checking DSP Engine";

  const compactStatusText =
    healthStatus === "online"
      ? "Online"
      : healthStatus === "waking"
        ? "Waking…"
        : healthStatus === "offline"
          ? "Offline"
          : "Checking";

  const configuredHealthEndpoint = `${API_BASE_URL || ""}/health`;

  return (
    <header className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]/92 backdrop-blur-md sm:sticky sm:top-0 sm:z-40 print:border-0 print:bg-white">
      <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-[var(--studio-mint)] text-[#0B0D11] squircle-inner shadow-xs">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 12h2.5l2-6 3 12 2.5-9 2 3H20"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-base font-bold tracking-[-0.02em] text-[var(--text-primary)]">
                MixBench
              </span>
              <span className="hidden rounded-md bg-[var(--studio-mint-soft)] px-2 py-0.5 tabular-telemetry text-[10px] font-semibold text-[var(--studio-mint)] sm:inline-flex">
                v1.0
              </span>
            </div>
            <p className="hidden text-xs text-[var(--text-secondary)] sm:block">
              Deterministic Audio DSP Workbench
            </p>
          </div>
        </div>

        {/* Simple <-> Advanced Mode Switcher */}
        <nav
          aria-label="Workspace mode"
          className="no-print relative inline-flex max-w-full min-h-[38px] shrink-0 flex-nowrap items-center gap-1 overflow-x-auto bg-[var(--bg-inset)] p-1 hairline-border squircle-inner"
        >
          {(
            [
              { id: "simple", label: "Simple Mix Check", shortLabel: "Simple" },
              { id: "advanced", label: "Advanced Mix Check", shortLabel: "Advanced" },
            ] as const
          ).map((item) => {
            const active = mode === item.id;
            return (
              <motion.button
                key={item.id}
                type="button"
                whileTap={TACTILE_TAP}
                onClick={() => onModeChange(item.id)}
                className={`relative z-10 shrink-0 whitespace-nowrap px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 sm:px-3.5 sm:text-sm cursor-pointer squircle-inner ${
                  active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                aria-pressed={active}
              >
                {active && (
                  <motion.span
                    layoutId="workspace-mode-pill"
                    transition={STUDIO_SPRING}
                    className="pointer-events-none absolute inset-0 -z-10 bg-[var(--bg-elevated)] hairline-border squircle-inner shadow-2xs"
                  />
                )}
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.shortLabel}</span>
              </motion.button>
            );
          })}
        </nav>

        <div className="no-print flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Dark Vinyl / Daylight Studio Theme Toggle */}
          <motion.button
            type="button"
            data-testid="theme-toggle"
            whileTap={TACTILE_TAP}
            onClick={handleToggleTheme}
            aria-label="Toggle studio theme"
            title={isDarkTheme ? "Switch to Daylight Studio Light" : "Switch to Vinyl-Carbon Dark"}
            className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
          >
            {isDarkTheme ? (
              <Sun className="h-3.5 w-3.5 text-[var(--studio-amber)]" aria-hidden="true" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-[var(--studio-cobalt)]" aria-hidden="true" />
            )}
            <span className="hidden 2xl:inline">{isDarkTheme ? "Daylight" : "Vinyl Dark"}</span>
          </motion.button>

          {report && (
            <div className="hidden items-center gap-2 bg-[var(--bg-elevated)] px-3 py-1.5 text-xs hairline-border squircle-inner xl:flex">
              <span className="max-w-[140px] truncate font-medium text-[var(--text-primary)]">
                {report.audio_metadata.filename}
              </span>
              <span className="text-[var(--text-secondary)] tabular-telemetry">
                {(report.audio_metadata.sample_rate_hz / 1000).toFixed(1)} kHz ·{" "}
                {report.audio_metadata.bit_depth}-bit ·{" "}
                {formatTimecode(report.audio_metadata.duration_sec)}
              </span>
            </div>
          )}

          {/* Privacy Mode Indicator */}
          {report && (
            <div
              className={`hidden items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium squircle-inner 2xl:inline-flex ${
                report.privacy_audit.raw_audio_sent_to_ai
                  ? "bg-[var(--studio-amber-soft)] text-[var(--studio-amber)] border border-[var(--studio-amber)]/35"
                  : report.privacy_audit.external_ai_enabled
                    ? "bg-[var(--studio-mint-soft)] text-[var(--studio-mint)] border border-[var(--border-active)]"
                    : "bg-[var(--bg-elevated)] text-[var(--text-primary)] hairline-border"
              }`}
            >
              {report.privacy_audit.external_ai_enabled ? (
                <Sparkles className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
              )}
              <span>{privacyLabel}</span>
            </div>
          )}

          {/* Export Studio Report (EQ Preset + JSON + Share + Print PDF) */}
          {report && (
            <div className="inline-flex items-center gap-1">
              <motion.button
                type="button"
                whileTap={TACTILE_TAP}
                onClick={handleExportEqPreset}
                title="Download DAW-ready EQ & M/S Sub Preset JSON"
                aria-label="Download EQ Preset"
                className="inline-flex min-h-[32px] shrink-0 items-center gap-1 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
              >
                <Sliders className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                <span className="hidden lg:inline">EQ Preset</span>
              </motion.button>
              <motion.button
                type="button"
                whileTap={TACTILE_TAP}
                onClick={handleExportJson}
                title="Download AnalysisReport v1.0 JSON"
                aria-label="Export JSON report"
                className="inline-flex min-h-[32px] shrink-0 items-center gap-1 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
              >
                <Download className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                <span className="hidden xl:inline">JSON</span>
              </motion.button>
              {onShareReviewLink && (
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  disabled={isSharing}
                  onClick={() => void handleShareClick()}
                  title="Copy read-only Client Review Link"
                  aria-label="Share Review Link"
                  className="inline-flex min-h-[32px] shrink-0 items-center gap-1 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
                >
                  {shareCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                      <span className="hidden lg:inline text-[var(--studio-mint)]">Copied</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                      <span className="hidden lg:inline">Share</span>
                    </>
                  )}
                </motion.button>
              )}
              <motion.button
                type="button"
                whileTap={TACTILE_TAP}
                onClick={handlePrintPdf}
                title="Print clean studio PDF report"
                aria-label="Print PDF report"
                className="inline-flex min-h-[32px] shrink-0 items-center gap-1 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
              >
                <Printer className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                <span className="hidden xl:inline">PDF</span>
              </motion.button>
            </div>
          )}

          {/* Live Backend Health Status Pill + Actionable Diagnostic Popover */}
          <div ref={popoverRef} className="relative">
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={() => setPopoverOpen((prev) => !prev)}
              aria-expanded={popoverOpen}
              aria-label={statusText}
              title={`${statusText} (${configuredHealthEndpoint})`}
              className={`inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap sm:gap-2 px-2.5 sm:px-3 py-1.5 text-xs font-medium squircle-inner cursor-pointer transition-colors ${
                healthStatus === "online"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] hairline-border hover:border-[var(--border-active)]"
                  : healthStatus === "waking"
                    ? "bg-[var(--studio-amber-soft)] text-[var(--studio-amber)] border border-[var(--studio-amber)]/35"
                    : healthStatus === "offline"
                      ? "bg-[var(--studio-vermilion-soft)] text-[var(--studio-vermilion)] border border-[var(--studio-vermilion)]/35"
                      : "bg-[var(--bg-inset)] text-[var(--text-secondary)] hairline-border"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  healthStatus === "online"
                    ? "bg-[var(--studio-mint)]"
                    : healthStatus === "waking"
                      ? "bg-[var(--studio-amber)] animate-pulse"
                      : healthStatus === "offline"
                        ? "bg-[var(--studio-vermilion)]"
                        : "bg-[var(--text-muted)] animate-pulse"
                }`}
              />
              <span className="hidden sm:inline">{statusText}</span>
              <span className="sm:hidden">{compactStatusText}</span>
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
                  className="fixed right-3 left-3 sm:absolute sm:left-auto sm:right-0 mt-2 sm:w-80 bg-[var(--bg-elevated)] p-4 border border-[var(--border-strong)] squircle-outer shadow-2xl z-50 space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                      {healthStatus === "online" ? (
                        <CheckCircle2 className="h-4 w-4 text-[var(--studio-mint)]" aria-hidden="true" />
                      ) : healthStatus === "waking" ? (
                        <RefreshCw className="h-4 w-4 text-[var(--studio-amber)] animate-spin" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-[var(--studio-vermilion)]" aria-hidden="true" />
                      )}
                      DSP Engine Diagnostics
                    </span>
                    <button
                      type="button"
                      onClick={onRetryHealth}
                      className="inline-flex items-center gap-1 bg-[var(--studio-mint-soft)] px-2 py-1 text-[11px] font-medium text-[var(--studio-mint)] hover:brightness-110 squircle-inner cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                      Retry
                    </button>
                  </div>

                  <div className="space-y-1.5 bg-[var(--bg-inset)] p-2.5 squircle-inner">
                    <div className="text-[11px] text-[var(--text-muted)]">Configured API Endpoint</div>
                    <div className="break-all font-mono text-[11px] text-[var(--text-primary)]">
                      {configuredHealthEndpoint}
                    </div>
                  </div>

                  {healthStatus === "online" && healthData ? (
                    <div className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                      <div className="flex justify-between">
                        <span>FFmpeg / ffprobe</span>
                        <span className="font-medium text-[var(--studio-mint)]">
                          {healthData.ffmpeg_available ? "Available" : "Missing"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Gemini Mentor Model</span>
                        <span className="font-medium text-[var(--text-primary)]">
                          {healthData.gemini_configured
                            ? `Configured (${healthData.gemini_model || "gemini-4-hydrogen"})`
                            : `Offline Fallback (${healthData.gemini_model || "gemini-4-hydrogen"})`}
                        </span>
                      </div>
                    </div>
                  ) : healthStatus === "waking" ? (
                    <div className="space-y-1.5 text-[11px] text-[var(--text-secondary)]">
                      <p className="font-medium text-[var(--studio-amber)]">
                        Cold-starting DSP container ({wakeAttempt > 0 ? `retry ${wakeAttempt}/${wakeMaxAttempts}` : "connecting…"}).
                      </p>
                      <p>
                        Retrying <code className="text-[var(--text-primary)]">/health</code> automatically every 5 seconds while local Web Audio DSP preview handles instant uploads.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 text-[11px] text-[var(--text-secondary)]">
                      <p className="text-[var(--studio-vermilion)] font-medium">
                        {healthError || "Could not establish HTTP connection to DSP backend."}
                      </p>
                      <p>
                        Uploads automatically fall back to deterministic Browser Web Audio DSP Preview until the server reconnects.
                      </p>
                    </div>
                  )}

                  <div className="pt-1 border-t border-[var(--border-hairline)]">
                    <Link
                      href="/status"
                      onClick={() => setPopoverOpen(false)}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-primary)] hover:border-[var(--studio-mint)]"
                    >
                      <Activity className="h-3.5 w-3.5 text-[var(--studio-mint)]" />
                      Open System Status &amp; Contract Diagnostics
                    </Link>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {supabaseConfigured && userEmail ? (
            <div className="flex items-center gap-1.5">
              {onOpenHistory && (
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={onOpenHistory}
                  className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
                >
                  <History className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                  <span className="hidden sm:inline">Saved Mixes</span>
                  <span className="rounded-md bg-[var(--studio-mint-soft)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--studio-mint)] tabular-telemetry">
                    {savedCount}
                  </span>
                </motion.button>
              )}
              <div
                title={userEmail}
                className="hidden items-center gap-1.5 bg-[var(--bg-inset)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hairline-border squircle-inner md:inline-flex"
              >
                <User className="h-3 w-3 text-[var(--studio-mint)]" aria-hidden="true" />
                <span className="max-w-[120px] truncate">{userEmail}</span>
              </div>
              {onSignOut && (
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={onSignOut}
                  aria-label="Sign out"
                  title="Sign out"
                  className="inline-flex min-h-[32px] shrink-0 items-center gap-1 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hairline-border squircle-inner cursor-pointer transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden lg:inline">Sign Out</span>
                </motion.button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {onOpenSignedOutHistory && (
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={onOpenSignedOutHistory}
                  title="Sign in to unlock Cloud Mix History & Audio Proxy playback"
                  className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
                >
                  <History className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                  <span className="hidden sm:inline">History</span>
                </motion.button>
              )}
              {supabaseConfigured && onOpenAuth && (
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={onOpenAuth}
                  className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
                >
                  <LogIn className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                  <span>Sign In</span>
                </motion.button>
              )}
            </div>
          )}

          {report && (
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={onClearSession}
              className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--studio-vermilion)] hairline-border hover:border-[var(--studio-vermilion)]/40 squircle-inner cursor-pointer transition-colors"
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

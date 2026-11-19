"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  History,
  Link2,
  LogIn,
  LogOut,
  Moon,
  Printer,
  RefreshCw,
  Share2,
  Sliders,
  Sun,
  Trash2,
  User,
} from "lucide-react";
import { deriveAutoFixEqBands } from "@/components/FindingCard";
import { API_BASE_URL } from "@/lib/api";
import { STUDIO_EASE, STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import { getCurrentStudioTheme, toggleStudioTheme } from "@/lib/theme";
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
  const [exportOpen, setExportOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsDarkTheme(getCurrentStudioTheme() === "dark");
  }, []);

  const handleToggleTheme = () => {
    const next = toggleStudioTheme();
    setIsDarkTheme(next === "dark");
  };

  useEffect(() => {
    if (!popoverOpen && !exportOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverOpen && popoverRef.current && !popoverRef.current.contains(target)) {
        setPopoverOpen(false);
      }
      if (exportOpen && exportRef.current && !exportRef.current.contains(target)) {
        setExportOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPopoverOpen(false);
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [popoverOpen, exportOpen]);

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
    setExportOpen(false);
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
    setExportOpen(false);
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
    setExportOpen(false);
    if (typeof window !== "undefined") {
      window.print();
    }
  };

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
      ? "DSP Online"
      : healthStatus === "waking"
        ? "Waking…"
        : healthStatus === "offline"
          ? "Offline"
          : "Checking";

  const configuredHealthEndpoint = `${API_BASE_URL || ""}/health`;

  return (
    <header
      data-testid="studio-header"
      className="sticky top-0 z-40 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]/92 backdrop-blur-md print:border-0 print:bg-white"
    >
      {/* Strictly single-row h-16 on desktop (>= 1024px) to prevent sticky tab bar clipping */}
      <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6 lg:h-16 lg:flex-nowrap lg:gap-3 lg:py-0">
        {/* Left: Brand Identity */}
        <Link
          href="/"
          title="Return to MixBench Overview"
          className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-2"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--studio-mint)] text-[#090B0E] squircle-inner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 12h2.5l2-6 3 12 2.5-9 2 3H20"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold tracking-[-0.02em] text-[var(--text-primary)] sm:text-base">
              MixBench
            </span>
            <span className="hidden rounded-md bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)] hairline-border xl:inline-flex">
              Studio
            </span>
          </div>
        </Link>

        {/* Center: Simple <-> Advanced Mode Switcher (zero trailing-character clipping) */}
        <nav
          aria-label="Workspace mode"
          className="no-print relative inline-flex shrink-0 flex-nowrap items-center gap-1 rounded-[12px] bg-[var(--bg-inset)] p-1 hairline-border"
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
                className={`relative z-10 inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors duration-150 sm:px-3.5 sm:text-[13px] cursor-pointer ${
                  active
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                aria-pressed={active}
              >
                {active && (
                  <motion.span
                    layoutId="workspace-mode-pill"
                    transition={STUDIO_SPRING}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-[8px] bg-[var(--bg-elevated)] hairline-border"
                  />
                )}
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.shortLabel}</span>
              </motion.button>
            );
          })}
        </nav>

        {/* Right: Single-Row Action Cluster */}
        <div className="no-print flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Active File Telemetry Badge (2XL only so 1024-1440px stays spacious single-row) */}
          {report && (
            <div className="hidden items-center gap-2 bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs hairline-border squircle-inner 2xl:flex">
              <span className="max-w-[130px] truncate font-medium text-[var(--text-primary)]">
                {report.audio_metadata.filename}
              </span>
              <span className="text-[var(--text-muted)] tabular-telemetry text-[11px] whitespace-nowrap">
                {(report.audio_metadata.sample_rate_hz / 1000).toFixed(1)} kHz ·{" "}
                {formatTimecode(report.audio_metadata.duration_sec)}
              </span>
            </div>
          )}

          {/* Consolidated Export / Share Dropdown Menu */}
          {report && (
            <div ref={exportRef} className="relative">
              <motion.button
                type="button"
                data-testid="header-export-menu-btn"
                whileTap={TACTILE_TAP}
                onClick={() => {
                  setPopoverOpen(false);
                  setExportOpen((prev) => !prev);
                }}
                aria-expanded={exportOpen}
                aria-haspopup="menu"
                aria-label="Export or share studio report"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
              >
                {shareCopied ? (
                  <Check className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                ) : (
                  <Share2 className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">{shareCopied ? "Link Copied" : "Export / Share"}</span>
                <ChevronDown
                  className={`h-3 w-3 text-[var(--text-muted)] transition-transform duration-150 ${
                    exportOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </motion.button>

              <AnimatePresence>
                {exportOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ duration: 0.16, ease: STUDIO_EASE }}
                    role="menu"
                    aria-label="Export and share options"
                    style={{ transformOrigin: "top right" }}
                    className="absolute right-0 mt-2 w-56 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl z-50"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Download EQ Preset"
                      onClick={handleExportEqPreset}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-inset)] cursor-pointer transition-colors"
                    >
                      <Sliders className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                      <div>
                        <div>EQ Preset (JSON)</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Parametric bands &amp; sub mono-maker
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Export JSON report"
                      onClick={handleExportJson}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-inset)] cursor-pointer transition-colors"
                    >
                      <Download className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                      <div>
                        <div>Export Report JSON</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Full deterministic v1.0 telemetry
                        </div>
                      </div>
                    </button>

                    {onShareReviewLink && (
                      <button
                        type="button"
                        role="menuitem"
                        aria-label="Share Review Link"
                        disabled={isSharing}
                        onClick={() => void handleShareClick()}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-inset)] cursor-pointer transition-colors disabled:opacity-50"
                      >
                        {shareCopied ? (
                          <Check className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                        ) : (
                          <Link2 className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                        )}
                        <div>
                          <div>{shareCopied ? "Review Link Copied" : "Share Client Link"}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            Read-only verification snapshot
                          </div>
                        </div>
                      </button>
                    )}

                    <div className="my-1 border-t border-[var(--border-hairline)]" />

                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Print PDF report"
                      onClick={handlePrintPdf}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-inset)] cursor-pointer transition-colors"
                    >
                      <Printer className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                      <div>
                        <div>Print Studio PDF</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Clean client session sheet
                        </div>
                      </div>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Live Backend Health Status Pill + Diagnostic Popover */}
          <div ref={popoverRef} className="relative">
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={() => {
                setExportOpen(false);
                setPopoverOpen((prev) => !prev);
              }}
              aria-expanded={popoverOpen}
              aria-label={statusText}
              title={`${statusText} (${configuredHealthEndpoint})`}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-xs font-medium squircle-inner cursor-pointer transition-colors ${
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
                className={`h-2 w-2 shrink-0 rounded-full ${
                  healthStatus === "online"
                    ? "bg-[var(--studio-mint)]"
                    : healthStatus === "waking"
                      ? "bg-[var(--studio-amber)] animate-pulse"
                      : healthStatus === "offline"
                        ? "bg-[var(--studio-vermilion)]"
                        : "bg-[var(--text-muted)] animate-pulse"
                }`}
              />
              <span className="hidden xl:inline">{statusText}</span>
              <span className="xl:hidden">{compactStatusText}</span>
            </motion.button>

            <AnimatePresence>
              {popoverOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: STUDIO_EASE }}
                  role="dialog"
                  aria-label="DSP backend connection diagnostics"
                  style={{ transformOrigin: "top right" }}
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
                        Cold-starting DSP container (
                        {wakeAttempt > 0 ? `retry ${wakeAttempt}/${wakeMaxAttempts}` : "connecting…"}).
                      </p>
                      <p>
                        Retrying <code className="text-[var(--text-primary)]">/health</code> automatically
                        every 5 seconds while local Web Audio DSP preview handles instant uploads.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 text-[11px] text-[var(--text-secondary)]">
                      <p className="text-[var(--studio-vermilion)] font-medium">
                        {healthError || "Could not establish HTTP connection to DSP backend."}
                      </p>
                      <p>
                        Uploads automatically fall back to deterministic Browser Web Audio DSP Preview
                        until the server reconnects.
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

          {/* Dark Studio / Warm Daylight Theme Toggle */}
          <motion.button
            type="button"
            data-testid="theme-toggle"
            whileTap={TACTILE_TAP}
            onClick={handleToggleTheme}
            aria-label="Toggle studio theme"
            title={isDarkTheme ? "Switch to Daylight Studio Light" : "Switch to Carbon Studio Dark"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
          >
            {isDarkTheme ? (
              <Sun className="h-3.5 w-3.5 text-[var(--studio-amber)]" aria-hidden="true" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-[var(--studio-cobalt)]" aria-hidden="true" />
            )}
          </motion.button>

          {/* Saved History & Auth Actions */}
          {supabaseConfigured && userEmail ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {onOpenHistory && (
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={onOpenHistory}
                  title="Open Saved Mix History"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
                >
                  <History className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                  <span className="hidden xl:inline">History</span>
                  <span className="rounded bg-[var(--studio-mint-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--studio-mint)] tabular-telemetry">
                    {savedCount}
                  </span>
                </motion.button>
              )}
              <div
                title={userEmail}
                className="hidden h-8 items-center gap-1.5 bg-[var(--bg-inset)] px-2.5 text-xs text-[var(--text-secondary)] hairline-border squircle-inner 2xl:inline-flex"
              >
                <User className="h-3 w-3 text-[var(--studio-mint)]" aria-hidden="true" />
                <span className="max-w-[110px] truncate">{userEmail}</span>
              </div>
              {onSignOut && (
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={onSignOut}
                  aria-label="Sign out"
                  title="Sign out and return to overview"
                  className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hairline-border squircle-inner cursor-pointer transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden xl:inline">Sign Out</span>
                </motion.button>
              )}
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5">
              {onOpenSignedOutHistory && (
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={onOpenSignedOutHistory}
                  title="Sign in to unlock Cloud Mix History & Audio Proxy playback"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
                >
                  <History className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                  <span className="hidden xl:inline">History</span>
                </motion.button>
              )}
              {supabaseConfigured && onOpenAuth && (
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={onOpenAuth}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)] hairline-border squircle-inner cursor-pointer transition-colors"
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
              aria-label="Clear Session"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--studio-vermilion)] hairline-border hover:border-[var(--studio-vermilion)]/40 squircle-inner cursor-pointer transition-colors"
              title="Delete ephemeral audio session immediately"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden xl:inline">Clear</span>
            </motion.button>
          )}
        </div>
      </div>
    </header>
  );
}

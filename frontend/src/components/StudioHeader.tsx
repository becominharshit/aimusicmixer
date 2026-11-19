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
import { MixitLogo } from "@/components/brand/MixitLogo";
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
    link.download = `Mixit_${safeName || "session"}_${report.report_id}.json`;
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
      schema: "mixit.daw_eq_preset.v1",
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
    link.download = `Mixit_EQ_Preset_${safeName || "session"}.json`;
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
      className="sticky top-0 z-40 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] print:border-0 print:bg-white"
    >
      {/* Strictly single-row h-16 on desktop (>= 1024px) to prevent sticky tab bar clipping */}
      <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6 lg:h-16 lg:flex-nowrap lg:gap-3 lg:py-0">
        {/* Left: Official Mixit Brand Identity (Full Lockup Desktop / Mark Mobile) */}
        <Link
          href="/"
          title="Return to Mixit Overview"
          aria-label="Mixit Studio Home"
          className="flex shrink-0 items-center gap-2.5"
        >
          <span className="hidden sm:inline-flex">
            <MixitLogo variant="full" tone="auto" heightClass="h-7" />
          </span>
          <span className="inline-flex sm:hidden">
            <MixitLogo variant="mark" heightClass="h-8" />
          </span>
          <span className="hidden border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-1.5 py-0.5 tabular-telemetry text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] xl:inline-flex">
            CONSOLE
          </span>
        </Link>

        {/* Center: Simple <-> Advanced Mode Switcher (zero trailing-character clipping) */}
        <nav
          aria-label="Workspace mode"
          className="no-print relative inline-flex shrink-0 flex-nowrap items-center gap-0.5 border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5"
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
                className={`relative z-10 inline-flex shrink-0 items-center justify-center whitespace-nowrap px-3 py-1.5 text-xs font-bold transition-colors duration-150 sm:px-3.5 sm:text-[13px] cursor-pointer ${
                  active
                    ? "text-[#0A0A0A]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                aria-pressed={active}
              >
                {active && (
                  <motion.span
                    layoutId="workspace-mode-pill"
                    transition={STUDIO_SPRING}
                    className="pointer-events-none absolute inset-0 -z-10 bg-[#FFE01B]"
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
            <div className="hidden items-center gap-2 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs 2xl:flex">
              <span className="max-w-[125px] truncate font-semibold text-[var(--text-primary)]">
                {report.audio_metadata.filename}
              </span>
              <span className="whitespace-nowrap tabular-telemetry text-[11px] text-[var(--text-muted)]">
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
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--border-active)] cursor-pointer"
              >
                {shareCopied ? (
                  <Check className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                ) : (
                  <Share2 className="h-3.5 w-3.5 text-[#FFE01B] dark:text-[#FFE01B]" aria-hidden="true" />
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
                    className="absolute right-0 z-50 mt-2 w-56 border-[1.5px] border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Download EQ Preset"
                      onClick={handleExportEqPreset}
                      className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-inset)] cursor-pointer"
                    >
                      <Sliders className="h-3.5 w-3.5 text-[#FFE01B]" aria-hidden="true" />
                      <div>
                        <div>EQ Preset (JSON)</div>
                        <div className="text-[10px] font-normal text-[var(--text-muted)]">
                          Parametric bands &amp; sub mono-maker
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Export JSON report"
                      onClick={handleExportJson}
                      className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-inset)] cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                      <div>
                        <div>Export Report JSON</div>
                        <div className="text-[10px] font-normal text-[var(--text-muted)]">
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
                        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-inset)] disabled:opacity-50 cursor-pointer"
                      >
                        {shareCopied ? (
                          <Check className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                        ) : (
                          <Link2 className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                        )}
                        <div>
                          <div>{shareCopied ? "Review Link Copied" : "Share Client Link"}</div>
                          <div className="text-[10px] font-normal text-[var(--text-muted)]">
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
                      className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-inset)] cursor-pointer"
                    >
                      <Printer className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                      <div>
                        <div>Print Studio PDF</div>
                        <div className="text-[10px] font-normal text-[var(--text-muted)]">
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
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border px-2.5 text-xs font-semibold cursor-pointer transition-colors ${
                healthStatus === "online"
                  ? "border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--border-active)]"
                  : healthStatus === "waking"
                    ? "border-[var(--studio-amber)] bg-[var(--studio-amber-soft)] text-[var(--studio-amber)]"
                    : healthStatus === "offline"
                      ? "border-[var(--studio-vermilion)] bg-[var(--studio-vermilion-soft)] text-[var(--studio-vermilion)]"
                      : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)]"
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
                  className="fixed left-3 right-3 z-50 mt-2 space-y-3 border-[1.5px] border-[var(--border-strong)] bg-[var(--bg-elevated)] p-4 text-xs sm:absolute sm:left-auto sm:right-0 sm:w-80"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-bold text-[var(--text-primary)]">
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
                      className="inline-flex items-center gap-1 border border-[#0A0A0A] bg-[#FFE01B] px-2 py-1 text-[11px] font-bold text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-[#FFE01B] cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                      Retry
                    </button>
                  </div>

                  <div className="space-y-1.5 border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-2.5">
                    <div className="text-[11px] text-[var(--text-muted)]">Configured API Endpoint</div>
                    <div className="break-all font-mono text-[11px] text-[var(--text-primary)]">
                      {configuredHealthEndpoint}
                    </div>
                  </div>

                  {healthStatus === "online" && healthData ? (
                    <div className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                      <div className="flex justify-between">
                        <span>FFmpeg / ffprobe</span>
                        <span className="font-semibold text-[var(--studio-mint)]">
                          {healthData.ffmpeg_available ? "Available" : "Missing"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Gemini Mentor Model</span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {healthData.gemini_configured
                            ? `Configured (${healthData.gemini_model || "gemini-4-hydrogen"})`
                            : `Offline Fallback (${healthData.gemini_model || "gemini-4-hydrogen"})`}
                        </span>
                      </div>
                    </div>
                  ) : healthStatus === "waking" ? (
                    <div className="space-y-1.5 text-[11px] text-[var(--text-secondary)]">
                      <p className="font-semibold text-[var(--studio-amber)]">
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
                      <p className="font-semibold text-[var(--studio-vermilion)]">
                        {healthError || "Could not establish HTTP connection to DSP backend."}
                      </p>
                      <p>
                        Uploads automatically fall back to deterministic Browser Web Audio DSP Preview
                        until the server reconnects.
                      </p>
                    </div>
                  )}

                  <div className="border-t border-[var(--border-hairline)] pt-2">
                    <Link
                      href="/status"
                      onClick={() => setPopoverOpen(false)}
                      className="inline-flex w-full items-center justify-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-[11px] font-bold uppercase text-[var(--text-primary)] hover:border-[var(--border-active)]"
                    >
                      <Activity className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                      Open System Status &amp; Contract Diagnostics
                    </Link>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 1-Click PAPER / INK Console Theme Toggle */}
          <motion.button
            type="button"
            data-testid="theme-toggle"
            whileTap={TACTILE_TAP}
            onClick={handleToggleTheme}
            aria-label={isDarkTheme ? "Switch to PAPER Swiss light mode" : "Switch to INK Obsidian dark mode"}
            title={isDarkTheme ? "Switch to PAPER (Swiss White)" : "Switch to INK (Obsidian Console)"}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 tabular-telemetry text-[11px] font-bold uppercase text-[var(--text-primary)] transition-colors hover:border-[var(--border-active)] cursor-pointer"
          >
            {isDarkTheme ? (
              <>
                <Sun className="h-3.5 w-3.5 text-[#FFE01B]" aria-hidden="true" />
                <span className="hidden md:inline">PAPER</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 text-[#0A0A0A]" aria-hidden="true" />
                <span className="hidden md:inline">INK</span>
              </>
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
                  aria-label={`Open saved mix history (${savedCount} saved)`}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-active)] cursor-pointer"
                >
                  <History className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                  <span className="hidden xl:inline">History</span>
                  <span className="bg-[#FFE01B] px-1.5 py-0.5 tabular-telemetry text-[10px] font-bold text-[#0A0A0A]">
                    {savedCount}
                  </span>
                </motion.button>
              )}
              <div
                title={userEmail}
                className="hidden h-8 items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 text-xs text-[var(--text-secondary)] 2xl:inline-flex"
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
                  className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--text-primary)] cursor-pointer"
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
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--text-primary)] cursor-pointer"
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
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border border-[#0A0A0A] bg-[#FFE01B] px-2.5 text-xs font-bold text-[#0A0A0A] transition-colors hover:bg-[#0A0A0A] hover:text-[#FFE01B] cursor-pointer"
                >
                  <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
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
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[#FF3B1F] hover:bg-[#FF3B1F] hover:text-[#0A0A0A] cursor-pointer"
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

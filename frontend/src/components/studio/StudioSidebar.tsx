"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  Download,
  HelpCircle,
  History,
  ImageDown,
  Link2,
  LogIn,
  LogOut,
  Moon,
  Printer,
  RefreshCw,
  Share2,
  Sliders,
  SlidersHorizontal,
  Sun,
  Trash2,
  User,
  Waves,
  X,
} from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";
import { deriveAutoFixEqBands } from "@/components/FindingCard";
import type { HealthStatus } from "@/components/StudioHeader";
import { API_BASE_URL } from "@/lib/api";
import { STUDIO_EASE, STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import { downloadScorecardPng } from "@/lib/scorecardPng";
import { getCurrentStudioTheme, toggleStudioTheme } from "@/lib/theme";
import type { AnalysisReport, BackendHealth } from "@/types/report";

export interface StudioSidebarProps {
  expanded: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
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
  onOpenShortcuts?: () => void;
}

export function StudioSidebar({
  expanded,
  mobileOpen,
  onCloseMobile,
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
  onOpenShortcuts,
}: StudioSidebarProps) {
  const prefersReducedMotion = useReducedMotion();
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
    if (!popoverOpen && !exportOpen && !mobileOpen) return;
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
        onCloseMobile();
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [popoverOpen, exportOpen, mobileOpen, onCloseMobile]);

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
    onCloseMobile();
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
    onCloseMobile();
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
    onCloseMobile();
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

  const shortStatus =
    healthStatus === "online"
      ? "DSP Online"
      : healthStatus === "waking"
        ? "Waking…"
        : healthStatus === "offline"
          ? "DSP Offline"
          : "Checking…";

  const configuredHealthEndpoint = `${API_BASE_URL || ""}/health`;
  const userInitial = (userEmail || "S").charAt(0).toUpperCase();

  const renderRailContent = (isExpanded: boolean, isMobile: boolean) => {
    const itemBase = `group relative flex h-10 w-full items-center gap-2.5 rounded-[4px] px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
      isExpanded ? "justify-start" : "justify-center"
    }`;

    return (
      <div className="flex h-full flex-col justify-between py-3">
        {/* Top + Middle Navigation Stack */}
        <div className="space-y-4 px-2">
          {isMobile && (
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] pb-3 px-1">
              <Link href="/" onClick={onCloseMobile} aria-label="Mixit Home">
                <MixitLogo variant="full" tone="auto" heightClass="h-6" />
              </Link>
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close studio navigation"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Primary Workspaces */}
          <nav aria-label="Primary studio workspaces" className="space-y-1">
            {isExpanded && (
              <div className="px-2 pb-1 tabular-telemetry text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Workspaces
              </div>
            )}
            <Link
              href="/studio"
              aria-current="page"
              title="Mix Console (/studio)"
              onClick={onCloseMobile}
              className={`${itemBase} bg-[var(--studio-yellow-soft)] text-[var(--text-primary)] border border-[var(--border-active)]`}
            >
              <SlidersHorizontal
                className="h-4 w-4 shrink-0 text-[var(--studio-yellow)]"
                aria-hidden="true"
              />
              {isExpanded && <span className="truncate font-bold">Console</span>}
            </Link>

            <Link
              href="/daw"
              data-testid={isMobile ? "mobile-web-daw-link" : "header-web-daw-link"}
              title="Web DAW (/daw)"
              onClick={onCloseMobile}
              className={`${itemBase} border border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]`}
            >
              <Waves className="h-4 w-4 shrink-0 text-[var(--studio-sky)]" aria-hidden="true" />
              {isExpanded && <span className="truncate">Web DAW</span>}
            </Link>
          </nav>

          {/* Session Utilities */}
          <div className="space-y-1 border-t border-[var(--border-hairline)] pt-3">
            {isExpanded && (
              <div className="px-2 pb-1 tabular-telemetry text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Session
              </div>
            )}

            {/* Saved History */}
            {(supabaseConfigured && userEmail && onOpenHistory) || onOpenSignedOutHistory ? (
              <motion.button
                type="button"
                whileTap={TACTILE_TAP}
                onClick={() => {
                  onCloseMobile();
                  if (supabaseConfigured && userEmail && onOpenHistory) {
                    onOpenHistory();
                  } else {
                    onOpenSignedOutHistory?.();
                  }
                }}
                title={`Saved Mix History (${savedCount} saved)`}
                aria-label={
                  supabaseConfigured && userEmail
                    ? `Open saved mix history (${savedCount} saved)`
                    : "Sign in to open saved mix history"
                }
                className={`${itemBase} border border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]`}
              >
                <span className="relative flex shrink-0 items-center justify-center">
                  <History className="h-4 w-4 text-[var(--studio-mint)]" aria-hidden="true" />
                  {!isExpanded && supabaseConfigured && userEmail && savedCount > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#F0B44C] px-1 tabular-telemetry text-[9px] font-extrabold text-[#111318]">
                      {savedCount}
                    </span>
                  )}
                </span>
                {isExpanded && (
                  <span className="flex flex-1 items-center justify-between gap-2 truncate">
                    <span className="truncate">Saved History</span>
                    {supabaseConfigured && userEmail && (
                      <span className="rounded-[3px] bg-[#F0B44C] px-1.5 py-0.5 tabular-telemetry text-[10px] font-extrabold text-[#111318]">
                        {savedCount}
                      </span>
                    )}
                  </span>
                )}
              </motion.button>
            ) : null}

            {/* Export / Share Dropdown */}
            {report && (
              <div ref={!isMobile ? exportRef : undefined} className="relative">
                <motion.button
                  type="button"
                  data-testid={isMobile ? "mobile-export-menu-btn" : "header-export-menu-btn"}
                  whileTap={TACTILE_TAP}
                  onClick={() => {
                    setPopoverOpen(false);
                    setExportOpen((prev) => !prev);
                  }}
                  aria-expanded={exportOpen}
                  aria-haspopup="menu"
                  aria-label="Export or share studio report"
                  title="Export / Share Report"
                  className={`${itemBase} border ${
                    exportOpen
                      ? "border-[var(--border-active)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                      : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {shareCopied ? (
                    <Check className="h-4 w-4 shrink-0 text-[var(--studio-mint)]" aria-hidden="true" />
                  ) : (
                    <Share2 className="h-4 w-4 shrink-0 text-[var(--studio-yellow)]" aria-hidden="true" />
                  )}
                  {isExpanded && (
                    <span className="truncate">
                      {shareCopied ? "Link Copied" : "Export / Share"}
                    </span>
                  )}
                </motion.button>

                <AnimatePresence>
                  {exportOpen && (
                    <motion.div
                      initial={{ opacity: 0, x: -6, scale: 0.97 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -4, scale: 0.97 }}
                      transition={{ duration: 0.16, ease: STUDIO_EASE }}
                      role="menu"
                      aria-label="Export and share options"
                      style={{ transformOrigin: "top left" }}
                      className={
                        isMobile
                          ? "mt-1.5 w-full space-y-1 border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5"
                          : "absolute left-full top-0 z-50 ml-2 w-60 rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl"
                      }
                    >
                      <button
                        type="button"
                        role="menuitem"
                        aria-label="Download EQ Preset"
                        onClick={handleExportEqPreset}
                        className="flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-inset)] cursor-pointer"
                      >
                        <Sliders className="h-3.5 w-3.5 text-[var(--studio-yellow)]" aria-hidden="true" />
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
                        className="flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-inset)] cursor-pointer"
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
                          className="flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-inset)] disabled:opacity-50 cursor-pointer"
                        >
                          {shareCopied ? (
                            <Check className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                          ) : (
                            <Link2 className="h-3.5 w-3.5 text-[var(--studio-sky)]" aria-hidden="true" />
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
                        aria-label="Export Scorecard PNG"
                        onClick={() => {
                          setExportOpen(false);
                          onCloseMobile();
                          if (report) void downloadScorecardPng(report);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-inset)] cursor-pointer"
                      >
                        <ImageDown className="h-3.5 w-3.5 text-[var(--studio-orchid)]" aria-hidden="true" />
                        <div>
                          <div>Export Scorecard PNG</div>
                          <div className="text-[10px] font-normal text-[var(--text-muted)]">
                            1200×630 shareable proof card
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        aria-label="Print PDF report"
                        onClick={handlePrintPdf}
                        className="flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-inset)] cursor-pointer"
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

            {/* System Status Diagnostics Popover */}
            <div ref={!isMobile ? popoverRef : undefined} className="relative">
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
                className={`${itemBase} border ${
                  popoverOpen
                    ? "border-[var(--border-active)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                  <Activity className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
                  <span
                    aria-hidden="true"
                    className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-[var(--bg-surface)] ${
                      healthStatus === "online"
                        ? "bg-[var(--studio-mint)]"
                        : healthStatus === "waking"
                          ? "bg-[var(--studio-yellow)] animate-pulse"
                          : healthStatus === "offline"
                            ? "bg-[var(--studio-vermilion)]"
                            : "bg-[var(--text-muted)] animate-pulse"
                    }`}
                  />
                </span>
                {isExpanded && (
                  <span className="flex flex-1 items-center justify-between gap-2 whitespace-nowrap">
                    <span data-testid="sidebar-system-status-label" className="whitespace-nowrap">
                      System Status
                    </span>
                    <span
                      className={`tabular-telemetry shrink-0 text-[10px] font-bold ${
                        healthStatus === "online"
                          ? "text-[var(--studio-mint)]"
                          : healthStatus === "waking"
                            ? "text-[var(--studio-yellow)]"
                            : healthStatus === "offline"
                              ? "text-[var(--studio-vermilion)]"
                              : "text-[var(--text-muted)]"
                      }`}
                    >
                      {shortStatus}
                    </span>
                  </span>
                )}
              </motion.button>

              <AnimatePresence>
                {popoverOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: -6, scale: 0.97 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -4, scale: 0.97 }}
                    transition={{ duration: 0.16, ease: STUDIO_EASE }}
                    role="dialog"
                    aria-label="DSP backend connection diagnostics"
                    style={{ transformOrigin: "top left" }}
                    className={
                      isMobile
                        ? "mt-1.5 w-full space-y-3 rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3.5 text-xs"
                        : "absolute left-full top-0 z-50 ml-2 w-80 space-y-3 rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-4 text-xs shadow-2xl"
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-bold text-[var(--text-primary)]">
                        {healthStatus === "online" ? (
                          <CheckCircle2 className="h-4 w-4 text-[var(--studio-mint)]" aria-hidden="true" />
                        ) : healthStatus === "waking" ? (
                          <RefreshCw className="h-4 w-4 text-[var(--studio-yellow)] animate-spin" aria-hidden="true" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-[var(--studio-vermilion)]" aria-hidden="true" />
                        )}
                        DSP Engine Diagnostics
                      </span>
                      <button
                        type="button"
                        onClick={onRetryHealth}
                        className="inline-flex items-center gap-1 rounded-[4px] border border-[#14171F] bg-[#F0B44C] px-2 py-1 text-[11px] font-bold text-[#111318] hover:bg-[#F5C451] cursor-pointer"
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden="true" />
                        Retry
                      </button>
                    </div>

                    <div className="space-y-1.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-2.5">
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
                          <span>AI Suggestions Engine</span>
                          <span className="font-semibold text-[var(--text-primary)]">
                            {healthData.gemini_configured
                              ? "Live Cloud Ready"
                              : "Offline Deterministic"}
                          </span>
                        </div>
                      </div>
                    ) : healthStatus === "waking" ? (
                      <div className="space-y-1.5 text-[11px] text-[var(--text-secondary)]">
                        <p className="font-semibold text-[var(--studio-yellow)]">
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
                        onClick={() => {
                          setPopoverOpen(false);
                          onCloseMobile();
                        }}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-[11px] font-bold uppercase text-[var(--text-primary)] hover:border-[var(--border-active)]"
                      >
                        <Activity className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                        Open System Status
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Preferences & Account */}
          <div className="space-y-1 border-t border-[var(--border-hairline)] pt-3">
            {isExpanded && (
              <div className="px-2 pb-1 tabular-telemetry text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Studio
              </div>
            )}

            {/* Theme Toggle (Ink Dark / Paper Light) */}
            <motion.button
              type="button"
              data-testid={isMobile ? "mobile-theme-toggle" : "theme-toggle"}
              whileTap={TACTILE_TAP}
              onClick={handleToggleTheme}
              aria-label={isDarkTheme ? "Switch to PAPER light mode" : "Switch to INK dark mode"}
              title={isDarkTheme ? "Switch to Paper Light" : "Switch to Ink Dark"}
              className={`${itemBase} border border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]`}
            >
              {isDarkTheme ? (
                <Sun className="h-4 w-4 shrink-0 text-[#F0B44C]" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4 shrink-0 text-[#14171F]" aria-hidden="true" />
              )}
              {isExpanded && (
                <span className="truncate">{isDarkTheme ? "Paper Light" : "Ink Dark"}</span>
              )}
            </motion.button>

            {/* Profile Link */}
            {supabaseConfigured && userEmail && (
              <Link
                href="/profile"
                data-testid={isMobile ? "mobile-profile-link" : "header-profile-link"}
                title={`Studio Profile (${userEmail})`}
                aria-label={`Open Studio Profile for ${userEmail}`}
                onClick={onCloseMobile}
                className={`${itemBase} border border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[#F0B44C] tabular-telemetry text-[11px] font-extrabold text-[#111318]">
                  {userInitial}
                </span>
                {isExpanded && (
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-bold text-[var(--text-primary)]">
                      Profile
                    </span>
                    <span className="truncate text-[10px] text-[var(--text-muted)]">
                      {userEmail}
                    </span>
                  </span>
                )}
              </Link>
            )}
          </div>
        </div>

        {/* Bottom-Pinned Controls: Shortcuts (?), Clear Session, Sign Out / Sign In */}
        <div className="space-y-1 border-t border-[var(--border-hairline)] px-2 pt-3">
          {onOpenShortcuts && (
            <motion.button
              type="button"
              data-testid={isMobile ? "mobile-shortcuts-help-btn" : "shortcuts-help-btn"}
              whileTap={TACTILE_TAP}
              onClick={() => {
                onCloseMobile();
                onOpenShortcuts();
              }}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className={`${itemBase} border border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]`}
            >
              <HelpCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {isExpanded && (
                <span className="flex flex-1 items-center justify-between">
                  <span>Shortcuts</span>
                  <kbd className="rounded-[3px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-1.5 py-0.5 tabular-telemetry text-[10px] text-[var(--text-muted)]">
                    ?
                  </kbd>
                </span>
              )}
            </motion.button>
          )}

          {report && (
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={() => {
                onCloseMobile();
                onClearSession();
              }}
              aria-label="Clear Session"
              title="Clear current audio session"
              className={`${itemBase} border border-transparent text-[var(--text-secondary)] hover:border-[var(--studio-vermilion)]/50 hover:bg-[var(--studio-vermilion-soft)] hover:text-[var(--studio-vermilion)]`}
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              {isExpanded && <span className="truncate">Clear Session</span>}
            </motion.button>
          )}

          {supabaseConfigured && userEmail && onSignOut ? (
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={() => {
                onCloseMobile();
                onSignOut();
              }}
              aria-label="Sign out"
              title="Sign out and return to overview"
              className={`${itemBase} border border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]`}
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
              {isExpanded && <span className="truncate">Sign Out</span>}
            </motion.button>
          ) : supabaseConfigured && onOpenAuth ? (
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={() => {
                onCloseMobile();
                onOpenAuth();
              }}
              aria-label="Sign In"
              title="Sign In"
              className={`${itemBase} bg-[#F0B44C] text-[#111318] font-bold hover:bg-[#F5C451]`}
            >
              <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />
              {isExpanded && <span className="truncate">Sign In</span>}
            </motion.button>
          ) : (
            <Link
              href="/profile"
              title="Account Profile"
              onClick={onCloseMobile}
              className={`${itemBase} border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]`}
            >
              <User className="h-4 w-4 shrink-0" aria-hidden="true" />
              {isExpanded && <span className="truncate">Profile</span>}
            </Link>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Collapsible Left Icon Rail (64px <-> 264px) */}
      <motion.aside
        data-testid="studio-sidebar"
        data-expanded={expanded ? "true" : "false"}
        aria-label="Studio navigation sidebar"
        initial={false}
        animate={{ width: expanded ? 264 : 64 }}
        transition={prefersReducedMotion ? { duration: 0 } : STUDIO_SPRING}
        className="no-print sticky top-0 z-40 hidden h-screen shrink-0 flex-col border-r border-[var(--border-hairline)] bg-[var(--bg-surface)] md:flex"
      >
        {renderRailContent(expanded, false)}
      </motion.aside>

      {/* Mobile Slide-Over Drawer (< 768px) */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="sidebar-mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: STUDIO_EASE }}
              onClick={onCloseMobile}
              className="no-print fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] md:hidden"
            />
            <motion.aside
              key="sidebar-mobile-drawer"
              data-testid="studio-sidebar-mobile"
              role="dialog"
              aria-modal="true"
              aria-label="Studio navigation drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={prefersReducedMotion ? { duration: 0 } : STUDIO_SPRING}
              className="no-print fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-2xl md:hidden"
            >
              {renderRailContent(true, true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

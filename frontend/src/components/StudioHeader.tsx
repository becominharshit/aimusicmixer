"use client";

import React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  LogIn,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
} from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";
import { STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import { formatTimecode } from "@/lib/utils";
import type { AnalysisReport } from "@/types/report";

export type WorkspaceMode = "simple" | "advanced";
export type HealthStatus = "checking" | "waking" | "online" | "offline";

export interface StudioHeaderProps {
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  report: AnalysisReport | null;
  sidebarExpanded?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileSidebar?: () => void;
  onOpenAddAudio?: () => void;
  onOpenMentor?: () => void;
  supabaseConfigured?: boolean;
  userEmail?: string | null;
  onOpenAuth?: () => void;
}

/**
 * Ultra-Clean Minimal 4-Item Studio Top Navbar:
 * 1. Left: Collapsible Sidebar Toggle + MIXIT. Logo
 * 2. Center: Active Track Pill (filename · MM:SS) + Prominent "+ Add Audio" Button
 * 3. Right: Compact Simple | Advanced Switch + AI Suggestions Drawer Button
 * Strictly single-row (h-14) — never wraps or clips on any viewport.
 */
export function StudioHeader({
  mode,
  onModeChange,
  report,
  sidebarExpanded = false,
  onToggleSidebar,
  onOpenMobileSidebar,
  onOpenAddAudio,
  onOpenMentor,
  supabaseConfigured = false,
  userEmail = null,
  onOpenAuth,
}: StudioHeaderProps) {
  return (
    <header
      data-testid="studio-header"
      className="sticky top-0 z-30 h-14 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]/95 backdrop-blur-sm print:border-0 print:bg-white"
    >
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-2 px-3 sm:gap-3 sm:px-5">
        {/* 1. Left: Sidebar Toggle + MIXIT. Brand Logo */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          {onToggleSidebar && (
            <motion.button
              type="button"
              data-testid="sidebar-toggle-btn"
              whileTap={TACTILE_TAP}
              onClick={onToggleSidebar}
              aria-expanded={sidebarExpanded}
              aria-label={sidebarExpanded ? "Collapse studio sidebar" : "Expand studio sidebar"}
              title={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
              className="no-print hidden h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--text-primary)] md:inline-flex cursor-pointer"
            >
              {sidebarExpanded ? (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              )}
            </motion.button>
          )}

          {onOpenMobileSidebar && (
            <motion.button
              type="button"
              data-testid="mobile-sidebar-toggle-btn"
              whileTap={TACTILE_TAP}
              onClick={onOpenMobileSidebar}
              aria-label="Open studio navigation"
              className="no-print inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--text-primary)] md:hidden cursor-pointer"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </motion.button>
          )}

          <Link
            href="/"
            title="Return to Mixit Overview"
            aria-label="Mixit Studio Home"
            className="flex shrink-0 items-center"
          >
            <span className="hidden sm:inline-flex">
              <MixitLogo variant="full" tone="auto" heightClass="h-6" />
            </span>
            <span className="inline-flex sm:hidden">
              <MixitLogo variant="mark" heightClass="h-7" />
            </span>
          </Link>
        </div>

        {/* 2. Center: Active Track Pill + Prominent "+ Add Audio" CTA */}
        <div className="no-print flex min-w-0 items-center gap-2">
          {report && (
            <div
              data-testid="header-active-track-pill"
              title={`${report.audio_metadata.filename} · ${formatTimecode(report.audio_metadata.duration_sec)}`}
              className="hidden min-w-0 items-center gap-2 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs md:flex"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--studio-mint)]" />
              <span className="max-w-[140px] truncate font-semibold text-[var(--text-primary)] lg:max-w-[200px]">
                {report.audio_metadata.filename}
              </span>
              <span className="shrink-0 whitespace-nowrap tabular-telemetry text-[11px] text-[var(--text-muted)]">
                · {formatTimecode(report.audio_metadata.duration_sec)}
              </span>
            </div>
          )}

          {onOpenAddAudio && (
            <motion.button
              type="button"
              data-testid="add-audio-btn"
              whileTap={TACTILE_TAP}
              onClick={onOpenAddAudio}
              aria-label="Add audio track"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] border border-[#14171F] dark:border-[#F0B44C] bg-[#F0B44C] px-2.5 text-xs font-extrabold text-[#111318] transition-colors hover:bg-[#F5C451] sm:px-3 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.75]" aria-hidden="true" />
              <span>Add Audio</span>
            </motion.button>
          )}
        </div>

        {/* 3. Right: Compact Simple | Advanced Switch + AI Suggestions Button */}
        <div className="no-print flex shrink-0 items-center gap-1.5 sm:gap-2">
          <nav
            aria-label="Workspace mode"
            className="relative inline-flex shrink-0 flex-nowrap items-center gap-0.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5"
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
                  className={`relative z-10 inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-[3px] px-2.5 text-xs font-bold transition-colors duration-150 sm:px-3 cursor-pointer ${
                    active
                      ? "text-[#111318]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                  aria-pressed={active}
                >
                  {active && (
                    <motion.span
                      layoutId="workspace-mode-pill"
                      transition={STUDIO_SPRING}
                      className="pointer-events-none absolute inset-0 -z-10 rounded-[3px] bg-[#F0B44C]"
                    />
                  )}
                  <span className="hidden lg:inline">{item.label}</span>
                  <span className="lg:hidden">{item.shortLabel}</span>
                </motion.button>
              );
            })}
          </nav>

          {report && onOpenMentor ? (
            <motion.button
              type="button"
              data-testid="header-ai-suggestions-btn"
              whileTap={TACTILE_TAP}
              onClick={onOpenMentor}
              aria-label="Open AI Suggestions"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[#F0B44C] hover:bg-[var(--bg-elevated-hover)] sm:px-3 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#F0B44C]" aria-hidden="true" />
              <span className="hidden sm:inline">AI Suggestions</span>
            </motion.button>
          ) : !userEmail && supabaseConfigured && onOpenAuth ? (
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={onOpenAuth}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[#F0B44C] cursor-pointer"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign In</span>
            </motion.button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

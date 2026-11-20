"use client";

import React from "react";
import { motion } from "motion/react";
import {
  Activity,
  GitCompare,
  Layers,
  Scale,
  Sparkles,
} from "lucide-react";
import { STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import type { AnalysisReport } from "@/types/report";

export type WorkspaceSubTab = "diagnosis" | "reference" | "stems" | "revisions";

interface WorkspaceSubNavProps {
  activeTab: WorkspaceSubTab;
  onChangeTab: (tab: WorkspaceSubTab) => void;
  report: AnalysisReport;
  hasReference: boolean;
  onOpenMentor: () => void;
}

export function WorkspaceSubNav({
  activeTab,
  onChangeTab,
  report,
  hasReference,
  onOpenMentor,
}: WorkspaceSubNavProps) {
  const tabs: {
    id: WorkspaceSubTab;
    label: string;
    badge?: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      id: "diagnosis",
      label: "Mix Diagnosis",
      badge: `${report.findings.length}`,
      icon: Activity,
    },
    {
      id: "reference",
      label: "Reference A/B",
      badge: hasReference ? "Loaded" : undefined,
      icon: Scale,
    },
    {
      id: "stems",
      label: "Original Stems",
      badge: report.context.has_user_stems ? `${report.context.stem_count} stems` : "Locked",
      icon: Layers,
    },
    {
      id: "revisions",
      label: "Revision Check (v1 → v2)",
      badge: report.revision_comparison ? "v1 → v2" : undefined,
      icon: GitCompare,
    },
  ];

  const mentorBadge = report.privacy_audit.raw_audio_sent_to_ai
    ? "Audio Opt-In"
    : report.privacy_audit.external_ai_enabled
      ? "Metrics AI"
      : "Offline Ready";

  return (
    <div className="no-print relative z-20 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)]">
      <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-2.5 px-3 py-2.5 sm:px-6">
        <nav
          role="tablist"
          aria-label="Mixit workflow sections"
          data-testid="workspace-subnav"
          className="relative inline-flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5 lg:overflow-visible"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <motion.button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                whileTap={TACTILE_TAP}
                onClick={() => onChangeTab(tab.id)}
                className={`relative z-10 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 text-xs font-bold cursor-pointer transition-colors ${
                  active
                    ? "text-[#0A0A0A]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="workspace-subnav-pill"
                    transition={STUDIO_SPRING}
                    className="pointer-events-none absolute inset-0 -z-10 bg-[#FFE01B]"
                  />
                )}
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${
                    active ? "text-[#0A0A0A]" : "text-[var(--studio-mint)]"
                  }`}
                  aria-hidden="true"
                />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`shrink-0 px-1.5 py-0.5 tabular-telemetry text-[10px] font-bold ${
                      active
                        ? "bg-[#0A0A0A] text-[#FFE01B]"
                        : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </motion.button>
            );
          })}
        </nav>

        <motion.button
          type="button"
          whileTap={TACTILE_TAP}
          onClick={onOpenMentor}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap border border-[#0A0A0A] bg-[#FFE01B] px-3.5 py-1.5 text-xs font-extrabold uppercase tracking-[0.04em] text-[#0A0A0A] transition-colors hover:bg-[#FF3B1F] hover:text-[#0A0A0A] cursor-pointer"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>AI Suggestions</span>
          <span className="shrink-0 bg-[#0A0A0A] px-2 py-0.5 text-[10px] font-bold text-[#FFE01B]">
            {mentorBadge}
          </span>
        </motion.button>
      </div>
    </div>
  );
}

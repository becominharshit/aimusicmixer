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
  showMentorButton?: boolean;
}

export function WorkspaceSubNav({
  activeTab,
  onChangeTab,
  report,
  hasReference,
  onOpenMentor,
  showMentorButton = true,
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
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2.5 px-3 py-2 sm:px-5">
        <nav
          role="tablist"
          aria-label="Mixit workflow sections"
          data-testid="workspace-subnav"
          className="relative inline-flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5 lg:overflow-visible"
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
                className={`relative z-10 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[3px] px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors ${
                  active
                    ? "text-[#111318]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="workspace-subnav-pill"
                    transition={STUDIO_SPRING}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-[3px] bg-[#F0B44C]"
                  />
                )}
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${
                    active ? "text-[#111318]" : "text-[var(--studio-mint)]"
                  }`}
                  aria-hidden="true"
                />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`shrink-0 rounded-[3px] px-1.5 py-0.5 tabular-telemetry text-[10px] font-bold ${
                      active
                        ? "bg-[#111318]/15 text-[#111318]"
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

        {showMentorButton && (
          <motion.button
            type="button"
            whileTap={TACTILE_TAP}
            onClick={onOpenMentor}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[#F0B44C] hover:bg-[var(--bg-elevated-hover)] cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#F0B44C]" aria-hidden="true" />
            <span>AI Suggestions</span>
            <span className="shrink-0 rounded-[3px] bg-[var(--studio-mint-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--studio-mint)]">
              {mentorBadge}
            </span>
          </motion.button>
        )}
      </div>
    </div>
  );
}

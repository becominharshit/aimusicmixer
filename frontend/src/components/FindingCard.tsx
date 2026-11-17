"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Headphones, AlertTriangle, AlertOctagon, CheckCircle2 } from "lucide-react";
import { STUDIO_EASE, STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import { formatTimecode } from "@/lib/utils";
import type { Finding } from "@/types/report";

interface FindingCardProps {
  finding: Finding;
  index: number;
  isActive?: boolean;
  onSelect?: (finding: Finding) => void;
  onAudition: (finding: Finding) => void;
  compact?: boolean;
}

const SEVERITY_STYLES = {
  alert: {
    badge: "bg-[#FFF1F3] text-[#BE123C] border-[rgba(190,18,60,0.25)]",
    icon: AlertOctagon,
    label: "Alert",
  },
  caution: {
    badge: "bg-[#FEF7EC] text-[#B45309] border-[rgba(180,83,9,0.25)]",
    icon: AlertTriangle,
    label: "Caution",
  },
  safe: {
    badge: "bg-[#ECFDF3] text-[#15803D] border-[rgba(21,128,61,0.22)]",
    icon: CheckCircle2,
    label: "On Target",
  },
} as const;

export function FindingCard({
  finding,
  index,
  isActive = false,
  onSelect,
  onAudition,
  compact = false,
}: FindingCardProps) {
  const [learnWhyOpen, setLearnWhyOpen] = useState(!compact && index === 0);
  const style = SEVERITY_STYLES[finding.severity];
  const Icon = style.icon;

  return (
    <motion.article
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: STUDIO_EASE }}
      onClick={() => onSelect?.(finding)}
      className={`relative bg-[#FFFFFF] p-5 squircle-outer transition-colors duration-150 ${
        isActive
          ? "active-hairline-border ring-1 ring-[rgba(58,114,105,0.2)]"
          : "hairline-border hover:border-[rgba(58,114,105,0.24)]"
      }`}
    >
      {isActive && (
        <motion.div
          layoutId="active-issue-indicator"
          transition={STUDIO_SPRING}
          className="pointer-events-none absolute left-0 top-4 bottom-4 w-[3px] rounded-full bg-[#3A7269]"
        />
      )}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 border px-2.5 py-0.5 text-[11px] font-semibold squircle-inner ${style.badge}`}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {style.label}
          </span>
          <span className="bg-[#F5F5F7] px-2 py-0.5 text-[11px] text-[#52605D] tabular-telemetry squircle-inner">
            {finding.evidence_id}
          </span>
          <span className="bg-[#F5F5F7] px-2 py-0.5 text-[11px] text-[#52605D] tabular-telemetry squircle-inner">
            {formatTimecode(finding.timestamp_start_sec)} – {formatTimecode(finding.timestamp_end_sec)}
          </span>
        </div>

        <motion.button
          type="button"
          whileTap={TACTILE_TAP}
          onClick={(e) => {
            e.stopPropagation();
            onAudition(finding);
          }}
          className="inline-flex items-center gap-1.5 bg-[#EBF3F1] px-3 py-1.5 text-xs font-medium text-[#182220] border border-[rgba(58,114,105,0.24)] hover:bg-[#DFECE9] squircle-inner cursor-pointer transition-colors"
        >
          <Headphones className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
          <span>Jump to {formatTimecode(finding.timestamp_start_sec)}</span>
        </motion.button>
      </div>

      <h3 className="mt-3 text-base font-semibold text-[#182220]">
        {finding.title}
      </h3>
      <p className="mt-1 text-xs font-medium text-[#3A7269] tabular-telemetry">
        {finding.measured_value}
      </p>

      {/* Core Pedagogy: What happened -> Listen -> What to try */}
      <div className="mt-3.5 space-y-2.5 text-sm text-[#182220]">
        <div>
          <span className="font-semibold text-[#182220]">What happened: </span>
          <span className="text-[#52605D]">{finding.what_happened}</span>
        </div>
        <div className="bg-[#F5F5F7] px-3.5 py-2.5 text-xs text-[#182220] squircle-inner">
          <span className="font-semibold text-[#3A7269]">Listen: </span>
          <span>{finding.listen_prompt}</span>
        </div>
        <div>
          <span className="font-semibold text-[#182220]">What to try: </span>
          <span className="text-[#52605D]">{finding.what_to_try}</span>
        </div>
      </div>

      {/* Expandable Learn Why + Recheck Drawer */}
      <div className="mt-3 pt-2.5 border-t border-[rgba(24,34,32,0.06)]">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setLearnWhyOpen((prev) => !prev);
          }}
          aria-expanded={learnWhyOpen}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#3A7269] hover:text-[#29534C] cursor-pointer"
        >
          <span>{learnWhyOpen ? "Hide engineering context" : "Learn why & recheck target"}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${
              learnWhyOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </button>

        <AnimatePresence initial={false}>
          {learnWhyOpen && (
            <motion.div
              initial={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              animate={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }}
              exit={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              transition={{ duration: 0.22, ease: STUDIO_EASE }}
              className="mt-2.5 space-y-2 text-xs text-[#52605D]"
            >
              <p>
                <strong className="font-semibold text-[#182220]">Why it matters: </strong>
                {finding.why_it_matters}
              </p>
              <p>
                <strong className="font-semibold text-[#182220]">Recheck target: </strong>
                {finding.recheck_target}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.article>
  );
}

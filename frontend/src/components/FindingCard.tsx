"use client";

import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  GitCompare,
  Headphones,
  ShieldAlert,
  Sliders,
  SlidersHorizontal,
} from "lucide-react";
import type { CorrectiveEqConfig } from "@/audio/StudioAudioEngine";
import { STUDIO_EASE, TACTILE_TAP } from "@/lib/motion";
import { buildDawRepairSteps } from "@/lib/repairChecklist";
import { formatTimecode } from "@/lib/utils";
import type { BandName, Finding, FindingClassification } from "@/types/report";

interface FindingCardProps {
  finding: Finding;
  index: number;
  isActive?: boolean;
  hasAudio?: boolean;
  isEqActive?: boolean;
  onSelect?: (finding: Finding) => void;
  onAudition: (finding: Finding) => void;
  onRecheck?: (finding: Finding) => void;
  onToggleCorrectiveEq?: (eq: CorrectiveEqConfig) => void;
  completedRepairSteps?: Record<string, boolean>;
  onToggleRepairStep?: (stepId: string, checked: boolean) => void;
  compact?: boolean;
}

const SEVERITY_STYLES = {
  alert: {
    badge:
      "bg-[var(--studio-vermilion-soft)] text-[var(--studio-vermilion)] border-[var(--studio-vermilion)]/35",
    icon: AlertOctagon,
    label: "Alert",
  },
  caution: {
    badge: "bg-[var(--studio-amber-soft)] text-[var(--studio-amber)] border-[var(--studio-amber)]/35",
    icon: AlertTriangle,
    label: "Caution",
  },
  safe: {
    badge: "bg-[var(--studio-mint-soft)] text-[var(--studio-mint)] border-[var(--studio-mint)]/35",
    icon: CheckCircle2,
    label: "On Target",
  },
} as const;

const CATEGORY_TECH_NOTE: Record<string, string> = {
  true_peak:
    "Measured using 4x polyphase FIR oversampling inter-sample peak reconstruction cross-checked against ITU-R BS.1770 boundaries.",
  loudness:
    "Measured using ITU-R BS.1770 K-weighted integrated loudness across 400 ms gated blocks and 3 s short-term sliding windows.",
  dynamics:
    "Peak-to-Loudness Ratio (PLR) and PSR quantify remaining transient punch relative to sustained body loudness.",
  stereo_phase:
    "1-second energy-weighted Pearson correlation across L/R channels plus 4th-order Butterworth 20–120 Hz bandpass sub-bass correlation check.",
  tonal_balance:
    "6-band Welch power spectral density normalized relative to the track average energy (gain-invariant tilt vs. genre profile).",
  stems_overlap:
    "Computed exclusively across user-uploaded aligned stems via per-band energy proximity and normalized phase interaction.",
  technical_validation:
    "Validated via container header ffprobe metadata inspection and sample-level peak bounds.",
};

const BAND_CENTER_HZ: Record<BandName, number> = {
  sub: 50,
  low: 140,
  low_mid: 280,
  high_mid: 1800,
  presence: 5500,
  air: 12000,
};

export function resolveFindingClassification(finding: Finding): FindingClassification {
  if (finding.classification === "objective_defect" || finding.classification === "stylistic_choice") {
    return finding.classification;
  }
  if (
    finding.category === "technical_validation" ||
    (finding.category === "true_peak" && finding.severity === "alert") ||
    (finding.category === "stereo_phase" && finding.severity !== "safe") ||
    (finding.category === "dynamics" && finding.severity === "alert")
  ) {
    return "objective_defect";
  }
  return "stylistic_choice";
}

export function deriveSuggestedEq(finding: Finding): CorrectiveEqConfig | null {
  if (finding.severity === "safe") {
    return null;
  }

  if (finding.category === "stereo_phase") {
    if (
      finding.evidence_id.includes("phase_low") ||
      /sub|120\s*hz|low-end|bass/i.test(`${finding.title} ${finding.what_happened}`)
    ) {
      return {
        id: finding.evidence_id,
        freqHz: 85,
        q: 1.0,
        gainDb: -2.5,
        filterType: "peaking",
      };
    }
    return {
      id: finding.evidence_id,
      freqHz: 110,
      q: 0.9,
      gainDb: -2.0,
      filterType: "peaking",
    };
  }

  const textBlob = `${finding.title} ${finding.what_happened} ${finding.what_to_try}`;
  const isTonalLike =
    finding.category === "tonal_balance" ||
    /mud|boxy|harsh|sibilan|sub-bass|boomy|250\s*hz|low-mid|high-mid|presence|air/i.test(textBlob);

  if (!isTonalLike) {
    return null;
  }

  const bandFromId = finding.evidence_id
    .replace("ev_tonal_", "")
    .replace("_01", "") as BandName;
  let band: BandName =
    finding.band_name ?? (bandFromId in BAND_CENTER_HZ ? bandFromId : "low_mid");

  if (!(band in BAND_CENTER_HZ)) {
    if (/sub|60\s*hz|45\s*hz/i.test(textBlob)) band = "sub";
    else if (/low-mid|mud|boxy|250\s*hz|300\s*hz/i.test(textBlob)) band = "low_mid";
    else if (/harsh|nasal|2\s*khz|3\s*khz|high-mid/i.test(textBlob)) band = "high_mid";
    else if (/sibilan|presence|5\s*khz|6\s*khz/i.test(textBlob)) band = "presence";
    else if (/air|brillian|10\s*khz|12\s*khz/i.test(textBlob)) band = "air";
    else band = "low";
  }

  let freqHz = BAND_CENTER_HZ[band] ?? 280;
  if (band === "low_mid" && /250\s*hz/i.test(textBlob)) {
    freqHz = 250;
  }

  const numMatch = finding.measured_value.match(/([+-]?\d+(?:\.\d+)?)\s*dB/i);
  const delta = numMatch ? Number.parseFloat(numMatch[1]) : 2.5;
  const gainDb =
    delta >= 0
      ? -Math.max(1.5, Math.min(4.5, Math.abs(delta) * 0.55))
      : Math.max(1.5, Math.min(4.0, Math.abs(delta) * 0.5));

  return {
    id: finding.evidence_id,
    freqHz,
    q: band === "low" || band === "low_mid" ? 1.4 : 1.1,
    gainDb: Number(gainDb.toFixed(1)),
    filterType: "peaking",
  };
}

export function deriveAutoFixEqBands(findings: Finding[]): CorrectiveEqConfig[] {
  const bands: CorrectiveEqConfig[] = [];
  const seenFreqs = new Set<number>();
  for (const finding of findings) {
    if (bands.length >= 3) break;
    const eq = deriveSuggestedEq(finding);
    if (eq && !seenFreqs.has(eq.freqHz)) {
      seenFreqs.add(eq.freqHz);
      bands.push(eq);
    }
  }
  return bands;
}

export function FindingCard({
  finding,
  index,
  isActive = false,
  hasAudio = true,
  isEqActive = false,
  onSelect,
  onAudition,
  onRecheck,
  onToggleCorrectiveEq,
  completedRepairSteps = {},
  onToggleRepairStep,
  compact = false,
}: FindingCardProps) {
  const [learnWhyOpen, setLearnWhyOpen] = useState(!compact && index === 0);
  const [localChecked, setLocalChecked] = useState<Record<string, boolean>>({});
  const style = SEVERITY_STYLES[finding.severity];
  const Icon = style.icon;
  const suggestedEq = deriveSuggestedEq(finding);
  const classification = resolveFindingClassification(finding);
  const repairSteps = useMemo(() => buildDawRepairSteps(finding), [finding]);

  const isStepChecked = (stepId: string) =>
    Boolean(onToggleRepairStep ? completedRepairSteps[stepId] : localChecked[stepId]);

  const handleToggleStep = (stepId: string) => {
    const next = !isStepChecked(stepId);
    if (onToggleRepairStep) {
      onToggleRepairStep(stepId, next);
    } else {
      setLocalChecked((prev) => ({ ...prev, [stepId]: next }));
    }
  };

  const completedCount = repairSteps.filter((step) => isStepChecked(step.id)).length;

  return (
    <motion.article
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: STUDIO_EASE }}
      onClick={() => onSelect?.(finding)}
      className={`relative bg-[var(--bg-elevated)] p-5 squircle-outer transition-colors duration-150 ${
        isActive
          ? "active-hairline-border ring-1 ring-[var(--studio-mint)]/30"
          : "hairline-border hover:border-[var(--border-strong)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 border px-2.5 py-0.5 text-[11px] font-semibold squircle-inner ${style.badge}`}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {style.label}
          </span>

          {/* Objective Technical Defect vs Stylistic Choice Classification */}
          <span
            data-testid={`finding-classification-${finding.evidence_id}`}
            className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-semibold squircle-inner ${
              classification === "objective_defect"
                ? "bg-[var(--studio-vermilion-soft)] text-[var(--studio-vermilion)] border-[var(--studio-vermilion)]/30"
                : "bg-[var(--studio-cobalt-soft)] text-[var(--studio-cobalt)] border-[var(--studio-cobalt)]/30"
            }`}
          >
            {classification === "objective_defect" ? (
              <>
                <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                Objective Defect
              </>
            ) : (
              <>
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                Stylistic Choice
              </>
            )}
          </span>

          <span className="bg-[var(--bg-inset)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] tabular-telemetry squircle-inner">
            {finding.evidence_id}
          </span>
          <span className="bg-[var(--bg-inset)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] tabular-telemetry squircle-inner">
            {formatTimecode(finding.timestamp_start_sec)} – {formatTimecode(finding.timestamp_end_sec)}
          </span>
          {isActive && (
            <span className="bg-[var(--studio-mint-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--studio-mint)] squircle-inner">
              Focused
            </span>
          )}
        </div>

        <motion.button
          type="button"
          disabled={!hasAudio}
          whileTap={hasAudio ? TACTILE_TAP : undefined}
          title={
            hasAudio
              ? `Jump to and loop ${formatTimecode(finding.timestamp_start_sec)}`
              : "Audio proxy unavailable for archived report — upload or re-attach audio to audition"
          }
          onClick={(e) => {
            e.stopPropagation();
            if (hasAudio) onAudition(finding);
          }}
          className={`no-print inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border squircle-inner transition-colors ${
            hasAudio
              ? "bg-[var(--studio-mint-soft)] text-[var(--text-primary)] border-[var(--border-active)] hover:brightness-110 cursor-pointer"
              : "bg-[var(--bg-inset)] text-[var(--text-muted)] border-[var(--border-hairline)] cursor-not-allowed"
          }`}
        >
          <Headphones
            className={`h-3.5 w-3.5 ${hasAudio ? "text-[var(--studio-mint)]" : "text-[var(--text-muted)]"}`}
            aria-hidden="true"
          />
          <span>
            {hasAudio ? `Jump to ${formatTimecode(finding.timestamp_start_sec)}` : "No Audio"}
          </span>
        </motion.button>
      </div>

      <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">{finding.title}</h3>
      <p className="mt-1 text-xs font-medium text-[var(--studio-mint)] tabular-telemetry">
        {finding.measured_value}
      </p>

      {/* Complete 5-Step Pedagogical Learning Loop */}
      <div className="mt-3.5 space-y-2.5 text-sm text-[var(--text-primary)]">
        <div>
          <span className="font-semibold text-[var(--text-primary)]">What happened: </span>
          <span className="text-[var(--text-secondary)]">{finding.what_happened}</span>
        </div>
        <div>
          <span className="font-semibold text-[var(--text-primary)]">Why it matters: </span>
          <span className="text-[var(--text-secondary)]">{finding.why_it_matters}</span>
        </div>
        <div className="bg-[var(--bg-inset)] border border-[var(--border-hairline)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] squircle-inner">
          <span className="font-semibold text-[var(--studio-mint)]">Listen: </span>
          <span>{finding.listen_prompt}</span>
        </div>
        <div>
          <span className="font-semibold text-[var(--text-primary)]">What to try: </span>
          <span className="text-[var(--text-secondary)]">{finding.what_to_try}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
          <div>
            <strong className="font-semibold text-[var(--text-primary)]">Recheck: </strong>
            <span>{finding.recheck_target}</span>
          </div>

          <div className="no-print flex flex-wrap items-center gap-2">
            {suggestedEq && onToggleCorrectiveEq && (
              <button
                type="button"
                disabled={!hasAudio}
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasAudio) onToggleCorrectiveEq(suggestedEq);
                }}
                aria-pressed={isEqActive}
                title={
                  hasAudio
                    ? `Preview ${suggestedEq.gainDb >= 0 ? "+" : ""}${suggestedEq.gainDb.toFixed(1)} dB peaking EQ at ${suggestedEq.freqHz} Hz`
                    : "Audio proxy required to audition corrective EQ"
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium squircle-inner transition-colors ${
                  !hasAudio
                    ? "bg-[var(--bg-inset)] text-[var(--text-muted)] cursor-not-allowed"
                    : isEqActive
                      ? "bg-[var(--studio-mint)] text-[#0B0D11] font-semibold cursor-pointer"
                      : "bg-[var(--studio-mint-soft)] text-[var(--studio-mint)] hover:brightness-110 cursor-pointer"
                }`}
              >
                <Sliders className="h-3 w-3" aria-hidden="true" />
                <span>
                  {isEqActive
                    ? `Bypass Preview EQ (${suggestedEq.freqHz} Hz)`
                    : `Audition ${suggestedEq.gainDb >= 0 ? "+" : ""}${suggestedEq.gainDb} dB @ ${suggestedEq.freqHz} Hz`}
                </span>
              </button>
            )}

            {onRecheck && finding.severity !== "safe" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRecheck(finding);
                }}
                className="inline-flex items-center gap-1.5 bg-[var(--bg-inset)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hairline-border hover:border-[var(--border-active)] squircle-inner cursor-pointer"
              >
                <GitCompare className="h-3 w-3 text-[var(--studio-mint)]" aria-hidden="true" />
                <span>Recheck in v2</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Interactive DAW Repair Checklist */}
      {finding.severity !== "safe" && (
        <div
          className="no-print mt-3.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="tabular-telemetry text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              DAW Repair Checklist
            </span>
            <span className="tabular-telemetry text-[10px] font-semibold text-[var(--studio-mint)]">
              {completedCount}/{repairSteps.length} done
            </span>
          </div>
          <div className="space-y-1.5">
            {repairSteps.map((step) => {
              const checked = isStepChecked(step.id);
              return (
                <label
                  key={step.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 text-xs transition-colors hover:bg-[var(--bg-elevated)]/60"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={step.label}
                    onClick={() => handleToggleStep(step.id)}
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                      checked
                        ? "border-[var(--studio-mint)] bg-[var(--studio-mint)] text-[#0B0D11]"
                        : "border-[var(--border-strong)] bg-[var(--bg-elevated)]"
                    }`}
                  >
                    {checked ? <Check className="h-3 w-3 stroke-[3]" /> : null}
                  </button>
                  <span
                    className={`leading-snug ${
                      checked
                        ? "text-[var(--text-muted)] line-through"
                        : "text-[var(--text-primary)]"
                    }`}
                  >
                    {step.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Expandable Learn Why DSP Method Details */}
      <div className="mt-3 pt-2.5 border-t border-[var(--border-hairline)]">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setLearnWhyOpen((prev) => !prev);
          }}
          aria-expanded={learnWhyOpen}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--studio-mint)] hover:brightness-110 cursor-pointer"
        >
          <span>{learnWhyOpen ? "Hide DSP method note" : "Learn why (DSP basis)"}</span>
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
              className="mt-2.5 space-y-1.5 bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-secondary)] hairline-border squircle-inner"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-[var(--text-primary)]">
                  DSP Basis ({finding.confidence})
                </span>
                <span className="tabular-telemetry text-[var(--studio-mint)]">
                  Window {formatTimecode(finding.timestamp_start_sec, true)} –{" "}
                  {formatTimecode(finding.timestamp_end_sec, true)}
                </span>
              </div>
              <p className="leading-relaxed">
                {CATEGORY_TECH_NOTE[finding.category] ||
                  "Computed deterministically from PCM audio waveform samples."}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.article>
  );
}

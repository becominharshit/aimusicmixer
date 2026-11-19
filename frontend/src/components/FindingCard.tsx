"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  GitCompare,
  Headphones,
  Sliders,
} from "lucide-react";
import type { CorrectiveEqConfig } from "@/audio/StudioAudioEngine";
import { STUDIO_EASE, TACTILE_TAP } from "@/lib/motion";
import { formatTimecode } from "@/lib/utils";
import type { BandName, Finding } from "@/types/report";

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

export function deriveSuggestedEq(finding: Finding): CorrectiveEqConfig | null {
  if (finding.severity === "safe") {
    return null;
  }

  // Sub-bass or low-end stereo phase issue -> calibrated sub-cleanup trim audition
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

  // Tonal balance, mud, harshness, sub excess, or overlap mentioning Hz/dB
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
  compact = false,
}: FindingCardProps) {
  const [learnWhyOpen, setLearnWhyOpen] = useState(!compact && index === 0);
  const style = SEVERITY_STYLES[finding.severity];
  const Icon = style.icon;
  const suggestedEq = deriveSuggestedEq(finding);

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
          {isActive && (
            <span className="bg-[#EBF3F1] px-2 py-0.5 text-[10px] font-semibold text-[#3A7269] squircle-inner">
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
              ? "bg-[#EBF3F1] text-[#182220] border-[rgba(58,114,105,0.24)] hover:bg-[#DFECE9] cursor-pointer"
              : "bg-[#F5F5F7] text-[#52605D]/60 border-[rgba(24,34,32,0.08)] cursor-not-allowed"
          }`}
        >
          <Headphones
            className={`h-3.5 w-3.5 ${hasAudio ? "text-[#3A7269]" : "text-[#52605D]/50"}`}
            aria-hidden="true"
          />
          <span>
            {hasAudio ? `Jump to ${formatTimecode(finding.timestamp_start_sec)}` : "No Audio"}
          </span>
        </motion.button>
      </div>

      <h3 className="mt-3 text-base font-semibold text-[#182220]">{finding.title}</h3>
      <p className="mt-1 text-xs font-medium text-[#3A7269] tabular-telemetry">
        {finding.measured_value}
      </p>

      {/* Complete 5-Step Pedagogical Learning Loop: What happened -> Why it matters -> Listen -> What to try -> Recheck */}
      <div className="mt-3.5 space-y-2.5 text-sm text-[#182220]">
        <div>
          <span className="font-semibold text-[#182220]">What happened: </span>
          <span className="text-[#52605D]">{finding.what_happened}</span>
        </div>
        <div>
          <span className="font-semibold text-[#182220]">Why it matters: </span>
          <span className="text-[#52605D]">{finding.why_it_matters}</span>
        </div>
        <div className="bg-[#F5F5F7] px-3.5 py-2.5 text-xs text-[#182220] squircle-inner">
          <span className="font-semibold text-[#3A7269]">Listen: </span>
          <span>{finding.listen_prompt}</span>
        </div>
        <div>
          <span className="font-semibold text-[#182220]">What to try: </span>
          <span className="text-[#52605D]">{finding.what_to_try}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#52605D]">
          <div>
            <strong className="font-semibold text-[#182220]">Recheck: </strong>
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
                    ? "bg-[#F5F5F7] text-[#52605D]/50 cursor-not-allowed"
                    : isEqActive
                      ? "bg-[#3A7269] text-white cursor-pointer"
                      : "bg-[#EBF3F1] text-[#3A7269] hover:bg-[#DFECE9] cursor-pointer"
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
                className="inline-flex items-center gap-1.5 bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-medium text-[#182220] hairline-border hover:border-[rgba(58,114,105,0.4)] squircle-inner cursor-pointer"
              >
                <GitCompare className="h-3 w-3 text-[#3A7269]" aria-hidden="true" />
                <span>Recheck in v2</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expandable Learn Why DSP Method Details */}
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
              className="mt-2.5 space-y-1.5 bg-[#FAFAFA] p-3 text-xs text-[#52605D] hairline-border squircle-inner"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-[#182220]">
                  DSP Basis ({finding.confidence})
                </span>
                <span className="tabular-telemetry text-[#3A7269]">
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

"use client";

import React from "react";
import { ArrowRight, Pause, Play, RotateCcw } from "lucide-react";
import { FindingCard } from "@/components/FindingCard";
import { Button } from "@/components/ui/button";
import { formatTimecode } from "@/lib/utils";
import type { AnalysisReport, Finding } from "@/types/report";

interface SimpleViewProps {
  report: AnalysisReport;
  isPlaying: boolean;
  activeFindingId: string | null;
  onTogglePlay: () => void;
  onAuditionFinding: (finding: Finding) => void;
  onSelectFinding: (finding: Finding) => void;
  onOpenAdvanced: () => void;
  onNewUpload: () => void;
}

export function SimpleView({
  report,
  isPlaying,
  activeFindingId,
  onTogglePlay,
  onAuditionFinding,
  onSelectFinding,
  onOpenAdvanced,
  onNewUpload,
}: SimpleViewProps) {
  const m = report.global_metrics;
  const topFindings = report.findings.slice(0, 3);

  const truePeakTone =
    m.true_peak_dbtp > -0.1
      ? "text-[#BE123C]"
      : report.context.stage === "unmastered_mix" && m.true_peak_dbtp > -2.5
        ? "text-[#B45309]"
        : "text-[#15803D]";

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-4">
      {/* Header & Quick Playback Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#FFFFFF] p-5 hairline-border squircle-outer">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-[-0.02em] text-[#182220]">
              {report.audio_metadata.filename}
            </h1>
            <span className="bg-[#EBF3F1] px-2.5 py-0.5 text-xs font-medium text-[#3A7269] squircle-inner capitalize">
              {report.context.genre.replace("_", " ")} ·{" "}
              {report.context.stage.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#52605D]">
            Showing your top {topFindings.length} prioritized coaching steps. Every finding traces directly to measured telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="button" variant="primary" onClick={onTogglePlay}>
            {isPlaying ? (
              <>
                <Pause className="h-4 w-4" aria-hidden="true" />
                Pause Audio
              </>
            ) : (
              <>
                <Play className="h-4 w-4" aria-hidden="true" />
                Audition Mix
              </>
            )}
          </Button>
          <Button type="button" variant="secondary" onClick={onOpenAdvanced}>
            Open Advanced Workbench
            <ArrowRight className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" onClick={onNewUpload}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            New Mix
          </Button>
        </div>
      </div>

      {/* Measured Telemetry Strip (No Fake Aggregate Quality Scores) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
          <div className="text-xs text-[#52605D]">Integrated Loudness</div>
          <div className="mt-1 text-xl font-semibold text-[#182220] tabular-telemetry">
            {m.integrated_lufs.toFixed(1)} <span className="text-xs font-normal text-[#52605D]">LUFS</span>
          </div>
        </div>
        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
          <div className="text-xs text-[#52605D]">4x True Peak</div>
          <div className={`mt-1 text-xl font-semibold tabular-telemetry ${truePeakTone}`}>
            {m.true_peak_dbtp >= 0 ? `+${m.true_peak_dbtp.toFixed(2)}` : m.true_peak_dbtp.toFixed(2)}{" "}
            <span className="text-xs font-normal text-[#52605D]">dBTP</span>
          </div>
        </div>
        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
          <div className="text-xs text-[#52605D]">Loudness Range</div>
          <div className="mt-1 text-xl font-semibold text-[#182220] tabular-telemetry">
            {m.loudness_range_lu.toFixed(1)} <span className="text-xs font-normal text-[#52605D]">LU</span>
          </div>
        </div>
        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
          <div className="text-xs text-[#52605D]">Phase Correlation</div>
          <div
            className={`mt-1 text-xl font-semibold tabular-telemetry ${
              m.phase_correlation_avg < 0
                ? "text-[#BE123C]"
                : m.phase_correlation_avg < 0.35
                  ? "text-[#B45309]"
                  : "text-[#182220]"
            }`}
          >
            {m.phase_correlation_avg >= 0 ? "+" : ""}
            {m.phase_correlation_avg.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Top 3 Prioritized Finding Cards */}
      <div className="space-y-4">
        {topFindings.map((finding, idx) => (
          <FindingCard
            key={finding.evidence_id}
            finding={finding}
            index={idx}
            isActive={activeFindingId === finding.evidence_id}
            onSelect={onSelectFinding}
            onAudition={onAuditionFinding}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F5F5F7] px-5 py-4 hairline-border squircle-outer">
        <div className="text-xs text-[#52605D]">
          Want to A/B against a loudness-matched reference track, test Smartphone/Laptop speaker translation,
          inspect stems, or compare v1 vs v2?
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#52605D] tabular-telemetry">
            Duration {formatTimecode(report.audio_metadata.duration_sec)} · {report.findings.length} total findings
          </span>
          <Button type="button" variant="soft" size="sm" onClick={onOpenAdvanced}>
            Switch to Advanced Mix Check
          </Button>
        </div>
      </div>
    </div>
  );
}

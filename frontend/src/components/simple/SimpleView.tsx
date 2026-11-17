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

function buildHeroTakeaway(report: AnalysisReport): string {
  const stageLabel = report.context.stage.replace("_", " ");
  const genreLabel = report.context.genre.replace("_", " ");
  const alerts = report.findings.filter((f) => f.severity === "alert");
  const cautions = report.findings.filter((f) => f.severity === "caution");

  if (alerts.length > 0) {
    const names = alerts
      .slice(0, 2)
      .map((f) => f.title.replace(/\s*\([^)]*\)\s*/g, "").trim())
      .join(" and ");
    return `For this ${genreLabel} ${stageLabel}, resolve ${alerts.length} urgent issue${alerts.length > 1 ? "s" : ""} first (${names}) before final export or limiting.`;
  }
  if (cautions.length > 0) {
    return `This ${genreLabel} ${stageLabel} has clean peak safety and phase cohesion, with ${cautions.length} targeted adjustment${cautions.length > 1 ? "s" : ""} to test in your DAW before v2.`;
  }
  return `This ${genreLabel} ${stageLabel} sits cleanly inside headroom, stereo phase, and tonal envelopes — verify against a reference track in Reference A/B.`;
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
  const plr = m.plr_db ?? Math.max(0, m.true_peak_dbtp - m.integrated_lufs);

  const truePeakTone =
    m.true_peak_dbtp > -0.1
      ? "text-[#BE123C]"
      : report.context.stage === "unmastered_mix" && m.true_peak_dbtp > -2.5
        ? "text-[#B45309]"
        : "text-[#15803D]";

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-4">
      {/* Plain-Language Stage & Genre Takeaway Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 bg-[#FFFFFF] p-5 hairline-border squircle-outer">
        <div className="space-y-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-[-0.02em] text-[#182220]">
              {report.audio_metadata.filename}
            </h1>
            <span className="bg-[#EBF3F1] px-2.5 py-0.5 text-xs font-medium text-[#3A7269] squircle-inner capitalize">
              {report.context.genre.replace("_", " ")} ·{" "}
              {report.context.stage.replace("_", " ")}
            </span>
          </div>
          <p className="text-sm text-[#182220] leading-relaxed">
            {buildHeroTakeaway(report)}
          </p>
          <p className="text-xs text-[#52605D]">
            Showing your top {topFindings.length} prioritized coaching steps. Every card links directly to measured DSP telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            Advanced Workbench
            <ArrowRight className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" onClick={onNewUpload}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            New Mix
          </Button>
        </div>
      </div>

      {/* Measured Telemetry Strip (No Reductive Quality Scores) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
          <div className="text-xs text-[#52605D]">Integrated Loudness</div>
          <div className="mt-1 text-xl font-semibold text-[#182220] tabular-telemetry">
            {m.integrated_lufs.toFixed(1)}{" "}
            <span className="text-xs font-normal text-[#52605D]">LUFS</span>
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
          <div className="text-xs text-[#52605D]">PLR / LRA</div>
          <div className="mt-1 text-xl font-semibold text-[#182220] tabular-telemetry">
            {plr.toFixed(1)}{" "}
            <span className="text-xs font-normal text-[#52605D]">
              dB / {m.loudness_range_lu.toFixed(1)} LU
            </span>
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
                  : "text-[#15803D]"
            }`}
          >
            {m.phase_correlation_avg >= 0 ? "+" : ""}
            {m.phase_correlation_avg.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Top 3 Prioritized 5-Step Finding Cards */}
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
          Inspect full 6-band spectral plots, interactive waveform pins, and stereo correlation graphs in Advanced Mix Check.
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#52605D] tabular-telemetry">
            Duration {formatTimecode(report.audio_metadata.duration_sec)} · {report.findings.length} findings
          </span>
          <Button type="button" variant="soft" size="sm" onClick={onOpenAdvanced}>
            Switch to Advanced Mix Check
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Pause, Play, RotateCcw } from "lucide-react";
import type { CorrectiveEqConfig } from "@/audio/StudioAudioEngine";
import { FindingCard } from "@/components/FindingCard";
import { Button } from "@/components/ui/button";
import { formatTimecode } from "@/lib/utils";
import type { AnalysisReport, Finding } from "@/types/report";

interface SimpleViewProps {
  report: AnalysisReport;
  isPlaying: boolean;
  hasAudio?: boolean;
  activeFindingId: string | null;
  activeCorrectiveEqId?: string | null;
  onTogglePlay: () => void;
  onAuditionFinding: (finding: Finding) => void;
  onSelectFinding: (finding: Finding) => void;
  onRecheckFinding?: (finding: Finding) => void;
  onToggleCorrectiveEq?: (eq: CorrectiveEqConfig) => void;
  onOpenAdvanced: () => void;
  onNewUpload: () => void;
}

const STREAMING_TARGETS = [
  { id: "spotify", label: "Spotify Normal", targetLufs: -14.0, ceilingDbtp: -1.0 },
  { id: "apple", label: "Apple Music", targetLufs: -16.0, ceilingDbtp: -1.0 },
  { id: "youtube", label: "YouTube", targetLufs: -14.0, ceilingDbtp: -1.0 },
  { id: "club", label: "Club / DJ", targetLufs: -7.0, ceilingDbtp: -0.3 },
] as const;

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
  hasAudio = true,
  activeFindingId,
  activeCorrectiveEqId = null,
  onTogglePlay,
  onAuditionFinding,
  onSelectFinding,
  onRecheckFinding,
  onToggleCorrectiveEq,
  onOpenAdvanced,
  onNewUpload,
}: SimpleViewProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<(typeof STREAMING_TARGETS)[number]["id"]>("spotify");
  const m = report.global_metrics;
  const topFindings = report.findings.slice(0, 3);
  const plr = m.plr_db ?? Math.max(0, m.true_peak_dbtp - m.integrated_lufs);

  const platform =
    STREAMING_TARGETS.find((p) => p.id === selectedPlatform) ?? STREAMING_TARGETS[0];
  const normGainDb = Number((platform.targetLufs - m.integrated_lufs).toFixed(1));
  const projectedPeakDbtp = Number((m.true_peak_dbtp + normGainDb).toFixed(2));
  const limiterEngaged = normGainDb > 0 && projectedPeakDbtp > platform.ceilingDbtp;

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

        <div className="no-print flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" disabled={!hasAudio} onClick={onTogglePlay}>
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

      {/* Multi-Platform Loudness Normalization Preview */}
      <div className="bg-[#FFFFFF] p-4 hairline-border squircle-outer space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold text-[#182220]">
              Platform Loudness Normalization Preview
            </h2>
            <p className="text-[11px] text-[#52605D]">
              Preview playback gain adjustment &amp; headroom margin across streaming / DJ targets
            </p>
          </div>
          <div className="inline-flex flex-wrap gap-1 bg-[#F5F5F7] p-1 hairline-border squircle-inner">
            {STREAMING_TARGETS.map((t) => {
              const active = t.id === selectedPlatform;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedPlatform(t.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium squircle-inner cursor-pointer transition-colors ${
                    active
                      ? "bg-[#FFFFFF] text-[#182220] hairline-border"
                      : "text-[#52605D] hover:text-[#182220]"
                  }`}
                >
                  {t.label} ({t.targetLufs})
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F5F5F7] px-3.5 py-2.5 text-xs squircle-inner">
          <div className="flex flex-wrap items-center gap-3 tabular-telemetry">
            <span>
              Applied gain:{" "}
              <strong className="text-[#182220]">
                {normGainDb >= 0 ? "+" : ""}
                {normGainDb.toFixed(1)} dB
              </strong>
            </span>
            <span className="text-[#52605D]">·</span>
            <span>
              Projected peak:{" "}
              <strong className={limiterEngaged ? "text-[#B45309]" : "text-[#15803D]"}>
                {projectedPeakDbtp >= 0 ? "+" : ""}
                {projectedPeakDbtp.toFixed(2)} dBTP
              </strong>
            </span>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
              limiterEngaged ? "text-[#B45309]" : "text-[#15803D]"
            }`}
          >
            {limiterEngaged ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Exceeds {platform.ceilingDbtp.toFixed(1)} dBTP ceiling (limiter engaged on boost)
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {normGainDb < 0
                  ? `Turned down ${Math.abs(normGainDb).toFixed(1)} dB (no upward limiter distortion)`
                  : `Clears ${platform.ceilingDbtp.toFixed(1)} dBTP ceiling cleanly`}
              </>
            )}
          </span>
        </div>
      </div>

      {/* Top 3 Prioritized 5-Step Finding Cards */}
      <div className="space-y-4">
        {topFindings.map((finding, idx) => (
          <FindingCard
            key={finding.evidence_id}
            finding={finding}
            index={idx}
            hasAudio={hasAudio}
            isActive={activeFindingId === finding.evidence_id}
            isEqActive={activeCorrectiveEqId === finding.evidence_id}
            onSelect={onSelectFinding}
            onAudition={onAuditionFinding}
            onRecheck={onRecheckFinding}
            onToggleCorrectiveEq={onToggleCorrectiveEq}
          />
        ))}
      </div>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-[#F5F5F7] px-5 py-4 hairline-border squircle-outer">
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

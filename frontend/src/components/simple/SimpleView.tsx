"use client";

import React, { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Pause, Play, Radio, RotateCcw } from "lucide-react";
import type { CorrectiveEqConfig } from "@/audio/StudioAudioEngine";
import { FindingCard } from "@/components/FindingCard";
import { FlawTimelineBar } from "@/components/studio/FlawTimelineBar";
import { LiveSpectralGraph } from "@/components/studio/LiveSpectralGraph";
import { SpinningDiscPlayer } from "@/components/studio/SpinningDiscPlayer";
import { Button } from "@/components/ui/button";
import { formatTimecode } from "@/lib/utils";
import type { AnalysisReport, Finding, SeverityType } from "@/types/report";

interface SimpleViewProps {
  report: AnalysisReport;
  isPlaying: boolean;
  hasAudio?: boolean;
  activeFindingId: string | null;
  activeCorrectiveEqId?: string | null;
  completedRepairSteps?: Record<string, boolean>;
  onToggleRepairStep?: (stepId: string, checked: boolean) => void;
  onTogglePlay: () => void;
  onAuditionFinding: (finding: Finding) => void;
  onSelectFinding: (finding: Finding) => void;
  onRecheckFinding?: (finding: Finding) => void;
  onFixInDaw?: (finding: Finding) => void | Promise<void>;
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

function overallHealth(report: AnalysisReport): SeverityType {
  if (report.findings.some((f) => f.severity === "alert")) return "alert";
  if (report.findings.some((f) => f.severity === "caution")) return "caution";
  return "safe";
}

export function SimpleView({
  report,
  isPlaying,
  hasAudio = true,
  activeFindingId,
  activeCorrectiveEqId = null,
  completedRepairSteps = {},
  onToggleRepairStep,
  onTogglePlay,
  onAuditionFinding,
  onSelectFinding,
  onRecheckFinding,
  onFixInDaw,
  onToggleCorrectiveEq,
  onOpenAdvanced,
  onNewUpload,
}: SimpleViewProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<(typeof STREAMING_TARGETS)[number]["id"]>("spotify");
  const m = report.global_metrics;
  const topFindings = report.findings.slice(0, 3);
  const plr = m.plr_db ?? Math.max(0, m.true_peak_dbtp - m.integrated_lufs);
  const isLocalPreview = report.analysis_source === "local_web_audio_preview";

  const platform =
    STREAMING_TARGETS.find((p) => p.id === selectedPlatform) ?? STREAMING_TARGETS[0];
  const normGainDb = Number((platform.targetLufs - m.integrated_lufs).toFixed(1));
  const projectedPeakDbtp = Number((m.true_peak_dbtp + normGainDb).toFixed(2));
  const limiterEngaged = normGainDb > 0 && projectedPeakDbtp > platform.ceilingDbtp;

  const truePeakTone =
    m.true_peak_dbtp > -0.1
      ? "text-[var(--studio-vermilion)]"
      : report.context.stage === "unmastered_mix" && m.true_peak_dbtp > -2.5
        ? "text-[var(--studio-amber)]"
        : "text-[var(--studio-mint)]";

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-4">
      {/* Transparent Browser-Native Fallback Notice */}
      {isLocalPreview && (
        <div
          role="status"
          data-testid="local-web-audio-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--studio-amber)]/40 bg-[var(--studio-amber-soft)] px-4 py-3 text-xs text-[var(--studio-amber)]"
        >
          <div className="flex items-center gap-2 font-semibold">
            <Radio className="h-4 w-4 animate-pulse shrink-0" />
            <span>Local Web Audio Preview — Upgrading to Precision DSP...</span>
          </div>
          <span className="tabular-telemetry text-[11px] opacity-90">
            Deterministic browser ITU-R &amp; 4x peak estimates · Precision server sync queued
          </span>
        </div>
      )}

      {/* Plain-Language Stage & Genre Takeaway Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 bg-[var(--bg-elevated)] p-5 hairline-border squircle-outer">
        <div className="space-y-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-bold tracking-[-0.02em] text-[var(--text-primary)]">
              {report.audio_metadata.filename}
            </h1>
            <span className="bg-[var(--studio-mint-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--studio-mint)] squircle-inner capitalize">
              {report.context.genre.replace("_", " ")} ·{" "}
              {report.context.stage.replace("_", " ")}
            </span>
          </div>
          <p className="text-sm text-[var(--text-primary)] leading-relaxed">
            {buildHeroTakeaway(report)}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
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
            <ArrowRight className="h-4 w-4 text-[var(--studio-mint)]" aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" onClick={onNewUpload}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            New Mix
          </Button>
        </div>
      </div>

      {/* Studio Deck: Tactile Spinning Disc Player + Live 60fps 48-Band Spectral Graph */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SpinningDiscPlayer
            title={report.audio_metadata.filename}
            subtitle={`${(report.audio_metadata.sample_rate_hz / 1000).toFixed(1)} kHz · ${report.audio_metadata.bit_depth}-bit · ${report.audio_metadata.channels === 2 ? "Stereo" : "Mono"}`}
            genre={report.context.genre}
            health={overallHealth(report)}
            lufs={m.integrated_lufs}
            truePeak={m.true_peak_dbtp}
            bpm={report.audio_metadata.bpm ?? null}
            onTogglePlay={hasAudio ? onTogglePlay : undefined}
          />
        </div>
        <div className="flex flex-col justify-between gap-4 lg:col-span-7">
          <LiveSpectralGraph spectralBands={report.spectral_bands} height={192} />

          {/* Measured Telemetry Strip (Single-Line Tabular Alignment) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="min-w-0 bg-[var(--bg-elevated)] p-3.5 hairline-border squircle-inner">
              <div className="text-[11px] font-medium text-[var(--text-secondary)]">
                Integrated Loudness
              </div>
              <div className="mt-1 whitespace-nowrap text-lg font-semibold text-[var(--text-primary)] tabular-telemetry">
                {m.integrated_lufs.toFixed(1)}{" "}
                <span className="text-[11px] font-normal text-[var(--text-muted)]">LUFS</span>
              </div>
            </div>
            <div className="min-w-0 bg-[var(--bg-elevated)] p-3.5 hairline-border squircle-inner">
              <div className="text-[11px] font-medium text-[var(--text-secondary)]">
                4x True Peak
              </div>
              <div className={`mt-1 whitespace-nowrap text-lg font-semibold tabular-telemetry ${truePeakTone}`}>
                {m.true_peak_dbtp >= 0
                  ? `+${m.true_peak_dbtp.toFixed(2)}`
                  : m.true_peak_dbtp.toFixed(2)}{" "}
                <span className="text-[11px] font-normal text-[var(--text-muted)]">dBTP</span>
              </div>
            </div>
            <div className="min-w-0 bg-[var(--bg-elevated)] p-3.5 hairline-border squircle-inner">
              <div className="text-[11px] font-medium text-[var(--text-secondary)]">PLR / LRA</div>
              <div className="mt-1 whitespace-nowrap text-lg font-semibold text-[var(--text-primary)] tabular-telemetry">
                {plr.toFixed(1)}{" "}
                <span className="text-[11px] font-normal text-[var(--text-muted)]">
                  dB / {m.loudness_range_lu.toFixed(1)} LU
                </span>
              </div>
            </div>
            <div className="min-w-0 bg-[var(--bg-elevated)] p-3.5 hairline-border squircle-inner">
              <div className="text-[11px] font-medium text-[var(--text-secondary)]">
                Phase Correlation
              </div>
              <div
                className={`mt-1 whitespace-nowrap text-lg font-semibold tabular-telemetry ${
                  m.phase_correlation_avg < 0
                    ? "text-[var(--studio-vermilion)]"
                    : m.phase_correlation_avg < 0.35
                      ? "text-[var(--studio-amber)]"
                      : "text-[var(--studio-mint)]"
                }`}
              >
                {m.phase_correlation_avg >= 0 ? "+" : ""}
                {m.phase_correlation_avg.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Flaw Timeline Bar */}
      <FlawTimelineBar
        peaks={report.audio_metadata.waveform_peaks}
        durationSec={report.audio_metadata.duration_sec}
        clippingTimestamps={report.audio_metadata.clipping_timestamps_sec}
        findings={report.findings}
        bpm={report.audio_metadata.bpm ?? null}
        sections={report.audio_metadata.sections ?? []}
        onSelectFinding={(f) => {
          onSelectFinding(f);
          onAuditionFinding(f);
        }}
      />

      {/* Multi-Platform Loudness Normalization Preview */}
      <div className="bg-[var(--bg-elevated)] p-4 hairline-border squircle-outer space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold text-[var(--text-primary)]">
              Platform Loudness Normalization Preview
            </h2>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Preview playback gain adjustment &amp; headroom margin across streaming / DJ targets
            </p>
          </div>
          <div className="inline-flex flex-wrap gap-1 bg-[var(--bg-inset)] p-1 hairline-border squircle-inner">
            {STREAMING_TARGETS.map((t) => {
              const active = t.id === selectedPlatform;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedPlatform(t.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium squircle-inner cursor-pointer transition-colors ${
                    active
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] hairline-border"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {t.label} ({t.targetLufs})
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-inset)] px-3.5 py-2.5 text-xs squircle-inner">
          <div className="flex flex-wrap items-center gap-3 tabular-telemetry text-[var(--text-secondary)]">
            <span>
              Applied gain:{" "}
              <strong className="text-[var(--text-primary)]">
                {normGainDb >= 0 ? "+" : ""}
                {normGainDb.toFixed(1)} dB
              </strong>
            </span>
            <span>·</span>
            <span>
              Projected peak:{" "}
              <strong className={limiterEngaged ? "text-[var(--studio-amber)]" : "text-[var(--studio-mint)]"}>
                {projectedPeakDbtp >= 0 ? "+" : ""}
                {projectedPeakDbtp.toFixed(2)} dBTP
              </strong>
            </span>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
              limiterEngaged ? "text-[var(--studio-amber)]" : "text-[var(--studio-mint)]"
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
            completedRepairSteps={completedRepairSteps}
            onToggleRepairStep={onToggleRepairStep}
            onSelect={onSelectFinding}
            onAudition={onAuditionFinding}
            onRecheck={onRecheckFinding}
            onFixInDaw={onFixInDaw}
            onToggleCorrectiveEq={onToggleCorrectiveEq}
          />
        ))}
      </div>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-elevated)] px-5 py-4 hairline-border squircle-outer">
        <div className="text-xs text-[var(--text-secondary)]">
          Inspect full 6-band spectral plots, stereo vectorscope, and phase correlation timelines in Advanced Mix Check.
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-secondary)] tabular-telemetry">
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

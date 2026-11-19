"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, Radio } from "lucide-react";
import type { CorrectiveEqConfig } from "@/audio/StudioAudioEngine";
import { FindingCard } from "@/components/FindingCard";
import { DiagnosticCharts } from "@/components/advanced/DiagnosticCharts";
import { FlawTimelineBar } from "@/components/studio/FlawTimelineBar";
import { LiveSpectralGraph } from "@/components/studio/LiveSpectralGraph";
import type { AnalysisReport, Finding } from "@/types/report";

interface AdvancedWorkbenchProps {
  report: AnalysisReport;
  hasAudio?: boolean;
  activeFindingId: string | null;
  activeCorrectiveEqId?: string | null;
  completedRepairSteps?: Record<string, boolean>;
  onToggleRepairStep?: (stepId: string, checked: boolean) => void;
  loopEnabled: boolean;
  loopStartSec: number;
  loopEndSec: number;
  onSeek: (timeSec: number) => void;
  onSelectFinding: (finding: Finding) => void;
  onAuditionFinding: (finding: Finding) => void;
  onRecheckFinding?: (finding: Finding) => void;
  onToggleCorrectiveEq?: (eq: CorrectiveEqConfig) => void;
}

export function AdvancedWorkbench({
  report,
  hasAudio = true,
  activeFindingId,
  activeCorrectiveEqId = null,
  completedRepairSteps = {},
  onToggleRepairStep,
  onSeek,
  onSelectFinding,
  onAuditionFinding,
  onRecheckFinding,
  onToggleCorrectiveEq,
}: AdvancedWorkbenchProps) {
  const m = report.global_metrics;
  const plr = m.plr_db ?? Math.max(0, m.true_peak_dbtp - m.integrated_lufs);
  const subCorr = m.low_end_phase_correlation;
  const isLocalPreview = report.analysis_source === "local_web_audio_preview";
  const spotifyEst = report.streaming_estimates.find((s) =>
    s.platform.toLowerCase().includes("spotify")
  );
  const spotifyGain =
    spotifyEst?.estimated_gain_db ?? Number((-14.0 - m.integrated_lufs).toFixed(2));
  const spotifyWarning = Boolean(spotifyEst?.limiter_engaged_warning);

  return (
    <div className="mx-auto max-w-[1380px] py-4 space-y-4">
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

      {/* Five Core Deterministic Telemetry Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="min-w-0 bg-[var(--bg-elevated)] p-4 hairline-border squircle-inner">
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">Integrated LUFS</div>
          <div className="mt-1 whitespace-nowrap text-xl font-semibold text-[var(--text-primary)] tabular-telemetry">
            {m.integrated_lufs.toFixed(1)}{" "}
            <span className="text-xs font-normal text-[var(--text-muted)]">LUFS</span>
          </div>
          <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)] tabular-telemetry">
            ST Max {m.short_term_max_lufs.toFixed(1)} · Mom {m.momentary_max_lufs.toFixed(1)}
          </div>
        </div>

        <div className="min-w-0 bg-[var(--bg-elevated)] p-4 hairline-border squircle-inner">
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">4x True Peak</div>
          <div
            className={`mt-1 whitespace-nowrap text-xl font-semibold tabular-telemetry ${
              m.true_peak_dbtp > -0.1
                ? "text-[var(--studio-vermilion)]"
                : report.context.stage === "unmastered_mix" && m.true_peak_dbtp > -2.5
                  ? "text-[var(--studio-amber)]"
                  : "text-[var(--studio-mint)]"
            }`}
          >
            {m.true_peak_dbtp >= 0 ? "+" : ""}
            {m.true_peak_dbtp.toFixed(2)}{" "}
            <span className="text-xs font-normal text-[var(--text-muted)]">dBTP</span>
          </div>
          <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)] tabular-telemetry">
            Sample peak {m.sample_peak_dbfs >= 0 ? "+" : ""}
            {m.sample_peak_dbfs.toFixed(2)} dBFS
          </div>
        </div>

        <div className="min-w-0 bg-[var(--bg-elevated)] p-4 hairline-border squircle-inner">
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">PLR / LRA</div>
          <div className="mt-1 whitespace-nowrap text-xl font-semibold text-[var(--text-primary)] tabular-telemetry">
            {plr.toFixed(1)} <span className="text-xs font-normal text-[var(--text-muted)]">dB</span>
            <span className="mx-1 text-[var(--text-muted)]">/</span>
            {m.loudness_range_lu.toFixed(1)}{" "}
            <span className="text-xs font-normal text-[var(--text-muted)]">LU</span>
          </div>
          <div
            className="mt-1 truncate text-[11px] text-[var(--text-secondary)] tabular-telemetry"
            title={`PSR ${m.psr_db.toFixed(1)} dB · Crest ${m.crest_factor_db.toFixed(1)} dB${
              typeof m.transient_punch_db === "number" && m.transient_punch_db > 0
                ? ` · Punch ${m.transient_punch_db.toFixed(1)} dB`
                : ""
            }`}
          >
            PSR {m.psr_db.toFixed(1)} · Crest {m.crest_factor_db.toFixed(1)}
            {typeof m.transient_punch_db === "number" && m.transient_punch_db > 0
              ? ` · Punch ${m.transient_punch_db.toFixed(1)} dB`
              : " dB"}
          </div>
        </div>

        <div className="min-w-0 bg-[var(--bg-elevated)] p-4 hairline-border squircle-inner">
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">Stereo &amp; Sub Phase</div>
          <div
            className={`mt-1 whitespace-nowrap text-xl font-semibold tabular-telemetry ${
              m.phase_correlation_avg < 0
                ? "text-[var(--studio-vermilion)]"
                : m.phase_correlation_avg < 0.35
                  ? "text-[var(--studio-amber)]"
                  : "text-[var(--studio-mint)]"
            }`}
          >
            {m.phase_correlation_avg >= 0 ? "+" : ""}
            {m.phase_correlation_avg.toFixed(2)}
            {typeof subCorr === "number" && (
              <span
                className={`ml-1.5 text-xs font-medium ${
                  subCorr < 0.3 ? "text-[var(--studio-amber)]" : "text-[var(--text-secondary)]"
                }`}
              >
                (Sub {subCorr >= 0 ? "+" : ""}
                {subCorr.toFixed(2)})
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)] tabular-telemetry">
            M/S width {m.stereo_width_ratio.toFixed(2)} · 20–120 Hz bandpass
          </div>
        </div>

        <div
          className="min-w-0 bg-[var(--bg-elevated)] p-4 hairline-border squircle-inner"
          title={
            spotifyEst?.assumption_note ||
            "Estimated under Spotify Normal (-14 LUFS) target with -1.0 dBTP limiter check."
          }
        >
          <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-[var(--text-secondary)]">
            <span className="truncate">Spotify -14 LUFS Est.</span>
            {spotifyWarning ? (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--studio-amber)]" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--studio-mint)]" aria-hidden="true" />
            )}
          </div>
          <div
            className={`mt-1 whitespace-nowrap text-xl font-semibold tabular-telemetry ${
              spotifyWarning ? "text-[var(--studio-amber)]" : "text-[var(--text-primary)]"
            }`}
          >
            {spotifyGain >= 0 ? "+" : ""}
            {spotifyGain.toFixed(1)}{" "}
            <span className="text-xs font-normal text-[var(--text-muted)]">dB</span>
          </div>
          <div className="mt-1 line-clamp-1 text-[11px] text-[var(--text-secondary)]">
            {spotifyWarning
              ? "Normal mode (-14): limiter risk"
              : "Assumes Normal -14 LUFS target"}
          </div>
        </div>
      </div>

      {/* Studio Asymmetric Two-Column Workbench */}
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <FlawTimelineBar
            peaks={report.audio_metadata.waveform_peaks}
            durationSec={report.audio_metadata.duration_sec}
            clippingTimestamps={report.audio_metadata.clipping_timestamps_sec}
            findings={report.findings}
            bpm={report.audio_metadata.bpm ?? null}
            sections={report.audio_metadata.sections ?? []}
            onSelectFinding={(finding) => onAuditionFinding(finding)}
          />

          <LiveSpectralGraph spectralBands={report.spectral_bands} height={184} />

          <DiagnosticCharts report={report} onSeek={onSeek} />
        </div>

        <aside className="lg:col-span-4">
          <div className="sticky top-[74px] bg-[var(--bg-surface)] p-4 hairline-border squircle-outer space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Prioritized Evidence ({report.findings.length})
              </h2>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {hasAudio ? "Click any card to audition" : "Telemetry-only archive"}
              </span>
            </div>

            <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
              {report.findings.map((finding, idx) => (
                <FindingCard
                  key={finding.evidence_id}
                  finding={finding}
                  index={idx}
                  compact
                  hasAudio={hasAudio}
                  isActive={activeFindingId === finding.evidence_id}
                  isEqActive={activeCorrectiveEqId === finding.evidence_id}
                  completedRepairSteps={completedRepairSteps}
                  onToggleRepairStep={onToggleRepairStep}
                  onSelect={onSelectFinding}
                  onAudition={onAuditionFinding}
                  onRecheck={onRecheckFinding}
                  onToggleCorrectiveEq={onToggleCorrectiveEq}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

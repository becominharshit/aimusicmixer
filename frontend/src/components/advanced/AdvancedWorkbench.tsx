"use client";

import React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { CorrectiveEqConfig } from "@/audio/StudioAudioEngine";
import { FindingCard } from "@/components/FindingCard";
import { DiagnosticCharts } from "@/components/advanced/DiagnosticCharts";
import { WaveformStage } from "@/components/advanced/WaveformStage";
import type { AnalysisReport, Finding } from "@/types/report";

interface AdvancedWorkbenchProps {
  report: AnalysisReport;
  hasAudio?: boolean;
  activeFindingId: string | null;
  activeCorrectiveEqId?: string | null;
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
  loopEnabled,
  loopStartSec,
  loopEndSec,
  onSeek,
  onSelectFinding,
  onAuditionFinding,
  onRecheckFinding,
  onToggleCorrectiveEq,
}: AdvancedWorkbenchProps) {
  const m = report.global_metrics;
  const plr = m.plr_db ?? Math.max(0, m.true_peak_dbtp - m.integrated_lufs);
  const subCorr = m.low_end_phase_correlation;
  const spotifyEst = report.streaming_estimates.find((s) =>
    s.platform.toLowerCase().includes("spotify")
  );
  const spotifyGain =
    spotifyEst?.estimated_gain_db ?? Number((-14.0 - m.integrated_lufs).toFixed(2));
  const spotifyWarning = Boolean(spotifyEst?.limiter_engaged_warning);

  return (
    <div className="mx-auto max-w-[1380px] py-4 space-y-4">
      {/* Five Core Deterministic Telemetry Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
          <div className="text-[11px] font-medium text-[#52605D]">Integrated LUFS</div>
          <div className="mt-1 text-xl font-semibold text-[#182220] tabular-telemetry">
            {m.integrated_lufs.toFixed(1)}{" "}
            <span className="text-xs font-normal text-[#52605D]">LUFS</span>
          </div>
          <div className="mt-1 text-[11px] text-[#52605D] tabular-telemetry">
            ST Max {m.short_term_max_lufs.toFixed(1)} · Mom {m.momentary_max_lufs.toFixed(1)}
          </div>
        </div>

        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
          <div className="text-[11px] font-medium text-[#52605D]">4x True Peak</div>
          <div
            className={`mt-1 text-xl font-semibold tabular-telemetry ${
              m.true_peak_dbtp > -0.1
                ? "text-[#BE123C]"
                : report.context.stage === "unmastered_mix" && m.true_peak_dbtp > -2.5
                  ? "text-[#B45309]"
                  : "text-[#15803D]"
            }`}
          >
            {m.true_peak_dbtp >= 0 ? "+" : ""}
            {m.true_peak_dbtp.toFixed(2)}{" "}
            <span className="text-xs font-normal text-[#52605D]">dBTP</span>
          </div>
          <div className="mt-1 text-[11px] text-[#52605D] tabular-telemetry">
            Sample peak {m.sample_peak_dbfs >= 0 ? "+" : ""}
            {m.sample_peak_dbfs.toFixed(2)} dBFS
          </div>
        </div>

        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
          <div className="text-[11px] font-medium text-[#52605D]">PLR / LRA</div>
          <div className="mt-1 text-xl font-semibold text-[#182220] tabular-telemetry">
            {plr.toFixed(1)} <span className="text-xs font-normal text-[#52605D]">dB</span>
            <span className="mx-1 text-[#52605D]/40">/</span>
            {m.loudness_range_lu.toFixed(1)}{" "}
            <span className="text-xs font-normal text-[#52605D]">LU</span>
          </div>
          <div className="mt-1 text-[11px] text-[#52605D] tabular-telemetry">
            PSR {m.psr_db.toFixed(1)} dB · Crest {m.crest_factor_db.toFixed(1)} dB
            {typeof m.transient_punch_db === "number" && m.transient_punch_db > 0
              ? ` · Punch ${m.transient_punch_db.toFixed(1)} dB`
              : ""}
          </div>
        </div>

        <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
          <div className="text-[11px] font-medium text-[#52605D]">Stereo &amp; Sub Phase</div>
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
            {typeof subCorr === "number" && (
              <span
                className={`ml-1.5 text-xs font-medium ${
                  subCorr < 0.3 ? "text-[#B45309]" : "text-[#52605D]"
                }`}
              >
                (Sub {subCorr >= 0 ? "+" : ""}
                {subCorr.toFixed(2)})
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-[#52605D] tabular-telemetry">
            M/S width {m.stereo_width_ratio.toFixed(2)} · 20–120 Hz bandpass
          </div>
        </div>

        <div
          className="bg-[#FFFFFF] p-4 hairline-border squircle-inner"
          title={
            spotifyEst?.assumption_note ||
            "Estimated under Spotify Normal (-14 LUFS) target with -1.0 dBTP limiter check."
          }
        >
          <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-[#52605D]">
            <span>Spotify -14 LUFS Est.</span>
            {spotifyWarning ? (
              <AlertTriangle className="h-3.5 w-3.5 text-[#B45309]" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-[#15803D]" aria-hidden="true" />
            )}
          </div>
          <div
            className={`mt-1 text-xl font-semibold tabular-telemetry ${
              spotifyWarning ? "text-[#B45309]" : "text-[#182220]"
            }`}
          >
            {spotifyGain >= 0 ? "+" : ""}
            {spotifyGain.toFixed(1)}{" "}
            <span className="text-xs font-normal text-[#52605D]">dB</span>
          </div>
          <div className="mt-1 line-clamp-1 text-[11px] text-[#52605D]">
            {spotifyWarning
              ? "Normal mode (-14): limiter risk"
              : "Assumes Normal -14 LUFS target"}
          </div>
        </div>
      </div>

      {/* Studio Asymmetric Two-Column Workbench */}
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <WaveformStage
            peaks={report.audio_metadata.waveform_peaks}
            durationSec={report.audio_metadata.duration_sec}
            bpm={report.audio_metadata.bpm}
            sections={report.audio_metadata.sections}
            findings={report.findings}
            activeFindingId={activeFindingId}
            loopEnabled={loopEnabled}
            loopStartSec={loopStartSec}
            loopEndSec={loopEndSec}
            onSeek={onSeek}
            onSelectFinding={(finding) => onAuditionFinding(finding)}
          />

          <DiagnosticCharts report={report} onSeek={onSeek} />
        </div>

        <aside className="lg:col-span-4">
          <div className="sticky top-[74px] bg-[#F5F5F7] p-4 hairline-border squircle-outer space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#182220]">
                Prioritized Evidence ({report.findings.length})
              </h2>
              <span className="text-[11px] text-[#52605D]">
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

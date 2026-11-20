"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  GitCompare,
  Headphones,
  ImageDown,
  Minus,
  RotateCcw,
  Scale,
  Sparkles,
  Upload,
} from "lucide-react";
import type { AudioSourceSlot } from "@/audio/StudioAudioEngine";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { downloadScorecardPng } from "@/lib/scorecardPng";
import type { SavedAnalysisRecord } from "@/lib/supabase/storage";
import type { AnalysisReport } from "@/types/report";

interface RevisionInspectorProps {
  report: AnalysisReport;
  activeSource?: AudioSourceSlot;
  matchLoudness?: boolean;
  loudnessOffsetDb?: number;
  hasBaselineAudio?: boolean;
  hasRevisedAudio?: boolean;
  isUploading: boolean;
  errorMessage: string | null;
  onUploadRevision: (file: File) => void | Promise<void>;
  onLoadDemoRevision: () => void | Promise<void>;
  onAuditionRevised: () => void;
  onAuditionBaseline?: () => void;
  onToggleMatchLoudness?: (val: boolean) => void;
  savedAnalyses?: SavedAnalysisRecord[];
  onCompareWithSavedBaseline?: (baselineReport: AnalysisReport) => void;
}

export function RevisionInspector({
  report,
  activeSource = "primary",
  matchLoudness = true,
  loudnessOffsetDb = 0,
  hasBaselineAudio = true,
  hasRevisedAudio = false,
  isUploading,
  errorMessage,
  onUploadRevision,
  onLoadDemoRevision,
  onAuditionRevised,
  onAuditionBaseline,
  onToggleMatchLoudness,
  savedAnalyses = [],
  onCompareWithSavedBaseline,
}: RevisionInspectorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const lastActionRef = useRef<"demo" | "upload" | null>(null);
  const [localComparing, setLocalComparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setLocalComparing(false);
    setLocalError(null);
  }, [report.report_id]);

  const handleLoadDemoSafe = async () => {
    lastActionRef.current = "demo";
    setLocalError(null);
    setLocalComparing(true);
    try {
      await onLoadDemoRevision();
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Sample revision comparison failed. Please retry."
      );
    } finally {
      setLocalComparing(false);
    }
  };

  const handleUploadSafe = async (file: File) => {
    lastActionRef.current = "upload";
    lastFileRef.current = file;
    setLocalError(null);
    setLocalComparing(true);
    try {
      await onUploadRevision(file);
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Revision comparison failed. Please retry."
      );
    } finally {
      setLocalComparing(false);
    }
  };

  const combinedUploading = isUploading || localComparing;
  const combinedError = errorMessage || localError;
  const comp = report.revision_comparison;
  const comparableSaved = savedAnalyses.filter(
    (item) => item.report_json.report_id !== report.report_id
  );

  return (
    <div className="mx-auto max-w-[1140px] py-4 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 bg-[var(--bg-elevated)] p-5 hairline-border squircle-outer">
        <div className="max-w-2xl space-y-1.5">
          <div className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
            <GitCompare className="h-4 w-4 text-[var(--studio-mint)]" aria-hidden="true" />
            <h1>Revision Check (v1 → v2)</h1>
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            After adjusting EQ, bus headroom, or stereo width in your DAW, upload Mix v2 (or load our corrected demo bounce at -4.2 dBTP) to verify deterministic deltas and A/B audition the fix.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".wav,.flac,.mp3,.aiff,.aif,.ogg,.m4a,.aac"
          className="sr-only"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            e.target.value = "";
            if (selected) void handleUploadSafe(selected);
          }}
        />
        <div className="no-print flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={combinedUploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {combinedUploading ? "Comparing v2..." : comp ? "Upload Newer Revision" : "Upload Revised Mix"}
          </Button>
          {!comp && (
            <Button
              type="button"
              variant="soft"
              size="sm"
              disabled={combinedUploading}
              onClick={() => void handleLoadDemoSafe()}
            >
              <Sparkles className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
              {combinedUploading && lastActionRef.current === "demo"
                ? "Comparing v2..."
                : "Load Sample Revised Mix (v2)"}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="export-scorecard-png-btn"
            onClick={() => void downloadScorecardPng(report)}
          >
            <ImageDown className="h-3.5 w-3.5 text-[#F0B44C]" aria-hidden="true" />
            Export Scorecard PNG
          </Button>
        </div>
      </div>

      {combinedError && (
        <div
          role="alert"
          data-testid="revision-error-alert"
          className="flex flex-wrap items-center justify-between gap-3 bg-[var(--studio-vermilion-soft)] p-4 text-xs text-[var(--studio-vermilion)] border border-[var(--studio-vermilion)]/35 squircle-inner"
        >
          <span>{combinedError}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={combinedUploading}
            onClick={() => {
              if (lastActionRef.current === "upload" && lastFileRef.current) {
                void handleUploadSafe(lastFileRef.current);
              } else {
                void handleLoadDemoSafe();
              }
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry Comparison
          </Button>
        </div>
      )}

      {!comp ? (
        <div className="bg-[var(--bg-surface)] p-8 text-center hairline-border squircle-outer space-y-4">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Ready for v1 → v2 verification
            </h2>
            <p className="mx-auto max-w-md text-xs text-[var(--text-secondary)]">
              Click &ldquo;Load Sample Revised Mix (v2)&rdquo; to compare against our calibrated -4.2 dBTP / 250 Hz-cleaned fixture, or upload your own revised bounce.
            </p>
          </div>
          {comparableSaved.length > 0 && onCompareWithSavedBaseline && (
            <div className="mx-auto max-w-xl bg-[var(--bg-elevated)] p-4 text-left hairline-border squircle-inner space-y-2.5">
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Compare Current Mix ({report.audio_metadata.filename}) Against Saved History (v1 Baseline)
              </div>
              <div className="flex flex-wrap gap-2">
                {comparableSaved.slice(0, 6).map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isUploading}
                    onClick={() => onCompareWithSavedBaseline(item.report_json)}
                  >
                    <GitCompare className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                    {item.track_name} ({item.version_label})
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-elevated)] p-4 hairline-border squircle-outer">
            <div className="flex flex-wrap items-center gap-2">
              {onAuditionBaseline && (
                <Button
                  type="button"
                  variant={activeSource === "primary" ? "primary" : "secondary"}
                  size="sm"
                  disabled={!hasBaselineAudio}
                  title={
                    hasBaselineAudio
                      ? `Audition Baseline v1 (${comp.baseline_filename})`
                      : "Baseline v1 audio proxy unavailable for archived telemetry comparison"
                  }
                  onClick={onAuditionBaseline}
                >
                  <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
                  A: Baseline v1 ({comp.baseline_filename})
                </Button>
              )}
              <Button
                type="button"
                variant={activeSource === "revised" ? "primary" : "secondary"}
                size="sm"
                disabled={!hasRevisedAudio && !comp.revised_playback_proxy_url}
                onClick={onAuditionRevised}
              >
                <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
                B: Revised v2 ({comp.revised_filename})
              </Button>
            </div>

            {onToggleMatchLoudness && (
              <div className="inline-flex items-center gap-2 bg-[var(--bg-inset)] px-3 py-1.5 text-xs hairline-border squircle-inner">
                <Scale className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                <span className="font-medium text-[var(--text-primary)]">Match LUFS v1 ↔ v2</span>
                <span className="text-[var(--studio-mint)] tabular-telemetry">
                  {matchLoudness
                    ? `${loudnessOffsetDb >= 0 ? "+" : ""}${loudnessOffsetDb.toFixed(1)} dB`
                    : "Unmatched"}
                </span>
                <Switch
                  checked={matchLoudness}
                  onCheckedChange={onToggleMatchLoudness}
                  aria-label="Toggle Revision v1 v2 LUFS match"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "Δ Integrated LUFS", val: comp.metric_deltas.integrated_lufs_delta, unit: "LU" },
              { label: "Δ True Peak", val: comp.metric_deltas.true_peak_dbtp_delta, unit: "dBTP" },
              { label: "Δ PLR / PSR", val: comp.metric_deltas.psr_db_delta, unit: "dB" },
              { label: "Δ Loudness Range", val: comp.metric_deltas.loudness_range_lu_delta, unit: "LU" },
              { label: "Δ Phase Correlation", val: comp.metric_deltas.phase_correlation_delta, unit: "" },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-[var(--bg-elevated)] p-4 hairline-border squircle-inner"
              >
                <div className="text-[11px] text-[var(--text-secondary)]">{item.label}</div>
                <div className="mt-1 text-base font-semibold text-[var(--text-primary)] tabular-telemetry">
                  {item.val >= 0 ? "+" : ""}
                  {item.val.toFixed(2)} {item.unit}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              Finding Status Shifts ({comp.baseline_filename} → {comp.revised_filename})
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {comp.finding_statuses.map((fs) => {
                const badgeStyle =
                  fs.status === "improved"
                    ? "bg-[var(--studio-mint-soft)] text-[var(--studio-mint)]"
                    : fs.status === "regressed"
                      ? "bg-[var(--studio-vermilion-soft)] text-[var(--studio-vermilion)]"
                      : "bg-[var(--bg-inset)] text-[var(--text-secondary)]";
                const Icon =
                  fs.status === "improved"
                    ? ArrowUpRight
                    : fs.status === "regressed"
                      ? ArrowDownRight
                      : Minus;

                return (
                  <div
                    key={fs.evidence_id}
                    className="bg-[var(--bg-elevated)] p-4 hairline-border squircle-inner space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{fs.title}</span>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold capitalize squircle-inner ${badgeStyle}`}
                      >
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {fs.status}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">{fs.summary}</p>
                    <div className="text-[11px] text-[var(--text-muted)] tabular-telemetry">
                      v1: {fs.baseline_value} · v2: {fs.revised_value}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

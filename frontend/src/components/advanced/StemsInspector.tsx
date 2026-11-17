"use client";

import React, { useRef } from "react";
import { AlertCircle, CheckCircle2, Layers, Lock, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisReport } from "@/types/report";

interface StemsInspectorProps {
  report: AnalysisReport;
  isUploading: boolean;
  errorMessage: string | null;
  onUploadStems: (files: File[]) => void;
  onLoadDemoStems: () => void;
}

export function StemsInspector({
  report,
  isUploading,
  errorMessage,
  onUploadStems,
  onLoadDemoStems,
}: StemsInspectorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stems = report.stem_analysis;

  // Hard Guardrail (Pillar 1 & Phase 4 Task 5): Never synthesize stem metrics from a stereo mix!
  if (!report.context.has_user_stems || !stems) {
    return (
      <div className="space-y-4">
        <div className="bg-[#F5F5F7] p-4 hairline-border squircle-inner space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#182220]">
            <Lock className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
            <span>Stem Matrix Locked — Stereo Mix Only</span>
          </div>
          <p className="text-xs leading-relaxed text-[#52605D]">
            MixBench enforces <strong>zero AI stem separation</strong>. Instrument-level overlap and
            per-track headroom cannot be fabricated from a stereo mixdown. Upload 2–8 aligned original
            stems from your DAW (bar 1 bounce, up to 350 MB total) to unlock pairwise overlap diagnostics.
          </p>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".wav,.flac,.mp3,.aiff,.aif,.ogg"
            className="sr-only"
            onChange={(e) => {
              const list = e.target.files ? Array.from(e.target.files) : [];
              if (list.length > 0) onUploadStems(list);
            }}
          />

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isUploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {isUploading ? "Analyzing Stems..." : "Upload 2–8 Stems"}
            </Button>
            <Button
              type="button"
              variant="soft"
              size="sm"
              disabled={isUploading}
              onClick={onLoadDemoStems}
            >
              <Sparkles className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
              Load 4 Demo Stems
            </Button>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2 bg-[#FFF1F3] p-3 text-xs text-[#BE123C] border border-[rgba(190,18,60,0.22)] squircle-inner"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Alignment Status Banner */}
      <div
        className={`p-3.5 text-xs squircle-inner border ${
          stems.alignment_passed
            ? "bg-[#ECFDF3] border-[rgba(21,128,61,0.22)] text-[#15803D]"
            : "bg-[#FFF1F3] border-[rgba(190,18,60,0.25)] text-[#BE123C]"
        }`}
      >
        <div className="flex items-center justify-between gap-2 font-semibold">
          <span className="inline-flex items-center gap-1.5">
            {stems.alignment_passed ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {stems.alignment_passed ? "Stem Alignment Verified" : "Stem Alignment Warning"}
          </span>
          <span className="tabular-telemetry">
            Delta {stems.max_duration_delta_ms.toFixed(1)} ms
          </span>
        </div>
        {stems.alignment_warnings.map((w) => (
          <p key={w} className="mt-1.5 leading-relaxed">
            {w}
          </p>
        ))}
      </div>

      {/* Per-Stem Telemetry Table */}
      <div className="bg-[#FFFFFF] p-3.5 hairline-border squircle-inner">
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#182220]">
            <Layers className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
            Uploaded Stems ({stems.stems.length})
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[rgba(24,34,32,0.08)] text-[11px] text-[#52605D]">
                <th className="py-1.5 pr-2 font-medium">Stem</th>
                <th className="py-1.5 px-2 font-medium">LUFS</th>
                <th className="py-1.5 px-2 font-medium">True Peak</th>
                <th className="py-1.5 pl-2 font-medium">Centroid</th>
              </tr>
            </thead>
            <tbody>
              {stems.stems.map((s) => (
                <tr key={s.stem_id} className="border-b border-[rgba(24,34,32,0.05)] last:border-0">
                  <td className="py-2 pr-2 font-medium text-[#182220]">{s.name}</td>
                  <td className="py-2 px-2 text-[#52605D] tabular-telemetry">
                    {s.integrated_lufs.toFixed(1)}
                  </td>
                  <td className="py-2 px-2 text-[#52605D] tabular-telemetry">
                    {s.true_peak_dbtp >= 0 ? "+" : ""}
                    {s.true_peak_dbtp.toFixed(1)}
                  </td>
                  <td className="py-2 pl-2 text-[#52605D] tabular-telemetry">
                    {Math.round(s.spectral_centroid_hz)} Hz
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pairwise Overlap Matrix */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-[#182220]">
          Potential Pairwise Frequency Overlap
        </div>
        {stems.overlap_matrix.length === 0 ? (
          <p className="bg-[#F5F5F7] p-3 text-xs text-[#52605D] squircle-inner">
            No strong simultaneous frequency overlap detected between uploaded stems.
          </p>
        ) : (
          stems.overlap_matrix.map((pair) => (
            <div
              key={pair.evidence_id}
              className="bg-[#FFFFFF] p-3 hairline-border squircle-inner space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#182220]">
                  {pair.stem_a} ↔ {pair.stem_b}
                </span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-semibold squircle-inner tabular-telemetry ${
                    pair.severity === "alert"
                      ? "bg-[#FFF1F3] text-[#BE123C]"
                      : "bg-[#FEF7EC] text-[#B45309]"
                  }`}
                >
                  {pair.range_hz} Hz · {(pair.overlap_score * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-[#52605D]">{pair.note}</p>
            </div>
          ))
        )}
      </div>

      {/* Stem-Sum Residual */}
      {stems.stem_sum_residual && (
        <div className="bg-[#F5F5F7] p-3.5 hairline-border squircle-inner space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-[#182220]">
            <span>Mix vs. Stem Sum Residual</span>
            <span className="tabular-telemetry text-[#3A7269]">
              r = {stems.stem_sum_residual.correlation_with_mix.toFixed(2)}
            </span>
          </div>
          <div className="text-[11px] text-[#182220] tabular-telemetry">
            RMS diff: {stems.stem_sum_residual.rms_diff_db >= 0 ? "+" : ""}
            {stems.stem_sum_residual.rms_diff_db.toFixed(2)} dB · Peak diff:{" "}
            {stems.stem_sum_residual.peak_diff_db >= 0 ? "+" : ""}
            {stems.stem_sum_residual.peak_diff_db.toFixed(2)} dB
          </div>
          <p className="text-[11px] text-[#52605D]">{stems.stem_sum_residual.note}</p>
        </div>
      )}
    </div>
  );
}

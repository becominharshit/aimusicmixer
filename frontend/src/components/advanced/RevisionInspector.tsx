"use client";

import React, { useRef } from "react";
import { ArrowDownRight, ArrowUpRight, GitCompare, Headphones, Minus, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisReport } from "@/types/report";

interface RevisionInspectorProps {
  report: AnalysisReport;
  isUploading: boolean;
  errorMessage: string | null;
  onUploadRevision: (file: File) => void;
  onLoadDemoRevision: () => void;
  onAuditionRevised: () => void;
}

export function RevisionInspector({
  report,
  isUploading,
  errorMessage,
  onUploadRevision,
  onLoadDemoRevision,
  onAuditionRevised,
}: RevisionInspectorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const comp = report.revision_comparison;

  return (
    <div className="space-y-4">
      <div className="bg-[#F5F5F7] p-4 hairline-border squircle-inner space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#182220]">
          <GitCompare className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
          <span>Before / After Revision Delta (v1 vs v2)</span>
        </div>
        <p className="text-xs leading-relaxed text-[#52605D]">
          After tweaking EQ, bus headroom, or stereo width in your DAW, upload Mix v2 to measure
          exact metric shifts and audition v1 vs v2 seamlessly.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".wav,.flac,.mp3,.aiff,.aif,.ogg,.m4a"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.[0]) onUploadRevision(e.target.files[0]);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {isUploading ? "Comparing v2..." : comp ? "Upload Mix v3" : "Upload Revised Mix"}
          </Button>
          {!comp && (
            <Button
              type="button"
              variant="soft"
              size="sm"
              disabled={isUploading}
              onClick={onLoadDemoRevision}
            >
              <Sparkles className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
              Compare Demo v2
            </Button>
          )}
          {comp && (
            <Button type="button" variant="secondary" size="sm" onClick={onAuditionRevised}>
              <Headphones className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
              Audition v2
            </Button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="bg-[#FFF1F3] p-3 text-xs text-[#BE123C] border border-[rgba(190,18,60,0.22)] squircle-inner">
          {errorMessage}
        </div>
      )}

      {comp && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              {
                label: "Δ Integrated LUFS",
                val: comp.metric_deltas.integrated_lufs_delta,
                unit: "LU",
              },
              {
                label: "Δ True Peak",
                val: comp.metric_deltas.true_peak_dbtp_delta,
                unit: "dBTP",
              },
              {
                label: "Δ Loudness Range",
                val: comp.metric_deltas.loudness_range_lu_delta,
                unit: "LU",
              },
              {
                label: "Δ Phase Correlation",
                val: comp.metric_deltas.phase_correlation_delta,
                unit: "",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-[#FFFFFF] p-3 hairline-border squircle-inner"
              >
                <div className="text-[11px] text-[#52605D]">{item.label}</div>
                <div className="mt-0.5 text-sm font-semibold text-[#182220] tabular-telemetry">
                  {item.val >= 0 ? "+" : ""}
                  {item.val.toFixed(2)} {item.unit}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#182220]">
              Finding Status Shifts ({comp.baseline_filename} → {comp.revised_filename})
            </div>
            {comp.finding_statuses.map((fs) => {
              const badgeStyle =
                fs.status === "improved"
                  ? "bg-[#ECFDF3] text-[#15803D]"
                  : fs.status === "regressed"
                    ? "bg-[#FFF1F3] text-[#BE123C]"
                    : "bg-[#F5F5F7] text-[#52605D]";
              const Icon =
                fs.status === "improved"
                  ? ArrowUpRight
                  : fs.status === "regressed"
                    ? ArrowDownRight
                    : Minus;

              return (
                <div
                  key={fs.evidence_id}
                  className="bg-[#FFFFFF] p-3 hairline-border squircle-inner space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#182220]">{fs.title}</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold capitalize squircle-inner ${badgeStyle}`}
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {fs.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#52605D]">{fs.summary}</p>
                  <div className="text-[10px] text-[#52605D] tabular-telemetry">
                    v1: {fs.baseline_value} · v2: {fs.revised_value}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

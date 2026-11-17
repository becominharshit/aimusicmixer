"use client";

import React, { useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Headphones, Scale, Sparkles, Upload } from "lucide-react";
import type { AudioSourceSlot } from "@/audio/StudioAudioEngine";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatTimecode } from "@/lib/utils";
import type { AnalysisReport, ReferenceTrackMeta } from "@/types/report";

interface ReferenceABViewProps {
  report: AnalysisReport;
  referenceMeta: ReferenceTrackMeta | null;
  activeSource: AudioSourceSlot;
  matchLoudness: boolean;
  loudnessOffsetDb: number;
  isUploadingRef: boolean;
  onUploadReference: (file: File) => void;
  onLoadDemoReference: () => void;
  onChangeSource: (slot: AudioSourceSlot) => void;
  onToggleMatchLoudness: (val: boolean) => void;
  onAuditionWindow: (startSec: number, endSec: number) => void;
}

const BAND_SHORT: Record<string, string> = {
  sub: "Sub (20-60)",
  low: "Low (60-250)",
  low_mid: "LoMid (250-800)",
  high_mid: "HiMid (800-4k)",
  presence: "Pres (4k-10k)",
  air: "Air (10k-20k)",
};

export function ReferenceABView({
  report,
  referenceMeta,
  activeSource,
  matchLoudness,
  loudnessOffsetDb,
  isUploadingRef,
  onUploadReference,
  onLoadDemoReference,
  onChangeSource,
  onToggleMatchLoudness,
  onAuditionWindow,
}: ReferenceABViewProps) {
  const refInput = useRef<HTMLInputElement | null>(null);
  const m = report.global_metrics;
  const rm = referenceMeta?.global_metrics;

  const spectralCompare =
    referenceMeta?.spectral_bands && referenceMeta.spectral_bands.length > 0
      ? report.spectral_bands.map((sb) => {
          const rb = referenceMeta.spectral_bands?.find((x) => x.band === sb.band);
          return {
            label: BAND_SHORT[sb.band] || sb.band,
            mixDelta: sb.delta_vs_genre_median_db,
            refDelta: rb ? rb.delta_vs_genre_median_db : 0,
            bandDiff: rb
              ? Number((sb.delta_vs_genre_median_db - rb.delta_vs_genre_median_db).toFixed(2))
              : 0,
          };
        })
      : [];

  const rows = rm
    ? [
        {
          label: "Integrated Loudness",
          mix: `${m.integrated_lufs.toFixed(1)} LUFS`,
          ref: `${rm.integrated_lufs.toFixed(1)} LUFS`,
          delta: `${(m.integrated_lufs - rm.integrated_lufs) >= 0 ? "+" : ""}${(m.integrated_lufs - rm.integrated_lufs).toFixed(1)} LU`,
        },
        {
          label: "4x True Peak",
          mix: `${m.true_peak_dbtp >= 0 ? "+" : ""}${m.true_peak_dbtp.toFixed(2)} dBTP`,
          ref: `${rm.true_peak_dbtp >= 0 ? "+" : ""}${rm.true_peak_dbtp.toFixed(2)} dBTP`,
          delta: `${(m.true_peak_dbtp - rm.true_peak_dbtp) >= 0 ? "+" : ""}${(m.true_peak_dbtp - rm.true_peak_dbtp).toFixed(2)} dB`,
        },
        {
          label: "PLR (Peak-to-Loudness)",
          mix: `${(m.plr_db ?? Math.max(0, m.true_peak_dbtp - m.integrated_lufs)).toFixed(1)} dB`,
          ref: `${(rm.plr_db ?? Math.max(0, rm.true_peak_dbtp - rm.integrated_lufs)).toFixed(1)} dB`,
          delta: `${(((m.plr_db ?? Math.max(0, m.true_peak_dbtp - m.integrated_lufs)) - (rm.plr_db ?? Math.max(0, rm.true_peak_dbtp - rm.integrated_lufs))) >= 0 ? "+" : "")}${((m.plr_db ?? Math.max(0, m.true_peak_dbtp - m.integrated_lufs)) - (rm.plr_db ?? Math.max(0, rm.true_peak_dbtp - rm.integrated_lufs))).toFixed(1)} dB`,
        },
        {
          label: "PSR (Short-Term Crest)",
          mix: `${m.psr_db.toFixed(1)} dB`,
          ref: `${rm.psr_db.toFixed(1)} dB`,
          delta: `${(m.psr_db - rm.psr_db) >= 0 ? "+" : ""}${(m.psr_db - rm.psr_db).toFixed(1)} dB`,
        },
        {
          label: "Loudness Range (LRA)",
          mix: `${m.loudness_range_lu.toFixed(1)} LU`,
          ref: `${rm.loudness_range_lu.toFixed(1)} LU`,
          delta: `${(m.loudness_range_lu - rm.loudness_range_lu) >= 0 ? "+" : ""}${(m.loudness_range_lu - rm.loudness_range_lu).toFixed(1)} LU`,
        },
        {
          label: "Phase Correlation",
          mix: `${m.phase_correlation_avg >= 0 ? "+" : ""}${m.phase_correlation_avg.toFixed(2)}`,
          ref: `${rm.phase_correlation_avg >= 0 ? "+" : ""}${rm.phase_correlation_avg.toFixed(2)}`,
          delta: `${(m.phase_correlation_avg - rm.phase_correlation_avg) >= 0 ? "+" : ""}${(m.phase_correlation_avg - rm.phase_correlation_avg).toFixed(2)}`,
        },
        {
          label: "Stereo Width Ratio",
          mix: m.stereo_width_ratio.toFixed(2),
          ref: rm.stereo_width_ratio.toFixed(2),
          delta: `${(m.stereo_width_ratio - rm.stereo_width_ratio) >= 0 ? "+" : ""}${(m.stereo_width_ratio - rm.stereo_width_ratio).toFixed(2)}`,
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-[1140px] py-4 space-y-5">
      {/* Header & Upload Control */}
      <div className="flex flex-wrap items-start justify-between gap-4 bg-[#FFFFFF] p-5 hairline-border squircle-outer">
        <div className="max-w-2xl space-y-1.5">
          <h1 className="text-xl font-bold tracking-[-0.02em] text-[#182220]">
            Loudness-Matched Reference A/B
          </h1>
          <p className="text-xs text-[#52605D] leading-relaxed">
            Compare your mix against a commercial reference track matched by integrated ITU-R BS.1770 LUFS so perceived volume never biases your tonal or dynamic judgment.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={refInput}
            type="file"
            accept=".wav,.flac,.mp3,.aiff,.aif,.ogg,.m4a"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.[0]) onUploadReference(e.target.files[0]);
            }}
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={isUploadingRef}
            onClick={() => refInput.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {isUploadingRef
              ? "Analyzing Reference..."
              : referenceMeta
                ? "Swap Reference Track"
                : "Upload Reference Track"}
          </Button>
          {!referenceMeta && (
            <Button
              type="button"
              variant="soft"
              size="sm"
              disabled={isUploadingRef}
              onClick={onLoadDemoReference}
            >
              <Sparkles className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
              Load Balanced Demo Reference
            </Button>
          )}
        </div>
      </div>

      {!referenceMeta ? (
        <div className="bg-[#F5F5F7] p-8 text-center hairline-border squircle-outer space-y-3">
          <div className="mx-auto flex h-11 w-11 items-center justify-center bg-[#FFFFFF] text-[#3A7269] hairline-border squircle-inner">
            <Scale className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-[#182220]">
            No reference track loaded yet
          </h2>
          <p className="mx-auto max-w-md text-xs text-[#52605D] leading-relaxed">
            Upload any released track in {report.context.genre.replace("_", " ")} (or load our balanced demo reference) to auto-match LUFS and inspect side-by-side 6-band tonal &amp; dynamic deltas.
          </p>
        </div>
      ) : (
        <>
          {/* Click-Free A/B Audition Bar + Matched Section Shortcuts */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-[#FFFFFF] p-4 hairline-border squircle-outer">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                type="button"
                variant={activeSource === "primary" ? "primary" : "secondary"}
                size="sm"
                onClick={() => onChangeSource("primary")}
              >
                <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
                A: Your Mix ({report.audio_metadata.filename})
              </Button>
              <Button
                type="button"
                variant={activeSource === "reference" ? "primary" : "secondary"}
                size="sm"
                onClick={() => onChangeSource("reference")}
              >
                <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
                B: Reference ({referenceMeta.reference_filename})
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 bg-[#F5F5F7] px-3 py-1.5 text-xs hairline-border squircle-inner">
              <span className="font-medium text-[#182220]">Integrated-LUFS Auto Match</span>
              <span className="text-[#3A7269] tabular-telemetry">
                {matchLoudness
                  ? `Ref gain trim: ${loudnessOffsetDb >= 0 ? "+" : ""}${loudnessOffsetDb.toFixed(1)} dB`
                  : "Unmatched (0.0 dB)"}
              </span>
              <Switch
                checked={matchLoudness}
                onCheckedChange={onToggleMatchLoudness}
                aria-label="Toggle Reference LUFS match"
              />
            </div>
          </div>

          {/* Matched-Section Jump Pills */}
          {report.findings.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 bg-[#F5F5F7] px-4 py-3 hairline-border squircle-inner">
              <span className="text-xs font-semibold text-[#182220]">
                Audition Matched Sections:
              </span>
              {report.findings.slice(0, 4).map((f) => (
                <button
                  key={f.evidence_id}
                  type="button"
                  onClick={() =>
                    onAuditionWindow(
                      f.timestamp_start_sec,
                      Math.max(f.timestamp_start_sec + 4, f.timestamp_end_sec)
                    )
                  }
                  className="bg-[#FFFFFF] px-2.5 py-1 text-xs text-[#182220] hover:border-[rgba(58,114,105,0.4)] hairline-border squircle-inner cursor-pointer"
                >
                  <span className="tabular-telemetry font-medium text-[#3A7269]">
                    {formatTimecode(f.timestamp_start_sec)}
                  </span>{" "}
                  · {f.title}
                </button>
              ))}
            </div>
          )}

          {/* Side-by-Side Tonal Chart & Dynamic Telemetry Table */}
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="min-w-0 bg-[#FFFFFF] p-5 hairline-border squircle-outer lg:col-span-6">
              <h2 className="text-sm font-semibold text-[#182220]">
                6-Band Spectral Tilt: Your Mix vs. Reference B
              </h2>
              <p className="mb-3 text-xs text-[#52605D]">
                Gain-normalized dB relative to genre envelope
              </p>
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart
                    data={spectralCompare}
                    margin={{ top: 8, right: 8, left: -14, bottom: 8 }}
                  >
                    <CartesianGrid stroke="rgba(24,34,32,0.06)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#52605D", fontSize: 10 }}
                      axisLine={{ stroke: "rgba(24,34,32,0.08)" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#52605D", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      unit=" dB"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#FFFFFF",
                        border: "1px solid rgba(24,34,32,0.1)",
                        borderRadius: "12px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar
                      dataKey="mixDelta"
                      name="Your Mix A"
                      fill="#3A7269"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="refDelta"
                      name="Reference B"
                      fill="#9CA3AF"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer lg:col-span-6">
              <h2 className="text-sm font-semibold text-[#182220]">
                Side-by-Side Dynamic &amp; Stereo Deltas
              </h2>
              <p className="mb-3 text-xs text-[#52605D]">
                Objective telemetry comparison before master limiting adjustments
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[rgba(24,34,32,0.08)] text-[11px] text-[#52605D]">
                      <th className="py-2 pr-2 font-medium">Metric</th>
                      <th className="py-2 px-2 font-medium">Your Mix A</th>
                      <th className="py-2 px-2 font-medium">Reference B</th>
                      <th className="py-2 pl-2 font-medium">Mix − Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.label}
                        className="border-b border-[rgba(24,34,32,0.05)] last:border-0"
                      >
                        <td className="py-2 pr-2 font-medium text-[#182220]">{r.label}</td>
                        <td className="py-2 px-2 text-[#182220] tabular-telemetry">{r.mix}</td>
                        <td className="py-2 px-2 text-[#52605D] tabular-telemetry">{r.ref}</td>
                        <td className="py-2 pl-2 font-medium text-[#3A7269] tabular-telemetry">
                          {r.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

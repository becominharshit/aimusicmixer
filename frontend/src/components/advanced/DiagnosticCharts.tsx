"use client";

import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatTimecode } from "@/lib/utils";
import type { AnalysisReport } from "@/types/report";

interface DiagnosticChartsProps {
  report: AnalysisReport;
  onSeek: (timeSec: number) => void;
}

const BAND_SHORT_LABELS: Record<string, string> = {
  sub: "Sub",
  low: "Low",
  low_mid: "LoMid",
  high_mid: "HiMid",
  presence: "Pres",
  air: "Air",
};

export function DiagnosticCharts({ report, onSeek }: DiagnosticChartsProps) {
  const spectralData = report.spectral_bands.map((b) => ({
    shortLabel: BAND_SHORT_LABELS[b.band] || b.band,
    range: `${b.range_hz} Hz`,
    energy: b.energy_db,
    delta: b.delta_vs_genre_median_db,
    band: b.band,
  }));

  const timelineData = report.time_series.short_term_lufs.map((lufs, idx) => ({
    sec: idx * report.time_series.step_sec,
    timeLabel: formatTimecode(idx * report.time_series.step_sec),
    lufs,
    correlation: report.time_series.phase_correlation[idx] ?? 1.0,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {/* 6-Band Tonal Balance vs Genre Median */}
        <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#182220]">
                6-Band Tonal Balance vs. {report.context.genre.replace("_", " ")} Median
              </h3>
              <p className="text-xs text-[#52605D]">
                Gain-invariant relative dB deviation (±2.2 dB target zone)
              </p>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spectralData} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
                <CartesianGrid stroke="rgba(24,34,32,0.06)" vertical={false} />
                <XAxis
                  dataKey="shortLabel"
                  interval={0}
                  tick={{ fill: "#52605D", fontSize: 11 }}
                  axisLine={{ stroke: "rgba(24,34,32,0.08)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#52605D", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  unit=" dB"
                />
                <ReferenceLine y={0} stroke="rgba(24,34,32,0.25)" />
                <ReferenceLine y={2.5} stroke="rgba(180,83,9,0.35)" strokeDasharray="3 3" />
                <ReferenceLine y={-2.5} stroke="rgba(180,83,9,0.35)" strokeDasharray="3 3" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFFFFF",
                    border: "1px solid rgba(24,34,32,0.1)",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                  formatter={(value: number, name: string) => [
                    `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB`,
                    name === "delta" ? "vs Genre Median" : "Band Energy",
                  ]}
                />
                <Bar dataKey="delta" radius={[6, 6, 6, 6]}>
                  {spectralData.map((entry) => {
                    const abs = Math.abs(entry.delta);
                    const fill =
                      abs >= 5.0 ? "#BE123C" : abs >= 2.2 ? "#B45309" : "#3A7269";
                    return <Cell key={entry.band} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Short-Term LUFS & Stereo Phase Correlation Timeline */}
        <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#182220]">
                Short-Term LUFS &amp; Phase Correlation
              </h3>
              <p className="text-xs text-[#52605D]">
                Click any timestamp on the chart to seek playback
              </p>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={timelineData}
                margin={{ top: 8, right: 12, left: -12, bottom: 8 }}
                onClick={(state) => {
                  const sec = state?.activePayload?.[0]?.payload?.sec;
                  if (typeof sec === "number") onSeek(sec);
                }}
              >
                <CartesianGrid stroke="rgba(24,34,32,0.06)" vertical={false} />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fill: "#52605D", fontSize: 11 }}
                  axisLine={{ stroke: "rgba(24,34,32,0.08)" }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="lufs"
                  domain={[-45, 0]}
                  tick={{ fill: "#3A7269", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="corr"
                  orientation="right"
                  domain={[-1, 1]}
                  tick={{ fill: "#B45309", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine yAxisId="corr" y={0} stroke="rgba(190,18,60,0.35)" strokeDasharray="3 3" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFFFFF",
                    border: "1px solid rgba(24,34,32,0.1)",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                />
                <Line
                  yAxisId="lufs"
                  type="monotone"
                  dataKey="lufs"
                  name="Short-Term LUFS"
                  stroke="#3A7269"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="corr"
                  type="monotone"
                  dataKey="correlation"
                  name="Phase Correlation"
                  stroke="#B45309"
                  strokeWidth={1.75}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Streaming Normalization Estimates & Full Telemetry Readout */}
      <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[#182220]">
            Streaming Loudness Normalization Estimates
          </h3>
          <span className="text-xs text-[#52605D] tabular-telemetry">
            Crest {report.global_metrics.crest_factor_db.toFixed(1)} dB · PSR{" "}
            {report.global_metrics.psr_db.toFixed(1)} dB · Stereo Width{" "}
            {report.global_metrics.stereo_width_ratio.toFixed(2)}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {report.streaming_estimates.map((est) => (
            <div
              key={est.platform}
              className="bg-[#F5F5F7] p-3.5 hairline-border squircle-inner space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#182220]">
                  {est.platform}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold tabular-telemetry ${
                    est.limiter_engaged_warning ? "text-[#B45309]" : "text-[#15803D]"
                  }`}
                >
                  {est.limiter_engaged_warning ? (
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {est.estimated_gain_db >= 0 ? "+" : ""}
                  {est.estimated_gain_db.toFixed(1)} dB
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-[#52605D]">
                {est.assumption_note}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

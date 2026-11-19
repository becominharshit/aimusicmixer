"use client";

import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { StereoVectorscope } from "@/components/advanced/StereoVectorscope";
import { formatTimecode } from "@/lib/utils";
import type { AnalysisReport } from "@/types/report";

interface DiagnosticChartsProps {
  report: AnalysisReport;
  onSeek: (timeSec: number) => void;
}

const GENRE_TITLES: Record<string, string> = {
  electronic: "Electronic",
  pop: "Pop",
  hip_hop: "Hip-Hop",
  rock: "Rock",
  acoustic: "Acoustic",
  ambient: "Ambient",
  other: "Reference",
};

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

  const avgCorr = report.global_metrics.phase_correlation_avg;
  const minCorr =
    report.time_series.phase_correlation.length > 0
      ? Math.min(...report.time_series.phase_correlation)
      : avgCorr;
  // Map correlation [-1, +1] to percentage [0, 100]
  const corrPct = Math.max(0, Math.min(100, ((avgCorr + 1) / 2) * 100));
  const minCorrPct = Math.max(0, Math.min(100, ((minCorr + 1) / 2) * 100));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {/* 6-Band Tonal Balance vs Genre Reference Envelope */}
        <div className="min-w-0 bg-[#FFFFFF] p-5 hairline-border squircle-outer">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#182220]">
                6-Band Tonal Balance vs. {GENRE_TITLES[report.context.genre] || report.context.genre} Envelope
              </h3>
              <p className="text-xs text-[#52605D]">
                Shaded target zone (±2.2 dB) — gain-invariant tilt relative to genre median
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[#52605D]">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-xs bg-[#EBF3F1] border border-[rgba(58,114,105,0.4)]" />
                Target Zone
              </span>
            </div>
          </div>

          <div className="h-56 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={spectralData} margin={{ top: 10, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="rgba(24,34,32,0.06)" vertical={false} />
                <ReferenceArea y1={-2.2} y2={2.2} fill="#3A7269" fillOpacity={0.08} />
                <XAxis
                  dataKey="shortLabel"
                  interval={0}
                  tick={{ fill: "#52605D", fontSize: 11 }}
                  axisLine={{ stroke: "rgba(24,34,32,0.08)" }}
                  tickLine={false}
                />
                <YAxis
                  width={46}
                  tick={{ fill: "#52605D", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v} dB`}
                />
                <ReferenceLine y={0} stroke="rgba(24,34,32,0.28)" />
                <ReferenceLine y={2.2} stroke="rgba(58,114,105,0.38)" strokeDasharray="3 3" />
                <ReferenceLine y={-2.2} stroke="rgba(58,114,105,0.38)" strokeDasharray="3 3" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFFFFF",
                    border: "1px solid rgba(24,34,32,0.1)",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                  formatter={(value: number) => [
                    `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB`,
                    "vs Genre Median",
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

        {/* Short-Term Loudness Timeline */}
        <div className="min-w-0 bg-[#FFFFFF] p-5 hairline-border squircle-outer">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#182220]">
                Short-Term Loudness Timeline (3 s Window)
              </h3>
              <p className="text-xs text-[#52605D]">
                Click any timestamp along the curve to seek playback directly
              </p>
            </div>
            <span className="text-xs font-medium text-[#3A7269] tabular-telemetry">
              Max {report.global_metrics.short_term_max_lufs.toFixed(1)} LUFS
            </span>
          </div>

          <div className="h-56 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart
                data={timelineData}
                margin={{ top: 10, right: 12, left: 0, bottom: 8 }}
                onClick={(state) => {
                  const sec = state?.activePayload?.[0]?.payload?.sec;
                  if (typeof sec === "number") onSeek(sec);
                }}
              >
                <defs>
                  <linearGradient id="stLufsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3A7269" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#3A7269" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(24,34,32,0.06)" vertical={false} />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fill: "#52605D", fontSize: 11 }}
                  axisLine={{ stroke: "rgba(24,34,32,0.08)" }}
                  tickLine={false}
                />
                <YAxis
                  width={42}
                  domain={[-45, 0]}
                  tick={{ fill: "#52605D", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}`}
                />
                <ReferenceLine
                  y={report.global_metrics.integrated_lufs}
                  stroke="rgba(58,114,105,0.5)"
                  strokeDasharray="4 4"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFFFFF",
                    border: "1px solid rgba(24,34,32,0.1)",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                  formatter={(value: number) => [`${value.toFixed(1)} LUFS`, "Short-Term"]}
                />
                <Area
                  type="monotone"
                  dataKey="lufs"
                  stroke="#3A7269"
                  strokeWidth={2}
                  fill="url(#stLufsGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Dedicated Stereo Phase Correlation Meter + 60fps Stereo Vectorscope */}
      <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#182220]">
              Stereo Phase Correlation &amp; Live Goniometer
            </h3>
            <p className="text-xs text-[#52605D]">
              Values near +1.0 sum cleanly in mono; values below 0.0 indicate phase cancellation risk
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs tabular-telemetry">
            {typeof report.global_metrics.low_end_phase_correlation === "number" && (
              <span className="bg-[#F5F5F7] px-2.5 py-1 text-[#52605D] hairline-border squircle-inner">
                Sub 20–120 Hz:{" "}
                <strong
                  className={
                    report.global_metrics.low_end_phase_correlation < 0.3
                      ? "text-[#B45309]"
                      : "text-[#15803D]"
                  }
                >
                  {report.global_metrics.low_end_phase_correlation >= 0 ? "+" : ""}
                  {report.global_metrics.low_end_phase_correlation.toFixed(2)}
                </strong>
              </span>
            )}
            <span className="text-[#52605D]">
              Min:{" "}
              <strong className={minCorr < 0 ? "text-[#BE123C]" : "text-[#182220]"}>
                {minCorr >= 0 ? "+" : ""}
                {minCorr.toFixed(2)}
              </strong>
            </span>
            <span className="bg-[#F5F5F7] px-2.5 py-1 font-semibold text-[#182220] hairline-border squircle-inner">
              Avg:{" "}
              <span className={avgCorr < 0 ? "text-[#BE123C]" : avgCorr < 0.35 ? "text-[#B45309]" : "text-[#15803D]"}>
                {avgCorr >= 0 ? "+" : ""}
                {avgCorr.toFixed(2)}
              </span>
            </span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-12 items-start">
          <div className="space-y-4 md:col-span-8 min-w-0">
            {/* Ballistic Horizontal Correlation Scale (-1 -> 0 -> +1) */}
            <div className="space-y-1.5">
              <div className="relative h-5 w-full overflow-hidden rounded-full bg-[#F5F5F7] hairline-border flex">
                <div className="w-1/2 bg-[#FFF1F3]/90 border-r border-[rgba(24,34,32,0.18)]" />
                <div className="w-[17.5%] bg-[#FEF7EC]/80 border-r border-[rgba(24,34,32,0.08)]" />
                <div className="w-[32.5%] bg-[#ECFDF3]/85" />
                {/* Lowest 1s peak dip marker */}
                <div
                  title={`Lowest 1s correlation: ${minCorr.toFixed(2)}`}
                  style={{ left: `${minCorrPct}%` }}
                  className="absolute top-0 bottom-0 w-1 -translate-x-1/2 bg-[#B45309]/70"
                />
                {/* Average needle */}
                <div
                  title={`Average phase correlation: ${avgCorr.toFixed(2)}`}
                  style={{ left: `${corrPct}%` }}
                  className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-[#182220]"
                />
              </div>
              <div className="flex justify-between text-[10px] text-[#52605D] tabular-telemetry">
                <span>-1.0 (Out of Phase Cancel)</span>
                <span>0.0 (Wide Limit)</span>
                <span>+1.0 (Mono Safe)</span>
              </div>
            </div>

            {/* 1-Second Rolling Phase Correlation Trace */}
            <div className="h-40 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart
                  data={timelineData}
                  margin={{ top: 6, right: 12, left: -16, bottom: 2 }}
                  onClick={(state) => {
                    const sec = state?.activePayload?.[0]?.payload?.sec;
                    if (typeof sec === "number") onSeek(sec);
                  }}
                >
                  <CartesianGrid stroke="rgba(24,34,32,0.06)" vertical={false} />
                  <ReferenceArea y1={-1} y2={0} fill="#BE123C" fillOpacity={0.05} />
                  <XAxis
                    dataKey="timeLabel"
                    tick={{ fill: "#52605D", fontSize: 10 }}
                    axisLine={{ stroke: "rgba(24,34,32,0.08)" }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[-1, 1]}
                    ticks={[-1, 0, 1]}
                    tick={{ fill: "#52605D", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ReferenceLine y={0} stroke="rgba(190,18,60,0.4)" strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#FFFFFF",
                      border: "1px solid rgba(24,34,32,0.1)",
                      borderRadius: "12px",
                      fontSize: "12px",
                    }}
                    formatter={(value: number) => [
                      `${value >= 0 ? "+" : ""}${value.toFixed(2)}`,
                      "Phase Correlation",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="correlation"
                    stroke="#3A7269"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="md:col-span-4 min-w-0">
            <StereoVectorscope
              avgCorrelation={avgCorr}
              lowEndCorrelation={report.global_metrics.low_end_phase_correlation}
            />
          </div>
        </div>
      </div>

      {/* Streaming Normalization Estimates & Full Telemetry Assumptions */}
      <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[#182220]">
            Streaming Loudness Normalization Estimates
          </h3>
          <span className="text-xs text-[#52605D] tabular-telemetry">
            Crest {report.global_metrics.crest_factor_db.toFixed(1)} dB · PSR{" "}
            {report.global_metrics.psr_db.toFixed(1)} dB · Width{" "}
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
                <span className="text-xs font-semibold text-[#182220]">{est.platform}</span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold tabular-telemetry ${
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

"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { fetchSharedAnalysisByToken, type SavedAnalysisRecord } from "@/lib/supabase/storage";
import { formatTimecode } from "@/lib/utils";

export default function SharedReviewPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";

  const [record, setRecord] = useState<SavedAnalysisRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetchSharedAnalysisByToken(token);
        if (active) setRecord(res);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [token]);

  const report = record?.report_json ?? null;

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#182220]">
      <header className="border-b border-[rgba(24,34,32,0.08)] bg-[#FAFAFA]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#3A7269] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Open MixBench Workbench
          </Link>
          <span className="inline-flex items-center gap-1.5 bg-[#EBF3F1] px-2.5 py-1 text-[11px] font-semibold text-[#3A7269] squircle-inner">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Read-Only Client Review
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {loading ? (
          <div className="bg-[#FFFFFF] p-8 text-center text-sm text-[#52605D] hairline-border squircle-outer">
            Loading shared mix report…
          </div>
        ) : !report || !record ? (
          <div className="bg-[#FFFFFF] p-8 text-center hairline-border squircle-outer space-y-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center bg-[#FEF7EC] text-[#B45309] squircle-inner">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold text-[#182220]">
              Shared Mix Review Not Available
            </h1>
            <p className="mx-auto max-w-md text-xs leading-relaxed text-[#52605D]">
              This review link (<code className="text-[#182220]">{token || "invalid"}</code>) is
              either private, expired, or cloud sharing is not configured on this instance.
            </p>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-flex items-center gap-2 bg-[#3A7269] px-4 py-2 text-xs font-medium text-white hover:bg-[#316058] squircle-inner"
              >
                Launch MixBench Studio
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-[#FFFFFF] p-6 hairline-border squircle-outer space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold tracking-[-0.02em] text-[#182220]">
                  {record.track_name}
                </h1>
                <span className="bg-[#EBF3F1] px-2.5 py-1 text-xs font-semibold text-[#3A7269] tabular-telemetry squircle-inner">
                  {record.version_label} · {report.context.genre} · {report.context.stage}
                </span>
              </div>
              <p className="text-xs text-[#52605D] tabular-telemetry">
                {(report.audio_metadata.sample_rate_hz / 1000).toFixed(1)} kHz ·{" "}
                {report.audio_metadata.bit_depth}-bit ·{" "}
                {formatTimecode(report.audio_metadata.duration_sec)}
                {typeof report.audio_metadata.bpm === "number" && report.audio_metadata.bpm > 0
                  ? ` · ${Math.round(report.audio_metadata.bpm)} BPM`
                  : ""}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
                <div className="text-[11px] text-[#52605D]">Integrated Loudness</div>
                <div className="mt-1 text-lg font-semibold text-[#182220] tabular-telemetry">
                  {report.global_metrics.integrated_lufs.toFixed(1)} LUFS
                </div>
              </div>
              <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
                <div className="text-[11px] text-[#52605D]">4x True Peak</div>
                <div className="mt-1 text-lg font-semibold text-[#182220] tabular-telemetry">
                  {report.global_metrics.true_peak_dbtp >= 0 ? "+" : ""}
                  {report.global_metrics.true_peak_dbtp.toFixed(2)} dBTP
                </div>
              </div>
              <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
                <div className="text-[11px] text-[#52605D]">PLR / Transient Punch</div>
                <div className="mt-1 text-lg font-semibold text-[#182220] tabular-telemetry">
                  {(report.global_metrics.plr_db ?? 0).toFixed(1)} dB
                  {typeof report.global_metrics.transient_punch_db === "number" &&
                  report.global_metrics.transient_punch_db > 0
                    ? ` · ${report.global_metrics.transient_punch_db.toFixed(1)} dB`
                    : ""}
                </div>
              </div>
              <div className="bg-[#FFFFFF] p-4 hairline-border squircle-inner">
                <div className="text-[11px] text-[#52605D]">Stereo &amp; Sub Phase</div>
                <div className="mt-1 text-lg font-semibold text-[#182220] tabular-telemetry">
                  {report.global_metrics.phase_correlation_avg >= 0 ? "+" : ""}
                  {report.global_metrics.phase_correlation_avg.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-[#182220]">
                Deterministic Diagnostic Findings ({report.findings.length})
              </h2>
              {report.findings.map((finding) => (
                <article
                  key={finding.evidence_id}
                  className="bg-[#FFFFFF] p-5 hairline-border squircle-outer space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold capitalize squircle-inner ${
                          finding.severity === "alert"
                            ? "bg-[#FFF1F3] text-[#BE123C]"
                            : finding.severity === "caution"
                              ? "bg-[#FEF7EC] text-[#B45309]"
                              : "bg-[#ECFDF3] text-[#15803D]"
                        }`}
                      >
                        {finding.severity === "safe" && (
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        )}
                        {finding.severity}
                      </span>
                      <span className="bg-[#F5F5F7] px-2 py-0.5 text-[11px] text-[#52605D] tabular-telemetry squircle-inner">
                        {finding.evidence_id}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-[#3A7269] tabular-telemetry">
                      {finding.measured_value}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-[#182220]">{finding.title}</h3>
                  <p className="text-xs text-[#52605D]">{finding.what_happened}</p>
                  <p className="text-xs text-[#182220]">
                    <strong>Recommended check:</strong> {finding.what_to_try}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

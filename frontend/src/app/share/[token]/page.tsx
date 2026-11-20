"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";
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
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]/95">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-primary)] hover:border-[var(--border-active)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Open Mixit
            </Link>
            <MixitLogo variant="full" tone="auto" heightClass="h-6" className="hidden sm:inline-flex" />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#14171F] bg-[#F0B44C] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#111318]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Read-Only Client Review
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {loading ? (
          <div className="bg-[var(--bg-elevated)] p-8 text-center text-sm text-[var(--text-secondary)] hairline-border">
            Loading shared mix report…
          </div>
        ) : !report || !record ? (
          <div className="bg-[var(--bg-elevated)] p-8 text-center hairline-border space-y-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center bg-[var(--accent-amber-soft)] text-[var(--accent-amber)]">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold text-[var(--text-primary)]">
              Shared Mix Review Not Available
            </h1>
            <p className="mx-auto max-w-md text-xs leading-relaxed text-[var(--text-secondary)]">
              This review link (<code className="text-[var(--text-primary)]">{token || "invalid"}</code>) is
              either private, expired, or cloud sharing is not configured on this instance.
            </p>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-[4px] border border-[#14171F] bg-[#F0B44C] px-4 py-2 text-xs font-bold uppercase tracking-[0.06em] text-[#111318] hover:bg-[#14171F] hover:text-[#F0B44C]"
              >
                Launch Mixit Studio
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-[var(--bg-elevated)] p-6 hairline-border space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-bold tracking-[-0.02em] text-[var(--text-primary)]">
                  {record.track_name}
                </h1>
                <span className="bg-[var(--accent-mint-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-mint)] tabular-telemetry">
                  {record.version_label} · {report.context.genre} · {report.context.stage}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] tabular-telemetry">
                {(report.audio_metadata.sample_rate_hz / 1000).toFixed(1)} kHz ·{" "}
                {report.audio_metadata.bit_depth}-bit ·{" "}
                {formatTimecode(report.audio_metadata.duration_sec)}
                {typeof report.audio_metadata.bpm === "number" && report.audio_metadata.bpm > 0
                  ? ` · ${Math.round(report.audio_metadata.bpm)} BPM`
                  : ""}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-[var(--bg-elevated)] p-4 hairline-border">
                <div className="text-[11px] text-[var(--text-secondary)]">Integrated Loudness</div>
                <div className="mt-1 text-lg font-semibold text-[var(--text-primary)] tabular-telemetry">
                  {report.global_metrics.integrated_lufs.toFixed(1)} LUFS
                </div>
              </div>
              <div className="bg-[var(--bg-elevated)] p-4 hairline-border">
                <div className="text-[11px] text-[var(--text-secondary)]">4x True Peak</div>
                <div className="mt-1 text-lg font-semibold text-[var(--text-primary)] tabular-telemetry">
                  {report.global_metrics.true_peak_dbtp >= 0 ? "+" : ""}
                  {report.global_metrics.true_peak_dbtp.toFixed(2)} dBTP
                </div>
              </div>
              <div className="bg-[var(--bg-elevated)] p-4 hairline-border">
                <div className="text-[11px] text-[var(--text-secondary)]">PLR / Transient Punch</div>
                <div className="mt-1 text-lg font-semibold text-[var(--text-primary)] tabular-telemetry">
                  {(report.global_metrics.plr_db ?? 0).toFixed(1)} dB
                  {typeof report.global_metrics.transient_punch_db === "number" &&
                  report.global_metrics.transient_punch_db > 0
                    ? ` · ${report.global_metrics.transient_punch_db.toFixed(1)} dB`
                    : ""}
                </div>
              </div>
              <div className="bg-[var(--bg-elevated)] p-4 hairline-border">
                <div className="text-[11px] text-[var(--text-secondary)]">Stereo &amp; Sub Phase</div>
                <div className="mt-1 text-lg font-semibold text-[var(--text-primary)] tabular-telemetry">
                  {report.global_metrics.phase_correlation_avg >= 0 ? "+" : ""}
                  {report.global_metrics.phase_correlation_avg.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Deterministic Diagnostic Findings ({report.findings.length})
              </h2>
              {report.findings.map((finding) => (
                <article
                  key={finding.evidence_id}
                  className="bg-[var(--bg-elevated)] p-5 hairline-border space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold capitalize ${
                          finding.severity === "alert"
                            ? "bg-[var(--accent-vermilion-soft)] text-[var(--accent-vermilion)]"
                            : finding.severity === "caution"
                              ? "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)]"
                              : "bg-[var(--accent-mint-soft)] text-[var(--accent-mint)]"
                        }`}
                      >
                        {finding.severity === "safe" && (
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        )}
                        {finding.severity}
                      </span>
                      <span className="bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] tabular-telemetry">
                        {finding.evidence_id}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-[var(--accent-mint)] tabular-telemetry">
                      {finding.measured_value}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{finding.title}</h3>
                  <p className="text-xs text-[var(--text-secondary)]">{finding.what_happened}</p>
                  <p className="text-xs text-[var(--text-primary)]">
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

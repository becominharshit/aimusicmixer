"use client";

import React, { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Layers,
  Lock,
  Sliders,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { STUDIO_EASE } from "@/lib/motion";
import type { AnalysisReport } from "@/types/report";

interface StemsInspectorProps {
  report: AnalysisReport;
  isUploading: boolean;
  errorMessage: string | null;
  onUploadStems: (files: File[]) => void;
  onLoadDemoStems: () => void;
  onSaveDawContext?: (ctx: { daw: string; bus_routing: string; plugin_notes: string }) => void;
}

async function measureAudioFileDurationMs(file: File): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  return new Promise<number | null>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    const cleanup = () => {
      window.clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.src = "";
      URL.revokeObjectURL(objectUrl);
    };

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration * 1000 : null;
      cleanup();
      resolve(dur);
    };
    audio.onerror = () => {
      cleanup();
      resolve(null);
    };
    audio.src = objectUrl;
  });
}

export function StemsInspector({
  report,
  isUploading,
  errorMessage,
  onUploadStems,
  onLoadDemoStems,
  onSaveDawContext,
}: StemsInspectorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dawOpen, setDawOpen] = useState(false);
  const [daw, setDaw] = useState(report.context.user_reported_context?.daw || "");
  const [busRouting, setBusRouting] = useState(
    report.context.user_reported_context?.bus_routing || ""
  );
  const [pluginNotes, setPluginNotes] = useState(
    report.context.user_reported_context?.plugin_notes || ""
  );
  const [contextSaved, setContextSaved] = useState(false);
  const [pendingAlignmentWarning, setPendingAlignmentWarning] = useState<{
    files: File[];
    deltaMs: number;
  } | null>(null);

  const stems = report.stem_analysis;

  const handleSelectedStems = async (files: File[]) => {
    setPendingAlignmentWarning(null);
    if (files.length < 2) {
      onUploadStems(files);
      return;
    }

    const durations = await Promise.all(files.map((f) => measureAudioFileDurationMs(f)));
    const valid = durations.filter((d): d is number => typeof d === "number" && d > 0);
    if (valid.length >= 2) {
      const deltaMs = Math.max(...valid) - Math.min(...valid);
      if (deltaMs > 50) {
        setPendingAlignmentWarning({ files, deltaMs });
        return;
      }
    }
    onUploadStems(files);
  };

  const dawContextDrawer = (
    <div className="bg-[#FFFFFF] p-4 hairline-border squircle-outer">
      <button
        type="button"
        onClick={() => setDawOpen((prev) => !prev)}
        aria-expanded={dawOpen}
        className="flex w-full items-center justify-between gap-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
          <span className="text-xs font-semibold text-[#182220]">
            Optional DAW / Plugin Chain Context
          </span>
          <span className="bg-[#F5F5F7] px-2 py-0.5 text-[10px] font-medium text-[#52605D] tabular-telemetry squircle-inner">
            user_reported_context
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-[#52605D] transition-transform duration-200 ${
            dawOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {dawOpen && (
          <motion.div
            initial={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
            animate={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }}
            exit={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
            transition={{ duration: 0.2, ease: STUDIO_EASE }}
            className="mt-3 space-y-2.5 border-t border-[rgba(24,34,32,0.06)] pt-3"
          >
            <p className="text-[11px] text-[#52605D]">
              Self-reported routing notes help the opt-in AI Mentor tailor workflow experiments. Separated strictly from measured DSP evidence and never treated as audio proof.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                type="text"
                value={daw}
                onChange={(e) => {
                  setDaw(e.target.value);
                  setContextSaved(false);
                }}
                placeholder="DAW (e.g., Ableton Live 12, Logic Pro)"
                aria-label="DAW Name"
                className="w-full bg-[#FAFAFA] px-3 py-2 text-xs text-[#182220] hairline-border squircle-inner"
              />
              <input
                type="text"
                value={busRouting}
                onChange={(e) => {
                  setBusRouting(e.target.value);
                  setContextSaved(false);
                }}
                placeholder="Bus routing (e.g., Drum Bus -> Mix Bus)"
                aria-label="Bus Routing"
                className="w-full bg-[#FAFAFA] px-3 py-2 text-xs text-[#182220] hairline-border squircle-inner"
              />
              <input
                type="text"
                value={pluginNotes}
                onChange={(e) => {
                  setPluginNotes(e.target.value);
                  setContextSaved(false);
                }}
                placeholder="Plugin notes (unverified context)"
                aria-label="Plugin Notes"
                className="w-full bg-[#FAFAFA] px-3 py-2 text-xs text-[#182220] hairline-border squircle-inner"
              />
            </div>
            {onSaveDawContext && (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onSaveDawContext({ daw, bus_routing: busRouting, plugin_notes: pluginNotes });
                    setContextSaved(true);
                  }}
                >
                  Save DAW Context
                </Button>
                {contextSaved && (
                  <span className="text-[11px] font-medium text-[#15803D]">
                    Saved as user_reported_context
                  </span>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // Hard Guardrail (Pillar 1): Never synthesize stem metrics from a stereo mix!
  if (!report.context.has_user_stems || !stems) {
    return (
      <div className="mx-auto max-w-[1140px] py-4 space-y-4">
        <div className="bg-[#FFFFFF] p-6 hairline-border squircle-outer space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#182220]">
            <Lock className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
            <span>Stem Matrix Locked — Stereo Mix Only</span>
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-[#52605D]">
            MixBench enforces <strong>zero AI stem separation</strong>. Instrument-level overlap and
            per-track headroom cannot be fabricated from a stereo mixdown. Upload 2–8 aligned original
            stems from your DAW (bar 1 bounce, up to 350 MB total) to unlock sample-rate, channel,
            duration alignment checks and pairwise overlap / phase interaction diagnostics.
          </p>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".wav,.flac,.mp3,.aiff,.aif,.ogg,.m4a"
            className="sr-only"
            onChange={(e) => {
              const list = e.target.files ? Array.from(e.target.files) : [];
              if (inputRef.current) inputRef.current.value = "";
              if (list.length > 0) void handleSelectedStems(list);
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

        {pendingAlignmentWarning && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 bg-[#FEF7EC] p-4 text-xs text-[#B45309] border border-[rgba(180,83,9,0.28)] squircle-inner"
          >
            <div className="flex items-start gap-2 max-w-2xl">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Selected stems diverge in duration by{" "}
                <strong>{pendingAlignmentWarning.deltaMs.toFixed(0)} ms</strong> (&gt; 50 ms threshold).
                Re-export all stems from bar 1 with identical bounce range for accurate phase residual checks.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPendingAlignmentWarning(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  const files = pendingAlignmentWarning.files;
                  setPendingAlignmentWarning(null);
                  onUploadStems(files);
                }}
              >
                Upload Anyway
              </Button>
            </div>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2 bg-[#FFF1F3] p-4 text-xs text-[#BE123C] border border-[rgba(190,18,60,0.22)] squircle-inner"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        {dawContextDrawer}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1140px] py-4 space-y-4">
      {/* Alignment Status Banner */}
      <div
        className={`p-4 text-xs squircle-outer border ${
          stems.alignment_passed
            ? "bg-[#ECFDF3] border-[rgba(21,128,61,0.22)] text-[#15803D]"
            : "bg-[#FFF1F3] border-[rgba(190,18,60,0.25)] text-[#BE123C]"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
          <span className="inline-flex items-center gap-1.5">
            {stems.alignment_passed ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            )}
            {stems.alignment_passed ? "Stem Alignment Verified" : "Stem Alignment Warning"}
          </span>
          <span className="tabular-telemetry">
            Max Duration Delta {stems.max_duration_delta_ms.toFixed(1)} ms
          </span>
        </div>
        {stems.alignment_warnings.map((w) => (
          <p key={w} className="mt-1.5 leading-relaxed">
            {w}
          </p>
        ))}
      </div>

      {/* Per-Stem Telemetry Table */}
      <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#182220]">
            <Layers className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
            Uploaded User Stems ({stems.stems.length})
          </span>
          <span className="text-xs text-[#52605D]">
            Measured directly from individual DAW stem files
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[rgba(24,34,32,0.08)] text-[11px] text-[#52605D]">
                <th className="py-2 pr-3 font-medium">Stem</th>
                <th className="py-2 px-3 font-medium">Format</th>
                <th className="py-2 px-3 font-medium">Integrated LUFS</th>
                <th className="py-2 px-3 font-medium">4x True Peak</th>
                <th className="py-2 px-3 font-medium">Headroom</th>
                <th className="py-2 px-3 font-medium">Phase Corr</th>
                <th className="py-2 pl-3 font-medium">Centroid</th>
              </tr>
            </thead>
            <tbody>
              {stems.stems.map((s) => (
                <tr
                  key={s.stem_id}
                  className="border-b border-[rgba(24,34,32,0.05)] last:border-0"
                >
                  <td className="py-2.5 pr-3 font-semibold text-[#182220]">{s.name}</td>
                  <td className="py-2.5 px-3 text-[#52605D] tabular-telemetry">
                    {(s.sample_rate_hz / 1000).toFixed(1)}kHz · {s.channels}ch
                  </td>
                  <td className="py-2.5 px-3 text-[#182220] tabular-telemetry">
                    {s.integrated_lufs.toFixed(1)} LUFS
                  </td>
                  <td className="py-2.5 px-3 text-[#182220] tabular-telemetry">
                    {s.true_peak_dbtp >= 0 ? "+" : ""}
                    {s.true_peak_dbtp.toFixed(2)} dBTP
                  </td>
                  <td className="py-2.5 px-3 text-[#52605D] tabular-telemetry">
                    {s.headroom_db.toFixed(2)} dB
                  </td>
                  <td className="py-2.5 px-3 text-[#52605D] tabular-telemetry">
                    {(s.phase_correlation_avg ?? 1.0) >= 0 ? "+" : ""}
                    {(s.phase_correlation_avg ?? 1.0).toFixed(2)}
                  </td>
                  <td className="py-2.5 pl-3 text-[#52605D] tabular-telemetry">
                    {Math.round(s.spectral_centroid_hz)} Hz
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Possible Spectral Masking & Phase Interaction */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[#182220]">
            Possible Frequency Overlap &amp; Phase Interaction
          </h2>
          <p className="text-xs text-[#52605D]">
            Flags shared band energy and cross-stem phase cancellation signals as listening prompts—not automatic psychoacoustic proof.
          </p>
        </div>

        {stems.overlap_matrix.length === 0 ? (
          <p className="bg-[#F5F5F7] p-4 text-xs text-[#52605D] hairline-border squircle-inner">
            No strong simultaneous frequency overlap detected between uploaded stems.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {stems.overlap_matrix.map((pair) => (
              <div
                key={pair.evidence_id}
                className="bg-[#FFFFFF] p-4 hairline-border squircle-inner space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#182220]">
                    {pair.stem_a} ↔ {pair.stem_b}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {pair.phase_interaction_corr !== undefined &&
                      pair.phase_interaction_corr !== null && (
                        <span
                          className={`px-2 py-0.5 text-[10px] font-medium tabular-telemetry squircle-inner ${
                            pair.phase_cancellation_risk
                              ? "bg-[#FFF1F3] text-[#BE123C]"
                              : "bg-[#F5F5F7] text-[#52605D]"
                          }`}
                        >
                          r = {pair.phase_interaction_corr >= 0 ? "+" : ""}
                          {pair.phase_interaction_corr.toFixed(2)}
                        </span>
                      )}
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
                </div>
                <p className="text-xs leading-relaxed text-[#52605D]">{pair.note}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stem-Sum Residual */}
      {stems.stem_sum_residual && (
        <div className="bg-[#F5F5F7] p-4 hairline-border squircle-inner space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-[#182220]">
            <span>Mixdown vs. Stem Sum Residual</span>
            <span className="tabular-telemetry text-[#3A7269]">
              r = {stems.stem_sum_residual.correlation_with_mix.toFixed(2)}
            </span>
          </div>
          <div className="text-xs text-[#182220] tabular-telemetry">
            RMS diff: {stems.stem_sum_residual.rms_diff_db >= 0 ? "+" : ""}
            {stems.stem_sum_residual.rms_diff_db.toFixed(2)} dB · Peak diff:{" "}
            {stems.stem_sum_residual.peak_diff_db >= 0 ? "+" : ""}
            {stems.stem_sum_residual.peak_diff_db.toFixed(2)} dB
          </div>
          <p className="text-xs text-[#52605D]">{stems.stem_sum_residual.note}</p>
        </div>
      )}

      {dawContextDrawer}
    </div>
  );
}

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import { TACTILE_TAP } from "@/lib/motion";
import { formatTimecode } from "@/lib/utils";
import type { Finding, SongSection } from "@/types/report";

interface WaveformStageProps {
  peaks: number[][];
  durationSec: number;
  bpm?: number | null;
  sections?: SongSection[];
  findings: Finding[];
  activeFindingId: string | null;
  loopEnabled: boolean;
  loopStartSec: number;
  loopEndSec: number;
  onSeek: (timeSec: number) => void;
  onSelectFinding: (finding: Finding) => void;
}

interface MarkerCluster {
  id: string;
  anchorPct: number;
  findings: Finding[];
  worstSeverity: Finding["severity"];
}

const PIN_COLOR = {
  alert: "bg-[#BE123C] text-white border-white",
  caution: "bg-[#B45309] text-white border-white",
  safe: "bg-[#15803D] text-white border-white",
} as const;

const SEVERITY_RANK = { safe: 0, caution: 1, alert: 2 } as const;

export function WaveformStage({
  peaks,
  durationSec,
  bpm = null,
  sections = [],
  findings,
  activeFindingId,
  loopEnabled,
  loopStartSec,
  loopEndSec,
  onSeek,
  onSelectFinding,
}: WaveformStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const timecodeRef = useRef<HTMLSpanElement | null>(null);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 760;
    const height = canvas.clientHeight || 156;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const midY = height / 2;
    ctx.strokeStyle = "rgba(24, 34, 32, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Subtle vertical section dividers
    if (durationSec > 0 && sections.length > 1) {
      ctx.strokeStyle = "rgba(58, 114, 105, 0.2)";
      ctx.setLineDash([3, 3]);
      for (let i = 1; i < sections.length; i += 1) {
        const sx = (sections[i].start_sec / durationSec) * width;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (loopEnabled && durationSec > 0 && loopEndSec > loopStartSec) {
      const lx = (loopStartSec / durationSec) * width;
      const lw = ((loopEndSec - loopStartSec) / durationSec) * width;
      ctx.fillStyle = "rgba(58, 114, 105, 0.11)";
      ctx.fillRect(lx, 0, lw, height);
      ctx.strokeStyle = "rgba(58, 114, 105, 0.45)";
      ctx.strokeRect(lx, 0.5, lw, height - 1);
    }

    if (peaks.length === 0) return;

    const barCount = peaks.length;
    const step = width / barCount;
    const barWidth = Math.max(1.5, step * 0.68);
    ctx.fillStyle = "#3A7269";

    for (let i = 0; i < barCount; i++) {
      const [minVal, maxVal] = peaks[i];
      const amp = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.02);
      const barH = Math.max(3, amp * (height * 0.84));
      const x = i * step + (step - barWidth) / 2;
      const y = midY - barH / 2;
      ctx.globalAlpha = 0.78;
      ctx.fillRect(x, y, barWidth, barH);
    }
    ctx.globalAlpha = 1.0;
  }, [peaks, durationSec, sections, loopEnabled, loopStartSec, loopEndSec]);

  // Draw on metric/loop updates and attach ResizeObserver for crisp HiDPI redraw on viewport changes
  useEffect(() => {
    drawWaveform();
    const target = containerRef.current;
    if (!target || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      drawWaveform();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [drawWaveform]);

  // 60fps requestAnimationFrame loop mutates DOM transform directly (zero React re-renders at 60Hz)
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const cur = studioAudioEngine.getCurrentTimeSec();
      const dur = durationSec || studioAudioEngine.getDurationSec() || 1;
      const pct = Math.max(0, Math.min(1, cur / dur));

      if (playheadRef.current && canvasRef.current) {
        const px = pct * canvasRef.current.clientWidth;
        playheadRef.current.style.transform = `translate3d(${px}px, 0, 0)`;
      }
      if (timecodeRef.current) {
        timecodeRef.current.textContent = `${formatTimecode(cur, true)} / ${formatTimecode(dur, true)}`;
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [durationSec]);

  // Group dense findings within 2% horizontal distance into clickable cluster pills
  const clusters = useMemo<MarkerCluster[]>(() => {
    const items = findings
      .map((finding) => {
        const pct =
          durationSec > 0
            ? Math.max(3, Math.min(95, (finding.timestamp_start_sec / durationSec) * 100))
            : 5;
        return { finding, pct };
      })
      .sort((a, b) => a.pct - b.pct);

    const grouped: MarkerCluster[] = [];
    for (const item of items) {
      const last = grouped[grouped.length - 1];
      if (last && Math.abs(item.pct - last.anchorPct) <= 2.0) {
        last.findings.push(item.finding);
        if (SEVERITY_RANK[item.finding.severity] > SEVERITY_RANK[last.worstSeverity]) {
          last.worstSeverity = item.finding.severity;
        }
      } else {
        grouped.push({
          id: `cluster_${item.finding.evidence_id}`,
          anchorPct: item.pct,
          findings: [item.finding],
          worstSeverity: item.finding.severity,
        });
      }
    }

    // Spread remaining separated pills slightly if needed so labels never overlap
    const placed: number[] = [];
    return grouped.map((c) => {
      let leftPct = c.anchorPct;
      while (placed.some((p) => Math.abs(p - leftPct) < 6.0) && leftPct < 93) {
        leftPct = Math.min(95, leftPct + 6.2);
      }
      placed.push(leftPct);
      return { ...c, anchorPct: leftPct };
    });
  }, [findings, durationSec]);

  const expandedCluster = clusters.find((c) => c.id === expandedClusterId) ?? null;

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(rect.width, 1)));
    onSeek(ratio * durationSec);
  };

  return (
    <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[#182220]">
            Waveform &amp; Issue Marker Timeline
          </span>
          {typeof bpm === "number" && bpm > 0 && (
            <span
              data-testid="waveform-bpm-badge"
              className="bg-[#EBF3F1] px-2 py-0.5 text-[11px] font-semibold text-[#3A7269] tabular-telemetry squircle-inner"
            >
              {Math.round(bpm)} BPM
            </span>
          )}
          <span className="text-xs text-[#52605D]">
            Click anywhere to seek · Click pins or sections to jump
          </span>
        </div>
        <span
          ref={timecodeRef}
          className="bg-[#F5F5F7] px-2.5 py-1 text-xs font-medium text-[#182220] tabular-telemetry squircle-inner"
        >
          00:00.0 / {formatTimecode(durationSec, true)}
        </span>
      </div>

      {/* Deterministic Song Section Markers */}
      {sections.length > 0 && (
        <div
          data-testid="waveform-sections"
          className="mb-2.5 flex flex-wrap items-center gap-1.5"
        >
          {sections.map((sec, idx) => (
            <button
              key={`${sec.label}-${sec.start_sec}-${idx}`}
              type="button"
              onClick={() => onSeek(sec.start_sec)}
              title={`Seek to ${sec.label} (${formatTimecode(sec.start_sec)} – ${formatTimecode(sec.end_sec)})`}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-medium text-[#182220] hover:bg-[#EBF3F1] hover:text-[#3A7269] hairline-border squircle-inner cursor-pointer transition-colors"
            >
              <span>{sec.label}</span>
              <span className="text-[10px] text-[#52605D] tabular-telemetry">
                {formatTimecode(sec.start_sec)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Issue Marker Pin Track (with 2% clustering) */}
      <div className="relative mb-2 h-7 w-full">
        {clusters.map((cluster) => {
          const single = cluster.findings.length === 1;
          const primary = cluster.findings[0];
          const active = cluster.findings.some((f) => f.evidence_id === activeFindingId);

          return (
            <motion.button
              key={cluster.id}
              type="button"
              style={{ left: `${cluster.anchorPct}%` }}
              whileHover={{ scale: 1.12, y: -2 }}
              whileTap={TACTILE_TAP}
              onClick={() => {
                if (single) {
                  setExpandedClusterId(null);
                  onSelectFinding(primary);
                } else {
                  setExpandedClusterId((prev) => (prev === cluster.id ? null : cluster.id));
                }
              }}
              title={
                single
                  ? `${primary.title} (${formatTimecode(primary.timestamp_start_sec)})`
                  : `${cluster.findings.length} grouped issues near ${formatTimecode(primary.timestamp_start_sec)}`
              }
              aria-label={
                single
                  ? `Jump to ${primary.title} at ${formatTimecode(primary.timestamp_start_sec)}`
                  : `Expand ${cluster.findings.length} issues near ${formatTimecode(primary.timestamp_start_sec)}`
              }
              className={`absolute top-0 -translate-x-1/2 flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold shadow-2xs cursor-pointer ${
                PIN_COLOR[cluster.worstSeverity]
              } ${active ? "ring-2 ring-[#3A7269] ring-offset-1 z-10" : "opacity-95"}`}
            >
              <span className="tabular-telemetry">
                {single
                  ? formatTimecode(primary.timestamp_start_sec)
                  : `${cluster.findings.length} @ ${formatTimecode(primary.timestamp_start_sec)}`}
              </span>
            </motion.button>
          );
        })}
      </div>

      {expandedCluster && expandedCluster.findings.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 bg-[#F5F5F7] px-3 py-2 text-[11px] hairline-border squircle-inner">
          <span className="font-semibold text-[#182220]">Grouped pins:</span>
          {expandedCluster.findings.map((f) => (
            <button
              key={f.evidence_id}
              type="button"
              onClick={() => {
                onSelectFinding(f);
                setExpandedClusterId(null);
              }}
              className="bg-[#FFFFFF] px-2 py-0.5 text-[#182220] hairline-border hover:border-[rgba(58,114,105,0.45)] squircle-inner cursor-pointer"
            >
              <span className="font-mono text-[#3A7269]">{formatTimecode(f.timestamp_start_sec)}</span>{" "}
              · {f.title}
            </button>
          ))}
        </div>
      )}

      {/* 60fps Canvas Waveform Stage */}
      <div
        ref={containerRef}
        role="slider"
        tabIndex={0}
        aria-label="Audio playback timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={0}
        onClick={handleCanvasClick}
        onKeyDown={(e) => {
          const cur = studioAudioEngine.getCurrentTimeSec();
          if (e.key === "ArrowRight") onSeek(Math.min(durationSec, cur + 2));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, cur - 2));
        }}
        className="relative h-36 w-full cursor-pointer overflow-hidden bg-[#F5F5F7] hairline-border squircle-inner"
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        <div
          ref={playheadRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 left-0 w-[2px] bg-[#182220]"
          style={{ transform: "translate3d(0px, 0, 0)", willChange: "transform" }}
        >
          <div className="h-2.5 w-2.5 -translate-x-[4px] rounded-full bg-[#3A7269]" />
        </div>
      </div>
    </div>
  );
}

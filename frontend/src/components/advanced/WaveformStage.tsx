"use client";

import React, { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import { TACTILE_TAP } from "@/lib/motion";
import { formatTimecode } from "@/lib/utils";
import type { Finding } from "@/types/report";

interface WaveformStageProps {
  peaks: number[][];
  durationSec: number;
  findings: Finding[];
  activeFindingId: string | null;
  loopEnabled: boolean;
  loopStartSec: number;
  loopEndSec: number;
  onSeek: (timeSec: number) => void;
  onSelectFinding: (finding: Finding) => void;
}

const PIN_COLOR = {
  alert: "bg-[#BE123C] text-white border-white",
  caution: "bg-[#B45309] text-white border-white",
  safe: "bg-[#15803D] text-white border-white",
} as const;

export function WaveformStage({
  peaks,
  durationSec,
  findings,
  activeFindingId,
  loopEnabled,
  loopStartSec,
  loopEndSec,
  onSeek,
  onSelectFinding,
}: WaveformStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const timecodeRef = useRef<HTMLSpanElement | null>(null);

  // Draw waveform geometry when peaks or loop range change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 760;
    const height = canvas.clientHeight || 156;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Center hairline
    const midY = height / 2;
    ctx.strokeStyle = "rgba(24, 34, 32, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Loop highlight region
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
  }, [peaks, durationSec, loopEnabled, loopStartSec, loopEndSec]);

  // 60fps requestAnimationFrame loop mutates DOM transform directly (zero React re-renders at 60Hz!)
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

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(rect.width, 1)));
    onSeek(ratio * durationSec);
  };

  return (
    <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#182220]">
            Waveform &amp; Issue Marker Timeline
          </span>
          <span className="text-xs text-[#52605D]">
            Click anywhere to seek · Click pins to jump &amp; loop
          </span>
        </div>
        <span
          ref={timecodeRef}
          className="bg-[#F5F5F7] px-2.5 py-1 text-xs font-medium text-[#182220] tabular-telemetry squircle-inner"
        >
          00:00.0 / {formatTimecode(durationSec, true)}
        </span>
      </div>

      {/* Issue Marker Pin Track */}
      <div className="relative mb-2 h-7 w-full">
        {(() => {
          const placedPositions: number[] = [];
          return findings.map((finding) => {
            let leftPct =
              durationSec > 0
                ? Math.max(3, Math.min(95, (finding.timestamp_start_sec / durationSec) * 100))
                : 5;
            // Offset pins that land within 6% horizontally so every pin stays clickable and readable
            while (placedPositions.some((p) => Math.abs(p - leftPct) < 6.2) && leftPct < 92) {
              leftPct = Math.min(95, leftPct + 6.5);
            }
            placedPositions.push(leftPct);
            const active = activeFindingId === finding.evidence_id;
            return (
              <motion.button
                key={finding.evidence_id}
                type="button"
                style={{ left: `${leftPct}%` }}
                whileHover={{ scale: 1.15, y: -2 }}
                whileTap={TACTILE_TAP}
                onClick={() => onSelectFinding(finding)}
                title={`${finding.title} (${formatTimecode(finding.timestamp_start_sec)})`}
                aria-label={`Jump to ${finding.title} at ${formatTimecode(finding.timestamp_start_sec)}`}
                className={`absolute top-0 -translate-x-1/2 flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold shadow-2xs cursor-pointer ${
                  PIN_COLOR[finding.severity]
                } ${active ? "ring-2 ring-[#3A7269] ring-offset-1 z-10" : "opacity-95"}`}
              >
                <span className="tabular-telemetry">{formatTimecode(finding.timestamp_start_sec)}</span>
              </motion.button>
            );
          });
        })()}
      </div>

      {/* 60fps Canvas Waveform Stage */}
      <div
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
        {/* Hardware-accelerated 60fps playhead cursor */}
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

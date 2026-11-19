"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Play, Repeat, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import type { Finding, SongSection } from "@/types/report";

interface FlawTimelineBarProps {
  peaks: number[][];
  referencePeaks?: number[][] | null;
  durationSec: number;
  clippingTimestamps?: number[];
  findings?: Finding[];
  bpm?: number | null;
  sections?: SongSection[];
  height?: number;
  onSelectFinding?: (finding: Finding) => void;
  className?: string;
}

function formatClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${mins}:${rem.toString().padStart(2, "0")}`;
}

function pinColorForFinding(finding: Finding): string {
  if (finding.severity === "alert" || finding.category === "true_peak") {
    return "#FF4D3D"; // Vermilion
  }
  if (finding.category === "stereo_phase") {
    return "#2D6BFF"; // Cobalt
  }
  if (finding.severity === "caution") {
    return "#F5A623"; // Amber
  }
  return "#00D9A3"; // Mint
}

export function FlawTimelineBar({
  peaks,
  referencePeaks = null,
  durationSec,
  clippingTimestamps = [],
  findings = [],
  bpm = null,
  sections = [],
  height = 132,
  onSelectFinding,
  className = "",
}: FlawTimelineBarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [engineState, setEngineState] = useState(() => studioAudioEngine.getState());
  const [currentTime, setCurrentTime] = useState(0);
  const [hoveredFindingId, setHoveredFindingId] = useState<string | null>(null);
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    const sync = () => setEngineState(studioAudioEngine.getState());
    sync();
    return studioAudioEngine.subscribe(sync);
  }, []);

  // Re-render canvas when dark/light theme class toggles on <html>
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      setThemeRevision((r) => r + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let rafId = 0;
    const loop = () => {
      setCurrentTime(studioAudioEngine.getCurrentTimeSec());
      if (studioAudioEngine.getState().isPlaying) {
        rafId = window.requestAnimationFrame(loop);
      }
    };
    setCurrentTime(studioAudioEngine.getCurrentTimeSec());
    if (engineState.isPlaying) {
      rafId = window.requestAnimationFrame(loop);
    }
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [engineState.isPlaying, engineState.loopEnabled, engineState.activeSource]);

  const effectiveDuration = Math.max(0.1, durationSec || studioAudioEngine.getDurationSec() || 1);

  const flawMarkers = useMemo(() => {
    const usable = findings.filter((f) => f.severity !== "safe" || f.category === "true_peak");
    const list = usable.length > 0 ? usable : findings.slice(0, 4);
    return list.map((finding, idx) => {
      const start = Math.max(0, Math.min(effectiveDuration, finding.timestamp_start_sec));
      const end = Math.max(start + 0.5, Math.min(effectiveDuration, finding.timestamp_end_sec || start + 4));
      const mid = (start + end) * 0.5;
      // Avoid stacking pins directly on top of each other when timestamps are identical
      const basePct = (mid / effectiveDuration) * 100;
      const pct = Math.max(4, Math.min(96, basePct + (idx % 3 === 0 ? 0 : idx % 2 === 0 ? 1.2 : -1.2)));
      return {
        finding,
        start,
        end,
        pct,
        color: pinColorForFinding(finding),
      };
    });
  }, [findings, effectiveDuration]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(240, Math.floor(rect.width));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const isDark = document.documentElement.classList.contains("dark");
    const bgColor = isDark ? "#0D1017" : "#EFECE3";
    const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(17,19,24,0.07)";
    const playedWaveColor = isDark ? "#00D9A3" : "#008A68";
    const unplayedWaveColor = isDark ? "#384157" : "#9BA4B5";
    const refColor = isDark ? "rgba(45,107,255,0.28)" : "rgba(32,87,214,0.24)";
    const playheadColor = isDark ? "#F5F2EB" : "#111318";

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    const midY = height * 0.54;
    const maxAmp = height * 0.36;

    // Subtle horizontal calibration guides
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (const ratio of [0.22, 0.54, 0.86]) {
      ctx.beginPath();
      ctx.moveTo(0, Math.round(height * ratio) + 0.5);
      ctx.lineTo(width, Math.round(height * ratio) + 0.5);
      ctx.stroke();
    }

    // Active loop window highlight
    if (engineState.loopEnabled && engineState.loopEndSec > engineState.loopStartSec + 0.05) {
      const lx1 = (engineState.loopStartSec / effectiveDuration) * width;
      const lx2 = (engineState.loopEndSec / effectiveDuration) * width;
      ctx.fillStyle = isDark ? "rgba(0, 217, 163, 0.13)" : "rgba(0, 153, 115, 0.14)";
      ctx.fillRect(lx1, 0, Math.max(2, lx2 - lx1), height);
      ctx.strokeStyle = "rgba(0, 217, 163, 0.65)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx1, 0);
      ctx.lineTo(lx1, height);
      ctx.moveTo(lx2, 0);
      ctx.lineTo(lx2, height);
      ctx.stroke();
    }

    // Flaw highlight spans on timeline
    for (const marker of flawMarkers) {
      const fx1 = (marker.start / effectiveDuration) * width;
      const fx2 = (marker.end / effectiveDuration) * width;
      ctx.fillStyle = `${marker.color}18`;
      ctx.fillRect(fx1, 0, Math.max(3, fx2 - fx1), height);
    }

    // Optional Reference track silhouette behind primary peaks
    if (referencePeaks && referencePeaks.length > 0) {
      ctx.fillStyle = refColor;
      const step = width / referencePeaks.length;
      for (let i = 0; i < referencePeaks.length; i += 1) {
        const pair = referencePeaks[i];
        const amp = Math.min(1, Math.max(Math.abs(pair[0] ?? 0), Math.abs(pair[1] ?? 0)));
        const h = Math.max(2, amp * maxAmp * 2);
        ctx.fillRect(i * step, midY - h * 0.5, Math.max(1, step - 1), h);
      }
    }

    // Primary waveform bars
    const playheadX = (currentTime / effectiveDuration) * width;
    const barCount = Math.max(1, peaks.length);
    const barStep = width / barCount;
    const barW = Math.max(1.5, Math.min(4, barStep * 0.72));

    for (let i = 0; i < barCount; i += 1) {
      const pair = peaks[i] ?? [0, 0];
      const amp = Math.min(1, Math.max(Math.abs(pair[0] ?? 0), Math.abs(pair[1] ?? 0)));
      const x = i * barStep;
      const barH = Math.max(3, amp * maxAmp * 2);
      const isHot = amp > 0.94;
      if (isHot) {
        ctx.fillStyle = "#FF4D3D";
      } else if (x <= playheadX) {
        ctx.fillStyle = playedWaveColor;
      } else {
        ctx.fillStyle = unplayedWaveColor;
      }
      ctx.beginPath();
      ctx.roundRect(x, midY - barH * 0.5, barW, barH, 1.5);
      ctx.fill();
    }

    // Clipping ticks at top rail
    if (clippingTimestamps.length > 0) {
      ctx.fillStyle = "#FF4D3D";
      for (const ts of clippingTimestamps.slice(0, 60)) {
        const cx = (ts / effectiveDuration) * width;
        ctx.fillRect(cx - 1, 0, 2, 10);
      }
    }

    // Crisp playhead needle
    ctx.strokeStyle = playheadColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    ctx.fillStyle = "#00D9A3";
    ctx.beginPath();
    ctx.arc(playheadX, 6, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }, [
    peaks,
    referencePeaks,
    currentTime,
    effectiveDuration,
    height,
    clippingTimestamps,
    flawMarkers,
    engineState.loopEnabled,
    engineState.loopStartSec,
    engineState.loopEndSec,
    themeRevision,
  ]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const targetSec = ratio * effectiveDuration;
    setCurrentTime(targetSec);
    void studioAudioEngine.seek(targetSec, engineState.isPlaying);
  };

  const handlePinClick = (finding: Finding, start: number, end: number) => {
    void studioAudioEngine.auditionRange(start, end);
    onSelectFinding?.(finding);
  };

  const hoveredMarker = flawMarkers.find((m) => m.finding.evidence_id === hoveredFindingId) ?? null;

  return (
    <div
      ref={containerRef}
      data-testid="flaw-timeline-bar"
      className={`studio-card squircle-outer p-3.5 sm:p-4 ${className}`}
    >
      {/* Top Timeline Metadata Bar */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular-telemetry text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            Interactive Flaw Timeline
          </span>
          {typeof bpm === "number" && bpm > 0 ? (
            <span
              data-testid="waveform-bpm-badge"
              className="tabular-telemetry rounded-md border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-primary)]"
            >
              {Math.round(bpm)} BPM
            </span>
          ) : null}
          {clippingTimestamps.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--studio-vermilion)]/35 bg-[var(--studio-vermilion-soft)] px-2 py-0.5 tabular-telemetry text-[10px] font-semibold text-[var(--studio-vermilion)]">
              <AlertTriangle className="h-3 w-3" />
              {clippingTimestamps.length} clip points
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 tabular-telemetry text-xs text-[var(--text-secondary)]">
          <span>{formatClock(currentTime)}</span>
          <span className="text-[var(--text-muted)]">/</span>
          <span>{formatClock(effectiveDuration)}</span>
          {engineState.loopEnabled ? (
            <button
              type="button"
              onClick={() => studioAudioEngine.setLoop(false)}
              className="ml-1 inline-flex items-center gap-1 rounded-md border border-[var(--studio-mint)]/45 bg-[var(--studio-mint-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--studio-mint)]"
            >
              <Repeat className="h-3 w-3" />
              Loop {formatClock(engineState.loopStartSec)}–{formatClock(engineState.loopEndSec)}
            </button>
          ) : null}
        </div>
      </div>

      {/* Flaw Pins Rail + Canvas */}
      <div className="relative">
        {/* Glowing clickable flaw marker pins along top rail */}
        <div className="relative mb-1.5 h-7 w-full">
          {flawMarkers.map(({ finding, start, end, pct, color }) => {
            const isHovered = hoveredFindingId === finding.evidence_id;
            return (
              <button
                key={finding.evidence_id}
                type="button"
                onMouseEnter={() => setHoveredFindingId(finding.evidence_id)}
                onMouseLeave={() => setHoveredFindingId((prev) => (prev === finding.evidence_id ? null : prev))}
                onFocus={() => setHoveredFindingId(finding.evidence_id)}
                onBlur={() => setHoveredFindingId((prev) => (prev === finding.evidence_id ? null : prev))}
                onClick={() => handlePinClick(finding, start, end)}
                aria-label={`Audition ${finding.title} at ${formatClock(start)}`}
                style={{ left: `${pct}%` }}
                className="group absolute top-0.5 -translate-x-1/2 focus:outline-none"
              >
                <span
                  className={`flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold transition-transform ${
                    isHovered ? "scale-110 z-20" : "hover:scale-105"
                  }`}
                  style={{
                    backgroundColor: `${color}22`,
                    borderColor: `${color}88`,
                    color,
                    boxShadow: `0 0 12px ${color}44`,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="hidden sm:inline tabular-telemetry">{formatClock(start)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Floating Diagnostic Popover on Hover/Focus */}
        {hoveredMarker ? (
          <div
            role="tooltip"
            style={{ left: `${Math.max(16, Math.min(84, hoveredMarker.pct))}%` }}
            className="pointer-events-none absolute -top-2 z-30 w-64 -translate-x-1/2 -translate-y-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="inline-flex items-center gap-1 tabular-telemetry text-[10px] font-bold uppercase tracking-wider"
                style={{ color: hoveredMarker.color }}
              >
                {hoveredMarker.finding.classification === "objective_defect" ? (
                  <>
                    <ShieldAlert className="h-3 w-3" /> Objective Defect
                  </>
                ) : (
                  <>
                    <SlidersHorizontal className="h-3 w-3" /> Stylistic Choice
                  </>
                )}
              </span>
              <span className="tabular-telemetry text-[10px] text-[var(--text-muted)]">
                {formatClock(hoveredMarker.start)}–{formatClock(hoveredMarker.end)}
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold text-[var(--text-primary)]">
              {hoveredMarker.finding.title}
            </p>
            <p className="mt-0.5 tabular-telemetry text-[11px] font-medium text-[var(--text-secondary)]">
              {hoveredMarker.finding.measured_value}
            </p>
            <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-[var(--studio-mint)]">
              <Play className="h-2.5 w-2.5 fill-current" /> Click pin to loop & audition window
            </p>
          </div>
        ) : null}

        {/* HiDPI Waveform Canvas */}
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          style={{ height }}
          className="block w-full cursor-pointer rounded-xl border border-[var(--border-hairline)]"
        />
      </div>

      {/* Song Sections Row (preserves waveform-sections testid) */}
      {sections.length > 0 ? (
        <div
          data-testid="waveform-sections"
          className="mt-2.5 flex flex-wrap items-center gap-1.5"
        >
          {sections.map((section, idx) => (
            <button
              key={`${section.label}-${idx}`}
              type="button"
              onClick={() => void studioAudioEngine.auditionRange(section.start_sec, section.end_sec)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--studio-mint)] hover:text-[var(--text-primary)]"
            >
              <span>{section.label}</span>
              <span className="tabular-telemetry text-[10px] text-[var(--text-muted)]">
                {formatClock(section.start_sec)} · {section.avg_lufs.toFixed(1)} LUFS
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

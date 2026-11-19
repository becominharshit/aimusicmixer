"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Play, Repeat, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import { STUDIO_EASE } from "@/lib/motion";
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

interface RawFlawMarker {
  finding: Finding;
  start: number;
  end: number;
  pct: number;
  color: string;
  priority: number;
}

interface FlawCluster {
  id: string;
  pct: number;
  earliestStart: number;
  color: string;
  markers: RawFlawMarker[];
}

function formatClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${mins}:${rem.toString().padStart(2, "0")}`;
}

function pinMetaForFinding(finding: Finding): { color: string; priority: number } {
  if (finding.severity === "alert" || finding.category === "true_peak") {
    return { color: "#FF3B1F", priority: 3 }; // Swiss Vermilion clipping / critical
  }
  if (finding.category === "stereo_phase") {
    return { color: "#A855F7", priority: 2 }; // Sub-bass phase violet
  }
  if (finding.severity === "caution") {
    return { color: "#F59E0B", priority: 1 }; // Amber tonal congestion
  }
  return { color: "#22C58B", priority: 0 }; // Acid Mint safe
}

function pillEstimatedWidthPx(markerCount: number): number {
  return markerCount > 1 ? 120 : 64;
}

function groupDisplayPct(markers: RawFlawMarker[], railWidthPx: number): number {
  const safeWidth = Math.max(260, railWidthPx);
  const avg = markers.reduce((sum, item) => sum + item.pct, 0) / markers.length;
  const halfWidthPct = ((pillEstimatedWidthPx(markers.length) * 0.5 + 4) / safeWidth) * 100;
  const pad = Math.min(28, Math.max(7, halfWidthPct));
  return Math.max(pad, Math.min(100 - pad, avg));
}

/**
 * Clusters markers occurring within < 4% of the timeline width and resolves
 * any residual visual pill collisions against the rendered rail width so
 * grouped pills (e.g., "2 FLAWS · 0:03") never overlap on any viewport.
 */
export function buildFlawClusters(
  findings: Finding[],
  effectiveDuration: number,
  clusterThresholdPct = 4,
  railWidthPx = 680
): FlawCluster[] {
  const usable = findings.filter((f) => f.severity !== "safe" || f.category === "true_peak");
  const list = usable.length > 0 ? usable : findings.slice(0, 4);

  const raw: RawFlawMarker[] = list
    .map((finding) => {
      const start = Math.max(0, Math.min(effectiveDuration, finding.timestamp_start_sec));
      const end = Math.max(
        start + 0.5,
        Math.min(effectiveDuration, finding.timestamp_end_sec || start + 4)
      );
      const mid = (start + end) * 0.5;
      const pct = Math.max(0, Math.min(100, (mid / effectiveDuration) * 100));
      const meta = pinMetaForFinding(finding);
      return {
        finding,
        start,
        end,
        pct,
        color: meta.color,
        priority: meta.priority,
      };
    })
    .sort((a, b) => a.pct - b.pct);

  // Pass 1: semantic clustering within clusterThresholdPct (< 4% default)
  const groups: RawFlawMarker[][] = [];
  for (const marker of raw) {
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup) {
      groups.push([marker]);
      continue;
    }
    const anchorPct = lastGroup.reduce((sum, item) => sum + item.pct, 0) / lastGroup.length;
    if (Math.abs(marker.pct - anchorPct) < clusterThresholdPct) {
      lastGroup.push(marker);
    } else {
      groups.push([marker]);
    }
  }

  // Pass 2: visual anti-collision resolution for actual pill widths & edge clamping
  const safeWidth = Math.max(260, railWidthPx);
  while (groups.length > 1) {
    let worstIdx = -1;
    let worstOverlap = 0;

    for (let i = 0; i < groups.length - 1; i += 1) {
      const leftPct = groupDisplayPct(groups[i], safeWidth);
      const rightPct = groupDisplayPct(groups[i + 1], safeWidth);
      const minGapPx =
        (pillEstimatedWidthPx(groups[i].length) + pillEstimatedWidthPx(groups[i + 1].length)) * 0.5 +
        12;
      const minGapPct = Math.max(clusterThresholdPct, (minGapPx / safeWidth) * 100);
      const overlap = minGapPct - (rightPct - leftPct);
      if (overlap > worstOverlap) {
        worstOverlap = overlap;
        worstIdx = i;
      }
    }

    if (worstIdx === -1) break;
    groups[worstIdx] = [...groups[worstIdx], ...groups[worstIdx + 1]];
    groups.splice(worstIdx + 1, 1);
  }

  return groups.map((markers) => {
    const clampedPct = groupDisplayPct(markers, safeWidth);
    const sortedByPriority = [...markers].sort((a, b) => b.priority - a.priority);
    const earliestStart = Math.min(...markers.map((m) => m.start));
    return {
      id: markers.map((m) => m.finding.evidence_id).join("__"),
      pct: clampedPct,
      earliestStart,
      color: sortedByPriority[0].color,
      markers: sortedByPriority,
    };
  });
}

export function FlawTimelineBar({
  peaks,
  referencePeaks = null,
  durationSec,
  clippingTimestamps = [],
  findings = [],
  bpm = null,
  sections = [],
  height = 128,
  onSelectFinding,
  className = "",
}: FlawTimelineBarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [railWidthPx, setRailWidthPx] = useState(680);
  const [engineState, setEngineState] = useState(() => studioAudioEngine.getState());
  const [currentTime, setCurrentTime] = useState(0);
  const [hoveredClusterId, setHoveredClusterId] = useState<string | null>(null);
  const [pinnedClusterId, setPinnedClusterId] = useState<string | null>(null);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next >= 200) {
        setRailWidthPx((prev) => (Math.abs(prev - next) >= 4 ? next : prev));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sync = () => setEngineState(studioAudioEngine.getState());
    sync();
    return studioAudioEngine.subscribe(sync);
  }, []);

  useEffect(() => {
    if (!pinnedClusterId) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPinnedClusterId(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinnedClusterId(null);
        setHoveredClusterId(null);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [pinnedClusterId]);

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

  const flawClusters = useMemo(
    () => buildFlawClusters(findings, effectiveDuration, 4, railWidthPx),
    [findings, effectiveDuration, railWidthPx]
  );

  const allMarkers = useMemo(
    () => flawClusters.flatMap((cluster) => cluster.markers),
    [flawClusters]
  );

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

    // Pure #0A0A0A hardware waveform enclosure
    ctx.fillStyle = "#0A0A0A";
    ctx.fillRect(0, 0, width, height);

    const midY = height * 0.54;
    const maxAmp = height * 0.36;

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
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
      ctx.fillStyle = "rgba(255, 224, 27, 0.14)";
      ctx.fillRect(lx1, 0, Math.max(2, lx2 - lx1), height);
      ctx.strokeStyle = "#FFE01B";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx1, 0);
      ctx.lineTo(lx1, height);
      ctx.moveTo(lx2, 0);
      ctx.lineTo(lx2, height);
      ctx.stroke();
    }

    // Flaw highlight spans on timeline
    for (const marker of allMarkers) {
      const fx1 = (marker.start / effectiveDuration) * width;
      const fx2 = (marker.end / effectiveDuration) * width;
      ctx.fillStyle = `${marker.color}1C`;
      ctx.fillRect(fx1, 0, Math.max(3, fx2 - fx1), height);
    }

    // Optional reference silhouette
    if (referencePeaks && referencePeaks.length > 0) {
      ctx.fillStyle = "rgba(56, 189, 248, 0.28)";
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
        ctx.fillStyle = "#FF3B1F";
      } else if (x <= playheadX) {
        ctx.fillStyle = "#FFE01B";
      } else {
        ctx.fillStyle = "#3E4759";
      }
      ctx.fillRect(x, midY - barH * 0.5, barW, barH);
    }

    // Clipping ticks at top rail
    if (clippingTimestamps.length > 0) {
      ctx.fillStyle = "#FF3B1F";
      for (const ts of clippingTimestamps.slice(0, 60)) {
        const cx = (ts / effectiveDuration) * width;
        ctx.fillRect(cx - 1, 0, 2, 10);
      }
    }

    // Playhead needle
    ctx.strokeStyle = "#F4F1EA";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    ctx.fillStyle = "#FFE01B";
    ctx.fillRect(playheadX - 3, 0, 6, 6);
  }, [
    peaks,
    referencePeaks,
    currentTime,
    effectiveDuration,
    height,
    clippingTimestamps,
    allMarkers,
    engineState.loopEnabled,
    engineState.loopStartSec,
    engineState.loopEndSec,
    railWidthPx,
  ]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const targetSec = ratio * effectiveDuration;
    setCurrentTime(targetSec);
    void studioAudioEngine.seek(targetSec, engineState.isPlaying);
  };

  const handleAuditionMarker = (marker: RawFlawMarker) => {
    void studioAudioEngine.auditionRange(marker.start, marker.end);
    onSelectFinding?.(marker.finding);
    setPinnedClusterId(null);
  };

  const handleClusterClick = (cluster: FlawCluster) => {
    if (cluster.markers.length === 1) {
      handleAuditionMarker(cluster.markers[0]);
      return;
    }
    setPinnedClusterId((prev) => (prev === cluster.id ? null : cluster.id));
  };

  const activeClusterId = pinnedClusterId ?? hoveredClusterId;
  const activeCluster = flawClusters.find((c) => c.id === activeClusterId) ?? null;

  return (
    <div
      ref={containerRef}
      data-testid="flaw-timeline-bar"
      className={`border border-[#262B36] bg-[#0A0A0A] p-3.5 text-[#F4F1EA] sm:p-4 ${className}`}
    >
      {/* Top Timeline Metadata Bar */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.04em] text-[#F4F1EA]">
            Interactive Flaw Timeline
          </span>
          {typeof bpm === "number" && bpm > 0 ? (
            <span
              data-testid="waveform-bpm-badge"
              className="tabular-telemetry border border-[#262B36] bg-[#12151C] px-2 py-0.5 text-[11px] font-semibold text-[#FFE01B]"
            >
              {Math.round(bpm)} BPM
            </span>
          ) : null}
          {clippingTimestamps.length > 0 ? (
            <span className="inline-flex items-center gap-1 border border-[#FF3B1F]/60 bg-[#FF3B1F]/15 px-2 py-0.5 tabular-telemetry text-[11px] font-semibold text-[#FF3B1F]">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {clippingTimestamps.length} clips
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 tabular-telemetry text-xs text-[#A1A8B8]">
          <span>{formatClock(currentTime)}</span>
          <span className="text-[#525B70]">/</span>
          <span>{formatClock(effectiveDuration)}</span>
          {engineState.loopEnabled ? (
            <button
              type="button"
              onClick={() => studioAudioEngine.setLoop(false)}
              aria-label="Clear active loop window"
              className="ml-1 inline-flex items-center gap-1 border border-[#FFE01B] bg-[#FFE01B] px-2 py-0.5 text-[11px] font-bold text-[#0A0A0A] cursor-pointer"
            >
              <Repeat className="h-3 w-3" aria-hidden="true" />
              {formatClock(engineState.loopStartSec)}–{formatClock(engineState.loopEndSec)}
            </button>
          ) : null}
        </div>
      </div>

      {/* Clustered Flaw Pins Rail + Canvas */}
      <div
        className="relative"
        onMouseLeave={() => {
          if (!pinnedClusterId) setHoveredClusterId(null);
        }}
      >
        <div ref={railRef} data-testid="flaw-marker-rail" className="relative mb-2 h-7 w-full">
          {flawClusters.map((cluster) => {
            const isCluster = cluster.markers.length > 1;
            const isOpen = activeClusterId === cluster.id;
            const single = cluster.markers[0];
            const pillLabel = isCluster
              ? `${cluster.markers.length} FLAWS · ${formatClock(cluster.earliestStart)}`
              : formatClock(single.start);

            return (
              <button
                key={cluster.id}
                type="button"
                onMouseEnter={() => setHoveredClusterId(cluster.id)}
                onFocus={() => setHoveredClusterId(cluster.id)}
                onClick={() => handleClusterClick(cluster)}
                aria-expanded={isCluster ? isOpen : undefined}
                aria-label={
                  isCluster
                    ? `Inspect ${cluster.markers.length} flaws near ${formatClock(cluster.earliestStart)}`
                    : `Audition ${single.finding.title} at ${formatClock(single.start)}`
                }
                style={{ left: `${cluster.pct}%` }}
                className={`group absolute top-0.5 -translate-x-1/2 cursor-pointer focus:outline-none ${
                  isOpen ? "z-20" : "z-10"
                }`}
              >
                <span
                  className={`flex h-6 items-center gap-1.5 whitespace-nowrap border px-2.5 text-[11px] font-bold transition-transform duration-150 ${
                    isOpen ? "scale-105" : "hover:scale-[1.03]"
                  }`}
                  style={{
                    backgroundColor: `${cluster.color}22`,
                    borderColor: `${cluster.color}99`,
                    color: cluster.color,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0"
                    style={{ backgroundColor: cluster.color }}
                  />
                  <span className="tabular-telemetry">{pillLabel}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Interactive Origin-Aware Stacked Popover for Single or Clustered Flaws */}
        <AnimatePresence>
          {activeCluster ? (
            <motion.div
              key={activeCluster.id}
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.12, ease: STUDIO_EASE }}
              role={activeCluster.markers.length > 1 ? "dialog" : "tooltip"}
              aria-label="Flaw marker details"
              style={{ left: `${Math.max(18, Math.min(82, activeCluster.pct))}%` }}
              className="absolute -top-2 z-50 w-72 -translate-x-1/2 -translate-y-full border-[1.5px] border-[#FFE01B] bg-[#12151C] p-2.5 text-[#F4F1EA]"
            >
              {activeCluster.markers.length > 1 ? (
                <div className="mb-2 flex items-center justify-between border-b border-[#262B36] px-1 pb-1.5">
                  <span className="text-[11px] font-bold uppercase text-[#F4F1EA]">
                    {activeCluster.markers.length} flaws near{" "}
                    <span className="tabular-telemetry text-[#FFE01B]">
                      {formatClock(activeCluster.earliestStart)}
                    </span>
                  </span>
                  <span className="text-[10px] text-[#A1A8B8]">Select to loop</span>
                </div>
              ) : null}

              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
                {activeCluster.markers.map((marker) => (
                  <button
                    key={marker.finding.evidence_id}
                    type="button"
                    onClick={() => handleAuditionMarker(marker)}
                    className="block w-full border border-[#262B36] bg-[#0A0A0A] p-2 text-left transition-colors hover:border-[#FFE01B] cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase"
                        style={{ color: marker.color }}
                      >
                        {marker.finding.classification === "objective_defect" ? (
                          <>
                            <ShieldAlert className="h-3 w-3" aria-hidden="true" /> Objective Defect
                          </>
                        ) : (
                          <>
                            <SlidersHorizontal className="h-3 w-3" aria-hidden="true" /> Stylistic Choice
                          </>
                        )}
                      </span>
                      <span className="tabular-telemetry text-[10px] text-[#A1A8B8]">
                        {formatClock(marker.start)}–{formatClock(marker.end)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-[#F4F1EA]">
                      {marker.finding.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="tabular-telemetry text-[11px] text-[#A1A8B8]">
                        {marker.finding.measured_value}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase text-[#FFE01B]">
                        <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" /> Audition
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* HiDPI Waveform Canvas */}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Interactive audio waveform and flaw-marker timeline"
          onClick={handleCanvasClick}
          style={{ height }}
          className="block w-full cursor-pointer border border-[#262B36]"
        />
      </div>

      {/* Song Sections Row */}
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
              className="inline-flex items-center gap-1.5 border border-[#262B36] bg-[#12151C] px-2.5 py-1 text-[11px] font-semibold text-[#A1A8B8] transition-colors hover:border-[#FFE01B] hover:text-[#F4F1EA] cursor-pointer"
            >
              <span>{section.label}</span>
              <span className="tabular-telemetry text-[10px] text-[#7B8394]">
                {formatClock(section.start_sec)} · {section.avg_lufs.toFixed(1)} LUFS
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

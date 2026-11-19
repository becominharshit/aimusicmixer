"use client";

import React, { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import type { SpectralBand } from "@/types/report";

interface LiveSpectralGraphProps {
  spectralBands?: SpectralBand[];
  height?: number;
  compact?: boolean;
  className?: string;
}

const BAR_COUNT = 48;
const MIN_HZ = 20;
const MAX_HZ = 20000;
const BAND_CENTERS_HZ = [40, 120, 420, 1600, 5000, 12500];

function hzToX(hz: number, width: number): number {
  const ratio =
    Math.log10(Math.max(MIN_HZ, Math.min(MAX_HZ, hz)) / MIN_HZ) /
    Math.log10(MAX_HZ / MIN_HZ);
  return ratio * width;
}

function dbToNorm(db: number): number {
  return Math.max(0.06, Math.min(0.95, (db + 54) / 48));
}

function barColorForIndex(i: number, total: number): string {
  const t = i / Math.max(1, total - 1);
  if (t < 0.2) return "#E5483A"; // Sub/Low Vermilion
  if (t < 0.42) return "#E89B2D"; // Low-Mid Analog Amber
  if (t < 0.78) return "#22C58B"; // Mids/Presence Calibrated Sage
  return "#3B82F6"; // Air Cobalt
}

export function LiveSpectralGraph({
  spectralBands = [],
  height = 176,
  compact = false,
  className = "",
}: LiveSpectralGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isVisibleRef = useRef(true);
  const peakHoldRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));
  const freqBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const [isPlaying, setIsPlaying] = useState(() => studioAudioEngine.getState().isPlaying);
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    const sync = () => setIsPlaying(studioAudioEngine.getState().isPlaying);
    sync();
    return studioAudioEngine.subscribe(sync);
  }, []);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setThemeRevision((r) => r + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        isVisibleRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let rafId = 0;

    const renderFrame = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(220, Math.floor(rect.width));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (
        canvas.width !== Math.floor(width * dpr) ||
        canvas.height !== Math.floor(height * dpr)
      ) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const isDark = document.documentElement.classList.contains("dark");
      const bg = isDark ? "#0B0D12" : "#EAE4D7";
      const grid = isDark ? "rgba(255,255,255,0.06)" : "rgba(17,19,24,0.08)";
      const labelColor = isDark ? "#6B7280" : "#5D6575";
      const padBottom = 20;
      const plotH = Math.max(40, height - padBottom - 8);
      const plotTop = 8;

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Log-frequency grid ticks
      const ticks = [60, 250, 1000, 4000, 16000];
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillStyle = labelColor;
      ctx.textAlign = "center";

      for (const hz of ticks) {
        const x = Math.round(hzToX(hz, width)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, plotTop);
        ctx.lineTo(x, plotTop + plotH);
        ctx.stroke();
        const text = hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
        ctx.fillText(text, x, height - 5);
      }

      // Horizontal dB guides
      for (const ratio of [0.25, 0.5, 0.75]) {
        const y = Math.round(plotTop + plotH * ratio) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Translucent Genre Reference Target Envelope behind bars
      if (spectralBands.length >= 6) {
        const ordered = spectralBands.slice(0, 6);
        const upperPoints: Array<{ x: number; y: number }> = [];
        const lowerPoints: Array<{ x: number; y: number }> = [];

        ordered.forEach((b, idx) => {
          const x = hzToX(BAND_CENTERS_HZ[idx] ?? 1000, width);
          const lowDb =
            typeof b.genre_target_low_db === "number" ? b.genre_target_low_db : b.energy_db - 3;
          const highDb =
            typeof b.genre_target_high_db === "number" ? b.genre_target_high_db : b.energy_db + 3;
          upperPoints.push({ x, y: plotTop + plotH * (1 - dbToNorm(highDb)) });
          lowerPoints.push({ x, y: plotTop + plotH * (1 - dbToNorm(lowDb)) });
        });

        ctx.beginPath();
        ctx.moveTo(0, upperPoints[0].y);
        for (const p of upperPoints) ctx.lineTo(p.x, p.y);
        ctx.lineTo(width, upperPoints[upperPoints.length - 1].y);
        ctx.lineTo(width, lowerPoints[lowerPoints.length - 1].y);
        for (let i = lowerPoints.length - 1; i >= 0; i -= 1) {
          ctx.lineTo(lowerPoints[i].x, lowerPoints[i].y);
        }
        ctx.lineTo(0, lowerPoints[0].y);
        ctx.closePath();
        ctx.fillStyle = isDark ? "rgba(34, 197, 139, 0.08)" : "rgba(15, 143, 100, 0.10)";
        ctx.fill();

        ctx.strokeStyle = isDark ? "rgba(34, 197, 139, 0.42)" : "rgba(15, 143, 100, 0.45)";
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ordered.forEach((b, idx) => {
          const x = hzToX(BAND_CENTERS_HZ[idx] ?? 1000, width);
          const midDb =
            typeof b.genre_target_low_db === "number" && typeof b.genre_target_high_db === "number"
              ? (b.genre_target_low_db + b.genre_target_high_db) * 0.5
              : b.energy_db - b.delta_vs_genre_median_db;
          const y = plotTop + plotH * (1 - dbToNorm(midDb));
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Compute 48 log-spaced bar magnitudes
      const binCount = studioAudioEngine.getSpectrumBinCount();
      if (!freqBufferRef.current || freqBufferRef.current.length !== binCount) {
        freqBufferRef.current = new Uint8Array(new ArrayBuffer(binCount));
      }
      const { active, sampleRate } = studioAudioEngine.getFrequencyData(freqBufferRef.current);
      const peaks = peakHoldRef.current;

      const slotW = width / BAR_COUNT;
      const barW = Math.max(2, slotW - 2);
      const nyquist = sampleRate * 0.5;

      for (let i = 0; i < BAR_COUNT; i += 1) {
        const f0 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / BAR_COUNT);
        const f1 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (i + 1) / BAR_COUNT);
        const fc = Math.sqrt(f0 * f1);

        let level = 0;
        if (active && freqBufferRef.current) {
          const startBin = Math.max(1, Math.floor((f0 / nyquist) * binCount));
          const endBin = Math.min(
            binCount - 1,
            Math.max(startBin, Math.ceil((f1 / nyquist) * binCount))
          );
          let maxVal = 0;
          for (let b = startBin; b <= endBin; b += 1) {
            if (freqBufferRef.current[b] > maxVal) maxVal = freqBufferRef.current[b];
          }
          level = Math.max(0.03, maxVal / 255);
        } else if (spectralBands.length >= 6) {
          let nearest = spectralBands[0];
          let minDist = Infinity;
          for (let bIdx = 0; bIdx < 6; bIdx += 1) {
            const dist = Math.abs(Math.log10(fc) - Math.log10(BAND_CENTERS_HZ[bIdx]));
            if (dist < minDist) {
              minDist = dist;
              nearest = spectralBands[bIdx];
            }
          }
          level = dbToNorm(nearest.energy_db) * 0.78;
        } else {
          level = 0.08;
        }

        if (level >= peaks[i]) {
          peaks[i] = level;
        } else {
          peaks[i] = Math.max(level, peaks[i] - 0.014);
        }

        const barH = Math.max(3, level * plotH);
        const x = i * slotW + 1;
        const y = plotTop + plotH - barH;
        const color = barColorForIndex(i, BAR_COUNT);

        ctx.fillStyle = color;
        ctx.globalAlpha = active ? 0.92 : 0.65;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [2, 2, 0, 0]);
        ctx.fill();

        // Falling peak cap
        const capY = plotTop + plotH - Math.max(3, peaks[i] * plotH) - 2;
        ctx.globalAlpha = active ? 0.95 : 0.45;
        ctx.fillStyle = isDark ? "#F4F1EA" : "#111318";
        ctx.fillRect(x, Math.max(plotTop, capY), barW, 2);
      }

      ctx.globalAlpha = 1;
      ctx.restore();

      if (studioAudioEngine.getState().isPlaying && isVisibleRef.current) {
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    renderFrame();
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isPlaying, spectralBands, height, themeRevision]);

  return (
    <div
      ref={containerRef}
      data-testid="live-spectral-graph"
      className={`studio-card squircle-outer p-3.5 sm:p-4 ${className}`}
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--studio-mint)]" aria-hidden="true" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            {compact ? "Live Spectrum" : "48-Band Live Spectral Analyzer"}
          </span>
          <span className="tabular-telemetry text-[11px] text-[var(--text-muted)]">
            20 Hz–20 kHz
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <span className="h-1.5 w-3 rounded-xs bg-[var(--studio-mint)]/45 border border-[var(--studio-mint)]" />
            Genre Envelope
          </span>
          <span
            className={`tabular-telemetry rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              isPlaying
                ? "bg-[var(--studio-mint-soft)] text-[var(--studio-mint)]"
                : "bg-[var(--bg-inset)] text-[var(--text-muted)]"
            }`}
          >
            {isPlaying ? "60 FPS LIVE" : "MEASURED"}
          </span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        style={{ height }}
        className="block w-full rounded-xl border border-[var(--border-hairline)]"
      />
    </div>
  );
}

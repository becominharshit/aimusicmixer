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

const BAND_ZONES = [
  { id: "sub", label: "SUB", minHz: 20, maxHz: 60, color: "#FF3B1F" },
  { id: "low", label: "LOW", minHz: 60, maxHz: 250, color: "#F59E0B" },
  { id: "low_mid", label: "LOW-MID", minHz: 250, maxHz: 800, color: "#FFE01B" },
  { id: "high_mid", label: "HIGH-MID", minHz: 800, maxHz: 3000, color: "#22C58B" },
  { id: "presence", label: "PRESENCE", minHz: 3000, maxHz: 8000, color: "#38BDF8" },
  { id: "air", label: "AIR", minHz: 8000, maxHz: 20000, color: "#818CF8" },
] as const;

type BandZoneId = (typeof BAND_ZONES)[number]["id"];

function hzToX(hz: number, width: number): number {
  const ratio =
    Math.log10(Math.max(MIN_HZ, Math.min(MAX_HZ, hz)) / MIN_HZ) /
    Math.log10(MAX_HZ / MIN_HZ);
  return ratio * width;
}

function dbToNorm(db: number): number {
  return Math.max(0.06, Math.min(0.95, (db + 54) / 48));
}

function barColorForFreq(fc: number): string {
  if (fc < 60) return "#FF3B1F"; // Swiss Vermilion sub
  if (fc < 250) return "#F59E0B"; // Analog Amber low
  if (fc < 800) return "#FFE01B"; // Signal Yellow low-mid
  if (fc < 3200) return "#22C58B"; // Acid Mint mids
  if (fc < 8500) return "#38BDF8"; // Electric Cobalt presence
  return "#818CF8"; // Bright air harmonics
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
  const [activeZoneId, setActiveZoneId] = useState<BandZoneId | null>(null);

  useEffect(() => {
    const sync = () => setIsPlaying(studioAudioEngine.getState().isPlaying);
    sync();
    return studioAudioEngine.subscribe(sync);
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

  const selectedZone = BAND_ZONES.find((z) => z.id === activeZoneId) ?? null;
  const selectedBandInfo = selectedZone
    ? spectralBands.find((b) => b.band === selectedZone.id) ?? null
    : null;

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

      // Pure #0A0A0A hardware analyzer screen always
      const padBottom = 20;
      const plotH = Math.max(40, height - padBottom - 8);
      const plotTop = 8;

      ctx.fillStyle = "#0A0A0A";
      ctx.fillRect(0, 0, width, height);

      // Highlight selected clickable frequency zone if active
      if (selectedZone) {
        const zx1 = hzToX(selectedZone.minHz, width);
        const zx2 = hzToX(selectedZone.maxHz, width);
        ctx.fillStyle = "rgba(255, 224, 27, 0.10)";
        ctx.fillRect(zx1, plotTop, Math.max(4, zx2 - zx1), plotH);
        ctx.strokeStyle = "rgba(255, 224, 27, 0.65)";
        ctx.lineWidth = 1;
        ctx.strokeRect(zx1 + 0.5, plotTop + 0.5, Math.max(4, zx2 - zx1 - 1), plotH - 1);
      }

      // Log-frequency grid ticks
      const ticks = [60, 250, 1000, 4000, 16000];
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#8C95A6";
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
        ctx.fillStyle = "rgba(34, 197, 139, 0.11)";
        ctx.fill();

        ctx.strokeStyle = "rgba(34, 197, 139, 0.58)";
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

        const inSelectedZone =
          !selectedZone || (fc >= selectedZone.minHz && fc <= selectedZone.maxHz);

        const barH = Math.max(3, level * plotH);
        const x = i * slotW + 1;
        const y = plotTop + plotH - barH;
        const color = barColorForFreq(fc);

        ctx.fillStyle = color;
        ctx.globalAlpha = inSelectedZone ? (active ? 0.96 : 0.84) : 0.24;
        ctx.fillRect(x, y, barW, barH);

        // Crisp peak-hold cap
        const capY = plotTop + plotH - Math.max(3, peaks[i] * plotH) - 2;
        ctx.globalAlpha = inSelectedZone ? (active ? 1 : 0.65) : 0.2;
        ctx.fillStyle = "#F4F1EA";
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
  }, [isPlaying, spectralBands, height, selectedZone]);

  return (
    <div
      ref={containerRef}
      data-testid="live-spectral-graph"
      className={`border border-[#262B36] bg-[#0A0A0A] p-3.5 text-[#F4F1EA] sm:p-4 ${className}`}
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#FFE01B]" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-[0.04em] text-[#F4F1EA]">
            {compact ? "48-Band Spectrum" : "48-Band Live Spectral Analyzer"}
          </span>
          <span className="tabular-telemetry text-[11px] text-[#A1A8B8]">20 Hz–20 kHz</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[#A1A8B8]">
            <span className="h-1.5 w-3 border border-[#22C58B] bg-[#22C58B]/45" />
            Genre Envelope
          </span>
          <span
            className={`tabular-telemetry px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              isPlaying
                ? "bg-[#FFE01B] text-[#0A0A0A]"
                : "border border-[#262B36] bg-[#12151C] text-[#A1A8B8]"
            }`}
          >
            {isPlaying ? "60 FPS LIVE" : "MEASURED"}
          </span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        role="img"
        aria-label="48-Band Live Spectral Analyzer from 20 Hz to 20 kHz"
        style={{ height }}
        className="block w-full border border-[#262B36]"
      />

      {/* Clickable Frequency Band Zone Selectors */}
      <div
        className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5"
        role="group"
        aria-label="Frequency band zone selectors"
      >
        <div className="flex flex-wrap items-center gap-1">
          {BAND_ZONES.map((zone) => {
            const isSelected = activeZoneId === zone.id;
            return (
              <button
                key={zone.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setActiveZoneId((prev) => (prev === zone.id ? null : zone.id))}
                className={`inline-flex items-center gap-1 border px-2 py-0.5 tabular-telemetry text-[10px] font-bold uppercase tracking-[0.04em] transition-colors cursor-pointer ${
                  isSelected
                    ? "border-[#FFE01B] bg-[#FFE01B] text-[#0A0A0A]"
                    : "border-[#262B36] bg-[#12151C] text-[#A1A8B8] hover:border-[#F4F1EA] hover:text-[#F4F1EA]"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0"
                  style={{ backgroundColor: isSelected ? "#0A0A0A" : zone.color }}
                  aria-hidden="true"
                />
                {zone.label}
              </button>
            );
          })}
        </div>

        {selectedZone ? (
          <span className="tabular-telemetry text-[10px] text-[#FFE01B]">
            {selectedZone.minHz}–{selectedZone.maxHz >= 1000 ? `${selectedZone.maxHz / 1000}k` : selectedZone.maxHz} Hz
            {selectedBandInfo
              ? ` · ${selectedBandInfo.energy_db.toFixed(1)} dB (${selectedBandInfo.delta_vs_genre_median_db >= 0 ? "+" : ""}${selectedBandInfo.delta_vs_genre_median_db.toFixed(1)} vs target)`
              : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

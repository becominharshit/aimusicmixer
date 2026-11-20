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
  { id: "sub", label: "SUB", minHz: 20, maxHz: 60, color: "#EF6B63" },
  { id: "low", label: "LOW", minHz: 60, maxHz: 250, color: "#F0B44C" },
  { id: "low_mid", label: "LOW-MID", minHz: 250, maxHz: 800, color: "#F5C451" },
  { id: "high_mid", label: "HIGH-MID", minHz: 800, maxHz: 3000, color: "#38D39F" },
  { id: "presence", label: "PRESENCE", minHz: 3000, maxHz: 8000, color: "#5E9BFF" },
  { id: "air", label: "AIR", minHz: 8000, maxHz: 20000, color: "#B388FF" },
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

function barColorForFreq(fc: number): { top: string; base: string } {
  if (fc < 60) return { top: "#EF6B63", base: "rgba(239, 107, 99, 0.42)" }; // Soft Studio Coral
  if (fc < 250) return { top: "#F0B44C", base: "rgba(240, 180, 76, 0.42)" }; // Warm Marigold
  if (fc < 800) return { top: "#F5C451", base: "rgba(245, 196, 81, 0.42)" }; // Soft Marigold
  if (fc < 3200) return { top: "#38D39F", base: "rgba(56, 211, 159, 0.42)" }; // Mint Wave
  if (fc < 8500) return { top: "#5E9BFF", base: "rgba(94, 155, 255, 0.42)" }; // Electric Sky
  return { top: "#B388FF", base: "rgba(179, 136, 255, 0.42)" }; // Soft Orchid
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
  const smoothLevelsRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));
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
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId = 0;
    let alive = true;

    const renderFrame = (nowMs: number) => {
      if (!alive) return;

      if (!isVisibleRef.current) {
        if (!reducedMotion) {
          rafId = window.requestAnimationFrame(renderFrame);
        }
        return;
      }

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

      const padBottom = 20;
      const plotH = Math.max(40, height - padBottom - 8);
      const plotTop = 8;

      // Soft Charcoal-Obsidian studio instrument screen
      ctx.fillStyle = "#0B0E14";
      ctx.fillRect(0, 0, width, height);

      // Highlight selected clickable frequency zone if active
      if (selectedZone) {
        const zx1 = hzToX(selectedZone.minHz, width);
        const zx2 = hzToX(selectedZone.maxHz, width);
        ctx.fillStyle = "rgba(240, 180, 76, 0.11)";
        ctx.fillRect(zx1, plotTop, Math.max(4, zx2 - zx1), plotH);
        ctx.strokeStyle = "rgba(240, 180, 76, 0.65)";
        ctx.lineWidth = 1;
        ctx.strokeRect(zx1 + 0.5, plotTop + 0.5, Math.max(4, zx2 - zx1 - 1), plotH - 1);
      }

      // Log-frequency grid ticks
      const ticks = [60, 250, 1000, 4000, 16000];
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#707B8E";
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
        ctx.fillStyle = "rgba(56, 211, 159, 0.11)";
        ctx.fill();

        ctx.strokeStyle = "rgba(56, 211, 159, 0.58)";
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

      // Compute 48 log-spaced bar magnitudes (live audio FFT OR living ambient harmonic baseline)
      const binCount = studioAudioEngine.getSpectrumBinCount();
      if (!freqBufferRef.current || freqBufferRef.current.length !== binCount) {
        freqBufferRef.current = new Uint8Array(new ArrayBuffer(binCount));
      }
      const { active, sampleRate } = studioAudioEngine.getFrequencyData(freqBufferRef.current);
      const peaks = peakHoldRef.current;
      const smoothed = smoothLevelsRef.current;

      const slotW = width / BAR_COUNT;
      const barW = Math.max(2, slotW - 2);
      const nyquist = sampleRate * 0.5;
      const t = nowMs * 0.001;

      for (let i = 0; i < BAR_COUNT; i += 1) {
        const f0 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / BAR_COUNT);
        const f1 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (i + 1) / BAR_COUNT);
        const fc = Math.sqrt(f0 * f1);

        let targetLevel = 0;
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
          targetLevel = Math.max(0.04, maxVal / 255);
        } else {
          // Measured harmonic profile with subtle living ambient breath when paused
          let base = 0.22 + 0.16 * Math.sin(i * 0.22);
          if (spectralBands.length >= 6) {
            let nearest = spectralBands[0];
            let minDist = Infinity;
            for (let bIdx = 0; bIdx < 6; bIdx += 1) {
              const dist = Math.abs(Math.log10(fc) - Math.log10(BAND_CENTERS_HZ[bIdx]));
              if (dist < minDist) {
                minDist = dist;
                nearest = spectralBands[bIdx];
              }
            }
            base = dbToNorm(nearest.energy_db) * 0.78;
          }
          const ambientBreath = reducedMotion
            ? 0
            : Math.sin(t * 1.9 + i * 0.34) * 0.038 +
              Math.cos(t * 1.15 - i * 0.21) * 0.024;
          targetLevel = Math.max(0.06, Math.min(0.94, base + ambientBreath));
        }

        const lerpRate = active ? 0.42 : 0.16;
        smoothed[i] =
          smoothed[i] === 0 ? targetLevel : smoothed[i] + (targetLevel - smoothed[i]) * lerpRate;
        const level = smoothed[i];

        if (level >= peaks[i]) {
          peaks[i] = level;
        } else {
          peaks[i] = Math.max(level, peaks[i] - (active ? 0.012 : 0.005));
        }

        const inSelectedZone =
          !selectedZone || (fc >= selectedZone.minHz && fc <= selectedZone.maxHz);

        const barH = Math.max(3, level * plotH);
        const x = i * slotW + 1;
        const y = plotTop + plotH - barH;
        const palette = barColorForFreq(fc);

        const grad = ctx.createLinearGradient(0, y, 0, plotTop + plotH);
        grad.addColorStop(0, palette.top);
        grad.addColorStop(1, palette.base);

        ctx.fillStyle = grad;
        ctx.globalAlpha = inSelectedZone ? (active ? 0.96 : 0.86) : 0.22;
        ctx.fillRect(x, y, barW, barH);

        // Crisp peak-hold cap
        const capY = plotTop + plotH - Math.max(3, peaks[i] * plotH) - 2;
        ctx.globalAlpha = inSelectedZone ? (active ? 0.95 : 0.72) : 0.2;
        ctx.fillStyle = "#F2F0EA";
        ctx.fillRect(x, Math.max(plotTop, capY), barW, 2);
      }

      ctx.globalAlpha = 1;
      ctx.restore();

      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    renderFrame(performance.now());
    return () => {
      alive = false;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isPlaying, spectralBands, height, selectedZone]);

  return (
    <div
      ref={containerRef}
      data-testid="live-spectral-graph"
      className={`border border-white/10 bg-[#0E1117] p-3.5 text-[#F2F0EA] sm:p-4 ${className}`}
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#F0B44C]" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-[0.04em] text-[#F2F0EA]">
            {compact ? "48-Band Spectrum" : "48-Band Live Spectral Analyzer"}
          </span>
          <span className="tabular-telemetry text-[11px] text-[#98A2B3]">20 Hz–20 kHz</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[#98A2B3]">
            <span className="h-1.5 w-3 border border-[#38D39F] bg-[#38D39F]/40" />
            Genre Envelope
          </span>
          <span
            className={`tabular-telemetry px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              isPlaying
                ? "bg-[#F0B44C] text-[#111318]"
                : "border border-white/10 bg-[#151923] text-[#38D39F]"
            }`}
          >
            {isPlaying ? "60 FPS LIVE" : "AMBIENT · READY"}
          </span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        role="img"
        aria-label="48-Band Live Spectral Analyzer from 20 Hz to 20 kHz"
        style={{ height }}
        className="block w-full border border-white/10"
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
                    ? "border-[#F0B44C] bg-[#F0B44C] text-[#111318]"
                    : "border-white/10 bg-[#151923] text-[#98A2B3] hover:border-white/30 hover:text-[#F2F0EA]"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0"
                  style={{ backgroundColor: isSelected ? "#111318" : zone.color }}
                  aria-hidden="true"
                />
                {zone.label}
              </button>
            );
          })}
        </div>

        {selectedZone ? (
          <span className="tabular-telemetry text-[10px] text-[#F0B44C]">
            {selectedZone.minHz}–
            {selectedZone.maxHz >= 1000 ? `${selectedZone.maxHz / 1000}k` : selectedZone.maxHz} Hz
            {selectedBandInfo
              ? ` · ${selectedBandInfo.energy_db.toFixed(1)} dB (${selectedBandInfo.delta_vs_genre_median_db >= 0 ? "+" : ""}${selectedBandInfo.delta_vs_genre_median_db.toFixed(1)} vs target)`
              : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

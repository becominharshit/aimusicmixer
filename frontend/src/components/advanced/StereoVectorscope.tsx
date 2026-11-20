"use client";

import React, { useEffect, useRef } from "react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";

interface StereoVectorscopeProps {
  avgCorrelation: number;
  lowEndCorrelation?: number | null;
}

const INV_SQRT2 = Math.SQRT1_2;

export function StereoVectorscope({
  avgCorrelation,
  lowEndCorrelation,
}: StereoVectorscopeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCorrTextRef = useRef<HTMLSpanElement | null>(null);
  const liveBarRef = useRef<HTMLDivElement | null>(null);
  const isVisibleRef = useRef(true);

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
    const leftBuf = new Float32Array(new ArrayBuffer(512 * 4));
    const rightBuf = new Float32Array(new ArrayBuffer(512 * 4));
    let smoothedCorr = avgCorrelation;
    let rafId = 0;
    let alive = true;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const drawGrid = (ctx: CanvasRenderingContext2D, size: number, isDark: boolean) => {
      const cx = size / 2;
      const cy = size / 2;
      const r = size * 0.44;

      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.09)" : "rgba(20, 23, 31, 0.11)";
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.stroke();

      const d = r * INV_SQRT2;
      ctx.strokeStyle = isDark ? "rgba(56, 211, 159, 0.28)" : "rgba(18, 158, 110, 0.28)";
      ctx.beginPath();
      ctx.moveTo(cx - d, cy - d);
      ctx.lineTo(cx + d, cy + d);
      ctx.moveTo(cx + d, cy - d);
      ctx.lineTo(cx - d, cy + d);
      ctx.stroke();

      ctx.fillStyle = isDark ? "#98A2B3" : "#475467";
      ctx.font = "600 9px 'JetBrains Mono', ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("M (+)", cx, cy - r - 4);
      ctx.fillText("L", cx - d - 8, cy - d + 2);
      ctx.fillText("R", cx + d + 8, cy - d + 2);
      ctx.fillText("S", cx + r + 8, cy + 3);
    };

    const renderFrame = (nowMs: number) => {
      if (!alive) return;

      if (!isVisibleRef.current) {
        if (!reducedMotion) {
          rafId = window.requestAnimationFrame(renderFrame);
        }
        return;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const isDark = document.documentElement.classList.contains("dark");
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const size = Math.max(150, Math.min(canvas.clientWidth || 190, canvas.clientHeight || 190));
        const targetW = Math.floor(size * dpr);
        const targetH = Math.floor(size * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          const sample = studioAudioEngine.getVectorscopeSamples(leftBuf, rightBuf);

          if (sample.active) {
            ctx.fillStyle = isDark ? "rgba(11, 14, 20, 0.34)" : "rgba(249, 248, 244, 0.36)";
            ctx.fillRect(0, 0, size, size);
            drawGrid(ctx, size, isDark);

            const cx = size / 2;
            const cy = size / 2;
            const radius = size * 0.43;

            smoothedCorr = smoothedCorr * 0.82 + sample.correlation * 0.18;

            const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
            if (smoothedCorr < 0) {
              grad.addColorStop(0, "#EF6B63");
              grad.addColorStop(1, "#F0B44C");
            } else if (smoothedCorr < 0.25) {
              grad.addColorStop(0, "#F0B44C");
              grad.addColorStop(1, "#B388FF");
            } else {
              grad.addColorStop(0, "#38D39F");
              grad.addColorStop(0.55, "#5E9BFF");
              grad.addColorStop(1, "#B388FF");
            }

            ctx.beginPath();
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.4;
            ctx.globalAlpha = 0.9;

            for (let i = 0; i < leftBuf.length; i += 2) {
              const l = leftBuf[i];
              const r = rightBuf[i];
              const x = cx + (r - l) * INV_SQRT2 * radius;
              const y = cy - (l + r) * INV_SQRT2 * radius;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          } else {
            // Smooth living ambient Lissajous harmonic contour calibrated to measured avgCorrelation
            ctx.fillStyle = isDark ? "#0B0E14" : "#F2EFE7";
            ctx.fillRect(0, 0, size, size);
            drawGrid(ctx, size, isDark);

            const cx = size / 2;
            const cy = size / 2;
            const t = reducedMotion ? 0 : nowMs * 0.0012;
            const widthFactor = Math.max(
              0.12,
              Math.min(0.92, 1 - Math.max(0, avgCorrelation) * 0.74)
            );
            const rX = size * 0.34 * widthFactor * (1 + Math.sin(t * 1.4) * 0.06);
            const rY = size * 0.35 * (1 + Math.cos(t * 1.1) * 0.04);

            const grad = ctx.createLinearGradient(cx - rX, cy - rY, cx + rX, cy + rY);
            if (avgCorrelation < 0) {
              grad.addColorStop(0, "rgba(239, 107, 99, 0.72)");
              grad.addColorStop(1, "rgba(240, 180, 76, 0.62)");
            } else {
              grad.addColorStop(0, "rgba(56, 211, 159, 0.72)");
              grad.addColorStop(0.55, "rgba(94, 155, 255, 0.65)");
              grad.addColorStop(1, "rgba(179, 136, 255, 0.58)");
            }

            // Outer ambient stereo envelope
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const steps = 96;
            for (let i = 0; i <= steps; i += 1) {
              const theta = (i / steps) * Math.PI * 2;
              const harmonic = 1 + 0.07 * Math.sin(theta * 3 + t * 1.8) + 0.04 * Math.cos(theta * 5 - t * 1.3);
              const px = cx + Math.sin(theta + t * 0.45) * rX * harmonic;
              const py = cy + Math.cos(theta) * rY * harmonic;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();

            // Inner glowing figure-8 phase harmonic
            ctx.strokeStyle = isDark ? "rgba(94, 155, 255, 0.38)" : "rgba(59, 122, 245, 0.34)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i <= 72; i += 1) {
              const theta = (i / 72) * Math.PI * 2;
              const px = cx + Math.sin(theta * 2 + t * 0.9) * rX * 0.58;
              const py = cy + Math.sin(theta + t * 0.4) * rY * 0.72;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();

            smoothedCorr = avgCorrelation;
          }

          if (liveCorrTextRef.current) {
            const sign = smoothedCorr >= 0 ? "+" : "";
            liveCorrTextRef.current.textContent = `${sign}${smoothedCorr.toFixed(2)}`;
          }
          if (liveBarRef.current) {
            const pct = Math.max(0, Math.min(100, ((smoothedCorr + 1) / 2) * 100));
            liveBarRef.current.style.left = `${pct}%`;
          }
        }
      }

      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => {
      alive = false;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [avgCorrelation]);

  return (
    <div
      ref={containerRef}
      data-testid="stereo-vectorscope"
      className="flex flex-col items-center justify-between gap-2.5 bg-[var(--bg-inset)] p-3.5 hairline-border squircle-inner"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[var(--text-primary)]">
          Live Vectorscope (60 fps)
        </span>
        <span
          ref={liveCorrTextRef}
          className="bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-semibold text-[var(--studio-mint)] hairline-border tabular-telemetry squircle-inner"
        >
          {avgCorrelation >= 0 ? "+" : ""}
          {avgCorrelation.toFixed(2)}
        </span>
      </div>

      <div className="relative flex aspect-square w-full max-w-[196px] items-center justify-center overflow-hidden bg-[var(--bg-canvas)] hairline-border squircle-inner">
        <canvas
          ref={canvasRef}
          aria-label="Real-time stereo Lissajous vectorscope goniometer"
          className="block h-full w-full"
        />
      </div>

      <div className="w-full space-y-1">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)] hairline-border flex">
          <div className="w-1/2 bg-[var(--studio-vermilion-soft)]" />
          <div className="w-1/2 bg-[var(--studio-mint-soft)]" />
          <div
            ref={liveBarRef}
            style={{ left: `${Math.max(0, Math.min(100, ((avgCorrelation + 1) / 2) * 100))}%` }}
            className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-[var(--text-primary)]"
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] tabular-telemetry">
          <span>-1</span>
          <span>
            {typeof lowEndCorrelation === "number"
              ? `20–120 Hz: ${lowEndCorrelation >= 0 ? "+" : ""}${lowEndCorrelation.toFixed(2)}`
              : "L/R Lissajous"}
          </span>
          <span>+1</span>
        </div>
      </div>
    </div>
  );
}

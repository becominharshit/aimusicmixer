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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCorrTextRef = useRef<HTMLSpanElement | null>(null);
  const liveBarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const leftBuf = new Float32Array(new ArrayBuffer(512 * 4));
    const rightBuf = new Float32Array(new ArrayBuffer(512 * 4));
    let smoothedCorr = avgCorrelation;
    let rafId = 0;

    const drawGrid = (ctx: CanvasRenderingContext2D, size: number, isDark: boolean) => {
      const cx = size / 2;
      const cy = size / 2;
      const r = size * 0.44;

      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(17, 19, 24, 0.11)";
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
      ctx.strokeStyle = isDark ? "rgba(0, 217, 163, 0.25)" : "rgba(0, 153, 115, 0.25)";
      ctx.beginPath();
      ctx.moveTo(cx - d, cy - d);
      ctx.lineTo(cx + d, cy + d);
      ctx.moveTo(cx + d, cy - d);
      ctx.lineTo(cx - d, cy + d);
      ctx.stroke();

      ctx.fillStyle = isDark ? "#8A92A6" : "#4B5260";
      ctx.font = "600 9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("M (+)", cx, cy - r - 4);
      ctx.fillText("L", cx - d - 8, cy - d + 2);
      ctx.fillText("R", cx + d + 8, cy - d + 2);
      ctx.fillText("S", cx + r + 8, cy + 3);
    };

    const renderFrame = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const isDark = document.documentElement.classList.contains("dark");
        const dpr = window.devicePixelRatio || 1;
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
            ctx.fillStyle = isDark ? "rgba(13, 16, 23, 0.34)" : "rgba(239, 236, 227, 0.34)";
            ctx.fillRect(0, 0, size, size);
            drawGrid(ctx, size, isDark);

            const cx = size / 2;
            const cy = size / 2;
            const radius = size * 0.43;

            smoothedCorr = smoothedCorr * 0.82 + sample.correlation * 0.18;

            ctx.beginPath();
            ctx.strokeStyle =
              smoothedCorr < 0 ? "#FF4D3D" : smoothedCorr < 0.25 ? "#F5A623" : "#00D9A3";
            ctx.lineWidth = 1.3;
            ctx.globalAlpha = 0.88;

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
            ctx.fillStyle = isDark ? "#0D1017" : "#EFECE3";
            ctx.fillRect(0, 0, size, size);
            drawGrid(ctx, size, isDark);

            const cx = size / 2;
            const cy = size / 2;
            const widthFactor = Math.max(0.08, Math.min(0.95, 1 - Math.max(0, avgCorrelation) * 0.78));
            ctx.strokeStyle = isDark ? "rgba(0, 217, 163, 0.55)" : "rgba(0, 153, 115, 0.55)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(cx, cy, size * 0.34 * widthFactor, size * 0.34, 0, 0, Math.PI * 2);
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

      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, [avgCorrelation]);

  return (
    <div
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

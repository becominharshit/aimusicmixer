"use client";

import React, { useEffect, useRef } from "react";

interface AmbientSoundwaveCanvasProps {
  className?: string;
}

export function AmbientSoundwaveCanvas({ className = "" }: AmbientSoundwaveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let visible = true;
    let rafId = 0;
    let phase = 0;

    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              visible = entries[0]?.isIntersecting ?? true;
            },
            { threshold: 0.02 }
          )
        : null;
    observer?.observe(canvas);

    const ribbons = [
      { color: "rgba(0, 217, 163, 0.22)", amp: 24, freq: 0.0085, speed: 0.016, yRatio: 0.34, width: 1.8 },
      { color: "rgba(255, 77, 61, 0.19)", amp: 18, freq: 0.0115, speed: -0.012, yRatio: 0.52, width: 1.5 },
      { color: "rgba(245, 166, 35, 0.16)", amp: 28, freq: 0.0062, speed: 0.01, yRatio: 0.68, width: 1.4 },
      { color: "rgba(45, 107, 255, 0.14)", amp: 14, freq: 0.014, speed: 0.019, yRatio: 0.44, width: 1.1 },
    ];

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(300, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      for (const r of ribbons) {
        ctx.beginPath();
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width;
        const baseY = h * r.yRatio;
        for (let x = 0; x <= w; x += 6) {
          const envelope = Math.sin((x / w) * Math.PI);
          const y =
            baseY +
            Math.sin(x * r.freq + phase * r.speed * 45) * r.amp * envelope +
            Math.cos(x * r.freq * 0.55 - phase * r.speed * 25) * (r.amp * 0.45) * envelope;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.restore();
    };

    const tick = () => {
      if (visible) {
        phase += 0.016;
        draw();
      }
      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    draw();
    if (!reducedMotion) {
      rafId = window.requestAnimationFrame(tick);
    }

    return () => {
      observer?.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}

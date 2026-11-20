"use client";

import React, { useEffect, useRef } from "react";
import {
  METER_FLOOR_DB,
  useDawMeters,
  type ChainId,
  type ChannelMeter,
  type DawController,
  type MeterFrame,
  type PluginMeterReadout,
} from "../index";

export type DawMeterTarget =
  | { kind: "track"; trackId: string }
  | { kind: "returnA" }
  | { kind: "returnB" }
  | { kind: "master" }
  | { kind: "plugin"; chainId: ChainId; instanceId: string };

interface DawCanvasMeterProps {
  target: DawMeterTarget;
  controller?: DawController;
  orientation?: "vertical" | "horizontal";
  /** Render a downward Gain Reduction bar (gr > 0 drawn downward from top). */
  showGainReduction?: boolean;
  width?: number;
  height?: number;
  className?: string;
  label?: string;
}

const MIN_DISPLAY_DB = -60;
const MAX_DISPLAY_DB = 3;
const MAX_GR_DB = 24;

function dbToNorm(db: number): number {
  if (!Number.isFinite(db) || db <= METER_FLOOR_DB + 1) return 0;
  return Math.max(0, Math.min(1, (db - MIN_DISPLAY_DB) / (MAX_DISPLAY_DB - MIN_DISPLAY_DB)));
}

function resolveChannelMeter(frame: MeterFrame, target: DawMeterTarget): ChannelMeter | null {
  if (target.kind === "master") return frame.master;
  if (target.kind === "returnA") return frame.returnA;
  if (target.kind === "returnB") return frame.returnB;
  if (target.kind === "track") {
    const idx = frame.trackIds.indexOf(target.trackId);
    if (idx >= 0 && idx < frame.trackCount) {
      return frame.tracks[idx] ?? null;
    }
  }
  return null;
}

function drawSegmentedBarVertical(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  norm: number,
  holdNorm: number
) {
  ctx.fillStyle = "#161A22";
  ctx.fillRect(x, y, w, h);

  const filledH = Math.round(norm * h);
  if (filledH > 0) {
    const topY = y + h - filledH;
    // Calibrated zones: Acid Mint (-60..-12 dBFS), Signal Yellow (-12..-3 dBFS), Swiss Vermilion (> -3 dBFS)
    const yellowThreshY = y + h * (1 - dbToNorm(-12));
    const redThreshY = y + h * (1 - dbToNorm(-3));

    // Mint bottom portion
    const mintTop = Math.max(topY, yellowThreshY);
    if (mintTop < y + h) {
      ctx.fillStyle = "#38D39F";
      ctx.fillRect(x, mintTop, w, y + h - mintTop);
    }

    // Yellow mid-hot portion
    if (topY < yellowThreshY) {
      const yellowTop = Math.max(topY, redThreshY);
      ctx.fillStyle = "#F0B44C";
      ctx.fillRect(x, yellowTop, w, yellowThreshY - yellowTop);
    }

    // Vermilion peak/clip portion
    if (topY < redThreshY) {
      ctx.fillStyle = "#EF6B63";
      ctx.fillRect(x, topY, w, redThreshY - topY);
    }
  }

  // Crisp peak-hold cap
  if (holdNorm > 0.01) {
    const capY = Math.max(y, Math.min(y + h - 2, Math.round(y + h - holdNorm * h)));
    ctx.fillStyle = holdNorm >= dbToNorm(-1) ? "#EF6B63" : "#F4F1EA";
    ctx.fillRect(x, capY, w, 2);
  }
}

function drawSegmentedBarHorizontal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  norm: number,
  holdNorm: number
) {
  ctx.fillStyle = "#161A22";
  ctx.fillRect(x, y, w, h);

  const filledW = Math.round(norm * w);
  if (filledW > 0) {
    const yellowX = x + w * dbToNorm(-12);
    const redX = x + w * dbToNorm(-3);
    const endX = x + filledW;

    const mintEnd = Math.min(endX, yellowX);
    if (mintEnd > x) {
      ctx.fillStyle = "#38D39F";
      ctx.fillRect(x, y, mintEnd - x, h);
    }

    if (endX > yellowX) {
      const yellowEnd = Math.min(endX, redX);
      ctx.fillStyle = "#F0B44C";
      ctx.fillRect(yellowX, y, yellowEnd - yellowX, h);
    }

    if (endX > redX) {
      ctx.fillStyle = "#EF6B63";
      ctx.fillRect(redX, y, endX - redX, h);
    }
  }

  if (holdNorm > 0.01) {
    const capX = Math.max(x, Math.min(x + w - 2, Math.round(x + holdNorm * w)));
    ctx.fillStyle = holdNorm >= dbToNorm(-1) ? "#EF6B63" : "#F4F1EA";
    ctx.fillRect(capX, y, 2, h);
  }
}

/**
 * Reusable 60 fps HTML5 <canvas> stereo L/R + Gain Reduction meter.
 * Strictly zero React state updates per frame: painted inside `useDawMeters(onFrame)`.
 */
export function DawCanvasMeter({
  target,
  controller,
  orientation = "vertical",
  showGainReduction = false,
  width,
  height,
  className = "",
  label = "Audio level meter",
}: DawCanvasMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<DawMeterTarget>(target);
  const pluginReadoutRef = useRef<PluginMeterReadout>({ gainReductionDb: 0, vuDb: METER_FLOOR_DB });
  const sizeRef = useRef({
    w: width ?? (orientation === "vertical" ? (showGainReduction ? 26 : 18) : 132),
    h: height ?? (orientation === "vertical" ? 136 : 18),
  });

  targetRef.current = target;
  sizeRef.current = {
    w: width ?? (orientation === "vertical" ? (showGainReduction ? 26 : 18) : 132),
    h: height ?? (orientation === "vertical" ? 136 : 18),
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { w, h } = sizeRef.current;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }, [width, height, orientation, showGainReduction]);

  const { getPluginMeters } = useDawMeters((frame: MeterFrame) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#0A0A0A";
    ctx.fillRect(0, 0, w, h);

    const activeTarget = targetRef.current;

    if (activeTarget.kind === "plugin") {
      const readout = pluginReadoutRef.current;
      readout.gainReductionDb = 0;
      readout.vuDb = METER_FLOOR_DB;
      getPluginMeters(activeTarget.chainId, activeTarget.instanceId, readout);

      const vuNorm = dbToNorm(readout.vuDb);
      const grNorm = Math.max(0, Math.min(1, readout.gainReductionDb / MAX_GR_DB));

      if (orientation === "vertical") {
        const pad = 2;
        const innerH = h - pad * 2;
        if (showGainReduction) {
          const barW = Math.max(4, Math.floor((w - pad * 3) / 2));
          // Left bar: VU output level (bottom-up)
          drawSegmentedBarVertical(ctx, pad, pad, barW, innerH, vuNorm, vuNorm);
          // Right bar: Gain Reduction drawn strictly DOWNWARD from top (gr > 0 positive dB)
          const grX = pad * 2 + barW;
          ctx.fillStyle = "#161A22";
          ctx.fillRect(grX, pad, barW, innerH);
          const grH = Math.round(grNorm * innerH);
          if (grH > 0) {
            ctx.fillStyle = "#EF6B63";
            ctx.fillRect(grX, pad, barW, grH);
          }
        } else {
          drawSegmentedBarVertical(ctx, pad, pad, w - pad * 2, innerH, vuNorm, vuNorm);
        }
      } else {
        const pad = 2;
        const innerW = w - pad * 2;
        if (showGainReduction) {
          const rowH = Math.max(4, Math.floor((h - pad * 3) / 2));
          drawSegmentedBarHorizontal(ctx, pad, pad, innerW, rowH, vuNorm, vuNorm);
          // GR bar right-to-left reduction indicator
          const grY = pad * 2 + rowH;
          ctx.fillStyle = "#161A22";
          ctx.fillRect(pad, grY, innerW, rowH);
          const grW = Math.round(grNorm * innerW);
          if (grW > 0) {
            ctx.fillStyle = "#EF6B63";
            ctx.fillRect(pad + innerW - grW, grY, grW, rowH);
          }
        } else {
          drawSegmentedBarHorizontal(ctx, pad, pad, innerW, h - pad * 2, vuNorm, vuNorm);
        }
      }
      ctx.restore();
      return;
    }

    const ch = resolveChannelMeter(frame, activeTarget);
    const peakL = ch ? dbToNorm(ch.peakL) : 0;
    const peakR = ch ? dbToNorm(ch.peakR) : 0;
    const holdL = ch ? dbToNorm(ch.peakHoldL) : 0;
    const holdR = ch ? dbToNorm(ch.peakHoldR) : 0;
    const grDb =
      activeTarget.kind === "master"
        ? Math.max(ch?.gainReductionDb ?? 0, frame.safetyLimiterGainReductionDb)
        : (ch?.gainReductionDb ?? 0);
    const grNorm = Math.max(0, Math.min(1, grDb / MAX_GR_DB));

    if (orientation === "vertical") {
      const pad = 2;
      const gap = 2;
      const innerH = h - pad * 2;
      const cols = showGainReduction ? 3 : 2;
      const barW = Math.max(3, Math.floor((w - pad * 2 - gap * (cols - 1)) / cols));

      drawSegmentedBarVertical(ctx, pad, pad, barW, innerH, peakL, holdL);
      drawSegmentedBarVertical(ctx, pad + barW + gap, pad, barW, innerH, peakR, holdR);

      if (showGainReduction) {
        const grX = pad + (barW + gap) * 2;
        ctx.fillStyle = "#161A22";
        ctx.fillRect(grX, pad, barW, innerH);
        const grH = Math.round(grNorm * innerH);
        if (grH > 0) {
          ctx.fillStyle = "#EF6B63";
          ctx.fillRect(grX, pad, barW, grH);
        }
      }
    } else {
      const pad = 2;
      const gap = 2;
      const innerW = w - pad * 2;
      const rows = showGainReduction ? 3 : 2;
      const barH = Math.max(3, Math.floor((h - pad * 2 - gap * (rows - 1)) / rows));

      drawSegmentedBarHorizontal(ctx, pad, pad, innerW, barH, peakL, holdL);
      drawSegmentedBarHorizontal(ctx, pad, pad + barH + gap, innerW, barH, peakR, holdR);

      if (showGainReduction) {
        const grY = pad + (barH + gap) * 2;
        ctx.fillStyle = "#161A22";
        ctx.fillRect(pad, grY, innerW, barH);
        const grW = Math.round(grNorm * innerW);
        if (grW > 0) {
          ctx.fillStyle = "#EF6B63";
          ctx.fillRect(pad + innerW - grW, grY, grW, barH);
        }
      }
    }

    ctx.restore();
  }, controller);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      style={{ width: sizeRef.current.w, height: sizeRef.current.h }}
      className={`block shrink-0 border border-[#262B36] bg-[#0A0A0A] ${className}`}
    />
  );
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { STUDIO_EASE } from "@/lib/motion";

interface AnimatedMetricValueProps {
  value: number;
  decimals?: number;
  signed?: boolean;
  prefix?: string;
  suffix?: string;
  className?: string;
}

function formatNumber(val: number, decimals: number, signed: boolean): string {
  const safe = Number.isFinite(val) ? val : 0;
  const fixed = safe.toFixed(decimals);
  if (signed && safe >= 0 && !fixed.startsWith("+")) {
    return `+${fixed}`;
  }
  return fixed;
}

/**
 * Smooth numeric counter for Studio KPI telemetry cards.
 * - Renders the exact formatted target number immediately on initial SSR/mount
 *   so values are readable at t=0 and never flash "0.0", then animates smoothly
 *   when switching tracks or receiving updated DSP measurements.
 * - Strictly honors prefers-reduced-motion.
 */
export function AnimatedMetricValue({
  value,
  decimals = 1,
  signed = false,
  prefix = "",
  suffix = "",
  className = "",
}: AnimatedMetricValueProps) {
  const prefersReducedMotion = useReducedMotion();
  const prevValueRef = useRef<number>(value);
  const hasMountedRef = useRef(false);
  const [display, setDisplay] = useState<string>(() => formatNumber(value, decimals, signed));

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      prevValueRef.current = value;
      setDisplay(formatNumber(value, decimals, signed));
      return;
    }

    if (prefersReducedMotion || prevValueRef.current === value) {
      prevValueRef.current = value;
      setDisplay(formatNumber(value, decimals, signed));
      return;
    }

    const from = prevValueRef.current;
    prevValueRef.current = value;
    const controls = animate(from, value, {
      duration: 0.45,
      ease: STUDIO_EASE,
      onUpdate: (latest) => {
        setDisplay(formatNumber(latest, decimals, signed));
      },
      onComplete: () => {
        setDisplay(formatNumber(value, decimals, signed));
      },
    });

    return () => {
      controls.stop();
    };
  }, [value, decimals, signed, prefersReducedMotion]);

  return (
    <span className={`tabular-nums tabular-telemetry ${className}`}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

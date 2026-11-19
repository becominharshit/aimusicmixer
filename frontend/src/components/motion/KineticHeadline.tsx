"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { STUDIO_EASE } from "@/lib/motion";

interface KineticHeadlineProps {
  lines: string[];
  className?: string;
  as?: "h1" | "h2";
  delayBase?: number;
}

/**
 * Editorial kinetic headline reveal that animates GPU transform on mount
 * while ALWAYS preserving opacity === 1 as the resting and fallback state
 * so client-side back-navigation can never strand hero text invisible.
 */
export function KineticHeadline({
  lines,
  className = "",
  as = "h1",
  delayBase = 0.04,
}: KineticHeadlineProps) {
  const prefersReduced = useReducedMotion();
  const Tag = as;

  return (
    <Tag className={className} style={{ opacity: 1 }}>
      {lines.map((line, idx) => (
        <span key={line} className="block overflow-hidden pt-[0.04em] pb-[0.18em] -mb-[0.14em]">
          <motion.span
            className="block will-change-transform"
            initial={prefersReduced ? false : { y: "22%", opacity: 1 }}
            animate={{ y: "0%", opacity: 1 }}
            transition={{
              duration: prefersReduced ? 0 : 0.62,
              delay: prefersReduced ? 0 : delayBase + idx * 0.08,
              ease: STUDIO_EASE,
            }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { STUDIO_EASE } from "@/lib/motion";

interface KineticHeadlineProps {
  lines: string[];
  className?: string;
  as?: "h1" | "h2" | "h3";
  inView?: boolean;
  staggerSec?: number;
}

/**
 * Editorial Kinetic Mask-Reveal Typography:
 * - Keeps the outer heading element permanently at opacity: 1 (so hero text NEVER
 *   gets stuck invisible on initial mount or browser back-navigation).
 * - Hero headlines perform an immediate mask-wipe reveal on mount; scroll-revealed
 *   section headings start visible at subtle y-offset (never clipped invisible when
 *   jumping directly to the footer).
 * - Strictly honors prefers-reduced-motion.
 */
export function KineticHeadline({
  lines,
  className = "",
  as = "h1",
  inView = false,
  staggerSec = 0.065,
}: KineticHeadlineProps) {
  const prefersReducedMotion = useReducedMotion();
  const HeadingTag = as;

  return (
    <HeadingTag className={className} style={{ opacity: 1 }}>
      {lines.map((line, lineIdx) =>
        inView ? (
          prefersReducedMotion ? (
            <span key={`${line}-${lineIdx}`} className="block">
              {line}
            </span>
          ) : (
            <motion.span
              key={`${line}-${lineIdx}`}
              className="block will-change-transform"
              initial={{ y: 10, opacity: 0.96 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, amount: "some" }}
              transition={{
                duration: 0.42,
                delay: lineIdx * staggerSec,
                ease: STUDIO_EASE,
              }}
            >
              {line}
            </motion.span>
          )
        ) : (
          <span key={`${line}-${lineIdx}`} className="block overflow-hidden pb-[0.04em]">
            {prefersReducedMotion ? (
              <span className="block">{line}</span>
            ) : (
              <motion.span
                className="block will-change-transform"
                initial={{ y: "38%" }}
                animate={{ y: "0%" }}
                transition={{
                  duration: 0.44,
                  delay: lineIdx * staggerSec,
                  ease: STUDIO_EASE,
                }}
              >
                {line}
              </motion.span>
            )}
          </span>
        )
      )}
    </HeadingTag>
  );
}

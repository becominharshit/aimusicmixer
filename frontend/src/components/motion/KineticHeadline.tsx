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
  skipInitialAnimation?: boolean;
}

/**
 * Editorial Kinetic Mask-Reveal Typography:
 * - Keeps the outer heading element permanently at opacity: 1 (so hero text NEVER
 *   gets stuck invisible on initial mount or browser back-navigation).
 * - Hero headlines perform an immediate mask-wipe reveal on mount (or render statically
 *   when skipInitialAnimation is true after in-session navigation); scroll-revealed
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
  skipInitialAnimation = false,
}: KineticHeadlineProps) {
  const prefersReducedMotion = useReducedMotion();
  const bypassEntrance = Boolean(prefersReducedMotion || skipInitialAnimation);
  const HeadingTag = as;

  return (
    <HeadingTag className={className} style={{ opacity: 1 }}>
      {lines.map((line, lineIdx) =>
        inView ? (
          bypassEntrance ? (
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
          <span
            key={`${line}-${lineIdx}`}
            className={bypassEntrance ? "block pb-[0.04em]" : "block overflow-hidden pb-[0.04em]"}
          >
            {bypassEntrance ? (
              <span className="block" style={{ transform: "none", opacity: 1 }}>
                {line}
              </span>
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

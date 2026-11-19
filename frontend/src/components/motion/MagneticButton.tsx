"use client";

import React, { useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";

interface MagneticButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  "aria-label"?: string;
  "data-testid"?: string;
  strength?: number;
}

export function MagneticButton({
  children,
  className = "",
  onClick,
  disabled = false,
  type = "button",
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
  strength = 0.16,
}: MagneticButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const prefersReduced = useReducedMotion();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, STUDIO_SPRING);
  const y = useSpring(rawY, STUDIO_SPRING);

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (prefersReduced || disabled || e.pointerType !== "mouse") return;
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - (rect.left + rect.width / 2)) * strength;
    const dy = (e.clientY - (rect.top + rect.height / 2)) * strength;
    rawX.set(Math.max(-6, Math.min(6, dx)));
    rawY.set(Math.max(-4, Math.min(4, dy)));
  };

  const handlePointerLeave = () => {
    rawX.set(0);
    rawY.set(0);
  };

  return (
    <motion.button
      ref={buttonRef}
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={prefersReduced ? undefined : { x, y }}
      whileTap={disabled ? undefined : TACTILE_TAP}
      className={className}
    >
      {children}
    </motion.button>
  );
}

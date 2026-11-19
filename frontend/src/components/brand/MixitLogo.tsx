"use client";
/* eslint-disable @next/next/no-img-element */

import React from "react";

interface MixitLogoProps {
  /** "full" renders the complete MIXIT. lockup; "mark" renders only the square geometric emblem without text. */
  variant?: "full" | "mark";
  /** "light" uses crisp black wordmark for white/yellow surfaces; "dark" uses ivory wordmark for obsidian surfaces; "auto" follows html.dark. */
  tone?: "light" | "dark" | "auto";
  className?: string;
  heightClass?: string;
}

export function MixitLogo({
  variant = "full",
  tone = "auto",
  className = "",
  heightClass = "h-7",
}: MixitLogoProps) {
  if (variant === "mark") {
    return (
      <img
        src="/brand/mixit-mark.webp"
        alt="Mixit geometric vinyl and equalizer emblem"
        className={`${heightClass} w-auto shrink-0 select-none object-contain ${className}`}
        draggable={false}
      />
    );
  }

  if (tone === "light") {
    return (
      <img
        src="/brand/mixit-logo-full.webp"
        alt="Mixit audio diagnostics studio logo"
        className={`${heightClass} w-auto shrink-0 select-none object-contain ${className}`}
        draggable={false}
      />
    );
  }

  if (tone === "dark") {
    return (
      <img
        src="/brand/mixit-logo-full-dark.webp"
        alt="Mixit audio diagnostics studio logo"
        className={`${heightClass} w-auto shrink-0 select-none object-contain ${className}`}
        draggable={false}
      />
    );
  }

  // Auto mode switches cleanly with html.dark without hydration flicker
  return (
    <span className={`inline-flex items-center shrink-0 ${className}`}>
      <img
        src="/brand/mixit-logo-full.webp"
        alt="Mixit audio diagnostics studio logo"
        className={`${heightClass} w-auto shrink-0 select-none object-contain dark:hidden`}
        draggable={false}
      />
      <img
        src="/brand/mixit-logo-full-dark.webp"
        alt="Mixit audio diagnostics studio logo"
        className={`${heightClass} hidden w-auto shrink-0 select-none object-contain dark:block`}
        draggable={false}
      />
    </span>
  );
}

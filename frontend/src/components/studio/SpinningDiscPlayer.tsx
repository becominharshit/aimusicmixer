"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Pause, Play } from "lucide-react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import type { GenreType, SeverityType } from "@/types/report";

interface SpinningDiscPlayerProps {
  title: string;
  subtitle?: string;
  genre?: GenreType | string;
  health?: SeverityType;
  lufs?: number | null;
  truePeak?: number | null;
  bpm?: number | null;
  compact?: boolean;
  isLoadingAudio?: boolean;
  onTogglePlay?: () => void | Promise<void>;
  className?: string;
}

const HEALTH_ACCENT: Record<SeverityType, { primary: string; glow: string; label: string }> = {
  alert: {
    primary: "#FF4D3D",
    glow: "rgba(255, 77, 61, 0.38)",
    label: "Needs Attention",
  },
  caution: {
    primary: "#F5A623",
    glow: "rgba(245, 166, 35, 0.35)",
    label: "Review Recommended",
  },
  safe: {
    primary: "#00D9A3",
    glow: "rgba(0, 217, 163, 0.34)",
    label: "Balanced Headroom",
  },
};

export function SpinningDiscPlayer({
  title,
  subtitle,
  genre = "electronic",
  health = "safe",
  lufs,
  truePeak,
  bpm,
  compact = false,
  isLoadingAudio = false,
  onTogglePlay,
  className = "",
}: SpinningDiscPlayerProps) {
  const [engineState, setEngineState] = useState(() => studioAudioEngine.getState());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const discRef = useRef<HTMLDivElement | null>(null);
  const auraRef = useRef<HTMLDivElement | null>(null);
  const isVisibleRef = useRef(true);

  const angleRef = useRef(0);
  const velocityRef = useRef(0); // deg/sec (33.3 RPM = 199.8 deg/sec)
  const isPlayingRef = useRef(engineState.isPlaying);

  useEffect(() => {
    const sync = () => {
      const next = studioAudioEngine.getState();
      setEngineState(next);
      isPlayingRef.current = next.isPlaying;
    };
    sync();
    return studioAudioEngine.subscribe(sync);
  }, []);

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
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let rafId = 0;
    let lastTs = performance.now();
    const targetSpeed = 199.8; // 33.3 RPM

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      const playing = isPlayingRef.current;
      const visible = isVisibleRef.current;

      if (visible) {
        if (playing) {
          // Smooth direct-drive torque ramp-up
          velocityRef.current += (targetSpeed - velocityRef.current) * Math.min(1, dt * 6.5);
        } else {
          // Realistic platter inertia deceleration
          velocityRef.current *= Math.pow(0.04, dt);
          if (velocityRef.current < 0.4) {
            velocityRef.current = 0;
          }
        }

        if (velocityRef.current > 0) {
          angleRef.current = (angleRef.current + velocityRef.current * dt) % 360;
          if (discRef.current) {
            discRef.current.style.transform = `rotate(${angleRef.current.toFixed(2)}deg)`;
          }
        }

        if (auraRef.current) {
          const bass = playing ? studioAudioEngine.getSubBassEnergy() : 0;
          const scale = 1 + bass * 0.14;
          const opacity = playing ? 0.28 + bass * 0.48 : 0.08;
          auraRef.current.style.transform = `scale(${scale.toFixed(3)})`;
          auraRef.current.style.opacity = opacity.toFixed(3);
        }
      }

      if (playing || velocityRef.current > 0.4) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    };

    if (engineState.isPlaying || velocityRef.current > 0.4) {
      rafId = window.requestAnimationFrame(tick);
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [engineState.isPlaying]);

  const accent = HEALTH_ACCENT[health];
  const discSize = compact ? "w-44 h-44 sm:w-48 sm:h-48" : "w-52 h-52 sm:w-60 sm:h-60";
  const genreLabel = String(genre).replace(/_/g, " ").toUpperCase();

  const handlePlayClick = async () => {
    if (onTogglePlay) {
      await onTogglePlay();
      return;
    }
    if (engineState.hasPrimary) {
      await studioAudioEngine.togglePlay();
    }
  };

  return (
    <div
      ref={containerRef}
      data-testid="spinning-disc-player"
      className={`studio-card squircle-outer relative overflow-hidden p-4 sm:p-5 ${className}`}
    >
      {/* Subtle chassis header */}
      <div className="mb-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: accent.primary,
                boxShadow: engineState.isPlaying ? `0 0 10px ${accent.primary}` : "none",
              }}
            />
            <span className="truncate tabular-telemetry text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              DIRECT-DRIVE · 33.3 RPM
            </span>
          </div>
          <span
            className="shrink-0 rounded-md px-2 py-0.5 tabular-telemetry text-[10px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: `${accent.primary}1F`,
              color: accent.primary,
              border: `1px solid ${accent.primary}44`,
            }}
          >
            {accent.label}
          </span>
        </div>
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]" title={title}>
          {title}
        </p>
        {subtitle ? (
          <p className="truncate text-xs text-[var(--text-secondary)]" title={subtitle}>
            {subtitle}
          </p>
        ) : null}
      </div>

      {/* Platter & Tonearm Stage */}
      <div className="relative flex items-center justify-center py-2">
        {/* Sub-bass reactive radial aura */}
        <div
          ref={auraRef}
          aria-hidden="true"
          className="pointer-events-none absolute h-48 w-48 rounded-full blur-2xl transition-opacity duration-200 will-change-transform"
          style={{
            background: `radial-gradient(circle, ${accent.glow} 0%, transparent 72%)`,
            opacity: engineState.isPlaying ? 0.32 : 0.08,
          }}
        />

        {/* Platter recess ring */}
        <div className="relative flex items-center justify-center rounded-full border border-[var(--border-strong)] bg-[#090B10] p-2 shadow-[inset_0_2px_12px_rgba(0,0,0,0.7)]">
          {/* Spinning Vinyl Record */}
          <div
            ref={discRef}
            className={`relative ${discSize} rounded-full will-change-transform`}
            style={{
              background:
                "repeating-radial-gradient(circle at center, #12151D 0px, #12151D 2px, #1B202C 3px, #0D1016 4px)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.08)",
            }}
          >
            {/* Anisotropic vinyl sheen */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                background:
                  "conic-gradient(from 35deg, rgba(255,255,255,0.14) 0deg, transparent 42deg, transparent 150deg, rgba(255,255,255,0.1) 185deg, transparent 225deg, transparent 330deg, rgba(255,255,255,0.14) 360deg)",
              }}
            />

            {/* Outer lead-in groove ring */}
            <div className="pointer-events-none absolute inset-2.5 rounded-full border border-white/10" />
            <div className="pointer-events-none absolute inset-8 rounded-full border border-white/[0.06]" />

            {/* Color-coded center vinyl label */}
            <div
              className="absolute left-1/2 top-1/2 flex h-[38%] w-[38%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-black/30 text-center shadow-inner"
              style={{
                background: `radial-gradient(circle at 35% 30%, ${accent.primary}, #141822 145%)`,
              }}
            >
              <span className="tabular-telemetry text-[8px] font-bold tracking-[0.18em] text-[#0B0D11]/90">
                MIXBENCH
              </span>
              <span className="mt-0.5 max-w-[80%] truncate tabular-telemetry text-[7px] font-semibold uppercase tracking-wider text-[#0B0D11]/75">
                {genreLabel}
              </span>
            </div>
          </div>

          {/* Center interactive Play/Pause Spindle Hub (stays upright while disc spins) */}
          <button
            type="button"
            onClick={() => void handlePlayClick()}
            disabled={isLoadingAudio || (!onTogglePlay && !engineState.hasPrimary)}
            aria-label={engineState.isPlaying ? "Pause playback" : "Play mix on turntable"}
            className="absolute left-1/2 top-1/2 z-20 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-[#121620]/90 text-[#F5F2EB] shadow-lg backdrop-blur-sm transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoadingAudio ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-[var(--studio-mint)]" />
            ) : engineState.isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            )}
          </button>

          {/* Animated SVG Tonearm */}
          <motion.svg
            viewBox="0 0 120 180"
            aria-hidden="true"
            className="pointer-events-none absolute -right-4 -top-2 z-10 h-40 w-24 overflow-visible sm:-right-5 sm:h-44 sm:w-28"
            initial={false}
            animate={{ rotate: engineState.isPlaying ? 21 : 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 18, mass: 0.9 }}
            style={{ transformOrigin: "82px 26px" }}
          >
            {/* Gimbal base */}
            <circle cx="82" cy="26" r="15" fill="#1A1F2B" stroke="#3A4256" strokeWidth="2" />
            <circle cx="82" cy="26" r="6" fill="#9AA3B5" />
            {/* Counterweight */}
            <rect x="76" y="4" width="12" height="10" rx="3" fill="#2A3142" stroke="#4D566E" strokeWidth="1.5" />
            {/* S-shaped brushed metal tonearm */}
            <path
              d="M 82 26 L 82 92 C 82 114, 70 128, 56 144"
              fill="none"
              stroke="#C9D0DE"
              strokeWidth="4.2"
              strokeLinecap="round"
            />
            <path
              d="M 82 26 L 82 92 C 82 114, 70 128, 56 144"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.4"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            {/* Headshell cartridge */}
            <g transform="translate(46, 138) rotate(36)">
              <rect x="0" y="0" width="12" height="22" rx="2.5" fill="#171B24" stroke="#646F88" strokeWidth="1.3" />
              <circle cx="6" cy="18" r="2.2" fill={engineState.isPlaying ? accent.primary : "#646F88"} />
            </g>
          </motion.svg>
        </div>
      </div>

      {/* Telemetry readout strip */}
      {(typeof lufs === "number" || typeof truePeak === "number" || typeof bpm === "number") ? (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--border-hairline)] pt-3">
          <div className="studio-inset squircle-inner px-2.5 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Loudness
            </div>
            <div className="tabular-telemetry text-xs font-semibold text-[var(--text-primary)]">
              {typeof lufs === "number" ? `${lufs.toFixed(1)} LUFS` : "—"}
            </div>
          </div>
          <div className="studio-inset squircle-inner px-2.5 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              True Peak
            </div>
            <div
              className="tabular-telemetry text-xs font-semibold"
              style={{
                color:
                  typeof truePeak === "number" && truePeak > -0.2
                    ? "var(--studio-vermilion)"
                    : "var(--text-primary)",
              }}
            >
              {typeof truePeak === "number"
                ? `${truePeak > 0 ? "+" : ""}${truePeak.toFixed(1)} dBTP`
                : "—"}
            </div>
          </div>
          <div className="studio-inset squircle-inner px-2.5 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Tempo
            </div>
            <div className="tabular-telemetry text-xs font-semibold text-[var(--text-primary)]">
              {typeof bpm === "number" ? `${Math.round(bpm)} BPM` : "—"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

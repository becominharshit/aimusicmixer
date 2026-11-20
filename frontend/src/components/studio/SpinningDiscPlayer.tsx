"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Pause, Play } from "lucide-react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import { TACTILE_TAP } from "@/lib/motion";
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

const HEALTH_ACCENT: Record<SeverityType, { primary: string; soft: string; label: string }> = {
  alert: {
    primary: "#FF3B1F",
    soft: "rgba(255, 59, 31, 0.16)",
    label: "Needs Attention",
  },
  caution: {
    primary: "#FFE01B",
    soft: "rgba(255, 224, 27, 0.16)",
    label: "Review Recommended",
  },
  safe: {
    primary: "#22C58B",
    soft: "rgba(34, 197, 139, 0.16)",
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
  const bassGlowRef = useRef<HTMLDivElement | null>(null);
  const freqBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const isVisibleRef = useRef(true);

  const angleRef = useRef(0);
  const velocityRef = useRef(0); // deg/sec (33.3 RPM = 199.8 deg/sec)
  const bassSmoothRef = useRef(0);
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
          velocityRef.current += (targetSpeed - velocityRef.current) * Math.min(1, dt * 6.5);
        } else {
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

        // Compute real-time 20–120 Hz bass energy from AnalyserNode for reactive rim glow
        let targetBass = 0;
        if (playing) {
          const binCount = studioAudioEngine.getSpectrumBinCount();
          if (!freqBufferRef.current || freqBufferRef.current.length !== binCount) {
            freqBufferRef.current = new Uint8Array(new ArrayBuffer(binCount));
          }
          const { active, sampleRate } = studioAudioEngine.getFrequencyData(freqBufferRef.current);
          if (active && freqBufferRef.current) {
            const nyquist = sampleRate * 0.5;
            const startBin = Math.max(1, Math.floor((20 / nyquist) * binCount));
            const endBin = Math.min(binCount - 1, Math.max(startBin, Math.ceil((120 / nyquist) * binCount)));
            let sum = 0;
            for (let b = startBin; b <= endBin; b += 1) {
              sum += freqBufferRef.current[b];
            }
            targetBass = sum / Math.max(1, endBin - startBin + 1) / 255;
          }
        }

        bassSmoothRef.current += (targetBass - bassSmoothRef.current) * Math.min(1, dt * 14);
        if (bassGlowRef.current) {
          const energy = bassSmoothRef.current;
          const opacity = playing ? Math.min(0.95, 0.16 + energy * 0.85) : Math.max(0, energy * 0.5);
          const scale = 1 + energy * 0.06;
          bassGlowRef.current.style.opacity = opacity.toFixed(3);
          bassGlowRef.current.style.transform = `scale(${scale.toFixed(3)})`;
        }
      }

      if (playing || velocityRef.current > 0.4 || bassSmoothRef.current > 0.01) {
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
  const discSize = compact
    ? "w-44 h-44 sm:w-52 sm:h-52"
    : "w-56 h-56 sm:w-64 sm:h-64";
  const genreLabel = String(genre).replace(/_/g, " ");

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
      className={`relative overflow-hidden border border-[#262B36] bg-[#0A0A0A] p-4 text-[#F4F1EA] sm:p-5 ${className}`}
    >
      {/* Hardware Deck Header — never clips mid-word */}
      <div className="mb-3 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: accent.primary }}
            />
            <span className="whitespace-nowrap text-[11px] font-semibold text-[#A1A8B8]">
              Direct-Drive{" "}
              <span className="tabular-telemetry text-[#F4F1EA]">33.3 RPM</span>
            </span>
          </div>
          <span
            className="shrink-0 whitespace-nowrap px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
            style={{
              backgroundColor: accent.soft,
              color: accent.primary,
              border: `1px solid ${accent.primary}55`,
            }}
          >
            {accent.label}
          </span>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p
            className="min-w-0 break-words text-sm font-bold text-[#F4F1EA]"
            title={title}
          >
            {title}
          </p>
          <span className="shrink-0 text-[11px] font-medium capitalize text-[#A1A8B8]">
            {genreLabel}
          </span>
        </div>

        {subtitle ? (
          <p className="text-xs leading-snug text-[#A1A8B8]" title={subtitle}>
            {subtitle}
          </p>
        ) : null}
      </div>

      {/* Physical Hardware Platter, Bass-Reactive Radial Rim Glow & Tonearm Stage */}
      <div className="relative flex items-center justify-center py-3">
        {/* Bass-reactive 20–120 Hz vibrant rim halo (GPU transform/opacity only) */}
        <div
          ref={bassGlowRef}
          aria-hidden="true"
          className="pointer-events-none absolute h-60 w-60 rounded-full opacity-0 will-change-transform sm:h-68 sm:w-68"
          style={{
            background:
              "radial-gradient(circle, rgba(255,59,31,0.34) 44%, rgba(255,224,27,0.22) 60%, rgba(34,197,139,0.14) 74%, transparent 82%)",
            filter: "blur(10px)",
          }}
        />

        {/* Machined matte-obsidian platter recess */}
        <div className="relative flex items-center justify-center rounded-full border border-[#2D3340] bg-[#050608] p-2.5">
          {/* Strobe bevel ticks ring */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-1 rounded-full border border-dashed border-white/[0.15]"
          />

          {/* Photorealistic Pressed Vinyl Record (rotates at 33.3 RPM) */}
          <div
            ref={discRef}
            className={`relative ${discSize} overflow-hidden rounded-full bg-[#0A0A0A] will-change-transform`}
            style={{
              boxShadow:
                "0 12px 28px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.1)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/media/vinyl-platter-macro.webp"
              alt="Pressed matte-black studio vinyl platter"
              width={1200}
              height={1200}
              draggable={false}
              className="h-full w-full scale-[1.03] select-none object-cover"
            />

            {/* Machined signal ring around titanium hub */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-[39%] w-[39%] -translate-x-1/2 -translate-y-1/2 rounded-full border"
              style={{ borderColor: `${accent.primary}80` }}
            />
          </div>

          {/* Stationary top specular studio key light reflection */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-2.5 rounded-full"
            style={{
              background:
                "conic-gradient(from 32deg, rgba(244,241,234,0.09) 0deg, transparent 36deg, transparent 175deg, rgba(255,224,27,0.08) 205deg, transparent 240deg, transparent 360deg)",
            }}
          />

          {/* Center Interactive Play/Pause Spindle Hub */}
          <motion.button
            type="button"
            whileTap={TACTILE_TAP}
            onClick={() => void handlePlayClick()}
            disabled={isLoadingAudio || (!onTogglePlay && !engineState.hasPrimary)}
            aria-label={engineState.isPlaying ? "Pause playback" : "Play mix on turntable"}
            className="absolute left-1/2 top-1/2 z-20 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#FFE01B] bg-[#0A0A0A]/92 text-[#FFE01B] transition-colors hover:bg-[#FFE01B] hover:text-[#0A0A0A] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {isLoadingAudio ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#FFE01B]/30 border-t-[#FFE01B]" />
            ) : engineState.isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            )}
          </motion.button>

          {/* Animated Brushed Aluminum S-Tonearm */}
          <motion.svg
            viewBox="0 0 120 180"
            aria-hidden="true"
            className="pointer-events-none absolute -right-4 -top-2 z-10 h-44 w-24 overflow-visible sm:-right-5 sm:h-48 sm:w-28"
            initial={false}
            animate={{ rotate: engineState.isPlaying ? 21 : 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 18, mass: 0.9 }}
            style={{ transformOrigin: "82px 26px" }}
          >
            <circle cx="82" cy="26" r="15" fill="#141820" stroke="#394152" strokeWidth="1.8" />
            <circle cx="82" cy="26" r="6" fill="#A1A8B8" />
            <rect
              x="76"
              y="4"
              width="12"
              height="10"
              rx="2"
              fill="#232834"
              stroke="#525B70"
              strokeWidth="1.4"
            />
            <path
              d="M 82 26 L 82 92 C 82 114, 70 128, 56 144"
              fill="none"
              stroke="#E5E7EB"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d="M 82 26 L 82 92 C 82 114, 70 128, 56 144"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.45"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
            <g transform="translate(46, 138) rotate(36)">
              <rect
                x="0"
                y="0"
                width="12"
                height="22"
                rx="1.5"
                fill="#11141B"
                stroke="#6B7280"
                strokeWidth="1.2"
              />
              <circle
                cx="6"
                cy="18"
                r="2.4"
                fill={engineState.isPlaying ? "#FFE01B" : "#6B7280"}
              />
            </g>
          </motion.svg>
        </div>
      </div>

      {/* Calibrated Single-Line Telemetry Strip — generous horizontal breathing room */}
      {typeof lufs === "number" || typeof truePeak === "number" || typeof bpm === "number" ? (
        <div
          className={`mt-3 grid gap-2 border-t border-[#262B36] pt-3 ${
            compact ? "grid-cols-2" : "grid-cols-3"
          }`}
        >
          <div
            data-testid="hero-metric-cell"
            className="min-w-0 border border-[#262B36] bg-[#12151C] px-4 py-3"
          >
            <div className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.06em] text-[#A1A8B8]">
              Loudness
            </div>
            <div className="mt-1 whitespace-nowrap tabular-telemetry tabular-nums text-xs font-semibold text-[#F4F1EA]">
              {typeof lufs === "number" ? (
                <>
                  {lufs.toFixed(1)}{" "}
                  <span className="text-[10px] font-normal text-[#A1A8B8]">LUFS</span>
                </>
              ) : (
                "—"
              )}
            </div>
          </div>

          <div
            data-testid="hero-metric-cell"
            className="min-w-0 border border-[#262B36] bg-[#12151C] px-4 py-3"
          >
            <div className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.06em] text-[#A1A8B8]">
              True Peak
            </div>
            <div
              className="mt-1 whitespace-nowrap tabular-telemetry tabular-nums text-xs font-semibold"
              style={{
                color:
                  typeof truePeak === "number" && truePeak > -0.2 ? "#FF3B1F" : "#F4F1EA",
              }}
            >
              {typeof truePeak === "number" ? (
                <>
                  {truePeak > 0 ? "+" : ""}
                  {truePeak.toFixed(1)}{" "}
                  <span className="text-[10px] font-normal text-[#A1A8B8]">dBTP</span>
                </>
              ) : (
                "—"
              )}
            </div>
          </div>

          <div
            data-testid="hero-metric-cell"
            className={`min-w-0 border border-[#262B36] bg-[#12151C] px-4 py-3 ${
              compact ? "col-span-2 flex items-center justify-between gap-3" : ""
            }`}
          >
            <div className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.06em] text-[#A1A8B8]">
              Tempo
            </div>
            <div
              className={`whitespace-nowrap tabular-telemetry tabular-nums text-xs font-semibold text-[#F4F1EA] ${
                compact ? "" : "mt-1"
              }`}
            >
              {typeof bpm === "number" ? (
                <>
                  {Math.round(bpm)}{" "}
                  <span className="text-[10px] font-normal text-[#A1A8B8]">BPM</span>
                </>
              ) : (
                "—"
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

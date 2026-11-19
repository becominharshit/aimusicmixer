"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Disc3, Play, ShieldCheck, Sliders, Upload, Volume2 } from "lucide-react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import { AmbientSoundwaveCanvas } from "@/components/studio/AmbientSoundwaveCanvas";
import { LiveSpectralGraph } from "@/components/studio/LiveSpectralGraph";
import { SpinningDiscPlayer } from "@/components/studio/SpinningDiscPlayer";
import type { SpectralBand } from "@/types/report";

const HERO_DEMO_URL = "/demo/demo-flawed-v1.wav";

const HERO_DEMO_BANDS: SpectralBand[] = [
  { band: "sub", range_hz: "20–60 Hz", energy_db: -18.2, delta_vs_genre_median_db: 3.1, genre_target_low_db: -23, genre_target_high_db: -19 },
  { band: "low", range_hz: "60–250 Hz", energy_db: -15.4, delta_vs_genre_median_db: 2.2, genre_target_low_db: -20, genre_target_high_db: -16 },
  { band: "low_mid", range_hz: "250–800 Hz", energy_db: -19.8, delta_vs_genre_median_db: 2.9, genre_target_low_db: -25, genre_target_high_db: -20.5 },
  { band: "high_mid", range_hz: "800–3k Hz", energy_db: -23.1, delta_vs_genre_median_db: -0.9, genre_target_low_db: -25, genre_target_high_db: -20 },
  { band: "presence", range_hz: "3k–8k Hz", energy_db: -27.5, delta_vs_genre_median_db: -1.6, genre_target_low_db: -29, genre_target_high_db: -24 },
  { band: "air", range_hz: "8k–20k Hz", energy_db: -34.2, delta_vs_genre_median_db: -2.4, genre_target_low_db: -35, genre_target_high_db: -29 },
];

const HERO_FLAW_PINS = [
  {
    id: "sub_phase",
    label: "Wide Sub-Bass < 120 Hz",
    metric: "+0.18 corr",
    timeSec: 1.5,
    endSec: 5.5,
    color: "#2D6BFF",
  },
  {
    id: "mud_buildup",
    label: "Low-Mid Mud 250–500 Hz",
    metric: "+2.9 dB",
    timeSec: 5.5,
    endSec: 9.5,
    color: "#F5A623",
  },
  {
    id: "true_peak_clip",
    label: "Inter-Sample True Peak Clip",
    metric: "+0.6 dBTP",
    timeSec: 9.0,
    endSec: 13.0,
    color: "#FF4D3D",
  },
];

interface HeroTurntableSectionProps {
  onTryDemoMix: () => void;
  onFocusDropzone: () => void;
  busy?: boolean;
}

export function HeroTurntableSection({
  onTryDemoMix,
  onFocusDropzone,
  busy = false,
}: HeroTurntableSectionProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [heroAudioLoading, setHeroAudioLoading] = useState(false);
  const [heroAudioError, setHeroAudioError] = useState<string | null>(null);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(() => studioAudioEngine.getState().isPlaying);

  useEffect(() => {
    const sync = () => setIsPlaying(studioAudioEngine.getState().isPlaying);
    sync();
    return studioAudioEngine.subscribe(sync);
  }, []);

  // Optional Lenis smooth scroll & GSAP subtle parallax reveal (strictly honoring reduced-motion)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reducedMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let cancelled = false;
    let rafId = 0;
    let destroyLenis: (() => void) | null = null;
    let revertGsap: (() => void) | null = null;

    void (async () => {
      try {
        const [{ default: Lenis }, gsapModule, scrollTriggerModule] = await Promise.all([
          import("lenis"),
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        if (cancelled) return;

        const gsap = gsapModule.default || gsapModule.gsap;
        const ScrollTrigger = scrollTriggerModule.ScrollTrigger;
        gsap.registerPlugin(ScrollTrigger);

        const lenis = new Lenis({
          duration: 1.05,
          smoothWheel: true,
          wheelMultiplier: 0.9,
        });
        lenis.on("scroll", ScrollTrigger.update);

        const raf = (time: number) => {
          lenis.raf(time);
          rafId = window.requestAnimationFrame(raf);
        };
        rafId = window.requestAnimationFrame(raf);
        destroyLenis = () => {
          window.cancelAnimationFrame(rafId);
          lenis.destroy();
        };

        if (sectionRef.current) {
          const ctx = gsap.context(() => {
            gsap.fromTo(
              ".hero-reveal-item",
              { y: 18, opacity: 0 },
              {
                y: 0,
                opacity: 1,
                duration: 0.65,
                stagger: 0.08,
                ease: "power3.out",
                clearProps: "transform",
              }
            );
          }, sectionRef);
          revertGsap = () => ctx.revert();
        }
      } catch {
        // Non-fatal in headless/test environments
      }
    })();

    return () => {
      cancelled = true;
      destroyLenis?.();
      revertGsap?.();
    };
  }, []);

  const ensureDemoAudioLoaded = async (): Promise<boolean> => {
    if (studioAudioEngine.getSlotLoaded("primary")) {
      return true;
    }
    setHeroAudioLoading(true);
    setHeroAudioError(null);
    try {
      await studioAudioEngine.loadSlot("primary", HERO_DEMO_URL, -8.4);
      return true;
    } catch {
      setHeroAudioError("Demo preview audio could not be decoded in this browser.");
      return false;
    } finally {
      setHeroAudioLoading(false);
    }
  };

  const handleToggleHeroVinyl = async () => {
    if (studioAudioEngine.getState().isPlaying) {
      studioAudioEngine.pause();
      return;
    }
    const ok = await ensureDemoAudioLoaded();
    if (ok) {
      await studioAudioEngine.play();
    }
  };

  const handleAuditionPin = async (pin: (typeof HERO_FLAW_PINS)[number]) => {
    setActivePinId(pin.id);
    const ok = await ensureDemoAudioLoaded();
    if (ok) {
      await studioAudioEngine.auditionRange(pin.timeSec, pin.endSec);
    }
  };

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden rounded-[24px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-5 py-7 sm:px-8 sm:py-10"
    >
      <AmbientSoundwaveCanvas className="opacity-80" />

      <div className="relative z-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
        {/* Left: Editorial Display Typography & Actions */}
        <div className="space-y-5 lg:col-span-6">
          <div className="hero-reveal-item inline-flex items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/90 px-3 py-1.5 backdrop-blur-sm">
            <span className="h-2 w-2 rounded-full bg-[var(--studio-mint)]" />
            <span className="tabular-telemetry text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              ITU-R BS.1770-4 · 4x True Peak · Zero AI Hallucination
            </span>
          </div>

          <h1 className="hero-reveal-item font-display text-3xl font-bold leading-[1.06] tracking-tight text-[var(--text-primary)] sm:text-5xl">
            Hear every mix flaw.{" "}
            <span className="text-[var(--studio-mint)]">Prove every fix</span> with deterministic DSP.
          </h1>

          <p className="hero-reveal-item max-w-xl text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
            Drop a WAV, FLAC, MP3, or AIFF mix for calibrated loudness, 4x oversampled True Peak,
            sub-bass phase correlation, 6-band genre reference curves, and evidence-grounded
            Gemini 4 Hydrogen studio coaching.
          </p>

          <div className="hero-reveal-item flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onFocusDropzone}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--studio-mint)] px-5 py-3 text-sm font-semibold text-[#0B0D11] shadow-sm transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              Drop or Browse Mix
            </button>

            <button
              type="button"
              onClick={() => void handleToggleHeroVinyl()}
              disabled={heroAudioLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--studio-vermilion)]/45 bg-[var(--studio-vermilion-soft)] px-4 py-3 text-sm font-semibold text-[var(--studio-vermilion)] transition-colors hover:bg-[var(--studio-vermilion)] hover:text-[#0B0D11] disabled:opacity-50"
            >
              <Disc3 className={`h-4 w-4 ${isPlaying ? "animate-spin" : ""}`} />
              {isPlaying ? "Pause Demo Vinyl" : "Play Demo Vinyl"}
            </button>

            <button
              type="button"
              onClick={onTryDemoMix}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--studio-mint)] disabled:opacity-50"
            >
              <Sliders className="h-4 w-4 text-[var(--studio-amber)]" />
              Try Sample Flawed Mix
            </button>
          </div>

          {heroAudioError ? (
            <p className="text-xs font-medium text-[var(--studio-vermilion)]">{heroAudioError}</p>
          ) : null}

          {/* Clean Hardware Spec Bar */}
          <div className="hero-reveal-item grid grid-cols-3 gap-2.5 pt-2">
            <div className="studio-inset squircle-inner px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--studio-mint)]" />
                Privacy First
              </div>
              <p className="mt-0.5 text-xs font-medium text-[var(--text-primary)]">
                AI toggles OFF by default
              </p>
            </div>
            <div className="studio-inset squircle-inner px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Volume2 className="h-3.5 w-3.5 text-[var(--studio-amber)]" />
                Browser DSP
              </div>
              <p className="mt-0.5 text-xs font-medium text-[var(--text-primary)]">
                Instant local fallback
              </p>
            </div>
            <div className="studio-inset squircle-inner px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Play className="h-3.5 w-3.5 text-[var(--studio-vermilion)]" />
                Loop Audition
              </div>
              <p className="mt-0.5 text-xs font-medium text-[var(--text-primary)]">
                Jump straight to flaws
              </p>
            </div>
          </div>
        </div>

        {/* Right: Interactive Turntable Deck + Live Spectral Preview */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
          className="space-y-3 lg:col-span-6"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-6">
              <SpinningDiscPlayer
                title="unmastered_mix_v1.wav"
                subtitle="Interactive Demo Vinyl · Click spindle to spin"
                genre="electronic"
                health="alert"
                lufs={-8.4}
                truePeak={0.6}
                bpm={124}
                compact
                isLoadingAudio={heroAudioLoading}
                onTogglePlay={handleToggleHeroVinyl}
              />
            </div>

            <div className="flex flex-col justify-between gap-3 sm:col-span-6">
              <LiveSpectralGraph spectralBands={HERO_DEMO_BANDS} height={148} compact />

              {/* Clickable Flaw Pin Preview Card */}
              <div className="studio-card squircle-outer p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="tabular-telemetry text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Audition Detected Demo Flaws
                  </span>
                  <span className="tabular-telemetry text-[10px] text-[var(--studio-vermilion)]">
                    3 pins
                  </span>
                </div>
                <div className="space-y-1.5">
                  {HERO_FLAW_PINS.map((pin) => {
                    const selected = activePinId === pin.id && isPlaying;
                    return (
                      <button
                        key={pin.id}
                        type="button"
                        onClick={() => void handleAuditionPin(pin)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                          selected
                            ? "border-[var(--studio-mint)] bg-[var(--studio-mint-soft)]"
                            : "border-[var(--border-hairline)] bg-[var(--bg-inset)] hover:border-[var(--border-strong)]"
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: pin.color }}
                          />
                          <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                            {pin.label}
                          </span>
                        </span>
                        <span
                          className="shrink-0 tabular-telemetry text-[10px] font-semibold"
                          style={{ color: pin.color }}
                        >
                          {pin.metric}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

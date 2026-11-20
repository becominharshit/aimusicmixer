"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowRight, ArrowUpRight, Pause, Play, Plus } from "lucide-react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import { AuthModal } from "@/components/auth/AuthModal";
import { MixitLogo } from "@/components/brand/MixitLogo";
import {
  COOKIE_CONSENT_EVENT,
  COOKIE_CONSENT_KEY,
} from "@/components/compliance/CookieConsentBanner";
import { KineticHeadline } from "@/components/motion/KineticHeadline";
import { FlawTimelineBar } from "@/components/studio/FlawTimelineBar";
import { LiveSpectralGraph } from "@/components/studio/LiveSpectralGraph";
import { SpinningDiscPlayer } from "@/components/studio/SpinningDiscPlayer";
import { checkBackendHealth } from "@/lib/api";
import { STUDIO_EASE, TACTILE_TAP } from "@/lib/motion";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BackendHealth, Finding, SpectralBand } from "@/types/report";

const DEMO_SPECTRAL_BANDS: SpectralBand[] = [
  { band: "sub", range_hz: "20–60 Hz", energy_db: -18.2, delta_vs_genre_median_db: 3.1, genre_target_low_db: -24, genre_target_high_db: -19 },
  { band: "low", range_hz: "60–250 Hz", energy_db: -15.6, delta_vs_genre_median_db: 2.2, genre_target_low_db: -20, genre_target_high_db: -16 },
  { band: "low_mid", range_hz: "250–800 Hz", energy_db: -20.1, delta_vs_genre_median_db: 0.4, genre_target_low_db: -23, genre_target_high_db: -18 },
  { band: "high_mid", range_hz: "800–3k Hz", energy_db: -23.4, delta_vs_genre_median_db: -0.6, genre_target_low_db: -25, genre_target_high_db: -20 },
  { band: "presence", range_hz: "3k–8k Hz", energy_db: -27.8, delta_vs_genre_median_db: -1.4, genre_target_low_db: -29, genre_target_high_db: -24 },
  { band: "air", range_hz: "8k–20k Hz", energy_db: -34.2, delta_vs_genre_median_db: -2.1, genre_target_low_db: -35, genre_target_high_db: -29 },
];

const DEMO_FINDINGS: Finding[] = [
  {
    evidence_id: "ev_demo_sub_01",
    severity: "alert",
    classification: "objective_defect",
    confidence: "measured",
    category: "stereo_phase",
    band_name: "sub",
    title: "Out-of-Phase Sub-Bass (< 120 Hz)",
    measured_value: "+0.18 sub correlation",
    timestamp_start_sec: 3,
    timestamp_end_sec: 5,
    what_happened: "Stereo sub harmonics cancel when summed to club mono.",
    why_it_matters: "Bass weight collapses on mono club systems and smartphones.",
    listen_prompt: "Loop 0:03–0:05 and press M to compare mono.",
    what_to_try: "High-pass side channel at 100 Hz (12 dB/oct).",
    recheck_target: "Verify sub correlation rises above +0.75 on v2.",
  },
  {
    evidence_id: "ev_demo_peak_02",
    severity: "alert",
    classification: "objective_defect",
    confidence: "measured",
    category: "true_peak",
    title: "Inter-Sample True Peak Overshoot",
    measured_value: "+0.62 dBTP",
    timestamp_start_sec: 3,
    timestamp_end_sec: 5.1,
    what_happened: "4x oversampled true peak exceeds 0 dBFS on kick transients.",
    why_it_matters: "AAC/Opus streaming encoders introduce brittle clipping.",
    listen_prompt: "Audition 0:03–0:05 on Laptop translation mode.",
    what_to_try: "Lower limiter output ceiling to -1.0 dBTP.",
    recheck_target: "Confirm 0 clipping markers in v2 revision.",
  },
  {
    evidence_id: "ev_demo_mud_03",
    severity: "caution",
    classification: "stylistic_choice",
    confidence: "measured",
    category: "tonal_balance",
    band_name: "low",
    title: "Low-Mid Buildup (180–260 Hz)",
    measured_value: "+2.4 dB vs genre median",
    timestamp_start_sec: 8.5,
    timestamp_end_sec: 10.5,
    what_happened: "Synth pads mask kick fundamentals in the chorus.",
    why_it_matters: "Reduces punch clarity on small speakers.",
    listen_prompt: "Toggle Smartphone curve during 0:08–0:10.",
    what_to_try: "Apply -1.8 dB bell dip at 215 Hz (Q 1.4).",
    recheck_target: "Confirm clearer snare body after adjustment.",
  },
];

const DEMO_PEAKS: number[][] = Array.from({ length: 96 }, (_, i) => {
  const pulse = Math.sin(i * 0.42) * 0.24 + Math.cos(i * 0.19) * 0.18;
  const hit = i % 8 === 0 ? 0.34 : i % 4 === 0 ? 0.16 : 0;
  const amp = Math.min(0.98, Math.max(0.18, 0.46 + pulse + hit));
  return [-amp, amp];
});

interface FeatureRow {
  num: string;
  title: string;
  sub: string;
  tag: string;
  kind: "telemetry" | "hardware" | "mentor";
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    num: "01",
    title: "DETERMINISTIC DSP & 20–120 HZ PHASE",
    sub: "ITU-R BS.1770 LUFS · 4x True Peak · Butterworth Sub Phase",
    tag: "PYTHON DSP",
    kind: "telemetry",
  },
  {
    num: "02",
    title: "LIVE V1 → V2 AUDIBLE A/B & EQ AUDITION",
    sub: "Auto-Fix Preview · Device Curves · Aligned Original Stems",
    tag: "WEB AUDIO ENGINE",
    kind: "hardware",
  },
  {
    num: "03",
    title: "PRIVACY-FIRST AI SUGGESTIONS & WEB DAW",
    sub: "Zero-Audio Default · Evidence-ID Anchored · 16-Module Web DAW",
    tag: "OPT-IN AI + DAW",
    kind: "mentor",
  },
];

const SPEC_ACCORDIONS = [
  {
    num: "01",
    title: "ZERO-AUDIO PRIVACY",
    body: "Deterministic Python DSP runs locally per session with a 60-minute TTL. All three AI consent toggles default strictly OFF.",
  },
  {
    num: "02",
    title: "4X TRUE PEAK & STEMS",
    body: "Polyphase 4x inter-sample True Peak, 20–120 Hz bandpass phase, transient punch, BPM sections, and aligned multi-stem inspection.",
  },
  {
    num: "03",
    title: "CLOUD MIX VAULT",
    body: "Private Supabase history protected by PostgreSQL Row-Level Security with read-only client review links and v1 → v2 delta tracking.",
  },
  {
    num: "04",
    title: "FREE GLOBAL ACCESS",
    body: "100% free mastering workbench with zero subscriptions, zero third-party ad trackers, and strictly essential auth cookies.",
  },
];

export function LandingPage() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hardwareVideoRef = useRef<HTMLVideoElement | null>(null);
  const featureGridRef = useRef<HTMLElement | null>(null);
  const heroDeckRef = useRef<HTMLDivElement | null>(null);
  const authSucceededRef = useRef(false);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const [signinRedirectTriggered, setSigninRedirectTriggered] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [heroDeckVisible, setHeroDeckVisible] = useState(true);
  const [activeFeatureIdx, setActiveFeatureIdx] = useState<number>(1); // 02 Terracotta Coral highlighted by default
  const [openAccordion, setOpenAccordion] = useState<string | null>("01");
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthOnline, setHealthOnline] = useState<boolean | null>(null);
  const [cookieBannerVisible, setCookieBannerVisible] = useState(true);

  const supabaseReady = isSupabaseConfigured();

  // Sync dynamic footer bottom padding with floating Cookie Consent Banner visibility
  useEffect(() => {
    const syncCookieBannerState = () => {
      try {
        setCookieBannerVisible(!window.localStorage.getItem(COOKIE_CONSENT_KEY));
      } catch {
        setCookieBannerVisible(true);
      }
    };
    syncCookieBannerState();
    const handleConsentChange = () => setCookieBannerVisible(false);
    window.addEventListener(COOKIE_CONSENT_EVENT, handleConsentChange);
    window.addEventListener("storage", syncCookieBannerState);
    return () => {
      window.removeEventListener(COOKIE_CONSENT_EVENT, handleConsentChange);
      window.removeEventListener("storage", syncCookieBannerState);
    };
  }, []);

  // Check current Supabase session so signed-in users see "ENTER STUDIO ↗" directly
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (active) setUserEmail(data.user?.email ?? null);
      })
      .catch(() => {});
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Poll live backend health once for the Signal Yellow ticker pill
  useEffect(() => {
    let active = true;
    checkBackendHealth()
      .then((res) => {
        if (!active) return;
        setHealth(res);
        setHealthOnline(true);
      })
      .catch(() => {
        if (active) setHealthOnline(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Honor /?signin=1 redirect from middleware auth gate (pure client read keeps / 100% static SSR)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("signin") === "1") {
      setSigninRedirectTriggered(true);
      setAuthPromptReason("Sign in to launch Mixit Studio and save your mix diagnostics.");
      setAuthModalOpen(true);
    }
  }, []);

  // Sync play state from shared Web Audio engine
  useEffect(() => {
    const sync = () => setDemoPlaying(studioAudioEngine.getState().isPlaying);
    sync();
    return studioAudioEngine.subscribe(sync);
  }, []);

  // Auto-pause ambient hero gradient mesh when hero deck scrolls off-screen
  useEffect(() => {
    const el = heroDeckRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setHeroDeckVisible(entries[0]?.isIntersecting ?? true);
      },
      { threshold: 0.05 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-pause looping studio hardware video when off-screen (IntersectionObserver)
  useEffect(() => {
    const video = hardwareVideoRef.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      video.pause();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries[0]?.isIntersecting ?? false;
        if (isVisible) {
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  // Lenis smooth scrolling + subtle GSAP ScrollTrigger hardware pacing (guaranteed cleanup; NEVER touches hero opacity!)
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let rafId = 0;
    let lenisInstance: { raf: (t: number) => void; destroy: () => void } | null = null;
    let gsapCleanup: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const [{ default: Lenis }, gsapMod, scrollTriggerMod] = await Promise.all([
          import("lenis"),
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        if (cancelled) return;

        const gsap = gsapMod.gsap;
        const ScrollTrigger = scrollTriggerMod.ScrollTrigger;
        gsap.registerPlugin(ScrollTrigger);

        const lenis = new Lenis({
          duration: 1.0,
          easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          smoothWheel: true,
        });
        lenisInstance = lenis;

        const raf = (time: number) => {
          if (cancelled) return;
          lenis.raf(time);
          rafId = window.requestAnimationFrame(raf);
        };
        rafId = window.requestAnimationFrame(raf);

        const ctx = gsap.context(() => {
          if (hardwareVideoRef.current && featureGridRef.current) {
            gsap.fromTo(
              hardwareVideoRef.current,
              { scale: 1.08 },
              {
                scale: 1.0,
                ease: "none",
                scrollTrigger: {
                  trigger: featureGridRef.current,
                  start: "top bottom",
                  end: "bottom top",
                  scrub: 0.6,
                },
              }
            );
          }
        }, rootRef);

        ScrollTrigger.refresh();
        gsapCleanup = () => {
          ctx.revert();
          ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
        };
      } catch {
        // Native browser scroll remains active
      }
    })();

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (lenisInstance) lenisInstance.destroy();
      if (gsapCleanup) gsapCleanup();
    };
  }, []);

  const handleEnterStudio = useCallback(() => {
    if (userEmail) {
      router.push("/studio");
      return;
    }
    setAuthPromptReason("Sign in to launch Mixit Studio and save your mix diagnostics.");
    setAuthModalOpen(true);
  }, [userEmail, router]);

  const handleToggleDemoVinyl = useCallback(async () => {
    if (demoLoading) return;
    if (!demoLoaded && !studioAudioEngine.getState().hasPrimary) {
      setDemoLoading(true);
      try {
        await studioAudioEngine.loadSlot("primary", "/demo/demo-flawed-v1.wav", -8.4);
        setDemoLoaded(true);
        await studioAudioEngine.play();
      } catch {
        // Keep interactive preview responsive even if browser blocks autoplay
      } finally {
        setDemoLoading(false);
      }
      return;
    }
    await studioAudioEngine.togglePlay();
  }, [demoLoaded, demoLoading]);

  const handleHeroPlayDemo = () => {
    const deck = document.getElementById("demo-deck");
    if (deck) {
      deck.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    void handleToggleDemoVinyl();
  };

  const engineStatusLabel =
    healthOnline === false
      ? "ENGINE: BROWSER DSP FALLBACK · READY"
      : health?.status === "ok"
        ? "ENGINE: DETERMINISTIC DSP + AI · ONLINE"
        : "ENGINE: DETERMINISTIC DSP · READY";

  return (
    <div
      ref={rootRef}
      className="min-h-screen bg-[#F9F8F4] pb-10 text-[#14171F] selection:bg-[#F5C451] selection:text-[#14171F]"
    >
      {/* Architectural Outer Gallery Frame — crisp 1.5px #14171F alignment on Warm Ivory */}
      <div className="mx-auto max-w-[1440px] overflow-x-clip border-x-[1.5px] border-b-[1.5px] border-[#14171F] bg-[#F9F8F4]">
        {/* ROW 1 — Compartmentalized Grid Topbar */}
        <header
          data-testid="landing-topbar"
          className="sticky top-0 z-40 border-b-[1.5px] border-[#14171F] bg-[#F9F8F4]/95 backdrop-blur-sm"
        >
          <div className="grid grid-cols-[1fr_auto] items-stretch md:grid-cols-[auto_1fr_auto_auto_auto_auto]">
            {/* Brand Cell: Full MIXIT. Logo */}
            <Link
              href="/"
              aria-label="Mixit Home"
              className="flex h-16 items-center border-r-[1.5px] border-[#14171F] px-4 transition-colors hover:bg-[#F2EFE7] sm:px-6"
            >
              <MixitLogo variant="full" tone="light" heightClass="h-7 sm:h-8" />
            </Link>

            {/* Studio Descriptor Cell */}
            <div className="hidden items-center border-r-[1.5px] border-[#14171F] px-4 text-[10px] font-bold uppercase leading-[1.2] tracking-[0.08em] text-[#14171F] md:flex">
              <span>
                AUDIO DSP
                <br />
                STUDIO
              </span>
            </div>

            {/* Concise Anchor Cells */}
            <a
              href="#features"
              className="hidden items-center justify-center border-r-[1.5px] border-[#14171F] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#14171F] transition-colors hover:bg-[#14171F] hover:text-[#F9F8F4] md:flex"
            >
              Features
            </a>
            <Link
              href="/privacy"
              className="hidden items-center justify-center border-r-[1.5px] border-[#14171F] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#14171F] transition-colors hover:bg-[#14171F] hover:text-[#F9F8F4] md:flex"
            >
              Privacy
            </Link>
            <Link
              href="/status"
              className="hidden items-center justify-center border-r-[1.5px] border-[#14171F] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#14171F] transition-colors hover:bg-[#14171F] hover:text-[#F9F8F4] md:flex"
            >
              Status
            </Link>

            {/* Soft Marigold CTA Cell */}
            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={handleEnterStudio}
              aria-label={userEmail ? "Enter Mixit Studio" : "Sign in to enter Mixit Studio"}
              className="flex h-16 items-center justify-center gap-2 bg-[#F5C451] px-4 text-xs font-extrabold uppercase tracking-[0.06em] text-[#14171F] transition-colors hover:bg-[#14171F] hover:text-[#F5C451] cursor-pointer sm:px-6"
            >
              <span>{userEmail ? "Enter Studio" : "Enter Studio"}</span>
              <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </motion.button>
          </div>
        </header>

        {/* ROW 2 — Asymmetric Breathable Hero (opacity: 1 immediately on mount & back-nav) */}
        <section
          data-testid="landing-hero"
          className="grid grid-cols-1 border-b-[1.5px] border-[#14171F] lg:grid-cols-12"
        >
          {/* Left Hero Column */}
          <div className="flex flex-col justify-between gap-8 border-b-[1.5px] border-[#14171F] p-6 sm:p-10 lg:col-span-6 lg:border-b-0 lg:border-r-[1.5px] lg:p-12">
            <div className="space-y-6">
              <KineticHeadline
                lines={["HEAR EVERY", "FLAW. PROVE", "EVERY FIX."]}
                className="font-brut text-[clamp(3.25rem,6.4vw,6.25rem)] leading-[0.91] tracking-[-0.015em] text-[#14171F]"
              />

              <div className="flex items-start gap-2.5 pt-1">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-3 w-3 shrink-0 border border-[#14171F] bg-[#F5C451]"
                />
                <p className="max-w-md text-sm font-semibold uppercase tracking-[0.04em] text-[#14171F] sm:text-base">
                  Deterministic DSP. Live 48-Band Spectrum. Privacy-First AI.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <motion.button
                type="button"
                data-testid="hero-primary-cta"
                whileHover={{ y: -2 }}
                whileTap={TACTILE_TAP}
                onClick={handleEnterStudio}
                className="inline-flex h-12 items-center gap-2.5 border-[1.5px] border-[#14171F] bg-[#F5C451] px-6 text-xs font-extrabold uppercase tracking-[0.08em] text-[#14171F] transition-colors hover:bg-[#14171F] hover:text-[#F5C451] cursor-pointer"
              >
                <span>{userEmail ? "Enter Studio" : "Launch Studio"}</span>
                <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </motion.button>

              <motion.button
                type="button"
                data-testid="hero-preview-demo-cta"
                whileHover={{ y: -2 }}
                whileTap={TACTILE_TAP}
                onClick={handleHeroPlayDemo}
                aria-label={demoPlaying ? "Pause demo vinyl playback" : "Play demo vinyl mix"}
                className="inline-flex h-12 items-center gap-2.5 border-[1.5px] border-[#14171F] bg-[#FFFFFF] px-6 text-xs font-extrabold uppercase tracking-[0.08em] text-[#14171F] transition-colors hover:bg-[#14171F] hover:text-[#F9F8F4] cursor-pointer"
              >
                {demoPlaying ? (
                  <>
                    <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
                    <span>Pause Demo Vinyl</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    <span>Play Demo Vinyl</span>
                  </>
                )}
              </motion.button>
            </div>
          </div>

          {/* Right Hero Column: Spec + Terracotta Coral Rotating Emblem + Soft Charcoal Interactive Audio Console */}
          <div
            id="demo-deck"
            ref={heroDeckRef}
            data-testid="landing-demo-showcase"
            className="flex flex-col overflow-hidden lg:col-span-6"
          >
            {/* Top Strip: 1-Sentence Spec + Warm Terracotta Coral Rotating Wireframe Emblem */}
            <div className="grid grid-cols-[1fr_auto] border-b-[1.5px] border-[#14171F]">
              <div className="flex flex-col justify-between gap-3 bg-[#F9F8F4] p-5 sm:p-6">
                <p className="max-w-sm text-xs font-bold uppercase leading-[1.4] tracking-[0.04em] text-[#14171F]">
                  CALIBRATED ITU-R BS.1770, 4X TRUE PEAK &amp; 20–120 HZ PHASE DIAGNOSTICS.
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="tabular-telemetry text-[11px] font-bold uppercase text-[#475467]">
                    LIVE DEMO DECK · 44.1 KHZ WAV
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleToggleDemoVinyl()}
                    aria-label={demoPlaying ? "Pause live demo track" : "Spin live demo track"}
                    className="inline-flex h-7 w-7 items-center justify-center border-[1.5px] border-[#14171F] bg-[#FFFFFF] text-[#14171F] transition-colors hover:bg-[#F5C451] cursor-pointer"
                  >
                    {demoPlaying ? (
                      <Pause className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {/* Warm Terracotta Coral Rotating Wireframe Emblem */}
              <div
                aria-hidden="true"
                className="flex w-24 items-center justify-center border-l-[1.5px] border-[#14171F] bg-[#E85D4A] p-4 sm:w-28"
              >
                <svg
                  viewBox="0 0 80 80"
                  className="swiss-emblem-spin h-16 w-16 text-[#14171F]"
                  fill="none"
                >
                  <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="2.2" />
                  <ellipse cx="40" cy="40" rx="18" ry="34" stroke="currentColor" strokeWidth="1.8" />
                  <ellipse cx="40" cy="40" rx="34" ry="16" stroke="currentColor" strokeWidth="1.8" />
                  <line x1="40" y1="6" x2="40" y2="74" stroke="currentColor" strokeWidth="1.8" />
                  <line x1="6" y1="40" x2="74" y2="40" stroke="currentColor" strokeWidth="1.8" />
                  <circle cx="40" cy="40" r="5" fill="currentColor" />
                </svg>
              </div>
            </div>

            {/* Soft Charcoal-Obsidian Hardware Instrument Inset + Drifting Colorful Ambient Radial Mesh */}
            <div
              data-testid="landing-dark-demo-panel"
              className="relative flex flex-1 flex-col gap-3 overflow-hidden bg-[#0E1117] p-4 sm:p-5"
            >
              {/* Softly animated colorful ambient radial gradient mesh (paused when off-screen) */}
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute -inset-12 ambient-mesh-drift ${
                  heroDeckVisible ? "" : "ambient-mesh-paused"
                }`}
                style={{
                  background:
                    "radial-gradient(circle at 22% 28%, rgba(240, 180, 76, 0.20) 0%, transparent 44%), radial-gradient(circle at 78% 24%, rgba(94, 155, 255, 0.22) 0%, transparent 46%), radial-gradient(circle at 66% 80%, rgba(179, 136, 255, 0.18) 0%, transparent 45%), radial-gradient(circle at 26% 78%, rgba(56, 211, 159, 0.16) 0%, transparent 42%)",
                }}
              />

              <div className="relative z-10 grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="min-w-0 sm:col-span-6">
                  <SpinningDiscPlayer
                    title="demo-flawed-v1.wav"
                    subtitle="Click spindle to spin stereo demo"
                    genre="electronic"
                    health="alert"
                    lufs={-8.4}
                    truePeak={0.62}
                    bpm={124}
                    compact
                    isLoadingAudio={demoLoading}
                    onTogglePlay={handleToggleDemoVinyl}
                    className="h-full bg-[#0E1117]/92"
                  />
                </div>
                <div className="flex min-w-0 flex-col justify-between gap-3 sm:col-span-6">
                  <LiveSpectralGraph
                    spectralBands={DEMO_SPECTRAL_BANDS}
                    height={156}
                    compact
                    className="bg-[#0E1117]/92"
                  />
                  <FlawTimelineBar
                    peaks={DEMO_PEAKS}
                    durationSec={12}
                    clippingTimestamps={[3.4, 4.1, 4.8]}
                    findings={DEMO_FINDINGS}
                    height={84}
                    className="bg-[#0E1117]/92"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ROW 3 — Full-Width Status Ticker Strip */}
        <section
          aria-label="Engine status strip"
          className="grid grid-cols-1 border-b-[1.5px] border-[#14171F] md:grid-cols-[auto_1fr_auto]"
        >
          <div className="flex items-center justify-center border-b-[1.5px] border-[#14171F] px-5 py-3 tabular-telemetry text-xs font-extrabold text-[#14171F] md:border-b-0 md:border-r-[1.5px]">
            (2026)
          </div>

          <div className="flex items-center justify-between gap-4 border-b-[1.5px] border-[#14171F] px-5 py-4 md:border-b-0 md:border-r-[1.5px] sm:px-8">
            <p className="text-xs font-extrabold uppercase tracking-[0.06em] text-[#14171F] sm:text-sm">
              MATHEMATICAL DSP TRUTH. ZERO AUDIO SENT BY DEFAULT.
            </p>
            <ArrowRight className="h-4 w-4 shrink-0 text-[#14171F]" aria-hidden="true" />
          </div>

          <Link
            href="/status"
            data-testid="landing-engine-status-pill"
            className="flex items-center justify-between gap-3 bg-[#F5C451] px-5 py-4 text-xs font-extrabold uppercase tracking-[0.06em] text-[#14171F] transition-colors hover:bg-[#14171F] hover:text-[#F5C451] sm:px-6"
          >
            <span className="tabular-telemetry">{engineStatusLabel}</span>
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#129E6E]"
            />
          </Link>
        </section>

        {/* ROW 4 — Numbered 01 / 02 / 03 Interactive Feature Grid + Looping Studio Hardware Video */}
        <section
          id="features"
          ref={featureGridRef}
          data-testid="landing-proof-band"
          className="grid grid-cols-1 border-b-[1.5px] border-[#14171F] lg:grid-cols-12"
        >
          {/* Left Rail */}
          <div className="flex flex-col justify-between gap-6 border-b-[1.5px] border-[#14171F] bg-[#F9F8F4] p-6 lg:col-span-3 lg:border-b-0 lg:border-r-[1.5px] lg:p-8">
            <div className="space-y-4">
              <div className="text-xs font-extrabold uppercase leading-snug tracking-[0.08em] text-[#14171F]">
                SELECTED
                <br />
                CAPABILITIES
              </div>
              <ArrowDown className="h-4 w-4 text-[#14171F]" aria-hidden="true" />
            </div>

            <div className="space-y-3">
              <div className="border-[1.5px] border-[#14171F] bg-[#0E1117] p-3 text-[#F2F0EA]">
                <div className="tabular-telemetry text-[10px] font-bold uppercase tracking-[0.08em] text-[#F0B44C]">
                  REFERENCE BENCHMARK
                </div>
                <div className="mt-1 tabular-telemetry text-xs font-semibold">
                  44.1 kHz · -1.76 dBTP · +0.999 SUB
                </div>
              </div>

              <motion.button
                type="button"
                whileHover={{ y: -2 }}
                whileTap={TACTILE_TAP}
                onClick={handleEnterStudio}
                className="inline-flex w-full items-center justify-between border-[1.5px] border-[#14171F] bg-[#FFFFFF] px-4 py-3 text-xs font-extrabold uppercase tracking-[0.06em] text-[#14171F] transition-colors hover:bg-[#F5C451] cursor-pointer"
              >
                <span>Open Workbench</span>
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </motion.button>
            </div>
          </div>

          {/* Right 01 / 02 / 03 Rows with Scroll Reveals & Tactile Spring Hover */}
          <div className="divide-y-[1.5px] divide-[#14171F] lg:col-span-9">
            {FEATURE_ROWS.map((row, idx) => {
              const isHighlighted = activeFeatureIdx === idx;
              return (
                <motion.div
                  key={row.num}
                  initial={{ opacity: 0.92, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.36, delay: idx * 0.06, ease: STUDIO_EASE }}
                  onMouseEnter={() => setActiveFeatureIdx(idx)}
                  onFocus={() => setActiveFeatureIdx(idx)}
                  onClick={() => setActiveFeatureIdx(idx)}
                  className={`grid grid-cols-1 transition-colors duration-200 md:grid-cols-12 ${
                    isHighlighted
                      ? "bg-[#E85D4A] text-[#14171F]"
                      : "bg-[#F9F8F4] text-[#14171F] hover:bg-[#F2EFE7]"
                  }`}
                >
                  {/* Number + Title Cell */}
                  <div className="flex items-center gap-5 border-b-[1.5px] border-[#14171F] p-5 sm:gap-7 sm:p-7 md:col-span-7 md:border-b-0 md:border-r-[1.5px]">
                    <span className="font-brut shrink-0 text-6xl leading-none text-[#14171F] sm:text-7xl">
                      {row.num}
                    </span>
                    <div className="min-w-0 space-y-1.5">
                      <span
                        className={`inline-block border border-[#14171F] px-2 py-0.5 tabular-telemetry text-[10px] font-bold uppercase tracking-[0.08em] ${
                          isHighlighted
                            ? "bg-[#F5C451] text-[#14171F]"
                            : "bg-[#FFFFFF] text-[#14171F]"
                        }`}
                      >
                        {row.tag}
                      </span>
                      <h2 className="font-condensed text-2xl font-extrabold leading-tight text-[#14171F] sm:text-[26px]">
                        {row.title}
                      </h2>
                      <p className="text-xs font-semibold text-[#14171F]/85">{row.sub}</p>
                    </div>
                  </div>

                  {/* Right Visual Preview Pane */}
                  <div className="relative overflow-hidden bg-[#0E1117] md:col-span-5">
                    {row.kind === "hardware" ? (
                      <div className="relative h-48 w-full overflow-hidden md:h-full md:min-h-[180px]">
                        <video
                          ref={hardwareVideoRef}
                          autoPlay
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          poster="/media/studio-hardware-poster.webp"
                          aria-label="Slow-motion close-up of analog mastering rotary knobs and brushed steel VU meter"
                          className="h-full w-full object-cover"
                        >
                          <source src="/media/studio-hardware-loop.mp4" type="video/mp4" />
                        </video>
                        <div className="pointer-events-none absolute bottom-2.5 left-2.5 border border-[#F0B44C] bg-[#0E1117]/90 px-2 py-0.5 tabular-telemetry text-[10px] font-bold uppercase text-[#F0B44C]">
                          LIVE A/B · AUTO-FIX EQ
                        </div>
                      </div>
                    ) : row.kind === "telemetry" ? (
                      <div className="flex h-full min-h-[168px] flex-col justify-between p-5 text-[#F2F0EA]">
                        <div className="flex items-center justify-between tabular-telemetry text-[10px] font-bold uppercase text-[#98A2B3]">
                          <span>DSP TELEMETRY</span>
                          <span className="text-[#38D39F]">SHA-256 CACHED</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 py-2">
                          <div className="border border-white/10 bg-[#151923] p-2.5">
                            <div className="text-[9px] uppercase text-[#98A2B3]">LUFS</div>
                            <div className="mt-1 tabular-telemetry text-base font-bold text-[#F2F0EA]">
                              -14.4
                            </div>
                          </div>
                          <div className="border border-white/10 bg-[#151923] p-2.5">
                            <div className="text-[9px] uppercase text-[#98A2B3]">4X PEAK</div>
                            <div className="mt-1 tabular-telemetry text-base font-bold text-[#F0B44C]">
                              -1.76
                            </div>
                          </div>
                          <div className="border border-white/10 bg-[#151923] p-2.5">
                            <div className="text-[9px] uppercase text-[#98A2B3]">SUB PHASE</div>
                            <div className="mt-1 tabular-telemetry text-base font-bold text-[#38D39F]">
                              +0.999
                            </div>
                          </div>
                        </div>
                        <div className="tabular-telemetry text-[10px] text-[#98A2B3]">
                          20–120 HZ BUTTERWORTH BANDPASS · 0 CLIPS
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[168px] flex-col justify-between p-5 text-[#F2F0EA]">
                        <div className="flex items-center justify-between tabular-telemetry text-[10px] font-bold uppercase text-[#98A2B3]">
                          <span>AI SUGGESTIONS</span>
                          <span className="text-[#F0B44C]">OPT-IN ONLY</span>
                        </div>
                        <div className="space-y-2 py-2 text-xs">
                          <div className="flex items-center justify-between border border-white/10 bg-[#151923] px-3 py-2">
                            <span className="tabular-telemetry text-[#F0B44C]">ev_sub_phase_01</span>
                            <span className="font-semibold text-[#F2F0EA]">Mono &lt; 100 Hz</span>
                          </div>
                          <div className="flex items-center justify-between border border-white/10 bg-[#151923] px-3 py-2">
                            <span className="tabular-telemetry text-[#38D39F]">ev_true_peak_02</span>
                            <span className="font-semibold text-[#F2F0EA]">Ceiling -1.0 dBTP</span>
                          </div>
                        </div>
                        <div className="tabular-telemetry text-[10px] text-[#98A2B3]">
                          ZERO RAW AUDIO TRANSMITTED BY DEFAULT
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* ROW 5 — Bottom Split: Soft Marigold Geometric Emblem + Kinetic Section Headline + Expandable Accordions */}
        <section className="grid grid-cols-1 border-b-[1.5px] border-[#14171F] lg:grid-cols-12">
          {/* Left: Soft Marigold Emblem Block + BUILT FOR REAL MIXES. */}
          <div className="grid grid-cols-1 border-b-[1.5px] border-[#14171F] sm:grid-cols-[180px_1fr] lg:col-span-5 lg:border-b-0 lg:border-r-[1.5px]">
            <div className="flex flex-col items-center justify-between gap-4 border-b-[1.5px] border-[#14171F] bg-[#F5C451] p-6 sm:border-b-0 sm:border-r-[1.5px]">
              <MixitLogo variant="mark" heightClass="h-11" />
              <svg
                viewBox="0 0 100 100"
                aria-hidden="true"
                className="swiss-emblem-spin h-20 w-20 text-[#14171F]"
              >
                <rect x="42" y="6" width="16" height="88" fill="currentColor" />
                <rect x="6" y="42" width="88" height="16" fill="currentColor" />
                <rect
                  x="42"
                  y="6"
                  width="16"
                  height="88"
                  fill="currentColor"
                  transform="rotate(45 50 50)"
                />
                <rect
                  x="42"
                  y="6"
                  width="16"
                  height="88"
                  fill="currentColor"
                  transform="rotate(-45 50 50)"
                />
              </svg>
              <span className="tabular-telemetry text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#14171F]">
                MIXIT · DSP
              </span>
            </div>

            <div className="flex flex-col justify-between gap-6 bg-[#F9F8F4] p-6 sm:p-8">
              <div className="space-y-3">
                <KineticHeadline
                  as="h2"
                  inView
                  lines={["BUILT FOR", "REAL MIXES."]}
                  className="font-brut text-5xl leading-[0.92] text-[#14171F]"
                />
                <p className="text-xs font-semibold leading-relaxed text-[#475467]">
                  Measured in deterministic Python DSP.
                  <br />
                  Verified live in browser Web Audio.
                </p>
              </div>

              <button
                type="button"
                onClick={handleEnterStudio}
                className="inline-flex w-fit items-center gap-2 text-xs font-extrabold uppercase tracking-[0.08em] text-[#14171F] underline decoration-[1.5px] underline-offset-4 hover:text-[#E85D4A] cursor-pointer"
              >
                <span>Launch Studio</span>
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Narrow Vertical Rail */}
          <div className="hidden flex-col items-center justify-between border-r-[1.5px] border-[#14171F] bg-[#F9F8F4] py-6 lg:col-span-1 lg:flex">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#14171F] [writing-mode:vertical-rl]">
              ARCHITECTURE
            </span>
            <ArrowRight className="h-4 w-4 text-[#14171F]" aria-hidden="true" />
          </div>

          {/* Right: 4 Expandable + Accordion Rows */}
          <div className="divide-y-[1.5px] divide-[#14171F] lg:col-span-6">
            {SPEC_ACCORDIONS.map((item) => {
              const isOpen = openAccordion === item.num;
              return (
                <div key={item.num} className="bg-[#FFFFFF]">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenAccordion((prev) => (prev === item.num ? null : item.num))}
                    className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-[#F2EFE7] cursor-pointer"
                  >
                    <div className="flex items-center gap-5">
                      <span className="tabular-telemetry text-xs font-extrabold text-[#475467]">
                        {item.num}
                      </span>
                      <span className="font-condensed text-xl font-extrabold tracking-[0.03em] text-[#14171F]">
                        {item.title}
                      </span>
                    </div>
                    <Plus
                      className={`h-4 w-4 shrink-0 text-[#14171F] transition-transform duration-200 ${
                        isOpen ? "rotate-45 text-[#E85D4A]" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: STUDIO_EASE }}
                        className="overflow-hidden"
                      >
                        <p className="border-t border-[#14171F]/15 bg-[#F2EFE7] px-6 py-4 pl-14 text-xs font-medium leading-relaxed text-[#475467]">
                          {item.body}
                        </p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </section>

        {/* ROW 6 — Clean 3-Column Architectural Footer (dynamic bottom clearance for floating cookie card) */}
        <footer
          data-testid="landing-footer"
          className={`grid grid-cols-1 divide-y-[1.5px] divide-[#14171F] bg-[#F9F8F4] transition-[padding] duration-200 md:grid-cols-12 md:divide-x-[1.5px] md:divide-y-0 ${
            cookieBannerVisible ? "pb-36" : "pb-12"
          }`}
        >
          {/* Column 1: Warm Terracotta Coral CTA Block */}
          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={TACTILE_TAP}
            onClick={handleEnterStudio}
            className="flex items-center justify-between gap-4 bg-[#E85D4A] p-6 text-left text-[#14171F] transition-colors hover:bg-[#14171F] hover:text-[#F5C451] cursor-pointer md:col-span-4 sm:p-8"
          >
            <span className="font-condensed text-2xl font-extrabold leading-tight uppercase">
              READY TO CHECK
              <br />
              YOUR MIX?
            </span>
            <ArrowUpRight className="h-6 w-6 shrink-0" aria-hidden="true" />
          </motion.button>

          {/* Column 2: Full Brand Lockup & Legal Links */}
          <div className="flex flex-col justify-between gap-4 p-6 md:col-span-5 sm:p-8">
            <MixitLogo variant="full" tone="light" heightClass="h-6" />
            <nav
              data-testid="landing-footer-legal-nav"
              aria-label="Legal and status links"
              className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-extrabold uppercase tracking-[0.06em] text-[#14171F]"
            >
              <Link href="/privacy" className="hover:text-[#E85D4A] hover:underline">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-[#E85D4A] hover:underline">
                Terms of Use
              </Link>
              <Link href="/cookies" className="hover:text-[#E85D4A] hover:underline">
                Cookie Policy
              </Link>
              <Link href="/status" className="hover:text-[#E85D4A] hover:underline">
                System Status
              </Link>
            </nav>
          </div>

          {/* Column 3: Global Launch Pledge */}
          <div className="flex flex-col justify-between gap-3 p-6 md:col-span-3 sm:p-8">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#14171F]">
              MIXIT STUDIO · 100% FREE
            </span>
            <p className="tabular-telemetry text-[11px] font-semibold uppercase leading-relaxed text-[#475467]">
              ZERO AD TRACKERS.
              <br />
              ESSENTIAL COOKIES ONLY.
            </p>
          </div>
        </footer>
      </div>

      {/* Auth Modal for Sign In / Sign Up -> /studio */}
      <AuthModal
        open={authModalOpen}
        onAuthSuccess={() => {
          authSucceededRef.current = true;
          setSigninRedirectTriggered(false);
        }}
        onOpenChange={(open) => {
          setAuthModalOpen(open);
          if (open) {
            authSucceededRef.current = false;
          } else if (signinRedirectTriggered && !authSucceededRef.current) {
            setSigninRedirectTriggered(false);
            router.replace("/");
          }
        }}
        promptReason={authPromptReason}
        redirectTo="/studio"
        initialError={
          !supabaseReady && signinRedirectTriggered
            ? "Sign-in is required to enter Mixit Studio. Configure Supabase Auth keys to activate account sessions."
            : null
        }
      />
    </div>
  );
}

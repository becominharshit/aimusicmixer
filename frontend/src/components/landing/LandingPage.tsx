"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowRight,
  Clock,
  Disc3,
  Lock,
  Moon,
  Pause,
  Play,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
} from "lucide-react";
import { studioAudioEngine } from "@/audio/StudioAudioEngine";
import { AuthModal } from "@/components/auth/AuthModal";
import { KineticHeadline } from "@/components/motion/KineticHeadline";
import { MagneticButton } from "@/components/motion/MagneticButton";
import { FlawTimelineBar } from "@/components/studio/FlawTimelineBar";
import { LiveSpectralGraph } from "@/components/studio/LiveSpectralGraph";
import { SpinningDiscPlayer } from "@/components/studio/SpinningDiscPlayer";
import { STUDIO_EASE, TACTILE_TAP, VIEWPORT_REVEAL } from "@/lib/motion";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getCurrentStudioTheme, toggleStudioTheme } from "@/lib/theme";
import type { Finding, SpectralBand } from "@/types/report";

const LANDING_DEMO_URL = "/demo/demo-flawed-v1.wav";
const LANDING_DEMO_DURATION = 12;

const DEMO_SPECTRAL_BANDS: SpectralBand[] = [
  {
    band: "sub",
    range_hz: "20–60 Hz",
    energy_db: -18.2,
    delta_vs_genre_median_db: 3.1,
    genre_target_low_db: -23,
    genre_target_high_db: -19,
  },
  {
    band: "low",
    range_hz: "60–250 Hz",
    energy_db: -15.4,
    delta_vs_genre_median_db: 2.2,
    genre_target_low_db: -20,
    genre_target_high_db: -16,
  },
  {
    band: "low_mid",
    range_hz: "250–800 Hz",
    energy_db: -19.8,
    delta_vs_genre_median_db: 2.9,
    genre_target_low_db: -25,
    genre_target_high_db: -20.5,
  },
  {
    band: "high_mid",
    range_hz: "800–3k Hz",
    energy_db: -23.1,
    delta_vs_genre_median_db: -0.9,
    genre_target_low_db: -25,
    genre_target_high_db: -20,
  },
  {
    band: "presence",
    range_hz: "3k–8k Hz",
    energy_db: -27.5,
    delta_vs_genre_median_db: -1.6,
    genre_target_low_db: -29,
    genre_target_high_db: -24,
  },
  {
    band: "air",
    range_hz: "8k–20k Hz",
    energy_db: -34.2,
    delta_vs_genre_median_db: -2.4,
    genre_target_low_db: -35,
    genre_target_high_db: -29,
  },
];

// Deterministic waveform contour matching the 12s flawed stereo demo
const DEMO_WAVEFORM_PEAKS: number[][] = Array.from({ length: 120 }, (_, idx) => {
  const t = idx / 120;
  const bar = Math.sin(idx * 0.55) * 0.16 + Math.cos(idx * 1.15) * 0.12;
  const sectionEnv = t < 0.18 ? 0.52 : t < 0.72 ? 0.88 : 0.72;
  const peak = Math.min(0.98, Math.max(0.18, sectionEnv + bar + (idx % 8 === 0 ? 0.14 : 0)));
  return [-peak, peak];
});

// Includes two closely spaced flaws at 0:03 to demonstrate clean non-overlapping clustering
const DEMO_FINDINGS: Finding[] = [
  {
    evidence_id: "ev_sub_phase_demo",
    category: "stereo_phase",
    severity: "alert",
    classification: "objective_defect",
    confidence: "measured",
    band_name: "sub",
    title: "Out-of-Phase Sub-Bass (< 120 Hz)",
    timestamp_start_sec: 3,
    timestamp_end_sec: 5,
    measured_value: "+0.18 sub correlation",
    what_happened: "Low-end stereo energy below 120 Hz partially cancels in mono.",
    why_it_matters: "Club systems and phones lose low-end weight when summed.",
    listen_prompt: "Toggle Mono (M) during 0:03–0:05 to hear bass collapse.",
    what_to_try: "High-pass the Side channel at 100 Hz (12 dB/oct).",
    recheck_target: "Confirm 20–120 Hz correlation rises above +0.70.",
  },
  {
    evidence_id: "ev_true_peak_demo",
    category: "true_peak",
    severity: "alert",
    classification: "objective_defect",
    confidence: "measured",
    band_name: "low",
    title: "Inter-Sample True Peak Overshoot",
    timestamp_start_sec: 3,
    timestamp_end_sec: 5.2,
    measured_value: "+0.62 dBTP",
    what_happened: "4x oversampled reconstruction exceeds 0.0 dBTP on kick hits.",
    why_it_matters: "Streaming AAC/Ogg encoders clip hot inter-sample peaks.",
    listen_prompt: "Audition 0:03–0:05 for transient crunch.",
    what_to_try: "Pull master bus gain down 2.0 dB or set limiter ceiling to -1.0 dBTP.",
    recheck_target: "Verify True Peak <= -1.0 dBTP on v2.",
  },
  {
    evidence_id: "ev_low_mid_mud_demo",
    category: "tonal_balance",
    severity: "caution",
    classification: "stylistic_choice",
    confidence: "measured",
    band_name: "low_mid",
    title: "Low-Mid Buildup Around 250–500 Hz",
    timestamp_start_sec: 7.5,
    timestamp_end_sec: 10.5,
    measured_value: "+2.9 dB vs electronic median",
    what_happened: "Pad fundamentals stack over bass harmonics in the chorus.",
    why_it_matters: "Masks snare snap and clouds laptop/phone translation.",
    listen_prompt: "Compare 0:07–0:10 with and without a 2.0 dB cut at 280 Hz.",
    what_to_try: "Dip 280 Hz by 1.5–2.5 dB (Q 1.4) on synth bus.",
    recheck_target: "Bring 250–800 Hz within +/-1.5 dB of reference envelope.",
  },
];

const DEMO_CLIP_TIMESTAMPS = [3.1, 3.6, 4.1, 4.8];

const PROOF_PILLARS = [
  {
    icon: Activity,
    accent: "var(--studio-mint)",
    title: "Deterministic ITU-R BS.1770 & 20–120 Hz Phase",
    body: "Polyphase 4x oversampled True Peak, gated integrated loudness, PLR/PSR transient punch, and 4th-order Butterworth sub-bass phase correlation computed strictly in calibrated Python DSP—never estimated by an LLM.",
  },
  {
    icon: Sliders,
    accent: "var(--studio-amber)",
    title: "Live v1 → v2 Audible A/B & Corrective EQ",
    body: "Audition level-matched Mix A vs. Reference B, collapse to mono on a single keystroke, test smartphone and laptop translation curves, toggle corrective peaking EQ live, and prove every improvement on revision v2.",
  },
  {
    icon: Sparkles,
    accent: "var(--studio-vermilion)",
    title: "Privacy-First gemini-4-hydrogen Mix Mentor",
    body: "Opt-in studio coaching anchored strictly to measured evidence_id telemetry with 35s server resilience, interactive DAW repair checklists, and instant offline deterministic fallback.",
  },
];

const PRIVACY_GUARANTEES = [
  {
    icon: ShieldCheck,
    title: "Zero Audio Sent by Default",
    body: "All three AI consent switches default to OFF across browser UI, API contracts, and PostgreSQL rows. Deterministic DSP never leaves ephemeral compute.",
  },
  {
    icon: Clock,
    title: "60-Minute Ephemeral Processing",
    body: "Uploaded WAV, FLAC, MP3, and AIFF mixdowns expire automatically after 60 minutes—or unlink immediately when you press Clear Session.",
  },
  {
    icon: Lock,
    title: "Private Per-User Cloud History",
    body: "Row-Level Security (auth.uid() = user_id) and signed private mix-proxies storage keep every saved report private unless you explicitly generate a client review link.",
  },
];

export function LandingPage() {
  const router = useRouter();
  const prefersReduced = useReducedMotion();

  const heroSectionRef = useRef<HTMLElement | null>(null);
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);
  const demoSectionRef = useRef<HTMLElement | null>(null);
  const consoleParallaxRef = useRef<HTMLDivElement | null>(null);
  const lenisRef = useRef<{ scrollTo: (target: HTMLElement | string, opts?: { offset?: number }) => void } | null>(null);

  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authInitialError, setAuthInitialError] = useState<string | null>(null);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);

  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(() => studioAudioEngine.getState().isPlaying);
  const [selectedFindingTitle, setSelectedFindingTitle] = useState<string | null>(null);

  // Sync theme + audio engine state
  useEffect(() => {
    setIsDarkTheme(getCurrentStudioTheme() === "dark");
    const syncAudio = () => setIsPlaying(studioAudioEngine.getState().isPlaying);
    syncAudio();
    return studioAudioEngine.subscribe(syncAudio);
  }, []);

  // Check Supabase auth state (keeps "/" accessible when authenticated with "Enter Studio" CTA)
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedInEmail(data.session?.user?.email ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user?.email ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Handle /?signin=1 (from middleware auth gate) and /?auth_error=...
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wantsSignIn = params.get("signin");
    const authError = params.get("auth_error");

    if (authError) {
      setAuthInitialError(authError);
      setAuthPromptReason("Sign in to launch MixBench Studio and save your mix diagnostics.");
      setAuthOpen(true);
    } else if (wantsSignIn === "1") {
      setAuthInitialError(null);
      setAuthPromptReason("Sign in to launch MixBench Studio and save your mix diagnostics.");
      setAuthOpen(true);
    }

    if (wantsSignIn || authError) {
      const url = new URL(window.location.href);
      url.searchParams.delete("signin");
      url.searchParams.delete("auth_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // Auto-pause Veo looping hero video when off-screen or when reduced motion is enabled
  useEffect(() => {
    const video = heroVideoRef.current;
    const heroEl = heroSectionRef.current;
    if (!video || !heroEl) return;

    if (prefersReduced) {
      video.pause();
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      void video.play().catch(() => {});
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? true;
        if (visible) {
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(heroEl);
    return () => observer.disconnect();
  }, [prefersReduced]);

  // Lenis smooth scroll + subtle GSAP ScrollTrigger parallax on Section 3 console image ONLY.
  // Hero elements are NEVER touched by ScrollTrigger/opacity:0 so back-nav is 100% immune.
  useEffect(() => {
    if (typeof window === "undefined" || prefersReduced) return;

    let cancelled = false;
    let rafId = 0;
    let cleanupLenis: (() => void) | null = null;
    let cleanupGsap: (() => void) | null = null;

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

        // Clear any stale triggers from prior route transitions and refresh immediately
        ScrollTrigger.getAll().forEach((t) => t.kill());

        const lenis = new Lenis({
          duration: 1.05,
          smoothWheel: true,
          wheelMultiplier: 0.9,
        });
        lenisRef.current = lenis;
        lenis.on("scroll", ScrollTrigger.update);

        const raf = (time: number) => {
          lenis.raf(time);
          rafId = window.requestAnimationFrame(raf);
        };
        rafId = window.requestAnimationFrame(raf);
        cleanupLenis = () => {
          window.cancelAnimationFrame(rafId);
          lenis.destroy();
          lenisRef.current = null;
        };

        if (consoleParallaxRef.current) {
          const ctx = gsap.context(() => {
            gsap.fromTo(
              consoleParallaxRef.current,
              { yPercent: -3 },
              {
                yPercent: 3,
                ease: "none",
                scrollTrigger: {
                  trigger: consoleParallaxRef.current,
                  start: "top bottom",
                  end: "bottom top",
                  scrub: true,
                },
              }
            );
          });
          ScrollTrigger.refresh();
          cleanupGsap = () => {
            ctx.revert();
            ScrollTrigger.getAll().forEach((t) => t.kill());
          };
        }
      } catch {
        // Non-fatal in headless or test environments
      }
    })();

    return () => {
      cancelled = true;
      cleanupGsap?.();
      cleanupLenis?.();
    };
  }, [prefersReduced]);

  const handleToggleTheme = () => {
    const next = toggleStudioTheme();
    setIsDarkTheme(next === "dark");
  };

  const handleLaunchStudio = () => {
    if (signedInEmail) {
      router.push("/studio");
      return;
    }
    setAuthInitialError(null);
    setAuthPromptReason("Sign in to launch MixBench Studio and save your mix diagnostics.");
    setAuthOpen(true);
  };

  const ensureDemoLoaded = async (): Promise<boolean> => {
    if (studioAudioEngine.getSlotLoaded("primary")) return true;
    setDemoLoading(true);
    setDemoError(null);
    try {
      await studioAudioEngine.loadSlot("primary", LANDING_DEMO_URL, -8.4);
      return true;
    } catch {
      setDemoError("Demo audio could not be decoded in this browser.");
      return false;
    } finally {
      setDemoLoading(false);
    }
  };

  const handleToggleDemoVinyl = async () => {
    if (studioAudioEngine.getState().isPlaying) {
      studioAudioEngine.pause();
      return;
    }
    const ok = await ensureDemoLoaded();
    if (ok) {
      await studioAudioEngine.play();
    }
  };

  const handlePreviewDemoCta = async () => {
    if (demoSectionRef.current) {
      if (lenisRef.current && !prefersReduced) {
        lenisRef.current.scrollTo(demoSectionRef.current, { offset: -72 });
      } else {
        demoSectionRef.current.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth" });
      }
    }
    if (!studioAudioEngine.getState().isPlaying) {
      const ok = await ensureDemoLoaded();
      if (ok) {
        await studioAudioEngine.play();
      }
    }
  };

  const handleSelectDemoFinding = async (finding: Finding) => {
    setSelectedFindingTitle(finding.title);
    const ok = await ensureDemoLoaded();
    if (ok) {
      await studioAudioEngine.auditionRange(
        finding.timestamp_start_sec,
        Math.max(finding.timestamp_start_sec + 2.5, finding.timestamp_end_sec)
      );
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Editorial Top Navigation Bar (strictly single-row h-16) */}
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-white/[0.08] bg-[#090B0E]/82 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center bg-[#22C58B] text-[#090B0E] squircle-inner">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 12h2.5l2-6 3 12 2.5-9 2 3H20"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="font-display text-base font-bold tracking-[-0.02em] text-[#F4F1EA]">
              MixBench
            </span>
          </Link>

          <nav
            aria-label="Landing sections"
            className="hidden items-center gap-7 text-sm font-medium text-[#9CA3AF] md:flex"
          >
            <a href="#demo-showcase" className="transition-colors hover:text-[#F4F1EA]">
              Demo Deck
            </a>
            <a href="#architecture" className="transition-colors hover:text-[#F4F1EA]">
              Architecture
            </a>
            <a href="#privacy" className="transition-colors hover:text-[#F4F1EA]">
              Privacy
            </a>
            <Link href="/status" className="transition-colors hover:text-[#F4F1EA]">
              Status
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <motion.button
              type="button"
              data-testid="theme-toggle"
              whileTap={TACTILE_TAP}
              onClick={handleToggleTheme}
              aria-label="Toggle studio theme"
              title={isDarkTheme ? "Switch to Warm Daylight Light" : "Switch to Carbon Studio Dark"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/[0.12] bg-[#11141B]/90 text-[#F4F1EA] transition-colors hover:border-white/25 cursor-pointer"
            >
              {isDarkTheme ? (
                <Sun className="h-4 w-4 text-[#E89B2D]" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4 text-[#9CA3AF]" aria-hidden="true" />
              )}
            </motion.button>

            {signedInEmail ? (
              <Link
                href="/studio"
                data-testid="nav-enter-studio"
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#22C58B] px-4 text-xs font-semibold text-[#090B0E] transition-[filter,transform] hover:brightness-105 active:scale-[0.98]"
              >
                <span>Enter Studio</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <motion.button
                type="button"
                data-testid="nav-signin-btn"
                whileTap={TACTILE_TAP}
                onClick={handleLaunchStudio}
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#F4F1EA] px-4 text-xs font-semibold text-[#090B0E] transition-colors hover:bg-white cursor-pointer"
              >
                <span>Sign In</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </motion.button>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* SECTION 1 — Full-Bleed Cinema Hero (100svh) */}
        <section
          ref={heroSectionRef}
          data-testid="landing-hero"
          className="relative flex min-h-[100svh] items-center overflow-hidden bg-[#090B0E] pt-16 text-[#F4F1EA]"
        >
          {/* Full-Bleed Veo Macro Vinyl Loop (zero audio, zero CLS poster, auto-paused off-screen) */}
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <video
              ref={heroVideoRef}
              poster="/media/hero-studio-poster.webp"
              autoPlay={!prefersReduced}
              loop
              muted
              playsInline
              preload="metadata"
              aria-hidden="true"
              className="h-full w-full object-cover object-center opacity-75"
            >
              <source src="/media/hero-studio-loop.webm" type="video/webm" />
              <source src="/media/hero-studio-loop.mp4" type="video/mp4" />
            </video>
            {/* >= 85% contrast dark editorial scrim behind typography */}
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(95deg, rgba(9,11,14,0.94) 0%, rgba(9,11,14,0.84) 48%, rgba(9,11,14,0.42) 100%)",
              }}
            />
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#090B0E] to-transparent"
            />
          </div>

          <div className="relative z-10 mx-auto w-full max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-2xl space-y-7">
              {/* Quiet Hardware Signal Tag (non-monospace editorial sans) */}
              <div
                className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.12] bg-[#11141B]/75 px-3.5 py-1.5 backdrop-blur-sm"
                style={{ opacity: 1 }}
              >
                <span className="h-2 w-2 rounded-full bg-[#22C58B]" />
                <span className="text-xs font-medium text-[#D6D2C9]">
                  Deterministic Mastering Diagnostics
                </span>
              </div>

              {/* Instrument Serif Kinetic Headline — guaranteed opacity: 1 across back-navigation */}
              <KineticHeadline
                as="h1"
                lines={["Hear every mix flaw.", "Prove every fix."]}
                className="font-editorial text-[clamp(2.85rem,6.4vw,5.4rem)] leading-[1.03] tracking-[-0.025em] text-[#F4F1EA]"
              />

              <p
                className="max-w-[50ch] text-base leading-[1.68] text-[#C5C2BA] sm:text-lg"
                style={{ opacity: 1 }}
              >
                Calibrated ITU-R BS.1770 loudness, 4x oversampled True Peak, and 20–120 Hz sub-bass
                phase telemetry paired with live v1 to v2 auditioning—before your track leaves the
                DAW.
              </p>

              {/* Two Clean Primary Actions (zero cluttered metric boxes) */}
              <div
                data-testid="hero-cta-group"
                className="flex flex-wrap items-center gap-3.5 pt-1"
                style={{ opacity: 1 }}
              >
                <MagneticButton
                  data-testid="hero-primary-cta"
                  onClick={handleLaunchStudio}
                  className="inline-flex h-12 items-center gap-2.5 rounded-[12px] bg-[#22C58B] px-6 text-sm font-semibold text-[#090B0E] transition-[filter] hover:brightness-105 cursor-pointer"
                >
                  <span>{signedInEmail ? "Enter Studio" : "Sign In to Launch Studio"}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </MagneticButton>

                <motion.button
                  type="button"
                  data-testid="hero-preview-demo-cta"
                  whileTap={TACTILE_TAP}
                  onClick={() => void handlePreviewDemoCta()}
                  className="inline-flex h-12 items-center gap-2.5 rounded-[12px] border border-white/[0.16] bg-[#11141B]/80 px-5 text-sm font-medium text-[#F4F1EA] backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-[#171B24] cursor-pointer"
                >
                  <Disc3
                    className={`h-4 w-4 text-[#E89B2D] ${isPlaying ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  <span>{isPlaying ? "Listening to Demo Vinyl" : "Preview Demo Vinyl"}</span>
                </motion.button>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2 — Interactive Turntable & Live Spectrum Showcase */}
        <section
          id="demo-showcase"
          ref={demoSectionRef}
          data-testid="landing-demo-showcase"
          className="border-t border-[var(--border-hairline)] bg-[var(--bg-canvas)] py-20 sm:py-28"
        >
          <div className="mx-auto max-w-[1280px] space-y-10 px-5 sm:px-8">
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={VIEWPORT_REVEAL}
              transition={{ duration: 0.45, ease: STUDIO_EASE }}
              className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"
            >
              <div className="max-w-2xl space-y-3">
                <p className="text-xs font-semibold text-[var(--studio-amber)]">
                  Live Interactive Preview
                </p>
                <h2 className="font-editorial text-[clamp(2.1rem,4.2vw,3.4rem)] leading-[1.06] text-[var(--text-primary)]">
                  Touch the telemetry before you upload.
                </h2>
                <p className="max-w-[58ch] text-base leading-[1.65] text-[var(--text-secondary)]">
                  Press the center spindle to spin our flawed electronic stereo demo, inspect the
                  60 fps 48-band FFT spectrum against its genre envelope, and click any clustered
                  flaw badge to loop the exact problem window.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <motion.button
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={() => void handleToggleDemoVinyl()}
                  disabled={demoLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-active)] cursor-pointer disabled:opacity-50"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                      <span>Pause Demo</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                      <span>Spin Demo Track</span>
                    </>
                  )}
                </motion.button>

                {selectedFindingTitle ? (
                  <span className="rounded-[10px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                    Auditioning: <strong className="text-[var(--text-primary)]">{selectedFindingTitle}</strong>
                  </span>
                ) : null}
              </div>
            </motion.div>

            {demoError ? (
              <p className="text-xs font-medium text-[var(--studio-vermilion)]">{demoError}</p>
            ) : null}

            {/* Spacious 12-Column Studio Hardware Stage */}
            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <SpinningDiscPlayer
                  title="demo-flawed-v1.wav"
                  subtitle="Click center spindle to spin 44.1 kHz stereo demo"
                  genre="electronic"
                  health="alert"
                  lufs={-8.4}
                  truePeak={0.6}
                  bpm={124}
                  isLoadingAudio={demoLoading}
                  onTogglePlay={handleToggleDemoVinyl}
                />
              </div>

              <div className="flex flex-col gap-5 lg:col-span-7">
                <LiveSpectralGraph spectralBands={DEMO_SPECTRAL_BANDS} height={186} />
                <FlawTimelineBar
                  peaks={DEMO_WAVEFORM_PEAKS}
                  durationSec={LANDING_DEMO_DURATION}
                  clippingTimestamps={DEMO_CLIP_TIMESTAMPS}
                  findings={DEMO_FINDINGS}
                  bpm={124}
                  height={126}
                  onSelectFinding={(f) => void handleSelectDemoFinding(f)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-hairline)] pt-6">
              <p className="text-sm text-[var(--text-secondary)]">
                Ready to inspect your own 24-bit WAV, FLAC, or AIFF mixdown with private cloud
                history and v1 → v2 revision checks?
              </p>
              <button
                type="button"
                onClick={handleLaunchStudio}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--studio-mint)] hover:underline cursor-pointer"
              >
                <span>{signedInEmail ? "Open MixBench Studio" : "Sign In to Upload Your Mix"}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        {/* SECTION 3 — Scroll-Choreographed 3-Pillar Proof Band */}
        <section
          id="architecture"
          data-testid="landing-proof-band"
          className="border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] py-20 sm:py-28"
        >
          <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-12">
            {/* Editorial Hardware Photograph (Nano Banana Analog Mastering Console Macro) */}
            <div className="lg:col-span-6">
              <div className="overflow-hidden rounded-[24px] border border-[var(--border-hairline)] bg-[#090B0E]">
                <div ref={consoleParallaxRef} className="will-change-transform">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/media/studio-console-macro.webp"
                    alt="Matte obsidian and brushed aluminum analog mastering console with glowing amber VU meter"
                    width={1920}
                    height={1080}
                    loading="lazy"
                    className="block aspect-[16/11] w-full scale-[1.06] object-cover"
                  />
                </div>
              </div>
            </div>

            {/* Three Scannable Engineering Pillars */}
            <div className="space-y-8 lg:col-span-6">
              <div className="space-y-3">
                <p className="text-xs font-semibold text-[var(--studio-mint)]">
                  Signal-First Engineering
                </p>
                <h2 className="font-editorial text-[clamp(2rem,3.8vw,3.15rem)] leading-[1.08] text-[var(--text-primary)]">
                  Built around deterministic signal truth.
                </h2>
              </div>

              <div className="divide-y divide-[var(--border-hairline)] border-y border-[var(--border-hairline)]">
                {PROOF_PILLARS.map((pillar) => {
                  const Icon = pillar.icon;
                  return (
                    <motion.div
                      key={pillar.title}
                      initial={prefersReduced ? false : { opacity: 0, y: 12 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={VIEWPORT_REVEAL}
                      transition={{ duration: 0.4, ease: STUDIO_EASE }}
                      className="flex items-start gap-4 py-6"
                    >
                      <div
                        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)]"
                        style={{ color: pillar.accent }}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="space-y-1.5">
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">
                          {pillar.title}
                        </h3>
                        <p className="text-sm leading-[1.65] text-[var(--text-secondary)]">
                          {pillar.body}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4 — Built for Artists, Not Data Brokers (Open-Canvas Verification Strip) */}
        <section
          id="privacy"
          data-testid="landing-privacy-strip"
          className="border-t border-[var(--border-hairline)] bg-[var(--bg-canvas)] py-20 sm:py-24"
        >
          <div className="mx-auto max-w-[1280px] space-y-12 px-5 sm:px-8">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-semibold text-[var(--studio-mint)]">
                Artist Ownership Guarantee
              </p>
              <h2 className="font-editorial text-[clamp(2rem,3.8vw,3.15rem)] leading-[1.08] text-[var(--text-primary)]">
                Built for artists, not data brokers.
              </h2>
              <p className="text-base leading-[1.65] text-[var(--text-secondary)]">
                Your unreleased masters remain 100% yours. Every external AI capability is strictly
                opt-in and audited transparently in every session report.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 border-t border-[var(--border-hairline)] pt-8 md:grid-cols-3 md:gap-10">
              {PRIVACY_GUARANTEES.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="space-y-3">
                    <Icon className="h-5 w-5 text-[var(--studio-mint)]" aria-hidden="true" />
                    <h3 className="text-base font-semibold text-[var(--text-primary)]">
                      {item.title}
                    </h3>
                    <p className="text-sm leading-[1.65] text-[var(--text-secondary)]">
                      {item.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION 5 — Clean Final CTA */}
        <section
          data-testid="landing-final-cta"
          className="border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] py-24 sm:py-28"
        >
          <div className="mx-auto flex max-w-2xl flex-col items-center space-y-6 px-5 text-center sm:px-8">
            <h2 className="font-editorial text-[clamp(2.2rem,4.4vw,3.6rem)] leading-[1.06] text-[var(--text-primary)]">
              Bring calibrated truth to your next mixdown.
            </h2>
            <p className="max-w-[46ch] text-base leading-[1.65] text-[var(--text-secondary)]">
              Sign in to unlock full stereo mix diagnostics, aligned stem overlap matrices,
              level-matched Reference A/B, and private session history.
            </p>
            <MagneticButton
              data-testid="final-enter-studio-cta"
              onClick={handleLaunchStudio}
              className="inline-flex h-12 items-center gap-2.5 rounded-[12px] bg-[var(--studio-mint)] px-7 text-sm font-semibold text-[#090B0E] transition-[filter] hover:brightness-105 cursor-pointer"
            >
              <span>Enter MixBench Studio</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </MagneticButton>
          </div>
        </section>
      </main>

      {/* Global Legal & System Diagnostics Footer */}
      <footer className="border-t border-[var(--border-hairline)] bg-[var(--bg-canvas)] py-7 text-xs text-[var(--text-muted)]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[var(--studio-mint)]" />
            <span className="font-medium text-[var(--text-secondary)]">MixBench Studio</span>
            <span>· Deterministic Audio DSP Workbench</span>
          </div>
          <nav aria-label="Legal and status links" className="flex flex-wrap items-center gap-6">
            <Link
              href="/privacy"
              className="font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              Terms of Use
            </Link>
            <Link
              href="/status"
              className="font-medium text-[var(--studio-mint)] hover:underline"
            >
              System Status
            </Link>
          </nav>
        </div>
      </footer>

      <AuthModal
        open={authOpen}
        onOpenChange={setAuthOpen}
        initialError={authInitialError}
        promptReason={authPromptReason}
        redirectTo="/studio"
      />
    </div>
  );
}

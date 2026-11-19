import React from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";

export const metadata = {
  title: "Privacy Policy | Mixit",
  description:
    "Mixit Privacy Policy — Zero-Audio-by-Default, 60-minute ephemeral session deletion, three-tier opt-in AI consent, and user-owned cloud storage.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#0A0A0A]">
      <div className="mx-auto min-h-screen max-w-4xl border-x-[1.5px] border-[#0A0A0A]">
        <header className="flex flex-wrap items-center justify-between border-b-[1.5px] border-[#0A0A0A]">
          <Link
            href="/"
            className="inline-flex items-center gap-2 border-r-[1.5px] border-[#0A0A0A] px-5 py-4 text-xs font-bold uppercase tracking-[0.06em] text-[#0A0A0A] transition-colors hover:bg-[#0A0A0A] hover:text-[#FFE01B]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to Mixit
          </Link>
          <div className="px-4 py-3">
            <MixitLogo variant="full" tone="light" heightClass="h-6" />
          </div>
          <span className="inline-flex items-center gap-1.5 border-l-[1.5px] border-[#0A0A0A] bg-[#FFE01B] px-4 py-4 text-[11px] font-bold uppercase tracking-[0.08em] text-[#0A0A0A]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Privacy-by-Default
          </span>
        </header>

        <main className="divide-y-[1.5px] divide-[#0A0A0A]">
          <section className="p-6 sm:p-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#FF3B1F]">
              Zero-Audio-by-Default Architecture
            </p>
            <h1 className="mt-2 font-brut text-4xl text-[#0A0A0A] sm:text-5xl">
              Mixit Privacy Policy
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-[#3F3F46]">
              Effective Date: Global Launch v1.0 · Deterministic Audio DSP &amp; User-Owned Mix
              Diagnostics.
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              01 · Zero-Audio-by-Default Guarantee
            </h2>
            <p>
              Mixit runs deterministic audio measurements (ITU-R BS.1770 LUFS, 4x True Peak dBTP,
              PLR/PSR, Crest Factor, Transient Punch, 20–120 Hz bandpass phase correlation, 6-band
              Welch spectral balance, BPM, and song structure) directly on ephemeral server workers
              without transmitting your audio to any third-party AI model or training pipeline.
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              02 · Ephemeral 60-Minute Processing &amp; Immediate Deletion
            </h2>
            <p>
              Uploaded WAV, FLAC, MP3, AIFF, OGG, and M4A mixdowns and stems are decoded in memory
              and stored exclusively in ephemeral session directories with a strict 60-minute TTL
              (or deleted immediately when you click{" "}
              <strong className="text-[#0A0A0A]">Clear Session</strong>). Temporary audio clips
              extracted for optional coaching are unlinked immediately after request completion.
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              03 · Three-Tier Independent Opt-In AI Consent
            </h2>
            <p>
              All three privacy consent toggles strictly default to{" "}
              <strong className="text-[#0A0A0A]">OFF (false)</strong> across the browser UI,
              backend API schemas, and Supabase database tables:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-[#0A0A0A]">
              <li>
                <strong>Tier 1 — Numerical DSP Metrics Only:</strong> Sends structured numerical
                telemetry and <code className="tabular-telemetry">evidence_id</code> tags to the
                Gemini AI Mix Mentor. Zero audio leaves your session.
              </li>
              <li>
                <strong>Tier 2 — Direct 25-Second Audio Snippet Analysis:</strong> Requires
                separate explicit opt-in before transmitting a compressed 25-second snippet around
                the most problematic section of your mix for acoustic coaching.
              </li>
              <li>
                <strong>Tier 3 — Model Training Permission:</strong> Strictly OFF by default.
                External AI requests operate with non-retention/zero-training flags unless
                explicitly opted in by the user.
              </li>
            </ul>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              04 · Private Cloud Mix History &amp; Shareable Review Links
            </h2>
            <p>
              When you sign in via Supabase Auth (Email or Google OAuth) to enter{" "}
              <code className="tabular-telemetry">/studio</code>, your saved JSON telemetry
              reports, privacy preferences, and private compressed playback proxies are protected by
              PostgreSQL Row-Level Security (
              <code className="tabular-telemetry">auth.uid() = user_id</code>). Reports remain
              private unless you explicitly generate a read-only Shareable Client Review Link. You
              may delete any saved report or purge all account data and proxies at any time from the
              Cloud Mix History drawer.
            </p>
          </section>

          <footer className="grid grid-cols-1 divide-y-[1.5px] divide-[#0A0A0A] sm:grid-cols-3 sm:divide-x-[1.5px] sm:divide-y-0 text-xs font-bold uppercase tracking-[0.06em]">
            <Link
              href="/terms"
              className="p-4 text-center text-[#0A0A0A] transition-colors hover:bg-[#FFE01B]"
            >
              Terms of Use ↗
            </Link>
            <Link
              href="/cookies"
              className="p-4 text-center text-[#0A0A0A] transition-colors hover:bg-[#FFE01B]"
            >
              Cookie Policy ↗
            </Link>
            <Link
              href="/status"
              className="p-4 text-center text-[#0A0A0A] transition-colors hover:bg-[#FFE01B]"
            >
              System Status ↗
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}

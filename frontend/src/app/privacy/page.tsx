import React from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Privacy Policy | MixBench",
  description:
    "MixBench Privacy Policy — Zero-Audio-by-Default, 60-minute ephemeral session deletion, three-tier opt-in AI consent, and user-owned cloud storage.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent-mint)] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to MixBench Workbench
          </Link>
          <span className="inline-flex items-center gap-1.5 bg-[var(--accent-mint-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-mint)] squircle-inner">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Privacy-by-Default
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 space-y-6">
        <div className="space-y-2">
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-bold tracking-[-0.02em] text-[var(--text-primary)] sm:text-3xl">
            MixBench Privacy Policy
          </h1>
          <p className="text-xs text-[var(--text-secondary)]">
            Effective Date: Global Launch v1.0 · Zero-Audio-by-Default Architecture
          </p>
        </div>

        <section className="bg-[var(--bg-elevated)] p-6 hairline-border squircle-outer space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            1. Zero-Audio-by-Default Guarantee
          </h2>
          <p>
            MixBench runs deterministic audio measurements (ITU-R BS.1770 LUFS, 4x True Peak dBTP,
            PLR/PSR, Crest Factor, Transient Punch, 20–120 Hz bandpass phase correlation, 6-band
            Welch spectral balance, BPM, and song structure) directly on ephemeral server workers
            without transmitting your audio to any third-party AI model or training pipeline.
          </p>
        </section>

        <section className="bg-[var(--bg-elevated)] p-6 hairline-border squircle-outer space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            2. Ephemeral 60-Minute Processing &amp; Immediate Deletion
          </h2>
          <p>
            Uploaded WAV, FLAC, MP3, AIFF, OGG, and M4A mixdowns and stems are decoded in memory
            and stored exclusively in ephemeral session directories with a strict 60-minute TTL
            (or deleted immediately when you click <strong className="text-[var(--text-primary)]">Clear Session</strong>).
            Temporary audio clips extracted for optional coaching are unlinked immediately after
            request completion.
          </p>
        </section>

        <section className="bg-[var(--bg-elevated)] p-6 hairline-border squircle-outer space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            3. Three-Tier Independent Opt-In AI Consent
          </h2>
          <p>
            All three privacy consent toggles strictly default to <strong className="text-[var(--text-primary)]">OFF (false)</strong> across
            the browser UI, backend API schemas, and Supabase database tables:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs">
            <li>
              <strong className="text-[var(--text-primary)]">Tier 1 — Numerical DSP Metrics Only:</strong> Sends
              structured numerical telemetry and <code className="text-[var(--text-primary)]">evidence_id</code> tags
              to the Gemini AI Mix Mentor. Zero audio leaves your session.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Tier 2 — Direct 25-Second Audio Snippet Analysis:</strong> Requires
              separate explicit opt-in before transmitting a compressed 25-second snippet around the
              most problematic section of your mix for acoustic coaching.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Tier 3 — Model Training Permission:</strong> Strictly
              OFF by default. External AI requests operate with non-retention/zero-training flags
              unless explicitly opted in by the user.
            </li>
          </ul>
        </section>

        <section className="bg-[var(--bg-elevated)] p-6 hairline-border squircle-outer space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            4. Optional Cloud Mix History &amp; Shareable Review Links
          </h2>
          <p>
            Anonymous analysis works with zero account creation. If you choose to sign in via
            Supabase Auth (Email or Google OAuth), your saved JSON telemetry reports, privacy
            preferences, and private compressed playback proxies are protected by PostgreSQL
            Row-Level Security (<code className="text-[var(--text-primary)]">auth.uid() = user_id</code>).
            Reports remain private unless you explicitly generate a read-only Shareable Client
            Review Link. You may delete any saved report or purge all account data and proxies at
            any time from the Cloud Mix History drawer.
          </p>
        </section>

        <div className="flex items-center justify-between pt-2 text-xs text-[var(--text-secondary)]">
          <Link href="/" className="font-medium text-[var(--accent-mint)] hover:underline">
            Return to MixBench
          </Link>
          <Link href="/terms" className="font-medium text-[var(--accent-mint)] hover:underline">
            Read Terms of Use
          </Link>
        </div>
      </main>
    </div>
  );
}

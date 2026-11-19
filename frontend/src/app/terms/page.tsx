import React from "react";
import Link from "next/link";
import { ArrowLeft, Scale } from "lucide-react";

export const metadata = {
  title: "Terms of Use | MixBench",
  description:
    "MixBench Terms of Use — Artist IP ownership, deterministic DSP engineering disclaimer, acceptable usage, and ephemeral audio processing.",
};

export default function TermsOfUsePage() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#182220]">
      <header className="border-b border-[rgba(24,34,32,0.08)] bg-[#FAFAFA]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#3A7269] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to MixBench Workbench
          </Link>
          <span className="inline-flex items-center gap-1.5 bg-[#EBF3F1] px-2.5 py-1 text-[11px] font-semibold text-[#3A7269] squircle-inner">
            <Scale className="h-3.5 w-3.5" aria-hidden="true" />
            Terms of Use
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 space-y-6">
        <div className="space-y-2">
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-bold tracking-[-0.02em] text-[#182220] sm:text-3xl">
            MixBench Terms of Use
          </h1>
          <p className="text-xs text-[#52605D]">
            Effective Date: Global Launch v1.0 · Deterministic Audio Engineering Workbench
          </p>
        </div>

        <section className="bg-[#FFFFFF] p-6 hairline-border squircle-outer space-y-3 text-sm leading-relaxed text-[#52605D]">
          <h2 className="text-base font-semibold text-[#182220]">
            1. 100% Artist Ownership &amp; Copyright Retention
          </h2>
          <p>
            You retain full, exclusive ownership and intellectual property rights to every audio
            file, stem, revision, and mixdown you upload to MixBench. MixBench claims zero license
            to distribute, train on, or commercialize your recordings.
          </p>
        </section>

        <section className="bg-[#FFFFFF] p-6 hairline-border squircle-outer space-y-3 text-sm leading-relaxed text-[#52605D]">
          <h2 className="text-base font-semibold text-[#182220]">
            2. Deterministic DSP &amp; Coaching Disclaimer
          </h2>
          <p>
            All loudness, peak, spectral, and phase measurements are computed deterministically to
            assist your mixing and mastering decisions. Optional AI Mix Mentor commentary and
            DAW EQ presets are educational starting points—always verify final tonal balance,
            headroom, and translation on calibrated studio monitors before commercial release.
          </p>
        </section>

        <section className="bg-[#FFFFFF] p-6 hairline-border squircle-outer space-y-3 text-sm leading-relaxed text-[#52605D]">
          <h2 className="text-base font-semibold text-[#182220]">
            3. Acceptable Use &amp; Fair-Use Rate Limits
          </h2>
          <p>
            Please upload only audio content you have the legal right to analyze. Single mix files
            are capped at 50 MB and aligned stem uploads at 350 MB total. Automated scraping,
            denial-of-service traffic, or circumventing session rate limits is prohibited.
          </p>
        </section>

        <section className="bg-[#FFFFFF] p-6 hairline-border squircle-outer space-y-3 text-sm leading-relaxed text-[#52605D]">
          <h2 className="text-base font-semibold text-[#182220]">
            4. Ephemeral Storage &amp; Service Availability
          </h2>
          <p>
            MixBench is provided &ldquo;as is&rdquo; without warranty of uninterrupted uptime. Do
            not use MixBench as a primary backup for master recordings; session audio expires after
            60 minutes on ephemeral workers.
          </p>
        </section>

        <div className="flex items-center justify-between pt-2 text-xs text-[#52605D]">
          <Link href="/" className="font-medium text-[#3A7269] hover:underline">
            Return to MixBench
          </Link>
          <Link href="/privacy" className="font-medium text-[#3A7269] hover:underline">
            Read Privacy Policy
          </Link>
        </div>
      </main>
    </div>
  );
}

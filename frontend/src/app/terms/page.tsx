import React from "react";
import Link from "next/link";
import { ArrowLeft, Scale } from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";

export const metadata = {
  title: "Terms of Use | Mixit",
  description:
    "Mixit Terms of Use — 100% Artist IP ownership, deterministic DSP engineering disclaimer, acceptable usage, and ephemeral audio processing.",
};

export default function TermsOfUsePage() {
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
            <Scale className="h-3.5 w-3.5" aria-hidden="true" />
            Terms of Use
          </span>
        </header>

        <main className="divide-y-[1.5px] divide-[#0A0A0A]">
          <section className="p-6 sm:p-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#FF3B1F]">
              100% Free Global Access · Artist IP Protected
            </p>
            <h1 className="mt-2 font-brut text-4xl text-[#0A0A0A] sm:text-5xl">
              Mixit Terms of Use
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-[#3F3F46]">
              Effective Date: Global Launch v1.0 · Deterministic Audio Engineering Workbench.
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              01 · 100% Artist Ownership &amp; Copyright Retention
            </h2>
            <p>
              You retain full, exclusive ownership and intellectual property rights to every audio
              file, stem, revision, and mixdown you upload to Mixit. Mixit claims zero license to
              distribute, train on, or commercialize your recordings.
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              02 · Deterministic DSP &amp; Coaching Disclaimer
            </h2>
            <p>
              All loudness, peak, spectral, and phase measurements are computed deterministically to
              assist your mixing and mastering decisions. Optional AI Mix Mentor commentary and DAW
              EQ presets are educational starting points—always verify final tonal balance,
              headroom, and translation on calibrated studio monitors before commercial release.
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              03 · Acceptable Use &amp; Fair-Use Rate Limits
            </h2>
            <p>
              Please upload only audio content you have the legal right to analyze. Single mix files
              are capped at 50 MB and aligned stem uploads at 150 MB total. Automated scraping,
              denial-of-service traffic, or circumventing session rate limits is prohibited.
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              04 · Ephemeral Storage &amp; Service Availability
            </h2>
            <p>
              Mixit is provided free of charge &ldquo;as is&rdquo; without warranty of uninterrupted
              uptime. Do not use Mixit as a primary backup for master recordings; session audio
              expires after 60 minutes on ephemeral workers.
            </p>
          </section>

          <footer className="grid grid-cols-1 divide-y-[1.5px] divide-[#0A0A0A] sm:grid-cols-3 sm:divide-x-[1.5px] sm:divide-y-0 text-xs font-bold uppercase tracking-[0.06em]">
            <Link
              href="/privacy"
              className="p-4 text-center text-[#0A0A0A] transition-colors hover:bg-[#FFE01B]"
            >
              Privacy Policy ↗
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

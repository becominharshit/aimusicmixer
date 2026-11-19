import React from "react";
import Link from "next/link";
import { ArrowLeft, Cookie, ShieldCheck } from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";

export const metadata = {
  title: "Cookie Policy | Mixit",
  description:
    "Mixit Cookie Policy — Strictly essential Supabase Auth session cookies only, zero advertising trackers, and zero cross-site analytics cookies.",
};

export default function CookiePolicyPage() {
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
            <Cookie className="h-3.5 w-3.5" aria-hidden="true" />
            Essential Cookies Only
          </span>
        </header>

        <main className="divide-y-[1.5px] divide-[#0A0A0A]">
          <section className="p-6 sm:p-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#FF3B1F]">
              Global Compliance · Zero Trackers
            </p>
            <h1 className="mt-2 font-brut text-4xl text-[#0A0A0A] sm:text-5xl">
              Mixit Cookie Policy
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-[#3F3F46]">
              Effective Date: Global Launch v1.0. Mixit operates as a 100% free audio diagnostics
              studio with strictly essential session cookies and zero third-party ad or analytics
              scripts.
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              01 · Strictly Essential Authentication Cookies
            </h2>
            <p>
              When you sign in to access the protected{" "}
              <code className="border border-[#0A0A0A]/25 bg-[#F7F7F5] px-1.5 py-0.5 tabular-telemetry text-xs text-[#0A0A0A]">
                /studio
              </code>{" "}
              workbench, Supabase Auth sets strictly essential HTTP session cookies (prefixed{" "}
              <code className="border border-[#0A0A0A]/25 bg-[#F7F7F5] px-1.5 py-0.5 tabular-telemetry text-xs text-[#0A0A0A]">
                sb-*-auth-token
              </code>
              ) solely to verify your authenticated session, enforce PostgreSQL Row-Level Security
              on your saved mix reports, and prevent cross-site request forgery.
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              02 · Local Browser Preferences (Non-Tracking)
            </h2>
            <p>
              Mixit stores two lightweight local preference keys inside your browser&apos;s{" "}
              <code className="border border-[#0A0A0A]/25 bg-[#F7F7F5] px-1.5 py-0.5 tabular-telemetry text-xs text-[#0A0A0A]">
                localStorage
              </code>{" "}
              that never leave your device:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-[#0A0A0A]">
              <li>
                <strong className="tabular-telemetry">mixit_theme</strong> — remembers your{" "}
                <strong>INK (Obsidian)</strong> vs. <strong>PAPER (Swiss White)</strong> console
                preference inside <code className="tabular-telemetry">/studio</code>.
              </li>
              <li>
                <strong className="tabular-telemetry">mixit_cookie_consent_v1</strong> — remembers
                that you dismissed the essential cookie notice banner.
              </li>
            </ul>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              03 · Zero Advertising, Analytics, or Cross-Site Cookies
            </h2>
            <p className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0F7A53]" aria-hidden="true" />
              <span>
                Mixit loads zero third-party advertising pixels, zero marketing trackers, zero
                fingerprinting libraries, and zero third-party social embeds. All studio media and
                brand assets are self-hosted directly from Mixit.
              </span>
            </p>
          </section>

          <section className="p-6 sm:p-8 space-y-3 text-sm leading-relaxed text-[#3F3F46]">
            <h2 className="font-condensed text-xl font-extrabold text-[#0A0A0A]">
              04 · Managing &amp; Clearing Cookies
            </h2>
            <p>
              Clicking <strong className="text-[#0A0A0A]">Sign Out</strong> inside Mixit Studio
              immediately clears your active authentication cookies, disposes in-memory audio
              buffers, and returns you to the public landing page. You may also clear site cookies
              and local storage at any time in your browser settings.
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
              href="/terms"
              className="p-4 text-center text-[#0A0A0A] transition-colors hover:bg-[#FFE01B]"
            >
              Terms of Use ↗
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

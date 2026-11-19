"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { STUDIO_EASE } from "@/lib/motion";

const COOKIE_CONSENT_KEY = "mixit_cookie_consent_v1";

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COOKIE_CONSENT_KEY);
      if (!saved) {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_KEY, "essential_accepted");
    } catch {
      // Ignore private browsing storage errors
    }
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleAccept();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.aside
          data-testid="cookie-consent-banner"
          role="region"
          aria-label="Essential cookie notice"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.2, ease: STUDIO_EASE }}
          className="no-print fixed bottom-3 left-3 right-3 z-50 mx-auto max-w-4xl border-[1.5px] border-[#0A0A0A] bg-[#FFFFFF] text-[#0A0A0A]"
        >
          <div className="flex flex-col items-stretch justify-between sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 text-xs sm:flex-nowrap">
              <span className="inline-flex shrink-0 items-center gap-1.5 border border-[#0A0A0A] bg-[#FFE01B] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#0A0A0A]">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Essential Cookies Only
              </span>
              <p className="leading-snug text-[#0A0A0A]">
                Mixit uses strictly essential Supabase session cookies. Zero ad or cross-site trackers.{" "}
                <Link
                  href="/cookies"
                  className="font-bold underline underline-offset-2 hover:text-[#FF3B1F]"
                >
                  Cookie Policy
                </Link>
              </p>
            </div>

            <div className="flex shrink-0 border-t-[1.5px] border-[#0A0A0A] sm:border-l-[1.5px] sm:border-t-0">
              <button
                type="button"
                onClick={handleAccept}
                aria-label="Accept essential cookies"
                className="w-full bg-[#FFE01B] px-5 py-3 text-xs font-extrabold uppercase tracking-[0.08em] text-[#0A0A0A] transition-colors hover:bg-[#0A0A0A] hover:text-[#FFE01B] cursor-pointer sm:w-auto"
              >
                Accept
              </button>
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

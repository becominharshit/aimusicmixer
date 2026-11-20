"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ShieldCheck, X } from "lucide-react";
import { STUDIO_EASE } from "@/lib/motion";

const COOKIE_CONSENT_KEY = "mixit_cookie_consent_v1";

export function CookieConsentBanner() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const aboveTransportDock =
    Boolean(pathname?.startsWith("/studio")) || Boolean(pathname?.startsWith("/daw"));

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

  const persistChoice = (choice: "essential_accepted" | "essential_only" | "dismissed") => {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_KEY, choice);
    } catch {
      // Ignore private browsing storage errors
    }
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        persistChoice("dismissed");
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
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ duration: 0.2, ease: STUDIO_EASE }}
          className={`no-print fixed right-4 z-40 w-[calc(100%-2rem)] max-w-sm border-[1.5px] border-[#14171F] bg-[#F9F8F4] text-[#14171F] shadow-lg ${
            aboveTransportDock ? "bottom-20" : "bottom-4"
          }`}
        >
          {/* Compact Header Row with Neutral Dismiss (×) */}
          <div className="flex items-center justify-between gap-2 border-b-[1.5px] border-[#14171F] bg-[#F2EFE7] px-3 py-2">
            <span className="inline-flex items-center gap-1.5 border border-[#14171F] bg-[#F5C451] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#14171F]">
              <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
              Essential Cookies Only
            </span>
            <button
              type="button"
              onClick={() => persistChoice("dismissed")}
              aria-label="Dismiss cookie notice"
              title="Dismiss cookie notice"
              className="inline-flex h-6 w-6 items-center justify-center border border-transparent text-[#14171F] transition-colors hover:border-[#14171F] hover:bg-[#FFFFFF] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Concise Privacy Copy */}
          <div className="px-3.5 py-2.5 text-xs leading-snug text-[#14171F]">
            Mixit uses strictly essential Supabase session cookies. Zero ad or cross-site trackers.{" "}
            <Link
              href="/cookies"
              className="font-bold underline underline-offset-2 hover:text-[#E85D4A]"
            >
              Cookie Policy
            </Link>
          </div>

          {/* Action Split: Essential Only + Accept */}
          <div className="grid grid-cols-2 border-t-[1.5px] border-[#14171F]">
            <button
              type="button"
              onClick={() => persistChoice("essential_only")}
              aria-label="Use essential cookies only"
              className="border-r-[1.5px] border-[#14171F] bg-[#FFFFFF] px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#14171F] transition-colors hover:bg-[#F2EFE7] cursor-pointer"
            >
              Essential Only
            </button>
            <button
              type="button"
              onClick={() => persistChoice("essential_accepted")}
              aria-label="Accept essential cookies"
              className="bg-[#F5C451] px-3 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#14171F] transition-colors hover:bg-[#14171F] hover:text-[#F5C451] cursor-pointer"
            >
              Accept
            </button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

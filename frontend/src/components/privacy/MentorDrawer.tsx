"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles, X } from "lucide-react";
import { MentorPrivacyPanel } from "@/components/privacy/MentorPrivacyPanel";
import { STUDIO_EASE, STUDIO_SPRING } from "@/lib/motion";
import type { PrivacyPreferences } from "@/lib/supabase/storage";
import type { AnalysisReport, MentorRequest, MentorResponse } from "@/types/report";

interface MentorDrawerProps {
  open: boolean;
  onClose: () => void;
  report: AnalysisReport;
  mentorAdvice: MentorResponse | null;
  isAskingMentor: boolean;
  mentorError?: string | null;
  onDismissMentorError?: () => void;
  onAskMentor: (req: MentorRequest) => void | Promise<void>;
  onSaveDawContext: (ctx: { daw: string; bus_routing: string; plugin_notes: string }) => void;
  onJumpToEvidence: (evidenceId: string) => void;
  privacyPrefs?: PrivacyPreferences;
  onPrivacyPrefsChange?: (prefs: PrivacyPreferences) => void;
  privacySaveState?: "idle" | "saving" | "saved" | "error";
  isSignedIn?: boolean;
}

export function MentorDrawer({
  open,
  onClose,
  report,
  mentorAdvice,
  isAskingMentor,
  mentorError = null,
  onDismissMentorError,
  onAskMentor,
  onSaveDawContext,
  onJumpToEvidence,
  privacyPrefs,
  onPrivacyPrefsChange,
  privacySaveState = "idle",
  isSignedIn = false,
}: MentorDrawerProps) {
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  useEffect(() => {
    setLocalError(null);
    setLocalLoading(false);
  }, [report.report_id]);

  const handleAskMentorSafe = async (req: MentorRequest) => {
    setLocalError(null);
    onDismissMentorError?.();
    setLocalLoading(true);
    try {
      await onAskMentor(req);
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : "AI Mix Mentor request failed. Please retry or use the Offline Deterministic Mentor."
      );
    } finally {
      setLocalLoading(false);
    }
  };

  const combinedLoading = isAskingMentor || localLoading;
  const combinedError = mentorError || localError;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="mentor-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: STUDIO_EASE }}
          onClick={onClose}
          className="no-print fixed inset-0 z-50 bg-[rgba(24,34,32,0.28)] backdrop-blur-[2px]"
        />
      )}
      {open && (
        <motion.aside
          key="mentor-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="AI Mix Mentor and Privacy Consent Controls"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%", transition: { duration: 0.18, ease: STUDIO_EASE } }}
          transition={STUDIO_SPRING}
          className="no-print fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[500px] flex-col overflow-x-hidden border-l border-[rgba(24,34,32,0.08)] bg-[#FAFAFA] shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-[rgba(24,34,32,0.08)] bg-[#FFFFFF] px-4 py-3.5 sm:px-5 sm:py-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#EBF3F1] text-[#3A7269] squircle-inner">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#182220]">
                  AI Mix Mentor
                </h2>
                <p className="truncate text-[11px] text-[#52605D]">
                  Evidence-grounded coaching · Three-tier granular consent
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close AI Mix Mentor"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[#52605D] hover:bg-[#F5F5F7] hover:text-[#182220] squircle-inner cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-5">
            <MentorPrivacyPanel
              report={report}
              mentorAdvice={mentorAdvice}
              isAskingMentor={combinedLoading}
              mentorError={combinedError}
              onDismissMentorError={() => {
                setLocalError(null);
                onDismissMentorError?.();
              }}
              onAskMentor={(req) => void handleAskMentorSafe(req)}
              onSaveDawContext={onSaveDawContext}
              privacyPrefs={privacyPrefs}
              onPrivacyPrefsChange={onPrivacyPrefsChange}
              privacySaveState={privacySaveState}
              isSignedIn={isSignedIn}
              onJumpToEvidence={(eid) => {
                onJumpToEvidence(eid);
                onClose();
              }}
            />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

"use client";

import React, { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles, X } from "lucide-react";
import { MentorPrivacyPanel } from "@/components/privacy/MentorPrivacyPanel";
import { STUDIO_EASE, STUDIO_SPRING } from "@/lib/motion";
import type { AnalysisReport, MentorRequest, MentorResponse } from "@/types/report";

interface MentorDrawerProps {
  open: boolean;
  onClose: () => void;
  report: AnalysisReport;
  mentorAdvice: MentorResponse | null;
  isAskingMentor: boolean;
  onAskMentor: (req: MentorRequest) => void;
  onSaveDawContext: (ctx: { daw: string; bus_routing: string; plugin_notes: string }) => void;
  onJumpToEvidence: (evidenceId: string) => void;
}

export function MentorDrawer({
  open,
  onClose,
  report,
  mentorAdvice,
  isAskingMentor,
  onAskMentor,
  onSaveDawContext,
  onJumpToEvidence,
}: MentorDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="mentor-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: STUDIO_EASE }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-[rgba(24,34,32,0.28)] backdrop-blur-[2px]"
          />
          <motion.aside
            key="mentor-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="AI Mix Mentor and Privacy Consent Controls"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={STUDIO_SPRING}
            className="fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[460px] flex-col border-l border-[rgba(24,34,32,0.08)] bg-[#FAFAFA] shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-[rgba(24,34,32,0.08)] bg-[#FFFFFF] px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center bg-[#EBF3F1] text-[#3A7269] squircle-inner">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-[#182220]">
                    AI Mix Mentor
                  </h2>
                  <p className="text-[11px] text-[#52605D]">
                    Evidence-grounded coaching · Three-tier granular consent
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close AI Mix Mentor"
                className="inline-flex h-8 w-8 items-center justify-center text-[#52605D] hover:bg-[#F5F5F7] hover:text-[#182220] squircle-inner cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <MentorPrivacyPanel
                report={report}
                mentorAdvice={mentorAdvice}
                isAskingMentor={isAskingMentor}
                onAskMentor={onAskMentor}
                onSaveDawContext={onSaveDawContext}
                onJumpToEvidence={(eid) => {
                  onJumpToEvidence(eid);
                  onClose();
                }}
              />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

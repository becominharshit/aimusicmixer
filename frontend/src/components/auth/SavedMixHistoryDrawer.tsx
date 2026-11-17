"use client";

import React, { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FolderOpen, GitCompare, History, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STUDIO_EASE, STUDIO_SPRING } from "@/lib/motion";
import type { SavedAnalysisRecord } from "@/lib/supabase/storage";
import type { AnalysisReport } from "@/types/report";

interface SavedMixHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  analyses: SavedAnalysisRecord[];
  isLoading: boolean;
  activeReport: AnalysisReport | null;
  isComparingSaved: boolean;
  onRefresh: () => void;
  onLoadReport: (report: AnalysisReport) => void;
  onCompareAgainstActive: (baselineReport: AnalysisReport) => void;
  onDeleteAnalysis: (analysisId: string) => void;
}

export function SavedMixHistoryDrawer({
  open,
  onClose,
  analyses,
  isLoading,
  activeReport,
  isComparingSaved,
  onRefresh,
  onLoadReport,
  onCompareAgainstActive,
  onDeleteAnalysis,
}: SavedMixHistoryDrawerProps) {
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
            key="history-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: STUDIO_EASE }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-[rgba(24,34,32,0.28)] backdrop-blur-[2px]"
          />
          <motion.aside
            key="history-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Saved Mix History"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={STUDIO_SPRING}
            className="fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[460px] flex-col border-l border-[rgba(24,34,32,0.08)] bg-[#FAFAFA] shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-[rgba(24,34,32,0.08)] bg-[#FFFFFF] px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center bg-[#EBF3F1] text-[#3A7269] squircle-inner">
                  <History className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-[#182220]">
                    Saved Mix History
                  </h2>
                  <p className="text-[11px] text-[#52605D]">
                    Reload past AnalysisReport v1.0 telemetry or compare v1 → v2
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={isLoading}
                  aria-label="Refresh saved mix history"
                  className="inline-flex h-8 w-8 items-center justify-center text-[#52605D] hover:bg-[#F5F5F7] hover:text-[#182220] squircle-inner cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Saved Mix History"
                  className="inline-flex h-8 w-8 items-center justify-center text-[#52605D] hover:bg-[#F5F5F7] hover:text-[#182220] squircle-inner cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {isLoading && analyses.length === 0 ? (
                <div className="bg-[#FFFFFF] p-5 text-center text-xs text-[#52605D] hairline-border squircle-inner">
                  Loading saved mix telemetry...
                </div>
              ) : analyses.length === 0 ? (
                <div className="bg-[#FFFFFF] p-6 text-center hairline-border squircle-inner space-y-2">
                  <div className="text-sm font-semibold text-[#182220]">
                    No saved analyses yet
                  </div>
                  <p className="text-xs text-[#52605D]">
                    Analyze a mix or revision while signed in and your structured AnalysisReport v1.0 telemetry will appear here automatically.
                  </p>
                </div>
              ) : (
                analyses.map((row) => {
                  const rep = row.report_json;
                  const canCompare =
                    Boolean(activeReport) && activeReport?.report_id !== rep.report_id;

                  return (
                    <div
                      key={row.id}
                      className="bg-[#FFFFFF] p-4 hairline-border squircle-inner space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-semibold text-[#182220]">
                              {row.track_name}
                            </span>
                            <span className="rounded-full bg-[#EBF3F1] px-2 py-0.5 text-[10px] font-semibold text-[#3A7269] tabular-telemetry">
                              {row.version_label}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#52605D]">
                            {row.genre} · {row.stage.replaceAll("_", " ")} ·{" "}
                            {new Date(row.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteAnalysis(row.id)}
                          aria-label={`Delete saved analysis ${row.track_name}`}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-[#52605D] hover:bg-[#FFF1F3] hover:text-[#BE123C] squircle-inner cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2 text-[11px] text-[#182220] tabular-telemetry">
                        <span className="bg-[#F5F5F7] px-2 py-0.5 squircle-inner">
                          {rep.global_metrics.integrated_lufs.toFixed(1)} LUFS
                        </span>
                        <span className="bg-[#F5F5F7] px-2 py-0.5 squircle-inner">
                          {rep.global_metrics.true_peak_dbtp >= 0 ? "+" : ""}
                          {rep.global_metrics.true_peak_dbtp.toFixed(2)} dBTP
                        </span>
                        <span className="bg-[#F5F5F7] px-2 py-0.5 squircle-inner">
                          Corr {rep.global_metrics.phase_correlation_avg >= 0 ? "+" : ""}
                          {rep.global_metrics.phase_correlation_avg.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            onLoadReport(rep);
                            onClose();
                          }}
                        >
                          <FolderOpen className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
                          Load Report
                        </Button>

                        {canCompare && (
                          <Button
                            type="button"
                            variant="soft"
                            size="sm"
                            disabled={isComparingSaved}
                            onClick={() => {
                              onCompareAgainstActive(rep);
                              onClose();
                            }}
                          >
                            <GitCompare className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
                            Compare vs Open Mix
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

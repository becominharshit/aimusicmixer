"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, FolderOpen, GitCompare, History, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STUDIO_EASE, STUDIO_SPRING } from "@/lib/motion";
import type { SavedAnalysisRecord } from "@/lib/supabase/storage";
import type { AnalysisReport } from "@/types/report";

interface SavedMixHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  analyses: SavedAnalysisRecord[];
  hasMore?: boolean;
  isLoading: boolean;
  activeReport: AnalysisReport | null;
  isComparingSaved: boolean;
  onRefresh: () => void;
  onLoadMore?: () => void;
  onLoadReport: (record: SavedAnalysisRecord) => void;
  onCompareAgainstActive: (baselineReport: AnalysisReport) => void;
  onDeleteAnalysis: (analysisId: string, proxyStoragePath?: string | null) => void;
  onPurgeAccountData?: () => Promise<void>;
  onOpenAddAudio?: () => void;
}

export function SavedMixHistoryDrawer({
  open,
  onClose,
  analyses,
  hasMore = false,
  isLoading,
  activeReport,
  isComparingSaved,
  onRefresh,
  onLoadMore,
  onLoadReport,
  onCompareAgainstActive,
  onDeleteAnalysis,
  onPurgeAccountData,
  onOpenAddAudio,
}: SavedMixHistoryDrawerProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);
  const [purgingAll, setPurgingAll] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmDeleteId(null);
      setConfirmPurgeAll(false);
      return;
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  const handleConfirmPurge = async () => {
    if (!onPurgeAccountData) return;
    setPurgingAll(true);
    try {
      await onPurgeAccountData();
      setConfirmPurgeAll(false);
    } finally {
      setPurgingAll(false);
    }
  };

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
            className="no-print fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
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
            className="no-print fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[480px] flex-col border-l border-[var(--border-hairline)] bg-[var(--bg-canvas)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center bg-[var(--studio-mint-soft)] text-[var(--studio-mint)] squircle-inner">
                  <History className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
                    Saved Mix History
                  </h2>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Reload past AnalysisReport v1.0 telemetry or compare v1 → v2
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {onOpenAddAudio && (
                  <button
                    type="button"
                    data-testid="history-add-audio-btn"
                    onClick={() => {
                      onClose();
                      onOpenAddAudio();
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-[4px] border border-[#14171F] dark:border-[#F0B44C] bg-[#F0B44C] px-2.5 text-[11px] font-extrabold text-[#111318] transition-colors hover:bg-[#F5C451] cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5 stroke-[2.75]" aria-hidden="true" />
                    Add Audio
                  </button>
                )}
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={isLoading}
                  aria-label="Refresh saved mix history"
                  className="inline-flex h-8 w-8 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--text-primary)] squircle-inner cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Saved Mix History"
                  className="inline-flex h-8 w-8 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--text-primary)] squircle-inner cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {isLoading && analyses.length === 0 ? (
                <div className="bg-[var(--bg-elevated)] p-5 text-center text-xs text-[var(--text-secondary)] hairline-border squircle-inner">
                  Loading saved mix telemetry...
                </div>
              ) : analyses.length === 0 ? (
                <div className="bg-[var(--bg-elevated)] p-6 text-center hairline-border squircle-inner space-y-2">
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    No saved analyses yet
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Analyze an uploaded mix or revision while signed in and your structured AnalysisReport v1.0 telemetry will appear here automatically.
                  </p>
                </div>
              ) : (
                <>
                  {analyses.map((row) => {
                    const rep = row.report_json;
                    const canCompare =
                      Boolean(activeReport) && activeReport?.report_id !== rep.report_id;
                    const confirming = confirmDeleteId === row.id;

                    return (
                      <div
                        key={row.id}
                        className="bg-[var(--bg-elevated)] p-4 hairline-border squircle-inner space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                                {row.track_name}
                              </span>
                              <span className="rounded-md bg-[var(--studio-mint-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--studio-mint)] tabular-telemetry">
                                {row.version_label}
                              </span>
                              {row.parent_analysis_id && (
                                <span className="rounded-md bg-[var(--bg-inset)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                                  Linked v1
                                </span>
                              )}
                              {row.proxy_storage_path && (
                                <span className="rounded-md bg-[var(--studio-mint-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--studio-mint)]">
                                  Audio Proxy
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)]">
                              {row.genre} · {row.stage.replaceAll("_", " ")} ·{" "}
                              {new Date(row.created_at).toLocaleDateString()}
                            </div>
                          </div>

                          {confirming ? (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmDeleteId(null);
                                  onDeleteAnalysis(row.id, row.proxy_storage_path);
                                }}
                                className="bg-[var(--studio-vermilion)] px-2 py-1 text-[10px] font-semibold text-[#0B0D11] squircle-inner cursor-pointer hover:brightness-110"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="bg-[var(--bg-inset)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] squircle-inner cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(row.id)}
                              aria-label={`Delete saved analysis ${row.track_name}`}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--studio-vermilion-soft)] hover:text-[var(--studio-vermilion)] squircle-inner cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-primary)] tabular-telemetry">
                          <span className="bg-[var(--bg-inset)] px-2 py-0.5 squircle-inner">
                            {rep.global_metrics.integrated_lufs.toFixed(1)} LUFS
                          </span>
                          <span className="bg-[var(--bg-inset)] px-2 py-0.5 squircle-inner">
                            {rep.global_metrics.true_peak_dbtp >= 0 ? "+" : ""}
                            {rep.global_metrics.true_peak_dbtp.toFixed(2)} dBTP
                          </span>
                          <span className="bg-[var(--bg-inset)] px-2 py-0.5 squircle-inner">
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
                              onLoadReport(row);
                              onClose();
                            }}
                          >
                            <FolderOpen className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
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
                              <GitCompare className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                              Compare vs Open Mix
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {hasMore && onLoadMore && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      disabled={isLoading}
                      onClick={onLoadMore}
                    >
                      {isLoading ? "Loading more..." : "Load More Saved Mixes"}
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Account Data Purge Control (Privacy & Isolation Guarantee) */}
            {onPurgeAccountData && (
              <div className="border-t border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-4">
                {confirmPurgeAll ? (
                  <div className="space-y-2.5 rounded-xl border border-[var(--studio-vermilion)]/40 bg-[var(--studio-vermilion-soft)] p-3 text-xs">
                    <div className="flex items-start gap-2 text-[var(--studio-vermilion)]">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p className="leading-snug">
                        Permanently delete all your saved analyses and uploaded audio proxies from cloud storage? This cannot be undone.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={purgingAll}
                        onClick={() => void handleConfirmPurge()}
                      >
                        {purgingAll ? "Deleting…" : "Confirm Permanent Purge"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={purgingAll}
                        onClick={() => setConfirmPurgeAll(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="purge-account-data-btn"
                    onClick={() => setConfirmPurgeAll(true)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--studio-vermilion)]/35 bg-[var(--studio-vermilion-soft)] px-3 py-2 text-xs font-semibold text-[var(--studio-vermilion)] transition-colors hover:bg-[var(--studio-vermilion)] hover:text-[#0B0D11] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Delete My Account Data &amp; Audio Proxies
                  </button>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

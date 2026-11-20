"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, Music4, Sparkles, Upload, X } from "lucide-react";
import { MAX_SINGLE_FILE_BYTES } from "@/components/UploadStage";
import { STUDIO_EASE, TACTILE_TAP } from "@/lib/motion";
import type { GenreType, StageType } from "@/types/report";

const GENRE_OPTIONS: { value: GenreType; label: string }[] = [
  { value: "electronic", label: "Electronic / Dance" },
  { value: "pop", label: "Pop / Modern Vocal" },
  { value: "hip_hop", label: "Hip-Hop / Trap" },
  { value: "rock", label: "Rock / Indie" },
  { value: "acoustic", label: "Acoustic / Folk / Jazz" },
  { value: "ambient", label: "Ambient / Film" },
  { value: "other", label: "Other / Experimental" },
];

interface AddAudioModalProps {
  open: boolean;
  onClose: () => void;
  genre: GenreType;
  onGenreChange: (g: GenreType) => void;
  stage: StageType;
  onStageChange: (s: StageType) => void;
  isAnalyzing: boolean;
  onAnalyzeFile: (file: File) => void | Promise<void>;
  onLoadDemo: () => void | Promise<void>;
}

export function AddAudioModal({
  open,
  onClose,
  genre,
  onGenreChange,
  stage,
  onStageChange,
  isAnalyzing,
  onAnalyzeFile,
  onLoadDemo,
}: AddAudioModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDragging(false);
      setLocalError(null);
      return;
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const validateAndSubmit = (file: File) => {
    setLocalError(null);
    if (file.size > MAX_SINGLE_FILE_BYTES) {
      setLocalError("File exceeds the 50 MB single-file upload limit.");
      return;
    }
    onClose();
    void onAnalyzeFile(file);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="add-audio-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: STUDIO_EASE }}
            onClick={onClose}
            className="no-print fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
          />
          <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="add-audio-dialog"
              data-testid="add-audio-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Add or analyze an audio mix"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 6 }}
              transition={{ duration: 0.18, ease: STUDIO_EASE }}
              className="pointer-events-auto w-full max-w-lg rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xl"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-[#F0B44C] text-[#111318]">
                    <Music4 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-sm font-bold text-[var(--text-primary)]">
                      Add Audio to Studio
                    </h2>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      Upload a stereo mix or load our flawed sample track
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Add Audio modal"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-[var(--text-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-4 p-5">
                {/* Drag & Drop File Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) validateAndSubmit(file);
                  }}
                  className={`flex flex-col items-center justify-center gap-3 rounded-[6px] border border-dashed p-6 text-center transition-colors ${
                    dragging
                      ? "border-[#F0B44C] bg-[var(--studio-yellow-soft)]"
                      : "border-[var(--border-strong)] bg-[var(--bg-inset)]"
                  }`}
                >
                  <Upload className="h-6 w-6 text-[#F0B44C]" aria-hidden="true" />
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      Drop WAV, FLAC, AIFF, MP3, or M4A here
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Up to 50 MB · Cached locally in IndexedDB &amp; synced privately to your vault
                    </p>
                  </div>

                  <input
                    ref={inputRef}
                    type="file"
                    aria-label="Choose audio file to analyze"
                    accept=".wav,.flac,.mp3,.aiff,.aif,.ogg,.m4a,.aac,audio/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) validateAndSubmit(file);
                    }}
                  />

                  <motion.button
                    type="button"
                    whileTap={TACTILE_TAP}
                    disabled={isAnalyzing}
                    onClick={() => inputRef.current?.click()}
                    className="inline-flex h-9 items-center gap-2 rounded-[4px] border border-[#14171F] bg-[#F0B44C] px-4 text-xs font-extrabold uppercase tracking-[0.06em] text-[#111318] transition-colors hover:bg-[#F5C451] disabled:opacity-50 cursor-pointer"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    Choose Audio File
                  </motion.button>
                </div>

                {localError && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 rounded-[4px] border border-[var(--studio-vermilion)]/40 bg-[var(--studio-vermilion-soft)] px-3 py-2 text-xs text-[var(--studio-vermilion)]"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{localError}</span>
                  </div>
                )}

                {/* Quick Genre & Stage Context */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs">
                    <span className="block font-semibold text-[var(--text-secondary)]">
                      Genre Target
                    </span>
                    <select
                      value={genre}
                      onChange={(e) => onGenreChange(e.target.value as GenreType)}
                      className="h-9 w-full rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[#F0B44C] focus:outline-none"
                    >
                      {GENRE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-1 text-xs">
                    <span className="block font-semibold text-[var(--text-secondary)]">
                      Mix Stage
                    </span>
                    <div className="grid grid-cols-2 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5">
                      {(
                        [
                          { id: "unmastered_mix", label: "Unmastered" },
                          { id: "final_master", label: "Master" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onStageChange(opt.id)}
                          className={`h-8 rounded-[3px] text-[11px] font-bold transition-colors cursor-pointer ${
                            stage === opt.id
                              ? "bg-[#F0B44C] text-[#111318]"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Quick Sample Track Loader */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] pt-4">
                  <div className="text-xs text-[var(--text-secondary)]">
                    Want to test the live meters right away?
                  </div>
                  <motion.button
                    type="button"
                    whileTap={TACTILE_TAP}
                    disabled={isAnalyzing}
                    onClick={() => {
                      onClose();
                      void onLoadDemo();
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-3 text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[#38D39F] hover:text-[var(--studio-mint)] disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                    Load Sample Mix
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

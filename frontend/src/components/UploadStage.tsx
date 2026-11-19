"use client";

import React, { useRef, useState } from "react";
import { motion } from "motion/react";
import {
  AlertCircle,
  FolderOpen,
  History,
  PlayCircle,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
} from "lucide-react";
import { DspStepTracker } from "@/components/studio/DspStepTracker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STUDIO_EASE, STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import type { SavedAnalysisRecord } from "@/lib/supabase/storage";
import type { HealthStatus } from "@/components/StudioHeader";
import type { AnalysisReport, ArtistVisionTag, GenreType, StageType } from "@/types/report";

export const MAX_SINGLE_FILE_MB = 50;
export const MAX_SINGLE_FILE_BYTES = MAX_SINGLE_FILE_MB * 1024 * 1024;

const ACCEPTED_EXTENSIONS = new Set([
  ".wav",
  ".flac",
  ".mp3",
  ".aiff",
  ".aif",
  ".ogg",
  ".m4a",
  ".aac",
]);
const ACCEPTED_MIMES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/flac",
  "audio/x-flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/aiff",
  "audio/x-aiff",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
]);

const GENRE_OPTIONS: { value: GenreType; label: string }[] = [
  { value: "electronic", label: "Electronic / Dance" },
  { value: "pop", label: "Pop / Modern Vocal" },
  { value: "hip_hop", label: "Hip-Hop / Trap" },
  { value: "rock", label: "Rock / Indie" },
  { value: "acoustic", label: "Acoustic / Folk / Jazz" },
  { value: "ambient", label: "Ambient / Film" },
  { value: "other", label: "Other / Experimental" },
];

const VISION_OPTIONS: { value: ArtistVisionTag; label: string; hint: string }[] = [
  { value: "punchy", label: "Punchy", hint: "Preserve drum/vocal transient snap" },
  { value: "warm", label: "Warm", hint: "Full low-mids, relaxed top-end" },
  { value: "aggressive", label: "Aggressive", hint: "Dense harmonic drive & energy" },
  { value: "wide", label: "Wide", hint: "Expansive stereo field above 200 Hz" },
  { value: "dynamic", label: "Dynamic", hint: "Wide LRA & expressive peaks" },
];

interface UploadStageProps {
  genre: GenreType;
  onGenreChange: (g: GenreType) => void;
  stage: StageType;
  onStageChange: (s: StageType) => void;
  artistVision: ArtistVisionTag[];
  onToggleVision: (tag: ArtistVisionTag) => void;
  isAnalyzing: boolean;
  activeStepIndex: number;
  uploadProgress?: number | null;
  onCancelUpload?: () => void;
  errorMessage: string | null;
  healthStatus: HealthStatus;
  onRetryHealth: () => void;
  onAnalyzeFile: (file: File) => void;
  onLoadDemo: () => void;
  savedAnalyses?: SavedAnalysisRecord[];
  onLoadSavedReport?: (report: AnalysisReport) => void;
  onOpenHistory?: () => void;
}

export function UploadStage({
  genre,
  onGenreChange,
  stage,
  onStageChange,
  artistVision,
  onToggleVision,
  isAnalyzing,
  activeStepIndex,
  uploadProgress = null,
  onCancelUpload,
  errorMessage,
  healthStatus,
  onRetryHealth,
  onAnalyzeFile,
  onLoadDemo,
  savedAnalyses = [],
  onLoadSavedReport,
  onOpenHistory,
}: UploadStageProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [clientSizeError, setClientSizeError] = useState<string | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const extMatch = file.name.toLowerCase().match(/\.[a-z0-9]+$/);
    const ext = extMatch ? extMatch[0] : "";
    const mime = (file.type || "").toLowerCase();

    if (
      !ACCEPTED_EXTENSIONS.has(ext) &&
      !(mime && (ACCEPTED_MIMES.has(mime) || mime.startsWith("audio/")))
    ) {
      setClientSizeError(
        `"${file.name}" is not a supported audio format. Upload WAV, FLAC, MP3, AIFF, OGG, M4A, or AAC.`
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    if (file.size > MAX_SINGLE_FILE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setClientSizeError(
        `"${file.name}" is ${sizeMb} MB, exceeding the ${MAX_SINGLE_FILE_MB} MB single-file upload limit. Export a shorter section or lossless FLAC/AAC under ${MAX_SINGLE_FILE_MB} MB.`
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setClientSizeError(null);
    if (inputRef.current) inputRef.current.value = "";
    onAnalyzeFile(file);
  };

  const displayedError = clientSizeError || errorMessage;
  const uploadingPct =
    typeof uploadProgress === "number" ? Math.max(0, Math.min(100, uploadProgress)) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6 sm:py-8">
      {/* Focused Production Studio Intake Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border-hairline)] pb-5">
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-[var(--text-primary)] sm:text-3xl">
            Diagnose your mix before it leaves your DAW
          </h1>
          <p className="max-w-[64ch] text-sm text-[var(--text-secondary)]">
            Configure genre context and drop a stereo WAV, FLAC, MP3, or AIFF up to 50 MB for
            deterministic ITU-R BS.1770 loudness, 4x True Peak, and 20–120 Hz phase telemetry.
          </p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
          <span>Zero Audio Sent by Default</span>
        </div>
      </div>

      {/* Context Controls: Genre, Stage, Artist Vision */}
      <div className="grid gap-4 bg-[var(--bg-elevated)] p-5 hairline-border squircle-outer sm:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[var(--text-primary)]">
            Musical Genre Context
          </label>
          <Select value={genre} onValueChange={(v) => onGenreChange(v as GenreType)}>
            <SelectTrigger aria-label="Musical Genre">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENRE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-[var(--text-secondary)]">
            Contextualizes spectral &amp; loudness envelopes without altering measured DSP figures.
          </p>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-semibold text-[var(--text-primary)]">
            Production Stage
          </span>
          <div className="grid grid-cols-2 gap-1.5 rounded-[12px] bg-[var(--bg-inset)] p-1 hairline-border">
            {(
              [
                { id: "unmastered_mix", label: "Unmastered Mix" },
                { id: "final_master", label: "Final Master" },
              ] as const
            ).map((item) => {
              const active = stage === item.id;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={() => onStageChange(item.id)}
                  className={`relative z-10 rounded-[8px] px-3 py-2 text-xs font-medium cursor-pointer ${
                    active
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="stage-selector-pill"
                      transition={STUDIO_SPRING}
                      className="absolute inset-0 -z-10 rounded-[8px] bg-[var(--bg-elevated)] hairline-border"
                    />
                  )}
                  {item.label}
                </motion.button>
              );
            })}
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            {stage === "unmastered_mix"
              ? "Checks for -6 to -3 dBTP headroom before mastering."
              : "Checks streaming normalization & <= -1.0 dBTP ceiling."}
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Artist Vision Profile (Optional — shapes coaching, never hides clipping)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {VISION_OPTIONS.map((tag) => {
              const selected = artistVision.includes(tag.value);
              return (
                <motion.button
                  key={tag.value}
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={() => onToggleVision(tag.value)}
                  title={tag.hint}
                  aria-pressed={selected}
                  className={`px-3 py-1.5 text-xs font-medium squircle-inner transition-colors cursor-pointer ${
                    selected
                      ? "bg-[var(--studio-mint-soft)] text-[var(--studio-mint)] active-hairline-border"
                      : "bg-[var(--bg-inset)] text-[var(--text-secondary)] hairline-border hover:text-[var(--text-primary)]"
                  }`}
                >
                  {tag.label}
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Squircle Dropzone / Live 5-Stage DspStepTracker */}
      <motion.div
        animate={{ scale: isDragging ? 1.006 : 1 }}
        transition={STUDIO_SPRING}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`relative flex flex-col items-center justify-center bg-[var(--bg-elevated)] px-5 py-10 text-center squircle-outer transition-colors duration-150 ${
          isDragging
            ? "active-hairline-border bg-[var(--studio-mint-soft)]"
            : "hairline-border hover:border-[var(--border-active)]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".wav,.flac,.mp3,.aiff,.aif,.ogg,.m4a,.aac,audio/*"
          className="sr-only"
          aria-label="Upload stereo mix audio file"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {isAnalyzing ? (
          <div className="w-full text-left">
            <DspStepTracker
              activeStageIndex={activeStepIndex}
              uploadPercent={uploadingPct}
              statusLabel={
                uploadingPct !== null && uploadingPct < 100
                  ? `Uploading Stereo Mixdown (${uploadingPct}%)`
                  : "Running Deterministic DSP Pipeline"
              }
              onCancel={onCancelUpload}
            />
          </div>
        ) : (
          <motion.div
            key="idle"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: STUDIO_EASE }}
            className="flex flex-col items-center"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center bg-[var(--studio-mint-soft)] text-[var(--studio-mint)] squircle-inner">
              <UploadCloud className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="text-base font-semibold text-[var(--text-primary)]">
              Drop your mixdown here or browse files
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              WAV · FLAC · AIFF · MP3 · OGG · M4A · Native sample rates preserved (44.1 / 48 / 96 kHz)
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button type="button" variant="primary" onClick={() => inputRef.current?.click()}>
                Choose Mix File
              </Button>
              <Button
                type="button"
                variant="soft"
                onClick={() => {
                  setClientSizeError(null);
                  onLoadDemo();
                }}
              >
                <PlayCircle className="h-4 w-4 text-[var(--studio-mint)]" aria-hidden="true" />
                Try Sample Flawed Mix
              </Button>
            </div>
            <p className="mt-3 max-w-md text-[11px] text-[var(--text-secondary)]">
              &ldquo;Try Sample Flawed Mix&rdquo; loads a 12s 44.1 kHz stereo track with hot clipping
              peaks (~0.0 dBTP), 250 Hz low-mid buildup, and partial sub phase inversion to test A/B
              &amp; v1 → v2 immediately.
            </p>
          </motion.div>
        )}

        {healthStatus === "waking" && !displayedError && (
          <div
            role="status"
            className="mt-5 flex max-w-lg items-start gap-2 bg-[var(--studio-amber-soft)] px-4 py-3 text-left text-xs text-[var(--studio-amber)] border border-[var(--studio-amber)]/30 squircle-inner"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Waking DSP Engine… Drop your mix now for an instant Local Web Audio Preview while the
              Precision DSP server boots.
            </span>
          </div>
        )}

        {healthStatus === "offline" && !displayedError && (
          <div
            role="status"
            className="mt-5 flex max-w-lg flex-wrap items-center justify-between gap-2 bg-[var(--studio-amber-soft)] px-4 py-3 text-left text-xs text-[var(--studio-amber)] border border-[var(--studio-amber)]/30 squircle-inner"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                DSP backend is unreachable — uploading a file will run a Browser-Native Local Web
                Audio Preview automatically.
              </span>
            </div>
            <button
              type="button"
              onClick={onRetryHealth}
              className="bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)] hairline-border squircle-inner cursor-pointer hover:border-[var(--studio-mint)]"
            >
              Retry
            </button>
          </div>
        )}

        {displayedError && (
          <div
            role="alert"
            className="mt-5 flex max-w-lg items-start gap-2 bg-[var(--studio-vermilion-soft)] px-4 py-3 text-left text-xs text-[var(--studio-vermilion)] border border-[var(--studio-vermilion)]/35 squircle-inner"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{displayedError}</span>
          </div>
        )}
      </motion.div>

      {savedAnalyses.length > 0 && onLoadSavedReport && (
        <div className="bg-[var(--bg-elevated)] p-5 hairline-border squircle-outer space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <History className="h-4 w-4 text-[var(--studio-mint)]" aria-hidden="true" />
              <span>Recent Saved Mix History</span>
            </div>
            {onOpenHistory && (
              <button
                type="button"
                onClick={onOpenHistory}
                className="text-xs font-medium text-[var(--studio-mint)] hover:underline cursor-pointer"
              >
                View all ({savedAnalyses.length})
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {savedAnalyses.slice(0, 3).map((item) => {
              const m = item.report_json.global_metrics;
              return (
                <div
                  key={item.id}
                  className="flex flex-col justify-between gap-2.5 bg-[var(--bg-inset)] p-3.5 hairline-border squircle-inner"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                        {item.track_name}
                      </span>
                      <span className="rounded-md bg-[var(--studio-mint-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--studio-mint)] tabular-telemetry">
                        {item.version_label}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] tabular-telemetry">
                      {m.integrated_lufs.toFixed(1)} LUFS ·{" "}
                      {m.true_peak_dbtp >= 0 ? "+" : ""}
                      {m.true_peak_dbtp.toFixed(2)} dBTP
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onLoadSavedReport(item.report_json)}
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                    Reload Report
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

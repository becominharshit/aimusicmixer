"use client";

import React, { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { UploadCloud, PlayCircle, AlertCircle, CheckCircle2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STUDIO_EASE, STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import type { HealthStatus } from "@/components/StudioHeader";
import type { ArtistVisionTag, GenreType, StageType } from "@/types/report";

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

const ANALYSIS_STEPS = [
  "Validating audio container & native sample rate via ffprobe",
  "Measuring ITU-R BS.1770 LUFS, LRA & 4x oversampled True Peak",
  "Mapping 6-band spectral tilt & rolling stereo phase correlation",
  "Evaluating genre, stage & artist-vision diagnostic evidence",
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
  errorMessage: string | null;
  healthStatus: HealthStatus;
  onRetryHealth: () => void;
  onAnalyzeFile: (file: File) => void;
  onLoadDemo: () => void;
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
  errorMessage,
  healthStatus,
  onRetryHealth,
  onAnalyzeFile,
  onLoadDemo,
}: UploadStageProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onAnalyzeFile(files[0]);
  };

  return (
    <section className="mx-auto max-w-4xl py-6 sm:py-10">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#182220] sm:text-3xl">
          Diagnose your mix before it leaves your DAW
        </h1>
        <p className="max-w-[68ch] text-sm text-[#52605D] sm:text-base">
          Upload a stereo mixdown (WAV, FLAC, MP3, AIFF, OGG up to 100 MB). Deterministic ITU-R BS.1770 loudness,
          4x True Peak, and 6-band balance run locally on ephemeral session storage—never sent to AI training.
        </p>
      </div>

      {/* Context Controls: Genre, Stage, Artist Vision */}
      <div className="mb-5 grid gap-4 bg-[#FFFFFF] p-5 hairline-border squircle-outer sm:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[#182220]">
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
          <p className="text-xs text-[#52605D]">
            Contextualizes spectral &amp; loudness guidance without altering measured DSP numbers.
          </p>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-semibold text-[#182220]">
            Production Stage
          </span>
          <div className="grid grid-cols-2 gap-1.5 bg-[#F5F5F7] p-1 hairline-border squircle-inner">
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
                  className={`relative z-10 px-3 py-2 text-xs font-medium squircle-inner cursor-pointer ${
                    active ? "text-[#182220]" : "text-[#52605D] hover:text-[#182220]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="stage-selector-pill"
                      transition={STUDIO_SPRING}
                      className="absolute inset-0 -z-10 bg-[#FFFFFF] hairline-border squircle-inner"
                    />
                  )}
                  {item.label}
                </motion.button>
              );
            })}
          </div>
          <p className="text-xs text-[#52605D]">
            {stage === "unmastered_mix"
              ? "Checks for -6 to -3 dBTP headroom before mastering."
              : "Checks streaming normalization & <= -1.0 dBTP ceiling."}
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
            <span className="text-xs font-semibold text-[#182220]">
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
                      ? "bg-[#EBF3F1] text-[#182220] active-hairline-border"
                      : "bg-[#F5F5F7] text-[#52605D] hairline-border hover:text-[#182220]"
                  }`}
                >
                  {tag.label}
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Squircle Dropzone */}
      <motion.div
        animate={{ scale: isDragging ? 1.008 : 1 }}
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
        className={`relative flex flex-col items-center justify-center bg-[#FFFFFF] px-6 py-12 text-center squircle-outer transition-colors duration-150 ${
          isDragging
            ? "active-hairline-border bg-[#EBF3F1]/40"
            : "hairline-border hover:border-[rgba(58,114,105,0.28)]"
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

        <AnimatePresence mode="wait">
          {isAnalyzing ? (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: STUDIO_EASE }}
              className="w-full max-w-md space-y-3 text-left"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#182220]">
                  Running Deterministic DSP Pipeline
                </span>
                <span className="text-xs text-[#3A7269] tabular-telemetry">
                  Step {Math.min(activeStepIndex + 1, ANALYSIS_STEPS.length)} / {ANALYSIS_STEPS.length}
                </span>
              </div>
              <div className="space-y-2">
                {ANALYSIS_STEPS.map((label, idx) => {
                  const done = idx < activeStepIndex;
                  const current = idx === activeStepIndex;
                  return (
                    <div
                      key={label}
                      className={`flex items-center gap-2.5 px-3 py-2 text-xs squircle-inner transition-colors ${
                        current
                          ? "bg-[#EBF3F1] text-[#182220] active-hairline-border font-medium"
                          : done
                            ? "bg-[#F5F5F7] text-[#15803D]"
                            : "bg-[#FAFAFA] text-[#52605D]"
                      }`}
                    >
                      <CheckCircle2
                        className={`h-3.5 w-3.5 shrink-0 ${
                          done ? "text-[#15803D]" : current ? "text-[#3A7269]" : "text-[#52605D]/40"
                        }`}
                        aria-hidden="true"
                      />
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: STUDIO_EASE }}
              className="flex flex-col items-center"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center bg-[#EBF3F1] text-[#3A7269] squircle-inner">
                <UploadCloud className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="text-base font-semibold text-[#182220]">
                Drop your mixdown here or browse files
              </p>
              <p className="mt-1 text-xs text-[#52605D]">
                WAV · FLAC · AIFF · MP3 · OGG · Native sample rates preserved (44.1 / 48 / 96 kHz)
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => inputRef.current?.click()}
                >
                  Choose Mix File
                </Button>
                <Button
                  type="button"
                  variant="soft"
                  onClick={onLoadDemo}
                >
                  <PlayCircle className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
                  Try Sample Flawed Mix
                </Button>
              </div>
              <p className="mt-3 max-w-md text-[11px] text-[#52605D]">
                &ldquo;Try Sample Flawed Mix&rdquo; loads a 12s 44.1 kHz stereo track with hot clipping peaks (~0.0 dBTP),
                250 Hz low-mid buildup, and partial sub phase inversion so you can test A/B &amp; v1 &rarr; v2 right away.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {healthStatus === "waking" && !errorMessage && (
          <div
            role="status"
            className="mt-5 flex max-w-lg items-start gap-2 bg-[#FEF7EC] px-4 py-3 text-left text-xs text-[#B45309] border border-[rgba(180,83,9,0.22)] squircle-inner"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Waking DSP Engine (~45s)… The backend container is spinning up and will connect automatically.
            </span>
          </div>
        )}

        {healthStatus === "offline" && !errorMessage && (
          <div
            role="status"
            className="mt-5 flex max-w-lg flex-wrap items-center justify-between gap-2 bg-[#FEF7EC] px-4 py-3 text-left text-xs text-[#B45309] border border-[rgba(180,83,9,0.22)] squircle-inner"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Python DSP backend is currently unreachable. Start the FastAPI server or click the header status pill to inspect your API URL.
              </span>
            </div>
            <button
              type="button"
              onClick={onRetryHealth}
              className="bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#182220] hairline-border squircle-inner cursor-pointer hover:bg-[#F5F5F7]"
            >
              Retry
            </button>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-5 flex max-w-lg items-start gap-2 bg-[#FFF1F3] px-4 py-3 text-left text-xs text-[#BE123C] border border-[rgba(190,18,60,0.22)] squircle-inner"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}
      </motion.div>
    </section>
  );
}

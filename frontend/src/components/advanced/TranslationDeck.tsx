"use client";

import React, { useRef } from "react";
import { motion } from "motion/react";
import {
  Pause,
  Play,
  Repeat,
  Upload,
  Smartphone,
  Laptop,
  Speaker,
  Scale,
  Sparkles,
} from "lucide-react";
import type { AudioSourceSlot, DeviceProfile, StereoMode } from "@/audio/StudioAudioEngine";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import type { ReferenceTrackMeta } from "@/types/report";

interface TranslationDeckProps {
  isPlaying: boolean;
  activeSource: AudioSourceSlot;
  stereoMode: StereoMode;
  deviceProfile: DeviceProfile;
  matchLoudness: boolean;
  loudnessOffsetDb: number;
  loopEnabled: boolean;
  hasReference: boolean;
  hasRevised: boolean;
  referenceMeta: ReferenceTrackMeta | null;
  isUploadingRef: boolean;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onChangeSource: (slot: AudioSourceSlot) => void;
  onChangeStereo: (mode: StereoMode) => void;
  onChangeDevice: (profile: DeviceProfile) => void;
  onToggleMatchLoudness: (val: boolean) => void;
  onUploadReference: (file: File) => void;
  onLoadDemoReference: () => void;
}

export function TranslationDeck({
  isPlaying,
  activeSource,
  stereoMode,
  deviceProfile,
  matchLoudness,
  loudnessOffsetDb,
  loopEnabled,
  hasReference,
  hasRevised,
  referenceMeta,
  isUploadingRef,
  onTogglePlay,
  onToggleLoop,
  onChangeSource,
  onChangeStereo,
  onChangeDevice,
  onToggleMatchLoudness,
  onUploadReference,
  onLoadDemoReference,
}: TranslationDeckProps) {
  const refInput = useRef<HTMLInputElement | null>(null);

  const sources: { id: AudioSourceSlot; label: string; enabled: boolean }[] = [
    { id: "primary", label: "Mix A", enabled: true },
    { id: "reference", label: "Reference B", enabled: hasReference },
    { id: "revised", label: "Mix v2", enabled: hasRevised },
  ];

  const devices: { id: DeviceProfile; label: string; sub: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "full", label: "Full Range", sub: "Flat bypass", icon: Speaker },
    { id: "smartphone", label: "Smartphone", sub: "280 Hz–11 kHz · Mono", icon: Smartphone },
    { id: "laptop", label: "Laptop", sub: "160 Hz–14 kHz · Narrow", icon: Laptop },
  ];

  return (
    <div className="bg-[#FFFFFF] p-5 hairline-border squircle-outer space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Transport + Loop */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="button" variant="primary" onClick={onTogglePlay}>
            {isPlaying ? (
              <>
                <Pause className="h-4 w-4" aria-hidden="true" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4" aria-hidden="true" />
                Play
              </>
            )}
          </Button>
          <Button
            type="button"
            variant={loopEnabled ? "soft" : "secondary"}
            onClick={onToggleLoop}
            aria-pressed={loopEnabled}
          >
            <Repeat className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
            {loopEnabled ? "Looping Window" : "Loop Region"}
          </Button>
        </div>

        {/* A / B / v2 Source Deck */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative inline-flex items-center bg-[#F5F5F7] p-1 hairline-border squircle-inner">
            {sources.map((src) => {
              const active = activeSource === src.id;
              return (
                <motion.button
                  key={src.id}
                  type="button"
                  disabled={!src.enabled}
                  whileTap={src.enabled ? TACTILE_TAP : undefined}
                  onClick={() => onChangeSource(src.id)}
                  className={`relative z-10 px-3 py-1.5 text-xs font-medium squircle-inner transition-colors ${
                    !src.enabled
                      ? "cursor-not-allowed text-[#52605D]/40"
                      : active
                        ? "cursor-pointer text-[#182220]"
                        : "cursor-pointer text-[#52605D] hover:text-[#182220]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="ab-source-pill"
                      transition={STUDIO_SPRING}
                      className="absolute inset-0 -z-10 bg-[#FFFFFF] hairline-border squircle-inner"
                    />
                  )}
                  {src.label}
                </motion.button>
              );
            })}
          </div>

          <input
            ref={refInput}
            type="file"
            accept=".wav,.flac,.mp3,.aiff,.aif,.ogg,.m4a"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.[0]) onUploadReference(e.target.files[0]);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isUploadingRef}
            onClick={() => refInput.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
            {hasReference ? "Swap Ref" : "Add Reference"}
          </Button>
          {!hasReference && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isUploadingRef}
              onClick={onLoadDemoReference}
            >
              <Sparkles className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
              Demo Ref
            </Button>
          )}
        </div>
      </div>

      {/* Stereo Mode + Device Translation Lab */}
      <div className="grid gap-3 border-t border-[rgba(24,34,32,0.06)] pt-4 lg:grid-cols-12">
        <div className="space-y-1.5 lg:col-span-4">
          <div className="text-xs font-semibold text-[#182220]">
            Stereo Fold (15 ms click-free)
          </div>
          <div className="relative grid grid-cols-2 bg-[#F5F5F7] p-1 hairline-border squircle-inner">
            {(
              [
                { id: "stereo", label: "Stereo L / R" },
                { id: "mono", label: "Mono (0.5L + 0.5R)" },
              ] as const
            ).map((opt) => {
              const active = stereoMode === opt.id;
              return (
                <motion.button
                  key={opt.id}
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={() => onChangeStereo(opt.id)}
                  className={`relative z-10 px-2.5 py-1.5 text-xs font-medium squircle-inner cursor-pointer ${
                    active ? "text-[#182220]" : "text-[#52605D] hover:text-[#182220]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="stereo-fold-pill"
                      transition={STUDIO_SPRING}
                      className="absolute inset-0 -z-10 bg-[#FFFFFF] hairline-border squircle-inner"
                    />
                  )}
                  {opt.label}
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#182220]">
              Mix Translation Lab
            </span>
            <span className="text-[11px] text-[#52605D]">
              Educational BiquadFilterNode approximation (not a literal hardware model)
            </span>
          </div>
          <div className="relative grid grid-cols-1 gap-1 bg-[#F5F5F7] p-1 hairline-border squircle-inner sm:grid-cols-3">
            {devices.map((dev) => {
              const active = deviceProfile === dev.id;
              const DevIcon = dev.icon;
              return (
                <motion.button
                  key={dev.id}
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={() => onChangeDevice(dev.id)}
                  className={`relative z-10 flex items-center justify-start gap-2 px-3 py-1.5 text-left squircle-inner cursor-pointer sm:justify-center sm:px-2.5 ${
                    active ? "text-[#182220]" : "text-[#52605D] hover:text-[#182220]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="device-lab-pill"
                      transition={STUDIO_SPRING}
                      className="absolute inset-0 -z-10 bg-[#FFFFFF] hairline-border squircle-inner"
                    />
                  )}
                  <DevIcon className="h-3.5 w-3.5 shrink-0 text-[#3A7269]" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{dev.label}</div>
                    <div className="truncate text-[10px] text-[#52605D]">{dev.sub}</div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Loudness Matching Status */}
      {(hasReference || hasRevised) && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F5F5F7] px-3.5 py-2.5 text-xs squircle-inner">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-[#3A7269]" aria-hidden="true" />
            <span className="font-medium text-[#182220]">
              Integrated-LUFS Level Match
            </span>
            {referenceMeta && (
              <span className="text-[#52605D] tabular-telemetry">
                Ref: {referenceMeta.reference_filename} ({referenceMeta.integrated_lufs.toFixed(1)} LUFS)
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[#52605D] tabular-telemetry">
              Active trim: {loudnessOffsetDb >= 0 ? "+" : ""}
              {loudnessOffsetDb.toFixed(1)} dB
            </span>
            <Switch
              checked={matchLoudness}
              onCheckedChange={onToggleMatchLoudness}
              aria-label="Toggle LUFS loudness matching"
            />
          </div>
        </div>
      )}
    </div>
  );
}

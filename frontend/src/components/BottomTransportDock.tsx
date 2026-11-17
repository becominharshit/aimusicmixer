"use client";

import React, { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Laptop, Pause, Play, Repeat, Scale, Smartphone, Speaker } from "lucide-react";
import {
  studioAudioEngine,
  type AudioSourceSlot,
  type DeviceProfile,
  type StereoMode,
} from "@/audio/StudioAudioEngine";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { STUDIO_SPRING, TACTILE_TAP } from "@/lib/motion";
import { formatTimecode } from "@/lib/utils";

interface BottomTransportDockProps {
  durationSec: number;
  isPlaying: boolean;
  activeSource: AudioSourceSlot;
  stereoMode: StereoMode;
  deviceProfile: DeviceProfile;
  matchLoudness: boolean;
  loudnessOffsetDb: number;
  loopEnabled: boolean;
  hasReference: boolean;
  hasRevised: boolean;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onSeek: (timeSec: number) => void;
  onChangeSource: (slot: AudioSourceSlot) => void;
  onChangeStereo: (mode: StereoMode) => void;
  onChangeDevice: (profile: DeviceProfile) => void;
  onToggleMatchLoudness: (val: boolean) => void;
}

export function BottomTransportDock({
  durationSec,
  isPlaying,
  activeSource,
  stereoMode,
  deviceProfile,
  matchLoudness,
  loudnessOffsetDb,
  loopEnabled,
  hasReference,
  hasRevised,
  onTogglePlay,
  onToggleLoop,
  onSeek,
  onChangeSource,
  onChangeStereo,
  onChangeDevice,
  onToggleMatchLoudness,
}: BottomTransportDockProps) {
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const timecodeRef = useRef<HTMLSpanElement | null>(null);

  // Decoupled 60fps RAF loop updates playhead bar & tabular timestamp with zero React state ticks
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const cur = studioAudioEngine.getCurrentTimeSec();
      const dur = durationSec || studioAudioEngine.getDurationSec() || 1;
      const pct = Math.max(0, Math.min(1, cur / dur));

      if (progressBarRef.current) {
        progressBarRef.current.style.transform = `scaleX(${pct})`;
      }
      if (timecodeRef.current) {
        timecodeRef.current.textContent = `${formatTimecode(cur, true)} / ${formatTimecode(dur, true)}`;
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [durationSec]);

  const sources: { id: AudioSourceSlot; label: string; enabled: boolean }[] = [
    { id: "primary", label: "Mix A", enabled: true },
    { id: "reference", label: "Ref B", enabled: hasReference },
    { id: "revised", label: "Mix v2", enabled: hasRevised },
  ];

  const devices: {
    id: DeviceProfile;
    label: string;
    sub: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: "full", label: "Full Range", sub: "Flat bypass", icon: Speaker },
    { id: "smartphone", label: "Smartphone", sub: "300Hz–4.5kHz · Mono", icon: Smartphone },
    { id: "laptop", label: "Laptop", sub: "180Hz–12kHz", icon: Laptop },
  ];

  return (
    <div
      role="region"
      aria-label="Persistent MixBench Transport and Mix Translation Lab"
      className="sticky bottom-0 left-0 right-0 z-30 border-t border-[rgba(24,34,32,0.08)] bg-[#FFFFFF]/95 backdrop-blur-md"
    >
      {/* Top 60fps interactive progress hairline */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Transport seek bar"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={0}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(rect.width, 1)));
          onSeek(ratio * durationSec);
        }}
        className="relative h-1.5 w-full cursor-pointer bg-[#F5F5F7]"
      >
        <div
          ref={progressBarRef}
          className="h-full w-full origin-left bg-[#3A7269]"
          style={{ transform: "scaleX(0)", willChange: "transform" }}
        />
      </div>

      <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6 sm:py-2.5">
        {/* Left: Transport + Timecode + Loop */}
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" size="sm" onClick={onTogglePlay}>
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Play
              </>
            )}
          </Button>
          <span
            ref={timecodeRef}
            className="min-w-[106px] bg-[#F5F5F7] px-2.5 py-1 text-center text-xs font-medium text-[#182220] tabular-telemetry squircle-inner"
          >
            00:00.0 / {formatTimecode(durationSec, true)}
          </span>
          <Button
            type="button"
            variant={loopEnabled ? "soft" : "secondary"}
            size="sm"
            onClick={onToggleLoop}
            aria-pressed={loopEnabled}
            title="Loop selected window"
          >
            <Repeat className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
            <span className="hidden sm:inline">{loopEnabled ? "Looping" : "Loop"}</span>
          </Button>
        </div>

        {/* Center: Click-Free A/B Source + LUFS Match + Mono Fold */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative inline-flex items-center bg-[#F5F5F7] p-0.5 hairline-border squircle-inner">
            {sources.map((src) => {
              const active = activeSource === src.id;
              return (
                <motion.button
                  key={src.id}
                  type="button"
                  disabled={!src.enabled}
                  whileTap={src.enabled ? TACTILE_TAP : undefined}
                  onClick={() => onChangeSource(src.id)}
                  className={`relative z-10 px-2.5 py-1 text-[11px] font-medium squircle-inner ${
                    !src.enabled
                      ? "cursor-not-allowed text-[#52605D]/40"
                      : active
                        ? "cursor-pointer text-[#182220]"
                        : "cursor-pointer text-[#52605D] hover:text-[#182220]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-source-pill"
                      transition={STUDIO_SPRING}
                      className="absolute inset-0 -z-10 bg-[#FFFFFF] hairline-border squircle-inner"
                    />
                  )}
                  {src.label}
                </motion.button>
              );
            })}
          </div>

          {(hasReference || hasRevised) && (
            <div className="inline-flex items-center gap-1.5 bg-[#F5F5F7] px-2.5 py-1 text-[11px] hairline-border squircle-inner">
              <Scale className="h-3 w-3 text-[#3A7269]" aria-hidden="true" />
              <span className="text-[#182220] font-medium">Match LUFS</span>
              <span className="text-[#52605D] tabular-telemetry">
                {loudnessOffsetDb >= 0 ? "+" : ""}
                {loudnessOffsetDb.toFixed(1)} dB
              </span>
              <Switch
                checked={matchLoudness}
                onCheckedChange={onToggleMatchLoudness}
                aria-label="Toggle LUFS loudness matching"
              />
            </div>
          )}

          {/* Stereo <-> Equal-power Mono Fold */}
          <div className="relative inline-flex items-center bg-[#F5F5F7] p-0.5 hairline-border squircle-inner">
            {(
              [
                { id: "stereo", label: "Stereo" },
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
                  className={`relative z-10 px-2.5 py-1 text-[11px] font-medium squircle-inner cursor-pointer ${
                    active ? "text-[#182220]" : "text-[#52605D] hover:text-[#182220]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-stereo-pill"
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

        {/* Right: Approximate Generic Mix Translation Lab */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative inline-flex items-center bg-[#F5F5F7] p-0.5 hairline-border squircle-inner">
            {devices.map((dev) => {
              const active = deviceProfile === dev.id;
              const DevIcon = dev.icon;
              return (
                <motion.button
                  key={dev.id}
                  type="button"
                  whileTap={TACTILE_TAP}
                  onClick={() => onChangeDevice(dev.id)}
                  title={`${dev.label} (${dev.sub}) — Approximate generic translation check`}
                  className={`relative z-10 inline-flex items-center gap-1.5 px-2.5 py-1 text-left squircle-inner cursor-pointer ${
                    active ? "text-[#182220]" : "text-[#52605D] hover:text-[#182220]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-device-pill"
                      transition={STUDIO_SPRING}
                      className="absolute inset-0 -z-10 bg-[#FFFFFF] hairline-border squircle-inner"
                    />
                  )}
                  <DevIcon className="h-3 w-3 shrink-0 text-[#3A7269]" aria-hidden="true" />
                  <span className="text-[11px] font-medium">{dev.label}</span>
                  <span className="hidden text-[10px] text-[#52605D] xl:inline">
                    {dev.sub}
                  </span>
                </motion.button>
              );
            })}
          </div>
          <span className="hidden text-[10px] text-[#52605D] 2xl:inline">
            Approximate generic translation checks
          </span>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Laptop, Pause, Play, Repeat, Scale, Smartphone, Speaker, Wand2 } from "lucide-react";
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
  autoFixEnabled?: boolean;
  canAutoFix?: boolean;
  hasPrimary?: boolean;
  hasReference: boolean;
  hasRevised: boolean;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onToggleAutoFix?: () => void;
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
  autoFixEnabled = false,
  canAutoFix = false,
  hasPrimary = true,
  hasReference,
  hasRevised,
  onTogglePlay,
  onToggleLoop,
  onToggleAutoFix,
  onSeek,
  onChangeSource,
  onChangeStereo,
  onChangeDevice,
  onToggleMatchLoudness,
}: BottomTransportDockProps) {
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const timecodeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable ||
          target.getAttribute("role") === "textbox"
        ) {
          return;
        }
      }

      if (e.code === "Space") {
        if (target && (target.tagName === "BUTTON" || target.getAttribute("role") === "switch")) {
          return;
        }
        e.preventDefault();
        if (hasPrimary) onTogglePlay();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        onChangeStereo(stereoMode === "mono" ? "stereo" : "mono");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasPrimary, onTogglePlay, onChangeStereo, stereoMode]);

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
    { id: "primary", label: "Mix A", enabled: hasPrimary },
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
    { id: "laptop", label: "Laptop", sub: "150Hz–8kHz", icon: Laptop },
  ];

  return (
    <div
      role="region"
      data-testid="bottom-transport-dock"
      aria-label="Persistent MixBench Transport and Mix Translation Lab"
      className="no-print sticky bottom-0 left-0 right-0 z-30 border-t border-[var(--border-hairline)] bg-[var(--bg-elevated)]/95 backdrop-blur-md"
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
        className="relative h-1.5 w-full cursor-pointer bg-[var(--bg-inset)]"
      >
        <div
          ref={progressBarRef}
          className="h-full w-full origin-left bg-[var(--studio-mint)]"
          style={{ transform: "scaleX(0)", willChange: "transform" }}
        />
      </div>

      <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6 sm:py-2.5">
        {/* Left: Transport + Timecode + Loop Problem Window + Auto-Fix Preview */}
        <div className="flex max-w-full flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!hasPrimary}
            title="Spacebar to play / pause"
            onClick={onTogglePlay}
            className="shrink-0 whitespace-nowrap"
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Play
              </>
            )}
          </Button>
          <span
            ref={timecodeRef}
            className="min-w-[96px] shrink-0 whitespace-nowrap bg-[var(--bg-inset)] px-2 py-1 text-center text-[11px] font-medium text-[var(--text-primary)] tabular-telemetry squircle-inner sm:min-w-[106px] sm:px-2.5 sm:text-xs"
          >
            00:00.0 / {formatTimecode(durationSec, true)}
          </span>
          <Button
            type="button"
            variant={loopEnabled ? "soft" : "secondary"}
            size="sm"
            disabled={!hasPrimary}
            onClick={onToggleLoop}
            aria-pressed={loopEnabled}
            title="Loop selected problem window"
            className="shrink-0 whitespace-nowrap sm:min-w-[128px] justify-center"
          >
            <Repeat className="h-3.5 w-3.5 shrink-0 text-[var(--studio-mint)]" aria-hidden="true" />
            <span className="hidden sm:inline">{loopEnabled ? "Looping Window" : "Loop Window"}</span>
          </Button>
          {onToggleAutoFix && (
            <Button
              type="button"
              data-testid="dock-autofix-btn"
              variant={autoFixEnabled ? "primary" : "secondary"}
              size="sm"
              disabled={!hasPrimary || !canAutoFix}
              onClick={onToggleAutoFix}
              aria-pressed={autoFixEnabled}
              title="Non-destructive preview: engages corrective EQ bands + <100 Hz M/S mono-maker into -0.3 dBFS safety limiter"
              className="shrink-0 whitespace-nowrap"
            >
              <Wand2
                className={`h-3.5 w-3.5 shrink-0 ${autoFixEnabled ? "text-[#0B0D11]" : "text-[var(--studio-mint)]"}`}
                aria-hidden="true"
              />
              <span className="sm:hidden">{autoFixEnabled ? "Fix On" : "Auto-Fix"}</span>
              <span className="hidden sm:inline">
                {autoFixEnabled ? "Auto-Fix On" : "Auto-Fix Preview"}
              </span>
            </Button>
          )}
        </div>

        {/* Center: Click-Free A/B Source + LUFS Match + Mono Fold */}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div
            data-testid="dock-source-group"
            className="relative inline-flex max-w-full shrink-0 flex-nowrap items-center gap-1 overflow-x-auto bg-[var(--bg-inset)] p-0.5 hairline-border squircle-inner"
          >
            {sources.map((src) => {
              const active = activeSource === src.id;
              return (
                <motion.button
                  key={src.id}
                  type="button"
                  disabled={!src.enabled}
                  whileTap={src.enabled ? TACTILE_TAP : undefined}
                  onClick={() => onChangeSource(src.id)}
                  className={`relative z-10 shrink-0 whitespace-nowrap px-2.5 py-1 text-[11px] font-medium squircle-inner ${
                    !src.enabled
                      ? "cursor-not-allowed text-[var(--text-muted)]/50"
                      : active
                        ? "cursor-pointer text-[var(--text-primary)]"
                        : "cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-source-pill"
                      transition={STUDIO_SPRING}
                      className="pointer-events-none absolute inset-0 -z-10 bg-[var(--bg-elevated)] hairline-border squircle-inner"
                    />
                  )}
                  {src.label}
                </motion.button>
              );
            })}
          </div>

          {(hasReference || hasRevised) && (
            <div className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--bg-inset)] px-2.5 py-1 text-[11px] hairline-border squircle-inner">
              <Scale className="h-3 w-3 shrink-0 text-[var(--studio-mint)]" aria-hidden="true" />
              <span className="font-medium text-[var(--text-primary)]">Match LUFS</span>
              <span className="text-[var(--text-secondary)] tabular-telemetry">
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

          {/* Stereo <-> Mono Fold (Keyboard shortcut: M) */}
          <div
            data-testid="dock-stereo-group"
            className="relative inline-flex max-w-full shrink-0 flex-nowrap items-center gap-1 overflow-x-auto bg-[var(--bg-inset)] p-0.5 hairline-border squircle-inner"
          >
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
                  title="Keyboard shortcut: M"
                  onClick={() => onChangeStereo(opt.id)}
                  className={`relative z-10 shrink-0 whitespace-nowrap px-2.5 py-1 text-[11px] font-medium squircle-inner cursor-pointer ${
                    active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-stereo-pill"
                      transition={STUDIO_SPRING}
                      className="pointer-events-none absolute inset-0 -z-10 bg-[var(--bg-elevated)] hairline-border squircle-inner"
                    />
                  )}
                  {opt.label}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Right: Approximate Generic Mix Translation Lab */}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div
            data-testid="dock-device-group"
            className="relative inline-flex max-w-full shrink-0 flex-nowrap items-center gap-1 overflow-x-auto bg-[var(--bg-inset)] p-0.5 hairline-border squircle-inner"
          >
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
                  className={`relative z-10 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-left squircle-inner cursor-pointer ${
                    active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-device-pill"
                      transition={STUDIO_SPRING}
                      className="pointer-events-none absolute inset-0 -z-10 bg-[var(--bg-elevated)] hairline-border squircle-inner"
                    />
                  )}
                  <DevIcon className="h-3 w-3 shrink-0 text-[var(--studio-mint)]" aria-hidden="true" />
                  <span className="text-[11px] font-medium">{dev.label}</span>
                  <span className="hidden text-[10px] text-[var(--text-secondary)] xl:inline">
                    {dev.sub}
                  </span>
                </motion.button>
              );
            })}
          </div>
          <span className="hidden text-[10px] text-[var(--text-secondary)] 2xl:inline">
            Approximate generic translation checks
          </span>
        </div>
      </div>
    </div>
  );
}

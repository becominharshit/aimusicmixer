"use client";

import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Headphones,
  Laptop,
  Pause,
  Play,
  Repeat,
  Scale,
  Smartphone,
  Sparkles,
} from "lucide-react";
import {
  studioAudioEngine,
  type AudioSourceSlot,
  type DeviceProfile,
  type StereoMode,
} from "@/audio/StudioAudioEngine";
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
  onSeek: (sec: number) => void;
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
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      setCurrentTime(studioAudioEngine.getCurrentTimeSec());
      if (studioAudioEngine.getState().isPlaying) {
        raf = requestAnimationFrame(update);
      }
    };
    update();
    if (isPlaying) {
      raf = requestAnimationFrame(update);
    }
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, activeSource, loopEnabled]);

  const effectiveDur = Math.max(0.1, durationSec || studioAudioEngine.getDurationSec() || 1);
  const progressPct = Math.min(100, (currentTime / effectiveDur) * 100);

  return (
    <div
      role="region"
      aria-label="Persistent Mixit Transport and Device Translation Lab"
      className="no-print sticky bottom-0 z-30 w-full border-t border-[var(--border-hairline)] bg-[var(--bg-canvas)]/96 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2.5 px-3 py-2.5 sm:px-5 lg:flex-nowrap">
        {/* Playback + Seek Cluster */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-[230px] sm:gap-2.5">
          <motion.button
            type="button"
            whileTap={hasPrimary ? TACTILE_TAP : undefined}
            disabled={!hasPrimary}
            onClick={onTogglePlay}
            aria-label={isPlaying ? "Pause mix" : "Play mix"}
            data-testid="dock-play-btn"
            title={
              hasPrimary
                ? "Play / Pause (Space)"
                : "No playable audio attached for this archived report"
            }
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
              hasPrimary
                ? "border-[#14171F] dark:border-[#F0B44C] bg-[#F0B44C] text-[#111318] hover:bg-[#F5C451] cursor-pointer"
                : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-muted)] cursor-not-allowed"
            }`}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </motion.button>

          <motion.button
            type="button"
            whileTap={hasPrimary ? TACTILE_TAP : undefined}
            disabled={!hasPrimary}
            onClick={onToggleLoop}
            aria-pressed={loopEnabled}
            aria-label="Toggle Loop Selection"
            title="Toggle Loop Selection (L)"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
              !hasPrimary
                ? "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-muted)] cursor-not-allowed"
                : loopEnabled
                  ? "border-[var(--studio-mint)] bg-[var(--studio-mint-soft)] text-[var(--studio-mint)] cursor-pointer"
                  : "border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            }`}
          >
            <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
          </motion.button>

          <div className="flex min-w-[115px] flex-1 items-center gap-2">
            <span className="whitespace-nowrap text-[11px] font-semibold text-[var(--text-primary)] tabular-telemetry">
              {formatTimecode(currentTime)}
            </span>
            <input
              type="range"
              aria-label="Seek audio position"
              disabled={!hasPrimary}
              min={0}
              max={effectiveDur}
              step={0.1}
              value={Math.min(currentTime, effectiveDur)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCurrentTime(v);
                onSeek(v);
              }}
              style={{
                background: `linear-gradient(to right, var(--studio-yellow) ${progressPct}%, var(--border-strong) ${progressPct}%)`,
              }}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[var(--studio-yellow)] disabled:cursor-not-allowed disabled:opacity-40"
            />
            <span className="whitespace-nowrap text-[11px] text-[var(--text-muted)] tabular-telemetry">
              {formatTimecode(effectiveDur)}
            </span>
          </div>
        </div>

        {/* Source Switcher + Loudness Match + Auto-Fix Preview */}
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <div
            data-testid="dock-source-group"
            className="inline-flex shrink-0 flex-nowrap items-center gap-0.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5"
            role="group"
            aria-label="Audio source A/B switcher"
          >
            {(
              [
                { id: "primary", label: "My Mix", enabled: hasPrimary },
                { id: "reference", label: "Reference", enabled: hasReference },
                { id: "revised", label: "Revised v2", enabled: hasRevised },
              ] as const
            ).map((src) => {
              const active = activeSource === src.id;
              return (
                <button
                  key={src.id}
                  type="button"
                  disabled={!src.enabled}
                  onClick={() => onChangeSource(src.id)}
                  className={`relative z-10 inline-flex shrink-0 items-center whitespace-nowrap rounded-[3px] px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    active
                      ? "text-[#111318]"
                      : src.enabled
                        ? "text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        : "text-[var(--text-muted)] opacity-45 cursor-not-allowed"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-source-pill"
                      transition={STUDIO_SPRING}
                      className="pointer-events-none absolute inset-0 -z-10 rounded-[3px] bg-[#F0B44C]"
                    />
                  )}
                  <span>{src.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onToggleMatchLoudness(!matchLoudness)}
            aria-pressed={matchLoudness}
            title="Match playback loudness to primary mix LUFS so louder tracks do not sound artificially better"
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-2.5 py-1.5 text-[11px] font-bold cursor-pointer transition-colors ${
              matchLoudness
                ? "border-[var(--studio-mint)] bg-[var(--studio-mint-soft)] text-[var(--studio-mint)]"
                : "border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
            }`}
          >
            <Scale className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Match LUFS</span>
            {activeSource !== "primary" && matchLoudness && (
              <span className="tabular-telemetry">
                ({loudnessOffsetDb >= 0 ? "+" : ""}
                {loudnessOffsetDb.toFixed(1)} dB)
              </span>
            )}
          </button>

          {onToggleAutoFix && (
            <motion.button
              type="button"
              whileTap={hasPrimary && canAutoFix ? TACTILE_TAP : undefined}
              disabled={!hasPrimary || !canAutoFix}
              onClick={onToggleAutoFix}
              aria-pressed={autoFixEnabled}
              data-testid="dock-autofix-btn"
              title={
                !hasPrimary
                  ? "Audio buffer required for Auto-Fix Preview"
                  : !canAutoFix
                    ? "No corrective tonal/phase defects active on this mix"
                    : "Non-destructive Web Audio preview: applies measured corrective EQ bands plus <100 Hz M/S sub-bass mono-maker"
              }
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                !hasPrimary || !canAutoFix
                  ? "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                  : autoFixEnabled
                    ? "border-[var(--studio-mint)] bg-[var(--studio-mint)] text-[#111318] cursor-pointer"
                    : "border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[#F0B44C] hover:text-[#F0B44C] cursor-pointer"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{autoFixEnabled ? "Auto-Fix ON" : "Auto-Fix Preview"}</span>
            </motion.button>
          )}
        </div>

        {/* Stereo / Mono + Device Translation Lab */}
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <div
            data-testid="dock-stereo-group"
            className="inline-flex shrink-0 flex-nowrap items-center gap-0.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5"
            role="group"
            aria-label="Stereo or Mono fold"
          >
            {(["stereo", "mono"] as const).map((s) => {
              const active = stereoMode === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChangeStereo(s)}
                  className={`relative z-10 inline-flex shrink-0 items-center whitespace-nowrap rounded-[3px] px-2.5 py-1 text-[11px] font-bold capitalize cursor-pointer transition-colors ${
                    active
                      ? "text-[#111318]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-stereo-pill"
                      transition={STUDIO_SPRING}
                      className="pointer-events-none absolute inset-0 -z-10 rounded-[3px] bg-[#F0B44C]"
                    />
                  )}
                  <span>{s}</span>
                </button>
              );
            })}
          </div>

          <div
            data-testid="dock-device-group"
            className="inline-flex shrink-0 flex-nowrap items-center gap-0.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5"
            role="group"
            aria-label="Device Translation Lab"
          >
            {(
              [
                { id: "full", label: "Full Range", sub: "", icon: Headphones },
                { id: "smartphone", label: "Smartphone", sub: "300Hz–4.5kHz · Mono", icon: Smartphone },
                { id: "laptop", label: "Laptop", sub: "150Hz–8kHz", icon: Laptop },
              ] as const
            ).map((dev) => {
              const active = deviceProfile === dev.id;
              const Icon = dev.icon;
              return (
                <button
                  key={dev.id}
                  type="button"
                  onClick={() => onChangeDevice(dev.id)}
                  title={dev.sub ? `${dev.label} (${dev.sub})` : dev.label}
                  className={`relative z-10 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[3px] px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-colors ${
                    active
                      ? "text-[#111318]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-device-pill"
                      transition={STUDIO_SPRING}
                      className="pointer-events-none absolute inset-0 -z-10 rounded-[3px] bg-[#F0B44C]"
                    />
                  )}
                  <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{dev.label}</span>
                  {dev.sub && (
                    <span
                      className={`hidden 2xl:inline text-[10px] tabular-telemetry ${
                        active ? "text-[#111318]/80" : "text-[var(--text-muted)]"
                      }`}
                    >
                      ({dev.sub})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

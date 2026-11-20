"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { motion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Copy,
  Download,
  FileAudio,
  FolderOpen,
  HelpCircle,
  Layers,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Repeat,
  Save,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Upload,
  User as UserIcon,
  X,
} from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";
import { KeyboardShortcutsModal } from "@/components/shared/KeyboardShortcutsModal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TACTILE_TAP } from "@/lib/motion";
import {
  consumePendingStudioToDawHandoff,
  hasPendingStudioToDawHandoff,
  setPendingDawMixdown,
  type StudioToDawHandoff,
} from "@/lib/pendingDawMixdown";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getCurrentStudioTheme, toggleStudioTheme } from "@/lib/theme";
import {
  CHAIN_MASTER,
  CHAIN_RETURN_A,
  CHAIN_RETURN_B,
  FADER_MAX_DB,
  FADER_MIN_DB,
  INPUT_GAIN_MAX_DB,
  INPUT_GAIN_MIN_DB,
  PLUGIN_CATEGORIES,
  PLUGIN_REGISTRY,
  createSupabaseProjectAdapter,
  setDefaultDawController,
  triggerDownload,
  useDawController,
  useDawMeters,
  useDawProjectSelector,
  type ChainId,
  type DawActions,
  type DawController,
  type ProjectSummary,
  type ReturnState,
  type TrackState,
} from "../index";
import { DawCanvasMeter } from "./DawCanvasMeter";
import { DawDeviceRack } from "./DawDeviceRack";

type MainDawView = "arrangement" | "mixer";

function formatDawClock(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, "0")}:${rem.toFixed(1).padStart(4, "0")}`;
}

function formatFaderDb(db: number): string {
  if (db <= FADER_MIN_DB + 0.5) return "-∞";
  return `${db > 0 ? "+" : ""}${db.toFixed(1)}`;
}

/** Zero-re-render 60 fps timecode readout driven directly inside useDawMeters. */
function TransportTimecode({
  durationSec,
  controller,
}: {
  durationSec: number;
  controller: DawController;
}) {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const durRef = useRef(durationSec);
  durRef.current = durationSec;

  useDawMeters((frame) => {
    if (spanRef.current) {
      spanRef.current.textContent = `${formatDawClock(frame.positionSec)} / ${formatDawClock(durRef.current)}`;
    }
  }, controller);

  return (
    <span
      ref={spanRef}
      data-testid="daw-timecode"
      className="min-w-[116px] shrink-0 whitespace-nowrap border border-[var(--border-hairline)] bg-[#0A0A0A] px-2.5 py-1 text-center tabular-telemetry text-xs font-bold text-[#F0B44C]"
    >
      00:00.0 / {formatDawClock(durationSec)}
    </span>
  );
}

/** Zero-re-render 60 fps GPU playhead line over Arrangement tracks. */
function ArrangementPlayhead({
  durationSec,
  controller,
}: {
  durationSec: number;
  controller: DawController;
}) {
  const lineRef = useRef<HTMLDivElement | null>(null);
  const durRef = useRef(durationSec);
  durRef.current = Math.max(0.1, durationSec);

  useDawMeters((frame) => {
    const el = lineRef.current;
    if (!el || !el.parentElement) return;
    const width = el.parentElement.clientWidth;
    const pct = Math.max(0, Math.min(1, frame.positionSec / durRef.current));
    el.style.transform = `translateX(${(pct * width).toFixed(1)}px)`;
  }, controller);

  return (
    <div
      ref={lineRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-[2px] bg-[#F0B44C] will-change-transform"
      style={{ transform: "translateX(0px)" }}
    />
  );
}

/** Static HiDPI waveform canvas for an Arrangement track lane. */
function TrackWaveformLane({
  peaks,
  color = "#38D39F",
}: {
  peaks: number[];
  color?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(240, Math.floor(canvas.clientWidth || 600));
    const h = 52;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#0A0A0A";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    if (peaks.length === 0) return;
    const step = w / peaks.length;
    ctx.fillStyle = color;
    for (let i = 0; i < peaks.length; i += 1) {
      const amp = Math.max(0.02, Math.min(1, peaks[i] ?? 0));
      const barH = Math.max(2, amp * (h - 8));
      ctx.fillRect(i * step, (h - barH) * 0.5, Math.max(1, step - 0.35), barH);
    }
  }, [peaks, color]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Track audio waveform overview"
      className="block h-[52px] w-full bg-[#0A0A0A]"
    />
  );
}

/** Isolated per-track vertical Mixer Strip subscribed strictly via useDawProjectSelector. */
interface MixerTrackStripProps {
  trackId: string;
  selected: boolean;
  anySolo: boolean;
  isMissingAudio: boolean;
  controller: DawController;
  actions: DawActions;
  onSelect: () => void;
  onRelinkRequest: (trackId: string) => void;
}

function MixerTrackStrip({
  trackId,
  selected,
  anySolo,
  isMissingAudio,
  controller,
  actions,
  onSelect,
  onRelinkRequest,
}: MixerTrackStripProps) {
  const selector = useCallback(
    (p: { tracks: TrackState[] }) => p.tracks.find((t) => t.id === trackId),
    [trackId]
  );
  const track = useDawProjectSelector(selector, controller);
  if (!track) return null;

  const isAudible = !track.mute && (!anySolo || track.solo);

  return (
    <div
      data-testid={`daw-mixer-strip-${track.id}`}
      onClick={onSelect}
      className={`flex w-[152px] shrink-0 cursor-pointer flex-col border bg-[var(--bg-elevated)] transition-colors ${
        selected
          ? "border-[#F0B44C] ring-1 ring-[#F0B44C]"
          : "border-[var(--border-hairline)] hover:border-[var(--border-strong)]"
      }`}
    >
      {/* Strip Header */}
      <div
        className={`flex items-center justify-between gap-1 border-b px-2 py-1.5 ${
          selected
            ? "border-[#0A0A0A] bg-[#F0B44C] text-[#0A0A0A]"
            : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
        }`}
      >
        <span className="truncate text-[11px] font-extrabold uppercase" title={track.name}>
          {track.name}
        </span>
        <button
          type="button"
          aria-label={`Remove track ${track.name}`}
          onClick={(e) => {
            e.stopPropagation();
            actions.removeTrack(track.id);
          }}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center hover:text-[#EF6B63] cursor-pointer"
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      {isMissingAudio ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRelinkRequest(track.id);
          }}
          className="flex items-center justify-center gap-1 border-b border-[#EF6B63] bg-[#EF6B63]/15 px-2 py-1 text-[10px] font-bold uppercase text-[#EF6B63] hover:bg-[#EF6B63] hover:text-[#0A0A0A] cursor-pointer"
        >
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Relink Audio
        </button>
      ) : null}

      {/* Input Gain + Phase Invert */}
      <div className="space-y-2 border-b border-[var(--border-hairline)] p-2">
        <div className="flex items-center justify-between gap-1">
          <span className="tabular-telemetry text-[9px] font-bold uppercase text-[var(--text-muted)]">
            IN {track.inputGainDb > 0 ? "+" : ""}
            {track.inputGainDb.toFixed(1)} dB
          </span>
          <button
            type="button"
            aria-label={`Invert polarity on ${track.name}`}
            aria-pressed={track.phaseInvert}
            title="Phase / Polarity Invert (Ø)"
            onClick={(e) => {
              e.stopPropagation();
              actions.setTrackPhaseInvert(track.id, !track.phaseInvert);
            }}
            className={`h-5 border px-1.5 tabular-telemetry text-[10px] font-extrabold cursor-pointer ${
              track.phaseInvert
                ? "border-[#EF6B63] bg-[#EF6B63] text-[#0A0A0A]"
                : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)]"
            }`}
          >
            Ø
          </button>
        </div>
        <input
          type="range"
          aria-label={`Input gain for ${track.name}`}
          min={INPUT_GAIN_MIN_DB}
          max={INPUT_GAIN_MAX_DB}
          step={0.5}
          value={track.inputGainDb}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={() => actions.setTrackInputGain(track.id, 0)}
          onChange={(e) => actions.setTrackInputGain(track.id, Number.parseFloat(e.target.value))}
          className="h-1.5 w-full cursor-pointer accent-[#F0B44C]"
        />

        {/* Send A (Reverb) & Send B (Delay) */}
        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
          <div className="space-y-0.5">
            <div className="flex justify-between tabular-telemetry text-[9px] text-[var(--text-muted)]">
              <span>SND A</span>
              <span>{Math.round(track.sendA * 100)}%</span>
            </div>
            <input
              type="range"
              aria-label={`Reverb Send A for ${track.name}`}
              min={0}
              max={1}
              step={0.01}
              value={track.sendA}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                actions.setTrackSend(track.id, "A", Number.parseFloat(e.target.value))
              }
              className="h-1.5 w-full cursor-pointer accent-[#38BDF8]"
            />
          </div>
          <div className="space-y-0.5">
            <div className="flex justify-between tabular-telemetry text-[9px] text-[var(--text-muted)]">
              <span>SND B</span>
              <span>{Math.round(track.sendB * 100)}%</span>
            </div>
            <input
              type="range"
              aria-label={`Delay Send B for ${track.name}`}
              min={0}
              max={1}
              step={0.01}
              value={track.sendB}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                actions.setTrackSend(track.id, "B", Number.parseFloat(e.target.value))
              }
              className="h-1.5 w-full cursor-pointer accent-[#38D39F]"
            />
          </div>
        </div>
      </div>

      {/* Pan + Mute / Solo */}
      <div className="space-y-1.5 border-b border-[var(--border-hairline)] p-2">
        <div className="flex items-center justify-between tabular-telemetry text-[9px] font-bold text-[var(--text-muted)]">
          <span>PAN</span>
          <span className="text-[var(--text-primary)]">
            {Math.abs(track.pan) < 0.03
              ? "C"
              : track.pan < 0
                ? `${Math.round(Math.abs(track.pan) * 100)}L`
                : `${Math.round(track.pan * 100)}R`}
          </span>
        </div>
        <input
          type="range"
          aria-label={`Pan for ${track.name}`}
          min={-1}
          max={1}
          step={0.02}
          value={track.pan}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={() => actions.setTrackPan(track.id, 0)}
          onChange={(e) => actions.setTrackPan(track.id, Number.parseFloat(e.target.value))}
          className="h-1.5 w-full cursor-pointer accent-[#F0B44C]"
        />

        <div className="grid grid-cols-2 gap-1 pt-1">
          <button
            type="button"
            aria-label={`Mute ${track.name}`}
            aria-pressed={track.mute}
            onClick={(e) => {
              e.stopPropagation();
              actions.setTrackMute(track.id, !track.mute);
            }}
            className={`h-6 border tabular-telemetry text-[10px] font-extrabold cursor-pointer ${
              track.mute
                ? "border-[#EF6B63] bg-[#EF6B63] text-[#0A0A0A]"
                : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)]"
            }`}
          >
            M
          </button>
          <button
            type="button"
            aria-label={`Solo ${track.name}`}
            aria-pressed={track.solo}
            onClick={(e) => {
              e.stopPropagation();
              actions.setTrackSolo(track.id, !track.solo);
            }}
            className={`h-6 border tabular-telemetry text-[10px] font-extrabold cursor-pointer ${
              track.solo
                ? "border-[#0A0A0A] bg-[#F0B44C] text-[#0A0A0A]"
                : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)]"
            }`}
          >
            S
          </button>
        </div>
      </div>

      {/* Vertical Fader + 60 fps Stereo Canvas Meter */}
      <div className="flex flex-1 items-center justify-center gap-3 p-2.5">
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex h-[136px] w-7 items-center justify-center">
            <input
              type="range"
              aria-label={`Volume fader for ${track.name}`}
              min={FADER_MIN_DB}
              max={FADER_MAX_DB}
              step={0.5}
              value={track.faderDb}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={() => actions.setTrackFader(track.id, 0)}
              onChange={(e) => actions.setTrackFader(track.id, Number.parseFloat(e.target.value))}
              className="h-1.5 w-[130px] -rotate-90 cursor-pointer accent-[#F0B44C]"
            />
          </div>
          <span
            className={`tabular-telemetry text-[10px] font-bold ${
              isAudible ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] line-through"
            }`}
          >
            {formatFaderDb(track.faderDb)} dB
          </span>
        </div>

        <DawCanvasMeter
          target={{ kind: "track", trackId: track.id }}
          controller={controller}
          orientation="vertical"
          width={18}
          height={146}
          label={`${track.name} stereo peak meter`}
        />
      </div>

      <div className="border-t border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2 py-1 text-center tabular-telemetry text-[9px] text-[var(--text-muted)]">
        {track.inserts.length} FX
      </div>
    </div>
  );
}

/** Return A / Return B Strip */
function ReturnBusStrip({
  ret,
  selected,
  controller,
  actions,
  onSelect,
}: {
  ret: ReturnState;
  selected: boolean;
  controller: DawController;
  actions: DawActions;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex w-[124px] shrink-0 cursor-pointer flex-col border bg-[var(--bg-surface)] ${
        selected ? "border-[#F0B44C] ring-1 ring-[#F0B44C]" : "border-[var(--border-hairline)]"
      }`}
    >
      <div
        className={`border-b px-2 py-1.5 text-[11px] font-extrabold uppercase ${
          selected
            ? "border-[#0A0A0A] bg-[#F0B44C] text-[#0A0A0A]"
            : "border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[#38BDF8]"
        }`}
      >
        {ret.name}
      </div>

      <div className="border-b border-[var(--border-hairline)] p-2">
        <button
          type="button"
          aria-label={`Mute ${ret.name}`}
          aria-pressed={ret.mute}
          onClick={(e) => {
            e.stopPropagation();
            actions.setReturnMute(ret.id, !ret.mute);
          }}
          className={`h-6 w-full border tabular-telemetry text-[10px] font-extrabold cursor-pointer ${
            ret.mute
              ? "border-[#EF6B63] bg-[#EF6B63] text-[#0A0A0A]"
              : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)]"
          }`}
        >
          {ret.mute ? "MUTED" : "ACTIVE"}
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center gap-2.5 p-2.5">
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex h-[136px] w-7 items-center justify-center">
            <input
              type="range"
              aria-label={`Volume fader for ${ret.name}`}
              min={FADER_MIN_DB}
              max={FADER_MAX_DB}
              step={0.5}
              value={ret.faderDb}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={() => actions.setReturnFader(ret.id, 0)}
              onChange={(e) => actions.setReturnFader(ret.id, Number.parseFloat(e.target.value))}
              className="h-1.5 w-[130px] -rotate-90 cursor-pointer accent-[#38BDF8]"
            />
          </div>
          <span className="tabular-telemetry text-[10px] font-bold text-[var(--text-primary)]">
            {formatFaderDb(ret.faderDb)} dB
          </span>
        </div>

        <DawCanvasMeter
          target={{ kind: ret.id }}
          controller={controller}
          orientation="vertical"
          width={16}
          height={146}
          label={`${ret.name} stereo peak meter`}
        />
      </div>

      <div className="border-t border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2 py-1 text-center tabular-telemetry text-[9px] text-[var(--text-muted)]">
        {ret.inserts.length} FX
      </div>
    </div>
  );
}

const DAW_ONBOARDING_KEY = "mixit_daw_onboarding_dismissed_v1";

export function WebDawView() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [studioHandoffBanner, setStudioHandoffBanner] = useState<Pick<
    StudioToDawHandoff,
    "findingTitle" | "evidenceId" | "summary"
  > | null>(null);

  const [mainView, setMainView] = useState<MainDawView>("arrangement");
  const [browserOpen, setBrowserOpen] = useState(true);
  const [pluginQuery, setPluginQuery] = useState("");
  const [selectedChainId, setSelectedChainId] = useState<ChainId>(CHAIN_MASTER);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [isSendingToStudio, setIsSendingToStudio] = useState(false);
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [relinkTrackId, setRelinkTrackId] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const relinkInputRef = useRef<HTMLInputElement | null>(null);
  const consumedStudioHandoffRef = useRef(false);

  // Show lightweight 3-step Swiss onboarding callout on first visit to /daw
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(DAW_ONBOARDING_KEY)) {
        setShowOnboarding(true);
      }
    } catch {
      setShowOnboarding(true);
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try {
      window.localStorage.setItem(DAW_ONBOARDING_KEY, "1");
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Strict client-side Supabase auth gate mirroring /studio
  useEffect(() => {
    setIsDarkTheme(getCurrentStudioTheme() === "dark");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      router.replace("/?signin=1");
      return;
    }

    let active = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      const user = !error ? (data.user ?? null) : null;
      if (!user) {
        router.replace("/?signin=1");
        return;
      }
      setSupabaseUser(user);
      setAuthChecked(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session?.user) {
        router.replace(event === "SIGNED_OUT" ? "/" : "/?signin=1");
        return;
      }
      setSupabaseUser(session.user);
      setAuthChecked(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const dawOptions = useMemo(() => {
    const supabase = getSupabaseBrowserClient();
    return {
      adapter: supabase ? createSupabaseProjectAdapter(supabase) : undefined,
      onSendToAnalyzer: async (wavFile: File) => {
        setPendingDawMixdown(wavFile);
        router.push("/studio?from=daw");
      },
    };
  }, [router]);

  const daw = useDawController(dawOptions);
  const { snapshot, controller } = daw;
  const { project, transport, autosave, missingAudioTrackIds, export: exportState } = snapshot;

  // Keep onSendToAnalyzer callback fresh even if default controller was initialized earlier
  useEffect(() => {
    daw.setOnSendToAnalyzer(async (wavFile: File) => {
      setPendingDawMixdown(wavFile);
      router.push("/studio?from=daw");
    });
  }, [daw, router]);

  // Keep selectedChainId valid when tracks are added/removed
  useEffect(() => {
    if (
      selectedChainId === CHAIN_MASTER ||
      selectedChainId === CHAIN_RETURN_A ||
      selectedChainId === CHAIN_RETURN_B
    ) {
      return;
    }
    if (!project.tracks.some((t) => t.id === selectedChainId)) {
      setSelectedChainId(project.tracks[0]?.id ?? CHAIN_MASTER);
    }
  }, [project.tracks, selectedChainId]);

  // Reverse closed-loop handoff: consume /studio "Fix in Web DAW ↗" payload on mount
  useEffect(() => {
    if (!authChecked || !supabaseUser || !snapshot.ready || consumedStudioHandoffRef.current) {
      return;
    }
    if (!hasPendingStudioToDawHandoff()) return;
    const handoff = consumePendingStudioToDawHandoff();
    if (!handoff) return;
    consumedStudioHandoffRef.current = true;

    void (async () => {
      try {
        const trackId = await daw.importFile(handoff.file);
        const targetChain: ChainId =
          handoff.targetChain === "master" ? CHAIN_MASTER : trackId;
        if (
          handoff.suggestedPluginId === "master-limiter" &&
          targetChain === CHAIN_MASTER &&
          daw.controller.getSnapshot().project.master.limiter
        ) {
          const limiterId = daw.controller.getSnapshot().project.master.limiter.instanceId;
          daw.setPluginBypass(CHAIN_MASTER, limiterId, false);
          for (const [paramId, value] of Object.entries(handoff.suggestedParams)) {
            daw.setPluginParam(CHAIN_MASTER, limiterId, paramId, value);
          }
        } else {
          daw.addPlugin(targetChain, handoff.suggestedPluginId, undefined, handoff.suggestedParams);
        }
        setSelectedChainId(targetChain);
        setStudioHandoffBanner({
          findingTitle: handoff.findingTitle,
          evidenceId: handoff.evidenceId,
          summary: handoff.summary,
        });
      } catch {
        // Error surfaced in snapshot.error
      }
    })();
  }, [authChecked, daw, snapshot.ready, supabaseUser]);

  // Global DAW keyboard shortcuts: ? (Help), Space (Play/Pause), L (Loop toggle)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      if (e.code === "Space" && el?.tagName !== "BUTTON") {
        e.preventDefault();
        if (snapshot.ready && project.tracks.length > 0) {
          void daw.togglePlay();
        }
        return;
      }

      if ((e.key === "l" || e.key === "L") && snapshot.ready && project.tracks.length > 0) {
        e.preventDefault();
        const dur = Math.max(4, transport.durationSec || 0);
        const start = transport.loopStartSec || 0;
        const end =
          transport.loopEndSec > start + 0.25 ? transport.loopEndSec : dur;
        daw.setLoop(start, end, !transport.loopEnabled);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    daw,
    project.tracks.length,
    snapshot.ready,
    transport.durationSec,
    transport.loopEnabled,
    transport.loopEndSec,
    transport.loopStartSec,
  ]);

  const handleToggleTheme = () => {
    const next = toggleStudioTheme();
    setIsDarkTheme(next === "dark");
  };

  const handleSignOut = async () => {
    try {
      controller.pause();
      controller.dispose();
      setDefaultDawController(null);
    } catch {
      // Proceed with sign-out
    }
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.replace("/");
  };

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const trackId = await daw.importFile(file);
        setSelectedChainId(trackId);
      } catch {
        // Error surfaced in snapshot.error
      }
    }
    if (importInputRef.current) importInputRef.current.value = "";
  };

  const handleLoadSampleTrack = async () => {
    if (isLoadingDemo) return;
    setIsLoadingDemo(true);
    try {
      const res = await fetch("/demo/demo-flawed-v1.wav");
      if (!res.ok) throw new Error("Could not fetch sample WAV track.");
      const blob = await res.blob();
      const file = new File([blob], "demo-flawed-v1.wav", { type: "audio/wav" });
      const trackId = await daw.importFile(file);
      setSelectedChainId(trackId);
    } catch {
      // Surfacing via DAW error toast if import fails
    } finally {
      setIsLoadingDemo(false);
    }
  };

  const handleOpenProjectsModal = async () => {
    setProjectsOpen(true);
    setLoadingList(true);
    try {
      const list = await daw.listProjects();
      setSavedProjects(list);
    } catch {
      setSavedProjects([]);
    } finally {
      setLoadingList(false);
    }
  };

  const handleExportWav = async () => {
    if (project.tracks.length === 0) return;
    try {
      const res = await daw.exportMixdownWav({ bitDepth: 24 });
      triggerDownload(res.blob, res.fileName);
    } catch {
      // Error surfaced in snapshot.error
    }
  };

  const handleAnalyzeMix = async () => {
    if (project.tracks.length === 0 || isSendingToStudio) return;
    setIsSendingToStudio(true);
    try {
      await daw.sendMixdownToAnalyzer({ bitDepth: 24 });
    } catch {
      // Error surfaced in snapshot.error
    } finally {
      setIsSendingToStudio(false);
    }
  };

  const selectedChainMeta = useMemo(() => {
    if (selectedChainId === CHAIN_MASTER) {
      return {
        label: "MASTER BUS",
        inserts: project.master.inserts,
        masterLimiter: project.master.limiter,
      };
    }
    if (selectedChainId === CHAIN_RETURN_A) {
      return { label: project.returnA.name.toUpperCase(), inserts: project.returnA.inserts, masterLimiter: null };
    }
    if (selectedChainId === CHAIN_RETURN_B) {
      return { label: project.returnB.name.toUpperCase(), inserts: project.returnB.inserts, masterLimiter: null };
    }
    const found = project.tracks.find((t) => t.id === selectedChainId);
    if (found) {
      return { label: found.name.toUpperCase(), inserts: found.inserts, masterLimiter: null };
    }
    return {
      label: "MASTER BUS",
      inserts: project.master.inserts,
      masterLimiter: project.master.limiter,
    };
  }, [project, selectedChainId]);

  const anySolo = useMemo(() => project.tracks.some((t) => t.solo), [project.tracks]);
  const effectiveDuration = Math.max(12, transport.durationSec || 0);

  if (!authChecked || !supabaseUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-secondary)]">
        <div className="flex items-center gap-3 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-5 py-3 text-xs font-semibold">
          <span className="h-2 w-2 rounded-full bg-[#F0B44C] animate-pulse" />
          <span>Initializing Mixit Web DAW…</span>
        </div>
      </div>
    );
  }

  const autosaveLabel =
    autosave.status === "saving"
      ? "SAVING…"
      : autosave.status === "saved"
        ? "SAVED"
        : autosave.status === "error"
          ? "SAVE ERROR"
          : autosave.dirty
            ? "UNSAVED"
            : "IDLE";

  return (
    <div
      data-testid="web-daw-view"
      className="flex min-h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]"
    >
      {/* Hidden File Inputs for Audio Import & Missing Audio Relink */}
      <input
        ref={importInputRef}
        type="file"
        multiple
        accept=".wav,.wave,.mp3,.flac,.ogg,.oga,audio/*"
        className="sr-only"
        aria-label="Import audio tracks into Web DAW"
        onChange={(e) => void handleImportFiles(e.target.files)}
      />
      <input
        ref={relinkInputRef}
        type="file"
        accept=".wav,.wave,.mp3,.flac,.ogg,.oga,audio/*"
        className="sr-only"
        aria-label="Relink missing audio track"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file && relinkTrackId) {
            try {
              await daw.relinkTrackAudio(relinkTrackId, file);
            } catch {
              // Surfaced via snapshot.error
            }
          }
          setRelinkTrackId(null);
          if (relinkInputRef.current) relinkInputRef.current.value = "";
        }}
      />

      {/* Row 1 — Global Mixit Studio Navigation Header */}
      <header className="sticky top-0 z-40 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-2 px-3 sm:px-5">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Mixit Home" className="flex shrink-0 items-center">
              <span className="hidden sm:inline-flex">
                <MixitLogo variant="full" tone="auto" heightClass="h-6" />
              </span>
              <span className="inline-flex sm:hidden">
                <MixitLogo variant="mark" heightClass="h-7" />
              </span>
            </Link>

            <nav aria-label="Mixit studio workspaces" className="inline-flex items-center border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5">
              <Link
                href="/studio"
                className="px-3 py-1 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Console
              </Link>
              <Link
                href="/daw"
                aria-current="page"
                className="bg-[#F0B44C] px-3 py-1 text-xs font-extrabold uppercase tracking-[0.04em] text-[#0A0A0A]"
              >
                Web DAW
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              data-testid="shortcuts-help-btn"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className="inline-flex h-8 w-8 items-center justify-center border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:border-[#F0B44C] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              data-testid="theme-toggle"
              onClick={handleToggleTheme}
              aria-label={isDarkTheme ? "Switch to PAPER light mode" : "Switch to INK dark mode"}
              className="inline-flex h-8 items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 tabular-telemetry text-[11px] font-bold uppercase text-[var(--text-primary)] hover:border-[var(--border-active)] cursor-pointer"
            >
              {isDarkTheme ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-[#F0B44C]" aria-hidden="true" />
                  <span className="hidden md:inline">PAPER</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-[#0A0A0A]" aria-hidden="true" />
                  <span className="hidden md:inline">INK</span>
                </>
              )}
            </button>

            <Link
              href="/profile"
              aria-label="Open User Profile"
              className="inline-flex h-8 items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--border-active)]"
            >
              <UserIcon className="h-3.5 w-3.5 text-[#F0B44C]" aria-hidden="true" />
              <span className="hidden max-w-[120px] truncate lg:inline">{supabaseUser.email}</span>
            </Link>

            <button
              type="button"
              onClick={() => void handleSignOut()}
              aria-label="Sign out"
              className="inline-flex h-8 items-center gap-1 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:border-[#EF6B63] hover:text-[#EF6B63] cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* First-Time 3-Step Swiss Quick-Start Onboarding Callout */}
      {showOnboarding ? (
        <div
          data-testid="daw-onboarding-banner"
          role="region"
          aria-label="Web DAW Quick-Start Guide"
          className="border-b-[1.5px] border-[#0A0A0A] bg-[#F0B44C] px-3 py-2 text-[#0A0A0A] sm:px-5"
        >
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-bold">
              <span className="border border-[#0A0A0A] bg-[#0A0A0A] px-2 py-0.5 tabular-telemetry text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#F0B44C]">
                QUICK START
              </span>
              <span>
                1. Import Audio or Open Mix → 2. Add Plugins &amp; Toggle Delta Listen → 3. Click{" "}
                <span className="underline decoration-[1.5px] underline-offset-2">
                  Analyze Mix ↗
                </span>{" "}
                to Verify
              </span>
            </div>
            <button
              type="button"
              onClick={dismissOnboarding}
              aria-label="Dismiss Web DAW quick-start guide"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-[#0A0A0A] bg-[#FFFFFF] text-[#0A0A0A] transition-colors hover:bg-[#0A0A0A] hover:text-[#F0B44C] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Studio → Web DAW Pre-Loaded Fix Confirmation Banner */}
      {studioHandoffBanner ? (
        <div
          data-testid="daw-studio-handoff-banner"
          role="status"
          className="border-b border-[var(--border-hairline)] bg-[var(--studio-mint-soft)] px-3 py-2 text-xs text-[var(--text-primary)] sm:px-5"
        >
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--studio-mint)]" aria-hidden="true" />
              <span className="font-bold">Studio Fix Pre-Loaded:</span>
              <span>{studioHandoffBanner.findingTitle}</span>
              <span className="border border-[var(--studio-mint)]/40 bg-[var(--bg-elevated)] px-2 py-0.5 tabular-telemetry text-[10px] font-bold text-[var(--studio-mint)]">
                {studioHandoffBanner.summary}
              </span>
              <span className="text-[var(--text-secondary)]">
                Tweak below, toggle Δ Delta Listen, then click Analyze Mix ↗ to verify v2.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setStudioHandoffBanner(null)}
              aria-label="Dismiss studio fix banner"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Row 2 — Ableton-Inspired Top Transport & Project Bar */}
      <div
        data-testid="daw-transport-bar"
        className="border-b-[1.5px] border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 sm:px-5"
      >
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2.5">
          {/* Project Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              aria-label="Project name"
              value={project.name}
              onChange={(e) => daw.renameProject(e.target.value)}
              className="h-8 w-40 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-extrabold text-[var(--text-primary)] focus:border-[#F0B44C] focus:outline-none sm:w-48"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void daw.newProject("Untitled Mix")}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleOpenProjectsModal()}
            >
              <FolderOpen className="h-3.5 w-3.5 text-[#F0B44C]" aria-hidden="true" />
              Open
            </Button>
            <button
              type="button"
              onClick={() => void daw.saveNow()}
              aria-label={`Project auto-save status: ${autosaveLabel}. Click to save now`}
              className={`inline-flex h-8 items-center gap-1 border px-2 tabular-telemetry text-[10px] font-bold uppercase cursor-pointer ${
                autosave.status === "error"
                  ? "border-[#EF6B63] bg-[#EF6B63]/15 text-[#EF6B63]"
                  : autosave.status === "saved"
                    ? "border-[#38D39F] bg-[#38D39F]/15 text-[#38D39F]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)]"
              }`}
            >
              <Save className="h-3 w-3" aria-hidden="true" />
              {autosaveLabel}
            </button>
          </div>

          {/* Center Transport Controls + 60 fps Timecode + Master Meter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!snapshot.ready || project.tracks.length === 0}
              onClick={() => void daw.togglePlay()}
              aria-label={transport.playing ? "Pause DAW playback" : "Play DAW mix"}
            >
              {transport.playing ? (
                <>
                  <Pause className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  Play
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!snapshot.ready}
              onClick={() => daw.stop()}
              aria-label="Stop playback and return to zero"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            </Button>

            <Button
              type="button"
              variant={transport.loopEnabled ? "soft" : "secondary"}
              size="sm"
              aria-pressed={transport.loopEnabled}
              aria-label="Toggle loop playback"
              onClick={() =>
                daw.setLoop(
                  transport.loopStartSec,
                  transport.loopEndSec > transport.loopStartSec
                    ? transport.loopEndSec
                    : effectiveDuration,
                  !transport.loopEnabled
                )
              }
            >
              <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Loop</span>
            </Button>

            <TransportTimecode durationSec={effectiveDuration} controller={controller} />

            <div className="hidden items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2 py-1 sm:flex">
              <span className="tabular-telemetry text-[9px] font-bold uppercase text-[var(--text-muted)]">
                MST
              </span>
              <DawCanvasMeter
                target={{ kind: "master" }}
                controller={controller}
                orientation="horizontal"
                showGainReduction
                width={126}
                height={18}
                label="Master stereo peak and limiter gain reduction meter"
              />
            </div>
          </div>

          {/* Right Export WAV + Analyze Mix ↗ */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={project.tracks.length === 0 || exportState.status === "rendering"}
              onClick={() => void handleExportWav()}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {exportState.status === "rendering"
                ? `Rendering ${Math.round(exportState.progress * 100)}%`
                : "Export WAV"}
            </Button>

            <Button
              type="button"
              data-testid="daw-analyze-mix-btn"
              variant="primary"
              size="sm"
              disabled={
                project.tracks.length === 0 ||
                exportState.status === "rendering" ||
                isSendingToStudio
              }
              onClick={() => void handleAnalyzeMix()}
            >
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isSendingToStudio ? "Sending…" : "Analyze Mix"}</span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {/* Non-Fatal Error Banner */}
      {snapshot.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-[#EF6B63] bg-[#EF6B63]/15 px-4 py-2 text-xs text-[#EF6B63]"
        >
          <span className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {snapshot.error}
          </span>
          <button
            type="button"
            onClick={() => daw.clearError()}
            className="border border-[#EF6B63] px-2 py-0.5 text-[10px] font-bold uppercase cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Main Split Workspace: Left Collapsible Plugin Browser + Center Arrangement/Mixer */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left Collapsible Plugin Browser (All 16 Modules across 5 Categories) */}
        <aside
          data-testid="daw-plugin-browser"
          aria-label="Plugin Browser"
          className={`shrink-0 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] lg:border-b-0 lg:border-r ${
            browserOpen ? "w-full lg:w-[272px]" : "w-full lg:w-[44px]"
          }`}
        >
          <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-2">
            {browserOpen ? (
              <div className="min-w-0">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--text-primary)]">
                  Plugin Browser (16)
                </div>
                <div className="truncate tabular-telemetry text-[9px] uppercase text-[#F0B44C]">
                  Target → {selectedChainMeta.label}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              aria-label={browserOpen ? "Collapse plugin browser" : "Expand plugin browser"}
              onClick={() => setBrowserOpen((prev) => !prev)}
              className="inline-flex h-7 w-7 items-center justify-center border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[#F0B44C] cursor-pointer"
            >
              {browserOpen ? (
                <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>

          {browserOpen ? (
            <div className="flex max-h-[300px] flex-col lg:max-h-[calc(100vh-370px)]">
              <div className="border-b border-[var(--border-hairline)] p-2">
                <input
                  type="search"
                  aria-label="Filter plugins"
                  value={pluginQuery}
                  onChange={(e) => setPluginQuery(e.target.value)}
                  placeholder="Search EQ, Comp, Tape…"
                  className="h-7 w-full border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[#F0B44C] focus:outline-none"
                />
              </div>

              <div className="flex-1 divide-y divide-[var(--border-hairline)] overflow-y-auto">
                {PLUGIN_CATEGORIES.map((category) => {
                  const entries = PLUGIN_REGISTRY[category].filter((entry) => {
                    if (!pluginQuery.trim()) return true;
                    const q = pluginQuery.trim().toLowerCase();
                    return (
                      entry.descriptor.name.toLowerCase().includes(q) ||
                      entry.descriptor.category.toLowerCase().includes(q) ||
                      entry.descriptor.description.toLowerCase().includes(q)
                    );
                  });
                  if (entries.length === 0) return null;

                  return (
                    <div key={category} className="p-2">
                      <div className="mb-1.5 px-1 tabular-telemetry text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {category} ({entries.length})
                      </div>
                      <div className="space-y-1">
                        {entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="flex items-center justify-between gap-2 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 py-1.5 hover:border-[var(--border-strong)]"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-bold text-[var(--text-primary)]">
                                {entry.descriptor.name}
                              </div>
                              <div className="truncate text-[10px] text-[var(--text-muted)]">
                                {entry.descriptor.description}
                              </div>
                            </div>
                            <motion.button
                              type="button"
                              whileTap={TACTILE_TAP}
                              aria-label={`Add ${entry.descriptor.name} to ${selectedChainMeta.label}`}
                              onClick={() => daw.addPlugin(selectedChainId, entry.id)}
                              className="shrink-0 border border-[#0A0A0A] bg-[#F0B44C] px-2 py-0.5 tabular-telemetry text-[10px] font-extrabold uppercase text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-[#F0B44C] cursor-pointer"
                            >
                              + Add
                            </motion.button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </aside>

        {/* Center Main Workspace: View Toggle + Arrangement / Mixer */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Sub-Toolbar: Arrangement / Mixer Toggle + Import Audio + Bus Selectors */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2">
            <div
              role="tablist"
              aria-label="DAW workspace view"
              className="inline-flex border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mainView === "arrangement"}
                onClick={() => setMainView("arrangement")}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-extrabold uppercase tracking-[0.04em] cursor-pointer ${
                  mainView === "arrangement"
                    ? "bg-[#F0B44C] text-[#0A0A0A]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                Arrangement Timeline
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mainView === "mixer"}
                onClick={() => setMainView("mixer")}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-extrabold uppercase tracking-[0.04em] cursor-pointer ${
                  mainView === "mixer"
                    ? "bg-[#F0B44C] text-[#0A0A0A]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Mixer Strips
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => importInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5 text-[#F0B44C]" aria-hidden="true" />
                Import Audio
              </Button>

              <div className="inline-flex border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5 text-[10px] font-bold uppercase">
                {(
                  [
                    { id: CHAIN_RETURN_A, label: "Ret A" },
                    { id: CHAIN_RETURN_B, label: "Ret B" },
                    { id: CHAIN_MASTER, label: "Master" },
                  ] as const
                ).map((bus) => (
                  <button
                    key={bus.id}
                    type="button"
                    onClick={() => setSelectedChainId(bus.id)}
                    className={`px-2 py-1 cursor-pointer ${
                      selectedChainId === bus.id
                        ? "bg-[#F0B44C] text-[#0A0A0A]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {bus.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Missing Audio Relink Alert Banner */}
          {missingAudioTrackIds.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EF6B63] bg-[#EF6B63]/15 px-4 py-2 text-xs text-[#EF6B63]">
              <span className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {missingAudioTrackIds.length} track(s) need local audio relinking on this device
                (mix settings &amp; FX preserved).
              </span>
              <button
                type="button"
                onClick={() => {
                  setRelinkTrackId(missingAudioTrackIds[0]);
                  relinkInputRef.current?.click();
                }}
                className="border border-[#EF6B63] bg-[#EF6B63] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#0A0A0A] cursor-pointer"
              >
                Relink Track Audio
              </button>
            </div>
          ) : null}

          {/* Main Canvas Area */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleImportFiles(e.dataTransfer.files);
            }}
            className="flex-1 overflow-auto p-4"
          >
            {project.tracks.length === 0 ? (
              <div
                data-testid="daw-empty-state"
                className="mx-auto flex max-w-xl flex-col items-center justify-center border-[1.5px] border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-10 text-center"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center border border-[#0A0A0A] bg-[#F0B44C] text-[#0A0A0A]">
                  <FileAudio className="h-6 w-6" aria-hidden="true" />
                </div>
                <h1 className="font-condensed text-2xl font-extrabold uppercase text-[var(--text-primary)]">
                  Import Audio to Start Mixing
                </h1>
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                  Drop WAV, FLAC, MP3, or OGG stems anywhere here. Apply 16 real-time plugins, then
                  click <strong>Analyze Mix ↗</strong> for deterministic DSP diagnostics.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => importInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Import Audio Files
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isLoadingDemo}
                    onClick={() => void handleLoadSampleTrack()}
                  >
                    <Play className="h-4 w-4 text-[#F0B44C]" aria-hidden="true" />
                    {isLoadingDemo ? "Loading Sample…" : "Load Sample Mix Track"}
                  </Button>
                </div>
              </div>
            ) : mainView === "arrangement" ? (
              /* ARRANGEMENT TIMELINE VIEW */
              <div className="space-y-3">
                {/* Clickable Scrub Ruler + Loop Brace */}
                <div className="grid grid-cols-[200px_1fr] border border-[var(--border-hairline)] bg-[var(--bg-elevated)]">
                  <div className="flex items-center justify-between border-r border-[var(--border-hairline)] px-3 py-2 tabular-telemetry text-[10px] font-bold uppercase text-[var(--text-muted)]">
                    <span>TRACKS ({project.tracks.length})</span>
                    <span>CLIP</span>
                  </div>
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label="Arrangement timeline ruler — click to seek"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(effectiveDuration)}
                    aria-valuenow={0}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ratio = Math.max(
                        0,
                        Math.min(1, (e.clientX - rect.left) / Math.max(rect.width, 1))
                      );
                      daw.seek(ratio * effectiveDuration);
                    }}
                    className="relative h-8 overflow-hidden cursor-pointer bg-[#0A0A0A]"
                  >
                    {transport.loopEnabled ? (
                      <div
                        aria-hidden="true"
                        style={{
                          left: `${(transport.loopStartSec / effectiveDuration) * 100}%`,
                          width: `${Math.max(2, ((transport.loopEndSec - transport.loopStartSec) / effectiveDuration) * 100)}%`,
                        }}
                        className="absolute top-0 bottom-0 border-x border-[#F0B44C] bg-[#F0B44C]/20"
                      />
                    ) : null}
                    {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => (
                      <span
                        key={frac}
                        style={
                          idx === 0
                            ? { left: "6px" }
                            : idx === 4
                              ? { right: "6px" }
                              : { left: `${frac * 100}%` }
                        }
                        className={`pointer-events-none absolute top-1.5 tabular-telemetry text-[9px] text-[#A1A8B8] ${
                          idx === 0 || idx === 4 ? "" : "-translate-x-1/2"
                        }`}
                      >
                        {formatDawClock(frac * effectiveDuration)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Horizontal Track Lanes with Playhead Overlay */}
                <div className="divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)] bg-[var(--bg-elevated)]">
                  {project.tracks.map((track) => {
                    const selected = selectedChainId === track.id;
                    const missing = missingAudioTrackIds.includes(track.id);
                    const clipDur = Math.max(
                      0.1,
                      (track.audio?.durationSec ?? 0) -
                        track.clip.trimStartSec -
                        track.clip.trimEndSec
                    );
                    const leftPct = Math.min(95, (track.clip.startSec / effectiveDuration) * 100);
                    const widthPct = Math.max(
                      4,
                      Math.min(100 - leftPct, (clipDur / effectiveDuration) * 100)
                    );

                    return (
                      <div
                        key={track.id}
                        onClick={() => setSelectedChainId(track.id)}
                        className={`grid cursor-pointer grid-cols-[200px_1fr] ${
                          selected ? "bg-[var(--studio-yellow-soft)]" : "hover:bg-[var(--bg-elevated-hover)]"
                        }`}
                      >
                        {/* Track Header Controls */}
                        <div className="flex flex-col justify-between gap-1.5 border-r border-[var(--border-hairline)] p-2.5">
                          <div className="flex items-center justify-between gap-1">
                            <input
                              type="text"
                              aria-label={`Track name for ${track.name}`}
                              value={track.name}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => daw.renameTrack(track.id, e.target.value)}
                              className="min-w-0 flex-1 bg-transparent text-xs font-extrabold uppercase text-[var(--text-primary)] focus:bg-[var(--bg-inset)] focus:px-1 focus:outline-none"
                            />
                            <button
                              type="button"
                              aria-label={`Remove track ${track.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                daw.removeTrack(track.id);
                              }}
                              className="text-[var(--text-muted)] hover:text-[#EF6B63] cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-label={`Mute ${track.name}`}
                              aria-pressed={track.mute}
                              onClick={(e) => {
                                e.stopPropagation();
                                daw.setTrackMute(track.id, !track.mute);
                              }}
                              className={`h-5 w-6 border tabular-telemetry text-[10px] font-extrabold cursor-pointer ${
                                track.mute
                                  ? "border-[#EF6B63] bg-[#EF6B63] text-[#0A0A0A]"
                                  : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)]"
                              }`}
                            >
                              M
                            </button>
                            <button
                              type="button"
                              aria-label={`Solo ${track.name}`}
                              aria-pressed={track.solo}
                              onClick={(e) => {
                                e.stopPropagation();
                                daw.setTrackSolo(track.id, !track.solo);
                              }}
                              className={`h-5 w-6 border tabular-telemetry text-[10px] font-extrabold cursor-pointer ${
                                track.solo
                                  ? "border-[#0A0A0A] bg-[#F0B44C] text-[#0A0A0A]"
                                  : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)]"
                              }`}
                            >
                              S
                            </button>
                            <span className="ml-auto tabular-telemetry text-[10px] text-[var(--text-muted)]">
                              {track.inserts.length} FX
                            </span>
                          </div>

                          {/* Clip Start & Trim Controls */}
                          <div
                            className="flex items-center gap-1 tabular-telemetry text-[9px] text-[var(--text-muted)]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <label className="inline-flex items-center gap-0.5">
                              <span>ST</span>
                              <input
                                type="number"
                                aria-label={`${track.name} clip start seconds`}
                                min={0}
                                step={0.25}
                                value={Number(track.clip.startSec.toFixed(2))}
                                onChange={(e) => {
                                  const v = Number.parseFloat(e.target.value);
                                  if (Number.isFinite(v) && v >= 0) {
                                    daw.setTrackClip(track.id, { startSec: v });
                                  }
                                }}
                                className="h-5 w-11 border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-1 text-right text-[9px] text-[var(--text-primary)]"
                              />
                            </label>
                            <label className="inline-flex items-center gap-0.5">
                              <span>IN</span>
                              <input
                                type="number"
                                aria-label={`${track.name} clip trim start seconds`}
                                min={0}
                                step={0.25}
                                value={Number(track.clip.trimStartSec.toFixed(2))}
                                onChange={(e) => {
                                  const v = Number.parseFloat(e.target.value);
                                  if (Number.isFinite(v) && v >= 0) {
                                    daw.setTrackClip(track.id, { trimStartSec: v });
                                  }
                                }}
                                className="h-5 w-11 border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-1 text-right text-[9px] text-[var(--text-primary)]"
                              />
                            </label>
                          </div>
                        </div>

                        {/* Waveform Lane */}
                        <div
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const ratio = Math.max(
                              0,
                              Math.min(1, (e.clientX - rect.left) / Math.max(rect.width, 1))
                            );
                            daw.seek(ratio * effectiveDuration);
                          }}
                          className="relative overflow-hidden bg-[#0A0A0A] p-2"
                        >
                          <div
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            className={`relative border ${
                              missing
                                ? "border-[#EF6B63]"
                                : selected
                                  ? "border-[#F0B44C]"
                                  : "border-[#38D39F]/60"
                            }`}
                          >
                            <TrackWaveformLane
                              peaks={track.peaks}
                              color={missing ? "#EF6B63" : selected ? "#F0B44C" : "#38D39F"}
                            />
                            <div className="pointer-events-none absolute top-1 left-1.5 bg-[#0A0A0A]/80 px-1 tabular-telemetry text-[9px] font-bold text-[#F4F1EA]">
                              {track.audio?.fileName ?? track.name}
                            </div>
                          </div>
                          <ArrangementPlayhead
                            durationSec={effectiveDuration}
                            controller={controller}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* MIXER STRIPS VIEW */
              <div className="flex items-stretch gap-2.5 overflow-x-auto pb-2">
                {project.tracks.map((track) => (
                  <MixerTrackStrip
                    key={track.id}
                    trackId={track.id}
                    selected={selectedChainId === track.id}
                    anySolo={anySolo}
                    isMissingAudio={missingAudioTrackIds.includes(track.id)}
                    controller={controller}
                    actions={daw}
                    onSelect={() => setSelectedChainId(track.id)}
                    onRelinkRequest={(tid) => {
                      setRelinkTrackId(tid);
                      relinkInputRef.current?.click();
                    }}
                  />
                ))}

                {/* Return A, Return B & Master Bus Strips */}
                <div className="ml-auto flex shrink-0 items-stretch gap-2.5 border-l-2 border-[var(--border-strong)] pl-2.5">
                  <ReturnBusStrip
                    ret={project.returnA}
                    selected={selectedChainId === CHAIN_RETURN_A}
                    controller={controller}
                    actions={daw}
                    onSelect={() => setSelectedChainId(CHAIN_RETURN_A)}
                  />
                  <ReturnBusStrip
                    ret={project.returnB}
                    selected={selectedChainId === CHAIN_RETURN_B}
                    controller={controller}
                    actions={daw}
                    onSelect={() => setSelectedChainId(CHAIN_RETURN_B)}
                  />

                  {/* Master Strip */}
                  <div
                    data-testid="daw-master-strip"
                    onClick={() => setSelectedChainId(CHAIN_MASTER)}
                    className={`flex w-[144px] shrink-0 cursor-pointer flex-col border bg-[var(--bg-elevated)] ${
                      selectedChainId === CHAIN_MASTER
                        ? "border-[#F0B44C] ring-1 ring-[#F0B44C]"
                        : "border-[var(--border-strong)]"
                    }`}
                  >
                    <div className="border-b border-[#0A0A0A] bg-[#F0B44C] px-2 py-1.5 text-[11px] font-extrabold uppercase text-[#0A0A0A]">
                      MASTER BUS
                    </div>

                    <div className="flex flex-1 items-center justify-center gap-3 p-2.5">
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="flex h-[156px] w-7 items-center justify-center">
                          <input
                            type="range"
                            aria-label="Master bus volume fader"
                            min={FADER_MIN_DB}
                            max={FADER_MAX_DB}
                            step={0.5}
                            value={project.master.faderDb}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={() => daw.setMasterFader(0)}
                            onChange={(e) =>
                              daw.setMasterFader(Number.parseFloat(e.target.value))
                            }
                            className="h-1.5 w-[148px] -rotate-90 cursor-pointer accent-[#F0B44C]"
                          />
                        </div>
                        <span className="tabular-telemetry text-[10px] font-bold text-[var(--text-primary)]">
                          {formatFaderDb(project.master.faderDb)} dB
                        </span>
                      </div>

                      <DawCanvasMeter
                        target={{ kind: "master" }}
                        controller={controller}
                        orientation="vertical"
                        showGainReduction
                        width={26}
                        height={164}
                        label="Master bus stereo peak and safety limiter gain reduction meter"
                      />
                    </div>

                    <div className="border-t border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2 py-1 text-center tabular-telemetry text-[9px] text-[#F0B44C]">
                      {project.master.inserts.length} FX + LIMITER
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Horizontal Device Rack */}
          <DawDeviceRack
            chainId={selectedChainId}
            chainLabel={selectedChainMeta.label}
            inserts={selectedChainMeta.inserts}
            masterLimiter={selectedChainMeta.masterLimiter}
            controller={controller}
            actions={daw}
          />
        </main>
      </div>

      {/* Open Saved Projects Modal */}
      <Dialog open={projectsOpen} onOpenChange={setProjectsOpen}>
        <DialogContent aria-describedby="daw-projects-desc" className="max-w-lg space-y-4">
          <div>
            <DialogTitle className="font-condensed text-xl font-extrabold uppercase">
              Saved DAW Projects
            </DialogTitle>
            <p id="daw-projects-desc" className="mt-1 text-xs text-[var(--text-secondary)]">
              Project state JSON syncs securely to Supabase; audio tracks cache locally in IndexedDB.
            </p>
          </div>

          {loadingList ? (
            <div className="border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-6 text-center text-xs text-[var(--text-secondary)]">
              Loading saved projects…
            </div>
          ) : savedProjects.length === 0 ? (
            <div className="border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-6 text-center text-xs text-[var(--text-secondary)]">
              No saved projects yet. Import a track or click Save to store this project.
            </div>
          ) : (
            <div className="max-h-72 divide-y divide-[var(--border-hairline)] overflow-y-auto border border-[var(--border-hairline)]">
              {savedProjects.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 bg-[var(--bg-elevated)] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-[var(--text-primary)]">
                      {item.name}
                    </div>
                    <div className="tabular-telemetry text-[10px] text-[var(--text-muted)]">
                      Updated {new Date(item.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={async () => {
                        await daw.openProject(item.id);
                        setProjectsOpen(false);
                      }}
                    >
                      Open
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`Duplicate ${item.name}`}
                      onClick={async () => {
                        await daw.duplicateProject(item.id, `${item.name} (Copy)`);
                        setSavedProjects(await daw.listProjects());
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      aria-label={`Delete ${item.name}`}
                      onClick={async () => {
                        await daw.deleteProject(item.id);
                        setSavedProjects(await daw.listProjects());
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        context="daw"
      />
    </div>
  );
}

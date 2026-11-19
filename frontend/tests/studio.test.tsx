import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { StudioAudioEngine } from "@/audio/StudioAudioEngine";
import { BottomTransportDock } from "@/components/BottomTransportDock";
import { FindingCard, deriveAutoFixEqBands, deriveSuggestedEq } from "@/components/FindingCard";
import { StudioHeader } from "@/components/StudioHeader";
import { MAX_SINGLE_FILE_BYTES, UploadStage } from "@/components/UploadStage";
import { RevisionInspector } from "@/components/advanced/RevisionInspector";
import { StemsInspector } from "@/components/advanced/StemsInspector";
import { MentorDrawer } from "@/components/privacy/MentorDrawer";
import { MentorPrivacyPanel } from "@/components/privacy/MentorPrivacyPanel";
import { SimpleView } from "@/components/simple/SimpleView";
import { WorkspaceSubNav } from "@/components/workspace/WorkspaceSubNav";
import { askMentor } from "@/lib/api";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { computeTransientPunchDb } from "@/server/dsp/dynamics";
import { computeStereoMetrics } from "@/server/dsp/stereo";
import { analyzeSongStructure } from "@/server/dsp/structure";
import type { AnalysisReport, Finding } from "@/types/report";

const mockReport: AnalysisReport = {
  schema_version: "1.0.0",
  session_id: "sess_test_01",
  report_id: "rep_9f8a7b6c",
  created_at: "2026-11-17T12:00:00Z",
  context: {
    genre: "electronic",
    stage: "unmastered_mix",
    artist_vision: ["punchy", "wide"],
    has_user_stems: false,
    stem_count: 0,
  },
  audio_metadata: {
    filename: "track_v1.wav",
    duration_sec: 16,
    sample_rate_hz: 48000,
    channels: 2,
    bit_depth: 24,
    playback_proxy_url: "/api/v1/sessions/sess_test_01/proxy/proxy.m4a",
    waveform_peaks: [[-0.4, 0.42], [-0.6, 0.62]],
    clipping_timestamps_sec: [],
  },
  global_metrics: {
    integrated_lufs: -16.4,
    short_term_max_lufs: -12.1,
    momentary_max_lufs: -10.3,
    loudness_range_lu: 6.8,
    sample_peak_dbfs: -1.8,
    true_peak_dbtp: -1.5,
    crest_factor_db: 14.6,
    psr_db: 11.2,
    phase_correlation_avg: 0.78,
    low_end_phase_correlation: 0.91,
    stereo_width_ratio: 0.42,
  },
  streaming_estimates: [],
  spectral_bands: [],
  time_series: { step_sec: 1, short_term_lufs: [-16.4], phase_correlation: [0.78] },
  findings: [
    {
      evidence_id: "ev_low_buildup_01",
      category: "tonal_balance",
      severity: "caution",
      confidence: "measured",
      band_name: "low",
      title: "Low-End Buildup Around 60–250 Hz",
      timestamp_start_sec: 4,
      timestamp_end_sec: 12,
      measured_value: "+3.4 dB vs electronic median",
      what_happened: "Low energy rises +3.4 dB in the drop.",
      why_it_matters: "Consumes headroom and clouds small speakers.",
      listen_prompt: "Jump to 00:04 and check Laptop preview.",
      what_to_try: "Try a 1.5 dB cut around 140 Hz.",
      recheck_target: "Verify 60–250 Hz moves within +/-1.5 dB.",
    },
  ],
  stem_analysis: null,
  revision_comparison: null,
  privacy_audit: {
    raw_audio_sent_to_ai: false,
    external_ai_enabled: false,
    training_opt_in: false,
    retention_policy: "Ephemeral session storage",
  },
};

describe("MixBench UI & Privacy Contracts", () => {
  it("renders Simple Mix Check with telemetry, platform preview, and evidence_id without fake aggregate scores", () => {
    render(
      <MotionConfig reducedMotion="user">
        <SimpleView
          report={mockReport}
          isPlaying={false}
          activeFindingId="ev_low_buildup_01"
          onTogglePlay={vi.fn()}
          onAuditionFinding={vi.fn()}
          onSelectFinding={vi.fn()}
          onOpenAdvanced={vi.fn()}
          onNewUpload={vi.fn()}
        />
      </MotionConfig>
    );

    expect(screen.getByText("track_v1.wav")).toBeInTheDocument();
    expect(screen.getByText("ev_low_buildup_01")).toBeInTheDocument();
    expect(screen.getByText("Low-End Buildup Around 60–250 Hz")).toBeInTheDocument();
    expect(screen.getByText(/What happened:/i)).toBeInTheDocument();
    expect(screen.getByText(/Why it matters:/i)).toBeInTheDocument();
    expect(screen.getByText(/Listen:/i)).toBeInTheDocument();
    expect(screen.getByText(/What to try:/i)).toBeInTheDocument();
    expect(screen.getByText(/Recheck:/i)).toBeInTheDocument();
    expect(screen.getByText(/Platform Loudness Normalization Preview/i)).toBeInTheDocument();
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument();
  });

  it("enforces zero AI stem separation lock when has_user_stems is false", () => {
    render(
      <StemsInspector
        report={mockReport}
        isUploading={false}
        errorMessage={null}
        onUploadStems={vi.fn()}
        onLoadDemoStems={vi.fn()}
      />
    );

    expect(screen.getByText(/Stem Matrix Locked/i)).toBeInTheDocument();
    expect(screen.getByText(/zero AI stem separation/i)).toBeInTheDocument();
  });

  it("defaults all three AI privacy toggles to OFF and gates Toggle B behind Toggle A", () => {
    const onAskMentor = vi.fn();
    render(
      <MentorPrivacyPanel
        report={mockReport}
        mentorAdvice={null}
        isAskingMentor={false}
        onAskMentor={onAskMentor}
        onSaveDawContext={vi.fn()}
        onJumpToEvidence={vi.fn()}
      />
    );

    const toggleA = screen.getByRole("switch", { name: /Toggle A Metrics-Only AI Mentor/i });
    const toggleB = screen.getByRole("switch", { name: /Toggle B Direct Audio Listening Opt-In/i });
    const toggleC = screen.getByRole("switch", { name: /Toggle C Future Model Training Opt-In/i });

    expect(toggleA).toHaveAttribute("aria-checked", "false");
    expect(toggleB).toHaveAttribute("aria-checked", "false");
    expect(toggleB).toBeDisabled();
    expect(toggleC).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("button", { name: /Run Offline Deterministic Mentor/i }));
    expect(onAskMentor).toHaveBeenCalledWith({
      allow_metrics_ai: false,
      allow_audio_ai: false,
      allow_training_opt_in: false,
      question: "",
      conversation_history: [],
    });
  });

  it("renders revision v1 vs v2 delta badges accurately", () => {
    const withRevision: AnalysisReport = {
      ...mockReport,
      revision_comparison: {
        baseline_report_id: "rep_1",
        revised_report_id: "rep_2",
        baseline_filename: "mix_v1.wav",
        revised_filename: "mix_v2.wav",
        revised_playback_proxy_url: "/api/v1/sessions/sess_test_01/proxy/v2.m4a",
        metric_deltas: {
          integrated_lufs_delta: -0.6,
          true_peak_dbtp_delta: -2.1,
          loudness_range_lu_delta: 0.4,
          crest_factor_db_delta: 1.2,
          psr_db_delta: 0.9,
          phase_correlation_delta: 0.04,
          band_deltas_db: { low: -2.5 },
        },
        finding_statuses: [
          {
            evidence_id: "ev_low_buildup_01",
            title: "Low-End Buildup Around 60–250 Hz",
            category: "tonal_balance",
            status: "improved",
            baseline_value: "+3.4 dB",
            revised_value: "+0.8 dB",
            summary: "Band deviation narrowed from 3.4 dB to 0.8 dB.",
          },
        ],
      },
    };

    render(
      <RevisionInspector
        report={withRevision}
        isUploading={false}
        errorMessage={null}
        onUploadRevision={vi.fn()}
        onLoadDemoRevision={vi.fn()}
        onAuditionRevised={vi.fn()}
        onAuditionBaseline={vi.fn()}
      />
    );

    expect(screen.getByText(/-2\.10 dBTP/i)).toBeInTheDocument();
    expect(screen.getByText("improved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Baseline v1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revised v2/i })).toBeInTheDocument();
  });

  it("initializes StudioAudioEngine cleanly with Full Range, Stereo, and Corrective EQ toggle", () => {
    const engine = new StudioAudioEngine();
    const state = engine.getState();
    expect(state.activeSource).toBe("primary");
    expect(state.stereoMode).toBe("stereo");
    expect(state.deviceProfile).toBe("full");
    expect(state.matchLoudness).toBe(true);
    expect(state.loudnessOffsetDb).toBe(0);
    expect(state.activeCorrectiveEqId).toBeNull();
  });

  it("handles FindingCard No-Audio disabled state and corrective EQ audition button", () => {
    const onAudition = vi.fn();
    const onToggleEq = vi.fn();
    const onRecheck = vi.fn();

    render(
      <FindingCard
        finding={mockReport.findings[0]}
        index={0}
        hasAudio={false}
        onAudition={onAudition}
        onRecheck={onRecheck}
        onToggleCorrectiveEq={onToggleEq}
      />
    );

    const noAudioBtn = screen.getByRole("button", { name: /No Audio/i });
    expect(noAudioBtn).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Recheck in v2/i }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("renders live backend health states and report export controls in StudioHeader", () => {
    const { rerender } = render(
      <StudioHeader
        mode="simple"
        onModeChange={vi.fn()}
        report={mockReport}
        onClearSession={vi.fn()}
        healthStatus="online"
        healthData={{ status: "ok", ffmpeg_available: true, gemini_configured: false }}
        healthError={null}
        onRetryHealth={vi.fn()}
      />
    );
    expect(screen.getByText("DSP Engine Online")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export JSON report/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print PDF report/i })).toBeInTheDocument();

    rerender(
      <StudioHeader
        mode="simple"
        onModeChange={vi.fn()}
        report={null}
        onClearSession={vi.fn()}
        healthStatus="waking"
        healthData={null}
        healthError="Timed out"
        wakeAttempt={3}
        wakeMaxAttempts={24}
        onRetryHealth={vi.fn()}
      />
    );
    const wakingBtn = screen.getByRole("button", { name: /Waking DSP Engine…/i });
    expect(wakingBtn).toBeInTheDocument();
    fireEvent.click(wakingBtn);
    expect(screen.getByText(/retry 3\/24/i)).toBeInTheDocument();
    fireEvent.click(wakingBtn);

    rerender(
      <StudioHeader
        mode="simple"
        onModeChange={vi.fn()}
        report={null}
        onClearSession={vi.fn()}
        healthStatus="offline"
        healthData={null}
        healthError="Failed to fetch"
        onRetryHealth={vi.fn()}
      />
    );
    const offlineBtn = screen.getByRole("button", { name: /Backend Unreachable — Check API URL/i });
    expect(offlineBtn).toBeInTheDocument();
    fireEvent.click(offlineBtn);
    expect(screen.getByRole("dialog", { name: /DSP backend connection diagnostics/i })).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
  });

  it("renders WorkspaceSubNav tabs and calibrated BottomTransportDock translation profiles cleanly", () => {
    render(
      <>
        <WorkspaceSubNav
          activeTab="diagnosis"
          onChangeTab={vi.fn()}
          report={mockReport}
          hasReference={false}
          onOpenMentor={vi.fn()}
        />
        <BottomTransportDock
          durationSec={16}
          isPlaying={false}
          activeSource="primary"
          stereoMode="stereo"
          deviceProfile="full"
          matchLoudness={true}
          loudnessOffsetDb={0}
          loopEnabled={false}
          hasReference={false}
          hasRevised={false}
          onTogglePlay={vi.fn()}
          onToggleLoop={vi.fn()}
          onSeek={vi.fn()}
          onChangeSource={vi.fn()}
          onChangeStereo={vi.fn()}
          onChangeDevice={vi.fn()}
          onToggleMatchLoudness={vi.fn()}
        />
      </>
    );

    expect(screen.getByRole("tab", { name: /Mix Diagnosis/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Reference A\/B/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Original Stems/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Revision Check/i })).toBeInTheDocument();
    expect(screen.getByText(/300Hz–4\.5kHz · Mono/i)).toBeInTheDocument();
    expect(screen.getByText(/150Hz–8kHz/i)).toBeInTheDocument();
  });

  it("blocks files over 50 MB client-side and gracefully disables Supabase when env vars are unset", () => {
    const onAnalyzeFile = vi.fn();
    render(
      <UploadStage
        genre="electronic"
        onGenreChange={vi.fn()}
        stage="unmastered_mix"
        onStageChange={vi.fn()}
        artistVision={["punchy"]}
        onToggleVision={vi.fn()}
        isAnalyzing={false}
        activeStepIndex={0}
        errorMessage={null}
        healthStatus="online"
        onRetryHealth={vi.fn()}
        onAnalyzeFile={onAnalyzeFile}
        onLoadDemo={vi.fn()}
      />
    );

    const fileInput = screen.getByLabelText(/Upload stereo mix audio file/i);
    const hugeFile = new File(["tiny"], "giant_master.wav", { type: "audio/wav" });
    Object.defineProperty(hugeFile, "size", { value: MAX_SINGLE_FILE_BYTES + 1024 });

    fireEvent.change(fileInput, { target: { files: [hugeFile] } });
    expect(onAnalyzeFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/50 MB single-file upload limit/i);

    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseBrowserClient()).toBeNull();
  });

  it("derives corrective EQ and Auto-Fix bands for tonal and sub-phase findings while skipping safe findings", () => {
    const lowMud = mockReport.findings[0];
    const eq = deriveSuggestedEq(lowMud);
    expect(eq).not.toBeNull();
    expect(eq?.gainDb).toBeLessThan(0);

    const subPhaseFinding: Finding = {
      ...lowMud,
      evidence_id: "ev_phase_01",
      category: "stereo_phase",
      severity: "alert",
      band_name: "sub",
      title: "Wide Out-of-Phase Sub-Bass",
    };
    const subEq = deriveSuggestedEq(subPhaseFinding);
    expect(subEq).not.toBeNull();
    expect(subEq?.freqHz).toBe(85);
    expect(subEq?.gainDb).toBeLessThan(0);

    const safeFinding: Finding = {
      ...lowMud,
      evidence_id: "ev_safe_01",
      severity: "safe",
    };
    expect(deriveSuggestedEq(safeFinding)).toBeNull();

    const autoBands = deriveAutoFixEqBands([lowMud, subPhaseFinding, safeFinding]);
    expect(autoBands.length).toBeGreaterThanOrEqual(2);
    expect(autoBands.length).toBeLessThanOrEqual(3);
  });

  it("computes 20-120 Hz bandpass low-end phase correlation, transient punch, and 120 BPM song structure", () => {
    const sr = 24000;
    const seconds = 6;
    const n = sr * seconds;
    const left = new Float64Array(n);
    const right = new Float64Array(n);

    // 10 Hz anti-phase rumble + 60 Hz in-phase sub-bass -> 20-120 Hz bandpass must reject 10 Hz and read positive
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const rumble10 = 0.45 * Math.sin(2 * Math.PI * 10 * t);
      const sub60 = 0.35 * Math.sin(2 * Math.PI * 60 * t);
      left[i] = sub60 + rumble10;
      right[i] = sub60 - rumble10;
    }
    const stereoRumbleTest = computeStereoMetrics([left, right], sr);
    expect(stereoRumbleTest.lowEndPhaseCorrelation).toBeGreaterThan(0.7);

    // 60 Hz anti-phase sub-bass must read strongly negative
    const invLeft = new Float64Array(n);
    const invRight = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const sub60 = 0.4 * Math.sin(2 * Math.PI * 60 * t);
      invLeft[i] = sub60;
      invRight[i] = -sub60;
    }
    const stereoInvTest = computeStereoMetrics([invLeft, invRight], sr);
    expect(stereoInvTest.lowEndPhaseCorrelation).toBeLessThan(-0.9);

    // Transient punch: 120 BPM sharp kick bursts > steady sustained sine
    const kickMono = new Float64Array(n);
    const sineMono = new Float64Array(n);
    const beatSamples = Math.round(sr * 0.5); // 120 BPM = 0.5 s per beat
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      sineMono[i] = 0.35 * Math.sin(2 * Math.PI * 220 * t);
      const phaseInBeat = i % beatSamples;
      const env = Math.exp(-phaseInBeat / (sr * 0.015));
      kickMono[i] = 0.85 * env * Math.sin(2 * Math.PI * 90 * (phaseInBeat / sr));
    }
    const kickPunch = computeTransientPunchDb([kickMono, kickMono], sr);
    const sinePunch = computeTransientPunchDb([sineMono, sineMono], sr);
    expect(kickPunch).toBeGreaterThan(sinePunch + 4.0);

    // Structure: 120 BPM detection & multi-section contour
    const structure = analyzeSongStructure(
      [kickMono, kickMono],
      sr,
      20,
      [-22, -21, -18, -16, -15, -14, -10, -9, -9, -10, -14, -15, -10, -9, -9, -10, -18, -20, -22, -23]
    );
    expect(structure.bpm).not.toBeNull();
    expect(Math.abs((structure.bpm ?? 0) - 120)).toBeLessThanOrEqual(4);
    expect(structure.sections.length).toBeGreaterThanOrEqual(3);
  });

  it("aborts hanging askMentor requests cleanly and recovers MentorDrawer UI state on timeout", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortErr = new DOMException("The operation was aborted.", "AbortError");
          reject(abortErr);
        });
      });
    });

    try {
      await expect(
        askMentor(
          "sess_timeout_test",
          {
            allow_metrics_ai: true,
            allow_audio_ai: false,
            allow_training_opt_in: false,
            question: "Check headroom",
          },
          40
        )
      ).rejects.toThrow(/timed out/i);
    } finally {
      fetchSpy.mockRestore();
    }

    const onAskMentor = vi
      .fn()
      .mockRejectedValueOnce(new Error("AI Mix Mentor timed out after 28 seconds."))
      .mockResolvedValueOnce(undefined);

    render(
      <MotionConfig reducedMotion="user">
        <MentorDrawer
          open={true}
          onClose={vi.fn()}
          report={mockReport}
          mentorAdvice={null}
          isAskingMentor={false}
          onAskMentor={onAskMentor}
          onSaveDawContext={vi.fn()}
          onJumpToEvidence={vi.fn()}
        />
      </MotionConfig>
    );

    const submitBtn = screen.getByRole("button", { name: /Run Offline Deterministic Mentor/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("mentor-error-notice")).toHaveTextContent(/timed out after 28 seconds/i);
    });
    expect(screen.queryByText(/Generating Coaching\.\.\./i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Run Offline Fallback Now/i }));
    await waitFor(() => {
      expect(onAskMentor).toHaveBeenCalledTimes(2);
    });
    expect(onAskMentor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allow_metrics_ai: false,
        allow_audio_ai: false,
      })
    );
  });
});

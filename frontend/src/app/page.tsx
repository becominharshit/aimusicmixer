"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  studioAudioEngine,
  type AudioSourceSlot,
  type DeviceProfile,
  type StereoMode,
} from "@/audio/StudioAudioEngine";
import { BottomTransportDock } from "@/components/BottomTransportDock";
import { StudioHeader, type HealthStatus, type WorkspaceMode } from "@/components/StudioHeader";
import { UploadStage } from "@/components/UploadStage";
import { AdvancedWorkbench } from "@/components/advanced/AdvancedWorkbench";
import { RevisionInspector } from "@/components/advanced/RevisionInspector";
import { StemsInspector } from "@/components/advanced/StemsInspector";
import { MentorDrawer } from "@/components/privacy/MentorDrawer";
import { SimpleView } from "@/components/simple/SimpleView";
import { ReferenceABView } from "@/components/workspace/ReferenceABView";
import { WorkspaceSubNav, type WorkspaceSubTab } from "@/components/workspace/WorkspaceSubNav";
import {
  analyzeMixFile,
  askMentor,
  checkBackendHealth,
  clearSession,
  compareRevisedMix,
  fetchPublicDemoFile,
  loadDemoReferenceTrack,
  loadDemoStems,
  resolveApiUrl,
  updateDawContext,
  uploadReferenceTrack,
  uploadUserStems,
} from "@/lib/api";
import { STUDIO_EASE } from "@/lib/motion";
import type {
  AnalysisReport,
  ArtistVisionTag,
  BackendHealth,
  Finding,
  GenreType,
  MentorRequest,
  MentorResponse,
  ReferenceTrackMeta,
  StageType,
} from "@/types/report";

export default function MixBenchPage() {
  const [mode, setMode] = useState<WorkspaceMode>("simple");
  const [subTab, setSubTab] = useState<WorkspaceSubTab>("diagnosis");
  const [mentorOpen, setMentorOpen] = useState(false);

  const [genre, setGenre] = useState<GenreType>("electronic");
  const [stage, setStage] = useState<StageType>("unmastered_mix");
  const [artistVision, setArtistVision] = useState<ArtistVisionTag[]>(["punchy", "wide"]);

  const [healthStatus, setHealthStatus] = useState<HealthStatus>("checking");
  const [healthData, setHealthData] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [wakeAttempt, setWakeAttempt] = useState(0);

  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [referenceMeta, setReferenceMeta] = useState<ReferenceTrackMeta | null>(null);
  const [mentorAdvice, setMentorAdvice] = useState<MentorResponse | null>(null);
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [isUploadingRef, setIsUploadingRef] = useState(false);
  const [isUploadingStems, setIsUploadingStems] = useState(false);
  const [stemError, setStemError] = useState<string | null>(null);
  const [isUploadingRevision, setIsUploadingRevision] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [isAskingMentor, setIsAskingMentor] = useState(false);

  const [audioState, setAudioState] = useState(() => studioAudioEngine.getState());
  const stepTimerRef = useRef<number | null>(null);
  const wakeTimerRef = useRef<number | null>(null);
  const healthCycleRef = useRef(0);
  const healthStatusRef = useRef<HealthStatus>("checking");

  const clearWakeTimer = useCallback(() => {
    if (wakeTimerRef.current !== null) {
      window.clearTimeout(wakeTimerRef.current);
      wakeTimerRef.current = null;
    }
  }, []);

  const setHealthState = useCallback((next: HealthStatus) => {
    healthStatusRef.current = next;
    setHealthStatus(next);
  }, []);

  const refreshHealth = useCallback(async () => {
    const cycleId = ++healthCycleRef.current;
    clearWakeTimer();
    setWakeAttempt(0);
    setHealthState("checking");
    setHealthError(null);

    try {
      const data = await checkBackendHealth();
      if (healthCycleRef.current !== cycleId) return;
      setHealthData(data);
      setHealthState("online");
      return;
    } catch (err) {
      if (healthCycleRef.current !== cycleId) return;
      setHealthData(null);
      setHealthError(err instanceof Error ? err.message : "Backend /health unreachable.");
      setHealthState("waking");
      setWakeAttempt(1);
    }

    const MAX_WAKE_ATTEMPTS = 15;
    const WAKE_RETRY_MS = 5000;

    const scheduleWakeAttempt = (attempt: number) => {
      wakeTimerRef.current = window.setTimeout(async () => {
        if (healthCycleRef.current !== cycleId) return;
        try {
          const data = await checkBackendHealth();
          if (healthCycleRef.current !== cycleId) return;
          setHealthData(data);
          setHealthError(null);
          setWakeAttempt(0);
          setHealthState("online");
        } catch (err) {
          if (healthCycleRef.current !== cycleId) return;
          setHealthError(err instanceof Error ? err.message : "Backend /health unreachable.");
          if (attempt >= MAX_WAKE_ATTEMPTS) {
            setHealthState("offline");
          } else {
            setWakeAttempt(attempt + 1);
            scheduleWakeAttempt(attempt + 1);
          }
        }
      }, WAKE_RETRY_MS);
    };

    scheduleWakeAttempt(1);
  }, [clearWakeTimer, setHealthState]);

  useEffect(() => {
    void refreshHealth();

    const ACTIVE_HEARTBEAT_MS = 540_000; // 9 minutes
    const heartbeatId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (healthStatusRef.current === "waking" || healthStatusRef.current === "checking") return;
      void checkBackendHealth()
        .then((data) => {
          setHealthData(data);
          setHealthError(null);
          setWakeAttempt(0);
          setHealthState("online");
        })
        .catch(() => {
          if (healthStatusRef.current === "online") {
            void refreshHealth();
          }
        });
    }, ACTIVE_HEARTBEAT_MS);

    const unsubscribeAudio = studioAudioEngine.subscribe(() => {
      setAudioState(studioAudioEngine.getState());
    });

    return () => {
      healthCycleRef.current += 1;
      clearWakeTimer();
      window.clearInterval(heartbeatId);
      unsubscribeAudio();
    };
  }, [refreshHealth, clearWakeTimer, setHealthState]);

  const startStepper = () => {
    setActiveStepIndex(0);
    if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
    stepTimerRef.current = window.setInterval(() => {
      setActiveStepIndex((prev) => (prev < 3 ? prev + 1 : prev));
    }, 650);
  };

  const stopStepper = () => {
    if (stepTimerRef.current) {
      window.clearInterval(stepTimerRef.current);
      stepTimerRef.current = null;
    }
  };

  const hydrateSessionReport = async (nextReport: AnalysisReport) => {
    healthCycleRef.current += 1;
    clearWakeTimer();
    setWakeAttempt(0);
    setHealthError(null);
    setHealthState("online");

    setReport(nextReport);
    setSubTab("diagnosis");
    setReferenceMeta(null);
    setMentorAdvice(null);
    setStemError(null);
    setRevisionError(null);
    setActiveFindingId(nextReport.findings[0]?.evidence_id ?? null);

    try {
      await studioAudioEngine.loadSlot(
        "primary",
        resolveApiUrl(nextReport.audio_metadata.playback_proxy_url),
        nextReport.global_metrics.integrated_lufs
      );
    } catch {
      // Allow metric inspection before Web Audio user gesture unlock
    }
  };

  const handleAnalyzeFile = async (file: File) => {
    setUploadError(null);
    setIsAnalyzing(true);
    startStepper();
    try {
      const next = await analyzeMixFile({ file, genre, stage, artistVision });
      await hydrateSessionReport(next);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to analyze uploaded mix.");
      void refreshHealth();
    } finally {
      stopStepper();
      setIsAnalyzing(false);
    }
  };

  const handleLoadDemo = async () => {
    setUploadError(null);
    setIsAnalyzing(true);
    startStepper();
    try {
      const demoFile = await fetchPublicDemoFile(
        "/demo/demo-flawed-v1.wav",
        "demo-flawed-v1.wav"
      );
      const next = await analyzeMixFile({ file: demoFile, genre, stage, artistVision });
      await hydrateSessionReport(next);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Could not reach backend API. Check your DSP Engine status in the header."
      );
      void refreshHealth();
    } finally {
      stopStepper();
      setIsAnalyzing(false);
    }
  };

  const handleToggleVision = (tag: ArtistVisionTag) => {
    setArtistVision((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleAuditionFinding = async (finding: Finding) => {
    setActiveFindingId(finding.evidence_id);
    await studioAudioEngine.auditionRange(
      finding.timestamp_start_sec,
      Math.max(finding.timestamp_start_sec + 4, finding.timestamp_end_sec)
    );
  };

  const handleAuditionWindow = async (startSec: number, endSec: number) => {
    await studioAudioEngine.auditionRange(startSec, endSec);
  };

  const handleUploadReference = async (file: File) => {
    if (!report) return;
    setIsUploadingRef(true);
    try {
      const meta = await uploadReferenceTrack(report.session_id, file);
      setReferenceMeta(meta);
      await studioAudioEngine.loadSlot(
        "reference",
        resolveApiUrl(meta.playback_proxy_url),
        meta.integrated_lufs
      );
      await studioAudioEngine.setActiveSource("reference");
    } finally {
      setIsUploadingRef(false);
    }
  };

  const handleLoadDemoReference = async () => {
    if (!report) return;
    setIsUploadingRef(true);
    try {
      const meta = await loadDemoReferenceTrack(report.session_id);
      setReferenceMeta(meta);
      await studioAudioEngine.loadSlot(
        "reference",
        resolveApiUrl(meta.playback_proxy_url),
        meta.integrated_lufs
      );
    } finally {
      setIsUploadingRef(false);
    }
  };

  const handleUploadStems = async (files: File[]) => {
    if (!report) return;
    setStemError(null);
    setIsUploadingStems(true);
    try {
      const updated = await uploadUserStems(report.session_id, files);
      setReport(updated);
    } catch (err) {
      setStemError(err instanceof Error ? err.message : "Stem upload failed.");
    } finally {
      setIsUploadingStems(false);
    }
  };

  const handleLoadDemoStems = async () => {
    if (!report) return;
    setStemError(null);
    setIsUploadingStems(true);
    try {
      const updated = await loadDemoStems(report.session_id);
      setReport(updated);
    } catch (err) {
      setStemError(err instanceof Error ? err.message : "Failed to load demo stems.");
    } finally {
      setIsUploadingStems(false);
    }
  };

  const handleUploadRevision = async (file: File) => {
    if (!report) return;
    setRevisionError(null);
    setIsUploadingRevision(true);
    try {
      const updated = await compareRevisedMix(report.session_id, file);
      setReport(updated);
      if (updated.revision_comparison) {
        await studioAudioEngine.loadSlot(
          "revised",
          resolveApiUrl(updated.revision_comparison.revised_playback_proxy_url),
          updated.global_metrics.integrated_lufs +
            updated.revision_comparison.metric_deltas.integrated_lufs_delta
        );
      }
    } catch (err) {
      setRevisionError(err instanceof Error ? err.message : "Revision upload failed.");
    } finally {
      setIsUploadingRevision(false);
    }
  };

  const handleLoadDemoRevision = async () => {
    if (!report) return;
    setRevisionError(null);
    setIsUploadingRevision(true);
    try {
      const demoV2 = await fetchPublicDemoFile(
        "/demo/demo-revised-v2.wav",
        "demo-revised-v2.wav"
      );
      const updated = await compareRevisedMix(report.session_id, demoV2);
      setReport(updated);
      if (updated.revision_comparison) {
        await studioAudioEngine.loadSlot(
          "revised",
          resolveApiUrl(updated.revision_comparison.revised_playback_proxy_url),
          updated.global_metrics.integrated_lufs +
            updated.revision_comparison.metric_deltas.integrated_lufs_delta
        );
      }
    } catch (err) {
      setRevisionError(err instanceof Error ? err.message : "Sample revision comparison failed.");
    } finally {
      setIsUploadingRevision(false);
    }
  };

  const handleAskMentor = async (req: MentorRequest) => {
    if (!report) return;
    setIsAskingMentor(true);
    try {
      const advice = await askMentor(report.session_id, req);
      setMentorAdvice(advice);
      setReport((prev) => (prev ? { ...prev, privacy_audit: advice.privacy_audit } : prev));
    } finally {
      setIsAskingMentor(false);
    }
  };

  const handleSaveDawContext = async (ctx: {
    daw: string;
    bus_routing: string;
    plugin_notes: string;
  }) => {
    if (!report) return;
    const updated = await updateDawContext(report.session_id, ctx);
    setReport(updated);
  };

  const handleJumpEvidence = (evidenceId: string) => {
    if (!report) return;
    const match = report.findings.find((f) => f.evidence_id === evidenceId);
    if (match) {
      setSubTab("diagnosis");
      void handleAuditionFinding(match);
    } else if (report.stem_analysis?.overlap_matrix.some((o) => o.evidence_id === evidenceId)) {
      setSubTab("stems");
    }
  };

  const handleClearSession = async () => {
    const sid = report?.session_id;
    studioAudioEngine.reset();
    setReport(null);
    setSubTab("diagnosis");
    setMentorOpen(false);
    setReferenceMeta(null);
    setMentorAdvice(null);
    setActiveFindingId(null);
    if (sid) {
      try {
        await clearSession(sid);
      } catch {
        // Ignore network errors when clearing expired session
      }
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAFA]">
      <StudioHeader
        mode={mode}
        onModeChange={(nextMode) => {
          setMode(nextMode);
          if (report) setSubTab("diagnosis");
        }}
        report={report}
        onClearSession={handleClearSession}
        healthStatus={healthStatus}
        healthData={healthData}
        healthError={healthError}
        wakeAttempt={wakeAttempt}
        wakeMaxAttempts={15}
        onRetryHealth={() => void refreshHealth()}
      />

      {report && (
        <WorkspaceSubNav
          activeTab={subTab}
          onChangeTab={setSubTab}
          report={report}
          hasReference={audioState.hasReference}
          onOpenMentor={() => setMentorOpen(true)}
        />
      )}

      <main className="flex-1 px-4 pb-10 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {!report ? (
            <motion.div
              key="upload-stage"
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: STUDIO_EASE }}
            >
              <UploadStage
                genre={genre}
                onGenreChange={setGenre}
                stage={stage}
                onStageChange={setStage}
                artistVision={artistVision}
                onToggleVision={handleToggleVision}
                isAnalyzing={isAnalyzing}
                activeStepIndex={activeStepIndex}
                errorMessage={uploadError}
                healthStatus={healthStatus}
                onRetryHealth={() => void refreshHealth()}
                onAnalyzeFile={handleAnalyzeFile}
                onLoadDemo={handleLoadDemo}
              />
            </motion.div>
          ) : subTab === "diagnosis" ? (
            mode === "simple" ? (
              <motion.div
                key="simple-view"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: STUDIO_EASE }}
              >
                <SimpleView
                  report={report}
                  isPlaying={audioState.isPlaying}
                  activeFindingId={activeFindingId}
                  onTogglePlay={() => void studioAudioEngine.togglePlay()}
                  onAuditionFinding={(f) => void handleAuditionFinding(f)}
                  onSelectFinding={(f) => setActiveFindingId(f.evidence_id)}
                  onOpenAdvanced={() => setMode("advanced")}
                  onNewUpload={handleClearSession}
                />
              </motion.div>
            ) : (
              <motion.div
                key="advanced-workbench"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: STUDIO_EASE }}
              >
                <AdvancedWorkbench
                  report={report}
                  activeFindingId={activeFindingId}
                  loopEnabled={audioState.loopEnabled}
                  loopStartSec={audioState.loopStartSec}
                  loopEndSec={audioState.loopEndSec}
                  onSeek={(sec) => void studioAudioEngine.seek(sec)}
                  onSelectFinding={(f) => setActiveFindingId(f.evidence_id)}
                  onAuditionFinding={(f) => void handleAuditionFinding(f)}
                />
              </motion.div>
            )
          ) : subTab === "reference" ? (
            <motion.div
              key="reference-ab"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: STUDIO_EASE }}
            >
              <ReferenceABView
                report={report}
                referenceMeta={referenceMeta}
                activeSource={audioState.activeSource}
                matchLoudness={audioState.matchLoudness}
                loudnessOffsetDb={audioState.loudnessOffsetDb}
                isUploadingRef={isUploadingRef}
                onUploadReference={(f) => void handleUploadReference(f)}
                onLoadDemoReference={() => void handleLoadDemoReference()}
                onChangeSource={(slot: AudioSourceSlot) =>
                  void studioAudioEngine.setActiveSource(slot)
                }
                onToggleMatchLoudness={(val) => studioAudioEngine.setMatchLoudness(val)}
                onAuditionWindow={(start, end) => void handleAuditionWindow(start, end)}
              />
            </motion.div>
          ) : subTab === "stems" ? (
            <motion.div
              key="stems-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: STUDIO_EASE }}
            >
              <StemsInspector
                report={report}
                isUploading={isUploadingStems}
                errorMessage={stemError}
                onUploadStems={(files) => void handleUploadStems(files)}
                onLoadDemoStems={() => void handleLoadDemoStems()}
                onSaveDawContext={(ctx) => void handleSaveDawContext(ctx)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="revision-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: STUDIO_EASE }}
            >
              <RevisionInspector
                report={report}
                activeSource={audioState.activeSource}
                isUploading={isUploadingRevision}
                errorMessage={revisionError}
                onUploadRevision={(f) => void handleUploadRevision(f)}
                onLoadDemoRevision={() => void handleLoadDemoRevision()}
                onAuditionBaseline={() => {
                  void studioAudioEngine.setActiveSource("primary").then(() =>
                    studioAudioEngine.play()
                  );
                }}
                onAuditionRevised={() => {
                  void studioAudioEngine.setActiveSource("revised").then(() =>
                    studioAudioEngine.play()
                  );
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {report && (
        <>
          <BottomTransportDock
            durationSec={report.audio_metadata.duration_sec}
            isPlaying={audioState.isPlaying}
            activeSource={audioState.activeSource}
            stereoMode={audioState.stereoMode}
            deviceProfile={audioState.deviceProfile}
            matchLoudness={audioState.matchLoudness}
            loudnessOffsetDb={audioState.loudnessOffsetDb}
            loopEnabled={audioState.loopEnabled}
            hasReference={audioState.hasReference}
            hasRevised={audioState.hasRevised}
            onTogglePlay={() => void studioAudioEngine.togglePlay()}
            onToggleLoop={() => studioAudioEngine.setLoop(!audioState.loopEnabled)}
            onSeek={(sec) => void studioAudioEngine.seek(sec)}
            onChangeSource={(slot: AudioSourceSlot) =>
              void studioAudioEngine.setActiveSource(slot)
            }
            onChangeStereo={(sMode: StereoMode) => studioAudioEngine.setStereoMode(sMode)}
            onChangeDevice={(profile: DeviceProfile) =>
              studioAudioEngine.setDeviceProfile(profile)
            }
            onToggleMatchLoudness={(val: boolean) => studioAudioEngine.setMatchLoudness(val)}
          />

          <MentorDrawer
            open={mentorOpen}
            onClose={() => setMentorOpen(false)}
            report={report}
            mentorAdvice={mentorAdvice}
            isAskingMentor={isAskingMentor}
            onAskMentor={(req) => void handleAskMentor(req)}
            onSaveDawContext={(ctx) => void handleSaveDawContext(ctx)}
            onJumpToEvidence={handleJumpEvidence}
          />
        </>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { studioAudioEngine, type AudioSourceSlot, type DeviceProfile, type StereoMode } from "@/audio/StudioAudioEngine";
import { StudioHeader, type WorkspaceMode } from "@/components/StudioHeader";
import { UploadStage } from "@/components/UploadStage";
import { AdvancedWorkbench } from "@/components/advanced/AdvancedWorkbench";
import { SimpleView } from "@/components/simple/SimpleView";
import {
  analyzeMixFile,
  askMentor,
  clearSession,
  compareDemoRevision,
  compareRevisedMix,
  loadDemoReferenceTrack,
  loadDemoSession,
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
  Finding,
  GenreType,
  MentorRequest,
  MentorResponse,
  ReferenceTrackMeta,
  StageType,
} from "@/types/report";

export default function MixBenchPage() {
  const [mode, setMode] = useState<WorkspaceMode>("simple");
  const [genre, setGenre] = useState<GenreType>("electronic");
  const [stage, setStage] = useState<StageType>("unmastered_mix");
  const [artistVision, setArtistVision] = useState<ArtistVisionTag[]>(["punchy", "wide"]);

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

  useEffect(() => {
    return studioAudioEngine.subscribe(() => {
      setAudioState(studioAudioEngine.getState());
    });
  }, []);

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
    setReport(nextReport);
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
      // Allow inspection of report metrics even if browser audio context awaits user gesture
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
      const next = await loadDemoSession({ genre, stage, artistVision });
      await hydrateSessionReport(next);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Could not reach backend API. Ensure FastAPI is running on port 8000."
      );
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
      const updated = await compareDemoRevision(report.session_id);
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
      setRevisionError(err instanceof Error ? err.message : "Demo revision comparison failed.");
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

  const handleClearSession = async () => {
    const sid = report?.session_id;
    studioAudioEngine.reset();
    setReport(null);
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
    <div className="min-h-screen bg-[#FAFAFA]">
      <StudioHeader
        mode={mode}
        onModeChange={setMode}
        report={report}
        onClearSession={handleClearSession}
      />

      <main className="px-4 pb-16 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {!report ? (
            <motion.div
              key="upload-stage"
              initial={{ opacity: 0, y: 10 }}
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
                onAnalyzeFile={handleAnalyzeFile}
                onLoadDemo={handleLoadDemo}
              />
            </motion.div>
          ) : mode === "simple" ? (
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
                audioState={audioState}
                referenceMeta={referenceMeta}
                mentorAdvice={mentorAdvice}
                isUploadingRef={isUploadingRef}
                isUploadingStems={isUploadingStems}
                isUploadingRevision={isUploadingRevision}
                isAskingMentor={isAskingMentor}
                stemError={stemError}
                revisionError={revisionError}
                onSeek={(sec) => void studioAudioEngine.seek(sec)}
                onTogglePlay={() => void studioAudioEngine.togglePlay()}
                onToggleLoop={() =>
                  studioAudioEngine.setLoop(!audioState.loopEnabled)
                }
                onChangeSource={(slot: AudioSourceSlot) =>
                  void studioAudioEngine.setActiveSource(slot)
                }
                onChangeStereo={(sMode: StereoMode) =>
                  studioAudioEngine.setStereoMode(sMode)
                }
                onChangeDevice={(profile: DeviceProfile) =>
                  studioAudioEngine.setDeviceProfile(profile)
                }
                onToggleMatchLoudness={(val: boolean) =>
                  studioAudioEngine.setMatchLoudness(val)
                }
                onUploadReference={(f) => void handleUploadReference(f)}
                onLoadDemoReference={() => void handleLoadDemoReference()}
                onUploadStems={(files) => void handleUploadStems(files)}
                onLoadDemoStems={() => void handleLoadDemoStems()}
                onUploadRevision={(f) => void handleUploadRevision(f)}
                onLoadDemoRevision={() => void handleLoadDemoRevision()}
                onAuditionRevised={() => {
                  void studioAudioEngine.setActiveSource("revised").then(() =>
                    studioAudioEngine.play()
                  );
                }}
                onSelectFinding={(f) => setActiveFindingId(f.evidence_id)}
                onAuditionFinding={(f) => void handleAuditionFinding(f)}
                onAskMentor={(req) => void handleAskMentor(req)}
                onSaveDawContext={(ctx) => void handleSaveDawContext(ctx)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

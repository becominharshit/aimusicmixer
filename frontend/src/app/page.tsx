"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { User } from "@supabase/supabase-js";
import { AlertCircle, BookmarkPlus, CheckCircle2, SlidersHorizontal } from "lucide-react";
import {
  studioAudioEngine,
  type AudioSourceSlot,
  type CorrectiveEqConfig,
  type DeviceProfile,
  type StereoMode,
} from "@/audio/StudioAudioEngine";
import { BottomTransportDock } from "@/components/BottomTransportDock";
import { deriveAutoFixEqBands } from "@/components/FindingCard";
import { StudioHeader, type HealthStatus, type WorkspaceMode } from "@/components/StudioHeader";
import { UploadStage } from "@/components/UploadStage";
import { AdvancedWorkbench } from "@/components/advanced/AdvancedWorkbench";
import { RevisionInspector } from "@/components/advanced/RevisionInspector";
import { StemsInspector } from "@/components/advanced/StemsInspector";
import { AuthModal } from "@/components/auth/AuthModal";
import { SavedMixHistoryDrawer } from "@/components/auth/SavedMixHistoryDrawer";
import { MentorDrawer } from "@/components/privacy/MentorDrawer";
import { SimpleView } from "@/components/simple/SimpleView";
import { ReferenceABView } from "@/components/workspace/ReferenceABView";
import { WorkspaceSubNav, type WorkspaceSubTab } from "@/components/workspace/WorkspaceSubNav";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  analyzeMixFile,
  askMentor,
  checkBackendHealth,
  clearSession,
  compareRevisedMix,
  compareSavedReports,
  fetchPublicDemoFile,
  loadDemoReferenceTrack,
  loadDemoStems,
  resolveApiUrl,
  updateSessionContext,
  uploadReferenceTrack,
  uploadUserStems,
} from "@/lib/api";
import { STUDIO_EASE } from "@/lib/motion";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  DEFAULT_PRIVACY_PREFERENCES,
  deleteSavedAnalysis,
  enableAnalysisShareLink,
  fetchOrCreateUserProfile,
  fetchSavedAnalyses,
  getSignedMixProxyUrl,
  saveProfilePrivacyPreferences,
  saveUserAnalysis,
  uploadMixProxyToStorage,
  type PrivacyPreferences,
  type SavedAnalysisRecord,
} from "@/lib/supabase/storage";
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

const VALID_SUBTABS = new Set<WorkspaceSubTab>(["diagnosis", "reference", "stems", "revisions"]);

const GENRE_OPTIONS: { value: GenreType; label: string }[] = [
  { value: "electronic", label: "Electronic / Dance" },
  { value: "pop", label: "Pop / Modern Vocal" },
  { value: "hip_hop", label: "Hip-Hop / Trap" },
  { value: "rock", label: "Rock / Indie" },
  { value: "acoustic", label: "Acoustic / Folk / Jazz" },
  { value: "ambient", label: "Ambient / Film" },
  { value: "other", label: "Other / Experimental" },
];

export default function MixBenchPage() {
  const [mode, setMode] = useState<WorkspaceMode>("simple");
  const [subTab, setSubTab] = useState<WorkspaceSubTab>("diagnosis");
  const [mentorOpen, setMentorOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authInitialError, setAuthInitialError] = useState<string | null>(null);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [privacyPrefs, setPrivacyPrefs] = useState<PrivacyPreferences>(DEFAULT_PRIVACY_PREFERENCES);
  const [privacySaveState, setPrivacySaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysisRecord[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isComparingSaved, setIsComparingSaved] = useState(false);
  const supabaseConfigured = isSupabaseConfigured();

  const [genre, setGenre] = useState<GenreType>("electronic");
  const [stage, setStage] = useState<StageType>("unmastered_mix");
  const [artistVision, setArtistVision] = useState<ArtistVisionTag[]>(["punchy", "wide"]);

  const [healthStatus, setHealthStatus] = useState<HealthStatus>("checking");
  const [healthData, setHealthData] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [wakeAttempt, setWakeAttempt] = useState(0);

  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [isDemoSession, setIsDemoSession] = useState(false);
  const [demoSaved, setDemoSaved] = useState(false);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [referenceMeta, setReferenceMeta] = useState<ReferenceTrackMeta | null>(null);
  const [mentorAdvice, setMentorAdvice] = useState<MentorResponse | null>(null);
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [missingArchivedAudio, setMissingArchivedAudio] = useState(false);
  const [isUpdatingContext, setIsUpdatingContext] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [isUploadingRef, setIsUploadingRef] = useState(false);
  const [isUploadingStems, setIsUploadingStems] = useState(false);
  const [stemError, setStemError] = useState<string | null>(null);
  const [isUploadingRevision, setIsUploadingRevision] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [isAskingMentor, setIsAskingMentor] = useState(false);
  const [mentorError, setMentorError] = useState<string | null>(null);

  const [audioState, setAudioState] = useState(() => studioAudioEngine.getState());
  const stepTimerRef = useRef<number | null>(null);
  const wakeTimerRef = useRef<number | null>(null);
  const healthCycleRef = useRef(0);
  const healthStatusRef = useRef<HealthStatus>("checking");
  const uploadAbortRef = useRef<AbortController | null>(null);
  const privacyDebounceRef = useRef<number | null>(null);
  const prevPrivacyPrefsRef = useRef<PrivacyPreferences>(DEFAULT_PRIVACY_PREFERENCES);

  const reattachInputRef = useRef<HTMLInputElement | null>(null);

  // Sync ?tab= and ?auth_error= query params on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get("tab") as WorkspaceSubTab | null;
    if (initialTab && VALID_SUBTABS.has(initialTab)) {
      setSubTab(initialTab);
    }
    const authErrorParam = params.get("auth_error");
    if (authErrorParam) {
      setAuthInitialError(authErrorParam);
      setAuthPromptReason(null);
      setAuthOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("auth_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleChangeSubTab = useCallback((nextTab: WorkspaceSubTab) => {
    setSubTab(nextTab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", nextTab);
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleRecheckFinding = useCallback(() => {
    handleChangeSubTab("revisions");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [handleChangeSubTab]);

  const autoFixBands = useMemo(
    () => (report ? deriveAutoFixEqBands(report.findings) : []),
    [report]
  );

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

    const MAX_WAKE_ATTEMPTS = 24;
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

    const ACTIVE_HEARTBEAT_MS = 540_000;
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
      if (privacyDebounceRef.current) window.clearTimeout(privacyDebounceRef.current);
      unsubscribeAudio();
    };
  }, [refreshHealth, clearWakeTimer, setHealthState]);

  const loadUserCloudData = useCallback(async (user: User | null) => {
    if (!user) {
      setPrivacyPrefs(DEFAULT_PRIVACY_PREFERENCES);
      prevPrivacyPrefsRef.current = DEFAULT_PRIVACY_PREFERENCES;
      setSavedAnalyses([]);
      setHasMoreHistory(false);
      return;
    }

    setIsLoadingHistory(true);
    try {
      const [profile, page] = await Promise.all([
        fetchOrCreateUserProfile(user),
        fetchSavedAnalyses(user.id, 0, 25),
      ]);
      if (profile) {
        const nextPrefs: PrivacyPreferences = {
          allowMetricsAi: Boolean(profile.allow_metrics_ai),
          allowAudioAi: Boolean(profile.allow_metrics_ai && profile.allow_audio_ai),
          allowTrainingOptIn: Boolean(profile.allow_dataset_retention),
        };
        setPrivacyPrefs(nextPrefs);
        prevPrivacyPrefsRef.current = nextPrefs;
      } else {
        setPrivacyPrefs(DEFAULT_PRIVACY_PREFERENCES);
        prevPrivacyPrefsRef.current = DEFAULT_PRIVACY_PREFERENCES;
      }
      setSavedAnalyses(page.records);
      setHasMoreHistory(page.hasMore);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const handleLoadMoreHistory = async () => {
    if (!supabaseUser || isLoadingHistory || !hasMoreHistory) return;
    setIsLoadingHistory(true);
    try {
      const page = await fetchSavedAnalyses(supabaseUser.id, savedAnalyses.length, 25);
      setSavedAnalyses((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        for (const row of page.records) {
          if (!seen.has(row.id)) merged.push(row);
        }
        return merged;
      });
      setHasMoreHistory(page.hasMore);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const nextUser = data.session?.user ?? null;
      setSupabaseUser(nextUser);
      void loadUserCloudData(nextUser);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setSupabaseUser(nextUser);
      void loadUserCloudData(nextUser);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadUserCloudData]);

  const persistReportToSupabase = useCallback(
    async (
      nextReport: AnalysisReport,
      versionLabel: string,
      trackNameOverride?: string,
      parentAnalysisId?: string | null
    ): Promise<SavedAnalysisRecord | null> => {
      if (!supabaseUser) return null;
      const saved = await saveUserAnalysis({
        userId: supabaseUser.id,
        report: nextReport,
        versionLabel,
        trackNameOverride,
        parentAnalysisId,
      });
      if (saved) {
        setSavedAnalyses((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
        // Persist compressed audio proxy into private mix-proxies storage bucket in background
        if (nextReport.audio_metadata.playback_proxy_url) {
          void uploadMixProxyToStorage({
            userId: supabaseUser.id,
            analysisId: saved.id,
            proxyUrl: resolveApiUrl(nextReport.audio_metadata.playback_proxy_url),
          }).then((storagePath) => {
            if (storagePath) {
              setSavedAnalyses((prev) =>
                prev.map((item) =>
                  item.id === saved.id ? { ...item, proxy_storage_path: storagePath } : item
                )
              );
            }
          });
        }
      }
      return saved;
    },
    [supabaseUser]
  );

  // Debounced 400ms Supabase privacy sync with optimistic update and revert-on-error
  const handlePrivacyPrefsChange = (next: PrivacyPreferences) => {
    const previous = privacyPrefs;
    setPrivacyPrefs(next);
    if (!supabaseUser) return;

    if (privacyDebounceRef.current) {
      window.clearTimeout(privacyDebounceRef.current);
    }
    setPrivacySaveState("saving");
    privacyDebounceRef.current = window.setTimeout(async () => {
      const ok = await saveProfilePrivacyPreferences(supabaseUser.id, next);
      if (ok) {
        prevPrivacyPrefsRef.current = next;
        setPrivacySaveState("saved");
        window.setTimeout(() => {
          setPrivacySaveState((curr) => (curr === "saved" ? "idle" : curr));
        }, 2500);
      } else {
        setPrivacyPrefs(previous);
        setPrivacySaveState("error");
      }
    }, 400);
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setSupabaseUser(null);
    setPrivacyPrefs(DEFAULT_PRIVACY_PREFERENCES);
    setSavedAnalyses([]);
    setHasMoreHistory(false);
    setHistoryOpen(false);
  };

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

  const hydrateSessionReport = async (
    nextReport: AnalysisReport,
    options: {
      fromLiveBackend?: boolean;
      isDemo?: boolean;
      savedRecord?: SavedAnalysisRecord | null;
    } = {}
  ) => {
    const { fromLiveBackend = true, isDemo = false, savedRecord = null } = options;

    if (fromLiveBackend) {
      healthCycleRef.current += 1;
      clearWakeTimer();
      setWakeAttempt(0);
      setHealthError(null);
      setHealthState("online");
    } else {
      studioAudioEngine.reset();
    }
    studioAudioEngine.setAutoFixPreview(false, []);

    setReport(nextReport);
    setGenre(nextReport.context.genre);
    setStage(nextReport.context.stage);
    setArtistVision(nextReport.context.artist_vision);
    setIsDemoSession(isDemo);
    setDemoSaved(false);
    setActiveSavedId(savedRecord?.id ?? null);
    setMissingArchivedAudio(false);
    setReferenceMeta(null);
    setMentorAdvice(null);
    setMentorError(null);
    setStemError(null);
    setRevisionError(null);
    setActiveFindingId(nextReport.findings[0]?.evidence_id ?? null);

    try {
      await studioAudioEngine.loadSlot(
        "primary",
        resolveApiUrl(nextReport.audio_metadata.playback_proxy_url),
        nextReport.global_metrics.integrated_lufs
      );
      return;
    } catch {
      // Fall back to private Supabase Storage signed proxy URL if local ephemeral session expired
      if (savedRecord?.proxy_storage_path) {
        const signedUrl = await getSignedMixProxyUrl(savedRecord.proxy_storage_path);
        if (signedUrl) {
          try {
            await studioAudioEngine.loadSlot(
              "primary",
              signedUrl,
              nextReport.global_metrics.integrated_lufs
            );
            return;
          } catch {
            // Signed audio also unavailable
          }
        }
      }
      setMissingArchivedAudio(true);
    }
  };

  const handleAnalyzeFile = async (file: File) => {
    setUploadError(null);
    setIsAnalyzing(true);
    setUploadProgress(0);
    startStepper();
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      const next = await analyzeMixFile({
        file,
        genre,
        stage,
        artistVision,
        onProgress: (pct) => setUploadProgress(pct),
        signal: controller.signal,
      });
      await hydrateSessionReport(next, { fromLiveBackend: true, isDemo: false });
      const saved = await persistReportToSupabase(next, "v1");
      if (saved) setActiveSavedId(saved.id);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setUploadError("Upload cancelled.");
      } else {
        setUploadError(err instanceof Error ? err.message : "Failed to analyze uploaded mix.");
        void refreshHealth();
      }
    } finally {
      uploadAbortRef.current = null;
      setUploadProgress(null);
      stopStepper();
      setIsAnalyzing(false);
    }
  };

  const handleCancelUpload = () => {
    uploadAbortRef.current?.abort();
  };

  const handleLoadDemo = async () => {
    setUploadError(null);
    setIsAnalyzing(true);
    setUploadProgress(null);
    startStepper();
    try {
      const demoFile = await fetchPublicDemoFile(
        "/demo/demo-flawed-v1.wav",
        "demo-flawed-v1.wav"
      );
      const next = await analyzeMixFile({ file: demoFile, genre, stage, artistVision });
      // Do NOT auto-insert demo runs into user's Supabase history
      await hydrateSessionReport(next, { fromLiveBackend: true, isDemo: true });
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

  const handleSaveDemoToHistory = async () => {
    if (!report || !supabaseUser) return;
    const saved = await persistReportToSupabase(report, "v1");
    if (saved) {
      setDemoSaved(true);
      setActiveSavedId(saved.id);
    }
  };

  const handleWorkspaceContextChange = async (nextGenre: GenreType, nextStage: StageType) => {
    setGenre(nextGenre);
    setStage(nextStage);
    if (!report) return;
    setIsUpdatingContext(true);
    try {
      const updated = await updateSessionContext(report.session_id, {
        genre: nextGenre,
        stage: nextStage,
        artist_vision: artistVision,
      });
      setReport(updated);
    } catch {
      // Keep UI responsive even if ephemeral session expired on archived report
    } finally {
      setIsUpdatingContext(false);
    }
  };

  const handleToggleVision = (tag: ArtistVisionTag) => {
    setArtistVision((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleAuditionFinding = async (finding: Finding) => {
    if (!audioState.hasPrimary) return;
    setActiveFindingId(finding.evidence_id);
    await studioAudioEngine.auditionRange(
      finding.timestamp_start_sec,
      Math.max(finding.timestamp_start_sec + 4, finding.timestamp_end_sec)
    );
  };

  const handleAuditionWindow = async (startSec: number, endSec: number) => {
    if (!audioState.hasPrimary) return;
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
        void persistReportToSupabase(
          updated,
          "v2",
          updated.revision_comparison.revised_filename,
          activeSavedId
        );
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
        // Do NOT auto-insert demo revision into Supabase analyses
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

  const handleCompareWithSavedBaseline = async (baselineReport: AnalysisReport) => {
    if (!report) return;
    setRevisionError(null);
    setIsComparingSaved(true);
    try {
      const comparison = await compareSavedReports(baselineReport, report);
      const updatedReport: AnalysisReport = {
        ...report,
        revision_comparison: comparison,
      };
      setReport(updatedReport);
      handleChangeSubTab("revisions");
      const baselineRecord = savedAnalyses.find(
        (s) => s.report_json.report_id === baselineReport.report_id
      );
      void persistReportToSupabase(
        updatedReport,
        "v2",
        `${baselineReport.audio_metadata.filename} → ${report.audio_metadata.filename}`,
        baselineRecord?.id ?? null
      );
    } catch (err) {
      setRevisionError(err instanceof Error ? err.message : "Cross-session comparison failed.");
    } finally {
      setIsComparingSaved(false);
    }
  };

  const handleDeleteSavedAnalysis = async (
    analysisId: string,
    proxyStoragePath?: string | null
  ) => {
    if (!supabaseUser) return;
    const deleted = await deleteSavedAnalysis(supabaseUser.id, analysisId, proxyStoragePath);
    if (deleted) {
      setSavedAnalyses((prev) => prev.filter((item) => item.id !== analysisId));
    }
  };

  const handleAskMentor = async (req: MentorRequest) => {
    if (!report) return;
    setMentorError(null);
    setIsAskingMentor(true);
    try {
      const advice = await askMentor(report.session_id, req);
      setMentorAdvice(advice);
      setReport((prev) => (prev ? { ...prev, privacy_audit: advice.privacy_audit } : prev));
    } catch (err) {
      setMentorError(
        err instanceof Error
          ? err.message
          : "AI Mix Mentor request failed. Please retry or use Offline Deterministic Mentor."
      );
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
    const updated = await updateSessionContext(report.session_id, ctx);
    setReport(updated);
  };

  const handleJumpEvidence = (evidenceId: string) => {
    if (!report) return;
    const match = report.findings.find((f) => f.evidence_id === evidenceId);
    if (match) {
      handleChangeSubTab("diagnosis");
      void handleAuditionFinding(match);
    } else if (report.stem_analysis?.overlap_matrix.some((o) => o.evidence_id === evidenceId)) {
      handleChangeSubTab("stems");
    }
  };

  const handleClearSession = async () => {
    const sid = report?.session_id;
    studioAudioEngine.reset();
    setReport(null);
    setIsDemoSession(false);
    setDemoSaved(false);
    setActiveSavedId(null);
    setMissingArchivedAudio(false);
    handleChangeSubTab("diagnosis");
    setMentorOpen(false);
    setReferenceMeta(null);
    setMentorAdvice(null);
    setMentorError(null);
    setActiveFindingId(null);
    if (sid) {
      try {
        await clearSession(sid);
      } catch {
        // Ignore network errors when clearing expired session
      }
    }
  };

  const handleOpenSignedOutHistory = () => {
    setAuthInitialError(null);
    setAuthPromptReason(
      "Sign in to unlock persistent Cloud Mix History, cross-session v1 → v2 comparisons, and private Audio Proxy playback."
    );
    setAuthOpen(true);
  };

  const handleShareReviewLink = async (): Promise<boolean> => {
    if (!report) return false;
    if (!supabaseUser) {
      setAuthInitialError(null);
      setAuthPromptReason(
        "Sign in to generate and copy a read-only Client Review Link for this deterministic mix report."
      );
      setAuthOpen(true);
      return false;
    }

    let targetId = activeSavedId;
    if (!targetId) {
      const saved = await persistReportToSupabase(report, "v1");
      if (!saved) return false;
      targetId = saved.id;
      setActiveSavedId(saved.id);
    }

    const existing = savedAnalyses.find((item) => item.id === targetId);
    const token = await enableAnalysisShareLink(
      supabaseUser.id,
      targetId,
      existing?.share_token ?? null
    );
    if (!token) return false;

    setSavedAnalyses((prev) =>
      prev.map((item) =>
        item.id === targetId ? { ...item, share_token: token, is_public: true } : item
      )
    );

    if (typeof window !== "undefined") {
      const shareUrl = `${window.location.origin}/share/${token}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        // Clipboard permission unavailable in headless or restricted context
      }
    }
    return true;
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAFA]">
      <StudioHeader
        mode={mode}
        onModeChange={(nextMode) => {
          setMode(nextMode);
          if (report) handleChangeSubTab("diagnosis");
        }}
        report={report}
        onClearSession={handleClearSession}
        healthStatus={healthStatus}
        healthData={healthData}
        healthError={healthError}
        wakeAttempt={wakeAttempt}
        wakeMaxAttempts={24}
        onRetryHealth={() => void refreshHealth()}
        supabaseConfigured={supabaseConfigured}
        userEmail={supabaseUser?.email ?? null}
        savedCount={savedAnalyses.length}
        onOpenAuth={() => {
          setAuthInitialError(null);
          setAuthPromptReason(null);
          setAuthOpen(true);
        }}
        onSignOut={() => void handleSignOut()}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenSignedOutHistory={handleOpenSignedOutHistory}
        onShareReviewLink={handleShareReviewLink}
      />

      {report && (
        <WorkspaceSubNav
          activeTab={subTab}
          onChangeTab={handleChangeSubTab}
          report={report}
          hasReference={audioState.hasReference}
          onOpenMentor={() => setMentorOpen(true)}
        />
      )}

      {report && (
        <div className="no-print border-b border-[rgba(24,34,32,0.05)] bg-[#FFFFFF]/80">
          <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-medium text-[#52605D]">
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#3A7269]" aria-hidden="true" />
                Live Context:
              </span>
              <Select
                value={genre}
                disabled={isUpdatingContext}
                onValueChange={(v) => void handleWorkspaceContextChange(v as GenreType, stage)}
              >
                <SelectTrigger className="h-7 w-[170px] text-xs" aria-label="Session Genre Context">
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
              <div className="inline-flex bg-[#F5F5F7] p-0.5 hairline-border squircle-inner">
                {(
                  [
                    { id: "unmastered_mix", label: "Unmastered" },
                    { id: "final_master", label: "Master" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isUpdatingContext}
                    onClick={() => void handleWorkspaceContextChange(genre, item.id)}
                    className={`px-2 py-0.5 text-[11px] font-medium squircle-inner cursor-pointer ${
                      stage === item.id ? "bg-[#FFFFFF] text-[#182220] hairline-border" : "text-[#52605D]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {isUpdatingContext && (
                <span className="text-[11px] text-[#3A7269]">Re-evaluating rules…</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isDemoSession && supabaseUser && (
                <button
                  type="button"
                  disabled={demoSaved}
                  onClick={() => void handleSaveDemoToHistory()}
                  className="inline-flex items-center gap-1.5 bg-[#EBF3F1] px-2.5 py-1 text-[11px] font-medium text-[#3A7269] hover:bg-[#DFECE9] squircle-inner cursor-pointer disabled:opacity-70"
                >
                  {demoSaved ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#15803D]" aria-hidden="true" />
                      Demo Saved to History
                    </>
                  ) : (
                    <>
                      <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Save Demo to History
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {report && missingArchivedAudio && (
        <div className="no-print mx-auto mt-3 w-full max-w-[1380px] px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#FEF7EC] px-4 py-2.5 text-xs text-[#B45309] border border-[rgba(180,83,9,0.22)] squircle-inner">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Archived session telemetry loaded. Ephemeral audio buffer expired on server — re-attach your local WAV/MP3 to enable waveform auditioning.
              </span>
            </div>
            <div>
              <input
                ref={reattachInputRef}
                type="file"
                accept=".wav,.flac,.mp3,.aiff,.aif,.ogg,.m4a,.aac"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAnalyzeFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => reattachInputRef.current?.click()}
                className="bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#182220] hairline-border squircle-inner cursor-pointer"
              >
                Re-attach Local Audio
              </button>
            </div>
          </div>
        </div>
      )}

      <main className={`flex-1 px-4 sm:px-6 ${report ? "pb-28 sm:pb-16" : "pb-10"}`}>
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
                uploadProgress={uploadProgress}
                onCancelUpload={handleCancelUpload}
                errorMessage={uploadError}
                healthStatus={healthStatus}
                onRetryHealth={() => void refreshHealth()}
                onAnalyzeFile={handleAnalyzeFile}
                onLoadDemo={handleLoadDemo}
                savedAnalyses={savedAnalyses}
                onLoadSavedReport={(savedRep) => {
                  const rec = savedAnalyses.find(
                    (s) => s.report_json.report_id === savedRep.report_id
                  );
                  void hydrateSessionReport(savedRep, {
                    fromLiveBackend: false,
                    savedRecord: rec ?? null,
                  });
                }}
                onOpenHistory={() => setHistoryOpen(true)}
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
                  hasAudio={audioState.hasPrimary}
                  activeFindingId={activeFindingId}
                  activeCorrectiveEqId={audioState.activeCorrectiveEqId}
                  onTogglePlay={() => void studioAudioEngine.togglePlay()}
                  onAuditionFinding={(f) => void handleAuditionFinding(f)}
                  onSelectFinding={(f) => setActiveFindingId(f.evidence_id)}
                  onRecheckFinding={handleRecheckFinding}
                  onToggleCorrectiveEq={(eq: CorrectiveEqConfig) =>
                    studioAudioEngine.setCorrectiveEq(eq)
                  }
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
                  hasAudio={audioState.hasPrimary}
                  activeFindingId={activeFindingId}
                  activeCorrectiveEqId={audioState.activeCorrectiveEqId}
                  loopEnabled={audioState.loopEnabled}
                  loopStartSec={audioState.loopStartSec}
                  loopEndSec={audioState.loopEndSec}
                  onSeek={(sec) => void studioAudioEngine.seek(sec)}
                  onSelectFinding={(f) => setActiveFindingId(f.evidence_id)}
                  onAuditionFinding={(f) => void handleAuditionFinding(f)}
                  onRecheckFinding={handleRecheckFinding}
                  onToggleCorrectiveEq={(eq: CorrectiveEqConfig) =>
                    studioAudioEngine.setCorrectiveEq(eq)
                  }
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
                matchLoudness={audioState.matchLoudness}
                loudnessOffsetDb={audioState.loudnessOffsetDb}
                hasBaselineAudio={audioState.hasPrimary}
                hasRevisedAudio={audioState.hasRevised}
                isUploading={isUploadingRevision || isComparingSaved}
                errorMessage={revisionError}
                onUploadRevision={(f) => void handleUploadRevision(f)}
                onLoadDemoRevision={() => void handleLoadDemoRevision()}
                onToggleMatchLoudness={(val) => studioAudioEngine.setMatchLoudness(val)}
                savedAnalyses={savedAnalyses}
                onCompareWithSavedBaseline={(baseline) =>
                  void handleCompareWithSavedBaseline(baseline)
                }
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
            autoFixEnabled={audioState.autoFixEnabled}
            canAutoFix={autoFixBands.length > 0}
            hasPrimary={audioState.hasPrimary}
            hasReference={audioState.hasReference}
            hasRevised={audioState.hasRevised}
            onTogglePlay={() => void studioAudioEngine.togglePlay()}
            onToggleLoop={() => studioAudioEngine.setLoop(!audioState.loopEnabled)}
            onToggleAutoFix={() =>
              studioAudioEngine.setAutoFixPreview(!audioState.autoFixEnabled, autoFixBands)
            }
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
            mentorError={mentorError}
            onDismissMentorError={() => setMentorError(null)}
            privacyPrefs={privacyPrefs}
            onPrivacyPrefsChange={handlePrivacyPrefsChange}
            privacySaveState={privacySaveState}
            isSignedIn={Boolean(supabaseUser)}
            onAskMentor={handleAskMentor}
            onSaveDawContext={(ctx) => void handleSaveDawContext(ctx)}
            onJumpToEvidence={handleJumpEvidence}
          />
        </>
      )}

      <footer className="no-print border-t border-[rgba(24,34,32,0.06)] bg-[#FAFAFA] py-4 text-[11px] text-[#7D8C88]">
        <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <span>
            MixBench Studio · Deterministic DSP Truth · Zero-Audio-by-Default · Ephemeral 60-min processing
          </span>
          <nav aria-label="Legal and privacy links" className="flex items-center gap-4">
            <Link href="/privacy" className="font-medium text-[#52605D] hover:text-[#182220]">
              Privacy Policy
            </Link>
            <Link href="/terms" className="font-medium text-[#52605D] hover:text-[#182220]">
              Terms of Use
            </Link>
          </nav>
        </div>
      </footer>

      <AuthModal
        open={authOpen}
        onOpenChange={setAuthOpen}
        initialError={authInitialError}
        promptReason={authPromptReason}
      />
      <SavedMixHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        analyses={savedAnalyses}
        hasMore={hasMoreHistory}
        isLoading={isLoadingHistory}
        activeReport={report}
        isComparingSaved={isComparingSaved}
        onRefresh={() => {
          if (supabaseUser) void loadUserCloudData(supabaseUser);
        }}
        onLoadMore={() => void handleLoadMoreHistory()}
        onLoadReport={(record) =>
          void hydrateSessionReport(record.report_json, {
            fromLiveBackend: false,
            savedRecord: record,
          })
        }
        onCompareAgainstActive={(baseline) => void handleCompareWithSavedBaseline(baseline)}
        onDeleteAnalysis={(id, proxyPath) => void handleDeleteSavedAnalysis(id, proxyPath)}
      />
    </div>
  );
}

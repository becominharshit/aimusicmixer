"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "motion/react";
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
import type { HealthStatus, WorkspaceMode } from "@/components/StudioHeader";
import { UploadStage } from "@/components/UploadStage";
import { AdvancedWorkbench } from "@/components/advanced/AdvancedWorkbench";
import { RevisionInspector } from "@/components/advanced/RevisionInspector";
import { StemsInspector } from "@/components/advanced/StemsInspector";
import { AuthModal } from "@/components/auth/AuthModal";
import { SavedMixHistoryDrawer } from "@/components/auth/SavedMixHistoryDrawer";
import { MentorDrawer } from "@/components/privacy/MentorDrawer";
import { KeyboardShortcutsModal } from "@/components/shared/KeyboardShortcutsModal";
import { SimpleView } from "@/components/simple/SimpleView";
import { AddAudioModal } from "@/components/studio/AddAudioModal";
import { StudioShell } from "@/components/studio/StudioShell";
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
  COMPARE_REQUEST_TIMEOUT_MS,
  MENTOR_REQUEST_TIMEOUT_MS,
  PRECISION_SYNC_TIMEOUT_MS,
  analyzeMixFile,
  askMentor,
  askMentorStandalone,
  checkBackendHealth,
  clearSession,
  compareDemoRevision,
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
import { analyzeFileWithWebAudioFallback } from "@/lib/clientWebAudioDsp";
import { STUDIO_EASE } from "@/lib/motion";
import {
  audioBufferToWavFile,
  consumePendingDawMixdown,
  deriveDawFixPreset,
  hasPendingDawMixdown,
  setPendingStudioToDawHandoff,
} from "@/lib/pendingDawMixdown";
import { loadRepairChecklist, saveRepairChecklist } from "@/lib/repairChecklist";
import {
  cacheStudioAudioBlob,
  clearStudioAudioCache,
  deleteCachedStudioAudioBlob,
  getCachedStudioAudioBlob,
} from "@/lib/studioAudioCache";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  DEFAULT_PRIVACY_PREFERENCES,
  deleteSavedAnalysis,
  enableAnalysisShareLink,
  fetchOrCreateUserProfile,
  fetchSavedAnalyses,
  fetchSignedMixProxyBlob,
  getSignedMixProxyUrl,
  normalizePrivacyPreferences,
  purgeUserAccountData,
  saveProfilePrivacyPreferences,
  saveUserAnalysis,
  updateSavedAnalysisChecklistProgress,
  uploadMixProxyToStorage,
  type PrivacyPreferences,
  type SavedAnalysisRecord,
} from "@/lib/supabase/storage";
import { applyStudioTheme } from "@/lib/theme";
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

export function StudioWorkbench() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [mode, setMode] = useState<WorkspaceMode>("simple");
  const [subTab, setSubTab] = useState<WorkspaceSubTab>("diagnosis");
  const [mentorOpen, setMentorOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authInitialError, setAuthInitialError] = useState<string | null>(null);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [addAudioOpen, setAddAudioOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isUpgradingPrecision, setIsUpgradingPrecision] = useState(false);
  const [precisionUpgradeError, setPrecisionUpgradeError] = useState<string | null>(null);

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
  const [completedRepairSteps, setCompletedRepairSteps] = useState<Record<string, boolean>>({});
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
  const mentorAbortRef = useRef<AbortController | null>(null);
  const mentorRequestSeqRef = useRef(0);
  const privacyDebounceRef = useRef<number | null>(null);
  const prevPrivacyPrefsRef = useRef<PrivacyPreferences>(DEFAULT_PRIVACY_PREFERENCES);
  const localObjectUrlRef = useRef<string | null>(null);
  const bgUpgradeTimerRef = useRef<number | null>(null);
  const bgUpgradeAbortRef = useRef<AbortController | null>(null);
  const bgUpgradeCycleRef = useRef(0);
  const pendingPrecisionUpgradeRef = useRef<{
    file: File;
    genre: GenreType;
    stage: StageType;
    artistVision: ArtistVisionTag[];
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const completedRepairStepsRef = useRef<Record<string, boolean>>({});
  const reportRef = useRef<AnalysisReport | null>(null);
  const userClearedRef = useRef(false);
  const autoRestoredUserIdRef = useRef<string | null>(null);
  const consumedDawHandoffRef = useRef(false);
  const checklistDebounceRef = useRef<number | null>(null);
  const pendingChecklistFlushRef = useRef<(() => Promise<void>) | null>(null);
  const activeAudioFileRef = useRef<File | null>(null);

  const reattachInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("mixit_sidebar_expanded_v1");
      if (saved === "1") setSidebarExpanded(true);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("mixit_sidebar_expanded_v1", next ? "1" : "0");
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const cancelBackgroundUpgrade = useCallback(() => {
    bgUpgradeCycleRef.current += 1;
    setIsUpgradingPrecision(false);
    setPrecisionUpgradeError(null);
    bgUpgradeAbortRef.current?.abort();
    bgUpgradeAbortRef.current = null;
    if (bgUpgradeTimerRef.current !== null) {
      window.clearTimeout(bgUpgradeTimerRef.current);
      bgUpgradeTimerRef.current = null;
    }
  }, []);

  const revokeLocalObjectUrl = useCallback(() => {
    if (localObjectUrlRef.current) {
      URL.revokeObjectURL(localObjectUrlRef.current);
      localObjectUrlRef.current = null;
    }
  }, []);

  const resetLocalAudioAndWorkspace = useCallback(() => {
    cancelBackgroundUpgrade();
    revokeLocalObjectUrl();
    uploadAbortRef.current?.abort();
    mentorRequestSeqRef.current += 1;
    mentorAbortRef.current?.abort();
    mentorAbortRef.current = null;
    setIsAskingMentor(false);
    activeAudioFileRef.current = null;
    studioAudioEngine.reset();
    setReport(null);
    setIsDemoSession(false);
    setDemoSaved(false);
    setActiveSavedId(null);
    setReferenceMeta(null);
    setMentorAdvice(null);
    setMentorError(null);
    setActiveFindingId(null);
    setCompletedRepairSteps({});
    completedRepairStepsRef.current = {};
    setMissingArchivedAudio(false);
    setAddAudioOpen(false);
    setMentorOpen(false);
    setHistoryOpen(false);
  }, [cancelBackgroundUpgrade, revokeLocalObjectUrl]);

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

  const resetStudioScrollToTop = useCallback(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  const handleChangeSubTab = useCallback(
    (nextTab: WorkspaceSubTab) => {
      setSubTab(nextTab);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", nextTab);
        window.history.replaceState({}, "", url.toString());
      }
      if (nextTab === "revisions") {
        resetStudioScrollToTop();
      }
    },
    [resetStudioScrollToTop]
  );

  useEffect(() => {
    if (subTab === "revisions") {
      resetStudioScrollToTop();
    }
  }, [subTab, resetStudioScrollToTop]);

  const handleRecheckFinding = useCallback(() => {
    handleChangeSubTab("revisions");
    resetStudioScrollToTop();
  }, [handleChangeSubTab, resetStudioScrollToTop]);

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
      bgUpgradeCycleRef.current += 1;
      clearWakeTimer();
      if (bgUpgradeTimerRef.current !== null) {
        window.clearTimeout(bgUpgradeTimerRef.current);
        bgUpgradeTimerRef.current = null;
      }
      if (localObjectUrlRef.current) {
        URL.revokeObjectURL(localObjectUrlRef.current);
        localObjectUrlRef.current = null;
      }
      window.clearInterval(heartbeatId);
      if (privacyDebounceRef.current) window.clearTimeout(privacyDebounceRef.current);
      if (checklistDebounceRef.current) window.clearTimeout(checklistDebounceRef.current);
      unsubscribeAudio();
    };
  }, [refreshHealth, clearWakeTimer, setHealthState]);

  const hydrateSessionReportRef = useRef<
    | ((
        nextReport: AnalysisReport,
        options?: {
          fromLiveBackend?: boolean;
          isDemo?: boolean;
          savedRecord?: SavedAnalysisRecord | null;
          localAudioBuffer?: AudioBuffer;
          localObjectUrl?: string;
          fallbackFile?: File;
          preserveRepairSteps?: Record<string, boolean>;
        }
      ) => Promise<void>)
    | null
  >(null);

  const loadUserCloudData = useCallback(async (user: User | null) => {
    if (!user) {
      setPrivacyPrefs(DEFAULT_PRIVACY_PREFERENCES);
      prevPrivacyPrefsRef.current = DEFAULT_PRIVACY_PREFERENCES;
      setSavedAnalyses([]);
      setHasMoreHistory(false);
      autoRestoredUserIdRef.current = null;
      return;
    }

    setIsLoadingHistory(true);
    try {
      const [profile, page] = await Promise.all([
        fetchOrCreateUserProfile(user),
        fetchSavedAnalyses(user.id, 0, 25),
      ]);
      if (profile) {
        const nextPrefs = normalizePrivacyPreferences(profile);
        setPrivacyPrefs(nextPrefs);
        prevPrivacyPrefsRef.current = nextPrefs;

        if (!reportRef.current && profile.default_genre) {
          const validGenres: GenreType[] = [
            "electronic",
            "pop",
            "hip_hop",
            "rock",
            "acoustic",
            "ambient",
            "other",
          ];
          if (validGenres.includes(profile.default_genre as GenreType)) {
            setGenre(profile.default_genre as GenreType);
          }
        }
        if (profile.default_theme === "dark" || profile.default_theme === "light") {
          applyStudioTheme(profile.default_theme);
        }
      } else {
        setPrivacyPrefs(DEFAULT_PRIVACY_PREFERENCES);
        prevPrivacyPrefsRef.current = DEFAULT_PRIVACY_PREFERENCES;
      }
      setSavedAnalyses(page.records);
      setHasMoreHistory(page.hasMore);

      // Auto-restore the user's most recent saved analysis across sign-out / sign-in
      if (
        page.records.length > 0 &&
        !reportRef.current &&
        !hasPendingDawMixdown() &&
        !userClearedRef.current &&
        autoRestoredUserIdRef.current !== user.id
      ) {
        autoRestoredUserIdRef.current = user.id;
        const latest = page.records[0];
        if (hydrateSessionReportRef.current) {
          await hydrateSessionReportRef.current(latest.report_json, {
            fromLiveBackend: false,
            savedRecord: latest,
          });
        }
      }
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

  // Strict client-side Supabase session guard for /studio
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      resetLocalAudioAndWorkspace();
      router.replace("/?signin=1");
      return;
    }

    let active = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      const nextUser = !error ? (data.user ?? null) : null;
      if (!nextUser) {
        resetLocalAudioAndWorkspace();
        setSupabaseUser(null);
        router.replace("/?signin=1");
        return;
      }
      setSupabaseUser(nextUser);
      setAuthChecked(true);
      void loadUserCloudData(nextUser);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user ?? null;
      if (event === "SIGNED_OUT" || !nextUser) {
        resetLocalAudioAndWorkspace();
        setSupabaseUser(null);
        setPrivacyPrefs(DEFAULT_PRIVACY_PREFERENCES);
        setSavedAnalyses([]);
        setHasMoreHistory(false);
        router.replace(event === "SIGNED_OUT" ? "/" : "/?signin=1");
        return;
      }
      setSupabaseUser(nextUser);
      setAuthChecked(true);
      void loadUserCloudData(nextUser);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadUserCloudData, resetLocalAudioAndWorkspace, router]);

  const persistReportToSupabase = useCallback(
    async (
      nextReport: AnalysisReport,
      versionLabel: string,
      trackNameOverride?: string,
      parentAnalysisId?: string | null,
      fallbackBlob?: Blob | null
    ): Promise<SavedAnalysisRecord | null> => {
      if (!supabaseUser) return null;
      const checklistProgress =
        nextReport.completed_repair_steps ?? completedRepairStepsRef.current;
      const saved = await saveUserAnalysis({
        userId: supabaseUser.id,
        report: nextReport,
        versionLabel,
        trackNameOverride,
        parentAnalysisId,
        checklistProgress,
      });
      if (saved) {
        setSavedAnalyses((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
        const blobToPersist = fallbackBlob ?? activeAudioFileRef.current ?? null;
        if (blobToPersist) {
          void cacheStudioAudioBlob([saved.id, nextReport.report_id], blobToPersist);
        }
        const rawProxy = nextReport.audio_metadata.playback_proxy_url || "";
        const resolvedProxyUrl =
          rawProxy && !rawProxy.startsWith("blob:") ? resolveApiUrl(rawProxy) : undefined;
        if (resolvedProxyUrl || blobToPersist) {
          void uploadMixProxyToStorage({
            userId: supabaseUser.id,
            analysisId: saved.id,
            proxyUrl: resolvedProxyUrl,
            fallbackBlob: blobToPersist,
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
    if (checklistDebounceRef.current) {
      window.clearTimeout(checklistDebounceRef.current);
      checklistDebounceRef.current = null;
    }
    if (pendingChecklistFlushRef.current) {
      const flush = pendingChecklistFlushRef.current;
      pendingChecklistFlushRef.current = null;
      await flush().catch(() => {});
    }
    userClearedRef.current = false;
    autoRestoredUserIdRef.current = null;
    resetLocalAudioAndWorkspace();
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSupabaseUser(null);
    setPrivacyPrefs(DEFAULT_PRIVACY_PREFERENCES);
    setSavedAnalyses([]);
    setHasMoreHistory(false);
    router.replace("/");
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
      localAudioBuffer?: AudioBuffer;
      localObjectUrl?: string;
      fallbackFile?: File;
      preserveRepairSteps?: Record<string, boolean>;
    } = {}
  ) => {
    const {
      fromLiveBackend = true,
      isDemo = false,
      savedRecord = null,
      localAudioBuffer,
      localObjectUrl,
      fallbackFile,
      preserveRepairSteps,
    } = options;

    if (fromLiveBackend) {
      healthCycleRef.current += 1;
      clearWakeTimer();
      setWakeAttempt(0);
      setHealthError(null);
      setHealthState("online");
      setIsUpgradingPrecision(false);
      revokeLocalObjectUrl();
    } else if (!localAudioBuffer) {
      setIsUpgradingPrecision(false);
      studioAudioEngine.reset();
    }
    setAddAudioOpen(false);
    studioAudioEngine.setAutoFixPreview(false, []);

    const hydratedSteps = {
      ...loadRepairChecklist(nextReport.report_id, nextReport.completed_repair_steps),
      ...(savedRecord?.checklist_progress ?? {}),
      ...(preserveRepairSteps ?? {}),
    };
    completedRepairStepsRef.current = hydratedSteps;
    setCompletedRepairSteps(hydratedSteps);
    if (Object.keys(hydratedSteps).length > 0) {
      saveRepairChecklist(nextReport.report_id, hydratedSteps);
    }

    const reportWithSteps: AnalysisReport =
      Object.keys(hydratedSteps).length > 0
        ? { ...nextReport, completed_repair_steps: hydratedSteps }
        : nextReport;

    setReport(reportWithSteps);
    setGenre(reportWithSteps.context.genre);
    setStage(reportWithSteps.context.stage);
    setArtistVision(reportWithSteps.context.artist_vision);
    setIsDemoSession(isDemo);
    setDemoSaved(Boolean(savedRecord));
    setActiveSavedId(savedRecord?.id ?? null);
    setMissingArchivedAudio(false);
    setReferenceMeta(null);
    setMentorAdvice(null);
    setMentorError(null);
    setStemError(null);
    setRevisionError(null);
    setActiveFindingId(reportWithSteps.findings[0]?.evidence_id ?? null);

    // 1. In-memory fresh AudioBuffer (instant during active local Web Audio preview)
    if (localAudioBuffer && localObjectUrl) {
      revokeLocalObjectUrl();
      localObjectUrlRef.current = localObjectUrl;
      studioAudioEngine.loadAudioBuffer(
        "primary",
        localAudioBuffer,
        reportWithSteps.global_metrics.integrated_lufs,
        localObjectUrl
      );
      if (fallbackFile) {
        void cacheStudioAudioBlob([savedRecord?.id, reportWithSteps.report_id], fallbackFile);
      }
      return;
    }

    // 2. Local IndexedDB cache first (instant restore on reload or sign-in across sessions)
    if (!fromLiveBackend) {
      const cachedBlob = await getCachedStudioAudioBlob([
        savedRecord?.id,
        reportWithSteps.report_id,
      ]);
      if (cachedBlob) {
        try {
          await studioAudioEngine.loadBlobSlot(
            "primary",
            cachedBlob,
            reportWithSteps.global_metrics.integrated_lufs,
            `idb:${savedRecord?.id || reportWithSteps.report_id}`
          );
          activeAudioFileRef.current = new File(
            [cachedBlob],
            reportWithSteps.audio_metadata.filename,
            { type: cachedBlob.type || "audio/wav" }
          );
          return;
        } catch {
          // Corrupted or unsupported cached blob — continue to Supabase Storage signed URL
        }
      }
    }

    // 3. Cross-device restore from private Supabase Storage signed URL (mix-proxies)
    if (!fromLiveBackend && savedRecord?.proxy_storage_path) {
      const downloaded = await fetchSignedMixProxyBlob(savedRecord.proxy_storage_path);
      if (downloaded) {
        try {
          await studioAudioEngine.loadBlobSlot(
            "primary",
            downloaded.blob,
            reportWithSteps.global_metrics.integrated_lufs,
            downloaded.signedUrl
          );
          activeAudioFileRef.current = new File(
            [downloaded.blob],
            reportWithSteps.audio_metadata.filename,
            { type: downloaded.blob.type || "audio/mp4" }
          );
          void cacheStudioAudioBlob([savedRecord.id, reportWithSteps.report_id], downloaded.blob);
          return;
        } catch {
          // Fall through to signed URL direct fetch or backend proxy URL
        }
      }
    }

    // 4. Live backend ephemeral proxy URL
    const rawProxyUrl = reportWithSteps.audio_metadata.playback_proxy_url || "";
    if (rawProxyUrl && !rawProxyUrl.startsWith("blob:")) {
      try {
        await studioAudioEngine.loadSlot(
          "primary",
          resolveApiUrl(rawProxyUrl),
          reportWithSteps.global_metrics.integrated_lufs
        );
        if (fallbackFile) {
          void cacheStudioAudioBlob([savedRecord?.id, reportWithSteps.report_id], fallbackFile);
        }
        return;
      } catch {
        // Proceed to local File or signed URL fallback
      }
    }

    // 5. Local File passed directly from upload flow
    if (fallbackFile) {
      try {
        await studioAudioEngine.loadFileSlot(
          "primary",
          fallbackFile,
          reportWithSteps.global_metrics.integrated_lufs
        );
        void cacheStudioAudioBlob([savedRecord?.id, reportWithSteps.report_id], fallbackFile);
        return;
      } catch {
        // Proceed to signed cloud proxy fallback
      }
    }

    // 6. Final fallback: Supabase Storage signed URL if fromLiveBackend proxy expired
    if (fromLiveBackend && savedRecord?.proxy_storage_path) {
      const signedUrl = await getSignedMixProxyUrl(savedRecord.proxy_storage_path);
      if (signedUrl) {
        try {
          await studioAudioEngine.loadSlot(
            "primary",
            signedUrl,
            reportWithSteps.global_metrics.integrated_lufs
          );
          return;
        } catch {
          // Signed audio unavailable
        }
      }
    }

    setMissingArchivedAudio(true);
  };

  hydrateSessionReportRef.current = hydrateSessionReport;

  const startBackgroundPrecisionUpgrade = useCallback(
    (
      file: File,
      targetGenre: GenreType,
      targetStage: StageType,
      targetVision: ArtistVisionTag[]
    ) => {
      cancelBackgroundUpgrade();
      const cycleId = ++bgUpgradeCycleRef.current;
      pendingPrecisionUpgradeRef.current = {
        file,
        genre: targetGenre,
        stage: targetStage,
        artistVision: targetVision,
      };
      setPrecisionUpgradeError(null);
      setIsUpgradingPrecision(true);

      const runUpgrade = async () => {
        if (bgUpgradeCycleRef.current !== cycleId) return;
        const controller = new AbortController();
        bgUpgradeAbortRef.current = controller;
        let timedOut = false;
        const timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, PRECISION_SYNC_TIMEOUT_MS);

        try {
          const serverReport = await analyzeMixFile({
            file,
            genre: targetGenre,
            stage: targetStage,
            artistVision: targetVision,
            signal: controller.signal,
            endpoint: "/api/v1/analyze",
          });
          if (bgUpgradeCycleRef.current !== cycleId) return;

          setHealthError(null);
          setHealthState("online");
          setIsUpgradingPrecision(false);
          setPrecisionUpgradeError(null);

          await hydrateSessionReport(serverReport, {
            fromLiveBackend: true,
            isDemo: false,
            fallbackFile: file,
            preserveRepairSteps: completedRepairStepsRef.current,
          });
          const saved = await persistReportToSupabase(
            {
              ...serverReport,
              completed_repair_steps: completedRepairStepsRef.current,
            },
            "v1",
            undefined,
            undefined,
            file
          );
          if (saved && bgUpgradeCycleRef.current === cycleId) {
            setActiveSavedId(saved.id);
          }
        } catch (err) {
          if (bgUpgradeCycleRef.current !== cycleId) return;
          setIsUpgradingPrecision(false);
          const isAbort =
            timedOut ||
            (err instanceof DOMException && err.name === "AbortError") ||
            (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"));
          setPrecisionUpgradeError(
            isAbort
              ? "Precision server sync timed out"
              : "Precision server sync timed out — server unreachable"
          );
        } finally {
          window.clearTimeout(timeoutId);
          if (bgUpgradeAbortRef.current === controller) {
            bgUpgradeAbortRef.current = null;
          }
        }
      };

      void runUpgrade();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cancelBackgroundUpgrade, persistReportToSupabase, setHealthState]
  );

  const handleRetryPrecisionSync = useCallback(() => {
    const pending = pendingPrecisionUpgradeRef.current;
    if (pending) {
      startBackgroundPrecisionUpgrade(
        pending.file,
        pending.genre,
        pending.stage,
        pending.artistVision
      );
      return;
    }
    const fallbackFile = activeAudioFileRef.current;
    if (fallbackFile) {
      startBackgroundPrecisionUpgrade(fallbackFile, genre, stage, artistVision);
    }
  }, [artistVision, genre, stage, startBackgroundPrecisionUpgrade]);

  const shouldFallbackToWebAudio = (err: unknown): boolean => {
    if (err instanceof DOMException && err.name === "AbortError") return false;
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (
      msg.includes("415") ||
      msg.includes("unsupported media") ||
      msg.includes("magic") ||
      msg.includes("413") ||
      msg.includes("too large") ||
      msg.includes("50 mb") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("422")
    ) {
      return false;
    }
    return true;
  };

  const handleAnalyzeFile = async (file: File) => {
    userClearedRef.current = false;
    activeAudioFileRef.current = file;
    cancelBackgroundUpgrade();
    setAddAudioOpen(false);
    setUploadError(null);
    setIsAnalyzing(true);
    setUploadProgress(0);
    startStepper();
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    const runLocalPreview = async () => {
      const localRes = await analyzeFileWithWebAudioFallback({
        file,
        genre,
        stage,
        artistVision,
      });
      await hydrateSessionReport(localRes.report, {
        fromLiveBackend: false,
        isDemo: false,
        localAudioBuffer: localRes.audioBuffer,
        localObjectUrl: localRes.objectUrl,
        fallbackFile: file,
      });
      const savedLocal = await persistReportToSupabase(
        localRes.report,
        "v1",
        undefined,
        undefined,
        file
      );
      if (savedLocal) setActiveSavedId(savedLocal.id);
      startBackgroundPrecisionUpgrade(file, genre, stage, artistVision);
      void refreshHealth();
    };

    try {
      if (healthStatusRef.current !== "online") {
        await runLocalPreview();
        return;
      }

      const next = await analyzeMixFile({
        file,
        genre,
        stage,
        artistVision,
        onProgress: (pct) => setUploadProgress(pct),
        signal: controller.signal,
      });
      await hydrateSessionReport(next, {
        fromLiveBackend: true,
        isDemo: false,
        fallbackFile: file,
      });
      const saved = await persistReportToSupabase(next, "v1", undefined, undefined, file);
      if (saved) setActiveSavedId(saved.id);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setUploadError("Upload cancelled.");
      } else if (shouldFallbackToWebAudio(err)) {
        try {
          await runLocalPreview();
        } catch {
          setUploadError(err instanceof Error ? err.message : "Failed to analyze uploaded mix.");
          void refreshHealth();
        }
      } else {
        setUploadError(err instanceof Error ? err.message : "Failed to analyze uploaded mix.");
      }
    } finally {
      uploadAbortRef.current = null;
      setUploadProgress(null);
      stopStepper();
      setIsAnalyzing(false);
    }
  };

  // Auto-consume 24-bit WAV mixdown handed off from /daw ("Analyze Mix ↗")
  useEffect(() => {
    if (!authChecked || !supabaseUser || consumedDawHandoffRef.current) return;
    if (!hasPendingDawMixdown()) return;
    const pendingFile = consumePendingDawMixdown();
    if (!pendingFile) return;
    consumedDawHandoffRef.current = true;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("from")) {
        url.searchParams.delete("from");
        window.history.replaceState({}, "", url.toString());
      }
    }
    void handleAnalyzeFile(pendingFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, supabaseUser]);

  const handleCancelUpload = () => {
    uploadAbortRef.current?.abort();
  };

  const handleLoadDemo = async () => {
    userClearedRef.current = false;
    cancelBackgroundUpgrade();
    setAddAudioOpen(false);
    setUploadError(null);
    setIsAnalyzing(true);
    setUploadProgress(null);
    startStepper();
    try {
      const demoFile = await fetchPublicDemoFile(
        "/demo/demo-flawed-v1.wav",
        "demo-flawed-v1.wav"
      );
      activeAudioFileRef.current = demoFile;
      if (healthStatusRef.current !== "online") {
        const localRes = await analyzeFileWithWebAudioFallback({
          file: demoFile,
          genre,
          stage,
          artistVision,
        });
        await hydrateSessionReport(localRes.report, {
          fromLiveBackend: false,
          isDemo: true,
          localAudioBuffer: localRes.audioBuffer,
          localObjectUrl: localRes.objectUrl,
          fallbackFile: demoFile,
        });
        const savedDemo = await persistReportToSupabase(
          localRes.report,
          "v1",
          undefined,
          undefined,
          demoFile
        );
        if (savedDemo) {
          setActiveSavedId(savedDemo.id);
          setDemoSaved(true);
        }
        startBackgroundPrecisionUpgrade(demoFile, genre, stage, artistVision);
        void refreshHealth();
        return;
      }
      const next = await analyzeMixFile({ file: demoFile, genre, stage, artistVision });
      await hydrateSessionReport(next, {
        fromLiveBackend: true,
        isDemo: true,
        fallbackFile: demoFile,
      });
      const savedDemo = await persistReportToSupabase(next, "v1", undefined, undefined, demoFile);
      if (savedDemo) {
        setActiveSavedId(savedDemo.id);
        setDemoSaved(true);
      }
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
      // Keep UI responsive if ephemeral session expired on archived report
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

  // Reverse closed-loop bridge: /studio FindingCard ("Fix in Web DAW ↗") → /daw
  const handleFixInDaw = useCallback(
    async (finding: Finding) => {
      if (!report) return;
      let handoffFile: File | null = activeAudioFileRef.current;

      if (!handoffFile) {
        const buffer = studioAudioEngine.getSlotBuffer("primary");
        if (buffer) {
          handoffFile = audioBufferToWavFile(buffer, report.audio_metadata.filename);
        }
      }

      if (!handoffFile) {
        const url = studioAudioEngine.getSlotUrl("primary");
        if (url) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const blob = await res.blob();
              handoffFile = new File([blob], report.audio_metadata.filename, {
                type: blob.type || "audio/wav",
              });
            }
          } catch {
            // Fall through if fetch fails
          }
        }
      }

      if (!handoffFile) return;

      studioAudioEngine.pause();
      const preset = deriveDawFixPreset(finding, report.context.stage);
      setPendingStudioToDawHandoff({
        ...preset,
        file: handoffFile,
        trackName: report.audio_metadata.filename,
        findingTitle: finding.title,
        evidenceId: finding.evidence_id,
        timestampStartSec: finding.timestamp_start_sec,
        timestampEndSec: finding.timestamp_end_sec,
      });

      const params = new URLSearchParams();
      params.set("from", "studio");
      params.set("plugin", preset.suggestedPluginId);
      if (typeof preset.freqHz === "number") params.set("freq", String(preset.freqHz));
      if (typeof preset.gainDb === "number") params.set("gain", String(preset.gainDb));
      router.push(`/daw?${params.toString()}`);
    },
    [report, router]
  );

  // Studio keyboard shortcuts: ? (Help), Space (Play/Pause), M (Mono Fold), L (Loop)
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

      if (!report || !audioState.hasPrimary) return;

      if (e.code === "Space" && el?.tagName !== "BUTTON") {
        e.preventDefault();
        void studioAudioEngine.togglePlay();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        const current = studioAudioEngine.getState().stereoMode;
        studioAudioEngine.setStereoMode(current === "mono" ? "stereo" : "mono");
      } else if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        studioAudioEngine.setLoop(!studioAudioEngine.getState().loopEnabled);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audioState.hasPrimary, report]);

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
      const hasLiveSession = Boolean(report.session_id && !report.session_id.startsWith("local_"));
      let updated: AnalysisReport;

      if (hasLiveSession) {
        try {
          updated = await compareRevisedMix(report.session_id, file);
        } catch (sessionErr) {
          const msg = sessionErr instanceof Error ? sessionErr.message.toLowerCase() : "";
          if (msg.includes("404") || msg.includes("expired") || msg.includes("not found")) {
            const v2Controller = new AbortController();
            const v2Timer = window.setTimeout(
              () => v2Controller.abort(),
              COMPARE_REQUEST_TIMEOUT_MS
            );
            try {
              const revisedReport = await analyzeMixFile({
                file,
                genre: report.context.genre,
                stage: report.context.stage,
                artistVision: report.context.artist_vision,
                signal: v2Controller.signal,
              });
              const comparison = await compareSavedReports(report, revisedReport);
              updated = { ...report, revision_comparison: comparison };
            } finally {
              window.clearTimeout(v2Timer);
            }
          } else {
            throw sessionErr;
          }
        }
      } else {
        const v2Controller = new AbortController();
        const v2Timer = window.setTimeout(() => v2Controller.abort(), COMPARE_REQUEST_TIMEOUT_MS);
        try {
          const revisedReport = await analyzeMixFile({
            file,
            genre: report.context.genre,
            stage: report.context.stage,
            artistVision: report.context.artist_vision,
            signal: v2Controller.signal,
          });
          const comparison = await compareSavedReports(report, revisedReport);
          updated = { ...report, revision_comparison: comparison };
        } finally {
          window.clearTimeout(v2Timer);
        }
      }

      setReport(updated);
      if (updated.revision_comparison) {
        void persistReportToSupabase(
          updated,
          "v2",
          updated.revision_comparison.revised_filename,
          activeSavedId,
          file
        );
        try {
          await studioAudioEngine.loadSlot(
            "revised",
            resolveApiUrl(updated.revision_comparison.revised_playback_proxy_url),
            updated.global_metrics.integrated_lufs +
              updated.revision_comparison.metric_deltas.integrated_lufs_delta
          );
        } catch {
          // Keep deterministic comparison deltas visible even if proxy playback decode fails
        }
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
      const updated = await compareDemoRevision(report.session_id, report);
      setReport(updated);
      if (updated.revision_comparison) {
        const proxyPath =
          updated.revision_comparison.revised_playback_proxy_url || "/demo/demo-revised-v2.wav";
        const proxyUrl = proxyPath.startsWith("/demo/") ? proxyPath : resolveApiUrl(proxyPath);
        try {
          await studioAudioEngine.loadSlot(
            "revised",
            proxyUrl,
            updated.global_metrics.integrated_lufs +
              updated.revision_comparison.metric_deltas.integrated_lufs_delta
          );
        } catch {
          try {
            await studioAudioEngine.loadSlot(
              "revised",
              "/demo/demo-revised-v2.wav",
              updated.global_metrics.integrated_lufs +
                updated.revision_comparison.metric_deltas.integrated_lufs_delta
            );
          } catch {
            // Keep comparison scorecard visible even if browser audio decode fails
          }
        }
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
    const targetRow = savedAnalyses.find((item) => item.id === analysisId);
    const deleted = await deleteSavedAnalysis(supabaseUser.id, analysisId, proxyStoragePath);
    if (deleted) {
      void deleteCachedStudioAudioBlob([analysisId, targetRow?.report_json.report_id]);
      setSavedAnalyses((prev) => prev.filter((item) => item.id !== analysisId));
    }
  };

  const buildLocalOfflineMentorFallback = (
    activeReport: AnalysisReport,
    req: MentorRequest,
    reason: string
  ): MentorResponse => {
    const m = activeReport.global_metrics;
    const actions = activeReport.findings.slice(0, 3).map((finding, idx) => ({
      evidence_id: finding.evidence_id,
      priority: idx + 1,
      headline: finding.title,
      coaching_note: `${finding.what_happened} ${finding.why_it_matters}`,
      daw_experiment: `${finding.listen_prompt} Then test: ${finding.what_to_try}`,
      verification_step: finding.recheck_target,
    }));
    return {
      mode: "deterministic_fallback",
      model_used: "deterministic-dsp-mentor-v1",
      fallback_reason: reason,
      summary: `[${reason}] Measured ${m.integrated_lufs.toFixed(1)} LUFS integrated, ${
        m.true_peak_dbtp >= 0 ? "+" : ""
      }${m.true_peak_dbtp.toFixed(2)} dBTP True Peak, LRA ${m.loudness_range_lu.toFixed(
        1
      )} LU, and ${m.phase_correlation_avg >= 0 ? "+" : ""}${m.phase_correlation_avg.toFixed(
        2
      )} phase correlation across '${activeReport.audio_metadata.filename}'.`,
      vision_alignment_note: `Offline deterministic coaching targets clean ${activeReport.context.genre} (${activeReport.context.stage.replace(
        /_/g,
        " "
      )}) translation without external network calls.`,
      prioritized_actions: actions,
      cited_evidence_ids: actions.map((a) => a.evidence_id),
      privacy_audit: {
        raw_audio_sent_to_ai: false,
        external_ai_enabled: false,
        training_opt_in: Boolean(req.allow_training_opt_in),
        retention_policy: "100% local deterministic coaching; zero audio or telemetry left your browser.",
      },
    };
  };

  useEffect(() => {
    return () => {
      mentorAbortRef.current?.abort();
      mentorAbortRef.current = null;
    };
  }, []);

  const handleAskMentor = async (req: MentorRequest) => {
    if (!report) return;
    const seq = ++mentorRequestSeqRef.current;
    mentorAbortRef.current?.abort();
    const controller = new AbortController();
    mentorAbortRef.current = controller;

    setMentorError(null);
    setIsAskingMentor(true);
    try {
      const hasLiveSession = Boolean(report.session_id && !report.session_id.startsWith("local_"));
      let advice: MentorResponse;
      if (!hasLiveSession) {
        advice = await askMentorStandalone(report, req, MENTOR_REQUEST_TIMEOUT_MS, controller.signal);
      } else {
        try {
          advice = await askMentor(report.session_id, req, MENTOR_REQUEST_TIMEOUT_MS, controller.signal);
        } catch (sessionErr) {
          if (controller.signal.aborted) {
            throw sessionErr;
          }
          const msg = sessionErr instanceof Error ? sessionErr.message.toLowerCase() : "";
          if (msg.includes("404") || msg.includes("expired") || msg.includes("not found")) {
            advice = await askMentorStandalone(
              report,
              req,
              MENTOR_REQUEST_TIMEOUT_MS,
              controller.signal
            );
          } else {
            throw sessionErr;
          }
        }
      }
      if (seq !== mentorRequestSeqRef.current) return;
      setMentorAdvice(advice);
      setReport((prev) => (prev ? { ...prev, privacy_audit: advice.privacy_audit } : prev));
    } catch (err) {
      if (seq !== mentorRequestSeqRef.current) return;
      if (!req.allow_metrics_ai) {
        const offlineFallback = buildLocalOfflineMentorFallback(
          report,
          req,
          "Offline Mentor active (local fallback)"
        );
        setMentorAdvice(offlineFallback);
        setReport((prev) =>
          prev ? { ...prev, privacy_audit: offlineFallback.privacy_audit } : prev
        );
      } else {
        setMentorError(
          err instanceof Error
            ? err.message
            : "AI Suggestions request failed. Please retry or run Offline Deterministic Suggestions."
        );
      }
    } finally {
      if (mentorAbortRef.current === controller) {
        mentorAbortRef.current = null;
      }
      if (seq === mentorRequestSeqRef.current) {
        setIsAskingMentor(false);
      }
    }
  };

  const handleUseOfflineMentorNow = (req?: MentorRequest) => {
    if (!report) return;
    mentorRequestSeqRef.current += 1;
    mentorAbortRef.current?.abort();
    mentorAbortRef.current = null;
    setIsAskingMentor(false);
    setMentorError(null);
    const offlineReq: MentorRequest = {
      allow_metrics_ai: false,
      allow_audio_ai: false,
      allow_training_opt_in: req?.allow_training_opt_in ?? privacyPrefs.allowTrainingOptIn,
      question: req?.question ?? "",
      conversation_history: req?.conversation_history ?? [],
    };
    const offlineFallback = buildLocalOfflineMentorFallback(
      report,
      offlineReq,
      "Switched to Offline Deterministic Mentor"
    );
    setMentorAdvice(offlineFallback);
    setReport((prev) =>
      prev ? { ...prev, privacy_audit: offlineFallback.privacy_audit } : prev
    );
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

  const handleToggleRepairStep = useCallback(
    (stepId: string, checked: boolean) => {
      if (!report) return;
      const nextSteps = { ...completedRepairStepsRef.current, [stepId]: checked };
      completedRepairStepsRef.current = nextSteps;
      setCompletedRepairSteps(nextSteps);
      saveRepairChecklist(report.report_id, nextSteps);

      const updatedReport: AnalysisReport = {
        ...report,
        completed_repair_steps: nextSteps,
      };
      setReport(updatedReport);

      if (supabaseUser && activeSavedId) {
        setSavedAnalyses((prev) =>
          prev.map((item) =>
            item.id === activeSavedId
              ? { ...item, checklist_progress: nextSteps, report_json: updatedReport }
              : item
          )
        );
        const uid = supabaseUser.id;
        const targetId = activeSavedId;
        const persist = async () => {
          await updateSavedAnalysisChecklistProgress(uid, targetId, nextSteps, updatedReport);
        };
        pendingChecklistFlushRef.current = persist;
        if (checklistDebounceRef.current) {
          window.clearTimeout(checklistDebounceRef.current);
        }
        checklistDebounceRef.current = window.setTimeout(() => {
          checklistDebounceRef.current = null;
          pendingChecklistFlushRef.current = null;
          void persist();
        }, 350);
      }
    },
    [activeSavedId, report, supabaseUser]
  );

  const handlePurgeAccountData = useCallback(async () => {
    if (!supabaseUser) return;
    await purgeUserAccountData(supabaseUser.id);
    await clearStudioAudioCache();
    setSavedAnalyses([]);
    setHasMoreHistory(false);
    setActiveSavedId(null);
  }, [supabaseUser]);

  const handleClearSession = async () => {
    userClearedRef.current = true;
    const sid = report?.session_id;
    resetLocalAudioAndWorkspace();
    handleChangeSubTab("diagnosis");
    if (sid && !sid.startsWith("local_")) {
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
        // Clipboard unavailable
      }
    }
    return true;
  };

  if (!authChecked || !supabaseUser) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-secondary)]">
        <div className="flex items-center gap-3 rounded-[6px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-5 py-3 text-xs font-semibold">
          <span className="h-2 w-2 rounded-full bg-[#F0B44C] animate-pulse" />
          <span>Verifying Mixit Studio session…</span>
        </div>
      </div>
    );
  }

  return (
    <StudioShell
      scrollContainerRef={scrollContainerRef}
      headerProps={{
        mode,
        onModeChange: (nextMode) => {
          setMode(nextMode);
          if (report) handleChangeSubTab("diagnosis");
        },
        report,
        sidebarExpanded,
        onToggleSidebar: handleToggleSidebar,
        onOpenMobileSidebar: () => setMobileSidebarOpen(true),
        onOpenAddAudio: () => setAddAudioOpen(true),
        onOpenMentor: () => setMentorOpen(true),
        supabaseConfigured,
        userEmail: supabaseUser?.email ?? null,
        onOpenAuth: () => {
          setAuthInitialError(null);
          setAuthPromptReason(null);
          setAuthOpen(true);
        },
      }}
      sidebarProps={{
        expanded: sidebarExpanded,
        mobileOpen: mobileSidebarOpen,
        onCloseMobile: () => setMobileSidebarOpen(false),
        report,
        onClearSession: handleClearSession,
        healthStatus,
        healthData,
        healthError,
        wakeAttempt,
        wakeMaxAttempts: 24,
        onRetryHealth: () => void refreshHealth(),
        supabaseConfigured,
        userEmail: supabaseUser?.email ?? null,
        savedCount: savedAnalyses.length,
        onOpenAuth: () => {
          setAuthInitialError(null);
          setAuthPromptReason(null);
          setAuthOpen(true);
        },
        onSignOut: () => void handleSignOut(),
        onOpenHistory: () => setHistoryOpen(true),
        onOpenSignedOutHistory: handleOpenSignedOutHistory,
        onShareReviewLink: handleShareReviewLink,
        onOpenShortcuts: () => setShortcutsOpen(true),
      }}
      subHeader={
        report ? (
          <>
            <WorkspaceSubNav
              activeTab={subTab}
              onChangeTab={handleChangeSubTab}
              report={report}
              hasReference={audioState.hasReference}
              onOpenMentor={() => setMentorOpen(true)}
              showMentorButton={false}
            />

            <div className="no-print border-b border-[var(--border-hairline)] bg-[var(--bg-elevated)]/85">
              <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
                    <SlidersHorizontal
                      className="h-3.5 w-3.5 text-[var(--accent-mint)]"
                      aria-hidden="true"
                    />
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
                  <div className="inline-flex rounded-[4px] bg-[var(--bg-surface)] p-0.5 hairline-border">
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
                        className={`rounded-[3px] px-2.5 py-0.5 text-[11px] font-medium cursor-pointer transition-colors ${
                          stage === item.id
                            ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] hairline-border"
                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {isUpdatingContext && (
                    <span className="text-[11px] text-[var(--accent-mint)]">
                      Re-evaluating rules…
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isDemoSession && supabaseUser && (
                    <button
                      type="button"
                      disabled={demoSaved}
                      onClick={() => void handleSaveDemoToHistory()}
                      className="inline-flex items-center gap-1.5 bg-[var(--accent-mint-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-mint)] hover:brightness-110 squircle-inner cursor-pointer disabled:opacity-70"
                    >
                      {demoSaved ? (
                        <>
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-[var(--accent-mint)]"
                            aria-hidden="true"
                          />
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
          </>
        ) : null
      }
      transportDock={
        report ? (
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
        ) : null
      }
      footer={
        <footer className="no-print border-t border-[var(--border-hairline)] bg-[var(--bg-canvas)] py-4 text-[11px] text-[var(--text-muted)]">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 sm:px-5">
            <span>
              Mixit Studio · Deterministic DSP Truth · Zero-Audio-by-Default · 60-min ephemeral processing
            </span>
            <nav aria-label="Legal and diagnostics links" className="flex items-center gap-4">
              <Link href="/status" className="font-semibold text-[var(--studio-mint)] hover:underline">
                System Status
              </Link>
              <Link
                href="/privacy"
                className="font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Terms of Use
              </Link>
              <Link
                href="/cookies"
                className="font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Cookie Policy
              </Link>
            </nav>
          </div>
        </footer>
      }
      overlays={
        <>
          {report && (
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
              onUseOfflineNow={handleUseOfflineMentorNow}
              onSaveDawContext={(ctx) => void handleSaveDawContext(ctx)}
              onJumpToEvidence={handleJumpEvidence}
            />
          )}

          <AddAudioModal
            open={addAudioOpen}
            onClose={() => setAddAudioOpen(false)}
            genre={genre}
            onGenreChange={setGenre}
            stage={stage}
            onStageChange={setStage}
            isAnalyzing={isAnalyzing}
            onAnalyzeFile={(file) => {
              setAddAudioOpen(false);
              return handleAnalyzeFile(file);
            }}
            onLoadDemo={() => {
              setAddAudioOpen(false);
              return handleLoadDemo();
            }}
          />

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
            onPurgeAccountData={supabaseUser ? handlePurgeAccountData : undefined}
            onOpenAddAudio={() => setAddAudioOpen(true)}
          />
          <KeyboardShortcutsModal
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
            context="studio"
          />
        </>
      }
    >
      {report && missingArchivedAudio && (
        <div
          data-testid="missing-archived-audio-banner"
          className="no-print mx-auto mt-3 w-full max-w-[1440px] px-4 sm:px-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--accent-amber-soft)] px-4 py-2.5 text-xs text-[var(--accent-amber)] border border-[var(--accent-amber)]/30 squircle-inner">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Archived session telemetry loaded. No local or cloud audio proxy was saved for this
                legacy report — re-attach your local WAV/MP3 to enable waveform auditioning.
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
                className="bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)] hairline-border squircle-inner cursor-pointer"
              >
                Re-attach Local Audio
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 px-4 pb-8 sm:px-5">
        <AnimatePresence mode="wait" initial={false}>
          {!report ? (
            <motion.div
              key="upload-stage"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: STUDIO_EASE }}
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
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: STUDIO_EASE }}
              >
                <SimpleView
                  report={report}
                  isPlaying={audioState.isPlaying}
                  hasAudio={audioState.hasPrimary}
                  isPrecisionUpgradeActive={isUpgradingPrecision}
                  precisionUpgradeError={precisionUpgradeError}
                  onRetryPrecisionSync={handleRetryPrecisionSync}
                  activeFindingId={activeFindingId}
                  activeCorrectiveEqId={audioState.activeCorrectiveEqId}
                  completedRepairSteps={completedRepairSteps}
                  onToggleRepairStep={handleToggleRepairStep}
                  onTogglePlay={() => void studioAudioEngine.togglePlay()}
                  onAuditionFinding={(f) => void handleAuditionFinding(f)}
                  onSelectFinding={(f) => setActiveFindingId(f.evidence_id)}
                  onRecheckFinding={handleRecheckFinding}
                  onFixInDaw={handleFixInDaw}
                  onToggleCorrectiveEq={(eq: CorrectiveEqConfig) =>
                    studioAudioEngine.setCorrectiveEq(eq)
                  }
                  onOpenAdvanced={() => setMode("advanced")}
                  onNewUpload={() => setAddAudioOpen(true)}
                />
              </motion.div>
            ) : (
              <motion.div
                key="advanced-workbench"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: STUDIO_EASE }}
              >
                <AdvancedWorkbench
                  report={report}
                  hasAudio={audioState.hasPrimary}
                  isPrecisionUpgradeActive={isUpgradingPrecision}
                  precisionUpgradeError={precisionUpgradeError}
                  onRetryPrecisionSync={handleRetryPrecisionSync}
                  activeFindingId={activeFindingId}
                  activeCorrectiveEqId={audioState.activeCorrectiveEqId}
                  completedRepairSteps={completedRepairSteps}
                  onToggleRepairStep={handleToggleRepairStep}
                  loopEnabled={audioState.loopEnabled}
                  loopStartSec={audioState.loopStartSec}
                  loopEndSec={audioState.loopEndSec}
                  onSeek={(sec) => void studioAudioEngine.seek(sec)}
                  onSelectFinding={(f) => setActiveFindingId(f.evidence_id)}
                  onAuditionFinding={(f) => void handleAuditionFinding(f)}
                  onRecheckFinding={handleRecheckFinding}
                  onFixInDaw={handleFixInDaw}
                  onToggleCorrectiveEq={(eq: CorrectiveEqConfig) =>
                    studioAudioEngine.setCorrectiveEq(eq)
                  }
                />
              </motion.div>
            )
          ) : subTab === "reference" ? (
            <motion.div
              key="reference-ab"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: STUDIO_EASE }}
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
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: STUDIO_EASE }}
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
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: STUDIO_EASE }}
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
    </StudioShell>
  );
}

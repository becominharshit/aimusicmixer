"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  LogOut,
  Moon,
  Save,
  ShieldCheck,
  Sliders,
  Sun,
  Trash2,
} from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";
import { Switch } from "@/components/ui/switch";
import { TACTILE_TAP } from "@/lib/motion";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  DEFAULT_PRIVACY_PREFERENCES,
  countCompletedFixesFromAnalyses,
  fetchOrCreateUserProfile,
  fetchSavedAnalyses,
  fetchUserAnalysesCount,
  fetchUserDawProjectCount,
  normalizePrivacyPreferences,
  purgeUserAccountData,
  saveProfilePrivacyPreferences,
  saveUserProfilePreferences,
  type PreferredDaw,
  type PrivacyPreferences,
} from "@/lib/supabase/storage";
import { applyStudioTheme, getCurrentStudioTheme, toggleStudioTheme, type StudioTheme } from "@/lib/theme";
import type { GenreType } from "@/types/report";

const GENRE_OPTIONS: Array<{ value: GenreType; label: string }> = [
  { value: "electronic", label: "Electronic / Dance" },
  { value: "pop", label: "Pop / Modern Vocal" },
  { value: "hip_hop", label: "Hip-Hop / Trap" },
  { value: "rock", label: "Rock / Indie" },
  { value: "acoustic", label: "Acoustic / Folk / Jazz" },
  { value: "ambient", label: "Ambient / Film" },
  { value: "other", label: "Other / Experimental" },
];

const DAW_OPTIONS: PreferredDaw[] = [
  "Mixit Web DAW",
  "FL Studio",
  "Ableton Live",
  "Logic Pro",
];

function countLocalDawProjects(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem("mixlearn_daw_projects_v1");
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function ProfileView() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState(true);

  const [displayName, setDisplayName] = useState("");
  const [defaultGenre, setDefaultGenre] = useState<GenreType>("electronic");
  const [preferredDaw, setPreferredDaw] = useState<PreferredDaw>("Mixit Web DAW");
  const [defaultTheme, setDefaultTheme] = useState<StudioTheme>("dark");

  const [privacyPrefs, setPrivacyPrefs] = useState<PrivacyPreferences>(DEFAULT_PRIVACY_PREFERENCES);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [privacyStatus, setPrivacyStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [mixesCount, setMixesCount] = useState<number | null>(null);
  const [dawProjectsCount, setDawProjectsCount] = useState<number | null>(null);
  const [fixesCompletedCount, setFixesCompletedCount] = useState<number | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const [confirmPurge, setConfirmPurge] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeDone, setPurgeDone] = useState(false);

  useEffect(() => {
    setIsDarkTheme(getCurrentStudioTheme() === "dark");
  }, []);

  const loadProfileData = useCallback(async (activeUser: User) => {
    if (!activeUser.id) return;
    setIsLoadingStats(true);
    try {
      const [profileRes, analysesCountRes, analysesPageRes, dawCountRes] = await Promise.allSettled([
        fetchOrCreateUserProfile(activeUser),
        fetchUserAnalysesCount(activeUser.id),
        fetchSavedAnalyses(activeUser.id, 0, 100),
        fetchUserDawProjectCount(activeUser.id),
      ]);

      const profile = profileRes.status === "fulfilled" ? profileRes.value : null;
      if (profile) {
        setDisplayName(
          profile.display_name ||
            (typeof activeUser.user_metadata?.display_name === "string"
              ? activeUser.user_metadata.display_name
              : activeUser.email?.split("@")[0] || "")
        );
        if (GENRE_OPTIONS.some((g) => g.value === profile.default_genre)) {
          setDefaultGenre(profile.default_genre as GenreType);
        }
        if (profile.preferred_daw && DAW_OPTIONS.includes(profile.preferred_daw as PreferredDaw)) {
          setPreferredDaw(profile.preferred_daw as PreferredDaw);
        }
        if (profile.default_theme === "dark" || profile.default_theme === "light") {
          setDefaultTheme(profile.default_theme);
          applyStudioTheme(profile.default_theme);
          setIsDarkTheme(profile.default_theme === "dark");
        }
        setPrivacyPrefs(normalizePrivacyPreferences(profile));
      } else {
        setPrivacyPrefs({ ...DEFAULT_PRIVACY_PREFERENCES });
        setDisplayName(activeUser.email?.split("@")[0] || "");
      }

      if (analysesCountRes.status === "fulfilled") {
        setMixesCount(analysesCountRes.value);
      } else if (analysesPageRes.status === "fulfilled") {
        setMixesCount(analysesPageRes.value.records.length);
      } else {
        setMixesCount(null);
      }

      const localDawCount = countLocalDawProjects();
      if (dawCountRes.status === "fulfilled") {
        setDawProjectsCount(Math.max(dawCountRes.value, localDawCount));
      } else {
        setDawProjectsCount(localDawCount > 0 ? localDawCount : null);
      }

      if (analysesPageRes.status === "fulfilled") {
        setFixesCompletedCount(countCompletedFixesFromAnalyses(analysesPageRes.value.records));
      } else {
        setFixesCompletedCount(null);
      }
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      router.replace("/?signin=1");
      return;
    }

    let active = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      const nextUser = !error ? (data.user ?? null) : null;
      if (!nextUser) {
        router.replace("/?signin=1");
        return;
      }
      setUser(nextUser);
      setAuthChecked(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user ?? null;
      if (event === "SIGNED_OUT" || !nextUser) {
        setUser(null);
        router.replace(event === "SIGNED_OUT" ? "/" : "/?signin=1");
        return;
      }
      setUser(nextUser);
      setAuthChecked(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  // Gate stats & profile queries strictly on hydrated user.id
  useEffect(() => {
    if (!user?.id) return;
    void loadProfileData(user);
  }, [user, loadProfileData]);

  const handleToggleHeaderTheme = () => {
    const next = toggleStudioTheme();
    setIsDarkTheme(next === "dark");
    setDefaultTheme(next);
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaveStatus("saving");
    applyStudioTheme(defaultTheme);
    setIsDarkTheme(defaultTheme === "dark");
    const ok = await saveUserProfilePreferences(user.id, {
      display_name: displayName.trim() || user.email?.split("@")[0] || "Engineer",
      default_genre: defaultGenre,
      preferred_daw: preferredDaw,
      default_theme: defaultTheme,
    });
    setSaveStatus(ok ? "saved" : "error");
    if (ok) {
      window.setTimeout(() => {
        setSaveStatus((curr) => (curr === "saved" ? "idle" : curr));
      }, 2500);
    }
  };

  const handleUpdatePrivacy = async (next: PrivacyPreferences) => {
    if (!user) return;
    const normalized: PrivacyPreferences = {
      allowMetricsAi: next.allowMetricsAi,
      allowAudioAi: next.allowMetricsAi ? next.allowAudioAi : false,
      allowTrainingOptIn: next.allowTrainingOptIn,
    };
    const prev = privacyPrefs;
    setPrivacyPrefs(normalized);
    setPrivacyStatus("saving");
    const ok = await saveProfilePrivacyPreferences(user.id, normalized);
    if (ok) {
      setPrivacyStatus("saved");
      window.setTimeout(() => {
        setPrivacyStatus((curr) => (curr === "saved" ? "idle" : curr));
      }, 2200);
    } else {
      setPrivacyPrefs(prev);
      setPrivacyStatus("error");
    }
  };

  const handleConfirmPurge = async () => {
    if (!user) return;
    setIsPurging(true);
    try {
      await purgeUserAccountData(user.id);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("mixlearn_daw_projects_v1");
      }
      setMixesCount(0);
      setDawProjectsCount(0);
      setFixesCompletedCount(0);
      setConfirmPurge(false);
      setPurgeDone(true);
    } finally {
      setIsPurging(false);
    }
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.replace("/");
  };

  if (!authChecked || !user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-secondary)]">
        <div className="flex items-center gap-3 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-5 py-3 text-xs font-semibold">
          <span className="h-2 w-2 rounded-full bg-[#F0B44C] animate-pulse" />
          <span>Verifying Mixit Profile session…</span>
        </div>
      </div>
    );
  }

  const email = user.email ?? "studio@mixit.audio";
  const initialLetter = (displayName.trim() || email).charAt(0).toUpperCase();
  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Active Member";

  return (
    <div
      data-testid="profile-page"
      className="flex min-h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]"
    >
      {/* Unified Swiss Studio Top Navigation */}
      <header className="sticky top-0 z-40 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6 lg:h-16 lg:flex-nowrap lg:py-0">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <Link href="/" aria-label="Mixit Home" className="flex shrink-0 items-center">
              <span className="hidden sm:inline-flex">
                <MixitLogo variant="full" tone="auto" heightClass="h-7" />
              </span>
              <span className="inline-flex sm:hidden">
                <MixitLogo variant="mark" heightClass="h-8" />
              </span>
            </Link>

            <nav
              aria-label="Primary studio workspaces"
              className="inline-flex shrink-0 items-center border border-[var(--border-hairline)] bg-[var(--bg-inset)]"
            >
              <Link
                href="/studio"
                className="inline-flex h-7 items-center px-2.5 tabular-telemetry text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                CONSOLE
              </Link>
              <Link
                href="/daw"
                className="inline-flex h-7 items-center border-l border-[var(--border-hairline)] px-2.5 tabular-telemetry text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                WEB DAW
              </Link>
              <Link
                href="/profile"
                aria-current="page"
                className="inline-flex h-7 items-center border-l border-[var(--border-hairline)] bg-[#F0B44C] px-2.5 tabular-telemetry text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#0A0A0A]"
              >
                PROFILE
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <motion.button
              type="button"
              data-testid="profile-theme-toggle"
              whileTap={TACTILE_TAP}
              onClick={handleToggleHeaderTheme}
              aria-label={isDarkTheme ? "Switch to PAPER light mode" : "Switch to INK dark mode"}
              className="inline-flex h-8 items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 tabular-telemetry text-[11px] font-bold uppercase text-[var(--text-primary)] transition-colors hover:border-[var(--border-active)] cursor-pointer"
            >
              {isDarkTheme ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-[#F0B44C]" aria-hidden="true" />
                  <span className="hidden sm:inline">PAPER</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-[#0A0A0A]" aria-hidden="true" />
                  <span className="hidden sm:inline">INK</span>
                </>
              )}
            </motion.button>

            <motion.button
              type="button"
              whileTap={TACTILE_TAP}
              onClick={() => void handleSignOut()}
              aria-label="Sign out"
              className="inline-flex h-8 items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[#EF6B63] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign Out</span>
            </motion.button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1040px] flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Identity Header Block */}
        <section
          aria-label="Studio account identity"
          className="border-[1.5px] border-[var(--border-strong)] bg-[var(--bg-elevated)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-hairline)] p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <div
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center border-[1.5px] border-[#0A0A0A] bg-[#F0B44C] font-brut text-3xl text-[#0A0A0A]"
              >
                {initialLetter}
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="tabular-telemetry text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  STUDIO ACCOUNT
                </div>
                <h1 className="font-display truncate text-xl font-bold tracking-[-0.02em] text-[var(--text-primary)] sm:text-2xl">
                  {displayName.trim() || email}
                </h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
                  <span className="tabular-telemetry">{email}</span>
                  <span>·</span>
                  <span className="tabular-telemetry">Member since {memberSince}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/studio"
                className="inline-flex h-9 items-center border border-[#0A0A0A] bg-[#F0B44C] px-3.5 text-xs font-extrabold uppercase tracking-[0.06em] text-[#0A0A0A] transition-colors hover:bg-[#0A0A0A] hover:text-[#F0B44C]"
              >
                Open Console
              </Link>
              <Link
                href="/daw"
                className="inline-flex h-9 items-center border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-3.5 text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-primary)] transition-colors hover:border-[var(--border-active)]"
              >
                Open Web DAW
              </Link>
            </div>
          </div>

          {/* 3-Cell Activity Strip */}
          <div
            data-testid="profile-activity-strip"
            className="grid grid-cols-1 divide-y divide-[var(--border-hairline)] sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          >
            <div className="p-4 sm:p-5">
              <div className="tabular-telemetry text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Mixes Analyzed
              </div>
              <div
                data-testid="stat-mixes-analyzed"
                className="mt-1 tabular-telemetry text-3xl font-extrabold text-[var(--text-primary)]"
              >
                {isLoadingStats ? (
                  <span
                    aria-label="Loading mixes count"
                    className="inline-block h-7 w-12 animate-pulse bg-[var(--bg-inset)] align-middle"
                  />
                ) : mixesCount === null ? (
                  "-"
                ) : (
                  mixesCount
                )}
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <div className="tabular-telemetry text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                DAW Projects
              </div>
              <div
                data-testid="stat-daw-projects"
                className="mt-1 tabular-telemetry text-3xl font-extrabold text-[#F0B44C]"
              >
                {isLoadingStats ? (
                  <span
                    aria-label="Loading DAW projects count"
                    className="inline-block h-7 w-12 animate-pulse bg-[var(--bg-inset)] align-middle"
                  />
                ) : dawProjectsCount === null ? (
                  "-"
                ) : (
                  dawProjectsCount
                )}
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <div className="tabular-telemetry text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Fixes Completed
              </div>
              <div
                data-testid="stat-fixes-completed"
                className="mt-1 tabular-telemetry text-3xl font-extrabold text-[var(--studio-mint)]"
              >
                {isLoadingStats ? (
                  <span
                    aria-label="Loading fixes completed count"
                    className="inline-block h-7 w-12 animate-pulse bg-[var(--bg-inset)] align-middle"
                  />
                ) : fixesCompletedCount === null ? (
                  "-"
                ) : (
                  fixesCompletedCount
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Studio Preferences Form */}
        <form
          onSubmit={(e) => void handleSavePreferences(e)}
          aria-label="Studio preferences"
          className="border-[1.5px] border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-[#F0B44C]" aria-hidden="true" />
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-[var(--text-primary)]">
                Studio Preferences
              </h2>
            </div>
            {saveStatus === "saved" && (
              <span
                data-testid="profile-save-status"
                className="inline-flex items-center gap-1 bg-[var(--studio-mint-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--studio-mint)]"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Saved to profile
              </span>
            )}
            {saveStatus === "error" && (
              <span className="text-[11px] font-bold text-[var(--studio-vermilion)]">
                Could not sync preferences
              </span>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="profile-display-name"
                className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]"
              >
                Display Name
              </label>
              <input
                id="profile-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your studio name"
                className="h-10 w-full border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-3 text-sm text-[var(--text-primary)] focus:border-[#F0B44C] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="profile-default-genre"
                className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]"
              >
                Default Genre
              </label>
              <select
                id="profile-default-genre"
                value={defaultGenre}
                onChange={(e) => setDefaultGenre(e.target.value as GenreType)}
                className="h-10 w-full border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-3 text-sm text-[var(--text-primary)] focus:border-[#F0B44C] focus:outline-none"
              >
                {GENRE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="profile-preferred-daw"
                className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]"
              >
                Preferred DAW
              </label>
              <select
                id="profile-preferred-daw"
                value={preferredDaw}
                onChange={(e) => setPreferredDaw(e.target.value as PreferredDaw)}
                className="h-10 w-full border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-3 text-sm text-[var(--text-primary)] focus:border-[#F0B44C] focus:outline-none"
              >
                {DAW_OPTIONS.map((daw) => (
                  <option key={daw} value={daw}>
                    {daw}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">
                Default Theme
              </span>
              <div className="grid grid-cols-2 border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-0.5">
                <button
                  type="button"
                  aria-pressed={defaultTheme === "dark"}
                  onClick={() => {
                    setDefaultTheme("dark");
                    applyStudioTheme("dark");
                    setIsDarkTheme(true);
                  }}
                  className={`h-9 text-xs font-bold uppercase tracking-[0.06em] transition-colors cursor-pointer ${
                    defaultTheme === "dark"
                      ? "bg-[#F0B44C] text-[#0A0A0A]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  INK Dark
                </button>
                <button
                  type="button"
                  aria-pressed={defaultTheme === "light"}
                  onClick={() => {
                    setDefaultTheme("light");
                    applyStudioTheme("light");
                    setIsDarkTheme(false);
                  }}
                  className={`h-9 text-xs font-bold uppercase tracking-[0.06em] transition-colors cursor-pointer ${
                    defaultTheme === "light"
                      ? "bg-[#F0B44C] text-[#0A0A0A]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  PAPER Light
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <motion.button
              type="submit"
              whileTap={TACTILE_TAP}
              disabled={saveStatus === "saving"}
              data-testid="save-profile-preferences-btn"
              className="inline-flex h-10 items-center gap-2 border border-[#0A0A0A] bg-[#F0B44C] px-5 text-xs font-extrabold uppercase tracking-[0.06em] text-[#0A0A0A] transition-colors hover:bg-[#0A0A0A] hover:text-[#F0B44C] disabled:opacity-50 cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              {saveStatus === "saving" ? "Saving…" : "Save Studio Preferences"}
            </motion.button>
          </div>
        </form>

        {/* Privacy & Account Data Controls */}
        <section
          aria-label="Privacy and account data"
          className="border-[1.5px] border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--studio-mint)]" aria-hidden="true" />
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-[var(--text-primary)]">
                Privacy &amp; Account Data
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {privacyStatus === "saved" && (
                <span className="bg-[var(--studio-mint-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--studio-mint)]">
                  Synced
                </span>
              )}
              <span className="border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2 py-0.5 tabular-telemetry text-[10px] font-bold uppercase text-[var(--text-secondary)]">
                All AI Toggles Default OFF
              </span>
            </div>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-start justify-between gap-4 border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-3.5">
              <div className="space-y-0.5">
                <div className="font-bold text-[var(--text-primary)]">
                  1. Numerical DSP Metrics for AI Suggestions
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Shares structured DSP telemetry and evidence IDs only. Zero audio leaves your browser.
                </p>
              </div>
              <Switch
                checked={privacyPrefs.allowMetricsAi}
                onCheckedChange={(checked) =>
                  void handleUpdatePrivacy({
                    allowMetricsAi: checked,
                    allowAudioAi: checked ? privacyPrefs.allowAudioAi : false,
                    allowTrainingOptIn: privacyPrefs.allowTrainingOptIn,
                  })
                }
                aria-label="Allow numerical DSP metrics for AI Suggestions"
              />
            </div>

            <div className="flex items-start justify-between gap-4 border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-3.5">
              <div className="space-y-0.5">
                <div className="font-bold text-[var(--text-primary)]">
                  2. Direct 25s Audio Snippet Analysis
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Requires Toggle 1. Sends a compressed 25-second clip around the highest-severity section only when requested.
                </p>
              </div>
              <Switch
                checked={privacyPrefs.allowMetricsAi && privacyPrefs.allowAudioAi}
                disabled={!privacyPrefs.allowMetricsAi}
                onCheckedChange={(checked) =>
                  void handleUpdatePrivacy({
                    allowMetricsAi: privacyPrefs.allowMetricsAi,
                    allowAudioAi: checked,
                    allowTrainingOptIn: privacyPrefs.allowTrainingOptIn,
                  })
                }
                aria-label="Allow direct 25s audio snippet analysis"
              />
            </div>

            <div className="flex items-start justify-between gap-4 border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-3.5">
              <div className="space-y-0.5">
                <div className="font-bold text-[var(--text-primary)]">
                  3. Model Training Permission
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Strictly OFF by default. Never enabled without your explicit switch action.
                </p>
              </div>
              <Switch
                checked={privacyPrefs.allowTrainingOptIn}
                onCheckedChange={(checked) =>
                  void handleUpdatePrivacy({
                    allowMetricsAi: privacyPrefs.allowMetricsAi,
                    allowAudioAi: privacyPrefs.allowAudioAi,
                    allowTrainingOptIn: checked,
                  })
                }
                aria-label="Allow future model training opt-in"
              />
            </div>
          </div>

          {/* Compliance Links */}
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-hairline)] pt-3 text-xs">
            <Link
              href="/privacy"
              className="inline-flex items-center gap-1 font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Privacy Policy
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
            <Link
              href="/terms"
              className="inline-flex items-center gap-1 font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Terms of Use
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
            <Link
              href="/cookies"
              className="inline-flex items-center gap-1 font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cookie Policy
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>

          {/* Data Purge & Sign Out Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] pt-4">
            {confirmPurge ? (
              <div className="flex w-full flex-wrap items-center justify-between gap-3 border border-[#EF6B63] bg-[var(--studio-vermilion-soft)] p-3 text-xs">
                <div className="flex items-center gap-2 font-semibold text-[var(--studio-vermilion)]">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Permanently delete all saved mixes, DAW projects, and uploaded audio proxies?
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isPurging}
                    data-testid="confirm-purge-profile-btn"
                    onClick={() => void handleConfirmPurge()}
                    className="h-8 border border-[#0A0A0A] bg-[#EF6B63] px-3 text-xs font-extrabold uppercase text-[#0A0A0A] disabled:opacity-50 cursor-pointer"
                  >
                    {isPurging ? "Deleting…" : "Confirm Permanent Delete"}
                  </button>
                  <button
                    type="button"
                    disabled={isPurging}
                    onClick={() => setConfirmPurge(false)}
                    className="h-8 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="profile-purge-btn"
                    onClick={() => {
                      setPurgeDone(false);
                      setConfirmPurge(true);
                    }}
                    className="inline-flex h-9 items-center gap-1.5 border border-[#EF6B63]/60 bg-[var(--studio-vermilion-soft)] px-3.5 text-xs font-bold text-[var(--studio-vermilion)] transition-colors hover:bg-[#EF6B63] hover:text-[#0A0A0A] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Delete My Data &amp; Audio Proxies
                  </button>
                  {purgeDone && (
                    <span className="text-xs font-semibold text-[var(--studio-mint)]">
                      All cloud data &amp; audio proxies deleted.
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="inline-flex h-9 items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-4 text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-primary)] transition-colors hover:border-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-[#F0B44C] cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign Out
                </button>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

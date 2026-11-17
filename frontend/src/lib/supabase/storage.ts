import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AnalysisReport } from "@/types/report";

export interface PrivacyPreferences {
  allowMetricsAi: boolean;
  allowAudioAi: boolean;
  allowTrainingOptIn: boolean;
}

export const DEFAULT_PRIVACY_PREFERENCES: PrivacyPreferences = {
  allowMetricsAi: false,
  allowAudioAi: false,
  allowTrainingOptIn: false,
};

export interface UserProfileRecord {
  id: string;
  display_name: string | null;
  default_genre: string;
  default_stage: string;
  allow_metrics_ai: boolean;
  allow_audio_ai: boolean;
  allow_dataset_retention: boolean;
  updated_at: string;
}

export interface SavedAnalysisRecord {
  id: string;
  user_id: string;
  track_name: string;
  genre: string;
  stage: string;
  artist_vision: string | null;
  version_label: string;
  report_json: AnalysisReport;
  created_at: string;
}

export async function fetchOrCreateUserProfile(user: User): Promise<UserProfileRecord | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return null;
  }
  if (data) {
    return data as UserProfileRecord;
  }

  const fallbackName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    user.email?.split("@")[0] ||
    null;

  const { data: inserted, error: insertError } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        display_name: fallbackName,
        allow_metrics_ai: false,
        allow_audio_ai: false,
        allow_dataset_retention: false,
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (insertError) return null;
  return inserted as UserProfileRecord;
}

export async function saveProfilePrivacyPreferences(
  userId: string,
  prefs: PrivacyPreferences
): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;

  const safeAudioAi = prefs.allowMetricsAi ? prefs.allowAudioAi : false;
  const { error } = await supabase
    .from("profiles")
    .update({
      allow_metrics_ai: prefs.allowMetricsAi,
      allow_audio_ai: safeAudioAi,
      allow_dataset_retention: prefs.allowTrainingOptIn,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return !error;
}

export async function fetchSavedAnalyses(userId: string): Promise<SavedAnalysisRecord[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("analyses")
    .select("id, user_id, track_name, genre, stage, artist_vision, version_label, report_json, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error || !data) return [];
  return data as SavedAnalysisRecord[];
}

export async function saveUserAnalysis(params: {
  userId: string;
  report: AnalysisReport;
  versionLabel?: string;
  trackNameOverride?: string;
}): Promise<SavedAnalysisRecord | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { report } = params;
  const { data, error } = await supabase
    .from("analyses")
    .insert({
      user_id: params.userId,
      track_name: params.trackNameOverride || report.audio_metadata.filename,
      genre: report.context.genre,
      stage: report.context.stage,
      artist_vision: report.context.artist_vision.join(", ") || null,
      version_label: params.versionLabel || "v1",
      report_json: report,
    })
    .select("id, user_id, track_name, genre, stage, artist_vision, version_label, report_json, created_at")
    .single();

  if (error || !data) return null;
  return data as SavedAnalysisRecord;
}

export async function deleteSavedAnalysis(userId: string, analysisId: string): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;

  const { error } = await supabase
    .from("analyses")
    .delete()
    .eq("id", analysisId)
    .eq("user_id", userId);

  return !error;
}

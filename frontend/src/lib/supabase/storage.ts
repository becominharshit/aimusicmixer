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
  parent_analysis_id?: string | null;
  proxy_storage_path?: string | null;
  share_token?: string | null;
  is_public?: boolean;
  report_json: AnalysisReport;
  created_at: string;
}

export interface PaginatedAnalysesResult {
  records: SavedAnalysisRecord[];
  hasMore: boolean;
}

const MIX_PROXIES_BUCKET = "mix-proxies";

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

export async function fetchSavedAnalyses(
  userId: string,
  offset = 0,
  limit = 25
): Promise<PaginatedAnalysesResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { records: [], hasMore: false };

  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, user_id, track_name, genre, stage, artist_vision, version_label, parent_analysis_id, proxy_storage_path, share_token, is_public, report_json, created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + safeLimit);

  if (error || !data) return { records: [], hasMore: false };
  const rows = data as SavedAnalysisRecord[];
  const hasMore = rows.length > safeLimit;
  return {
    records: hasMore ? rows.slice(0, safeLimit) : rows,
    hasMore,
  };
}

export async function uploadMixProxyToStorage(params: {
  userId: string;
  analysisId: string;
  proxyUrl: string;
}): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !params.proxyUrl) return null;

  try {
    const res = await fetch(params.proxyUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const extMatch = params.proxyUrl.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "m4a";
    const storagePath = `${params.userId}/${params.analysisId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(MIX_PROXIES_BUCKET)
      .upload(storagePath, blob, {
        contentType: blob.type || "audio/mp4",
        upsert: true,
      });

    if (uploadError) return null;

    await supabase
      .from("analyses")
      .update({ proxy_storage_path: storagePath })
      .eq("id", params.analysisId)
      .eq("user_id", params.userId);

    return storagePath;
  } catch {
    return null;
  }
}

export async function getSignedMixProxyUrl(
  proxyStoragePath: string,
  expiresInSec = 3600
): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !proxyStoragePath) return null;

  const { data, error } = await supabase.storage
    .from(MIX_PROXIES_BUCKET)
    .createSignedUrl(proxyStoragePath, expiresInSec);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function saveUserAnalysis(params: {
  userId: string;
  report: AnalysisReport;
  versionLabel?: string;
  trackNameOverride?: string;
  parentAnalysisId?: string | null;
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
      parent_analysis_id: params.parentAnalysisId ?? null,
      report_json: report,
    })
    .select(
      "id, user_id, track_name, genre, stage, artist_vision, version_label, parent_analysis_id, proxy_storage_path, share_token, is_public, report_json, created_at"
    )
    .single();

  if (error || !data) return null;
  return data as SavedAnalysisRecord;
}

export async function deleteSavedAnalysis(
  userId: string,
  analysisId: string,
  proxyStoragePath?: string | null
): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;

  if (proxyStoragePath) {
    try {
      await supabase.storage.from(MIX_PROXIES_BUCKET).remove([proxyStoragePath]);
    } catch {
      // Non-fatal if proxy object already removed
    }
  }

  const { error } = await supabase
    .from("analyses")
    .delete()
    .eq("id", analysisId)
    .eq("user_id", userId);

  return !error;
}

export async function enableAnalysisShareLink(
  userId: string,
  analysisId: string,
  existingToken?: string | null
): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const token =
    existingToken ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 18)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

  const { error } = await supabase
    .from("analyses")
    .update({
      share_token: token,
      is_public: true,
    })
    .eq("id", analysisId)
    .eq("user_id", userId);

  if (error) return null;
  return token;
}

export async function fetchSharedAnalysisByToken(
  token: string
): Promise<SavedAnalysisRecord | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !token) return null;

  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, user_id, track_name, genre, stage, artist_vision, version_label, parent_analysis_id, proxy_storage_path, share_token, is_public, report_json, created_at"
    )
    .eq("share_token", token)
    .eq("is_public", true)
    .maybeSingle();

  if (error || !data) return null;
  return data as SavedAnalysisRecord;
}

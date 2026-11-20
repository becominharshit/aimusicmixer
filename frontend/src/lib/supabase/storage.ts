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

export type PreferredDaw = "Mixit Web DAW" | "FL Studio" | "Ableton Live" | "Logic Pro";

export interface UserProfileRecord {
  id: string;
  display_name: string | null;
  default_genre: string;
  default_stage: string;
  preferred_daw?: PreferredDaw | string | null;
  default_theme?: "dark" | "light" | null;
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
  checklist_progress?: Record<string, boolean> | null;
  report_json: AnalysisReport;
  created_at: string;
}

export interface PaginatedAnalysesResult {
  records: SavedAnalysisRecord[];
  hasMore: boolean;
}

const MIX_PROXIES_BUCKET = "mix-proxies";

const ANALYSES_COLUMNS_WITH_CHECKLIST =
  "id, user_id, track_name, genre, stage, artist_vision, version_label, parent_analysis_id, proxy_storage_path, share_token, is_public, checklist_progress, report_json, created_at";

const ANALYSES_COLUMNS_LEGACY =
  "id, user_id, track_name, genre, stage, artist_vision, version_label, parent_analysis_id, proxy_storage_path, share_token, is_public, report_json, created_at";

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

export async function saveUserProfilePreferences(
  userId: string,
  patch: {
    display_name?: string | null;
    default_genre?: string;
    preferred_daw?: string;
    default_theme?: "dark" | "light";
  }
): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !userId) return false;

  const fullPayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.display_name !== undefined) fullPayload.display_name = patch.display_name;
  if (patch.default_genre !== undefined) fullPayload.default_genre = patch.default_genre;
  if (patch.preferred_daw !== undefined) fullPayload.preferred_daw = patch.preferred_daw;
  if (patch.default_theme !== undefined) fullPayload.default_theme = patch.default_theme;

  const { error } = await supabase.from("profiles").update(fullPayload).eq("id", userId);
  if (!error) return true;

  // Fallback for schemas that have not added preferred_daw / default_theme yet
  const legacyPayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.display_name !== undefined) legacyPayload.display_name = patch.display_name;
  if (patch.default_genre !== undefined) legacyPayload.default_genre = patch.default_genre;

  const { error: fallbackErr } = await supabase
    .from("profiles")
    .update(legacyPayload)
    .eq("id", userId);
  return !fallbackErr;
}

export async function fetchSavedAnalyses(
  userId: string,
  offset = 0,
  limit = 25
): Promise<PaginatedAnalysesResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { records: [], hasMore: false };

  const safeLimit = Math.max(1, Math.min(limit, 50));
  let rawData: unknown = null;
  let queryError: unknown = null;

  const primary = await supabase
    .from("analyses")
    .select(ANALYSES_COLUMNS_WITH_CHECKLIST)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + safeLimit);
  rawData = primary.data;
  queryError = primary.error;

  if (queryError) {
    const retry = await supabase
      .from("analyses")
      .select(ANALYSES_COLUMNS_LEGACY)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + safeLimit);
    rawData = retry.data;
    queryError = retry.error;
  }

  if (queryError || !Array.isArray(rawData)) return { records: [], hasMore: false };
  const rows = (rawData as SavedAnalysisRecord[]).map((row) => {
    const mergedSteps =
      row.checklist_progress && Object.keys(row.checklist_progress).length > 0
        ? row.checklist_progress
        : (row.report_json?.completed_repair_steps ?? {});
    return {
      ...row,
      checklist_progress: mergedSteps,
    };
  });
  const hasMore = rows.length > safeLimit;
  return {
    records: hasMore ? rows.slice(0, safeLimit) : rows,
    hasMore,
  };
}

export async function fetchUserDawProjectCount(userId: string): Promise<number> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !userId) return 0;
  try {
    const { count, error } = await supabase
      .from("daw_projects")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (!error && typeof count === "number") return count;
  } catch {
    // Table may not exist yet or local fallback is active
  }
  return 0;
}

export async function uploadMixProxyToStorage(params: {
  userId: string;
  analysisId: string;
  proxyUrl?: string | null;
  fallbackBlob?: Blob | null;
}): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  try {
    let blob: Blob | null = null;
    let ext = "m4a";

    if (params.proxyUrl) {
      const headers: Record<string, string> = {};
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      } catch {
        // Proceed without Bearer header for public/demo URLs
      }

      try {
        const res = await fetch(params.proxyUrl, { headers });
        if (res.ok) {
          blob = await res.blob();
          const extMatch = params.proxyUrl.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
          if (extMatch) ext = extMatch[1].toLowerCase();
        }
      } catch {
        // Fall through to fallbackBlob if network proxy fetch failed
      }
    }

    if (!blob && params.fallbackBlob && params.fallbackBlob.size <= 25 * 1024 * 1024) {
      blob = params.fallbackBlob;
      if (blob.type.includes("wav")) ext = "wav";
      else if (blob.type.includes("mpeg") || blob.type.includes("mp3")) ext = "mp3";
      else ext = "m4a";
    }

    if (!blob) return null;

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

export async function fetchSignedMixProxyBlob(
  proxyStoragePath: string,
  expiresInSec = 3600
): Promise<{ blob: Blob; signedUrl: string } | null> {
  const signedUrl = await getSignedMixProxyUrl(proxyStoragePath, expiresInSec);
  if (!signedUrl) return null;
  try {
    const res = await fetch(signedUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    return { blob, signedUrl };
  } catch {
    return null;
  }
}

export async function saveUserAnalysis(params: {
  userId: string;
  report: AnalysisReport;
  versionLabel?: string;
  trackNameOverride?: string;
  parentAnalysisId?: string | null;
  checklistProgress?: Record<string, boolean>;
  existingId?: string | null;
}): Promise<SavedAnalysisRecord | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { report } = params;
  const checklist = params.checklistProgress ?? report.completed_repair_steps ?? {};
  const payloadBase = {
    ...(params.existingId ? { id: params.existingId } : {}),
    user_id: params.userId,
    track_name: params.trackNameOverride || report.audio_metadata.filename,
    genre: report.context.genre,
    stage: report.context.stage,
    artist_vision: report.context.artist_vision.join(", ") || null,
    version_label: params.versionLabel || "v1",
    parent_analysis_id: params.parentAnalysisId ?? null,
    report_json: {
      ...report,
      completed_repair_steps: checklist,
    },
  };

  let savedRow: unknown = null;
  let saveError: unknown = null;

  const primarySave = await supabase
    .from("analyses")
    .upsert(
      {
        ...payloadBase,
        checklist_progress: checklist,
      },
      { onConflict: "id" }
    )
    .select(ANALYSES_COLUMNS_WITH_CHECKLIST)
    .single();
  savedRow = primarySave.data;
  saveError = primarySave.error;

  if (saveError) {
    // Graceful fallback if checklist_progress column hasn't been migrated yet
    const retry = await supabase
      .from("analyses")
      .upsert(payloadBase, { onConflict: "id" })
      .select(ANALYSES_COLUMNS_LEGACY)
      .single();
    savedRow = retry.data;
    saveError = retry.error;
  }

  if (saveError || !savedRow) return null;
  return {
    ...(savedRow as SavedAnalysisRecord),
    checklist_progress: checklist,
  };
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

export async function updateSavedAnalysisReportJson(
  userId: string,
  analysisId: string,
  report: AnalysisReport
): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !userId || !analysisId) return false;

  const { error } = await supabase
    .from("analyses")
    .update({ report_json: report })
    .eq("id", analysisId)
    .eq("user_id", userId);

  return !error;
}

export async function updateSavedAnalysisChecklistProgress(
  userId: string,
  analysisId: string,
  checklistProgress: Record<string, boolean>,
  updatedReport?: AnalysisReport
): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !userId || !analysisId) return false;

  const fullPatch: Record<string, unknown> = {
    checklist_progress: checklistProgress,
  };
  if (updatedReport) {
    fullPatch.report_json = {
      ...updatedReport,
      completed_repair_steps: checklistProgress,
    };
  }

  const { error } = await supabase
    .from("analyses")
    .update(fullPatch)
    .eq("id", analysisId)
    .eq("user_id", userId);

  if (!error) return true;

  if (updatedReport) {
    const { error: fallbackErr } = await supabase
      .from("analyses")
      .update({
        report_json: {
          ...updatedReport,
          completed_repair_steps: checklistProgress,
        },
      })
      .eq("id", analysisId)
      .eq("user_id", userId);
    return !fallbackErr;
  }
  return false;
}

export async function purgeUserAccountData(userId: string): Promise<{
  deletedAnalyses: boolean;
  deletedProxyCount: number;
}> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !userId) {
    return { deletedAnalyses: false, deletedProxyCount: 0 };
  }

  let deletedProxyCount = 0;
  try {
    const { data: objects } = await supabase.storage
      .from(MIX_PROXIES_BUCKET)
      .list(userId, { limit: 1000 });
    if (objects && objects.length > 0) {
      const paths = objects
        .filter((o) => Boolean(o.name))
        .map((o) => `${userId}/${o.name}`);
      if (paths.length > 0) {
        const { error: rmErr } = await supabase.storage
          .from(MIX_PROXIES_BUCKET)
          .remove(paths);
        if (!rmErr) {
          deletedProxyCount = paths.length;
        }
      }
    }
  } catch {
    // Continue purging database rows even if storage bucket is empty or unavailable
  }

  try {
    await supabase.from("daw_projects").delete().eq("user_id", userId);
  } catch {
    // Non-fatal if daw_projects table hasn't been created yet
  }

  const { error } = await supabase.from("analyses").delete().eq("user_id", userId);
  return {
    deletedAnalyses: !error,
    deletedProxyCount,
  };
}

export async function fetchSharedAnalysisByToken(
  token: string
): Promise<SavedAnalysisRecord | null> {
  const supabase = getSupabaseBrowserClient();
  const cleanToken = token.trim();
  if (!supabase || cleanToken.length < 16) return null;

  // Prefer the exact-token SECURITY DEFINER RPC (prevents enumeration and redacts user_id)
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "get_shared_analysis_by_token",
    { p_share_token: cleanToken }
  );

  if (!rpcError && rpcData) {
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (row) {
      return {
        ...row,
        user_id: "",
      } as SavedAnalysisRecord;
    }
    return null;
  }

  // Fallback for older Supabase deployments that have not yet executed the updated RPC migration
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, track_name, genre, stage, artist_vision, version_label, share_token, is_public, report_json, created_at"
    )
    .eq("share_token", cleanToken)
    .eq("is_public", true)
    .maybeSingle();

  if (error || !data) return null;
  return {
    ...data,
    user_id: "",
  } as SavedAnalysisRecord;
}

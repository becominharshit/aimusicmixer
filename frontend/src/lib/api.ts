import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  AnalysisReport,
  ArtistVisionTag,
  BackendHealth,
  GenreType,
  MentorRequest,
  MentorResponse,
  ReferenceTrackMeta,
  RevisionComparison,
  StageType,
  UserReportedContext,
} from "@/types/report";

const RAW_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "") ||
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "") ||
  "";

function computeApiBaseUrl(): string {
  if (!RAW_API_BASE_URL) return "";
  if (
    typeof window !== "undefined" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(RAW_API_BASE_URL) &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return "";
  }
  return RAW_API_BASE_URL;
}

export const API_BASE_URL = computeApiBaseUrl();

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function getOptionalAuthHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(extra || {}) };
  if (typeof window === "undefined") return headers;
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return headers;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Anonymous fallback
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") {
        message = body.detail;
      }
    } catch {
      // Ignore non-JSON error body
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export interface UploadRequestOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export async function uploadWithProgress<T>(params: {
  url: string;
  formData: FormData;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<T> {
  const authHeaders = await getOptionalAuthHeaders();

  if (typeof XMLHttpRequest === "undefined") {
    return fetch(params.url, {
      method: "POST",
      headers: authHeaders,
      body: params.formData,
      signal: params.signal,
    }).then((res) => handleResponse<T>(res));
  }

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", params.url, true);
    if (authHeaders.Authorization) {
      xhr.setRequestHeader("Authorization", authHeaders.Authorization);
    }

    const handleAbort = () => {
      xhr.abort();
      reject(new DOMException("Upload cancelled by user.", "AbortError"));
    };

    if (params.signal) {
      if (params.signal.aborted) {
        reject(new DOMException("Upload cancelled by user.", "AbortError"));
        return;
      }
      params.signal.addEventListener("abort", handleAbort, { once: true });
    }

    xhr.upload.onprogress = (event) => {
      if (!params.onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        params.onProgress(pct);
      }
    };

    xhr.onload = () => {
      params.signal?.removeEventListener("abort", handleAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          reject(new Error("Invalid JSON response from MixBench server."));
        }
      } else {
        let message = `Request failed (${xhr.status})`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (typeof parsed?.detail === "string") {
            message = parsed.detail;
          }
        } catch {
          // Ignore non-JSON error body
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => {
      params.signal?.removeEventListener("abort", handleAbort);
      reject(new Error("Network error while uploading audio to MixBench DSP backend."));
    };

    xhr.onabort = () => {
      params.signal?.removeEventListener("abort", handleAbort);
      reject(new DOMException("Upload cancelled by user.", "AbortError"));
    };

    xhr.send(params.formData);
  });
}

export async function checkBackendHealth(): Promise<BackendHealth> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(resolveApiUrl("/health"), {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    return await handleResponse<BackendHealth>(res);
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchPublicDemoFile(demoUrlPath: string, filename: string): Promise<File> {
  const res = await fetch(demoUrlPath);
  if (!res.ok) {
    throw new Error(`Could not load demo audio fixture (${res.status}).`);
  }
  const blob = await res.blob();
  return new File([blob], filename, { type: "audio/wav" });
}

export async function analyzeMixFile(params: {
  file: File;
  genre: GenreType;
  stage: StageType;
  artistVision: ArtistVisionTag[];
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<AnalysisReport> {
  const form = new FormData();
  form.append("file", params.file);
  form.append("genre", params.genre);
  form.append("stage", params.stage);
  form.append("artist_vision", JSON.stringify(params.artistVision));

  return uploadWithProgress<AnalysisReport>({
    url: resolveApiUrl("/api/analyze"),
    formData: form,
    onProgress: params.onProgress,
    signal: params.signal,
  });
}

export async function loadDemoSession(params: {
  genre: GenreType;
  stage: StageType;
  artistVision: ArtistVisionTag[];
}): Promise<AnalysisReport> {
  const form = new FormData();
  form.append("genre", params.genre);
  form.append("stage", params.stage);
  form.append("artist_vision", JSON.stringify(params.artistVision));

  const res = await fetch(resolveApiUrl("/api/v1/sessions/demo"), {
    method: "POST",
    headers: await getOptionalAuthHeaders(),
    body: form,
  });
  return handleResponse<AnalysisReport>(res);
}

export async function uploadReferenceTrack(
  sessionId: string,
  file: File,
  options?: UploadRequestOptions
): Promise<ReferenceTrackMeta> {
  const form = new FormData();
  form.append("file", file);
  return uploadWithProgress<ReferenceTrackMeta>({
    url: resolveApiUrl(`/api/v1/sessions/${sessionId}/reference`),
    formData: form,
    onProgress: options?.onProgress,
    signal: options?.signal,
  });
}

export async function loadDemoReferenceTrack(sessionId: string): Promise<ReferenceTrackMeta> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/reference/demo`), {
    method: "POST",
    headers: await getOptionalAuthHeaders(),
  });
  return handleResponse<ReferenceTrackMeta>(res);
}

export async function uploadUserStems(
  sessionId: string,
  files: File[],
  options?: UploadRequestOptions
): Promise<AnalysisReport> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  return uploadWithProgress<AnalysisReport>({
    url: resolveApiUrl(`/api/v1/sessions/${sessionId}/stems`),
    formData: form,
    onProgress: options?.onProgress,
    signal: options?.signal,
  });
}

export async function loadDemoStems(sessionId: string): Promise<AnalysisReport> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/stems/demo`), {
    method: "POST",
    headers: await getOptionalAuthHeaders(),
  });
  return handleResponse<AnalysisReport>(res);
}

export async function compareRevisedMix(
  sessionId: string,
  file: File,
  options?: UploadRequestOptions
): Promise<AnalysisReport> {
  const form = new FormData();
  form.append("file", file);
  return uploadWithProgress<AnalysisReport>({
    url: resolveApiUrl(`/api/v1/sessions/${sessionId}/compare`),
    formData: form,
    onProgress: options?.onProgress,
    signal: options?.signal,
  });
}

export async function compareDemoRevision(sessionId: string): Promise<AnalysisReport> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/compare/demo`), {
    method: "POST",
    headers: await getOptionalAuthHeaders(),
  });
  return handleResponse<AnalysisReport>(res);
}

export async function compareSavedReports(
  baseline: AnalysisReport,
  revised: AnalysisReport
): Promise<RevisionComparison> {
  const res = await fetch(resolveApiUrl("/api/compare"), {
    method: "POST",
    headers: await getOptionalAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ baseline, revised }),
  });
  return handleResponse<RevisionComparison>(res);
}

export interface SessionContextUpdatePayload {
  genre?: GenreType;
  stage?: StageType;
  artist_vision?: ArtistVisionTag[];
  daw?: string;
  bus_routing?: string;
  plugin_notes?: string;
  source_tag?: "user_reported_context";
}

export async function updateSessionContext(
  sessionId: string,
  payload: SessionContextUpdatePayload
): Promise<AnalysisReport> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/context`), {
    method: "POST",
    headers: await getOptionalAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ...payload, source_tag: "user_reported_context" }),
  });
  return handleResponse<AnalysisReport>(res);
}

export async function updateDawContext(
  sessionId: string,
  context: Omit<UserReportedContext, "source_tag">
): Promise<AnalysisReport> {
  return updateSessionContext(sessionId, {
    ...context,
    source_tag: "user_reported_context",
  });
}

export async function askMentor(
  sessionId: string,
  payload: MentorRequest
): Promise<MentorResponse> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/mentor`), {
    method: "POST",
    headers: await getOptionalAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return handleResponse<MentorResponse>(res);
}

export async function clearSession(sessionId: string): Promise<void> {
  await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}`), {
    method: "DELETE",
    headers: await getOptionalAuthHeaders(),
  });
}

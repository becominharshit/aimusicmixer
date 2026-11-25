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
  timeoutMs?: number;
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
    xhr.timeout = params.timeoutMs ?? PRECISION_SYNC_TIMEOUT_MS;
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

    xhr.ontimeout = () => {
      params.signal?.removeEventListener("abort", handleAbort);
      const err = new Error("Precision DSP request timed out before the server responded.");
      err.name = "TimeoutError";
      reject(err);
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

export const PRECISION_SYNC_TIMEOUT_MS = 120_000;
export const COMPARE_REQUEST_TIMEOUT_MS = 30_000;

export async function analyzeMixFile(params: {
  file: File;
  genre: GenreType;
  stage: StageType;
  artistVision: ArtistVisionTag[];
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  endpoint?: "/api/analyze" | "/api/v1/analyze";
}): Promise<AnalysisReport> {
  const form = new FormData();
  form.append("file", params.file);
  form.append("genre", params.genre);
  form.append("stage", params.stage);
  form.append("artist_vision", JSON.stringify(params.artistVision));

  return uploadWithProgress<AnalysisReport>({
    url: resolveApiUrl(params.endpoint ?? "/api/analyze"),
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

function isAbortOrTimeoutError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))
  );
}

export async function compareRevisedMix(
  sessionId: string,
  file: File,
  options?: UploadRequestOptions,
  timeoutMs: number = COMPARE_REQUEST_TIMEOUT_MS
): Promise<AnalysisReport> {
  const form = new FormData();
  form.append("file", file);

  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  if (options?.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await uploadWithProgress<AnalysisReport>({
      url: resolveApiUrl(`/api/v1/sessions/${sessionId}/compare`),
      formData: form,
      onProgress: options?.onProgress,
      signal: controller.signal,
      timeoutMs,
    });
  } catch (err) {
    if (timedOut) {
      throw new Error(
        `Revision comparison timed out after ${Math.round(timeoutMs / 1000)} seconds. Please retry.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    options?.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function compareSavedReports(
  baseline: AnalysisReport,
  revised?: AnalysisReport,
  timeoutMs: number = COMPARE_REQUEST_TIMEOUT_MS
): Promise<RevisionComparison> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(resolveApiUrl("/api/compare"), {
      method: "POST",
      headers: await getOptionalAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(revised ? { baseline, revised } : { baseline }),
      signal: controller.signal,
    });
    return await handleResponse<RevisionComparison>(res);
  } catch (err) {
    if (isAbortOrTimeoutError(err)) {
      throw new Error(
        `Revision comparison timed out after ${Math.round(timeoutMs / 1000)} seconds. Please retry.`
      );
    }
    if (err instanceof TypeError) {
      throw new Error("Could not reach the comparison server due to a network interruption. Please retry.");
    }
    throw err instanceof Error ? err : new Error("Revision comparison failed. Please retry.");
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function compareDemoRevision(
  sessionId: string,
  baselineReport?: AnalysisReport,
  timeoutMs: number = COMPARE_REQUEST_TIMEOUT_MS
): Promise<AnalysisReport> {
  const hasActiveServerSession = Boolean(sessionId && !sessionId.startsWith("local_"));

  if (!hasActiveServerSession && baselineReport) {
    const comparison = await compareSavedReports(baselineReport, undefined, timeoutMs);
    return {
      ...baselineReport,
      revision_comparison: comparison,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let shouldFallbackToStateless = false;

  try {
    const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/compare/demo`), {
      method: "POST",
      headers: await getOptionalAuthHeaders(
        baselineReport ? { "Content-Type": "application/json" } : undefined
      ),
      body: baselineReport ? JSON.stringify({ baseline: baselineReport }) : undefined,
      signal: controller.signal,
    });
    if ((res.status === 404 || res.status === 405 || res.status === 501) && baselineReport) {
      shouldFallbackToStateless = true;
    } else {
      return await handleResponse<AnalysisReport>(res);
    }
  } catch (err) {
    if (isAbortOrTimeoutError(err)) {
      throw new Error(
        `Sample v2 comparison timed out after ${Math.round(timeoutMs / 1000)} seconds. Please retry.`
      );
    }
    if (err instanceof TypeError) {
      throw new Error("Could not reach the comparison server due to a network interruption. Please retry.");
    }
    throw err instanceof Error ? err : new Error("Sample v2 comparison failed. Please retry.");
  } finally {
    clearTimeout(timeoutId);
  }

  if (shouldFallbackToStateless && baselineReport) {
    const comparison = await compareSavedReports(baselineReport, undefined, timeoutMs);
    return {
      ...baselineReport,
      revision_comparison: comparison,
    };
  }

  throw new Error("Session expired or not found.");
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

export const MENTOR_REQUEST_TIMEOUT_MS = 42_000;

function mapMentorFetchError(err: unknown, timeoutMs: number): Error {
  if (isAbortOrTimeoutError(err)) {
    return new Error(
      `AI Mix Mentor timed out after ${Math.round(timeoutMs / 1000)} seconds. Your session is intact — retry or switch to the instant Offline Deterministic Mentor below.`
    );
  }
  if (err instanceof TypeError) {
    return new Error(
      "Could not reach the AI Mix Mentor service due to a network interruption. Retry or run the Offline Deterministic Mentor below."
    );
  }
  return err instanceof Error
    ? err
    : new Error("AI Mix Mentor request failed unexpectedly. Please retry or use Offline Mode.");
}

export async function askMentor(
  sessionId: string,
  payload: MentorRequest,
  timeoutMs: number = MENTOR_REQUEST_TIMEOUT_MS
): Promise<MentorResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/mentor`), {
      method: "POST",
      headers: await getOptionalAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return await handleResponse<MentorResponse>(res);
  } catch (err) {
    throw mapMentorFetchError(err, timeoutMs);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function askMentorStandalone(
  report: AnalysisReport,
  payload: MentorRequest,
  timeoutMs: number = MENTOR_REQUEST_TIMEOUT_MS
): Promise<MentorResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(resolveApiUrl("/api/mentor"), {
      method: "POST",
      headers: await getOptionalAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        ...payload,
        session_id: report.session_id && !report.session_id.startsWith("local_") ? report.session_id : null,
        report,
      }),
      signal: controller.signal,
    });
    return await handleResponse<MentorResponse>(res);
  } catch (err) {
    throw mapMentorFetchError(err, timeoutMs);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function clearSession(sessionId: string): Promise<void> {
  await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}`), {
    method: "DELETE",
    headers: await getOptionalAuthHeaders(),
  });
}

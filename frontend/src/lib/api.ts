import type {
  AnalysisReport,
  ArtistVisionTag,
  BackendHealth,
  GenreType,
  MentorRequest,
  MentorResponse,
  ReferenceTrackMeta,
  StageType,
  UserReportedContext,
} from "@/types/report";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "") ||
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "") ||
  "http://localhost:8000";

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
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
}): Promise<AnalysisReport> {
  const form = new FormData();
  form.append("file", params.file);
  form.append("genre", params.genre);
  form.append("stage", params.stage);
  form.append("artist_vision", JSON.stringify(params.artistVision));

  const res = await fetch(resolveApiUrl("/api/analyze"), {
    method: "POST",
    body: form,
  });
  return handleResponse<AnalysisReport>(res);
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
    body: form,
  });
  return handleResponse<AnalysisReport>(res);
}

export async function uploadReferenceTrack(
  sessionId: string,
  file: File
): Promise<ReferenceTrackMeta> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/reference`), {
    method: "POST",
    body: form,
  });
  return handleResponse<ReferenceTrackMeta>(res);
}

export async function loadDemoReferenceTrack(sessionId: string): Promise<ReferenceTrackMeta> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/reference/demo`), {
    method: "POST",
  });
  return handleResponse<ReferenceTrackMeta>(res);
}

export async function uploadUserStems(
  sessionId: string,
  files: File[]
): Promise<AnalysisReport> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/stems`), {
    method: "POST",
    body: form,
  });
  return handleResponse<AnalysisReport>(res);
}

export async function loadDemoStems(sessionId: string): Promise<AnalysisReport> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/stems/demo`), {
    method: "POST",
  });
  return handleResponse<AnalysisReport>(res);
}

export async function compareRevisedMix(
  sessionId: string,
  file: File
): Promise<AnalysisReport> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/compare`), {
    method: "POST",
    body: form,
  });
  return handleResponse<AnalysisReport>(res);
}

export async function compareDemoRevision(sessionId: string): Promise<AnalysisReport> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/compare/demo`), {
    method: "POST",
  });
  return handleResponse<AnalysisReport>(res);
}

export async function updateDawContext(
  sessionId: string,
  context: Omit<UserReportedContext, "source_tag">
): Promise<AnalysisReport> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/context`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...context, source_tag: "user_reported_context" }),
  });
  return handleResponse<AnalysisReport>(res);
}

export async function askMentor(
  sessionId: string,
  payload: MentorRequest
): Promise<MentorResponse> {
  const res = await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}/mentor`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<MentorResponse>(res);
}

export async function clearSession(sessionId: string): Promise<void> {
  await fetch(resolveApiUrl(`/api/v1/sessions/${sessionId}`), {
    method: "DELETE",
  });
}

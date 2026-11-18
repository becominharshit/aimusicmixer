import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveSampleAssetsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "..", "assets", "test-audio"),
    path.resolve(process.cwd(), "assets", "test-audio"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function parsePositiveInt(val: string | undefined, fallback: number): number {
  const n = Number.parseInt(val ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const serverConfig = {
  maxSingleFileMb: parsePositiveInt(process.env.MAX_SINGLE_FILE_MB, 50),
  maxStemTotalMb: parsePositiveInt(process.env.MAX_STEM_TOTAL_MB, 150),
  sessionTtlMinutes: parsePositiveInt(process.env.SESSION_TTL_MINUTES, 60),
  maxDiskSessions: parsePositiveInt(process.env.MAX_DISK_SESSIONS, 15),
  rateLimitMaxRequests: parsePositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, 30),
  rateLimitWindowSeconds: parsePositiveInt(process.env.RATE_LIMIT_WINDOW_SECONDS, 60),
  get maxSingleFileBytes(): number {
    return this.maxSingleFileMb * 1024 * 1024;
  },
  get maxStemTotalBytes(): number {
    return this.maxStemTotalMb * 1024 * 1024;
  },
  tmpSessionsDir: path.join(os.tmpdir(), "mixbench_sessions"),
  tmpUploadsDir: path.join(os.tmpdir(), "mixbench_uploads"),
  sampleAssetsDir: resolveSampleAssetsDir(),
  get geminiApiKey(): string {
    return (process.env.GEMINI_API_KEY ?? "").trim();
  },
  get geminiModel(): string {
    return (process.env.GEMINI_MODEL ?? "").trim() || "gemini-2.5-flash";
  },
};

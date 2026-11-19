import { NextResponse } from "next/server";
import { serverConfig } from "@/server/config";
import { DSP_CONCURRENCY_LIMIT, checkFfmpegAvailable } from "@/server/api/routeHelpers";
import { sessionStore } from "@/server/services/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ffmpegAvailable = await checkFfmpegAvailable();
  return NextResponse.json({
    status: "ok",
    version: "1.0.0",
    contract_version: "1.0.0",
    ffmpeg_available: ffmpegAvailable,
    gemini_configured: Boolean(serverConfig.geminiApiKey),
    gemini_model: serverConfig.geminiModel,
    dsp_concurrency_limit: DSP_CONCURRENCY_LIMIT,
    sha256_cache_entries: sessionStore.sha256CacheSize,
  });
}

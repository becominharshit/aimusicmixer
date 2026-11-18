import { NextResponse } from "next/server";
import { serverConfig } from "@/server/config";
import { checkFfmpegAvailable } from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ffmpegAvailable = await checkFfmpegAvailable();
  return NextResponse.json({
    status: "ok",
    version: "1.0.0",
    ffmpeg_available: ffmpegAvailable,
    gemini_configured: Boolean(serverConfig.geminiApiKey),
    gemini_model: serverConfig.geminiModel,
  });
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import type { AnalysisReport } from "@/types/report";
import { compareRevisions } from "@/server/rules/revisions";
import { analyzeAudioToReport } from "@/server/services/analyzer";
import { handleRouteError, HttpStatusError, rateLimitErrorResponse } from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const demoV2Cache = new Map<string, AnalysisReport>();

function resolveDemoV2Path(): string | null {
  const candidates = [
    path.join(process.cwd(), "public", "demo", "demo-revised-v2.wav"),
    path.join(process.cwd(), "frontend", "public", "demo", "demo-revised-v2.wav"),
    path.join(process.cwd(), "..", "backend", "sample_assets", "revised_mix_v2.wav"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function getOrBuildDemoV2Report(baseline: AnalysisReport): Promise<AnalysisReport> {
  const ctxKey = `${baseline.context.genre}|${baseline.context.stage}|${baseline.context.artist_vision.join(",")}`;
  const cached = demoV2Cache.get(ctxKey);
  if (cached) {
    return cached;
  }
  const demoPath = resolveDemoV2Path();
  if (!demoPath) {
    throw new HttpStatusError(404, "Demo revised_mix_v2.wav fixture not found.");
  }
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mixit_demo_v2_"));
  try {
    const { report } = await analyzeAudioToReport({
      sessionId: baseline.session_id || "demo_v2",
      sourcePath: demoPath,
      originalFilename: "revised_mix_v2.wav",
      proxyDir: tmpDir,
      proxyName: "v2",
      proxyUrl: "/demo/demo-revised-v2.wav",
      context: {
        genre: baseline.context.genre,
        stage: baseline.context.stage,
        artist_vision: [...baseline.context.artist_vision],
        has_user_stems: false,
        stem_count: 0,
        user_reported_context: baseline.context.user_reported_context ?? null,
      },
    });
    report.audio_metadata.playback_proxy_url = "/demo/demo-revised-v2.wav";
    demoV2Cache.set(ctxKey, report);
    return report;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function POST(request: Request) {
  const limited = rateLimitErrorResponse(request, "compare");
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      baseline?: AnalysisReport;
      revised?: AnalysisReport | null;
    };
    if (!body?.baseline) {
      throw new HttpStatusError(422, "Provide a 'baseline' AnalysisReport payload.");
    }
    const revised = body.revised ?? (await getOrBuildDemoV2Report(body.baseline));
    return NextResponse.json(compareRevisions(body.baseline, revised));
  } catch (err) {
    return handleRouteError(err);
  }
}

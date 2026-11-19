import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { AnalysisContext } from "@/types/report";
import { serverConfig } from "@/server/config";
import { analyzeAudioToReport } from "@/server/services/analyzer";
import { sessionStore } from "@/server/services/sessionStore";
import {
  HttpStatusError,
  handleRouteError,
  instantiateReportFromCachedDemo,
  parseArtistVision,
  parseGenre,
  parseStage,
  proxyFilenameInDir,
  rateLimitErrorResponse,
} from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimitErrorResponse(request, "demo");
  if (limited) return limited;

  let sessionIdForCleanup = "";
  try {
    const demoSrc = path.join(serverConfig.sampleAssetsDir, "unmastered_mix_v1.wav");
    if (!fs.existsSync(demoSrc)) {
      throw new HttpStatusError(404, "Sample demo mix asset has not been generated yet.");
    }

    let rawGenre: unknown = "electronic";
    let rawStage: unknown = "unmastered_mix";
    let rawVision: unknown = '["punchy","wide"]';

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data") || contentType.includes("x-www-form-urlencoded")) {
      const form = await request.formData();
      rawGenre = form.get("genre") ?? rawGenre;
      rawStage = form.get("stage") ?? rawStage;
      rawVision = form.get("artist_vision") ?? rawVision;
    }

    const rec = await sessionStore.createSession();
    sessionIdForCleanup = rec.sessionId;
    const context: AnalysisContext = {
      genre: parseGenre(rawGenre),
      stage: parseStage(rawStage),
      artist_vision: parseArtistVision(rawVision),
      has_user_stems: false,
      stem_count: 0,
    };

    const proxyDir = path.join(rec.directory, "proxies");
    const stat = await fsp.stat(demoSrc);
    const cacheKey = path.resolve(demoSrc);
    const cached = sessionStore.demoMixCache.get(cacheKey);

    if (cached && cached.mtimeMs === stat.mtimeMs) {
      const { report, proxyPath } = await instantiateReportFromCachedDemo({
        sessionId: rec.sessionId,
        originalFilename: "unmastered_mix_v1.wav",
        proxyDir,
        proxyName: "proxy",
        context,
        cached,
      });
      const actualProxy = path.basename(proxyPath);
      rec.proxyFiles.set(actualProxy, proxyPath);
      rec.primaryAudioPath = proxyPath;
      rec.primaryLoaded = cached.loaded;
      rec.primaryReport = report;
      rec.primarySnapshot = cached.snapshot;
      return NextResponse.json(report);
    }

    const { report, loaded, snapshot } = await analyzeAudioToReport({
      sessionId: rec.sessionId,
      sourcePath: demoSrc,
      originalFilename: "unmastered_mix_v1.wav",
      proxyDir,
      proxyName: "proxy",
      proxyUrl: `/api/v1/sessions/${rec.sessionId}/proxy/proxy`,
      context,
    });

    const actualProxy = proxyFilenameInDir(proxyDir, "proxy");
    const proxyPath = path.join(proxyDir, actualProxy);
    report.audio_metadata.playback_proxy_url = `/api/v1/sessions/${rec.sessionId}/proxy/${actualProxy}`;

    if (fs.existsSync(proxyPath)) {
      sessionStore.demoMixCache.set(cacheKey, {
        mtimeMs: stat.mtimeMs,
        loaded,
        snapshot,
        globalMetrics: report.global_metrics,
        timeSeries: report.time_series,
        proxyBytes: await fsp.readFile(proxyPath),
        proxyExt: path.extname(proxyPath),
      });
    }

    rec.proxyFiles.set(actualProxy, proxyPath);
    rec.primaryAudioPath = proxyPath;
    rec.primaryLoaded = loaded;
    rec.primaryReport = report;
    rec.primarySnapshot = snapshot;

    return NextResponse.json(report);
  } catch (err) {
    if (sessionIdForCleanup) {
      await sessionStore.deleteSession(sessionIdForCleanup);
    }
    return handleRouteError(err);
  }
}

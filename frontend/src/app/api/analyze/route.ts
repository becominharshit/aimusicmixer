import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { AnalysisContext, UserReportedContext } from "@/types/report";
import { serverConfig } from "@/server/config";
import { analyzeAudioToReport } from "@/server/services/analyzer";
import { sessionStore } from "@/server/services/sessionStore";
import {
  HttpStatusError,
  handleRouteError,
  parseArtistVision,
  parseGenre,
  parseStage,
  proxyFilenameInDir,
  rateLimitErrorResponse,
  saveUploadedFileBounded,
  tmpUploadPath,
} from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimitErrorResponse(request, "analyze");
  if (limited) return limited;

  const rec = await sessionStore.createSession();
  let tmpPath = "";

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new HttpStatusError(422, "Missing required audio file field 'file'.");
    }

    const safeName = path.basename(file.name || "mix.wav");
    tmpPath = tmpUploadPath("primary", safeName);
    await saveUploadedFileBounded(file, tmpPath, serverConfig.maxSingleFileBytes);

    const daw = String(formData.get("daw") ?? "").trim();
    const busRouting = String(formData.get("bus_routing") ?? "").trim();
    const pluginNotes = String(formData.get("plugin_notes") ?? "").trim();
    const userCtx: UserReportedContext | null =
      daw || busRouting || pluginNotes
        ? { daw, bus_routing: busRouting, plugin_notes: pluginNotes, source_tag: "user_reported_context" }
        : null;

    const context: AnalysisContext = {
      genre: parseGenre(formData.get("genre")),
      stage: parseStage(formData.get("stage")),
      artist_vision: parseArtistVision(formData.get("artist_vision")),
      has_user_stems: false,
      stem_count: 0,
      user_reported_context: userCtx,
    };

    const proxyDir = path.join(rec.directory, "proxies");
    const { report, loaded, snapshot } = await analyzeAudioToReport({
      sessionId: rec.sessionId,
      sourcePath: tmpPath,
      originalFilename: safeName,
      proxyDir,
      proxyName: "proxy",
      proxyUrl: `/api/v1/sessions/${rec.sessionId}/proxy/proxy`,
      context,
      maxFileBytes: serverConfig.maxSingleFileBytes,
    });

    const actualProxy = proxyFilenameInDir(proxyDir, "proxy");
    const proxyPath = path.join(proxyDir, actualProxy);
    report.audio_metadata.playback_proxy_url = `/api/v1/sessions/${rec.sessionId}/proxy/${actualProxy}`;
    rec.proxyFiles.set(actualProxy, proxyPath);
    rec.primaryAudioPath = proxyPath;
    rec.primaryLoaded = loaded;
    rec.primaryReport = report;
    rec.primarySnapshot = snapshot;

    return NextResponse.json(report);
  } catch (err) {
    await sessionStore.deleteSession(rec.sessionId);
    return handleRouteError(err);
  } finally {
    if (tmpPath) {
      await fsp.rm(tmpPath, { force: true }).catch(() => undefined);
    }
  }
}

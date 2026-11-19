import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { AnalysisContext, UserReportedContext } from "@/types/report";
import { serverConfig } from "@/server/config";
import { validateAudioMagicBytes } from "@/server/dsp/ingest";
import { analyzeAudioToReport } from "@/server/services/analyzer";
import { sessionStore } from "@/server/services/sessionStore";
import {
  HttpStatusError,
  extractVerifiedJwtSub,
  handleRouteError,
  instantiateReportFromSha256Cache,
  parseArtistVision,
  parseGenre,
  parseStage,
  proxyFilenameInDir,
  rateLimitErrorResponse,
  saveUploadedFileBoundedWithHash,
  tmpUploadPath,
  withDspSemaphore,
} from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimitErrorResponse(request, "analyze");
  if (limited) return limited;

  const ownerUserId = extractVerifiedJwtSub(request);
  const rec = await sessionStore.createSession(ownerUserId);
  let tmpPath = "";

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new HttpStatusError(422, "Missing required audio file field 'file'.");
    }

    const safeName = path.basename(file.name || "mix.wav");
    tmpPath = tmpUploadPath("primary", safeName);
    const { sha256 } = await saveUploadedFileBoundedWithHash(
      file,
      tmpPath,
      serverConfig.maxSingleFileBytes
    );
    await validateAudioMagicBytes(tmpPath);

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

    const cachedHash = sessionStore.getCachedAnalysisByHash(sha256);
    if (cachedHash) {
      const { report, proxyPath } = await instantiateReportFromSha256Cache({
        sessionId: rec.sessionId,
        originalFilename: safeName,
        proxyDir,
        proxyName: "proxy",
        context,
        cached: cachedHash,
      });
      const actualProxy = path.basename(proxyPath);
      rec.proxyFiles.set(actualProxy, proxyPath);
      rec.primaryAudioPath = proxyPath;
      rec.primaryLoaded = null;
      rec.primaryReport = report;
      rec.primarySnapshot = cachedHash.snapshot;
      return NextResponse.json(report);
    }

    const { report, loaded, snapshot } = await withDspSemaphore(() =>
      analyzeAudioToReport({
        sessionId: rec.sessionId,
        sourcePath: tmpPath,
        originalFilename: safeName,
        proxyDir,
        proxyName: "proxy",
        proxyUrl: `/api/v1/sessions/${rec.sessionId}/proxy/proxy`,
        context,
        maxFileBytes: serverConfig.maxSingleFileBytes,
      })
    );

    const actualProxy = proxyFilenameInDir(proxyDir, "proxy");
    const proxyPath = path.join(proxyDir, actualProxy);
    report.audio_metadata.playback_proxy_url = `/api/v1/sessions/${rec.sessionId}/proxy/${actualProxy}`;
    rec.proxyFiles.set(actualProxy, proxyPath);
    rec.primaryAudioPath = proxyPath;
    rec.primaryLoaded = loaded;
    rec.primaryReport = report;
    rec.primarySnapshot = snapshot;

    if (fs.existsSync(proxyPath)) {
      sessionStore.setCachedAnalysisByHash(sha256, {
        sha256,
        durationSec: loaded.durationSec,
        sampleRate: loaded.sampleRate,
        channels: loaded.channels,
        bitDepth: loaded.bitDepth,
        waveformPeaks: loaded.waveformPeaks,
        snapshot,
        globalMetrics: { ...report.global_metrics },
        timeSeries: {
          step_sec: report.time_series.step_sec,
          short_term_lufs: [...report.time_series.short_term_lufs],
          phase_correlation: [...report.time_series.phase_correlation],
        },
        proxyBytes: await fsp.readFile(proxyPath),
        proxyExt: path.extname(proxyPath),
      });
    }

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

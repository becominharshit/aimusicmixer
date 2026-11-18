import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { serverConfig } from "@/server/config";
import { analyzeUserStems } from "@/server/dsp/stems";
import { sessionStore } from "@/server/services/sessionStore";
import {
  HttpStatusError,
  handleRouteError,
  rateLimitErrorResponse,
  saveUploadedFileBounded,
} from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimitErrorResponse(request, "stems");
  if (limited) return limited;

  let tmpDir = "";
  try {
    const formData = await request.formData();
    const sessionId = String(formData.get("session_id") ?? "").trim() || null;
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);

    if (files.length < 2 || files.length > 8) {
      throw new HttpStatusError(
        422,
        `Upload between 2 and 8 original stems (received ${files.length}).`
      );
    }

    let rec = null;
    if (sessionId) {
      rec = await sessionStore.getSession(sessionId);
      if (!rec || !rec.primaryReport) {
        throw new HttpStatusError(404, "Session expired or not found.");
      }
    }

    tmpDir = path.join(os.tmpdir(), `mixbench_stems_${crypto.randomUUID()}`);
    await fsp.mkdir(tmpDir, { recursive: true });
    const savedStems: Array<[string, string]> = [];
    let runningTotal = 0;

    for (let idx = 0; idx < files.length; idx++) {
      const f = files[idx];
      const safeName = path.basename(f.name || `stem_${idx + 1}.wav`);
      const stemPath = path.join(tmpDir, `${String(idx).padStart(2, "0")}_${safeName}`);
      const size = await saveUploadedFileBounded(f, stemPath, serverConfig.maxSingleFileBytes);
      runningTotal += size;
      if (runningTotal > serverConfig.maxStemTotalBytes) {
        throw new HttpStatusError(
          413,
          `Combined stems exceed the ${serverConfig.maxStemTotalMb} MB session limit.`
        );
      }
      savedStems.push([safeName, stemPath]);
    }

    const mixAudio = rec ? await sessionStore.getOrReloadPrimaryAudio(rec) : null;
    const stemAnalysis = await analyzeUserStems(
      savedStems,
      mixAudio,
      serverConfig.maxStemTotalBytes
    );

    if (rec && rec.primaryReport) {
      rec.primaryReport.context.has_user_stems = true;
      rec.primaryReport.context.stem_count = savedStems.length;
      rec.primaryReport.stem_analysis = stemAnalysis;
      return NextResponse.json(rec.primaryReport);
    }

    return NextResponse.json(stemAnalysis);
  } catch (err) {
    return handleRouteError(err);
  } finally {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

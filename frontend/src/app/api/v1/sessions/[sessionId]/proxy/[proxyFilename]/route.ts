import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { sessionStore } from "@/server/services/sessionStore";
import { HttpStatusError, assertSessionAccess, handleRouteError } from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string; proxyFilename: string }> }
) {
  try {
    const { sessionId, proxyFilename } = await context.params;
    const rec = await sessionStore.getSession(sessionId);
    if (!rec) {
      throw new HttpStatusError(404, "Session expired or not found.");
    }
    assertSessionAccess(rec, request);

    let proxyPath = rec.proxyFiles.get(proxyFilename) ?? null;
    if (!proxyPath || !fs.existsSync(proxyPath)) {
      const proxiesRoot = path.resolve(rec.directory, "proxies");
      const candidate = path.resolve(proxiesRoot, path.basename(proxyFilename));
      if (!candidate.startsWith(proxiesRoot + path.sep) || !fs.existsSync(candidate)) {
        throw new HttpStatusError(404, "Audio playback proxy not found.");
      }
      proxyPath = candidate;
    }

    const bytes = await fsp.readFile(proxyPath);
    const contentType = proxyPath.toLowerCase().endsWith(".m4a") ? "audio/mp4" : "audio/wav";
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=300",
        "Accept-Ranges": "bytes",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

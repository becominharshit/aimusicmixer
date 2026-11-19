import { NextResponse } from "next/server";
import type { AnalysisContext, ArtistVisionTag, GenreType, StageType, UserReportedContext } from "@/types/report";
import { compareRevisions } from "@/server/rules/revisions";
import { reevaluateReportContext } from "@/server/services/analyzer";
import { sessionStore } from "@/server/services/sessionStore";
import {
  HttpStatusError,
  assertSessionAccess,
  handleRouteError,
  parseArtistVision,
  parseGenre,
  parseStage,
  rateLimitErrorResponse,
} from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const limited = rateLimitErrorResponse(request, "context");
  if (limited) return limited;

  try {
    const { sessionId } = await context.params;
    const rec = await sessionStore.getSession(sessionId);
    if (!rec || !rec.primaryReport) {
      throw new HttpStatusError(404, "Session expired or not found.");
    }
    assertSessionAccess(rec, request);

    const body = (await request.json()) as {
      genre?: GenreType;
      stage?: StageType;
      artist_vision?: ArtistVisionTag[];
      daw?: string;
      bus_routing?: string;
      plugin_notes?: string;
    };

    const curCtx: AnalysisContext = JSON.parse(JSON.stringify(rec.primaryReport.context));
    if (body.genre !== undefined) curCtx.genre = parseGenre(body.genre);
    if (body.stage !== undefined) curCtx.stage = parseStage(body.stage);
    if (body.artist_vision !== undefined) {
      curCtx.artist_vision = parseArtistVision(JSON.stringify(body.artist_vision));
    }

    const hasNotes =
      body.daw !== undefined || body.bus_routing !== undefined || body.plugin_notes !== undefined;
    if (hasNotes) {
      const existing: UserReportedContext = curCtx.user_reported_context ?? {
        daw: "",
        bus_routing: "",
        plugin_notes: "",
        source_tag: "user_reported_context",
      };
      curCtx.user_reported_context = {
        daw: (body.daw !== undefined ? String(body.daw) : existing.daw).trim(),
        bus_routing: (body.bus_routing !== undefined ? String(body.bus_routing) : existing.bus_routing).trim(),
        plugin_notes: (body.plugin_notes !== undefined ? String(body.plugin_notes) : existing.plugin_notes).trim(),
        source_tag: "user_reported_context",
      };
    }

    reevaluateReportContext(rec.primaryReport, rec.primarySnapshot, curCtx);
    if (rec.revisedReport) {
      rec.primaryReport.revision_comparison = compareRevisions(rec.primaryReport, rec.revisedReport);
    }
    return NextResponse.json(rec.primaryReport);
  } catch (err) {
    return handleRouteError(err);
  }
}

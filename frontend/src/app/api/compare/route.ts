import { NextResponse } from "next/server";
import type { AnalysisReport } from "@/types/report";
import { compareRevisions } from "@/server/rules/revisions";
import { handleRouteError, HttpStatusError, rateLimitErrorResponse } from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimitErrorResponse(request, "compare");
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      baseline?: AnalysisReport;
      revised?: AnalysisReport;
    };
    if (!body?.baseline || !body?.revised) {
      throw new HttpStatusError(422, "Provide both 'baseline' and 'revised' AnalysisReport payloads.");
    }
    return NextResponse.json(compareRevisions(body.baseline, body.revised));
  } catch (err) {
    return handleRouteError(err);
  }
}

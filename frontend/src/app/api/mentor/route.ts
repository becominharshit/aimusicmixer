import { NextResponse } from "next/server";
import type { AnalysisReport, MentorRequest } from "@/types/report";
import { generateMentorAdvice } from "@/server/ai/mentor";
import { sessionStore } from "@/server/services/sessionStore";
import {
  HttpStatusError,
  handleRouteError,
  rateLimitErrorResponse,
} from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimitErrorResponse(request, "mentor");
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      session_id?: string | null;
      report?: AnalysisReport | null;
      allow_metrics_ai?: boolean;
      allow_audio_ai?: boolean;
      allow_training_opt_in?: boolean;
      question?: string;
    };

    let req: MentorRequest = {
      allow_metrics_ai: Boolean(body.allow_metrics_ai),
      allow_audio_ai: Boolean(body.allow_audio_ai),
      allow_training_opt_in: Boolean(body.allow_training_opt_in),
      question: String(body.question ?? ""),
    };

    if (body.session_id) {
      const rec = await sessionStore.getSession(body.session_id);
      if (!rec || !rec.primaryReport) {
        throw new HttpStatusError(404, "Session expired or not found.");
      }
      const fallbackProxy =
        rec.proxyFiles.get("proxy.m4a") ?? rec.proxyFiles.get("proxy.wav") ?? null;
      const advice = await generateMentorAdvice(
        body.report ?? rec.primaryReport,
        req,
        rec.primaryAudioPath ?? fallbackProxy,
        fallbackProxy
      );
      rec.primaryReport.privacy_audit = advice.privacy_audit;
      return NextResponse.json(advice);
    }

    if (!body.report) {
      throw new HttpStatusError(422, "Provide either 'session_id' or a full DSP 'report'.");
    }

    if (req.allow_audio_ai) {
      req = { ...req, allow_audio_ai: false };
    }
    const advice = await generateMentorAdvice(body.report, req);
    return NextResponse.json(advice);
  } catch (err) {
    return handleRouteError(err);
  }
}

import { NextResponse } from "next/server";
import type { MentorRequest } from "@/types/report";
import { generateMentorAdvice } from "@/server/ai/mentor";
import { sessionStore } from "@/server/services/sessionStore";
import {
  HttpStatusError,
  assertSessionAccess,
  handleRouteError,
  rateLimitErrorResponse,
} from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const limited = rateLimitErrorResponse(request, "mentor");
  if (limited) return limited;

  try {
    const { sessionId } = await context.params;
    const rec = await sessionStore.getSession(sessionId);
    if (!rec || !rec.primaryReport) {
      throw new HttpStatusError(404, "Session expired or not found.");
    }
    assertSessionAccess(rec, request);

    const body = (await request.json()) as Partial<MentorRequest>;
    const req: MentorRequest = {
      allow_metrics_ai: Boolean(body.allow_metrics_ai),
      allow_audio_ai: Boolean(body.allow_audio_ai),
      allow_training_opt_in: Boolean(body.allow_training_opt_in),
      question: String(body.question ?? ""),
      conversation_history: Array.isArray(body.conversation_history)
        ? body.conversation_history
            .filter(
              (t) =>
                t &&
                (t.role === "user" || t.role === "assistant") &&
                typeof t.content === "string"
            )
            .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }))
        : [],
    };

    const fallbackProxy =
      rec.proxyFiles.get("proxy.m4a") ?? rec.proxyFiles.get("proxy.wav") ?? null;
    const advice = await generateMentorAdvice(
      rec.primaryReport,
      req,
      rec.primaryAudioPath ?? fallbackProxy,
      fallbackProxy
    );
    rec.primaryReport.privacy_audit = advice.privacy_audit;
    return NextResponse.json(advice);
  } catch (err) {
    return handleRouteError(err);
  }
}

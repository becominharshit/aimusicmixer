import { NextResponse } from "next/server";
import { sessionStore } from "@/server/services/sessionStore";
import { assertSessionAccess, handleRouteError } from "@/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    const rec = await sessionStore.getSession(sessionId);
    if (rec) {
      assertSessionAccess(rec, request);
    }
    const deleted = await sessionStore.deleteSession(sessionId);
    return NextResponse.json({ deleted, session_id: sessionId });
  } catch (err) {
    return handleRouteError(err);
  }
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function resolvePublicOrigin(request: Request, requestUrl: URL): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) {
    const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : "https";
    return `${proto}://${forwardedHost}`;
  }
  return requestUrl.origin;
}

function sanitizeNextPath(next: string | null): string {
  if (!next) return "/studio";
  const trimmed = next.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return "/studio";
  }
  return trimmed;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = resolvePublicOrigin(request, requestUrl);
  const code = requestUrl.searchParams.get("code");
  const incomingError =
    requestUrl.searchParams.get("error_description") ||
    requestUrl.searchParams.get("error");
  const safeNext = sanitizeNextPath(requestUrl.searchParams.get("next"));

  if (incomingError) {
    const target = new URL("/", origin);
    target.searchParams.set("auth_error", incomingError);
    return NextResponse.redirect(target.toString());
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!code || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Ignore read-only cookie store contexts
          }
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const target = new URL("/", origin);
    target.searchParams.set("auth_error", error.message || "Sign-in session exchange failed.");
    return NextResponse.redirect(target.toString());
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}

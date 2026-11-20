"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialError?: string | null;
  promptReason?: string | null;
  redirectTo?: string;
  onAuthSuccess?: () => void;
}

export function AuthModal({
  open,
  onOpenChange,
  initialError = null,
  promptReason = null,
  redirectTo = "/studio",
  onAuthSuccess,
}: AuthModalProps) {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialError) {
      setErrorMsg(initialError);
    } else if (!open) {
      setErrorMsg(null);
      setInfoMsg(null);
    }
  }, [open, initialError]);

  const configured = isSupabaseConfigured();

  const completeSignIn = () => {
    onAuthSuccess?.();
    onOpenChange(false);
    if (redirectTo) {
      router.push(redirectTo);
      router.refresh();
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setErrorMsg("Supabase authentication is not configured in this environment.");
      return;
    }

    if (authMode === "signup" && !consentChecked) {
      setErrorMsg(
        "Please agree to the Privacy Policy, Terms of Use, and Cookie Policy before creating an account."
      );
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      if (authMode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setErrorMsg(error.message);
        } else {
          completeSignIn();
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo:
              typeof window !== "undefined"
                ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`
                : undefined,
          },
        });
        if (error) {
          setErrorMsg(error.message);
        } else if (data.session) {
          completeSignIn();
        } else {
          setInfoMsg(
            "Account created. Check your inbox to confirm your email address before signing in."
          );
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Authentication request failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleOAuth = async () => {
    if (authMode === "signup" && !consentChecked) {
      setErrorMsg(
        "Please agree to the Privacy Policy, Terms of Use, and Cookie Policy before creating an account."
      );
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const nextParam = encodeURIComponent(redirectTo || "/studio");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/auth/callback?next=${nextParam}`
              : undefined,
        },
      });
      if (error) {
        setErrorMsg(error.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Google OAuth failed to start.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="auth-modal-desc"
        data-testid="auth-modal"
        className="max-w-md space-y-4"
      >
        <div className="space-y-2 pr-8">
          <MixitLogo variant="full" tone="auto" heightClass="h-6" />
          <DialogTitle className="font-condensed text-xl font-extrabold uppercase tracking-[0.02em] text-[var(--text-primary)]">
            {authMode === "signin" ? "Sign In to Mixit Studio" : "Create Mixit Account"}
          </DialogTitle>
          <p id="auth-modal-desc" className="text-xs leading-relaxed text-[var(--text-secondary)]">
            {promptReason || "Sign in to launch Mixit Studio and save your mix diagnostics."}
          </p>
        </div>

        {!configured ? (
          <div className="bg-[var(--bg-inset)] p-4 text-xs text-[var(--text-secondary)] hairline-border space-y-1.5">
            <div className="font-semibold text-[var(--text-primary)]">
              Studio Authentication Not Configured
            </div>
            <p>
              Set <code className="text-[var(--text-primary)]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code className="text-[var(--text-primary)]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
              enable Mixit Studio sign-in and private cloud mix history.
            </p>
            {errorMsg && (
              <div
                role="alert"
                className="mt-2 border border-[var(--studio-vermilion)] bg-[var(--studio-vermilion-soft)] px-3 py-2 text-xs text-[var(--studio-vermilion)]"
              >
                {errorMsg}
              </div>
            )}
          </div>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="w-full"
              disabled={loading}
              onClick={handleGoogleOAuth}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              Continue with Google
            </Button>

            <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              <span className="h-px flex-1 bg-[var(--border-hairline)]" />
              <span>or email</span>
              <span className="h-px flex-1 bg-[var(--border-hairline)]" />
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="auth-email"
                  className="block text-xs font-semibold uppercase tracking-[0.04em] text-[var(--text-primary)]"
                >
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="engineer@mixit.studio"
                  className="w-full bg-[var(--bg-inset)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hairline-border focus:border-[var(--border-active)] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-semibold uppercase tracking-[0.04em] text-[var(--text-primary)]"
                >
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full bg-[var(--bg-inset)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hairline-border focus:border-[var(--border-active)] focus:outline-none"
                />
              </div>

              {authMode === "signup" ? (
                <label
                  htmlFor="auth-signup-consent"
                  className="flex cursor-pointer items-start gap-2.5 border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-2.5 text-[11px] leading-relaxed text-[var(--text-secondary)]"
                >
                  <input
                    id="auth-signup-consent"
                    data-testid="signup-consent-checkbox"
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => {
                      setConsentChecked(e.target.checked);
                      if (e.target.checked) setErrorMsg(null);
                    }}
                    required
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#F0B44C] cursor-pointer"
                  />
                  <span>
                    I agree to the{" "}
                    <Link
                      href="/privacy"
                      className="font-semibold text-[var(--text-primary)] underline underline-offset-2 hover:text-[#EF6B63] dark:hover:text-[#F0B44C]"
                    >
                      Privacy Policy
                    </Link>
                    ,{" "}
                    <Link
                      href="/terms"
                      className="font-semibold text-[var(--text-primary)] underline underline-offset-2 hover:text-[#EF6B63] dark:hover:text-[#F0B44C]"
                    >
                      Terms of Use
                    </Link>
                    , and{" "}
                    <Link
                      href="/cookies"
                      className="font-semibold text-[var(--text-primary)] underline underline-offset-2 hover:text-[#EF6B63] dark:hover:text-[#F0B44C]"
                    >
                      Cookie Policy
                    </Link>
                    .
                  </span>
                </label>
              ) : null}

              {errorMsg && (
                <div
                  role="alert"
                  className="border border-[var(--studio-vermilion)] bg-[var(--studio-vermilion-soft)] px-3 py-2 text-xs text-[var(--studio-vermilion)]"
                >
                  {errorMsg}
                </div>
              )}

              {infoMsg && (
                <div
                  role="status"
                  className="border border-[var(--studio-mint)] bg-[var(--studio-mint-soft)] px-3 py-2 text-xs text-[var(--studio-mint)]"
                >
                  {infoMsg}
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full uppercase tracking-[0.06em]"
                disabled={loading || (authMode === "signup" && !consentChecked)}
              >
                {loading
                  ? "Connecting…"
                  : authMode === "signin"
                    ? "Sign In with Email"
                    : "Create Account"}
              </Button>
            </form>

            <div className="flex items-center justify-between pt-1 text-xs text-[var(--text-secondary)]">
              <button
                type="button"
                onClick={() => {
                  setAuthMode((prev) => (prev === "signin" ? "signup" : "signin"));
                  setErrorMsg(null);
                  setInfoMsg(null);
                }}
                className="font-semibold text-[var(--text-primary)] underline underline-offset-2 hover:text-[#EF6B63] dark:hover:text-[#F0B44C] cursor-pointer"
              >
                {authMode === "signin"
                  ? "Need an account? Sign up"
                  : "Already have an account? Sign in"}
              </button>
              <span className="inline-flex items-center gap-1 text-[11px]">
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--studio-mint)]" aria-hidden="true" />
                Zero-audio default
              </span>
            </div>
          </>
        )}

        <div className="border-t border-[var(--border-hairline)] pt-2.5 text-center text-[11px] text-[var(--text-secondary)]">
          100% free · Essential cookies only ·{" "}
          <Link href="/privacy" className="font-semibold text-[var(--text-primary)] hover:underline">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="font-semibold text-[var(--text-primary)] hover:underline">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/cookies" className="font-semibold text-[var(--text-primary)] hover:underline">
            Cookies
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

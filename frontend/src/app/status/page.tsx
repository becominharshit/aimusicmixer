"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Database,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { MixitLogo } from "@/components/brand/MixitLogo";
import { resolveApiUrl } from "@/lib/api";
import type { BackendHealth } from "@/types/report";

interface EndpointProbe {
  id: string;
  label: string;
  path: string;
  method: "GET" | "POST";
  status: "pending" | "ok" | "error";
  httpStatus: number | null;
  latencyMs: number | null;
  detail: string;
}

export default function SystemStatusPage() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [probes, setProbes] = useState<EndpointProbe[]>([
    {
      id: "health",
      label: "Primary Health Endpoint",
      path: "/health",
      method: "GET",
      status: "pending",
      httpStatus: null,
      latencyMs: null,
      detail: "Probing…",
    },
    {
      id: "api_health",
      label: "API Health Alias",
      path: "/api/health",
      method: "GET",
      status: "pending",
      httpStatus: null,
      latencyMs: null,
      detail: "Probing…",
    },
    {
      id: "mock_contract",
      label: "Deterministic Contract Probe",
      path: "/api/v1/analyze/mock",
      method: "GET",
      status: "pending",
      httpStatus: null,
      latencyMs: null,
      detail: "Probing…",
    },
  ]);
  const [running, setRunning] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  const runProbes = useCallback(async () => {
    setRunning(true);
    const targets: Array<{ id: string; label: string; path: string; method: "GET" | "POST" }> = [
      { id: "health", label: "Primary Health Endpoint", path: "/health", method: "GET" },
      { id: "api_health", label: "API Health Alias", path: "/api/health", method: "GET" },
      {
        id: "mock_contract",
        label: "Deterministic Contract Probe",
        path: "/api/v1/analyze/mock",
        method: "GET",
      },
    ];

    const results: EndpointProbe[] = await Promise.all(
      targets.map(async (target) => {
        const started = performance.now();
        try {
          const res = await fetch(resolveApiUrl(target.path), {
            method: target.method,
            cache: "no-store",
          });
          const latencyMs = Math.round(performance.now() - started);
          let detail = `HTTP ${res.status}`;
          if (res.ok) {
            const payload = await res.json();
            if (target.id === "health" && payload && typeof payload === "object") {
              setHealth(payload as BackendHealth);
              detail = `Status: ${payload.status || "ok"} · Contract ${payload.contract_version || "1.0.0"}`;
            } else if (target.id === "mock_contract" && payload && typeof payload === "object") {
              detail = `Schema ${payload.schema_version || "1.0.0"} · ${Array.isArray(payload.findings) ? payload.findings.length : 0} deterministic findings`;
            } else {
              detail = `Healthy (${payload.status || "ok"})`;
            }
          }
          return {
            ...target,
            status: res.ok ? "ok" : "error",
            httpStatus: res.status,
            latencyMs,
            detail,
          };
        } catch (err) {
          const latencyMs = Math.round(performance.now() - started);
          return {
            ...target,
            status: "error",
            httpStatus: null,
            latencyMs,
            detail: err instanceof Error ? err.message : "Network error",
          };
        }
      })
    );

    setProbes(results);
    setLastCheckedAt(new Date().toLocaleTimeString());
    setRunning(false);
  }, []);

  useEffect(() => {
    void runProbes();
  }, [runProbes]);

  const primaryLatency = probes.find((p) => p.id === "health")?.latencyMs;
  const allHealthy = probes.every((p) => p.status === "ok");

  return (
    <div className="min-h-screen bg-[#0A0C10] text-[#F4F1EA]">
      <header className="sticky top-0 z-30 border-b border-[#262B36] bg-[#0A0C10]/95">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 border border-[#262B36] bg-[#12151C] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.06em] text-[#F4F1EA] transition-colors hover:border-[#F0B44C] hover:text-[#F0B44C]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to Mixit
            </Link>
            <div className="hidden items-center gap-2.5 sm:flex">
              <MixitLogo variant="full" tone="dark" heightClass="h-6" />
              <span className="border-l border-[#262B36] pl-2.5 text-xs font-bold uppercase tracking-[0.08em] text-[#A1A8B8]">
                System Status &amp; Contract
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void runProbes()}
            disabled={running}
            className="inline-flex items-center gap-1.5 border border-[#F0B44C] bg-[#F0B44C] px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.06em] text-[#0A0A0A] transition-colors hover:bg-[#F4F1EA] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} aria-hidden="true" />
            {running ? "Probing…" : "Re-run Live Probes"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <section className="flex flex-wrap items-center justify-between gap-4 border border-[#262B36] bg-[#12151C] p-5">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center border ${
                allHealthy
                  ? "border-[#38D39F] bg-[#38D39F]/15 text-[#38D39F]"
                  : "border-[#F0B44C] bg-[#F0B44C]/15 text-[#F0B44C]"
              }`}
            >
              {allHealthy ? (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Activity className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#F0B44C]">
                Mixit System Status
              </p>
              <h1 className="font-condensed text-2xl font-extrabold tracking-tight text-[#F4F1EA]">
                {allHealthy
                  ? "All Deterministic DSP & API Systems Operational"
                  : "Inspecting Live Telemetry"}
              </h1>
              <p className="text-xs text-[#A1A8B8]">
                Real-time contract diagnostics, FFmpeg readiness, concurrency semaphore, and Gemini 4 Hydrogen routing.
              </p>
            </div>
          </div>
          {lastCheckedAt ? (
            <span className="tabular-telemetry border border-[#262B36] bg-[#0A0A0A] px-3 py-1 text-xs text-[#A1A8B8]">
              Last checked {lastCheckedAt}
            </span>
          ) : null}
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-[#262B36] bg-[#12151C] p-4">
            <div className="flex items-center justify-between text-xs text-[#A1A8B8]">
              <span className="uppercase tracking-wider">API Round-Trip</span>
              <Activity className="h-4 w-4 text-[#38D39F]" aria-hidden="true" />
            </div>
            <div className="mt-2 tabular-telemetry text-2xl font-bold text-[#F4F1EA]">
              {typeof primaryLatency === "number" ? `${primaryLatency} ms` : "—"}
            </div>
            <p className="mt-1 text-[11px] text-[#A1A8B8]">Measured live from browser</p>
          </div>

          <div className="border border-[#262B36] bg-[#12151C] p-4">
            <div className="flex items-center justify-between text-xs text-[#A1A8B8]">
              <span className="uppercase tracking-wider">Active AI Model</span>
              <Sparkles className="h-4 w-4 text-[#F0B44C]" aria-hidden="true" />
            </div>
            <div className="mt-2 truncate tabular-telemetry text-lg font-bold text-[#F4F1EA]">
              {health?.gemini_model || "gemini-4-hydrogen"}
            </div>
            <p className="mt-1 text-[11px] text-[#A1A8B8]">
              {health?.gemini_configured
                ? "API key configured · 35s timeout"
                : "Offline deterministic fallback ready"}
            </p>
          </div>

          <div className="border border-[#262B36] bg-[#12151C] p-4">
            <div className="flex items-center justify-between text-xs text-[#A1A8B8]">
              <span className="uppercase tracking-wider">FFmpeg / FFprobe</span>
              <Cpu className="h-4 w-4 text-[#38BDF8]" aria-hidden="true" />
            </div>
            <div className="mt-2 tabular-telemetry text-2xl font-bold text-[#F4F1EA]">
              {health ? (health.ffmpeg_available ? "Ready" : "Unavailable") : "—"}
            </div>
            <p className="mt-1 text-[11px] text-[#A1A8B8]">Magic-byte validated before decode</p>
          </div>

          <div className="border border-[#262B36] bg-[#12151C] p-4">
            <div className="flex items-center justify-between text-xs text-[#A1A8B8]">
              <span className="uppercase tracking-wider">DSP Concurrency</span>
              <Database className="h-4 w-4 text-[#38D39F]" aria-hidden="true" />
            </div>
            <div className="mt-2 tabular-telemetry text-2xl font-bold text-[#F4F1EA]">
              {health?.dsp_concurrency_limit ?? 2} slots
            </div>
            <p className="mt-1 text-[11px] text-[#A1A8B8]">
              SHA-256 cache: {health?.sha256_cache_entries ?? 0} entries · v
              {health?.contract_version || "1.0.0"}
            </p>
          </div>
        </section>

        <section className="overflow-hidden border border-[#262B36] bg-[#12151C]">
          <div className="flex items-center justify-between border-b border-[#262B36] px-5 py-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#38D39F]" aria-hidden="true" />
              <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-[#F4F1EA]">
                Live Endpoint Probes
              </h2>
            </div>
            <span className="tabular-telemetry text-[11px] text-[#A1A8B8]">
              Contract Schema {health?.contract_version || "1.0.0"}
            </span>
          </div>

          <div className="divide-y divide-[#262B36]">
            {probes.map((probe) => (
              <div
                key={probe.id}
                data-testid={`status-probe-${probe.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {probe.status === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#38D39F]" aria-hidden="true" />
                  ) : probe.status === "error" ? (
                    <XCircle className="h-4 w-4 shrink-0 text-[#EF6B63]" aria-hidden="true" />
                  ) : (
                    <RefreshCw
                      className="h-4 w-4 shrink-0 animate-spin text-[#A1A8B8]"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#F4F1EA]">{probe.label}</span>
                      <code className="border border-[#262B36] bg-[#0A0A0A] px-1.5 py-0.5 tabular-telemetry text-[11px] text-[#A1A8B8]">
                        {probe.method} {probe.path}
                      </code>
                    </div>
                    <p className="mt-0.5 text-xs text-[#A1A8B8]">{probe.detail}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 tabular-telemetry text-xs">
                  {typeof probe.latencyMs === "number" ? (
                    <span className="border border-[#262B36] bg-[#0A0A0A] px-2 py-0.5 font-semibold text-[#F4F1EA]">
                      {probe.latencyMs} ms
                    </span>
                  ) : null}
                  <span
                    className={`px-2 py-0.5 font-bold uppercase ${
                      probe.status === "ok"
                        ? "bg-[#38D39F]/15 text-[#38D39F]"
                        : probe.status === "error"
                          ? "bg-[#EF6B63]/15 text-[#EF6B63]"
                          : "bg-[#0A0A0A] text-[#A1A8B8]"
                    }`}
                  >
                    {probe.status === "ok" ? "PASS" : probe.status === "error" ? "FAIL" : "WAIT"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#262B36] pt-4 text-xs text-[#A1A8B8]">
          <span>Mixit Deterministic Audio DSP Studio</span>
          <div className="flex items-center gap-4 font-semibold uppercase tracking-[0.06em]">
            <Link href="/privacy" className="hover:text-[#F0B44C]">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[#F0B44C]">
              Terms
            </Link>
            <Link href="/cookies" className="hover:text-[#F0B44C]">
              Cookies
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}

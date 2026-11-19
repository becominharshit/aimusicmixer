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
      { id: "mock_contract", label: "Deterministic Contract Probe", path: "/api/v1/analyze/mock", method: "GET" },
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
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--studio-mint)] hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to MixBench
            </Link>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--studio-mint)]" />
              <span className="font-display text-sm font-bold tracking-tight">
                MixBench System Status &amp; Contract
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void runProbes()}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--studio-mint)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Probing…" : "Re-run Live Probes"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        {/* Overall Banner */}
        <section className="studio-card squircle-outer flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                allHealthy
                  ? "bg-[var(--studio-mint-soft)] text-[var(--studio-mint)]"
                  : "bg-[var(--studio-amber-soft)] text-[var(--studio-amber)]"
              }`}
            >
              {allHealthy ? <CheckCircle2 className="h-5 w-5" /> : <Activity className="h-5 w-5" />}
            </span>
            <div>
              <h1 className="font-display text-xl font-bold text-[var(--text-primary)]">
                {allHealthy ? "All Deterministic DSP & API Systems Operational" : "Inspecting Live Telemetry"}
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Real-time contract diagnostics, FFmpeg readiness, concurrency semaphore, and Gemini 4 Hydrogen routing.
              </p>
            </div>
          </div>
          {lastCheckedAt ? (
            <span className="tabular-telemetry rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-3 py-1 text-xs text-[var(--text-secondary)]">
              Last checked {lastCheckedAt}
            </span>
          ) : null}
        </section>

        {/* Key Runtime Telemetry Cards */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="studio-card squircle-outer p-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="uppercase tracking-wider">API Round-Trip</span>
              <Activity className="h-4 w-4 text-[var(--studio-mint)]" />
            </div>
            <div className="mt-2 tabular-telemetry text-2xl font-bold text-[var(--text-primary)]">
              {typeof primaryLatency === "number" ? `${primaryLatency} ms` : "—"}
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Measured live from browser</p>
          </div>

          <div className="studio-card squircle-outer p-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="uppercase tracking-wider">Active AI Model</span>
              <Sparkles className="h-4 w-4 text-[var(--studio-amber)]" />
            </div>
            <div className="mt-2 truncate tabular-telemetry text-lg font-bold text-[var(--text-primary)]">
              {health?.gemini_model || "gemini-4-hydrogen"}
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              {health?.gemini_configured
                ? "API key configured · 35s timeout"
                : "Offline deterministic fallback ready"}
            </p>
          </div>

          <div className="studio-card squircle-outer p-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="uppercase tracking-wider">FFmpeg / FFprobe</span>
              <Cpu className="h-4 w-4 text-[var(--studio-cobalt)]" />
            </div>
            <div className="mt-2 tabular-telemetry text-2xl font-bold text-[var(--text-primary)]">
              {health ? (health.ffmpeg_available ? "Ready" : "Unavailable") : "—"}
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Magic-byte validated before decode
            </p>
          </div>

          <div className="studio-card squircle-outer p-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="uppercase tracking-wider">DSP Concurrency</span>
              <Database className="h-4 w-4 text-[var(--studio-mint)]" />
            </div>
            <div className="mt-2 tabular-telemetry text-2xl font-bold text-[var(--text-primary)]">
              {health?.dsp_concurrency_limit ?? 2} slots
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              SHA-256 cache: {health?.sha256_cache_entries ?? 0} entries · v{health?.contract_version || "1.0.0"}
            </p>
          </div>
        </section>

        {/* Endpoint Probe Table */}
        <section className="studio-card squircle-outer overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--studio-mint)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Live Endpoint Probes
              </h2>
            </div>
            <span className="tabular-telemetry text-[11px] text-[var(--text-muted)]">
              Contract Schema {health?.contract_version || "1.0.0"}
            </span>
          </div>

          <div className="divide-y divide-[var(--border-hairline)]">
            {probes.map((probe) => (
              <div
                key={probe.id}
                data-testid={`status-probe-${probe.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {probe.status === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--studio-mint)]" />
                  ) : probe.status === "error" ? (
                    <XCircle className="h-4 w-4 shrink-0 text-[var(--studio-vermilion)]" />
                  ) : (
                    <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-[var(--text-muted)]" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        {probe.label}
                      </span>
                      <code className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5 tabular-telemetry text-[11px] text-[var(--text-secondary)]">
                        {probe.method} {probe.path}
                      </code>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{probe.detail}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 tabular-telemetry text-xs">
                  {typeof probe.latencyMs === "number" ? (
                    <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2 py-0.5 font-semibold text-[var(--text-primary)]">
                      {probe.latencyMs} ms
                    </span>
                  ) : null}
                  <span
                    className={`rounded-md px-2 py-0.5 font-semibold uppercase ${
                      probe.status === "ok"
                        ? "bg-[var(--studio-mint-soft)] text-[var(--studio-mint)]"
                        : probe.status === "error"
                          ? "bg-[var(--studio-vermilion-soft)] text-[var(--studio-vermilion)]"
                          : "bg-[var(--bg-inset)] text-[var(--text-muted)]"
                    }`}
                  >
                    {probe.status === "ok" ? "PASS" : probe.status === "error" ? "FAIL" : "WAIT"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

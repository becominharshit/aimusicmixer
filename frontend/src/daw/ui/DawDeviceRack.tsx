"use client";

import React from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Copy, Power, Sliders, X } from "lucide-react";
import { TACTILE_TAP } from "@/lib/motion";
import {
  TRIM_MAX_DB,
  TRIM_MIN_DB,
  getPluginDescriptor,
  normalizedToParam,
  paramToNormalized,
  type ChainId,
  type DawActions,
  type DawController,
  type ParamDescriptor,
  type PluginState,
} from "../index";
import { DawCanvasMeter } from "./DawCanvasMeter";

interface DawDeviceRackProps {
  chainId: ChainId;
  chainLabel: string;
  inserts: PluginState[];
  masterLimiter?: PluginState | null;
  controller: DawController;
  actions: DawActions;
}

function formatParamValue(desc: ParamDescriptor, value: number): string {
  if (desc.curve === "toggle") return value >= 0.5 ? "ON" : "OFF";
  if (desc.options && desc.options.length > 0) {
    const match = desc.options.find((opt) => Math.abs(opt.value - value) < 1e-4);
    if (match) return match.label;
  }
  const decimals = desc.decimals ?? (desc.unit === "Hz" ? 0 : desc.unit === "ms" ? 1 : 1);
  const numStr = value.toFixed(decimals);
  switch (desc.unit) {
    case "dB":
      return `${value > 0 ? "+" : ""}${numStr} dB`;
    case "Hz":
      return value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${Math.round(value)} Hz`;
    case "ms":
      return `${numStr} ms`;
    case "s":
      return `${numStr} s`;
    case "%":
      return `${Math.round(value)}%`;
    case "ratio":
      return `${numStr}:1`;
    case "Q":
      return `Q ${numStr}`;
    case "x":
      return `${numStr}x`;
    case "oct":
      return `${numStr} oct`;
    default:
      return numStr;
  }
}

interface DeviceModuleCardProps {
  chainId: ChainId;
  plugin: PluginState;
  index: number;
  total: number;
  lockedOrder?: boolean;
  controller: DawController;
  actions: DawActions;
}

function DeviceModuleCard({
  chainId,
  plugin,
  index,
  total,
  lockedOrder = false,
  controller,
  actions,
}: DeviceModuleCardProps) {
  const descriptor = getPluginDescriptor(plugin.pluginId);
  const activeParams = plugin.abSlot === "A" ? plugin.paramsA : plugin.paramsB;
  const isPowerOn = !plugin.bypass;

  return (
    <article
      data-testid={`daw-plugin-module-${plugin.pluginId}`}
      className={`flex w-[320px] shrink-0 flex-col border bg-[var(--bg-elevated)] transition-colors ${
        isPowerOn ? "border-[var(--border-strong)]" : "border-[var(--border-hairline)] opacity-70"
      }`}
    >
      {/* Shared Pro Device Header Toolbar */}
      <div className="flex items-center justify-between gap-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <motion.button
            type="button"
            whileTap={TACTILE_TAP}
            aria-label={isPowerOn ? `Bypass ${descriptor.name}` : `Enable ${descriptor.name}`}
            aria-pressed={isPowerOn}
            onClick={() => actions.setPluginBypass(chainId, plugin.instanceId, isPowerOn)}
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center border cursor-pointer transition-colors ${
              isPowerOn
                ? "border-[#0A0A0A] bg-[#FFE01B] text-[#0A0A0A]"
                : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-muted)]"
            }`}
          >
            <Power className="h-3.5 w-3.5" aria-hidden="true" />
          </motion.button>
          <div className="min-w-0">
            <div className="truncate text-xs font-extrabold uppercase tracking-[0.03em] text-[var(--text-primary)]">
              {descriptor.name}
            </div>
            <div className="truncate tabular-telemetry text-[9px] uppercase text-[var(--text-muted)]">
              {lockedOrder ? "SAFETY LIMITER" : descriptor.category}
            </div>
          </div>
        </div>

        {/* Pro Toolbar Controls: A/B, Copy A->B, Delta, Reorder, Remove */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`Toggle A/B slot (currently ${plugin.abSlot})`}
            title={`Active slot ${plugin.abSlot} — click to compare A/B`}
            onClick={() => actions.togglePluginAB(chainId, plugin.instanceId)}
            className="h-6 border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-1.5 tabular-telemetry text-[10px] font-bold text-[#FFE01B] hover:border-[#FFE01B] cursor-pointer"
          >
            {plugin.abSlot}
          </button>

          <button
            type="button"
            aria-label={`Copy slot A parameters to slot B on ${descriptor.name}`}
            title="Copy A → B"
            onClick={() => actions.copyPluginAToB(chainId, plugin.instanceId)}
            className="inline-flex h-6 items-center gap-0.5 border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-1.5 tabular-telemetry text-[9px] font-bold text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <Copy className="h-2.5 w-2.5" aria-hidden="true" />
            <span>A→B</span>
          </button>

          <button
            type="button"
            aria-label={`Toggle Delta listen on ${descriptor.name}`}
            aria-pressed={plugin.deltaListen}
            title="Delta listen (hear only what this plugin changes)"
            onClick={() =>
              actions.setPluginDeltaListen(chainId, plugin.instanceId, !plugin.deltaListen)
            }
            className={`h-6 border px-1.5 tabular-telemetry text-[10px] font-extrabold cursor-pointer transition-colors ${
              plugin.deltaListen
                ? "border-[#FF3B1F] bg-[#FF3B1F] text-[#0A0A0A]"
                : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            Δ
          </button>

          {!lockedOrder && (
            <>
              <button
                type="button"
                aria-label={`Move ${descriptor.name} left`}
                disabled={index <= 0}
                onClick={() => actions.movePlugin(chainId, plugin.instanceId, index - 1)}
                className="inline-flex h-6 w-5 items-center justify-center border border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 cursor-pointer"
              >
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Move ${descriptor.name} right`}
                disabled={index >= total - 1}
                onClick={() => actions.movePlugin(chainId, plugin.instanceId, index + 1)}
                className="inline-flex h-6 w-5 items-center justify-center border border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 cursor-pointer"
              >
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${descriptor.name}`}
                onClick={() => actions.removePlugin(chainId, plugin.instanceId)}
                className="inline-flex h-6 w-5 items-center justify-center border border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-secondary)] hover:border-[#FF3B1F] hover:bg-[#FF3B1F] hover:text-[#0A0A0A] cursor-pointer"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Preset Selector & Input/Output Trim Row */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 py-1.5">
        <select
          aria-label={`Preset for ${descriptor.name}`}
          value={plugin.presetId ?? ""}
          onChange={(e) => {
            if (e.target.value) {
              actions.loadPluginPreset(chainId, plugin.instanceId, e.target.value);
            }
          }}
          className="h-6 min-w-0 flex-1 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-1.5 text-[11px] font-medium text-[var(--text-primary)] focus:border-[#FFE01B] focus:outline-none"
        >
          <option value="">Preset: Custom</option>
          {descriptor.presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>

        <div className="flex shrink-0 items-center gap-1.5 tabular-telemetry text-[10px] text-[var(--text-secondary)]">
          <label className="inline-flex items-center gap-1" title="Input trim (-24 to +24 dB)">
            <span>IN</span>
            <input
              type="number"
              aria-label={`${descriptor.name} input trim dB`}
              min={TRIM_MIN_DB}
              max={TRIM_MAX_DB}
              step={0.5}
              value={Number(plugin.inputTrimDb.toFixed(1))}
              onChange={(e) => {
                const n = Number.parseFloat(e.target.value);
                if (Number.isFinite(n)) {
                  actions.setPluginInputTrim(chainId, plugin.instanceId, n);
                }
              }}
              className="h-6 w-12 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-1 text-right text-[10px] text-[var(--text-primary)]"
            />
          </label>
          <label className="inline-flex items-center gap-1" title="Output trim (-24 to +24 dB)">
            <span>OUT</span>
            <input
              type="number"
              aria-label={`${descriptor.name} output trim dB`}
              min={TRIM_MIN_DB}
              max={TRIM_MAX_DB}
              step={0.5}
              value={Number(plugin.outputTrimDb.toFixed(1))}
              onChange={(e) => {
                const n = Number.parseFloat(e.target.value);
                if (Number.isFinite(n)) {
                  actions.setPluginOutputTrim(chainId, plugin.instanceId, n);
                }
              }}
              className="h-6 w-12 border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-1 text-right text-[10px] text-[var(--text-primary)]"
            />
          </label>
        </div>
      </div>

      {/* Main Body: Auto-Rendered Parameter Controls + Live 60 fps VU / Downward GR Canvas Meter */}
      <div className="flex flex-1 gap-2.5 p-2.5">
        <div className="grid max-h-[172px] flex-1 grid-cols-2 gap-x-2.5 gap-y-2 overflow-y-auto pr-1">
          {descriptor.params.map((param) => {
            const rawVal = activeParams[param.id] ?? param.default;
            const norm = paramToNormalized(param, rawVal);

            if (param.curve === "toggle") {
              const checked = rawVal >= 0.5;
              return (
                <div key={param.id} className="flex flex-col justify-between gap-1">
                  <span className="truncate text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    {param.label}
                  </span>
                  <button
                    type="button"
                    aria-pressed={checked}
                    aria-label={`${descriptor.name} ${param.label}`}
                    onClick={() =>
                      actions.setPluginParam(chainId, plugin.instanceId, param.id, checked ? 0 : 1)
                    }
                    className={`h-6 border px-2 tabular-telemetry text-[10px] font-bold uppercase cursor-pointer ${
                      checked
                        ? "border-[#0A0A0A] bg-[#FFE01B] text-[#0A0A0A]"
                        : "border-[var(--border-hairline)] bg-[var(--bg-inset)] text-[var(--text-muted)]"
                    }`}
                  >
                    {checked ? "ON" : "OFF"}
                  </button>
                </div>
              );
            }

            if (param.options && param.options.length > 0) {
              return (
                <div key={param.id} className="flex flex-col justify-between gap-1">
                  <span className="truncate text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    {param.label}
                  </span>
                  <select
                    aria-label={`${descriptor.name} ${param.label}`}
                    value={String(rawVal)}
                    onChange={(e) =>
                      actions.setPluginParam(
                        chainId,
                        plugin.instanceId,
                        param.id,
                        Number(e.target.value)
                      )
                    }
                    className="h-6 w-full border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-1.5 tabular-telemetry text-[10px] font-semibold text-[var(--text-primary)]"
                  >
                    {param.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            return (
              <div key={param.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-1">
                  <label
                    htmlFor={`${plugin.instanceId}-${param.id}`}
                    className="truncate text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]"
                    title={`${param.label} (double-click slider to reset)`}
                  >
                    {param.label}
                  </label>
                  <span className="shrink-0 tabular-telemetry text-[10px] font-semibold text-[var(--text-primary)]">
                    {formatParamValue(param, rawVal)}
                  </span>
                </div>
                <input
                  id={`${plugin.instanceId}-${param.id}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.002}
                  value={norm}
                  onDoubleClick={() =>
                    actions.setPluginParam(chainId, plugin.instanceId, param.id, param.default)
                  }
                  onChange={(e) => {
                    const nextVal = normalizedToParam(param, Number.parseFloat(e.target.value));
                    actions.setPluginParam(chainId, plugin.instanceId, param.id, nextVal);
                  }}
                  className="h-2 w-full cursor-pointer accent-[#FFE01B]"
                />
              </div>
            );
          })}
        </div>

        {/* Live 60 fps VU + Downward GR Canvas Meter */}
        <div className="flex shrink-0 flex-col items-center justify-between gap-1">
          <DawCanvasMeter
            target={{ kind: "plugin", chainId, instanceId: plugin.instanceId }}
            controller={controller}
            orientation="vertical"
            showGainReduction={descriptor.hasGainReduction}
            width={descriptor.hasGainReduction ? 22 : 14}
            height={146}
            label={`${descriptor.name} live VU${descriptor.hasGainReduction ? " and gain reduction" : ""} meter`}
          />
          <span className="tabular-telemetry text-[8px] font-bold uppercase text-[var(--text-muted)]">
            {descriptor.hasGainReduction ? "VU/GR" : "VU"}
          </span>
        </div>
      </div>
    </article>
  );
}

export function DawDeviceRack({
  chainId,
  chainLabel,
  inserts,
  masterLimiter = null,
  controller,
  actions,
}: DawDeviceRackProps) {
  return (
    <section
      data-testid="daw-device-rack"
      aria-label={`FX Device Rack for ${chainLabel}`}
      className="border-t-[1.5px] border-[var(--border-hairline)] bg-[var(--bg-surface)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2">
        <div className="flex items-center gap-2">
          <Sliders className="h-3.5 w-3.5 text-[#FFE01B]" aria-hidden="true" />
          <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--text-primary)]">
            Device Rack
          </span>
          <span className="border border-[#0A0A0A] bg-[#FFE01B] px-2 py-0.5 tabular-telemetry text-[10px] font-extrabold uppercase text-[#0A0A0A]">
            {chainLabel}
          </span>
          <span className="tabular-telemetry text-[10px] text-[var(--text-muted)]">
            {inserts.length} {inserts.length === 1 ? "insert" : "inserts"}
            {masterLimiter ? " + Safety Limiter" : ""}
          </span>
        </div>
        <span className="hidden tabular-telemetry text-[10px] uppercase text-[var(--text-muted)] sm:inline">
          Signal Flow: Left → Right · Double-click sliders to reset
        </span>
      </div>

      <div className="flex min-h-[228px] items-stretch gap-3 overflow-x-auto p-3">
        {inserts.length === 0 && !masterLimiter ? (
          <div className="flex flex-1 flex-col items-center justify-center border border-dashed border-[var(--border-strong)] bg-[var(--bg-inset)] p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-primary)]">
              No FX Devices on {chainLabel}
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Click <strong className="text-[#FFE01B]">+ Add</strong> on any module in the left
              Plugin Browser to insert it here.
            </p>
          </div>
        ) : (
          <>
            {inserts.map((plugin, idx) => (
              <DeviceModuleCard
                key={plugin.instanceId}
                chainId={chainId}
                plugin={plugin}
                index={idx}
                total={inserts.length}
                controller={controller}
                actions={actions}
              />
            ))}
            {masterLimiter ? (
              <DeviceModuleCard
                key={masterLimiter.instanceId}
                chainId={chainId}
                plugin={masterLimiter}
                index={inserts.length}
                total={inserts.length + 1}
                lockedOrder
                controller={controller}
                actions={actions}
              />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

"use client";

import React from "react";
import { Keyboard, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export interface ShortcutRow {
  keys: string[];
  action: string;
  scope?: string;
}

const STUDIO_SHORTCUTS: ShortcutRow[] = [
  { keys: ["Space"], action: "Play / Pause transport", scope: "Studio & Web DAW" },
  { keys: ["M"], action: "Toggle Mono Fold (0.5L + 0.5R)", scope: "Studio Console" },
  { keys: ["L"], action: "Toggle Loop Window", scope: "Studio & Web DAW" },
  { keys: ["?"], action: "Open Keyboard Shortcuts", scope: "Global" },
  { keys: ["Esc"], action: "Close active modal or drawer", scope: "Global" },
];

interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context?: "studio" | "daw";
}

export function KeyboardShortcutsModal({
  open,
  onOpenChange,
  context = "studio",
}: KeyboardShortcutsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="keyboard-shortcuts-modal"
        className="max-w-md border-2 border-[var(--border-strong)] bg-[var(--bg-elevated)] p-0 text-[var(--text-primary)]"
      >
        <div className="flex items-center justify-between border-b-[1.5px] border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center bg-[#FFE01B] text-[#0A0A0A]">
              <Keyboard className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <DialogTitle className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--text-primary)]">
                Keyboard Shortcuts
              </DialogTitle>
              <p className="tabular-telemetry text-[10px] text-[var(--text-muted)]">
                {context === "daw" ? "MIXIT WEB DAW · TRANSPORT" : "MIXIT CONSOLE · TRANSPORT"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close keyboard shortcuts"
            className="inline-flex h-7 w-7 items-center justify-center border border-[var(--border-hairline)] text-[var(--text-secondary)] transition-colors hover:border-[#FFE01B] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="divide-y divide-[var(--border-hairline)] p-4">
          {STUDIO_SHORTCUTS.map((row) => (
            <div
              key={row.action}
              className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--text-primary)]">{row.action}</div>
                {row.scope ? (
                  <div className="tabular-telemetry text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                    {row.scope}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {row.keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex min-w-[28px] items-center justify-center border border-[var(--border-strong)] bg-[var(--bg-inset)] px-2 py-1 tabular-telemetry text-[11px] font-bold text-[#FFE01B]"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-hairline)] bg-[var(--bg-inset)] px-4 py-2.5 text-[10px] text-[var(--text-muted)]">
          <span>Disabled automatically while typing in inputs.</span>
          <span className="tabular-telemetry font-bold text-[var(--text-secondary)]">PRESS ESC</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

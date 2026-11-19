import type { Finding } from "@/types/report";

export interface DawRepairStep {
  id: string;
  label: string;
  phase: "listen" | "daw" | "verify";
}

export function buildDawRepairSteps(finding: Finding): DawRepairStep[] {
  return [
    {
      id: `${finding.evidence_id}:listen`,
      label: finding.listen_prompt,
      phase: "listen",
    },
    {
      id: `${finding.evidence_id}:daw`,
      label: finding.what_to_try,
      phase: "daw",
    },
    {
      id: `${finding.evidence_id}:verify`,
      label: finding.recheck_target,
      phase: "verify",
    },
  ];
}

export function repairStorageKey(reportId: string): string {
  return `mixbench_repair_checklist:${reportId}`;
}

export function loadRepairChecklist(
  reportId: string,
  seed?: Record<string, boolean>
): Record<string, boolean> {
  const base: Record<string, boolean> = { ...(seed ?? {}) };
  if (typeof window === "undefined" || !reportId) return base;
  try {
    const raw = window.localStorage.getItem(repairStorageKey(reportId));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "boolean") base[k] = v;
      }
    }
  } catch {
    // Ignore storage quota / parse errors
  }
  return base;
}

export function saveRepairChecklist(
  reportId: string,
  state: Record<string, boolean>
): void {
  if (typeof window === "undefined" || !reportId) return;
  try {
    window.localStorage.setItem(repairStorageKey(reportId), JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

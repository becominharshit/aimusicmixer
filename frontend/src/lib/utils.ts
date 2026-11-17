import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimecode(seconds: number, withTenths = false): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(clamped / 60);
  const rem = clamped - mins * 60;
  if (withTenths) {
    const secStr = rem.toFixed(1).padStart(4, "0");
    return `${String(mins).padStart(2, "0")}:${secStr}`;
  }
  const wholeSec = Math.floor(rem);
  return `${String(mins).padStart(2, "0")}:${String(wholeSec).padStart(2, "0")}`;
}

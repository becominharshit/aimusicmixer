/**
 * Client-side handoff buffer between Mixit Web DAW (/daw) and Studio Analyzer (/studio).
 * Holds a freshly rendered 24-bit WAV File in memory across Next.js App Router navigation.
 */
let pendingMixdownFile: File | null = null;

export function setPendingDawMixdown(file: File): void {
  pendingMixdownFile = file;
}

export function consumePendingDawMixdown(): File | null {
  const file = pendingMixdownFile;
  pendingMixdownFile = null;
  return file;
}

export function hasPendingDawMixdown(): boolean {
  return pendingMixdownFile !== null;
}

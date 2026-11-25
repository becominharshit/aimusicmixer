let sessionHasVisitedApp = false;

/**
 * True only after client hydration has already mounted a page in this SPA session.
 * Returning false on initial SSR/hydration guarantees zero React hydration mismatches
 * while skipping the hero headline entrance clip when returning from /privacy, /terms,
 * /cookies, or /status.
 */
export function hasVisitedAppSession(): boolean {
  return sessionHasVisitedApp;
}

export function markAppSessionVisited(): void {
  sessionHasVisitedApp = true;
}

export function resetAppSessionVisitedForTests(): void {
  sessionHasVisitedApp = false;
}

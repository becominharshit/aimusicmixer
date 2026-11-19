export type StudioTheme = "dark" | "light";

const THEME_STORAGE_KEY = "mixit_theme";
const LEGACY_THEME_STORAGE_KEY = "mixbench_theme";

export function getCurrentStudioTheme(): StudioTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyStudioTheme(theme: StudioTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const isDark = theme === "dark";
  root.classList.toggle("dark", isDark);
  root.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function toggleStudioTheme(): StudioTheme {
  const next: StudioTheme = getCurrentStudioTheme() === "dark" ? "light" : "dark";
  applyStudioTheme(next);
  return next;
}

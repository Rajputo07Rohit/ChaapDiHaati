export type AppTheme = "light" | "dark" | "mono";

const THEME_KEY = "app-theme";
const THEME_CLASSES: Record<AppTheme, string | null> = {
  light: null,
  dark: "theme-dark",
  mono: "theme-mono",
};

export function getStoredTheme(): AppTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "mono") return v;
  } catch {
    // localStorage unavailable — fall through to default.
  }
  return "light";
}

export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement;
  root.classList.remove("theme-dark", "theme-mono");
  const cls = THEME_CLASSES[theme];
  if (cls) root.classList.add(cls);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage unavailable — theme just won't persist across reloads.
  }
}

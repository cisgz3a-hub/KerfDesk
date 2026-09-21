// app-theme — the application's own light/dark choice (ADR-339).
//
// The 2026-09-19 ADR-049 amendment let the operating system decide the theme
// outright. The maintainer reversed that: KerfDesk opens LIGHT on every
// machine, and dark is a deliberate choice rather than an inherited one.
//
// This module owns that choice and is the SINGLE source both frames read:
// the chrome through the `data-theme` attribute stamped on <html> (tokens.css
// keys its dark block off it), and the Canvas2D/3D palette through
// canvas-color-scheme.ts, which delegates here. Two independent readers of
// `prefers-color-scheme` is exactly how the two frames drift apart.
//
// `resolvedTheme()` sits on the canvas draw path — every themed paint calls it
// — so the preference is cached in module state rather than re-read from
// storage per frame.

export type AppThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const APP_THEME_PREFERENCES: ReadonlyArray<AppThemePreference> = ['light', 'dark', 'system'];

// Machine-local viewing preference, so localStorage — never the .lf2 project
// (same rationale as the camera panel width and the calibration draft).
const STORAGE_KEY = 'kerfdesk.theme.v1';
const DARK_QUERY = '(prefers-color-scheme: dark)';

// Light unless the operator says otherwise. An unreadable preference, a denied
// localStorage, or a host without matchMedia all land on the shipped look
// rather than on whatever the desktop happens to be set to.
const DEFAULT_PREFERENCE: AppThemePreference = 'light';

let preference: AppThemePreference = DEFAULT_PREFERENCE;
let preferenceLoaded = false;
const listeners = new Set<() => void>();

let systemQuery: MediaQueryList | null = null;
let systemQuerySource: Window['matchMedia'] | undefined;

function isPreference(value: unknown): value is AppThemePreference {
  return APP_THEME_PREFERENCES.includes(value as AppThemePreference);
}

// Reuse the browser query on hot drawing paths, but never retain an earlier
// host's preference — replacing `window.matchMedia` (a test host does exactly
// that) must re-read through the new one.
function systemColorSchemeQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  if (systemQuerySource !== window.matchMedia) {
    systemQuerySource = window.matchMedia;
    systemQuery = window.matchMedia(DARK_QUERY);
  }
  return systemQuery;
}

function storedPreference(): AppThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isPreference(raw) ? raw : DEFAULT_PREFERENCE;
  } catch {
    // Private mode or a denied property getter: fall back to the shipped look.
    return DEFAULT_PREFERENCE;
  }
}

export function appThemePreference(): AppThemePreference {
  if (!preferenceLoaded) {
    preference = storedPreference();
    preferenceLoaded = true;
  }
  return preference;
}

export function resolvedTheme(): ResolvedTheme {
  const choice = appThemePreference();
  if (choice !== 'system') return choice;
  return systemColorSchemeQuery()?.matches === true ? 'dark' : 'light';
}

// The chrome reads the resolved theme off the root element, so a preference
// change repaints CSS and Canvas2D from the same instant.
function stampResolvedTheme(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolvedTheme();
}

export function setAppThemePreference(next: AppThemePreference): void {
  preference = next;
  preferenceLoaded = true;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage unavailable: the choice simply won't survive reload.
  }
  stampResolvedTheme();
  listeners.forEach((listener) => listener());
}

export function subscribeAppTheme(onChange: () => void): () => void {
  listeners.add(onChange);
  // 'system' has to track the desktop live; the listener is attached
  // unconditionally so switching TO 'system' needs no re-subscription.
  const media = systemColorSchemeQuery();
  const onSystemChange = (): void => {
    stampResolvedTheme();
    onChange();
  };
  media?.addEventListener('change', onSystemChange);
  return () => {
    listeners.delete(onChange);
    media?.removeEventListener('change', onSystemChange);
  };
}

// Called once from main.tsx before the first render so the chrome never paints
// a frame in the wrong theme.
export function initAppTheme(): void {
  stampResolvedTheme();
}

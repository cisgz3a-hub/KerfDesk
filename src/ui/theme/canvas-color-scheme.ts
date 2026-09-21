// Canvas2D needs explicit paints and redraws when the colour scheme changes.
//
// The theme itself is NOT decided here — app-theme.ts owns the application's
// light/dark choice and this module is a thin adapter onto it (ADR-339), so
// the canvas and the CSS chrome can never resolve the theme differently.
import { resolvedTheme, subscribeAppTheme } from './app-theme';

export type CanvasColorScheme = 'light' | 'dark';

export function getCanvasColorScheme(): CanvasColorScheme {
  return resolvedTheme();
}

export function subscribeCanvasColorScheme(onChange: () => void): () => void {
  return subscribeAppTheme(onChange);
}

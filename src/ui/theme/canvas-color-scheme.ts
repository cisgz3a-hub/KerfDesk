// Canvas2D needs explicit paints and redraws when the CSS colour scheme changes.
export type CanvasColorScheme = 'light' | 'dark';

let query: MediaQueryList | null = null;
let matchMediaSource: Window['matchMedia'] | undefined;

function colorSchemeQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  // Reuse the browser query on hot drawing paths; replacing the browser host
  // (including a test host) must not retain an earlier host's preference.
  if (matchMediaSource !== window.matchMedia) {
    matchMediaSource = window.matchMedia;
    query = window.matchMedia('(prefers-color-scheme: dark)');
  }
  return query;
}

export function getCanvasColorScheme(): CanvasColorScheme {
  return colorSchemeQuery()?.matches === true ? 'dark' : 'light';
}

export function subscribeCanvasColorScheme(onChange: () => void): () => void {
  const media = colorSchemeQuery();
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

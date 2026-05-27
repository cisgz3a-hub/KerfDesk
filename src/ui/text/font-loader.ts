// Font loader — fetches the bundled .ttf files via Vite's URL import
// pipeline and caches the resulting ArrayBuffers. The core/text layer
// owns the rendering algorithm (textToPolylines) and the font
// catalog (FONT_REGISTRY); this UI module owns the binary loading
// and caching so pure-core stays free of Vite-specific imports and
// fetch I/O.
//
// Caching: once a font is fetched, the ArrayBuffer is kept for the
// session. opentype.js parses ~5ms per typical TTF; the cache makes
// repeated text edits feel instant.

import type { KnownFontKey } from '../../core/text';
import robotoUrl from './fonts/Roboto-Regular.ttf?url';
import inconsolataUrl from './fonts/Inconsolata-Regular.ttf?url';
import pacificoUrl from './fonts/Pacifico-Regular.ttf?url';

const URL_BY_KEY: Readonly<Record<KnownFontKey, string>> = {
  'roboto-regular': robotoUrl,
  'inconsolata-regular': inconsolataUrl,
  'pacifico-regular': pacificoUrl,
};

const cache = new Map<KnownFontKey, ArrayBuffer>();

export async function loadFont(key: KnownFontKey): Promise<ArrayBuffer> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const url = URL_BY_KEY[key];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch font ${key}: ${res.status}`);
  const buf = await res.arrayBuffer();
  cache.set(key, buf);
  return buf;
}

// Best-effort: returns the buffer if already cached, else null. Lets
// synchronous code (canvas draw) get the font without awaiting; the
// caller falls back to a placeholder or no-op until the async load
// completes and a redraw is triggered.
export function getCachedFont(key: KnownFontKey): ArrayBuffer | null {
  return cache.get(key) ?? null;
}

import opentype, { type Font } from 'opentype.js';

const cache = new Map<string, Promise<Font>>();

/** Load an OpenType/TrueType font from a URL. Results are cached for the session. */
export function loadFont(url: string): Promise<Font> {
  const existing = cache.get(url);
  if (existing) return existing;

  const promise = fetch(url)
    .then(r => {
      if (!r.ok) throw new Error(`loadFont: HTTP ${r.status} for ${url}`);
      return r.arrayBuffer();
    })
    .then(buf => opentype.parse(buf));
  cache.set(url, promise);
  return promise;
}

/** For tests and offline scenarios: parse a font from an already-loaded ArrayBuffer. */
export function parseFontBuffer(buffer: ArrayBuffer): Font {
  return opentype.parse(buffer);
}

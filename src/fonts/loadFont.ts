import opentype, { type Font } from 'opentype.js';

const cache = new Map<string, Promise<Font>>();

/** Bundled registry uses `/fonts/...` paths; resolve from `public/` when running under Node (tests, CLI). */
async function tryLoadBundledFontFromPublicDir(url: string): Promise<Font | null> {
  if (typeof process === 'undefined' || !process.versions?.node) return null;
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  try {
    const [{ readFileSync }, { join }] = await Promise.all([
      import('node:fs'),
      import('node:path'),
    ]);
    const relative = url.replace(/^\//, '');
    const fullPath = join(process.cwd(), 'public', relative);
    const buffer = readFileSync(fullPath);
    return parseFontBuffer(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
  } catch {
    return null;
  }
}

/** Load an OpenType/TrueType font from a URL. Results are cached for the session. */
export function loadFont(url: string): Promise<Font> {
  const existing = cache.get(url);
  if (existing) return existing;

  const promise = (async (): Promise<Font> => {
    const fromDisk = await tryLoadBundledFontFromPublicDir(url);
    if (fromDisk != null) return fromDisk;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`loadFont: HTTP ${r.status} for ${url}`);
    const buf = await r.arrayBuffer();
    return opentype.parse(buf);
  })();
  cache.set(url, promise);
  return promise;
}

/** For tests and offline scenarios: parse a font from an already-loaded ArrayBuffer. */
export function parseFontBuffer(buffer: ArrayBuffer): Font {
  return opentype.parse(buffer);
}

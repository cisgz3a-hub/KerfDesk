import opentype, { type Font } from 'opentype.js';

const cache = new Map<string, Promise<Font>>();

/** Bundled registry uses `/fonts/...` paths; resolve from `public/` when running under Node (tests, CLI). */
async function tryLoadBundledFontFromPublicDir(url: string): Promise<Font | null> {
  if (typeof process === 'undefined' || !process.versions?.node) return null;
  const nodeProcess = process;
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<unknown>;
    const [{ readFileSync }, { join }] = await Promise.all([
      dynamicImport('node:fs') as Promise<{ readFileSync(path: string): Buffer }>,
      dynamicImport('node:path') as Promise<{ join(...segments: string[]): string }>,
    ]);
    const relative = url.replace(/^\//, '');
    const fullPath = join(nodeProcess.cwd(), 'public', relative);
    const buffer = readFileSync(fullPath);
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    return parseFontBuffer(bytes.buffer);
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

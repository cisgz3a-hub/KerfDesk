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

import { embeddedFontBuffer, findFontEntry, type FontEntry } from '../../core/text';
import type { EmbeddedFont } from '../../core/scene';
import robotoUrl from './fonts/Roboto-Regular.ttf?url';
import inconsolataUrl from './fonts/Inconsolata-Regular.ttf?url';
import pacificoUrl from './fonts/Pacifico-Regular.ttf?url';
import dancingScriptUrl from './fonts/DancingScript-Regular.ttf?url';
import sacramentoUrl from './fonts/Sacramento-Regular.ttf?url';
import greatVibesUrl from './fonts/GreatVibes-Regular.ttf?url';
import alexBrushUrl from './fonts/AlexBrush-Regular.ttf?url';
import caveatUrl from './fonts/Caveat.ttf?url';
import kaushanScriptUrl from './fonts/KaushanScript-Regular.ttf?url';
import parisienneUrl from './fonts/Parisienne-Regular.ttf?url';

const URL_BY_KEY: Readonly<Record<OutlineFontKey, string>> = {
  'roboto-regular': robotoUrl,
  'inconsolata-regular': inconsolataUrl,
  'pacifico-regular': pacificoUrl,
  'dancing-script-regular': dancingScriptUrl,
};

type OutlineFontKey = Extract<FontEntry, { readonly geometry: 'outline' }>['key'];

export const TRACED_SCRIPT_FONT_KEYS = [
  'forge-signature',
  'forge-romantic',
  'forge-copperplate',
  'forge-casual',
  'forge-friendly',
  'forge-signwriter',
  'forge-parisian',
  'forge-personal',
] as const;

export type TracedScriptFontKey = (typeof TRACED_SCRIPT_FONT_KEYS)[number];

const TRACE_SOURCE_URL_BY_KEY: Readonly<Record<TracedScriptFontKey, string>> = {
  'forge-signature': sacramentoUrl,
  'forge-romantic': greatVibesUrl,
  'forge-copperplate': alexBrushUrl,
  'forge-casual': caveatUrl,
  'forge-friendly': dancingScriptUrl,
  'forge-signwriter': kaushanScriptUrl,
  'forge-parisian': parisienneUrl,
  'forge-personal': pacificoUrl,
};

export function isTracedScriptFontKey(key: string): key is TracedScriptFontKey {
  return (TRACED_SCRIPT_FONT_KEYS as ReadonlyArray<string>).includes(key);
}

const cache = new Map<string, ArrayBuffer>();
const traceSourceCache = new Map<TracedScriptFontKey, ArrayBuffer>();

export async function loadFont(
  key: string,
  embeddedFonts?: ReadonlyArray<EmbeddedFont>,
): Promise<ArrayBuffer> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const known = findFontEntry(key);
  if (known === null) {
    const embedded = embeddedFonts?.find((font) => font.key === key);
    if (embedded === undefined)
      throw new Error(`Font "${key}" is not available. Relink it to edit.`);
    const buffer = embeddedFontBuffer(embedded);
    cache.set(key, buffer);
    return buffer;
  }
  if (known.geometry !== 'outline') {
    throw new Error(`Font "${key}" uses vector strokes and has no outline font file.`);
  }
  const url = URL_BY_KEY[known.key];
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
export function getCachedFont(key: string): ArrayBuffer | null {
  return cache.get(key) ?? null;
}

// CSS family name used by the font preview picker. Each bundled .ttf
// is registered as a FontFace under this family so the picker (and
// any other UI that wants to preview text) can use a regular CSS
// `font-family` rather than rasterizing the glyphs by hand.
export function cssFamilyForFont(key: OutlineFontKey): string {
  return `lf2-${key}`;
}

export function cssFamilyForTracedScript(key: TracedScriptFontKey): string {
  return `lf2-traced-${key}`;
}

// Tracks which font keys have already been added to document.fonts.
// FontFace.load() is idempotent but adding the same FontFace twice
// would still leak — keep one entry per key.
const cssRegistered = new Set<OutlineFontKey>();
const tracedCssRegistered = new Set<TracedScriptFontKey>();

// Register a bundled .ttf with the browser's font system so CSS
// `font-family: lf2-<key>` works. Pulls from the same in-memory
// cache as opentype-side loading so we never fetch a font twice.
// Resolves once the FontFace is fully loaded and ready for layout;
// rejects if the file can't be parsed as a font.
export async function ensureFontCss(key: OutlineFontKey): Promise<void> {
  if (cssRegistered.has(key)) return;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    // Non-browser / test env — nothing to register. Calls become
    // no-ops so the picker still functions (with system fallback).
    return;
  }
  const buf = await loadFont(key);
  // FontFace accepts the raw ArrayBuffer / BufferSource directly,
  // avoiding a second network fetch on top of `loadFont`.
  const face = new FontFace(cssFamilyForFont(key), buf);
  await face.load();
  document.fonts.add(face);
  cssRegistered.add(key);
}

/** Registers the real handwriting master used as input to centerline tracing. */
export async function ensureTracedScriptFontCss(key: TracedScriptFontKey): Promise<void> {
  if (tracedCssRegistered.has(key)) return;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  let buffer = traceSourceCache.get(key);
  if (buffer === undefined) {
    const response = await fetch(TRACE_SOURCE_URL_BY_KEY[key]);
    if (!response.ok)
      throw new Error(`Failed to fetch trace source font ${key}: ${response.status}`);
    buffer = await response.arrayBuffer();
    traceSourceCache.set(key, buffer);
  }
  const face = new FontFace(cssFamilyForTracedScript(key), buffer);
  await face.load();
  document.fonts.add(face);
  tracedCssRegistered.add(key);
}

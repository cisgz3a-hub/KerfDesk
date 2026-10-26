// Font loader — fetches the bundled .ttf files via Vite's URL import
// pipeline and caches the resulting ArrayBuffers. The core/text layer
// owns the rendering algorithm (textToPolylines) and the font
// catalog (FONT_REGISTRY); this UI module owns outline binary loading
// and caching so pure-core stays free of Vite-specific imports and fetch I/O.
// Native OFL stroke data is handled by the core single-line renderer.
//
// Caching: once a font is fetched, the ArrayBuffer is kept for the
// session. opentype.js parses ~5ms per typical TTF; the cache makes
// repeated text edits feel instant.

import { embeddedFontBuffer, findFontEntry, type FontEntry } from '../../core/text';
import type { EmbeddedFont } from '../../core/scene';
import robotoUrl from './fonts/Roboto-Regular.ttf?url';
import poppinsUrl from './fonts/Poppins-Regular.ttf?url';
import tinosUrl from './fonts/Tinos-Regular.ttf?url';
import tinosBoldUrl from './fonts/Tinos-Bold.ttf?url';
import inconsolataUrl from './fonts/Inconsolata-Regular.ttf?url';
import courierPrimeUrl from './fonts/CourierPrime-Regular.ttf?url';
import pacificoUrl from './fonts/Pacifico-Regular.ttf?url';
import dancingScriptUrl from './fonts/DancingScript-Regular.ttf?url';
import greatVibesUrl from './fonts/GreatVibes-Regular.ttf?url';
import alluraUrl from './fonts/Allura-Regular.ttf?url';
import alexBrushUrl from './fonts/AlexBrush-Regular.ttf?url';
import parisienneUrl from './fonts/Parisienne-Regular.ttf?url';
import pinyonScriptUrl from './fonts/PinyonScript-Regular.ttf?url';
import italiannoUrl from './fonts/Italianno-Regular.ttf?url';
import corinthiaUrl from './fonts/Corinthia-Regular.ttf?url';
import cinzelDecorativeUrl from './fonts/CinzelDecorative-Regular.ttf?url';
import antonUrl from './fonts/Anton-Regular.ttf?url';
import specialEliteUrl from './fonts/SpecialElite-Regular.ttf?url';
import unifrakturMaguntiaUrl from './fonts/UnifrakturMaguntia-Book.ttf?url';
import stardosStencilUrl from './fonts/StardosStencil-Regular.ttf?url';
import sairaStencilOneUrl from './fonts/SairaStencilOne-Regular.ttf?url';

const URL_BY_KEY: Readonly<Record<OutlineFontKey, string>> = {
  'roboto-regular': robotoUrl,
  'poppins-regular': poppinsUrl,
  'tinos-regular': tinosUrl,
  'tinos-bold': tinosBoldUrl,
  'inconsolata-regular': inconsolataUrl,
  'courier-prime-regular': courierPrimeUrl,
  'pacifico-regular': pacificoUrl,
  'dancing-script-regular': dancingScriptUrl,
  'great-vibes-regular': greatVibesUrl,
  'allura-regular': alluraUrl,
  'alex-brush-regular': alexBrushUrl,
  'parisienne-regular': parisienneUrl,
  'pinyon-script-regular': pinyonScriptUrl,
  'italianno-regular': italiannoUrl,
  'corinthia-regular': corinthiaUrl,
  'cinzel-decorative-regular': cinzelDecorativeUrl,
  'anton-regular': antonUrl,
  'special-elite-regular': specialEliteUrl,
  'unifraktur-maguntia-book': unifrakturMaguntiaUrl,
  'stardos-stencil-regular': stardosStencilUrl,
  'saira-stencil-one-regular': sairaStencilOneUrl,
};

type OutlineFontKey = Extract<FontEntry, { readonly geometry: 'outline' }>['key'];

type CachedFont = { readonly resource: string; readonly buffer: ArrayBuffer };
const cache = new Map<string, CachedFont>();

export async function loadFont(
  key: string,
  embeddedFonts?: ReadonlyArray<EmbeddedFont>,
): Promise<ArrayBuffer> {
  const known = findFontEntry(key);
  if (known === null) {
    // Imported keys belong to a project. Another project can reuse a key
    // with different bytes, or omit it, even while the old font is cached.
    const embedded = requireEmbeddedFont(key, embeddedFonts);
    const cached = cache.get(key);
    if (cached?.resource === embedded.dataBase64) return cached.buffer;
    const buffer = embeddedFontBuffer(embedded);
    cache.set(key, { resource: embedded.dataBase64, buffer });
    return buffer;
  }
  if (known.geometry !== 'outline') {
    throw new Error(`Font "${key}" uses native stroke geometry and has no outline file.`);
  }
  const cached = cache.get(key);
  if (cached !== undefined) return cached.buffer;
  const url = URL_BY_KEY[known.key];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch font ${key}: ${res.status}`);
  const buf = await res.arrayBuffer();
  cache.set(key, { resource: key, buffer: buf });
  return buf;
}

// Best-effort: returns the buffer if already cached, else null. Lets
// synchronous code (canvas draw) get the font without awaiting; the
// caller falls back to a placeholder or no-op until the async load
// completes and a redraw is triggered.
export function getCachedFont(
  key: string,
  embeddedFonts?: ReadonlyArray<EmbeddedFont>,
): ArrayBuffer | null {
  const cached = cache.get(key);
  if (cached === undefined) return null;
  const resource =
    findFontEntry(key) === null ? embeddedFonts?.find((font) => font.key === key)?.dataBase64 : key;
  return cached.resource === resource ? cached.buffer : null;
}

function requireEmbeddedFont(
  key: string,
  fonts: ReadonlyArray<EmbeddedFont> | undefined,
): EmbeddedFont {
  const embedded = fonts?.find((font) => font.key === key);
  if (embedded === undefined) throw new Error(`Font "${key}" is not available. Relink it to edit.`);
  return embedded;
}

// CSS family name used by the font preview picker. Each bundled .ttf
// is registered as a FontFace under this family so the picker (and
// any other UI that wants to preview text) can use a regular CSS
// `font-family` rather than rasterizing the glyphs by hand.
export function cssFamilyForFont(key: string): string {
  return `lf2-${key}`;
}

type CssRegistration = { readonly resource: string; ready: Promise<void> };
const cssRegistrations = new Map<string, CssRegistration>();
const cssFaces = new Map<string, FontFace>();

// Register a bundled .ttf with the browser's font system so CSS
// `font-family: lf2-<key>` works. Pulls from the same in-memory
// cache as opentype-side loading so we never fetch a font twice.
// Resolves once the FontFace is fully loaded and ready for layout;
// rejects if the file can't be parsed as a font.
export async function ensureFontCss(
  key: string,
  embeddedFonts?: ReadonlyArray<EmbeddedFont>,
): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    // Non-browser / test env — nothing to register. Calls become
    // no-ops so the picker still functions (with system fallback).
    return;
  }
  let resource: string;
  try {
    resource =
      findFontEntry(key) === null ? requireEmbeddedFont(key, embeddedFonts).dataBase64 : key;
  } catch (error) {
    removeFontCss(key);
    throw error;
  }
  const existing = cssRegistrations.get(key);
  if (existing?.resource === resource) return existing.ready;
  const registration: CssRegistration = { resource, ready: Promise.resolve() };
  // Claim the resource before any await so a late load from an older
  // document cannot replace the current document's CSS face.
  cssRegistrations.set(key, registration);
  registration.ready = registerFontCss(key, embeddedFonts, registration);
  return registration.ready;
}

async function registerFontCss(
  key: string,
  fonts: ReadonlyArray<EmbeddedFont> | undefined,
  registration: CssRegistration,
): Promise<void> {
  try {
    const buffer = await loadFont(key, fonts);
    const face = new FontFace(cssFamilyForFont(key), buffer);
    await face.load();
    if (cssRegistrations.get(key) !== registration) return;
    const previous = cssFaces.get(key);
    if (previous !== undefined) document.fonts.delete(previous);
    document.fonts.add(face);
    cssFaces.set(key, face);
  } catch (error) {
    if (cssRegistrations.get(key) === registration) removeFontCss(key);
    throw error;
  }
}

function removeFontCss(key: string): void {
  cssRegistrations.delete(key);
  const face = cssFaces.get(key);
  if (face !== undefined) document.fonts.delete(face);
  cssFaces.delete(key);
}

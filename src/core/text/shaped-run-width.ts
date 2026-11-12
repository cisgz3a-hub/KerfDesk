// A line's shaped width, shaping each distinct string once per layout (perf
// audit S7-P3-1). Shrink-to-fit lays a frame out up to 20 times and wrapping
// measures every growing prefix of every line, so the same strings were
// shaped through opentype.js's whole pipeline (stringToGlyphs, Bidi, the
// ligature features) thousands of times per keystroke: a 200-character
// paragraph took 1.4 s to preview.
//
// The glyph run and its kerning are kept in font units, and the width is
// summed as Font.forEachGlyph sums it (opentype.js 2.0.0), in the same order;
// outlineGlyphGeometry places glyphs by the same sum, so the measured and the
// drawn line are the very same double at every size. Kerning is OpenType's,
// not opentype.js's (outline-kerning.ts, O7-P2-1). A cache lives for one
// layout call: opentype.js completes some fonts lazily while it draws, which
// can change later measurements (ADR-643), and a layout measures before
// anything is drawn.

import type opentype from 'opentype.js';
import { latinPairKerning } from './outline-kerning';

type ShapedRun = {
  readonly glyphs: ReadonlyArray<opentype.Glyph>;
  readonly advances: Float64Array;
  readonly kerning: Float64Array;
};

type ShapingOptions = Parameters<opentype.Font['forEachGlyph']>[4];

// Glyphs kept before the cache starts again (16 bytes each, so about 8 MB): a
// 2,000-character frame shapes about 5,000 distinct line strings per layout,
// most of them prefixes of one wrapped line.
const MAX_GLYPHS = 500_000;

/** Shaped runs of one font, for one layout call. */
export type ShapingCache = { readonly byText: Map<string, ShapedRun>; glyphs: number };

export function createShapingCache(): ShapingCache {
  return { byText: new Map(), glyphs: 0 };
}

/** The pen advance of `text` at `sizeMm` and its glyph count, as forEachGlyph gives them. */
export function shapedRunAdvance(
  font: opentype.Font,
  text: string,
  sizeMm: number,
  options: ShapingOptions,
  cache: ShapingCache,
): { readonly advance: number; readonly glyphs: number } {
  const run = shapedRun(font, text, options, cache);
  return { advance: placeShapedRun(font, run, 0, sizeMm, options), glyphs: run.advances.length };
}

/**
 * Each glyph of `text` with its pen x, starting at `x`, as forEachGlyph places
 * them but with OpenType kerning; returns the pen x after the last glyph.
 */
export function placeShapedGlyphs(
  font: opentype.Font,
  text: string,
  x: number,
  sizeMm: number,
  options: ShapingOptions,
  onGlyph: (glyph: opentype.Glyph, x: number) => void,
): number {
  return placeShapedRun(
    font,
    shapedRun(font, text, options, createShapingCache()),
    x,
    sizeMm,
    options,
    onGlyph,
  );
}

function placeShapedRun(
  font: opentype.Font,
  run: ShapedRun,
  start: number,
  sizeMm: number,
  options: ShapingOptions,
  onGlyph?: (glyph: opentype.Glyph, x: number) => void,
): number {
  const resolved = { ...font.defaultRenderOptions, ...options };
  const fontScale = (1 / font.unitsPerEm) * sizeMm;
  let x = start;
  const last = run.advances.length - 1;
  for (let index = 0; index <= last; index += 1) {
    const glyph = run.glyphs[index];
    if (onGlyph !== undefined && glyph !== undefined) onGlyph(glyph, x);
    const advance = run.advances[index] ?? 0;
    if (advance) x += advance * fontScale;
    if (resolved.kerning && index < last) x += (run.kerning[index] ?? 0) * fontScale;
    if (resolved.letterSpacing) x += resolved.letterSpacing * sizeMm;
    else if (resolved.tracking) x += (resolved.tracking / 1e3) * sizeMm;
  }
  return x;
}

function shapedRun(
  font: opentype.Font,
  text: string,
  options: ShapingOptions,
  cache: ShapingCache,
): ShapedRun {
  const cached = cache.byText.get(text);
  if (cached !== undefined) return cached;
  // One pass of forEachGlyph selects the glyphs (ligatures included) as it
  // draws them; its own kerning is not used.
  const glyphs: opentype.Glyph[] = [];
  font.forEachGlyph(text, 0, 0, font.unitsPerEm, { ...options, kerning: false }, (glyph) => {
    glyphs.push(glyph);
  });
  const resolved = { ...font.defaultRenderOptions, ...options };
  const pairKerning = resolved.kerning && glyphs.length > 1 ? latinPairKerning(font) : undefined;
  const advances = new Float64Array(glyphs.length);
  const kerning = new Float64Array(glyphs.length);
  glyphs.forEach((glyph, index) => {
    advances[index] = glyph.advanceWidth ?? 0;
    const next = glyphs[index + 1];
    if (pairKerning === undefined || next === undefined) return;
    kerning[index] = pairKerning(glyph.index, next.index);
  });
  const run = { glyphs, advances, kerning };
  if (cache.glyphs + glyphs.length > MAX_GLYPHS) {
    cache.byText.clear();
    cache.glyphs = 0;
  }
  cache.byText.set(text, run);
  cache.glyphs += glyphs.length;
  return run;
}

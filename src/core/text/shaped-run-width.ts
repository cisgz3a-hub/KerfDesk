// A line's shaped width, shaping each distinct string once per layout (perf
// audit S7-P3-1). Shrink-to-fit lays a frame out up to 20 times and wrapping
// measures every growing prefix of every line, so the same strings were
// shaped through opentype.js's whole pipeline (stringToGlyphs, Bidi, the
// ligature features) thousands of times per keystroke: a 200-character
// paragraph took 1.4 s to preview.
//
// The glyph run and its kerning are kept in font units, and the width is
// summed exactly as Font.forEachGlyph sums it (opentype.js 2.0.0), in the same
// order, so it is the very same double at every size. A cache lives for one
// layout call: opentype.js completes some fonts lazily while it draws, which
// can change later measurements (ADR-643), and a layout measures before
// anything is drawn.

import type opentype from 'opentype.js';

type ShapedRun = {
  readonly advances: Float64Array;
  readonly kerning: Float64Array;
};

type ShapingOptions = Parameters<opentype.Font['forEachGlyph']>[4];

// The GPOS kerning that forEachGlyph reads, which opentype.js's types leave out.
type KerningPosition = {
  getDefaultScriptName(): string;
  getKerningTables(script: string, language?: string): unknown;
  getKerningValue(lookups: unknown, left: number, right: number): number;
};

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
  const resolved = { ...font.defaultRenderOptions, ...options };
  const fontScale = (1 / font.unitsPerEm) * sizeMm;
  let x = 0;
  const last = run.advances.length - 1;
  for (let index = 0; index <= last; index += 1) {
    const advance = run.advances[index] ?? 0;
    if (advance) x += advance * fontScale;
    if (resolved.kerning && index < last) x += (run.kerning[index] ?? 0) * fontScale;
    if (resolved.letterSpacing) x += resolved.letterSpacing * sizeMm;
    else if (resolved.tracking) x += (resolved.tracking / 1e3) * sizeMm;
  }
  return { advance: x, glyphs: run.advances.length };
}

function shapedRun(
  font: opentype.Font,
  text: string,
  options: ShapingOptions,
  cache: ShapingCache,
): ShapedRun {
  const cached = cache.byText.get(text);
  if (cached !== undefined) return cached;
  // One pass of forEachGlyph at the font's own units records each glyph's
  // advance and the kerning to the next, as it applies them.
  const glyphs: opentype.Glyph[] = [];
  font.forEachGlyph(text, 0, 0, font.unitsPerEm, options, (glyph) => {
    glyphs.push(glyph);
  });
  const resolved = { ...font.defaultRenderOptions, ...options };
  const position = (font as unknown as { readonly position: KerningPosition }).position;
  const lookups = resolved.kerning
    ? position.getKerningTables(
        resolved.script || position.getDefaultScriptName(),
        resolved.language,
      )
    : undefined;
  const advances = new Float64Array(glyphs.length);
  const kerning = new Float64Array(glyphs.length);
  glyphs.forEach((glyph, index) => {
    advances[index] = glyph.advanceWidth ?? 0;
    const next = glyphs[index + 1];
    if (!resolved.kerning || next === undefined) return;
    kerning[index] = lookups
      ? position.getKerningValue(lookups, glyph.index, next.index)
      : font.getKerningValue(glyph, next);
  });
  const run = { advances, kerning };
  if (cache.glyphs + glyphs.length > MAX_GLYPHS) {
    cache.byText.clear();
    cache.glyphs = 0;
  }
  cache.byText.set(text, run);
  cache.glyphs += glyphs.length;
  return run;
}

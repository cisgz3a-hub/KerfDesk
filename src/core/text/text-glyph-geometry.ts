import type * as opentype from 'opentype.js';
import { textOutlineGeometry, type TextOutlineGeometry } from './text-outline-path';

export type GlyphOutlineGeometry = TextOutlineGeometry & {
  /** One glyph or shaping-cluster identity for every contour, in geometry order. */
  readonly glyphContours: ReadonlyArray<number>;
};

/** Preserve the font layout's glyph ownership even when neighbouring ink overlaps. */
export function outlineGlyphGeometry(
  font: opentype.Font,
  text: string,
  sizeMm: number,
  x: number,
  y: number,
  options: opentype.RenderOptions,
): GlyphOutlineGeometry {
  const polylines: TextOutlineGeometry['polylines'][number][] = [];
  const curves: TextOutlineGeometry['curves'][number][] = [];
  const glyphContours: number[] = [];
  let glyphId = 0;
  font.forEachGlyph(text, x, y, sizeMm, options, (glyph, gx, gy) => {
    const geometry = textOutlineGeometry(glyph.getPath(gx, gy, sizeMm, options, font).commands);
    polylines.push(...geometry.polylines);
    curves.push(...geometry.curves);
    glyphContours.push(...geometry.polylines.map(() => glyphId));
    glyphId += 1;
  });
  return { polylines, curves, glyphContours };
}

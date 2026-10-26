import type * as opentype from 'opentype.js';
import { textOutlineGeometry, type TextOutlineGeometry } from './text-outline-path';
import type { GlyphOutlineGeometry } from './text-glyph-geometry';
import type { TextShaping } from './text-shaping-types';

export function shapedLineWidth(
  shaping: TextShaping,
  start: number,
  length: number,
  size: number,
  unitsPerEm: number,
  tracking: number,
): number {
  const line = shaping.line(start, start + length);
  return (line.advance * size) / unitsPerEm + line.trackingGaps * tracking * size;
}

/** Reuse the existing outline conversion: only glyph selection and positions
 * change. Font outlines retain native curves and millimetre coordinates. */
export function shapedTextGeometry(
  font: opentype.Font,
  shaping: TextShaping,
  start: number,
  length: number,
  size: number,
  x: number,
  y: number,
  tracking: number,
): GlyphOutlineGeometry {
  const line = shaping.line(start, start + length);
  const polylines: TextOutlineGeometry['polylines'][number][] = [];
  const curves: TextOutlineGeometry['curves'][number][] = [];
  const glyphContours: number[] = [];
  for (const glyph of line.glyphs) {
    const path = font.glyphs
      .get(glyph.id)
      .getPath(
        x + (glyph.x * size) / font.unitsPerEm + glyph.trackingIndex * tracking * size,
        y + (glyph.y * size) / font.unitsPerEm,
        size,
      );
    const geometry = textOutlineGeometry(path.commands);
    polylines.push(...geometry.polylines);
    curves.push(...geometry.curves);
    glyphContours.push(...geometry.polylines.map(() => glyph.cluster));
  }
  return { polylines, curves, glyphContours };
}

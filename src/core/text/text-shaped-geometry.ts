import type * as opentype from 'opentype.js';
import { textOutlineGeometry, type TextOutlineGeometry } from './text-outline-path';
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
): TextOutlineGeometry {
  const line = shaping.line(start, start + length);
  const commands: opentype.PathCommand[] = [];
  for (const glyph of line.glyphs) {
    const path = font.glyphs
      .get(glyph.id)
      .getPath(
        x + (glyph.x * size) / font.unitsPerEm + glyph.trackingIndex * tracking * size,
        y + (glyph.y * size) / font.unitsPerEm,
        size,
      );
    commands.push(...path.commands);
  }
  return textOutlineGeometry(commands);
}

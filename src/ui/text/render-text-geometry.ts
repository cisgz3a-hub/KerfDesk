import { findFontEntry, textToPolylines, type TextRenderResult } from '../../core/text';
import { outlineTextToPolylines, type parseOutlineFont } from '../../core/text/text-to-polylines';
import type { EmbeddedFont, TextAlignment } from '../../core/scene';
import type { TextBoxSettings } from '../../core/scene/text-box';
import { loadFont } from './font-loader';
import { prepareTextShaping } from '../../io/text/prepare-text-shaping';

export type RenderTextGeometryInput = {
  readonly fontKey: string;
  readonly embeddedFonts: ReadonlyArray<EmbeddedFont> | undefined;
  readonly content: string;
  readonly sizeMm: number;
  readonly alignment: TextAlignment;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly color: string;
  readonly textBox?: TextBoxSettings;
};

/**
 * Routes editable text to the outline-font or native CNC stroke renderer.
 * `parseFont` lets a batch of renders share one parse of a font file
 * (held-font-parser.ts); without it every render parses the file, as
 * textToPolylines does.
 */
export async function renderTextGeometry(
  input: RenderTextGeometryInput,
  parseFont?: typeof parseOutlineFont,
): Promise<TextRenderResult> {
  const shared = {
    content: input.content,
    sizeMm: input.sizeMm,
    alignment: input.alignment,
    lineHeight: input.lineHeight,
    letterSpacing: input.letterSpacing,
    color: input.color,
    ...(input.textBox === undefined ? {} : { textBox: input.textBox }),
  };
  if (findFontEntry(input.fontKey)?.geometry === 'single-line') {
    return textToPolylines({
      ...shared,
      geometry: 'single-line',
      fontKey: input.fontKey,
    });
  }
  const fontBuffer = await loadFont(input.fontKey, input.embeddedFonts);
  const shaping = await prepareTextShaping(fontBuffer, input.content);
  const outline = { ...shared, fontBuffer, ...(shaping === undefined ? {} : { shaping }) };
  return parseFont === undefined
    ? textToPolylines(outline)
    : outlineTextToPolylines(outline, await parseFont(fontBuffer));
}

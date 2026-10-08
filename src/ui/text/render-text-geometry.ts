import { findFontEntry, textToPolylines, type TextRenderResult } from '../../core/text';
import type { EmbeddedFont, TextAlignment } from '../../core/scene';
import type { TextBoxSettings } from '../../core/scene/text-box';
import { loadFont } from './font-loader';

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

/** Routes editable text to the outline-font or native CNC stroke renderer. */
export async function renderTextGeometry(
  input: RenderTextGeometryInput,
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
  return textToPolylines({
    ...shared,
    fontBuffer: await loadFont(input.fontKey, input.embeddedFonts),
  });
}

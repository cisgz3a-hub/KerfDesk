import { textToPolylines, type TextRenderResult } from '../../core/text';
import type { EmbeddedFont, TextAlignment } from '../../core/scene';
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
};

/** Renders editable text with a bundled or project outline font. */
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
  };
  return textToPolylines({
    ...shared,
    fontBuffer: await loadFont(input.fontKey, input.embeddedFonts),
  });
}

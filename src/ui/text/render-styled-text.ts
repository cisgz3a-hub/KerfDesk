import type { EmbeddedFont, TextObject } from '../../core/scene';
import type { TextRenderResult } from '../../core/text';
import { styledBentRender, styledTextContent, styleTextRender } from '../../core/text/text-style';
import { renderTextGeometry } from './render-text-geometry';
import { applyTextWeldInWorker } from './text-weld-worker-client';

export type StyledTextSource = Pick<
  TextObject,
  | 'fontKey'
  | 'sizeMm'
  | 'alignment'
  | 'lineHeight'
  | 'letterSpacing'
  | 'color'
  | 'bendDeg'
  | 'textStyle'
  | 'textBox'
  | 'weldOverlaps'
>;

/**
 * ADR-321 Amendment 1. New wording for an existing text, laid out with everything the text says it
 * has: its style (Bold, Upper case, Max width…), its text box and Weld overlaps, as the text editor
 * and variable output lay it out. Path text is the editor's. The missing characters are the
 * render's, before a bend or weld.
 */
export async function renderStyledText(
  text: StyledTextSource,
  content: string,
  embeddedFonts: ReadonlyArray<EmbeddedFont> | undefined,
  signal?: AbortSignal,
): Promise<TextRenderResult> {
  const rendered = await renderTextGeometry({
    fontKey: text.fontKey,
    embeddedFonts,
    content: styledTextContent(content, text.textStyle),
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    color: text.color,
    ...(text.textBox === undefined ? {} : { textBox: text.textBox }),
  });
  signal?.throwIfAborted();
  // A text box is never bent: its frame is the layout.
  const styled =
    text.textBox === undefined
      ? styledBentRender(rendered, text)
      : styleTextRender(rendered, text.textStyle, text.sizeMm);
  const final = await applyTextWeldInWorker(styled, text.fontKey, text.weldOverlaps, signal);
  signal?.throwIfAborted();
  const missing = rendered.missingCharacters;
  return missing === undefined ? final : { ...final, missingCharacters: missing };
}

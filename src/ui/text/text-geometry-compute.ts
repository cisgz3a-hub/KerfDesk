// renderTextGeometry as the text worker runs it (ADR-631): the same routing and
// the same core calls, with the font file already in hand and the parse
// supplied by the caller, so the worker can reuse a parsed font where that is
// safe. The UI thread keeps renderTextGeometry itself for output; the worker
// parity tests pin the two together.

import type * as opentype from 'opentype.js';
import { findFontEntry } from '../../core/text/font-registry';
import {
  outlineTextToPolylines,
  textToPolylines,
  type TextRenderResult,
} from '../../core/text/text-to-polylines';
import { prepareTextShaping } from '../../io/text/prepare-text-shaping';
import type { RenderTextGeometryInput } from './render-text-geometry';

/** Everything renderTextGeometry lays out, apart from where the font file comes from. */
export type TextGeometryRequest = Omit<RenderTextGeometryInput, 'embeddedFonts'>;

export type OutlineFontParser = (fontBuffer: ArrayBuffer) => Promise<opentype.Font>;

/** False for bundled CNC stroke fonts, which need no font file. */
export function usesOutlineFontFile(fontKey: string): boolean {
  return findFontEntry(fontKey)?.geometry !== 'single-line';
}

/**
 * Only the fields the layout reads. Callers pass whole dialog values, which
 * can carry embedded fonts and guide paths that must not be posted.
 */
export function textGeometryRequest(input: TextGeometryRequest): TextGeometryRequest {
  return {
    fontKey: input.fontKey,
    content: input.content,
    sizeMm: input.sizeMm,
    alignment: input.alignment,
    lineHeight: input.lineHeight,
    letterSpacing: input.letterSpacing,
    color: input.color,
    ...(input.textBox === undefined ? {} : { textBox: input.textBox }),
  };
}

/**
 * Lays the text out as renderTextGeometry does. `fontBuffer` is the outline
 * font file, or undefined for a CNC stroke font; `parse` turns the file into
 * an opentype.js Font, after shaping, where textToPolylines parses it.
 */
export async function computeTextGeometry(
  input: TextGeometryRequest,
  fontBuffer: ArrayBuffer | undefined,
  parse: OutlineFontParser,
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
  if (fontBuffer === undefined) {
    return textToPolylines({
      ...shared,
      geometry: 'single-line',
      fontKey: input.fontKey,
    });
  }
  const shaping = await prepareTextShaping(fontBuffer, input.content);
  return outlineTextToPolylines(
    {
      ...shared,
      fontBuffer,
      ...(shaping === undefined ? {} : { shaping }),
    },
    await parse(fontBuffer),
  );
}

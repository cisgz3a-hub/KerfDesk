import { findFontEntry, weldTextRender, type TextRenderResult } from '../../core/text';

/** Share the same final outline between the editor and evaluated variable output. */
export function applyTextWeld(
  rendered: TextRenderResult,
  fontKey: string,
  enabled: boolean | undefined,
): TextRenderResult {
  if (!enabled || findFontEntry(fontKey)?.geometry === 'single-line') return rendered;
  const result = weldTextRender(rendered);
  if (result.kind === 'error') {
    throw new Error(
      `Could not weld this text. ${result.error.message} Adjust the text or turn off Weld overlaps.`,
    );
  }
  return result.value;
}

import { findFontEntry, textToPolylines } from '../../core/text';
import type { VariableTextRenderer } from '../../io/gcode';
import { loadFont } from './font-loader';

export const renderVariableText: VariableTextRenderer = async ({ text, content }) => {
  const font = findFontEntry(text.fontKey);
  if (font === null) throw new Error(`Font "${text.fontKey}" must be relinked before output.`);
  return textToPolylines({
    fontBuffer: await loadFont(font.key),
    content,
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    color: text.color,
  });
};

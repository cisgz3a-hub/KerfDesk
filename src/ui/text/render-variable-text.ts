import { bendTextRender, textToPolylines } from '../../core/text';
import type { VariableTextRenderer } from '../../io/gcode';
import { loadFont } from './font-loader';

export const renderVariableText: VariableTextRenderer = async ({ text, content, project }) => {
  const rendered = await textToPolylines({
    fontBuffer: await loadFont(text.fontKey, project.embeddedFonts),
    content,
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    color: text.color,
  });
  return bendTextRender(rendered, text.bendDeg ?? 0);
};

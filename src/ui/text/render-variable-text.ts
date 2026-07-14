import { bendTextRender, placeTextOnPath } from '../../core/text';
import type { VariableTextRenderer } from '../../io/gcode';
import { renderTextGeometry } from './render-text-geometry';

export const renderVariableText: VariableTextRenderer = async ({ text, content, project }) => {
  const rendered = await renderTextGeometry({
    fontKey: text.fontKey,
    embeddedFonts: project.embeddedFonts,
    content,
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    color: text.color,
  });
  if (text.pathText !== undefined) {
    const guide = project.scene.objects.find(
      (object) => object.id === text.pathText?.guideObjectId,
    );
    if (guide === undefined)
      throw new Error('The linked text guide is missing. Relink it to output.');
    const placed = placeTextOnPath(rendered, guide, text.pathText);
    if (placed.kind !== 'ok') throw new Error(placed.message);
    return {
      ...placed.rendered,
      transform: { ...text.transform, x: placed.origin.x, y: placed.origin.y },
    };
  }
  return bendTextRender(rendered, text.bendDeg ?? 0);
};

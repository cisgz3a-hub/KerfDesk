import {
  placeTextOnPath,
  styledBentRender,
  styledTextContent,
  styleTextRender,
} from '../../core/text';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import type { VariableTextRenderer } from '../../io/gcode';
import { renderTextGeometry } from './render-text-geometry';
import { applyTextWeld } from './apply-text-weld';

export const renderVariableText: VariableTextRenderer = async ({ text, content, project }) => {
  const rendered = await renderTextGeometry({
    fontKey: text.fontKey,
    embeddedFonts: project.embeddedFonts,
    content: styledTextContent(content, text.textStyle),
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    color: text.color,
    ...(text.textBox === undefined ? {} : { textBox: text.textBox }),
  });
  if (text.pathText !== undefined) {
    const guide = project.scene.objects.find(
      (object) => object.id === text.pathText?.guideObjectId,
    );
    if (guide === undefined)
      throw new Error('The linked text guide is missing. Relink it to output.');
    const styled = styleTextRender(rendered, text.textStyle, text.sizeMm);
    const placed = placeTextOnPath(styled, guide, text.pathText);
    if (placed.kind !== 'ok') throw new Error(placed.message);
    return {
      ...applyTextWeld(placed.rendered, text.fontKey, text.weldOverlaps),
      // The guide's transform is already baked into placed world-space paths.
      transform: { ...IDENTITY_TRANSFORM, x: placed.origin.x, y: placed.origin.y },
    };
  }
  if (text.textBox !== undefined)
    return {
      ...applyTextWeld(
        styleTextRender(rendered, text.textStyle, text.sizeMm),
        text.fontKey,
        text.weldOverlaps,
      ),
      transform: text.transform,
    };
  return applyTextWeld(styledBentRender(rendered, text), text.fontKey, text.weldOverlaps);
};

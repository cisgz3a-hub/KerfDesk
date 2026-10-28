import { placeTextOnPath, type TextRenderResult } from '../../core/text';
import { styledBentRender, styledTextContent, styleTextRender } from '../../core/text/text-style';
import { pathTextAcrossFromBaseline } from '../../core/text/text-on-path';
import {
  onTextBoxBaseline,
  textBoxBaseline,
  type TextBoxBaseline,
} from '../../core/text/text-box-render';
import { IDENTITY_TRANSFORM, type Project, type TextObject } from '../../core/scene';
import type { VariableTextRenderer } from '../../io/gcode';
import { renderTextGeometry } from './render-text-geometry';
import { applyTextWeld } from './apply-text-weld';

// Records in a frame or on a path keep the template's first baseline
// (ADR-682). A batch reads that from one render of the template per text.
type TemplateBaseline = {
  readonly box: TextBoxBaseline | undefined;
  readonly acrossFromBaseline: number | undefined;
};
const MAX_CACHED_TEMPLATES = 64;
const templateBaselines = new Map<string, Promise<TemplateBaseline>>();

export const renderVariableText: VariableTextRenderer = async ({ text, content, project }) => {
  const rendered = await styledRecordRender(text, content, project);
  const placedTemplate =
    content === text.content || (text.pathText === undefined && text.textBox === undefined)
      ? undefined
      : await templateBaseline(text, project).catch(() => undefined);
  if (text.pathText !== undefined) {
    const guide = project.scene.objects.find(
      (object) => object.id === text.pathText?.guideObjectId,
    );
    if (guide === undefined)
      throw new Error('The linked text guide is missing. Relink it to output.');
    const placed = placeTextOnPath(
      rendered,
      guide,
      text.pathText,
      placedTemplate?.acrossFromBaseline,
    );
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
        onTextBoxBaseline(rendered, placedTemplate?.box),
        text.fontKey,
        text.weldOverlaps,
      ),
      transform: text.transform,
    };
  return applyTextWeld(styledBentRender(rendered, text), text.fontKey, text.weldOverlaps);
};

// Styled but not yet bent or laid on a path.
async function styledRecordRender(
  text: TextObject,
  content: string,
  project: Project,
): Promise<TextRenderResult> {
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
  return text.pathText !== undefined || text.textBox !== undefined
    ? styleTextRender(rendered, text.textStyle, text.sizeMm)
    : rendered;
}

function templateBaseline(text: TextObject, project: Project): Promise<TemplateBaseline> {
  const key = JSON.stringify([
    text.content,
    text.fontKey,
    text.sizeMm,
    text.alignment,
    text.lineHeight,
    text.letterSpacing,
    text.textStyle ?? null,
    text.textBox ?? null,
    text.pathText?.acrossAlign ?? null,
  ]);
  const cached = templateBaselines.get(key);
  if (cached !== undefined) return cached;
  const pending = styledRecordRender(text, text.content, project).then((rendered) => ({
    box: textBoxBaseline(rendered),
    acrossFromBaseline:
      text.pathText === undefined ? undefined : pathTextAcrossFromBaseline(rendered, text.pathText),
  }));
  templateBaselines.set(key, pending);
  // A failed render is retried by the next record rather than remembered.
  pending.catch(() => {
    if (templateBaselines.get(key) === pending) templateBaselines.delete(key);
  });
  if (templateBaselines.size > MAX_CACHED_TEMPLATES) {
    const oldest = templateBaselines.keys().next();
    if (oldest.done !== true) templateBaselines.delete(oldest.value);
  }
  return pending;
}

import { placeTextOnPath, type TextRenderResult } from '../../core/text';
import { styledBentRender, styledTextContent, styleTextRender } from '../../core/text/text-style';
import { pathTextAcrossFromBaseline } from '../../core/text/text-on-path';
import {
  onTextBoxBaseline,
  textBoxBaseline,
  textBoxOverflowMm,
  type TextBoxBaseline,
} from '../../core/text/text-box-render';
import { IDENTITY_TRANSFORM, type Project, type TextObject } from '../../core/scene';
import type { VariableTextRenderer, VariableTextRenderInput } from '../../io/gcode';
import { renderTextGeometry } from './render-text-geometry';
import { applyTextWeld } from './apply-text-weld';
import { heldFontParser } from './held-font-parser';
import type { OutlineFontParser } from './text-geometry-compute';

// Records in a frame or on a path keep the template's first baseline
// (ADR-682). A batch reads that from one render of the template per text.
type TemplateBaseline = {
  readonly box: TextBoxBaseline | undefined;
  readonly acrossFromBaseline: number | undefined;
};
const MAX_CACHED_TEMPLATES = 64;
const templateBaselines = new Map<string, Promise<TemplateBaseline>>();

export const renderVariableText: VariableTextRenderer = (input) => renderRecord(input, undefined);

/**
 * renderVariableText for one batch of records, such as an array's copies
 * (performance audit S7-P2-1): each font file is parsed once for the batch
 * where ADR-643 shows that reusing the parse changes no result, and for every
 * record otherwise. Make one per batch; it holds its parses until dropped.
 */
export function batchVariableTextRenderer(parseFont?: OutlineFontParser): VariableTextRenderer {
  const parse = heldFontParser(parseFont);
  return (input) => renderRecord(input, parse);
}

async function renderRecord(
  { text, content, project }: VariableTextRenderInput,
  parseFont: OutlineFontParser | undefined,
): ReturnType<VariableTextRenderer> {
  const rendered = await styledRecordRender(text, content, project, parseFont);
  const placedTemplate =
    content === text.content || (text.pathText === undefined && text.textBox === undefined)
      ? undefined
      : await templateBaseline(text, project, parseFont).catch(() => undefined);
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
      ...missingReport(rendered),
      // The guide's transform is already baked into placed world-space paths.
      transform: { ...IDENTITY_TRANSFORM, x: placed.origin.x, y: placed.origin.y },
    };
  }
  if (text.textBox !== undefined) {
    const framed = onTextBoxBaseline(rendered, placedTemplate?.box, text.textBox);
    return {
      ...applyTextWeld(framed, text.fontKey, text.weldOverlaps),
      // An Auto width frame is each record's own width, so its left edge is
      // not a place the records share: output keeps the alignment point instead.
      ...(text.textBox.mode === 'auto-width' ? {} : { transform: text.transform }),
      ...missingReport(rendered),
      ...frameOverflowReport(framed, text),
    };
  }
  return {
    ...applyTextWeld(styledBentRender(rendered, text), text.fontKey, text.weldOverlaps),
    ...missingReport(rendered),
  };
}

// Styled but not yet bent or laid on a path.
async function styledRecordRender(
  text: TextObject,
  content: string,
  project: Project,
  parseFont: OutlineFontParser | undefined,
): Promise<TextRenderResult> {
  const rendered = await renderTextGeometry(
    {
      fontKey: text.fontKey,
      embeddedFonts: project.embeddedFonts,
      content: styledTextContent(content, text.textStyle),
      sizeMm: text.sizeMm,
      alignment: text.alignment,
      lineHeight: text.lineHeight,
      letterSpacing: text.letterSpacing,
      color: text.color,
      ...(text.textBox === undefined ? {} : { textBox: text.textBox }),
    },
    parseFont,
  );
  return text.pathText !== undefined || text.textBox !== undefined
    ? styleTextRender(rendered, text.textStyle, text.sizeMm)
    : rendered;
}

function templateBaseline(
  text: TextObject,
  project: Project,
  parseFont: OutlineFontParser | undefined,
): Promise<TemplateBaseline> {
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
  const pending = styledRecordRender(text, text.content, project, parseFont).then((rendered) => ({
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

// ADR-682 Amendment 2: output warns about a record that burns past its frame, in the millimetres
// the object burns at. Less than this is no wider than the beam.
const FRAME_OVERFLOW_NOTICE_MM = 0.05;

function frameOverflowReport(
  framed: TextRenderResult,
  text: TextObject,
): { readonly frameOverflowMm?: number } {
  if (framed.textBoxLayout === undefined || text.textBox === undefined) return {};
  const past = textBoxOverflowMm(framed.bounds, framed.textBoxLayout, text.textBox);
  const overflowMm = Math.max(
    past.widthMm * Math.abs(text.transform.scaleX),
    past.heightMm * Math.abs(text.transform.scaleY),
  );
  return overflowMm < FRAME_OVERFLOW_NOTICE_MM ? {} : { frameOverflowMm: overflowMm };
}

// ADR-591 Amendment 1: output warns about a record's characters the font has no glyph for.
function missingReport(rendered: TextRenderResult): {
  readonly missingCharacters?: readonly string[];
} {
  return rendered.missingCharacters === undefined
    ? {}
    : { missingCharacters: rendered.missingCharacters };
}

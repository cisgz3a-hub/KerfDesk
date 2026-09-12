import { bendTextRender, placeTextOnPath } from '../../core/text';
import { IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import type { TextDialogState } from '../state/ui-store';
import { renderTextGeometry } from './render-text-geometry';
import { applyTextWeld } from './apply-text-weld';
import {
  sanitizeTextDialogNumericValues,
  type TextDialogNumericValues,
} from './TextDialogNumericFields';
import type { DialogValues } from './use-text-dialog-fields';

export class TextObjectValidationError extends Error {
  constructor(
    message: string,
    readonly severity: 'warning' | 'error',
  ) {
    super(message);
    this.name = 'TextObjectValidationError';
  }
}

/** Builds editable vector text without changing the project or its undo history. */
export async function buildTextObject(
  state: TextDialogState,
  values: DialogValues,
): Promise<TextObject> {
  const content = values.content.normalize('NFC');
  if (content.trim() === '') {
    throw new TextObjectValidationError('Type some text first.', 'warning');
  }
  const safeValues = sanitizeTextDialogNumericValues(values);
  const variable = fieldsVariableTemplate(values);
  if (!variable.ok) throw new TextObjectValidationError(variable.message, 'error');
  const rendered = await renderTextGeometry({
    fontKey: values.fontKey,
    embeddedFonts: values.embeddedFonts,
    content,
    sizeMm: safeValues.sizeMm,
    alignment: values.alignment,
    lineHeight: safeValues.lineHeight,
    letterSpacing: safeValues.letterSpacing,
    color: values.color,
  });
  const placed = placeRenderedText(rendered, safeValues, values);
  const final = applyTextWeld(placed.rendered, values.fontKey, values.weldOverlaps);
  return {
    kind: 'text',
    id: state.mode === 'edit' ? state.id : crypto.randomUUID(),
    content,
    fontKey: values.fontKey,
    sizeMm: safeValues.sizeMm,
    alignment: values.alignment,
    lineHeight: safeValues.lineHeight,
    letterSpacing: safeValues.letterSpacing,
    bendDeg: values.pathText === undefined ? safeValues.bendDeg : 0,
    ...(values.weldOverlaps === undefined ? {} : { weldOverlaps: values.weldOverlaps }),
    color: values.color,
    ...(values.pathText === undefined ? {} : { pathText: values.pathText }),
    ...(variable.template === undefined ? {} : { variableTemplate: variable.template }),
    bounds: final.bounds,
    transform: placed.transform,
    paths: final.paths,
  };
}

function fieldsVariableTemplate(
  values: DialogValues,
):
  | { readonly ok: true; readonly template?: NonNullable<TextObject['variableTemplate']> }
  | { readonly ok: false; readonly message: string } {
  if (values.variableTemplate === undefined) return { ok: true };
  return parseVariableTemplateSource(values.content);
}

function placeRenderedText(
  rendered: Awaited<ReturnType<typeof renderTextGeometry>>,
  safeValues: TextDialogNumericValues,
  values: DialogValues,
): {
  readonly rendered: Awaited<ReturnType<typeof renderTextGeometry>>;
  readonly transform: typeof IDENTITY_TRANSFORM;
} {
  if (values.pathText === undefined) {
    return {
      rendered: bendTextRender(rendered, safeValues.bendDeg),
      transform: IDENTITY_TRANSFORM,
    };
  }
  if (values.pathGuide === undefined) throw new Error('Select a guide path for this text.');
  const result = placeTextOnPath(rendered, values.pathGuide, values.pathText);
  if (result.kind !== 'ok') throw new Error(result.message);
  return {
    rendered: result.rendered,
    transform: { ...IDENTITY_TRANSFORM, x: result.origin.x, y: result.origin.y },
  };
}

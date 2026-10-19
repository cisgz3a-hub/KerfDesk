import { placeTextOnPath, type TextRenderResult } from '../../core/text';
import { styledBentRender, styledTextContent, styleTextRender } from '../../core/text/text-style';
import { IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import type { TextDialogState } from '../state/ui-store';
import { applyTextWeldInWorker } from './text-weld-worker-client';
import { renderTextGeometryOffThread, type TextGeometryRenderer } from './text-worker-session';
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

/**
 * Builds editable vector text without changing the project or its undo history.
 * The layout runs in a text worker (ADR-643): the caller's session for a
 * preview, or one of its own for an explicit action.
 */
export async function buildTextObject(
  state: TextDialogState,
  values: DialogValues,
  signal?: AbortSignal,
  render: TextGeometryRenderer = renderTextGeometryOffThread,
): Promise<TextObject> {
  signal?.throwIfAborted();
  const content = values.content.normalize('NFC');
  if (content.trim() === '') {
    throw new TextObjectValidationError('Type some text first.', 'warning');
  }
  const safeValues = sanitizeTextDialogNumericValues(values);
  const box = validatedTextBox(values, safeValues);
  const variable = fieldsVariableTemplate(values);
  if (!variable.ok) throw new TextObjectValidationError(variable.message, 'error');
  const rendered = await render(
    {
      fontKey: values.fontKey,
      embeddedFonts: values.embeddedFonts,
      content: styledTextContent(content, values.textStyle),
      sizeMm: safeValues.sizeMm,
      alignment: values.alignment,
      lineHeight: safeValues.lineHeight,
      letterSpacing: safeValues.letterSpacing,
      color: values.color,
      ...box,
    },
    signal,
  );
  signal?.throwIfAborted();
  const placed = placeRenderedText(rendered, safeValues, values);
  const final = await applyTextWeldInWorker(
    placed.rendered,
    values.fontKey,
    values.weldOverlaps,
    signal,
  );
  signal?.throwIfAborted();
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
    ...weldAndStyleFields(values),
    color: values.color,
    ...box,
    ...(values.pathText === undefined ? {} : { pathText: values.pathText }),
    ...(variable.template === undefined ? {} : { variableTemplate: variable.template }),
    bounds: final.bounds,
    transform: placed.transform,
    paths: final.paths,
  };
}

// Kept in this order: it is the key order a saved project writes.
function weldAndStyleFields(values: DialogValues): Pick<TextObject, 'weldOverlaps' | 'textStyle'> {
  return {
    ...(values.weldOverlaps === undefined ? {} : { weldOverlaps: values.weldOverlaps }),
    ...(values.textStyle === undefined ? {} : { textStyle: values.textStyle }),
  };
}

function fieldsVariableTemplate(
  values: DialogValues,
):
  | { readonly ok: true; readonly template?: NonNullable<TextObject['variableTemplate']> }
  | { readonly ok: false; readonly message: string } {
  if (values.variableTemplate === undefined) return { ok: true };
  const parsed = parseVariableTemplateSource(values.content);
  if (!parsed.ok) return parsed;
  const { sequenceOffset, ignoreEmptyLines } = values.variableTemplate;
  return {
    ...parsed,
    template: {
      ...parsed.template,
      ...(sequenceOffset === undefined ? {} : { sequenceOffset }),
      ...(ignoreEmptyLines === true ? { ignoreEmptyLines } : {}),
    },
  };
}

function placeRenderedText(
  rendered: TextRenderResult,
  safeValues: TextDialogNumericValues,
  values: DialogValues,
): {
  readonly rendered: TextRenderResult;
  readonly transform: typeof IDENTITY_TRANSFORM;
} {
  if (values.pathText === undefined) {
    return {
      rendered: styledBentRender(rendered, {
        bendDeg: safeValues.bendDeg,
        sizeMm: safeValues.sizeMm,
        ...(values.textStyle === undefined ? {} : { textStyle: values.textStyle }),
      }),
      transform: IDENTITY_TRANSFORM,
    };
  }
  if (values.pathGuide === undefined) throw new Error('Select a guide path for this text.');
  const styled = styleTextRender(rendered, values.textStyle, safeValues.sizeMm);
  const result = placeTextOnPath(styled, values.pathGuide, values.pathText);
  if (result.kind !== 'ok') throw new Error(result.message);
  return {
    rendered: result.rendered,
    transform: { ...IDENTITY_TRANSFORM, x: result.origin.x, y: result.origin.y },
  };
}

function validatedTextBox(
  values: DialogValues,
  safe: TextDialogNumericValues,
): Pick<TextObject, 'textBox'> {
  if (values.textBox === undefined) return {};
  if (values.pathText !== undefined || safe.bendDeg !== 0)
    throw new TextObjectValidationError('Text boxes cannot also follow a path or bend.', 'warning');
  if (
    ![values.textBox.widthMm, values.textBox.heightMm, values.textBox.minSizeMm].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new TextObjectValidationError(
      'Text box dimensions and minimum font size must be positive.',
      'warning',
    );
  return { textBox: values.textBox };
}

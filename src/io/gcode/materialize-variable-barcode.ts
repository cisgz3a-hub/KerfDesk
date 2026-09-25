// Output-time evaluation of a barcode whose data is a variable template
// (ADR-386): the template is evaluated for this copy exactly like variable
// text, the symbol is re-encoded, and any human-readable text is drawn
// through the same text renderer seam. A value the symbology cannot encode
// fails the output instead of engraving the previous copy's code.

import {
  BARCODE_CAPTION_FONT_KEY,
  materializeBarcode,
  type BarcodeCaptionRenderer,
  type BarcodeObject,
} from '../../core/barcode';
import {
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { evaluateVariableTemplate, type VariableEvaluationContext } from '../../core/variables';
import type { VariableTextRenderer } from './prepare-output-snapshot';

export type MaterializedBarcodeObject =
  | { readonly ok: true; readonly object: SceneObject }
  | { readonly ok: false; readonly message: string; readonly fallback: SceneObject };

export async function materializeVariableBarcode(
  object: BarcodeObject,
  project: Project,
  context: VariableEvaluationContext,
  renderer: VariableTextRenderer,
): Promise<MaterializedBarcodeObject> {
  const template = object.spec.variableTemplate;
  if (template === undefined) return { ok: true, object };
  const evaluated = evaluateVariableTemplate(template, object, project, context);
  if (!evaluated.ok) return { ok: false, message: evaluated.message, fallback: object };
  const { variableTemplate: _template, ...fixed } = object.spec;
  const spec = { ...fixed, data: evaluated.value };
  const result = await materializeBarcode(
    spec,
    evaluated.value,
    object.color,
    barcodeCaptionRenderer(renderer, object.color, project),
  );
  if (!result.ok) {
    return {
      ok: false,
      message: `Barcode ${object.id} cannot encode "${evaluated.value}": ${result.message}`,
      fallback: object,
    };
  }
  const operationIds = object.paths[0]?.operationIds;
  return {
    ok: true,
    object: {
      ...object,
      spec,
      bounds: result.barcode.bounds,
      paths: result.barcode.paths.map((path) =>
        operationIds === undefined ? path : { ...path, operationIds },
      ),
    },
  };
}

/** Draws barcode captions with the bundled font through a text renderer. */
export function barcodeCaptionRenderer(
  renderer: VariableTextRenderer,
  color: string,
  project: Project,
): BarcodeCaptionRenderer {
  return async ({ text, sizeMm }) => {
    const caption: TextObject = {
      kind: 'text',
      id: 'barcode-caption',
      content: text,
      fontKey: BARCODE_CAPTION_FONT_KEY,
      sizeMm,
      alignment: 'center',
      lineHeight: 1,
      letterSpacing: 0,
      color,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      transform: IDENTITY_TRANSFORM,
      paths: [],
    };
    const rendered = await renderer({ text: caption, content: text, project });
    const polylines = rendered.paths.flatMap((path) => path.polylines);
    const curves = rendered.paths.flatMap((path) => path.curves ?? []);
    return {
      polylines,
      curves: curves.length === polylines.length ? curves : undefined,
      bounds: rendered.bounds,
    };
  };
}

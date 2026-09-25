// Objects that carry variable data: text with a template, and barcodes whose
// data is a template (ADR-386). Output, arrays and copy offsets go through
// these helpers so both kinds re-evaluate per copy the same way.

import type { Project, SceneObject, VariableTemplate } from '../scene';

export function objectVariableTemplate(object: SceneObject): VariableTemplate | undefined {
  if (object.kind === 'text') return object.variableTemplate;
  if (object.kind === 'shape' && object.spec.kind === 'barcode')
    return object.spec.variableTemplate;
  return undefined;
}

export function projectHasVariableData(project: Project): boolean {
  return project.scene.objects.some((object) => objectVariableTemplate(object) !== undefined);
}

/** The object with its template's copy offset replaced; others unchanged. */
export function withVariableSequenceOffset(
  object: SceneObject,
  sequenceOffset: number,
): SceneObject {
  const template = objectVariableTemplate(object);
  if (template === undefined) return object;
  const next = { ...template, sequenceOffset };
  if (object.kind === 'text') return { ...object, variableTemplate: next };
  if (object.kind === 'shape' && object.spec.kind === 'barcode') {
    return { ...object, spec: { ...object.spec, variableTemplate: next } };
  }
  return object;
}

/**
 * Puts the variable source back on an object materialized for one copy, so
 * the copy keeps re-evaluating at output. Barcodes also restore their
 * template text, which materialization replaced with the evaluated value.
 */
export function restoreVariableSource(
  rendered: SceneObject,
  source: SceneObject | undefined,
): SceneObject {
  if (source === undefined) return rendered;
  const template = objectVariableTemplate(source);
  if (template === undefined) return rendered;
  if (rendered.kind === 'text') return { ...rendered, variableTemplate: template };
  if (
    rendered.kind === 'shape' &&
    rendered.spec.kind === 'barcode' &&
    source.kind === 'shape' &&
    source.spec.kind === 'barcode'
  ) {
    return {
      ...rendered,
      spec: { ...rendered.spec, data: source.spec.data, variableTemplate: template },
    };
  }
  return rendered;
}

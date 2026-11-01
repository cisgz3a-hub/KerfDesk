// An even canvas resize folded into a generated part's lengths (ADR-573
// Amendment 1). Every `…Mm` field is a length and scales; rows and columns are
// counts and do not.

import { retainedSourceScale, scaledLengthMm } from '../scene/retained-source-scale';
import type { GeneratedPartObject, PartGeneratorDefinition } from './part-generator';

/** The definition an editor opens on: an even canvas resize is already in its
 *  lengths, so the values it shows are the sizes that burn. */
export function editablePartGeneratorDefinition(
  object: GeneratedPartObject,
): PartGeneratorDefinition {
  const definition = object.partGenerator.definition;
  const scale = retainedSourceScale(object);
  return scale.kind === 'even'
    ? scalePartGeneratorDefinition(definition, scale.factor)
    : definition;
}

export function scalePartGeneratorDefinition(
  definition: PartGeneratorDefinition,
  factor: number,
): PartGeneratorDefinition {
  if (factor === 1) return definition;
  return Object.fromEntries(
    Object.entries(definition).map(([key, value]) => [
      key,
      key.endsWith('Mm') && typeof value === 'number' ? scaledLengthMm(value, factor) : value,
    ]),
  ) as PartGeneratorDefinition;
}

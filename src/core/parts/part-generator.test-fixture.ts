import { IDENTITY_TRANSFORM } from '../scene/scene-object';
import type {
  GeneratedPartObject,
  PartGeneratorDefinition,
  PartGeneratorResult,
} from './part-generator';
import { defaultPartGenerator } from './part-generator';
import { materializePartGenerator } from './materialize-part-generator';
export function requirePart<T>(result: PartGeneratorResult<T>): T {
  if (result.kind === 'invalid') throw new Error(result.reason);
  return result.value;
}
export function generatedPart(
  definition: PartGeneratorDefinition = defaultPartGenerator('hole-grid'),
): GeneratedPartObject {
  const geometry = requirePart(materializePartGenerator(definition));
  return {
    kind: 'imported-svg',
    id: 'generated',
    source: 'panel.part',
    name: definition.name,
    bounds: geometry.bounds,
    paths: geometry.paths.map((path, index) => ({
      ...path,
      operationIds: [index === 0 ? 'boundary' : 'holes'],
    })),
    transform: { ...IDENTITY_TRANSFORM, x: 7, y: 11 },
    operationIds: ['boundary', 'holes'],
    operationOverride: { byOperation: { boundary: { power: 77 }, holes: { passes: 2 } } },
    partGenerator: geometry.source,
  };
}

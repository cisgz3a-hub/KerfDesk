import { evaluateBooleanCompound } from '../../core/geometry/boolean-compound';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import type { ImportedSvg } from '../../core/scene/scene-object';
import { firstPersistenceSemanticDrift } from './persistence-semantic-integrity';
import { isObject } from './project-shape-primitives';
import { withSerializableCompound } from './serialize-project';

/** Validated archive strings remain untouched; their retained sources must reproduce the cache. */
export function validateArchiveBooleanCompounds(raw: Record<string, unknown>): string | null {
  const scene = raw['scene'];
  if (!isObject(scene) || !Array.isArray(scene['objects'])) return null;
  for (const [index, value] of scene['objects'].entries()) {
    if (!isObject(value) || value['kind'] !== 'imported-svg') continue;
    const object = value as unknown as ImportedSvg;
    if (!isBooleanCompoundObject(object)) continue;
    try {
      const evaluated = evaluateBooleanCompound(object);
      if (evaluated.kind === 'error')
        return `Could not evaluate retained Boolean sources in archived scene.objects[${index}]: ${evaluated.error.message}`;
      if (!isBooleanCompoundObject(evaluated.value))
        return `Archived scene.objects[${index}] lost its retained Boolean sources`;
      const before = compoundSemantics(object);
      const after = compoundSemantics(evaluated.value);
      const drift = firstPersistenceSemanticDrift(before, after);
      if (drift !== null) {
        const path = drift.replace('scene.objects[0]', `scene.objects[${index}]`);
        return `saving would change \`${path}\` in an archived compound during validation; repair or reload the archived project before saving`;
      }
    } catch (error) {
      return `Could not evaluate archived scene.objects[${index}]: ${error instanceof Error ? error.message : 'invalid retained Boolean sources'}`;
    }
  }
  return null;
}

function compoundSemantics(
  object: ImportedSvg & { readonly booleanCompound: NonNullable<ImportedSvg['booleanCompound']> },
): string {
  // Canonical curves match ordinary Save without serializing unrelated raster data or archives.
  return JSON.stringify({ scene: { objects: [withSerializableCompound(object)] } });
}

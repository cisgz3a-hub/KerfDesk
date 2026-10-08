import { evaluateBooleanCompound } from '../../core/geometry/boolean-compound';
import type { ImportedSvg } from '../../core/scene/scene-object';

/** Shape validation runs first. Retained sources, never the saved result cache, own geometry. */
export function normalizeBooleanCompound(object: Record<string, unknown>): Record<string, unknown> {
  if (object['kind'] !== 'imported-svg' || object['booleanCompound'] === undefined) return object;
  const result = evaluateBooleanCompound(object as unknown as ImportedSvg);
  if (result.kind === 'error')
    throw new Error(`Could not evaluate retained Boolean sources: ${result.error.message}`);
  return result.value as unknown as Record<string, unknown>;
}

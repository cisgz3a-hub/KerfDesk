import { firstError, isObject, optionalBoolean, optionalLiteral } from './project-shape-primitives';

export function validateOptimization(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return 'missing or invalid `optimization`';
  return firstError([
    optionalBoolean(value, 'optimization.reduceTravelMoves'),
    optionalLiteral(value, 'optimization.travelPolicy', ['nearest-neighbor', 'source-order']),
    optionalBoolean(value, 'optimization.insideFirst'),
    optionalLiteral(value, 'optimization.layerPriority', [
      'project-order',
      'reverse-project-order',
    ]),
    optionalLiteral(value, 'optimization.pathDirection', ['allow-reverse', 'preserve']),
    optionalLiteral(value, 'optimization.startPoint', [
      'machine-origin',
      'job-lower-left',
      'job-center',
    ]),
  ]);
}

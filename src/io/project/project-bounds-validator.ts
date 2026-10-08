import { firstError, isObject, requireCoordinate } from './project-shape-primitives';

export function validateBounds(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const fieldError = firstError([
    requireCoordinate(value, `${path}.minX`),
    requireCoordinate(value, `${path}.minY`),
    requireCoordinate(value, `${path}.maxX`),
    requireCoordinate(value, `${path}.maxY`),
  ]);
  if (fieldError !== null) return fieldError;
  // CQ-006: inverted bounds are corrupt input. Zero extents remain valid.
  const { minX, minY, maxX, maxY } = value;
  if (typeof minX === 'number' && typeof maxX === 'number' && minX > maxX) {
    return `invalid \`${path}\`: minX must be <= maxX`;
  }
  if (typeof minY === 'number' && typeof maxY === 'number' && minY > maxY) {
    return `invalid \`${path}\`: minY must be <= maxY`;
  }
  return null;
}

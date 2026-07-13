import {
  firstError,
  isObject,
  requireBoolean,
  requireCoordinate,
  requireNumber,
  requirePositiveNumber,
  validateArray,
} from './project-shape-primitives';

export function validateCurveSubpaths(value: unknown, path: string): string | null {
  // Every project saved by v2 writes curves. In-memory factories still add
  // them at serialization while downstream consumers migrate incrementally.
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validateCurveSubpath);
}

function validateCurveSubpath(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const segments = value['segments'];
  return firstError([
    validatePoint(value['start'], `${path}.start`),
    Array.isArray(segments)
      ? validateArray(segments, `${path}.segments`, validatePathSegment)
      : `missing or invalid \`${path}.segments\``,
    requireBoolean(value, `${path}.closed`),
  ]);
}

function validatePathSegment(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  if (value['kind'] === 'line') return validatePoint(value['to'], `${path}.to`);
  if (value['kind'] === 'cubic') {
    return firstError([
      validatePoint(value['control1'], `${path}.control1`),
      validatePoint(value['control2'], `${path}.control2`),
      validatePoint(value['to'], `${path}.to`),
    ]);
  }
  if (value['kind'] === 'elliptical-arc') {
    return firstError([
      requirePositiveNumber(value, `${path}.radiusX`),
      requirePositiveNumber(value, `${path}.radiusY`),
      requireNumber(value, `${path}.rotationDeg`),
      requireBoolean(value, `${path}.largeArc`),
      requireBoolean(value, `${path}.sweep`),
      validatePoint(value['to'], `${path}.to`),
    ]);
  }
  return `missing or invalid \`${path}.kind\``;
}

function validatePoint(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([requireCoordinate(value, `${path}.x`), requireCoordinate(value, `${path}.y`)]);
}

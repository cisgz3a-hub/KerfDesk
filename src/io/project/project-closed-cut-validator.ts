// Shape checks for the ADR-385 closed-cut data: the optional Line options an
// operation, sub-operation, material binding or artwork override may carry,
// and the Set Start Point list on scene objects. Absent is always valid.

import {
  firstError,
  isObject,
  optionalLiteral,
  optionalNonNegativeNumber,
  optionalPositiveInteger,
  optionalPositiveNumber,
} from './project-shape-primitives';

export function validateLineCutOptions(
  value: Record<string, unknown>,
  path: string,
): string | null {
  return firstError([
    optionalNonNegativeNumber(value, `${path}.overcutMm`),
    optionalLiteral(value, `${path}.tabPlacement`, ['per-shape', 'spacing']),
    optionalPositiveNumber(value, `${path}.tabSpacingMm`),
    optionalPositiveInteger(value, `${path}.tabMinPerShape`),
    optionalPositiveInteger(value, `${path}.tabMaxPerShape`),
  ]);
}

export function validateCutStartPoints(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  for (let index = 0; index < value.length; index += 1) {
    const error = validateCutStartPoint(value[index], `${path}[${index}]`);
    if (error !== null) return error;
  }
  return null;
}

function validateCutStartPoint(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  if (!isNonNegativeInteger(value['pathIndex'])) return `missing or invalid \`${path}.pathIndex\``;
  if (!isNonNegativeInteger(value['polylineIndex'])) {
    return `missing or invalid \`${path}.polylineIndex\``;
  }
  const pathT = value['pathT'];
  if (typeof pathT !== 'number' || !Number.isFinite(pathT) || pathT < 0 || pathT > 1) {
    return `missing or invalid \`${path}.pathT\``;
  }
  return null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

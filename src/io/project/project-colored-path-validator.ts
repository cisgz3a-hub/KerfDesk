import { validateCurveSubpaths } from './project-curve-shape-validator';
import { validateOperationIds } from './project-operation-id-validator';
import {
  firstError,
  isObject,
  optionalPositiveNumber,
  requireBoolean,
  requireCoordinate,
  requireString,
  validateArray,
} from './project-shape-primitives';

export function validateColoredPaths(value: unknown, path: string): string | null {
  return Array.isArray(value)
    ? validateArray(value, path, validateColoredPath)
    : `missing or invalid \`${path}\``;
}

function validateColoredPath(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(value, `${path}.color`),
    validateOperationIds(value['operationIds'], `${path}.operationIds`),
    optionalPositiveNumber(value, `${path}.strokeWidthMm`),
    validatePolylines(value['polylines'], `${path}.polylines`),
    validateCurveSubpaths(value['curves'], `${path}.curves`),
  ]);
}

function validatePolylines(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validatePolyline);
}

function validatePolyline(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireBoolean(value, `${path}.closed`),
    validatePoints(value['points'], `${path}.points`),
  ]);
}

export function validatePoints(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validatePoint);
}

function validatePoint(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([requireCoordinate(value, `${path}.x`), requireCoordinate(value, `${path}.y`)]);
}

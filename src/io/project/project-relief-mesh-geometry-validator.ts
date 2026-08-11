import type { ReliefMeshIntrinsicBounds } from '../../core/scene/relief';
import {
  firstError,
  isObject,
  requireLiteral,
  requireNumber,
  requirePositiveNumber,
} from './project-shape-primitives';

const MESH_VERTEX_COORDINATE_COUNT = 3;
const MESH_POSITION_VALUES_PER_TRIANGLE = 9;
const FINITE_BOUNDS_FIELDS = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'] as const;

/** Validates one schema-v5 legacy source and its persisted Float32 geometry authority. */
export function validateProjectReliefMeshGeometry(
  object: Record<string, unknown>,
  source: Record<string, unknown>,
  objectPath: string,
): string | null {
  const sourcePath = `${objectPath}.reliefSource`;
  const meshPath = `${sourcePath}.meshPositions`;
  const inspection = inspectMeshPositions(source['meshPositions'], meshPath);
  if (typeof inspection === 'string') return inspection;
  const fieldError = firstError([
    requireLiteral(source, `${sourcePath}.emptyCells`, ['floor', 'top']),
    validateIntrinsicBounds(source['intrinsicBounds'], `${sourcePath}.intrinsicBounds`),
    requirePositiveNumber(object, `${objectPath}.targetHeightMm`),
    requireLiteral(object, `${objectPath}.widthAspect`, ['preserve', 'stretch']),
  ]);
  if (fieldError !== null) return fieldError;
  return sameIntrinsicBounds(source['intrinsicBounds'], inspection)
    ? null
    : `invalid \`${sourcePath}.intrinsicBounds\`: must match Float32 mesh positions`;
}

function validateIntrinsicBounds(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  if (value['kind'] === 'non-finite-float32-v1') return null;
  if (value['kind'] !== 'finite-float32-v1') return `missing or invalid \`${path}.kind\``;
  return firstError([
    requireNumber(value, `${path}.minX`),
    requireNumber(value, `${path}.minY`),
    requireNumber(value, `${path}.minZ`),
    requireNumber(value, `${path}.maxX`),
    requireNumber(value, `${path}.maxY`),
    requireNumber(value, `${path}.maxZ`),
  ]);
}

function inspectMeshPositions(value: unknown, path: string): ReliefMeshIntrinsicBounds | string {
  if (!Array.isArray(value) || value.length === 0) {
    return `missing or invalid \`${path}\``;
  }
  if (value.length % MESH_POSITION_VALUES_PER_TRIANGLE !== 0) {
    return `\`${path}\` length must be a multiple of ${MESH_POSITION_VALUES_PER_TRIANGLE} (three xyz vertices per triangle)`;
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let float32IsFinite = true;
  for (let index = 0; index < value.length; index += MESH_VERTEX_COORDINATE_COUNT) {
    const rawX = value[index];
    const rawY = value[index + 1];
    const rawZ = value[index + 2];
    if (!finiteNumber(rawX) || !finiteNumber(rawY) || !finiteNumber(rawZ)) {
      return `non-finite number in \`${path}\``;
    }
    const x = Math.fround(rawX);
    const y = Math.fround(rawY);
    const z = Math.fround(rawZ);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      float32IsFinite = false;
      continue;
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return float32IsFinite
    ? {
        kind: 'finite-float32-v1',
        minX: canonicalZero(minX),
        minY: canonicalZero(minY),
        minZ: canonicalZero(minZ),
        maxX: canonicalZero(maxX),
        maxY: canonicalZero(maxY),
        maxZ: canonicalZero(maxZ),
      }
    : { kind: 'non-finite-float32-v1' };
}

function canonicalZero(value: number): number {
  return value === 0 ? 0 : value;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sameIntrinsicBounds(left: unknown, right: ReliefMeshIntrinsicBounds): boolean {
  if (!isObject(left) || left['kind'] !== right.kind) return false;
  if (right.kind === 'non-finite-float32-v1') return Object.keys(left).length === 1;
  return (
    Object.keys(left).length === FINITE_BOUNDS_FIELDS.length + 1 &&
    FINITE_BOUNDS_FIELDS.every((field) => left[field] === right[field])
  );
}

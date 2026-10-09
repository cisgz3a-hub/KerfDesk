import { validateReliefHeightfield } from './project-relief-heightfield-validator';
import { firstError, isObject, requireLiteral } from './project-shape-primitives';

const LEGACY_RELIEF_SIBLINGS = ['depthMap', 'meshPositions', 'emptyCells'] as const;
const NESTED_LEGACY_SOURCE_FIELDS = ['depthMap'] as const;
const HEIGHTFIELD_SOURCE_FIELDS = [
  'schemaVersion',
  'width',
  'height',
  'physicalWidthMm',
  'physicalHeightMm',
  'encoding',
  'samplesBase64',
  'inclusionMask',
  'mapping',
  'provenance',
  'algorithmRevision',
  'revision',
  'digest',
] as const;

/** Reject v4 reliefs that retain another recognized source authority. */
export function validateSingleReliefSource(
  object: Record<string, unknown>,
  source: Record<string, unknown>,
  path: string,
): string | null {
  const hasLegacySibling = hasOwnField(object, LEGACY_RELIEF_SIBLINGS);
  const hasOppositeArm =
    hasOwnField(source, NESTED_LEGACY_SOURCE_FIELDS) ||
    (source['kind'] === 'heightfield-v1' && hasOwnField(source, ['meshPositions', 'emptyCells'])) ||
    (source['kind'] === 'legacy-mesh' && hasOwnField(source, HEIGHTFIELD_SOURCE_FIELDS));
  return hasLegacySibling || hasOppositeArm
    ? `invalid \`${path}\`: relief must contain exactly one source arm`
    : null;
}

function hasOwnField(value: Record<string, unknown>, fields: ReadonlyArray<string>): boolean {
  return fields.some((field) => Object.prototype.hasOwnProperty.call(value, field));
}

export function validateReliefSource(obj: Record<string, unknown>, path: string): string | null {
  const source = obj['reliefSource'];
  if (!isObject(source)) return `missing or invalid \`${path}.reliefSource\``;
  const authorityError = validateSingleReliefSource(obj, source, path);
  if (authorityError !== null) return authorityError;
  if (source['kind'] === 'legacy-mesh') {
    return firstError([
      validateMeshPositions(source['meshPositions'], `${path}.reliefSource.meshPositions`),
      requireLiteral(source, `${path}.reliefSource.emptyCells`, ['floor', 'top']),
    ]);
  }
  return validateReliefHeightfield(source, `${path}.reliefSource`);
}

function validateMeshPositions(value: unknown, path: string): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return `missing or invalid \`${path}\``;
  }
  if (value.length % 9 !== 0) {
    return `\`${path}\` length must be a multiple of 9 (three xyz vertices per triangle)`;
  }
  for (const n of value) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return `non-finite number in \`${path}\``;
    }
  }
  return null;
}

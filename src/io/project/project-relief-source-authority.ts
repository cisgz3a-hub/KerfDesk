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

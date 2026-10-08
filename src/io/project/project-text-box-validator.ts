import {
  firstError,
  isObject,
  requireBoolean,
  requireLiteral,
  requirePositiveNumber,
} from './project-shape-primitives';

/** A text frame changes regeneration intent, so never silently discard it. */
export function validateTextBox(
  value: unknown,
  object: Record<string, unknown>,
  path: string,
): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const fields = firstError([
    requireLiteral(value, `${path}.mode`, ['auto-width', 'auto-height', 'fixed']),
    requirePositiveNumber(value, `${path}.widthMm`),
    requirePositiveNumber(value, `${path}.heightMm`),
    requirePositiveNumber(value, `${path}.minSizeMm`),
    requireBoolean(value, `${path}.wrap`),
    requireLiteral(value, `${path}.fit`, ['none', 'shrink']),
  ]);
  if (fields !== null) return fields;
  if (
    object['pathText'] !== undefined ||
    (object['bendDeg'] !== undefined && object['bendDeg'] !== 0)
  )
    return `invalid \`${path}\`: frame text cannot also follow a path or bend`;
  return null;
}

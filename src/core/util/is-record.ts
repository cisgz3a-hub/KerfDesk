// The "is this a plain object?" test every loader and validator needs.
//
// It was written out again in about sixty files (code quality audit C1,
// C2-P3-1). Every copy replaced by an import had this exact body.

/** True for a non-null object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value as a record, or null when it is not a plain object. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

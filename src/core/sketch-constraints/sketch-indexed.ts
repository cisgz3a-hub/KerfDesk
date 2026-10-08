/** Checked access to entities and matrix entries whose bounds have been validated. */
export function sketchRequired<T>(value: T | undefined, context: string): T {
  if (value === undefined) throw new RangeError('Missing validated sketch ' + context + '.');
  return value;
}
export function sketchAt<T>(values: readonly T[], index: number): T {
  return sketchRequired(values[index], 'entry at index ' + index);
}

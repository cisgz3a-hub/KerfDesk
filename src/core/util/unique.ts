// Shared by ui and core (code quality audit C1, C2-P3-1).

/** The values with repeats removed, in first-seen order. */
export function uniqueValues<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

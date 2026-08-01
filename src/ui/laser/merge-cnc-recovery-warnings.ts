/**
 * Merge source and recovery-emission advisories without repeating an exact
 * message, preserving the first-seen order shown to the operator.
 */
export function mergeCncRecoveryWarnings(
  sourceWarnings: ReadonlyArray<string>,
  emittedWarnings: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return [...new Set([...sourceWarnings, ...emittedWarnings])];
}

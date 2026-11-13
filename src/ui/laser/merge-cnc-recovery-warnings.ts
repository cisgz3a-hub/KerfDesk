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

/**
 * A recovery job leaves out the operations already cut, so the emitter's
 * check that every output layer produced toolpaths reads each of them as a
 * layer whose "shapes produced no toolpaths" and advises fixing it (CNC audit
 * v3 N5r-P3-1, ADR-215 Amendment 4). The sealed job passed that check at its
 * own Start; the recovery confirmation drops it.
 */
export function withoutOmittedLayerIssues<T extends { readonly code: string }>(preflight: {
  readonly issues: ReadonlyArray<T>;
}): { readonly issues: ReadonlyArray<T> } {
  return { issues: preflight.issues.filter((issue) => issue.code !== 'cnc-layer-empty') };
}

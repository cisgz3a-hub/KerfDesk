// Shared trace-benchmark scoring + ink-coverage helpers. Pure, deterministic,
// test-only (lives under src/__fixtures__, boundary- and coverage-exempt per
// eslint.config.mjs). Extracted from the trace-benchmark modules that had
// copy-pasted rating logic (audit finding D-S09-004) so the scoring rule lives
// in exactly one place.

// polylineLength's canonical home is centerline-geometry (with the other
// arc-length helpers); re-exported here so benchmark consumers keep a single
// import site and there is still only one definition (audit finding AF-FIX-001).
export { polylineLength } from './centerline-geometry';

// A finding just needs its severity for scoring; kept structural so callers
// can pass their own richer finding shape without a cross-module type import.
type RatedFinding = { readonly severity: 'high' | 'medium' | 'low' };

// Push `finding` onto `findings` only when `condition` holds. Generic so each
// benchmark keeps its own finding type.
export function pushFindingIf<T>(condition: boolean, findings: T[], finding: T): void {
  if (condition) findings.push(finding);
}

// Rating from the worst finding severity: any high caps at 6, any medium at 8,
// any low at 9, otherwise a clean 10.
export function capFromFindings(findings: ReadonlyArray<RatedFinding>): number {
  if (findings.some((finding) => finding.severity === 'high')) return 6;
  if (findings.some((finding) => finding.severity === 'medium')) return 8;
  if (findings.some((finding) => finding.severity === 'low')) return 9;
  return 10;
}

export function ratingFromFindings(findings: ReadonlyArray<RatedFinding>): number {
  return capFromFindings(findings);
}

// Count set mask cells inside `rect` (half-open on x1/y1). Shared ink-coverage
// probe for the Arch House / Langebaan band checks.
export function countInk(
  mask: { readonly width: number; readonly data: ArrayLike<number> },
  rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
): number {
  let count = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      count += mask.data[y * mask.width + x] ?? 0;
    }
  }
  return count;
}

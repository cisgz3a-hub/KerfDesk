// Work budget for the minimum-feature check (ADR-408). The check is an
// advisory that runs while Job Review opens and after a trace commit, both on
// the main thread, so its cost must be bounded by counted work units rather
// than by wall-clock time (core is clock-free). When a budget runs out the
// check stops, reports what it found so far, and says the rest is unchecked.

export type MinFeatureBudget = {
  /** Path pieces indexed for the proximity search (at most two search
   * radii of cut length each). Bounds memory and index build time. */
  readonly maxPieces: number;
  /** Candidate piece pairs, witness-disk probes, and the path boxes, grid
   * cells and edges the side-deciding rays touch. Bounds the search time. */
  readonly maxPairTests: number;
};

// Sized so a dense traced job finishes well inside it: the owl test image
// traced with Line Art at 100 mm wide is 142,448 pieces and 2,211,282 tests
// (about 0.6 s on a loaded laptop). A job that spends all of it takes up to
// about 1.5 s; see ADR-408 for the measurements.
export const DEFAULT_MIN_FEATURE_BUDGET: MinFeatureBudget = {
  maxPieces: 500_000,
  maxPairTests: 4_000_000,
};

export class MinFeatureWorkMeter {
  pieces = 0;
  pairTests = 0;
  exhausted = false;

  constructor(readonly budget: MinFeatureBudget) {}

  /** Reserve `count` pieces; false (and exhausted) when the budget cannot cover them. */
  takePieces(count: number): boolean {
    if (this.pieces + count > this.budget.maxPieces) {
      this.exhausted = true;
      return false;
    }
    this.pieces += count;
    return true;
  }

  /** Record `count` tests; false (and exhausted) once the budget is spent. */
  takePairTests(count: number): boolean {
    if (this.pairTests + count > this.budget.maxPairTests) {
      this.exhausted = true;
      return false;
    }
    this.pairTests += count;
    return true;
  }
}

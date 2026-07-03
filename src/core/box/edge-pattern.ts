// edge-pattern — the ONE alternating finger sequence both panels of a cube
// edge derive material ownership from (ADR-105). The sequence covers the
// edge's interior span between the two T×T×T corner cubes; corner ownership
// is panel-claims' corner rule, not the pattern's job. Complementarity is by
// construction: panel A owns exactly the cells panel B does not, so
// both-tabs / neither-tab states are unrepresentable.

export const MIN_FINGER_WIDTH_MM = 2;
// An odd count keeps the sequence symmetric under reversal, so opposite
// panels (front/back, left/right, top/bottom) stay interchangeable.
const MIN_ALTERNATING_CELLS = 3;

export type EdgePattern = {
  /** Odd cell count; 1 when the span cannot fit three minimum-width cells. */
  readonly cellCount: number;
  readonly cellWidthMm: number;
  readonly interiorSpanMm: number;
  /** Edge-axis coordinate where the interior starts (= material thickness). */
  readonly interiorStartMm: number;
  /** Edge-axis coordinate where the interior ends (= full span − thickness). */
  readonly interiorEndMm: number;
};

/**
 * Compute the alternating cell sequence for one cube edge. `fullSpanMm` is
 * the outer box dimension along the edge axis; the interior span between the
 * corner cubes is `fullSpanMm − 2·thicknessMm` (= the inner dimension).
 */
export function edgePattern(args: {
  readonly fullSpanMm: number;
  readonly thicknessMm: number;
  readonly targetFingerWidthMm: number;
}): EdgePattern {
  const interiorSpanMm = args.fullSpanMm - 2 * args.thicknessMm;
  const interiorStartMm = args.thicknessMm;
  const interiorEndMm = args.fullSpanMm - args.thicknessMm;
  const minCellMm = Math.max(MIN_FINGER_WIDTH_MM, args.thicknessMm);
  if (interiorSpanMm / MIN_ALTERNATING_CELLS < minCellMm) {
    return {
      cellCount: 1,
      cellWidthMm: interiorSpanMm,
      interiorSpanMm,
      interiorStartMm,
      interiorEndMm,
    };
  }
  const clampedTargetMm = Math.min(
    Math.max(args.targetFingerWidthMm, minCellMm),
    interiorSpanMm / MIN_ALTERNATING_CELLS,
  );
  const cellCount = largestOddAtMost(Math.floor(interiorSpanMm / clampedTargetMm));
  return {
    cellCount,
    cellWidthMm: interiorSpanMm / cellCount,
    interiorSpanMm,
    interiorStartMm,
    interiorEndMm,
  };
}

/**
 * Cell boundary `index` (0..cellCount) in edge-axis coordinates. The two
 * outermost boundaries reuse the interiorStart/interiorEnd expressions
 * verbatim — NOT `start + cellCount·width` — so every consumer (both mating
 * panels and the assembly referee) lands on bit-identical floats.
 */
export function cellBoundary(pattern: EdgePattern, index: number): number {
  if (index <= 0) return pattern.interiorStartMm;
  if (index >= pattern.cellCount) return pattern.interiorEndMm;
  return pattern.interiorStartMm + index * pattern.cellWidthMm;
}

/** Even cells belong to the edge's higher-priority (primary) panel. */
export function primaryOwnsCell(cellIndex: number): boolean {
  return cellIndex % 2 === 0;
}

function largestOddAtMost(value: number): number {
  const odd = value % 2 === 0 ? value - 1 : value;
  return Math.max(MIN_ALTERNATING_CELLS, odd);
}

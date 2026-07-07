// divider-layout — where the divider panels sit and how their junctions
// alternate (ADR-116 V2). X-dividers partition the width (thin slab in X,
// spanning depth × height, tabbed into the front/back walls); Y-dividers
// partition the depth (tabbed into left/right). All coordinates are box-axis
// mm from the same expressions the panel builders and the referee read, so
// slots and tabs land on bit-identical floats.

import { cellBoundary, edgePattern, type EdgePattern } from './edge-pattern';
import { deriveBoxDims, type BoxSpec } from './box-spec';

export type DividerAxis = 'x' | 'y';

export type DividerPlacement = {
  readonly axis: DividerAxis;
  readonly index: number;
  /** Slab start along the partitioned axis (slab = [startMm, startMm+T]). */
  readonly startMm: number;
};

export type DividerLayout = {
  readonly xDividers: ReadonlyArray<DividerPlacement>;
  readonly yDividers: ReadonlyArray<DividerPlacement>;
  /** Divider panel height: inner height, plus the rim band when open-top. */
  readonly heightSpanMm: number;
  /**
   * ONE alternating sequence shared by every divider↔wall junction (they
   * all run the same vertical span). Odd cells are the divider's tabs and
   * the wall's slots; the even end cells keep slots away from the wall's
   * own finger rows. Boundaries via junctionCellBounds.
   */
  readonly junction: EdgePattern;
};

export function dividerCounts(spec: BoxSpec): { readonly x: number; readonly y: number } {
  return { x: spec.dividersXCount ?? 0, y: spec.dividersYCount ?? 0 };
}

export function hasDividers(spec: BoxSpec): boolean {
  const counts = dividerCounts(spec);
  return counts.x > 0 || counts.y > 0;
}

export function dividerLayout(spec: BoxSpec): DividerLayout {
  const dims = deriveBoxDims(spec);
  const counts = dividerCounts(spec);
  const heightSpanMm =
    spec.style === 'open-top' ? dims.innerHeightMm + spec.thicknessMm : dims.innerHeightMm;
  return {
    xDividers: placements('x', counts.x, dims.innerWidthMm, spec.thicknessMm),
    yDividers: placements('y', counts.y, dims.innerDepthMm, spec.thicknessMm),
    heightSpanMm,
    // fullSpan = span + 2T makes the pattern's interior exactly the junction
    // span, reusing the edge-pattern cell law (odd count, clamped target).
    junction: edgePattern({
      fullSpanMm: heightSpanMm + 2 * spec.thicknessMm,
      thicknessMm: spec.thicknessMm,
      targetFingerWidthMm: spec.targetFingerWidthMm,
    }),
  };
}

/** Compartment pitch along one axis (must clear 2T — validated upstream). */
export function compartmentPitchMm(
  innerSpanMm: number,
  count: number,
  thicknessMm: number,
): number {
  return (innerSpanMm - count * thicknessMm) / (count + 1);
}

// Divider i sits after (i+1) compartments and i earlier dividers.
function placements(
  axis: DividerAxis,
  count: number,
  innerSpanMm: number,
  thicknessMm: number,
): ReadonlyArray<DividerPlacement> {
  const pitch = compartmentPitchMm(innerSpanMm, count, thicknessMm);
  const out: DividerPlacement[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ axis, index: i, startMm: thicknessMm + (i + 1) * pitch + i * thicknessMm });
  }
  return out;
}

/**
 * Junction cell k in divider-local v (0 = bottom face). The pattern's
 * interior maps to [0, heightSpan] by subtracting the T border, keeping the
 * boundary floats shared between tab and slot builders.
 */
export function junctionCellBounds(
  layout: DividerLayout,
  cellIndex: number,
): { readonly fromMm: number; readonly toMm: number } {
  const t = layout.junction.interiorStartMm;
  return {
    fromMm: cellBoundary(layout.junction, cellIndex) - t,
    toMm: cellBoundary(layout.junction, cellIndex + 1) - t,
  };
}

/** Odd junction cells are divider tabs / wall slots. */
export function isTabCell(cellIndex: number): boolean {
  return cellIndex % 2 === 1;
}

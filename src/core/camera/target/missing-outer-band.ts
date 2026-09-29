// A photo of a target laid out differently from the layout it is matched to
// (ADR-441 Amendment 4). The rings carry no position of their own: matching
// starts at the anchor L and grows outward, so a target engraved with a wider
// margin fills a complete but smaller part of the assumed grid. Every ring
// found then fits perfectly, and the whole model is shifted by the difference
// between the two layouts. What gives it away is that whole outer rows or
// columns of the assumed grid are missing although the camera sees where they
// would be. Pure core.

import type { BedTargetLayout, BedTargetMark } from './bed-target';

export type MissingOuterBand = {
  /** The complete grid the found rings form, in rings. */
  readonly foundCols: number;
  readonly foundRows: number;
  /** The grid the layout expects. */
  readonly cols: number;
  readonly rows: number;
};

type Extent = {
  readonly minCol: number;
  readonly maxCol: number;
  readonly minRow: number;
  readonly maxRow: number;
};

// Inside the found grid a ring or two may still be lost to glare or dirt.
const MIN_INNER_FILL = 0.9;
// Enough of the missing rings must lie where the camera sees for their
// absence to mean something: a band outside the picture is simply unseen.
const MIN_MISSING_IN_VIEW = 0.5;
// A found ring belongs to the layout mark within this share of the spacing.
const MATCH_SHARE = 0.25;

/**
 * The found rings, by their engraved (layout) positions, form a complete grid
 * smaller than the layout, and the missing outer rings lie where the camera
 * sees (`inView`). Null otherwise, including when every ring was found.
 */
export function missingOuterBand(
  layout: BedTargetLayout,
  found: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  inView: (mark: BedTargetMark) => boolean,
): MissingOuterBand | null {
  const foundMarks = marksAt(layout, found);
  if (foundMarks.size === 0 || foundMarks.size >= layout.marks.length) return null;
  const whole = extentOf(layout.marks);
  const box = extentOf([...foundMarks]);
  if (whole === null || box === null || sameExtent(whole, box)) return null;
  const inside = layout.marks.filter((mark) => within(box, mark));
  if (foundMarks.size < MIN_INNER_FILL * inside.length) return null;
  const missing = layout.marks.filter((mark) => !within(box, mark));
  if (missing.filter(inView).length < MIN_MISSING_IN_VIEW * missing.length) return null;
  return {
    foundCols: box.maxCol - box.minCol + 1,
    foundRows: box.maxRow - box.minRow + 1,
    cols: whole.maxCol - whole.minCol + 1,
    rows: whole.maxRow - whole.minRow + 1,
  };
}

function marksAt(
  layout: BedTargetLayout,
  found: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): Set<BedTargetMark> {
  const reach = MATCH_SHARE * layout.spacingMm;
  const marks = new Set<BedTargetMark>();
  for (const point of found) {
    const mark = layout.marks.find((m) => Math.hypot(m.x - point.x, m.y - point.y) <= reach);
    if (mark !== undefined) marks.add(mark);
  }
  return marks;
}

function extentOf(marks: ReadonlyArray<BedTargetMark>): Extent | null {
  if (marks.length === 0) return null;
  const cols = marks.map((m) => m.col);
  const rows = marks.map((m) => m.row);
  return {
    minCol: Math.min(...cols),
    maxCol: Math.max(...cols),
    minRow: Math.min(...rows),
    maxRow: Math.max(...rows),
  };
}

function sameExtent(a: Extent, b: Extent): boolean {
  return (
    a.minCol === b.minCol && a.maxCol === b.maxCol && a.minRow === b.minRow && a.maxRow === b.maxRow
  );
}

function within(box: Extent, mark: BedTargetMark): boolean {
  return (
    mark.col >= box.minCol &&
    mark.col <= box.maxCol &&
    mark.row >= box.minRow &&
    mark.row <= box.maxRow
  );
}

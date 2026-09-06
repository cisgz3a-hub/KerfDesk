import { isClosedEnough, type Polyline } from '../scene';
import type { NonzeroContourGroups } from './fill-contour-groups';
import { offsetPreparedFillRegionChecked, prepareOffsetFillRegion } from './offset-fill-region';
import type { OffsetFillTermination } from './offset-fill-termination';

const MIN_OFFSET_FILL_SPACING_MM = 0.05;
const MIN_CONTOUR_AREA_MM2 = 1e-6;
const MAX_OFFSET_FILL_PASSES = 2000;

/** Geometry and physical spacing used to produce a Follow Shape fill. */
export type OffsetFillInput = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly spacingMm: number;
  readonly nonzeroGroups?: NonzeroContourGroups;
};

/** Generated contours plus the factual reason contour production stopped. */
export type OffsetFillResult = {
  readonly contours: ReadonlyArray<Polyline>;
  readonly termination: OffsetFillTermination;
};

type OffsetPass = {
  readonly contours: ReadonlyArray<Polyline>;
  readonly isFailed: boolean;
};

/** Generate successive inward contours without hiding failure or budget exhaustion. */
export function offsetFillContours(input: OffsetFillInput): OffsetFillResult {
  const spacing = Math.max(MIN_OFFSET_FILL_SPACING_MM, input.spacingMm);
  // A crossing contour can have zero signed area and still enclose valid
  // even-odd ink. Test area only after resolving the complete filled region.
  const prepared = prepareOffsetFillRegion(
    input.polylines.filter(isClosedEnough),
    input.nonzeroGroups,
  );
  if (prepared.kind === 'error') return { contours: [], termination: { kind: 'offset-failed' } };
  const source = prepared.value.filter(isUsableClosedContour);
  if (source.length === 0) return { contours: [], termination: { kind: 'complete' } };

  let current = offsetBy(source, -spacing / 2);
  const out: Polyline[] = [];
  const passLimit = offsetPassLimit(source, spacing);
  for (let pass = 0; current.contours.length > 0 && pass < passLimit; pass += 1) {
    out.push(...current.contours);
    current = offsetBy(current.contours, -spacing);
  }
  // A failure can happen on the lookahead after the final emitted contour, so
  // it takes precedence over the budget check. A still-populated lookahead
  // means the fixed work budget stopped a geometrically unfinished fill.
  const termination: OffsetFillTermination = current.isFailed
    ? { kind: 'offset-failed' }
    : current.contours.length > 0
      ? { kind: 'pass-limit', passLimit }
      : { kind: 'complete' };
  return { contours: out, termination };
}

function offsetBy(polylines: ReadonlyArray<Polyline>, offsetMm: number): OffsetPass {
  // Keep both the prepared winding and factual engine failure on every pass.
  const offset = offsetPreparedFillRegionChecked(polylines, offsetMm);
  if (offset.kind === 'error') return { contours: [], isFailed: true };
  return { contours: offset.value.filter(isUsableClosedContour), isFailed: false };
}

function offsetPassLimit(polylines: ReadonlyArray<Polyline>, spacing: number): number {
  const bounds = polylineBounds(polylines);
  if (bounds === null) return 0;
  const maxSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return Math.min(MAX_OFFSET_FILL_PASSES, Math.max(1, Math.ceil(maxSpan / spacing) + 2));
}

function polylineBounds(polylines: ReadonlyArray<Polyline>): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polyline of polylines) {
    for (const point of polyline.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

function isUsableClosedContour(polyline: Polyline): boolean {
  return isClosedEnough(polyline) && Math.abs(signedArea(polyline)) > MIN_CONTOUR_AREA_MM2;
}

function signedArea(polyline: Polyline): number {
  let area = 0;
  for (let i = 0; i < polyline.points.length; i += 1) {
    const a = polyline.points[i];
    const b = polyline.points[(i + 1) % polyline.points.length];
    if (a === undefined || b === undefined) continue;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

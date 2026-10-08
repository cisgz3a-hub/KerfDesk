// A coverage arrangement is built once per operation/run, before settings/pass hatching.
// Even cells must survive until the last contributor: a third overlap restores material.
import type { Polyline } from '../scene';
import { ok, type Result } from '../result';
import { differenceClosedPolylinesChecked } from '../geometry/polygon-difference';
import { intersectClosedPolylinesChecked } from '../geometry/polygon-intersection';
import type { VectorOpError } from '../geometry/vector-path-tools';
import { polylineBounds, type SegmentBounds } from './segment-bounds';
import type { MaterialComponent } from './fill-material-components';

export type CoverageCell = {
  readonly contours: ReadonlyArray<Polyline>;
  readonly contributors: ReadonlyArray<number>;
  readonly bounds: SegmentBounds | null;
};

export function materialCoverageCells(
  components: ReadonlyArray<MaterialComponent>,
): Result<ReadonlyArray<CoverageCell>, VectorOpError> {
  let cells: ReadonlyArray<CoverageCell> = [];
  for (const [index, component] of components.entries()) {
    const next = addComponent(cells, component.contours, index);
    if (next.kind === 'error') return next;
    cells = next.value;
  }
  return ok(cells);
}

function addComponent(
  cells: ReadonlyArray<CoverageCell>,
  contours: ReadonlyArray<Polyline>,
  index: number,
): Result<ReadonlyArray<CoverageCell>, VectorOpError> {
  const out: CoverageCell[] = [];
  const bounds = regionBounds(contours);
  let remaining = contours;
  for (const cell of cells) {
    if (!boundsOverlap(cell.bounds, bounds)) {
      out.push(cell);
      continue;
    }
    const intersection = intersectClosedPolylinesChecked(cell.contours, contours);
    if (intersection.kind === 'error') return intersection;
    if (intersection.value.length === 0) {
      out.push(cell);
      continue;
    }
    const outside = differenceClosedPolylinesChecked(cell.contours, contours);
    if (outside.kind === 'error') return outside;
    const rest = differenceClosedPolylinesChecked(remaining, cell.contours);
    if (rest.kind === 'error') return rest;
    remaining = rest.value;
    if (outside.value.length > 0) out.push(makeCell(outside.value, cell.contributors));
    out.push(makeCell(intersection.value, [...cell.contributors, index]));
  }
  if (remaining.length > 0) out.push(makeCell(remaining, [index]));
  return ok(out);
}

function makeCell(
  contours: ReadonlyArray<Polyline>,
  contributors: ReadonlyArray<number>,
): CoverageCell {
  return { contours, contributors, bounds: regionBounds(contours) };
}

function regionBounds(contours: ReadonlyArray<Polyline>): SegmentBounds | null {
  let bounds: SegmentBounds | null = null;
  for (const contour of contours) {
    const next = polylineBounds(contour.points);
    if (next === null) continue;
    bounds =
      bounds === null
        ? next
        : {
            minX: Math.min(bounds.minX, next.minX),
            minY: Math.min(bounds.minY, next.minY),
            maxX: Math.max(bounds.maxX, next.maxX),
            maxY: Math.max(bounds.maxY, next.maxY),
          };
  }
  return bounds;
}

function boundsOverlap(a: SegmentBounds | null, b: SegmentBounds | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.maxX > b.minX &&
    b.maxX > a.minX &&
    a.maxY > b.minY &&
    b.maxY > a.minY
  );
}

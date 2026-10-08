// Full-boundary proper containment, not a vertex/area/nearest-source guess.
import type { Vec2 } from '../scene';
import { segmentContainedInPolygon } from '../geometry/segment-contained-in-polygon';
import { ContourBoxIndex } from '../trace/contour-box-index';
import { boundsContains, polylineBounds } from './segment-bounds';
import type { CutSegment } from './job';

export function properContourAncestors(
  contours: ReadonlyArray<Pick<CutSegment, 'polyline' | 'closed' | 'nesting'>>,
): number[][] {
  const boxes = contours.flatMap((contour, index) => {
    const box = contour.closed ? polylineBounds(contour.polyline) : null;
    return box === null ? [] : [{ ...box, index }];
  });
  const spatial = ContourBoxIndex.create(boxes);
  return contours.map((target, index) => {
    const box = polylineBounds(target.polyline);
    if (box === null) return [];
    return spatial
      .query(box)
      .filter((candidate) => {
        if (candidate.index === index || !boundsContains(candidate, box)) return false;
        const container = contours[candidate.index];
        if (
          container === undefined ||
          (target.nesting !== undefined && target.nesting.forest === container.nesting?.forest)
        )
          return false;
        if (!wholeOutlineInside(target.polyline, container.polyline)) return false;
        return (
          !boundsContains(box, candidate) ||
          !wholeOutlineInside(container.polyline, target.polyline)
        );
      })
      .map((candidate) => candidate.index)
      .sort((a, b) => a - b);
  });
}

export function properContourDepths(
  contours: ReadonlyArray<Pick<CutSegment, 'polyline' | 'closed' | 'nesting'>>,
): number[] {
  return properContourAncestors(contours).map(
    (ancestors, index) => ancestors.length + (contours[index]?.nesting?.depth ?? 0),
  );
}

function wholeOutlineInside(target: ReadonlyArray<Vec2>, container: ReadonlyArray<Vec2>): boolean {
  return (
    target.length >= 3 &&
    target.every((from, index) => {
      const to = target[(index + 1) % target.length];
      return to !== undefined && segmentContainedInPolygon(from, to, container);
    })
  );
}

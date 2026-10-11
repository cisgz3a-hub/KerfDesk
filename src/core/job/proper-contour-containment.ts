// Full-boundary proper containment, not a vertex/area/nearest-source guess.
import type { Vec2 } from '../scene';
import {
  segmentContainedInIndexedPolygon,
  segmentContainedInPolygon,
} from '../geometry/segment-contained-in-polygon';
import { PolygonEdgeIndex } from '../geometry/polygon-edge-index';
import { outlineBoundaryContacts, outlineContactKey } from '../geometry/outline-boundary-contacts';
import { ContourBoxIndex } from '../trace/contour-box-index';
import { boundsContains, polylineBounds } from './segment-bounds';
import type { CutSegment } from './job';

type Contour = Pick<CutSegment, 'polyline' | 'closed' | 'nesting'>;
type Pair = { readonly target: number; readonly container: number; readonly mutual: boolean };

// Below this many vertex-pair checks the direct scan is cheaper than building
// indexes. Both paths give the same answers.
const DIRECT_SCAN_BUDGET = 200_000;

export function properContourAncestors(contours: ReadonlyArray<Contour>): number[][] {
  const pairs = candidatePairs(contours);
  const inside = outlineInsideTest(contours, pairs);
  const ancestors = contours.map((): number[] => []);
  for (const { target, container, mutual } of pairs) {
    // Mutually containing outlines (identical ones) are not proper ancestors.
    if (inside(target, container) && !(mutual && inside(container, target))) {
      ancestors[target]?.push(container);
    }
  }
  for (const list of ancestors) list.sort((a, b) => a - b);
  return ancestors;
}

export function properContourDepths(contours: ReadonlyArray<Contour>): number[] {
  return properContourAncestors(contours).map(
    (ancestors, index) => ancestors.length + (contours[index]?.nesting?.depth ?? 0),
  );
}

// Closed containers whose box holds the target's, outside the target's own
// nesting forest.
function candidatePairs(contours: ReadonlyArray<Contour>): Pair[] {
  const boxes = contours.flatMap((contour, index) => {
    const box = contour.closed ? polylineBounds(contour.polyline) : null;
    return box === null ? [] : [{ ...box, index }];
  });
  const spatial = ContourBoxIndex.create(boxes);
  const pairs: Pair[] = [];
  contours.forEach((target, index) => {
    const box = polylineBounds(target.polyline);
    if (box === null) return;
    for (const candidate of spatial.query(box)) {
      if (candidate.index === index || !boundsContains(candidate, box)) continue;
      const container = contours[candidate.index];
      if (
        container === undefined ||
        (target.nesting !== undefined && target.nesting.forest === container.nesting?.forest)
      )
        continue;
      pairs.push({
        target: index,
        container: candidate.index,
        mutual: boundsContains(box, candidate),
      });
    }
  });
  return pairs;
}

function outlineInsideTest(
  contours: ReadonlyArray<Contour>,
  pairs: ReadonlyArray<Pair>,
): (target: number, container: number) => boolean {
  const outlines = contours.map((contour) => contour.polyline);
  const direct = (target: number, container: number): boolean =>
    wholeOutlineInside(outlines[target] ?? [], outlines[container] ?? []);
  if (scanCost(outlines, pairs) <= DIRECT_SCAN_BUDGET) return direct;
  const members = [...new Set(pairs.flatMap((pair) => [pair.target, pair.container]))];
  const contacts = outlineBoundaryContacts(outlines, members, contactDistance(outlines, members));
  if (contacts === null) return direct;
  const indexes = new Map<number, PolygonEdgeIndex | null>();
  const indexOf = (outline: number): PolygonEdgeIndex | null => {
    if (!indexes.has(outline))
      indexes.set(outline, PolygonEdgeIndex.create(outlines[outline] ?? []));
    return indexes.get(outline) ?? null;
  };
  return (target, container) => {
    const outline = outlines[target] ?? [];
    const index = indexOf(container);
    if (outline.length < 3 || index === null) return direct(target, container);
    // Boundaries that never approach cannot cross: one vertex decides.
    if (!contacts.has(outlineContactKey(target, container, outlines.length))) {
      return index.containsPoint(outline[0] as Vec2);
    }
    return outline.every((from, i) => {
      const to = outline[(i + 1) % outline.length];
      return to !== undefined && segmentContainedInIndexedPolygon(from, to, index);
    });
  };
}

function scanCost(
  outlines: ReadonlyArray<ReadonlyArray<Vec2>>,
  pairs: ReadonlyArray<Pair>,
): number {
  let cost = 0;
  for (const { target, container } of pairs) {
    cost += (outlines[target]?.length ?? 0) * (outlines[container]?.length ?? 0);
    if (cost > DIRECT_SCAN_BUDGET) return cost;
  }
  return cost;
}

// Far above the containment tolerance (1e-9 mm) and the rounding of a
// point-in-polygon probe, so an outline judged clear of another by this
// distance has every probe strictly inside or strictly outside it.
function contactDistance(
  outlines: ReadonlyArray<ReadonlyArray<Vec2>>,
  members: ReadonlyArray<number>,
): number {
  let magnitude = 1;
  for (const member of members) {
    for (const point of outlines[member] ?? []) {
      magnitude = Math.max(magnitude, Math.abs(point.x), Math.abs(point.y));
    }
  }
  return 1e-6 + 1e-9 * magnitude;
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

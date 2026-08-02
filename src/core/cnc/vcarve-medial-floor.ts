import { buildOffsetLadder, insetContoursChecked } from '../geometry/offset-ladder';
import { normalizeClosedPolylineTreeEvenOddChecked } from '../geometry/polygon-difference';
import type { Polyline, Vec2 } from '../scene';
import {
  distinctLoopPoints,
  vcarveBoundarySegments,
  vcarveChordInsideRegion,
  vcarveMedialRegionsFromTree,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

const MAX_FLOOR_RINGS = 8192;

export type VCarveFlatCorePlan = {
  readonly routes: ReadonlyArray<Polyline>;
  readonly offsetFailed: boolean;
  readonly capped: boolean;
};

/**
 * A depth clamp or the finite cutting diameter of the selected V-bit leaves a
 * flat core wherever the artwork is wider than the cone can reach. Clearing
 * that area genuinely needs repeated lines; this planner joins all rings in
 * one filled component into one tool-down route whenever an exact in-core
 * connector exists.
 */
export function vcarveFlatCoreRoutes(
  normalizedContours: ReadonlyArray<Polyline>,
  clampInsetMm: number,
  floorPitchMm: number,
): VCarveFlatCorePlan {
  if (!(clampInsetMm > 0) || !(floorPitchMm > 0)) return NO_FLAT_CORE;
  const floor = insetContoursChecked(normalizedContours, clampInsetMm);
  if (floor.offsetFailed) return { ...NO_FLAT_CORE, offsetFailed: true };
  const normalizedFloor = normalizeClosedPolylineTreeEvenOddChecked(floor.contours);
  if (normalizedFloor.kind === 'error') return { ...NO_FLAT_CORE, offsetFailed: true };
  const regions = vcarveMedialRegionsFromTree(normalizedFloor.value);
  const routes: Polyline[] = [];
  let offsetFailed = false;
  let capped = false;
  for (const region of regions) {
    const ladder = buildOffsetLadder(
      region.loops,
      MAX_FLOOR_RINGS,
      (step) => (step + 1) * floorPitchMm,
    );
    offsetFailed = offsetFailed || ladder.offsetFailed;
    capped = capped || ladder.capped;
    routes.push(...linkFloorLoops(region, [...region.loops, ...ladder.rings.flat()]));
  }
  return { routes, offsetFailed, capped };
}

function linkFloorLoops(
  region: VCarveMedialRegion,
  loops: ReadonlyArray<Polyline>,
): ReadonlyArray<Polyline> {
  const remaining = loops
    .map((loop) => distinctLoopPoints(loop.points))
    .filter((points) => points.length >= 3);
  const routes: Polyline[] = [];
  const segments = vcarveBoundarySegments(region);
  while (remaining.length > 0) {
    const first = remaining.shift();
    if (first === undefined) continue;
    const route = closedLoopFrom(first, stableStartIndex(first));
    const returnPoints: Vec2[] = [];
    for (;;) {
      const current = route.at(-1);
      if (current === undefined) break;
      const link = nearestContainedLoop(current, remaining, region, segments);
      if (link === null) break;
      const [selected] = remaining.splice(link.loopIndex, 1);
      if (selected === undefined) break;
      const nextLoop = closedLoopFrom(selected, link.pointIndex);
      const next = nextLoop[0];
      if (next !== undefined && !samePoint(current, next)) {
        returnPoints.push(current);
        route.push(next);
      }
      route.push(...nextLoop.slice(1));
    }
    route.push(...returnPoints.reverse());
    routes.push({ points: route, closed: true });
  }
  return routes;
}

function nearestContainedLoop(
  from: Vec2,
  loops: ReadonlyArray<ReadonlyArray<Vec2>>,
  region: VCarveMedialRegion,
  segments: ReturnType<typeof vcarveBoundarySegments>,
): { readonly loopIndex: number; readonly pointIndex: number } | null {
  let best: { readonly loopIndex: number; readonly pointIndex: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  loops.forEach((loop, loopIndex) => {
    loop.forEach((point, pointIndex) => {
      const distance = Math.hypot(point.x - from.x, point.y - from.y);
      if (distance >= bestDistance) return;
      if (!vcarveChordInsideRegion(from, point, region, segments)) return;
      bestDistance = distance;
      best = { loopIndex, pointIndex };
    });
  });
  return best;
}

function closedLoopFrom(points: ReadonlyArray<Vec2>, startIndex: number): Vec2[] {
  const rotated = [...points.slice(startIndex), ...points.slice(0, startIndex)];
  const first = rotated[0];
  return first === undefined ? [] : [...rotated, first];
}

function stableStartIndex(points: ReadonlyArray<Vec2>): number {
  let best = 0;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const current = points[best];
    if (
      point !== undefined &&
      current !== undefined &&
      (point.x < current.x || (point.x === current.x && point.y < current.y))
    ) {
      best = index;
    }
  }
  return best;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

const NO_FLAT_CORE: VCarveFlatCorePlan = {
  routes: [],
  offsetFailed: false,
  capped: false,
};

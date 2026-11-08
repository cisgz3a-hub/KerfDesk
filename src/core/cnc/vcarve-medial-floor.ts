import {
  offsetClosedPolylinesForKerfChecked,
  offsetClosedPolylinesWithRoundJoinsChecked,
} from '../geometry/kerf-offset';
import { buildOffsetLadder, type InsetContours } from '../geometry/offset-ladder';
import {
  normalizeClosedPolylineTreeEvenOddChecked,
  unionClosedPolylinesChecked,
} from '../geometry/polygon-difference';
import type { Polyline, Vec2 } from '../scene';
import {
  distinctLoopPoints,
  vcarveBoundarySegments,
  vcarveChordInsideRegion,
  vcarveMedialRegionsFromTree,
  type VCarveMedialRegion,
} from './vcarve-medial-region';
import { appendAll } from '../util';

const MAX_FLOOR_RINGS = 8192;
// Clipper's default round-join arc tolerance as a fraction of the offset;
// kerf-offset passes no tolerance of its own. One join step therefore turns
// 2·acos(1 − 0.002), about 7.25 degrees.
const CLIPPER_ARC_TOLERANCE_PER_MM = 0.002;

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
  const floor = flatCoreContours(normalizedContours, clampInsetMm);
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

/**
 * The flat core is every point at least one cone radius `r` from the outline:
 * the region eroded by a disc (ADR-285 Amendment 1). Around an inside corner
 * its edge is an arc of radius `r` centred on the corner. A mitred inset alone
 * squares that corner off short of the arc, and the cone sweeping the square
 * corner leaves a fin standing on the floor.
 *
 * A plain round-join inset is not the answer either. Clipper puts its arc
 * points on the circle, so each chord dips inside radius `r`, the floor pass
 * must rise and fall along it, and the certified depth profile splits it into
 * blocks too short for GRBL's 16-block planner window (ADR-285 item 6).
 *
 * So the core is the mitred inset at `r`, joined with a round-join inset at
 * `r / (1 - 0.002)`. That inset's chords touch the circle of radius `r` from
 * outside, so no point of the core comes nearer the outline than `r` and the
 * floor stays at full depth. At a corner turning less than one join step the
 * enlarged arc lies inside the mitred inset, so the union keeps the single
 * mitre point there, which is no further off the arc than Clipper's own
 * chords. Only sharper inside corners gain the arc.
 */
function flatCoreContours(contours: ReadonlyArray<Polyline>, insetMm: number): InsetContours {
  const mitred = offsetClosedPolylinesForKerfChecked(contours, -insetMm);
  if (mitred.kind === 'error') return FLAT_CORE_FAILED;
  const arcs = offsetClosedPolylinesWithRoundJoinsChecked(
    contours,
    -insetMm / (1 - CLIPPER_ARC_TOLERANCE_PER_MM),
  );
  if (arcs.kind === 'error') return FLAT_CORE_FAILED;
  const core = unionClosedPolylinesChecked(mitred.value, arcs.value);
  return core.kind === 'error' ? FLAT_CORE_FAILED : { contours: core.value, offsetFailed: false };
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
      appendAll(route, nextLoop.slice(1));
    }
    appendAll(route, returnPoints.reverse());
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

const FLAT_CORE_FAILED: InsetContours = { contours: [], offsetFailed: true };
